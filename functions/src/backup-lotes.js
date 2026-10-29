/* ============================================================
 * UneFibra SAS — Respaldo de Firestore por lotes (KZ-UNEF-028)
 * ------------------------------------------------------------
 * EL DEFECTO QUE ESTO CORRIGE
 * La exportación diaria pedía la base ENTERA en una sola operación. Con 332
 * servicios esa operación tarda 536,8 s y la función (gen 1) muere a los 540 s:
 * la exportación llegaba a completarse en el bucket, pero la función no alcanzaba
 * a verificarla ni a liberar el cerrojo, y el respaldo quedaba SIN CERTIFICAR.
 * Subir `timeoutSeconds` no es una opción: 540 s es el máximo de gen 1.
 *
 * LA SOLUCIÓN (sin cambiar de plan ni de infraestructura)
 *   · Se exporta POR COLECCIONES, un lote cada vez, cada uno con su propia
 *     operación y su propio prefijo en el bucket.
 *   · Cada invocación trabaja con un PRESUPUESTO de tiempo (por defecto 420 s de
 *     los 540 disponibles) y guarda el progreso en Firestore.
 *   · Si el presupuesto se agota, la corrida devuelve PARCIAL (no es un error):
 *     la siguiente invocación continúa exactamente donde quedó, sin repetir los
 *     lotes ya completados ni duplicar objetos.
 *   · El respaldo solo se declara COMPLETADO cuando TODAS las colecciones raíz
 *     están exportadas y verificadas en el bucket. Nunca antes.
 *
 * POR QUÉ NO GEN 2
 * Gen 2 (`onSchedule`, 1800 s) también resolvería el tiempo, pero exige Cloud
 * Run/Eventarc y un cambio de facturación del proyecto. El loteo consigue lo
 * mismo dentro de gen 1 y sin coste nuevo: se prefiere por la restricción de no
 * cambiar planes sin justificarlo. Si algún día una sola colección no cupiera en
 * el presupuesto, el manifiesto lo mostraría (se guarda el tiempo de cada lote) y
 * entonces sí habría que evaluar gen 2.
 *
 * Todo es inyectable (`deps`) para probar los escenarios sin tocar el bucket real
 * ni generar exportaciones de verdad.
 * ============================================================ */

"use strict";

const { evaluarObjetos, esTransitorio, esperaProgresiva } = require("./backup");

const COLECCION_ESTADO = "backups";
const DOC_CERROJO = "backupEnCurso";
const COLECCION_CONFIG = "configuracion";

/** Nombre de corrida por defecto: un día (así una corrida puede durar varias ejecuciones). */
function corridaDeFecha(fechaISO) {
  return String(fechaISO || new Date().toISOString().slice(0, 10));
}

/** Convierte un id de colección en un segmento seguro de ruta en el bucket. */
function segmento(coleccion) {
  return String(coleccion).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

/**
 * Reparte las colecciones en lotes. `porLote` = 1 significa una operación de
 * exportación por colección: es lo más granular y lo que permite reanudar con el
 * mínimo trabajo repetido.
 */
function planear(colecturas, porLote = 1) {
  const lista = [...new Set((colecturas || []).filter(Boolean).map(String))].sort();
  const tamano = Math.max(1, Math.floor(porLote));
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) {
    const grupos = lista.slice(i, i + tamano);
    lotes.push({ id: grupos.map(segmento).join("__"), colecciones: grupos });
  }
  return { total: lista.length, tamano, lotes };
}

/**
 * Crea el respaldo por lotes con dependencias inyectables.
 *
 * deps:
 *   fetchImpl, tokenProveedor, dormir, ahora, log
 *   listarColecciones()            -> string[]  (colecciones raíz)
 *   listarObjetos(prefijo)         -> string[]
 *   estado.leer(corrida) / estado.guardar(corrida, datos)
 *   lock.adquirir(ms) / lock.liberar(estado)
 *   proyectoId, bucket, porLote, presupuestoMs, timeoutOperacionMs,
 *   intervaloConsultaMs, intentosMax, baseMsRetroceso, techoMsRetroceso
 */
