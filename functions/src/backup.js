/* ============================================================
 * UneFibra SAS — Backup diario de Firestore (KZ-UNEF-005)
 * ------------------------------------------------------------
 * Historial del defecto que este módulo corrige:
 *   El 25-oct-2026 la corrida diaria falló con
 *   «Exportación Firestore falló (503): Deadline expired…» y no hubo respaldo
 *   ese día. El código anterior lanzaba la exportación, veía un 200 y daba la
 *   tarea por buena: no reintentaba, no esperaba a `done`, no comprobaba que
 *   los objetos existieran y no avisaba de nada.
 *
 * Qué hace ahora:
 *   1. Cerrojo: impide dos corridas simultáneas (documento con caducidad).
 *   2. Lanza la exportación y ESPERA la operación hasta `done === true`.
 *   3. Verifica que el respaldo exista de verdad en el bucket (objetos y
 *      metadatos de exportación), no solo que la API haya aceptado la orden.
 *   4. Reintenta con espera progresiva solo los errores transitorios
 *      (429/5xx/red); los de permisos o bucket NO se reintentan.
 *   5. Deja registro de inicio, intentos y finalización.
 *   6. Devuelve un resultado explícito: `iniciada` es distinto de `completada`.
 *
 * Retención: la regla de ciclo de vida del bucket borra objetos con más de 30
 * días (creada el 08-oct-2026). El respaldo compensatorio previo a un despliegue
 * se guarda en `pre-<misión>/<fecha>`, fuera de `daily/`, para que esa regla no
 * lo borre mientras esté vigente una publicación.
 *
 * Todo está inyectable (`deps`) para poder probar los ocho escenarios exigidos
 * sin tocar la base real ni generar exportaciones de verdad.
 * ============================================================ */

const admin = require("firebase-admin");
/* KZ-UNEF-018 · firebase-admin 14 quitó los namespaces legacy
   (`admin.firestore()`, `admin.firestore.FieldValue`, `admin.firestore.Timestamp`).
   Mientras index.js ya usaba la API modular, ESTE módulo no: la corrida del
   respaldo moría en 53 ms con «TypeError: admin.firestore is not a function».
   Se detectó el 26-oct-2026 al disparar el job real para comprobar el código
   nuevo (KZ-UNEF-018 · FASE 1.2). Las pruebas de respaldo no lo vieron porque
   inyectan `deps` y nunca ejercitan el cableado por defecto. */
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const PROJECT_ID = "une-fibra";
const BUCKET = "unefibra-firestore-backups";
const COLECCION_CERROJO = "configuracion";
const DOC_CERROJO = "backupEnCurso";

/* Errores que merecen otro intento: son del servicio, no del código. */
const CODIGOS_TRANSITORIOS = new Set([429, 500, 502, 503, 504]);
const ESTADOS_TRANSITORIOS = new Set(["UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL", "ABORTED", "RESOURCE_EXHAUSTED"]);

function esTransitorio(error) {
  if (!error) return false;
  if (error.transitorio === true) return true;
  if (typeof error.status === "number" && CODIGOS_TRANSITORIOS.has(error.status)) return true;
  if (error.codigo && ESTADOS_TRANSITORIOS.has(String(error.codigo))) return true;
  if (error.name === "TypeError") return true;             // fallo de red / fetch
  return false;
}

function errorConEstado(status, mensaje, extra) {
  const e = new Error(mensaje);
  e.status = status;
  if (extra) Object.assign(e, extra);
  return e;
}

/** Espera progresiva: 2s, 4s, 8s… con techo configurable. */
function esperaProgresiva(intento, baseMs, techoMs) {
  const ms = Math.min(baseMs * Math.pow(2, intento - 1), techoMs);
  return Math.round(ms * (0.85 + Math.random() * 0.3)); // jitter suave
}

/**
 * Clasifica los objetos del bucket en un respaldo válido o inválido.
 * Un respaldo sirve si existe el metadato global de exportación y al menos un
 * archivo de datos. Un metadato solo significa "empezó", no "terminó".
 */
