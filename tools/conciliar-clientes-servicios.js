'use strict';
/* ============================================================
 * UneFibra SAS — Conciliación de clientes y servicios (KZ-UNEF-005)
 * ------------------------------------------------------------
 * Responde UNA pregunta antes de tocar nada: ¿qué representa cada registro
 * y cuál es la fuente de verdad?
 *
 * MODO POR DEFECTO: SIMULACIÓN. No escribe absolutamente nada.
 * Para escribir haría falta `--aplicar --confirmo-clientes-revisados`, y
 * además escribe solo con el plan aprobado y deja marca de origen para poder
 * revertir. En esta misión NO se ejecuta esa vía.
 *
 * No imprime datos personales: nombres y teléfonos no se leen; los informes
 * llevan identificadores de documento y agregados.
 *
 * Uso:
 *   node tools/conciliar-clientes-servicios.js                 # simulación
 *   node tools/conciliar-clientes-servicios.js --json salida.json
 *
 * Requiere sesión de `firebase login` (tools/lib/google-auth.js).
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("./lib/google-auth");
const { servicioEsperadoParaCliente } = require("../functions/src/estados");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

const ESTADOS_CLIENTE = ["ACTIVO", "PENDIENTE_PAGO", "SUSPENDIDO", "INACTIVO"];
const ESTADOS_SERVICIO = ["ACTIVO", "POR_VENCER", "SUSPENDIDO", "INACTIVO"];
const ESTADOS_PAGO = ["PENDIENTE", "CONFIRMADO", "ANULADO"];

/* Clasificación final de cada cliente para la regularización. */
const CLASE = {
  CON_SERVICIO_OK: "CON_SERVICIO_OK",                 // ya tiene su servicio y es coherente
  CON_SERVICIO_INCOHERENTE: "CON_SERVICIO_INCOHERENTE", // tiene servicio pero no cuadra con el cliente
  CANDIDATO_AUTOMATICO: "CANDIDATO_AUTOMATICO",       // sin servicio y con datos completos: migración segura
  REQUIERE_REVISION: "REQUIERE_REVISION",             // sin servicio y datos dudosos
  INCOMPLETO: "INCOMPLETO",                           // sin servicio y sin datos para crearlo
  HISTORICO: "HISTORICO",                             // retirado/inactivo: no se le crea servicio
  AMBIGUO: "AMBIGUO"                                  // más de un servicio: prohibido automatizar
};

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

/** IPv4 completa normalizada, o null. */
function normalizarIp(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().replace(/\/\d+$/, "");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return null;
  const p = t.split(".").map(Number);
  if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return p.join(".");
}

function fechaValida(f) {
  return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f);
}

