'use strict';
/* ============================================================
 * UneFibra SAS — Conciliación de FECHAS de los servicios migrados
 * ------------------------------------------------------------
 * KZ-UNEF-028 · Qué hace y qué NO hace
 *
 *   HACE: leer los servicios en conciliación y decir, registro por registro, si
 *         su fecha de vencimiento está respaldada por evidencia o si hace falta
 *         que el propietario la confirme. Deja un informe (JSON + CSV) para
 *         revisar en Excel y una lista de preguntas concretas.
 *
 *   NO HACE: escribir en Firestore, generar cobros, suspender clientes, inventar
 *            fechas ni tocar el estado de conciliación. Es SOLO LECTURA y lo dice
 *            al terminar. Aplicar una corrección sigue siendo un acto manual y
 *            autorizado mediante `corregirVencimientoContractual`.
 *
 * Uso:
 *   node tools/conciliar-fechas.js --emulador          # emulador local (pruebas)
 *   node tools/conciliar-fechas.js                     # producción, SOLO LECTURA
 *   node tools/conciliar-fechas.js --salida C:\ruta --limite 500 --muestra 20
 *
 * En producción requiere `firebase login` (tools/lib/google-auth.js).
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const { clasificarServicio, resumirClasificaciones, CLASES } = require("../functions/src/conciliacion-fechas");

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = argumentos.indexOf("--" + nombre);
  if (i === -1) return porDefecto;
  const v = argumentos[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const EMULADOR = argumentos.includes("--emulador");
const PROYECTO = EMULADOR ? "demo-unefibra" : "une-fibra";
const HOST = EMULADOR ? "http://127.0.0.1:8080" : "https://firestore.googleapis.com";
const BASE = `${HOST}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const LIMITE = Number(opcion("limite", 1000)) || 1000;
const MUESTRA = Number(opcion("muestra", 15)) || 15;
const SALIDA = String(opcion("salida", path.join(process.cwd(), "conciliacion-fechas")));
const HOY = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);

const val = (campo) => {
  if (!campo) return null;
  if (campo.stringValue !== undefined) return campo.stringValue;
  if (campo.integerValue !== undefined) return Number(campo.integerValue);
  if (campo.doubleValue !== undefined) return Number(campo.doubleValue);
  if (campo.booleanValue !== undefined) return campo.booleanValue;
  if (campo.timestampValue !== undefined) return campo.timestampValue;
  if (campo.nullValue !== undefined) return null;
  if (campo.arrayValue) return (campo.arrayValue.values || []).map(val);
  if (campo.mapValue) return Object.fromEntries(Object.entries(campo.mapValue.fields || {}).map(([k, v]) => [k, val(v)]));
  return null;
};
const desDoc = (doc) => ({ id: doc.name.split("/").pop(), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)])) });

async function token() {
  if (EMULADOR) return "owner";
  const { tokenAcceso } = require("./lib/google-auth");
  return tokenAcceso();
}

async function consultar(coleccion, filtros = [], limite = LIMITE) {
  const donde = Object.entries(filtros).map(([campo, valor]) => ({
    fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: { stringValue: String(valor) } }
  }));
  const consulta = { from: [{ collectionId: coleccion }], limit: limite };
  if (donde.length === 1) consulta.where = donde[0];
  else if (donde.length > 1) consulta.where = { compositeFilter: { op: "AND", filters: donde } };
  const t = await token();
  const r = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
    body: JSON.stringify({ structuredQuery: consulta })
  });
  if (r.status === 401 || r.status === 403) {
    throw new Error("Sin permiso para leer Firestore (" + r.status + "). En producción hace falta `firebase login`.");
  }
  if (!r.ok) throw new Error("La consulta a " + coleccion + " falló (" + r.status + "): " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  return arr.filter((x) => x && x.document).map((x) => desDoc(x.document));
}

const csvCampo = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

(async () => {
  console.log("=== Conciliación de FECHAS de servicios migrados ===");
  console.log("  destino   : " + PROYECTO + (EMULADOR ? " (emulador local)" : " (producción, SOLO LECTURA)"));
  console.log("  modo      : " + (EMULADOR ? "emulador" : "producción") + " · no se escribe nada");
  console.log("  fecha     : " + HOY);

  /* 1) Servicios en conciliación. */
  const servicios = await consultar("servicios", { "conciliacion.estado": "PENDIENTE_VALIDACION" });
  if (!servicios.length && !EMULADOR) {
    /* Producción también puede tenerlos con otro nombre de estado: se avisa en vez
       de afirmar que no hay nada. */
    console.log("  aviso     : no se encontraron servicios con conciliacion.estado = PENDIENTE_VALIDACION.");
  }
  console.log("  servicios en conciliación: " + servicios.length);

  /* 2) Clientes y pagos confirmados (una lectura de cada, agrupadas en memoria). */
  const clientes = await consultar("clientes", {}, LIMITE);
  const pagos = await consultar("pagos", { estado: "CONFIRMADO" }, LIMITE);
  const clientePorId = new Map(clientes.map((c) => [c.id, c]));
  const pagosPorCliente = new Map();
  for (const p of pagos) {
    if (!p.clienteId) continue;
    if (!pagosPorCliente.has(p.clienteId)) pagosPorCliente.set(p.clienteId, []);
    pagosPorCliente.get(p.clienteId).push(p);
  }
  console.log("  clientes leídos: " + clientes.length + " · pagos confirmados: " + pagos.length);

  /* 3) Clasificación. */
  const filas = servicios.map((sv) => {
    const cli = clientePorId.get(sv.clienteId) || null;
    const clasificacion = clasificarServicio({
      fechaVencimiento: sv.fechaVencimiento || (cli && cli.fechaVencimiento) || null,
      ciclo: (cli && cli.cicloCorte) || null,
      fechaInicioServicio: sv.fechaInicio || sv.fechaInstalacion || (cli && (cli.fechaInicioServicio || cli.fechaInstalacion)) || null,
      precioMensual: sv.precioMensual !== undefined && sv.precioMensual !== null ? sv.precioMensual : (cli ? cli.precioMensual : null),
      pagos: pagosPorCliente.get(sv.clienteId) || []
    });
    return {
      servicioId: sv.id,
      clienteId: sv.clienteId || null,
      fechaActual: clasificacion.detalle.fechaActual,
      ciclo: clasificacion.detalle.ciclo,
      inicioServicio: clasificacion.detalle.fechaInicioServicio,
      precioMensual: clasificacion.detalle.precioMensual,
      pagosConfirmados: clasificacion.detalle.pagosConfirmados,
      clase: clasificacion.clase,
      fuente: clasificacion.fuente,
      fechaPropuesta: clasificacion.fechaPropuesta,
      motivos: clasificacion.motivos,
      pregunta: clasificacion.pregunta
    };
  });

  const resumen = resumirClasificaciones(filas.map((f) => ({ clase: f.clase, motivos: f.motivos })));

  /* 4) Informe en disco. */
  fs.mkdirSync(SALIDA, { recursive: true });
  const base = "conciliacion-fechas-" + HOY;
  const rutaJson = path.join(SALIDA, base + ".json");
  const rutaCsv = path.join(SALIDA, base + ".csv");
  fs.writeFileSync(rutaJson, JSON.stringify({
    generado: new Date().toISOString(),
    proyecto: PROYECTO,
    modo: EMULADOR ? "emulador" : "produccion",
    soloLectura: true,
    hoy: HOY,
    resumen,
    filas
  }, null, 1));

  const cabecera = ["servicioId", "clienteId", "clase", "fechaActual", "fechaPropuesta", "fuente", "ciclo", "inicioServicio", "precioMensual", "pagosConfirmados", "motivos", "preguntaParaElPropietario"];
  const lineas = [cabecera.join(";")].concat(filas.map((f) => [
    f.servicioId, f.clienteId, f.clase, f.fechaActual, f.fechaPropuesta, f.fuente, f.ciclo,
    f.inicioServicio, f.precioMensual, f.pagosConfirmados, (f.motivos || []).join(" | "), f.pregunta
  ].map(csvCampo).join(";")));
  fs.writeFileSync(rutaCsv, lineas.join("\r\n"), "utf8");

  /* 5) Resumen en pantalla. */
  console.log("\n=== Resultado ===");
  console.log("  CONFIABLES                  : " + resumen.confiables);
  console.log("  CON PROPUESTA DE LOS PAGOS  : " + resumen.propuestas + "  (la fecha sale de pagos confirmados; falta el visto bueno)");
  console.log("  REQUIEREN CONFIRMACIÓN      : " + resumen.requierenConfirmacion + "  (no se propone ninguna fecha)");
  if (resumen.motivosFrecuentes.length) {
    console.log("\n  Motivos más frecuentes:");
    for (const [motivo, n] of resumen.motivosFrecuentes) console.log("    " + String(n).padStart(4) + "  " + motivo);
  }

  const conPregunta = filas.filter((f) => f.pregunta).slice(0, MUESTRA);
  if (conPregunta.length) {
    console.log("\n  Preguntas para el propietario (primeras " + conPregunta.length + "):");
    for (const f of conPregunta) console.log("    · [" + f.servicioId + "] " + f.pregunta);
  }

  console.log("\n  Informe: " + rutaJson);
  console.log("  CSV    : " + rutaCsv);
  console.log("\n  NO se ha modificado ningún dato. Nada de esto cobra ni suspende:");
  console.log("  son propuestas para revisar. Aplicarlas es un acto manual autorizado.");
})().catch((e) => {
  console.error("\nERROR: " + e.message);
  process.exit(1);
});