function evaluarObjetos(nombres) {
  const lista = Array.isArray(nombres) ? nombres : [];
  const metadatos = lista.filter((n) => /export_metadata$/.test(n));
  const globales = lista.filter((n) => /\.overall_export_metadata$/.test(n));
  /* Un archivo de DATOS es cualquiera que no sea metadato (output-0, output-1…). */
  const datos = lista.filter((n) => !/export_metadata$/.test(n));
  const completo = globales.length > 0 && datos.length > 0;
  return {
    completo,
    totalObjetos: lista.length,
    metadatos: metadatos.length,
    metadatosGlobales: globales.length,
    datos: datos.length,
    motivo: completo ? null
      : globales.length === 0 ? "falta el metadato global (overall_export_metadata)"
      : "no hay archivos de datos, solo metadatos"
  };
}

/**
 * Crea un exportador con dependencias inyectables.
 * `deps` admite: fetchImpl, tokenProveedor, dormir, ahora, lock, listarObjetos,
 * esperarOperacion (ms), intentosMax, baseMsRetroceso, techoMsRetroceso,
 * timeoutOperacionMs, intervaloConsultaMs, log.
 */
function crearExportador(deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const dormir = deps.dormir || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ahora = deps.ahora || (() => Date.now());
  const log = deps.log || ((...a) => console.log(...a));
  const intentosMax = deps.intentosMax || 4;
  const baseMs = deps.baseMsRetroceso || 2000;
  const techoMs = deps.techoMsRetroceso || 30000;
  const timeoutOperacionMs = deps.timeoutOperacionMs || 15 * 60 * 1000;
  const intervaloConsultaMs = deps.intervaloConsultaMs || 3000;

  const tokenProveedor = deps.tokenProveedor || (async () => {
    const t = await admin.getApp().options.credential.getAccessToken();
    return t.access_token;
  });

  const listarObjetos = deps.listarObjetos || (async (prefijo) => {
    const token = await tokenProveedor();
    const r = await fetchImpl(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=${encodeURIComponent(prefijo)}&maxResults=200`, {
      headers: { Authorization: "Bearer " + token }
    });
    if (r.status === 401 || r.status === 403) throw errorConEstado(r.status, "Sin permiso para leer el bucket de respaldos.", { definitivo: true });
    if (!r.ok) throw errorConEstado(r.status, `No se pudo listar el bucket (${r.status}).`);
    const j = await r.json();
    return (j.items || []).map((o) => o.name);
  });

  /* Cerrojo con caducidad: si el proceso muere, el siguiente puede tomarlo. */
  const lock = deps.lock || {
    async adquirir(duracionMs) {
      const db = getFirestore();
      const ref = db.collection(COLECCION_CERROJO).doc(DOC_CERROJO);
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const ahoraMs = Date.now();
        if (snap.exists) {
          const d = snap.data() || {};
          const expira = d.expiraEn && d.expiraEn.toMillis ? d.expiraEn.toMillis() : 0;
          if (expira > ahoraMs) return { ok: false, motivo: "Ya hay un respaldo en curso." };
        }
        t.set(ref, { inicio: FieldValue.serverTimestamp(), expiraEn: Timestamp.fromMillis(ahoraMs + duracionMs), estado: "EN_CURSO" });
        return { ok: true };
      });
    },
    async liberar(resultado) {
      const db = getFirestore();
      await db.collection(COLECCION_CERROJO).doc(DOC_CERROJO)
        .set({ estado: resultado, expiraEn: Timestamp.fromMillis(0) }, { merge: true });
    }
  };

  async function pedir(token, url, opciones) {
    const r = await fetchImpl(url, { ...opciones, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opciones && opciones.headers) } });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* texto plano */ }
    const ok = r.ok !== undefined ? r.ok : (r.status >= 200 && r.status < 300);
    return { ok, status: r.status, json, texto };
  }

  /** Un intento completo: lanzar, esperar la operación y verificar el bucket. */
  async function intentarUnaVez() {
    const token = await tokenProveedor();
    const stamp = new Date(ahora()).toISOString().replace(/[:.]/g, "-");
    const outputUriPrefix = `gs://${BUCKET}/daily/${stamp}`;

    log("[backup] iniciando exportación", { outputUriPrefix });
    const inicio = await pedir(token, `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments`, {
      method: "POST",
      body: JSON.stringify({ outputUriPrefix })
    });

    if (inicio.status === 401 || inicio.status === 403) {
      throw errorConEstado(inicio.status, "Sin permiso para exportar Firestore (revisar el rol de la cuenta de servicio).", { definitivo: true });
    }
    if (!inicio.ok) {
      const codigo = inicio.json && inicio.json.error && inicio.json.error.status;
      throw errorConEstado(inicio.status, `Exportación rechazada (${inicio.status})`, { codigo });
    }

    const nombreOperacion = inicio.json && inicio.json.name;
    if (!nombreOperacion) throw errorConEstado(inicio.status, "La exportación no devolvió el nombre de la operación.");

    /* Esperar a que la operación termine: un 200 inicial solo significa ENCOLADA. */
    const limite = ahora() + timeoutOperacionMs;
    let operacion = null;
    while (ahora() < limite) {
      const consulta = await pedir(token, `https://firestore.googleapis.com/v1/${nombreOperacion}`, { method: "GET" });
      if (consulta.status === 401 || consulta.status === 403) {
        throw errorConEstado(consulta.status, "Sin permiso para consultar la operación de exportación.", { definitivo: true });
      }
      if (consulta.ok && consulta.json) {
        operacion = consulta.json;
        if (operacion.done) break;
      }
      await dormir(intervaloConsultaMs);
    }

    if (!operacion) throw errorConEstado(504, "La operación de exportación no respondió.", { codigo: "DEADLINE_EXCEEDED" });
    if (!operacion.done) throw errorConEstado(504, "La exportación no terminó dentro del plazo.", { codigo: "DEADLINE_EXCEEDED" });
    if (operacion.error) {
      const codigo = operacion.error.status || operacion.error.code;
      throw errorConEstado(500, `La exportación falló: ${operacion.error.message || codigo}`, { codigo });
    }

    /* Verificación real: ¿existen los archivos? */
    const prefijo = `daily/${stamp}/`;
    const objetos = await listarObjetos(prefijo);
    const evaluacion = evaluarObjetos(objetos);
    if (!evaluacion.completo) {
      throw errorConEstado(500, "Exportación incompleta: " + evaluacion.motivo, { codigo: "INCOMPLETA", evaluacion });
    }

    log("[backup] completado", { outputUriPrefix, objetos: evaluacion.totalObjetos });
    return { estado: "COMPLETADO", outputUriPrefix, objetos: evaluacion.totalObjetos, evaluacion };
  }

  /** Exportación con reintentos y cerrojo. Devuelve siempre un resultado explícito. */
  async function exportar(opciones = {}) {
    const duracionCerrojo = opciones.duracionCerrojoMs || 30 * 60 * 1000;
    const cerrojo = await lock.adquirir(duracionCerrojo);
    if (!cerrojo.ok) {
      log("[backup] omitido:", cerrojo.motivo);
      return { estado: "OMITIDO", motivo: cerrojo.motivo, intentos: 0 };
    }

    const intentos = [];
    try {
      for (let intento = 1; intento <= intentosMax; intento++) {
        try {
          const r = await intentarUnaVez();
          intentos.push({ intento, resultado: "COMPLETADO" });
          await lock.liberar("COMPLETADO");
          return { ...r, intentos };
        } catch (e) {
          const transitorio = esTransitorio(e);
          intentos.push({ intento, resultado: "ERROR", mensaje: String(e.message).slice(0, 200), transitorio });
          log(`[backup] intento ${intento} falló:`, e.message);
          if (e.definitivo || !transitorio || intento === intentosMax) {
            const estado = e.definitivo ? "FALLIDO_DEFINITIVO" : "FALLIDO";
            await lock.liberar(estado);
            return { estado, motivo: e.message, intentos, requiereAlerta: true };
          }
          await dormir(esperaProgresiva(intento, baseMs, techoMs));
        }
      }
      await lock.liberar("FALLIDO");
      return { estado: "FALLIDO", motivo: "Se agotaron los intentos.", intentos, requiereAlerta: true };
    } catch (e) {
      await lock.liberar("ERROR_INTERNO");
      throw e;
    }
  }

  return { exportar, intentarUnaVez, evaluarObjetos, esTransitorio };
}

const porDefecto = crearExportador();

/** Compatibilidad con el código anterior: lanza y devuelve la ruta. */
async function exportarFirestore() {
  const r = await porDefecto.exportar();
  if (r.estado !== "COMPLETADO") {
    const e = new Error(`Respaldo no completado (${r.estado}): ${r.motivo || ""}`);
    e.resultado = r;
    throw e;
  }
  return r.outputUriPrefix;
}

module.exports = {
  BUCKET,
  PROJECT_ID,
  crearExportador,
  exportarFirestore,
  exportarConDetalle: (opciones) => porDefecto.exportar(opciones),
  evaluarObjetos,
  esTransitorio,
  esperaProgresiva
};