function crearBackupPorLotes(deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const dormir = deps.dormir || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ahora = deps.ahora || (() => Date.now());
  const log = deps.log || ((...a) => console.log(...a));
  const proyectoId = deps.proyectoId || "une-fibra";
  const bucket = deps.bucket || "unefibra-firestore-backups";
  const porLote = deps.porLote || 1;
  const presupuestoMs = deps.presupuestoMs || 420000;      // 7 min de los 9 disponibles
  const timeoutOperacionMs = deps.timeoutOperacionMs || 240000; // 4 min por lote
  const intervaloConsultaMs = deps.intervaloConsultaMs || 3000;
  const intentosMax = deps.intentosMax || 3;
  /* KZ-030 · Espera LARGA a propósito. Medido en producción: la PRIMERA
     exportación de una colección después de un rato inactivo tarda ~58 s (roza el
     límite interno del servicio y a veces devuelve «Deadline expired before
     operation could complete»), y las siguientes tardan ~1 s. Reintentar a los 2
     o 4 segundos caía otra vez en el camino frío y fallaba igual; reintentar tras
     ~30 s entra en el camino caliente. */
  const baseMs = deps.baseMsRetroceso || 30000;
  const techoMs = deps.techoMsRetroceso || 60000;

  const listarColecciones = deps.listarColecciones;
  const listarObjetos = deps.listarObjetos;
  const estado = deps.estado;
  const lock = deps.lock;

  const tokenProveedor = deps.tokenProveedor || (async () => {
    const admin = require("firebase-admin");
    const t = await admin.getApp().options.credential.getAccessToken();
    return t.access_token;
  });

  function errorConEstado(status, mensaje, extra) {
    const e = new Error(mensaje);
    e.status = status;
    if (extra) Object.assign(e, extra);
    return e;
  }

  async function pedir(token, url, opciones) {
    const r = await fetchImpl(url, {
      ...opciones,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opciones && opciones.headers) }
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* texto plano */ }
    const ok = r.ok !== undefined ? r.ok : (r.status >= 200 && r.status < 300);
    return { ok, status: r.status, json, texto };
  }

  /** Lanza la exportación de UN lote y espera a que termine de verdad. */
  async function exportarLote(token, lote, destino) {
    const inicio = await pedir(token, `https://firestore.googleapis.com/v1/projects/${proyectoId}/databases/(default):exportDocuments`, {
      method: "POST",
      body: JSON.stringify({ outputUriPrefix: destino, collectionIds: lote.colecciones })
    });
    if (inicio.status === 401 || inicio.status === 403) {
      throw errorConEstado(inicio.status, "Sin permiso para exportar Firestore (revisar el rol de la cuenta de servicio).", { definitivo: true });
    }
    if (inicio.status === 400 && /collection/i.test(inicio.texto || "")) {
      /* Una colección puede dejar de existir entre el plan y el lote: no es un
         fallo del respaldo, se marca para revisar y se sigue con el resto. */
      throw errorConEstado(400, "Firestore rechazó el lote de colecciones.", { definitivo: false, sinColeccion: true });
    }
    if (!inicio.ok) {
      const codigo = inicio.json && inicio.json.error && inicio.json.error.status;
      throw errorConEstado(inicio.status, `Exportación del lote rechazada (${inicio.status})`, { codigo });
    }
    const nombreOperacion = inicio.json && inicio.json.name;
    if (!nombreOperacion) throw errorConEstado(inicio.status, "La exportación no devolvió el nombre de la operación.");

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
    if (!operacion) throw errorConEstado(504, "La operación del lote no respondió.", { codigo: "DEADLINE_EXCEEDED" });
    if (!operacion.done) throw errorConEstado(504, "El lote no terminó dentro del plazo.", { codigo: "DEADLINE_EXCEEDED" });
    if (operacion.error) {
      const codigo = operacion.error.status || operacion.error.code;
      throw errorConEstado(500, `El lote falló: ${operacion.error.message || codigo}`, { codigo });
    }
    return nombreOperacion;
  }

  /** Ejecuta un lote con reintentos y verifica que los objetos existan. */
  async function ejecutarLote(lote, prefijoCorrida) {
    const destino = `gs://${bucket}/${prefijoCorrida}/${lote.id}`;
    const inicioMs = ahora();
    let ultimoError = null;

    for (let intento = 1; intento <= intentosMax; intento++) {
      try {
        const token = await tokenProveedor();
        await exportarLote(token, lote, destino);
        const prefijo = `${prefijoCorrida}/${lote.id}/`;
        const objetos = await listarObjetos(prefijo);
        const evaluacion = evaluarObjetos(objetos);
        if (!evaluacion.completo) {
          throw errorConEstado(500, "Lote incompleto en el bucket: " + evaluacion.motivo, { codigo: "INCOMPLETA" });
        }
        return { exito: true, uri: destino, objetos: evaluacion.totalObjetos, ms: ahora() - inicioMs, intentos: intento };
      } catch (e) {
        ultimoError = e;
        const transitorio = esTransitorio(e);
        log(`[backup-lotes] ${lote.id}: intento ${intento} falló (${e.message})${transitorio ? " · reintentable" : " · definitivo"}`);
        if (e.definitivo || !transitorio || intento === intentosMax) break;
        await dormir(esperaProgresiva(intento, baseMs, techoMs));
      }
    }
    return {
      exito: false,
      ms: ahora() - inicioMs,
      definitivo: !!ultimoError.definitivo,
      mensaje: String(ultimoError && ultimoError.message || "error desconocido").slice(0, 300)
    };
  }

  /**
   * Ejecuta la corrida. Puede devolver:
   *   COMPLETADO        todos los lotes verificados (incluye si ya lo estaba)
   *   PARCIAL           se agotó el presupuesto y quedan lotes; la próxima sigue
   *   FALLIDO           algún lote falló de forma definitiva
   *   OMITIDO           otro proceso tiene el cerrojo
   */
  async function ejecutar(opciones = {}) {
    const presupuesto = opciones.presupuestoMs || presupuestoMs;
    const corrida = opciones.corrida || corridaDeFecha(opciones.fecha);
    const inicioCorrida = ahora();

    const cerrojo = await lock.adquirir(opciones.duracionCerrojoMs || 15 * 60 * 1000);
    if (!cerrojo.ok) {
      log("[backup-lotes] omitido:", cerrojo.motivo);
      return { estado: "OMITIDO", motivo: cerrojo.motivo, corrida };
    }

    try {
      /* 1) Plan del día: todas las colecciones raíz que existan AHORA. */
      const colecciones = await listarColecciones();
      if (!Array.isArray(colecciones) || !colecciones.length) {
        throw errorConEstado(500, "No se pudo leer la lista de colecciones de Firestore.", { definitivo: true });
      }
      const plan = planear(colecciones, porLote);

      /* 2) Estado previo de la corrida (permite reanudar). */
      const previo = (await estado.leer(corrida)) || { lotes: {} };
      const lotesEstado = { ...(previo.lotes || {}) };

      /* Un lote nuevo aparece si alguien creó una colección desde la última
         ejecución: se añade como pendiente en lugar de quedarse fuera del
         respaldo sin que nadie lo note. */
      let nuevos = 0;
      for (const lote of plan.lotes) {
        if (!lotesEstado[lote.id]) {
          lotesEstado[lote.id] = { estado: "PENDIENTE", colecciones: lote.colecciones };
          nuevos++;
        }
      }

      const pendientes = plan.lotes.filter((l) => (lotesEstado[l.id] || {}).estado !== "COMPLETADO");
      if (!pendientes.length) {
        const resumen = resumir(plan.lotes, lotesEstado, corrida);
        log("[backup-lotes] la corrida ya estaba completa", resumen);
        await lock.liberar("COMPLETADO");
        return { ...resumen, estado: "COMPLETADO", yaEstaba: true, corrida };
      }

      /* 3) Ejecución con presupuesto: nunca se arranca un lote si no queda
         margen suficiente para el más lento observado. */
      const procesados = [];
      let fallidos = [];
      for (const lote of pendientes) {
        const transcurrido = ahora() - inicioCorrida;
        if (transcurrido >= presupuesto) {
          log("[backup-lotes] presupuesto agotado, quedan", pendientes.length - procesados.length, "lotes");
          break;
        }
        log(`[backup-lotes] ${lote.id} (${lote.colecciones.join(", ")})`);
        const r = await ejecutarLote(lote, `daily/${corrida}`);
        lotesEstado[lote.id] = r.exito
          ? { estado: "COMPLETADO", uri: r.uri, objetos: r.objetos, ms: r.ms, colecciones: lote.colecciones, cuando: new Date(ahora()).toISOString() }
          : { estado: r.definitivo ? "FALLIDO_DEFINITIVO" : "FALLIDO", mensaje: r.mensaje, ms: r.ms, colecciones: lote.colecciones, cuando: new Date(ahora()).toISOString() };
        procesados.push(r);
        if (!r.exito) fallidos.push({ lote: lote.id, mensaje: r.mensaje, definitivo: r.definitivo });
        /* Se guarda el progreso DESPUÉS de cada lote: si la función muere de
           golpe en el siguiente, este ya está registrado. */
        await estado.guardar(corrida, {
          corrida,
          lotes: lotesEstado,
          actualizadoEn: new Date(ahora()).toISOString(),
          presupuestoMs: presupuesto,
          porLote
        });
        if (r.definitivo) break;
      }

      const resumen = resumir(plan.lotes, lotesEstado, corrida);
      const todos = resumen.completadas === resumen.total && resumen.total > 0;
      const definitivoFallido = fallidos.some((f) => f.definitivo);

      if (todos) {
        await lock.liberar("COMPLETADO");
        log("[backup-lotes] corrida COMPLETADA", resumen);
        return { ...resumen, estado: "COMPLETADO", corrida, nuevos, fallidos, msTotal: ahora() - inicioCorrida };
      }
      await lock.liberar(definitivoFallido ? "FALLIDO" : "PARCIAL");
      const estadoFinal = definitivoFallido ? "FALLIDO" : "PARCIAL";
      log(`[backup-lotes] corrida ${estadoFinal}`, resumen);
      return {
        ...resumen,
        estado: estadoFinal,
        corrida,
        nuevos,
        fallidos,
        pendientes: resumen.total - resumen.completadas,
        msTotal: ahora() - inicioCorrida,
        requiereAlerta: definitivoFallido
      };
    } catch (e) {
      await lock.liberar("ERROR_INTERNO");
      throw e;
    }
  }

  function resumir(lotesPlan, lotesEstado, corrida) {
    const total = lotesPlan.length;
    const completadas = lotesPlan.filter((l) => (lotesEstado[l.id] || {}).estado === "COMPLETADO").length;
    const objetos = Object.values(lotesEstado).reduce((t, l) => t + (Number(l.objetos) || 0), 0);
    const tiempos = Object.entries(lotesEstado)
      .filter(([, v]) => v.estado === "COMPLETADO" && Number(v.ms) > 0)
      .map(([id, v]) => ({ lote: id, ms: v.ms }))
      .sort((a, b) => b.ms - a.ms);
    return {
      corrida,
      total,
      completadas,
      objetos,
      masLento: tiempos[0] || null,
      prefijo: `daily/${corrida}`,
      detalle: lotesPlan.map((l) => ({
        lote: l.id,
        colecciones: l.colecciones,
        estado: (lotesEstado[l.id] || {}).estado || "PENDIENTE",
        objetos: (lotesEstado[l.id] || {}).objetos || 0,
        ms: (lotesEstado[l.id] || {}).ms || 0
      }))
    };
  }

  return { ejecutar, exportarLote, ejecutarLote, resumir, plan: (c) => planear(c, porLote) };
}

module.exports = {
  COLECCION_ESTADO,
  DOC_CERROJO,
  COLECCION_CONFIG,
  corridaDeFecha,
  segmento,
  planear,
  crearBackupPorLotes
};