async function listar(token, coleccion, campos) {
  const salida = [];
  let pageToken = "";
  do {
    const url = `${BASE}:runQuery`;
    const cuerpo = {
      structuredQuery: {
        from: [{ collectionId: coleccion }],
        ...(campos.length ? { select: { fields: campos.map((f) => ({ fieldPath: f })) } } : {}),
        /* Orden explícito por nombre de documento: sin él, un cursor de
           paginación no es válido cuando la consulta lleva `select`. */
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        limit: 300
      }
    };
    if (pageToken) cuerpo.structuredQuery.startAt = { values: [{ referenceValue: pageToken }], before: false };
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Consulta de ${coleccion} falló (${r.status}): ${txt.slice(0, 200)}`);
    const filas = JSON.parse(txt);
    const docs = (Array.isArray(filas) ? filas : []).filter((x) => x.document).map((x) => ({
      id: x.document.name.split("/").pop(),
      campos: Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, val(v)]))
    }));
    salida.push(...docs);
    pageToken = docs.length
      ? `projects/${PROYECTO}/databases/(default)/documents/${coleccion}/${docs[docs.length - 1].id}`
      : "";
    if (docs.length < 300) break;
  } while (pageToken);
  return salida;
}

(async () => {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
  const aplicar = args.includes("--aplicar");
  const confirmado = args.includes("--confirmo-clientes-revisados");

  console.log("==============================================================");
  console.log(" CONCILIACIÓN CLIENTES ↔ SERVICIOS — UneFibra");
  console.log(` modo: ${aplicar ? (confirmado ? "APLICAR (escritura)" : "APLICAR sin confirmación (se niega)") : "SIMULACIÓN (sin escrituras)"}`);
  console.log("==============================================================");

  if (aplicar && !confirmado) {
    console.log("\nSe pidió --aplicar sin --confirmo-clientes-revisados. No se escribe nada.");
    process.exit(2);
  }

  const token = await tokenAcceso();

  const clientes = await listar(token, "clientes", [
    "estadoCliente", "estadoServicio", "planId", "precioMensual",
    "fechaInicioServicio", "fechaVencimiento", "cicloCorte", "proximoCorte", "ip", "activo"
  ]);
  const servicios = await listar(token, "servicios", ["clienteId", "estado", "fechaVencimiento", "planId", "ip", "origen"]);
  const pagos = await listar(token, "pagos", ["clienteId", "estado", "periodoFin"]);

  const idsClientes = new Set(clientes.map((c) => c.id));
  const serviciosPorCliente = new Map();
  for (const s of servicios) {
    const id = s.campos.clienteId;
    if (!id) continue;
    if (!serviciosPorCliente.has(id)) serviciosPorCliente.set(id, []);
    serviciosPorCliente.get(id).push(s);
  }

  /* ── Análisis por cliente ── */
  const clases = Object.fromEntries(Object.values(CLASE).map((k) => [k, []]));
  const ipPorCliente = new Map();
  let conDatosCompletos = 0, conDatosParciales = 0, sinDatos = 0;

  for (const c of clientes) {
    const f = c.campos;
    const propios = serviciosPorCliente.get(c.id) || [];
    const ip = normalizarIp(f.ip);
    if (ip) {
      if (!ipPorCliente.has(ip)) ipPorCliente.set(ip, []);
      ipPorCliente.get(ip).push(c.id);
    }
    const estadoCliente = f.estadoCliente || null;
    const retirado = estadoCliente === "INACTIVO";

    const tienePlan = !!f.planId;
    const tienePrecio = typeof f.precioMensual === "number" && f.precioMensual > 0;
    const tieneVencimiento = fechaValida(f.fechaVencimiento);
    const completo = tienePlan && tienePrecio && tieneVencimiento;
    if (completo) conDatosCompletos++;
    else if (tienePlan || tienePrecio || tieneVencimiento) conDatosParciales++;
    else sinDatos++;

    let clase;
    if (propios.length > 1) clase = CLASE.AMBIGUO;
    else if (propios.length === 1) {
      const s = propios[0].campos;
      const cohere = (!s.fechaVencimiento || s.fechaVencimiento === f.fechaVencimiento)
        && ESTADOS_SERVICIO.includes(s.estado || "");
      clase = cohere ? CLASE.CON_SERVICIO_OK : CLASE.CON_SERVICIO_INCOHERENTE;
    } else if (retirado) clase = CLASE.HISTORICO;
    else if (completo) clase = CLASE.CANDIDATO_AUTOMATICO;
    else if (tienePlan || tienePrecio || tieneVencimiento) clase = CLASE.REQUIERE_REVISION;
    else clase = CLASE.INCOMPLETO;

    clases[clase].push({
      id: c.id,
      estadoCliente,
      estadoServicio: f.estadoServicio || null,
      estadoFueraDeModelo: estadoCliente && !ESTADOS_CLIENTE.includes(estadoCliente),
      servicios: propios.length,
      ip: ip || (f.ip ? "(inválida)" : null),
      tienePlan, tienePrecio, tieneVencimiento,
      planId: f.planId || null,
      precioMensual: typeof f.precioMensual === "number" ? f.precioMensual : null,
      inicio: fechaValida(f.fechaInicioServicio) ? f.fechaInicioServicio : null,
      vencimiento: f.fechaVencimiento || null
    });
  }

  /* ── Servicios huérfanos y duplicados ── */
  const huerfanos = servicios.filter((s) => !s.campos.clienteId || !idsClientes.has(s.campos.clienteId));
  const duplicados = [...serviciosPorCliente.entries()].filter(([, l]) => l.length > 1).map(([id, l]) => ({ clienteId: id, cantidad: l.length }));
  const ipsDuplicadas = [...ipPorCliente.entries()].filter(([, l]) => l.length > 1).map(([ip, l]) => ({ ip, clientes: l.length }));

  /* ── Estados fuera del modelo ── */
  const clientesEstadoRaro = clientes.filter((c) => c.campos.estadoCliente && !ESTADOS_CLIENTE.includes(c.campos.estadoCliente));
  const serviciosEstadoRaro = servicios.filter((s) => s.campos.estado && !ESTADOS_SERVICIO.includes(s.campos.estado));
  const pagosEstadoRaro = pagos.filter((p) => p.campos.estado && !ESTADOS_PAGO.includes(p.campos.estado));

  /* ── Fechas incoherentes y precios inválidos ── */
  const fechaIncoherente = clientes.filter((c) => {
    const ini = c.campos.fechaInicioServicio, ven = c.campos.fechaVencimiento;
    return fechaValida(ini) && fechaValida(ven) && ven < ini;
  });
  const precioInvalido = clientes.filter((c) => c.campos.precioMensual !== undefined && c.campos.precioMensual !== null
    && (typeof c.campos.precioMensual !== "number" || c.campos.precioMensual <= 0));

  const sinIp = clientes.filter((c) => !normalizarIp(c.campos.ip));

  /* ── Informe ── */
  const L = [];
  const log = (t) => { console.log(t); L.push(t); };

  log("");
  log("── INVENTARIO REAL ──────────────────────────────────────────");
  log(`  clientes   : ${clientes.length}`);
  log(`  servicios  : ${servicios.length}`);
  log(`  pagos      : ${pagos.length}`);
  log(`  clientes con algún servicio : ${serviciosPorCliente.size}`);
  log(`  clientes SIN servicio       : ${clientes.length - serviciosPorCliente.size}`);

  log("");
  log("── QUÉ DATO TIENE CADA CLIENTE ──────────────────────────────");
  log(`  con plan + precio + vencimiento : ${conDatosCompletos}`);
  log(`  con datos parciales             : ${conDatosParciales}`);
  log(`  sin datos de servicio           : ${sinDatos}`);
  log(`  con IP válida                   : ${clientes.length - sinIp.length}`);
  log(`  sin IP o IP inválida            : ${sinIp.length}`);

  log("");
  log("── CLASIFICACIÓN PARA LA REGULARIZACIÓN ─────────────────────");
  for (const [k, l] of Object.entries(clases)) {
    log(`  ${k.padEnd(24)} ${l.length}`);
  }

  log("");
  log("── PROBLEMAS DETECTADOS ─────────────────────────────────────");
  log(`  servicios huérfanos (clienteId inexistente o vacío) : ${huerfanos.length}`);
  log(`  clientes con más de un servicio                     : ${duplicados.length}`);
  log(`  IP duplicada entre clientes                         : ${ipsDuplicadas.length}`);
  log(`  clientes con estado fuera del modelo                : ${clientesEstadoRaro.length}`);
  log(`  servicios con estado fuera del modelo               : ${serviciosEstadoRaro.length}`);
  log(`  pagos con estado fuera del modelo                   : ${pagosEstadoRaro.length}`);
  log(`  vencimiento anterior al inicio de servicio          : ${fechaIncoherente.length}`);
  log(`  precioMensual inválido (0, negativo o no numérico)  : ${precioInvalido.length}`);

  if (clientesEstadoRaro.length) {
    log("");
    log("  Estados de cliente fuera del modelo (detalle):");
    for (const c of clientesEstadoRaro.slice(0, 10)) log(`    - ${c.id} → "${c.campos.estadoCliente}"`);
  }
  if (duplicados.length) {
    log("");
    log("  Clientes con servicios duplicados (no se tocan):");
    for (const d of duplicados.slice(0, 10)) log(`    - ${d.clienteId} → ${d.cantidad} servicios`);
  }
  if (ipsDuplicadas.length) {
    log("");
    log("  IP duplicadas (bloquean cualquier acción automática):");
    for (const d of ipsDuplicadas.slice(0, 10)) log(`    - ${d.ip} → ${d.clientes} clientes`);
  }
  if (huerfanos.length) {
    log("");
    log("  Servicios huérfanos:");
    for (const h of huerfanos.slice(0, 10)) log(`    - servicio ${h.id} → clienteId "${h.campos.clienteId || "(vacío)"}"`);
  }

  log("");
  log("── PLAN DE REGULARIZACIÓN (simulación) ──────────────────────");
  log(`  a crear automáticamente ${clases[CLASE.CANDIDATO_AUTOMATICO].length} servicios,`);
  log(`  ${clases[CLASE.REQUIERE_REVISION].length} a revisar a mano,`);
  log(`  ${clases[CLASE.INCOMPLETO].length} registros incompletos (no se tocan),`);
  log(`  ${clases[CLASE.HISTORICO].length} históricos (no se tocan),`);
  log(`  ${clases[CLASE.AMBIGUO].length} ambiguos (prohibido automatizar).`);

  /* ── Escritura controlada ─────────────────────────────────────────────
     Solo se ejecuta con --aplicar --confirmo-clientes-revisados y SOLO sobre
     los CANDIDATO_AUTOMATICO. Cada documento lleva `origen` para poder
     revertir exactamente lo creado, sin tocar los 5 servicios previos. */
  const MARCA = "backfill-kz-unef-005";

  if (aplicar) {
    log("");
    log(`── APLICANDO (marca "${MARCA}") ──────────────────────────────`);
    const h = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    let creados = 0, yaExistian = 0, errores = 0;

    for (const c of clases[CLASE.CANDIDATO_AUTOMATICO]) {
      const docId = `svc-${c.id}`;                 // id determinista → idempotente
      const cuerpo = {
        fields: {
          clienteId: { stringValue: c.id },
          planId: { stringValue: String(c.planId || "") },
          estado: { stringValue: servicioEsperadoParaCliente(c.estadoCliente) },
          fechaInicioServicio: { stringValue: c.inicio || c.vencimiento },
          fechaVencimiento: { stringValue: c.vencimiento },
          precioMensual: { integerValue: String(c.precioMensual || 0) },
          origen: { stringValue: MARCA },
          creadoEn: { timestampValue: new Date().toISOString() }
        }
      };
      const r = await fetch(`${BASE}/servicios?documentId=${encodeURIComponent(docId)}`, {
        method: "POST", headers: h, body: JSON.stringify(cuerpo)
      });
      if (r.ok) { creados++; log(`  + ${docId}`); }
      else if (r.status === 409) { yaExistian++; }
      else { errores++; log(`  ! ${docId} → HTTP ${r.status}`); }
    }
    log(`  creados=${creados} · ya existían=${yaExistian} · errores=${errores}`);
    log(`  Para revertir exactamente esto: node tools/conciliar-clientes-servicios.js --revertir --confirmo-revertir`);
  } else {
    log("");
    log("  NADA SE HA ESCRITO. Este informe es una simulación.");
    if (clases[CLASE.CANDIDATO_AUTOMATICO].length) {
      log(`  Si se autorizara, crearía ${clases[CLASE.CANDIDATO_AUTOMATICO].length} documentos`);
      log(`  en "servicios" con id "svc-<clienteId>" y marca "${MARCA}".`);
    }
  }

  /* ── Reversión controlada ─────────────────────────────────────────────
     Borra SOLO los servicios creados por esta herramienta (marca `origen`).
     Los 5 servicios que ya existían no llevan la marca y no se tocan nunca. */
  if (args.includes("--revertir")) {
    const h = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const q = {
      structuredQuery: {
        from: [{ collectionId: "servicios" }],
        where: { fieldFilter: { field: { fieldPath: "origen" }, op: "EQUAL", value: { stringValue: MARCA } } },
        limit: 500
      }
    };
    const r = await fetch(`${BASE}:runQuery`, { method: "POST", headers: h, body: JSON.stringify(q) });
    const filas = (await r.json()).filter((x) => x.document);
    const ids = filas.map((x) => x.document.name.split("/").pop());
    log("");
    log(`── REVERSIÓN: ${ids.length} servicio(s) con marca "${MARCA}" ──`);
    if (!ids.length) log("  nada que revertir");
    else if (!args.includes("--confirmo-revertir")) {
      log("  SIMULACIÓN: se borrarían estos documentos (añade --confirmo-revertir para hacerlo):");
      for (const id of ids.slice(0, 20)) log("    - " + id);
    } else {
      let borrados = 0;
      for (const id of ids) {
        const del = await fetch(`${BASE}/servicios/${id}`, { method: "DELETE", headers: h });
        if (del.ok) borrados++;
      }
      log(`  borrados=${borrados} de ${ids.length}`);
    }
  }

  if (jsonOut) {
    const detalle = {
      fecha: new Date().toISOString(),
      proyecto: PROYECTO,
      inventario: { clientes: clientes.length, servicios: servicios.length, pagos: pagos.length },
      datos: { completos: conDatosCompletos, parciales: conDatosParciales, sinDatos, sinIp: sinIp.length },
      clases: Object.fromEntries(Object.entries(clases).map(([k, l]) => [k, l.map((x) => x.id)])),
      problemas: {
        huerfanos: huerfanos.map((h) => h.id),
        duplicados,
        ipsDuplicadas,
        clientesEstadoRaro: clientesEstadoRaro.map((c) => ({ id: c.id, estado: c.campos.estadoCliente })),
        fechaIncoherente: fechaIncoherente.map((c) => c.id),
        precioInvalido: precioInvalido.map((c) => c.id)
      }
    };
    fs.writeFileSync(jsonOut, JSON.stringify(detalle, null, 2), "utf8");
    console.log(`\n  detalle técnico guardado en ${jsonOut}`);
  }

  fs.writeFileSync(path.resolve(__dirname, "..", "docs", "CONCILIACION-ULTIMA-EJECUCION.txt"),
    L.join("\n") + "\n", "utf8");
  console.log("\n  resumen guardado en docs/CONCILIACION-ULTIMA-EJECUCION.txt");
  process.exit(0);
})().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
