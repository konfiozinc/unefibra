'use strict';
/* ============================================================
 * UneFibra SAS — Migración de servicios (KZ-UNEF-006)
 * ------------------------------------------------------------
 * Crea los documentos de `servicios` que faltan para los clientes que ya
 * tienen sus datos completos. Cada documento nace en CONCILIACIÓN PENDIENTE,
 * así que ninguna automatización lo toca hasta que una persona lo valide.
 *
 * MODO POR DEFECTO: SIMULACIÓN. No escribe nada.
 * Escribir exige DOS banderas: --aplicar --confirmo-clientes-revisados.
 *
 * Uso:
 *   node tools/migrar-servicios.js                      # simulación
 *   node tools/migrar-servicios.js --json manifiesto.json
 *   node tools/migrar-servicios.js --aplicar --confirmo-clientes-revisados [--limite N]
 *   node tools/migrar-servicios.js --verificar           # comprueba asociaciones
 *   node tools/migrar-servicios.js --revertir            # simula la vuelta atrás
 *   node tools/migrar-servicios.js --revertir --confirmo-revertir
 *
 * Idempotente: el id del documento es `svc-<clienteId>`. Reejecutar no duplica
 * y, si se interrumpe, se reanuda solo volviendo a lanzarlo.
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("./lib/google-auth");
const {
  REFERENCIA,
  idServicioPara,
  evaluarCandidato,
  construirServicio,
  puedeRevertirse
} = require("../functions/src/migracion");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const LOG_LOCAL = path.resolve(__dirname, "..", "docs", "MIGRACION-KZ-UNEF-006-LOG.txt");

const val = (c) => c === undefined ? undefined
  : c.stringValue !== undefined ? c.stringValue
  : c.integerValue !== undefined ? Number(c.integerValue)
  : c.doubleValue !== undefined ? Number(c.doubleValue)
  : c.booleanValue !== undefined ? c.booleanValue
  : c.nullValue !== undefined ? null
  : c.arrayValue ? (c.arrayValue.values || []).map(val)
  : c.mapValue ? Object.fromEntries(Object.entries(c.mapValue.fields || {}).map(([k, v]) => [k, val(v)]))
  : null;

const aCampos = (obj) => {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === "number") f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === "boolean") f[k] = { booleanValue: v };
    else if (typeof v === "string") f[k] = { stringValue: v };
    else if (typeof v === "object") f[k] = { mapValue: { fields: aCampos(v) } };
    else f[k] = { stringValue: String(v) };
  }
  return f;
};

async function listar(token, coleccion, campos) {
  const salida = [];
  let cursor = "";
  do {
    const q = {
      structuredQuery: {
        from: [{ collectionId: coleccion }],
        ...(campos.length ? { select: { fields: campos.map((f) => ({ fieldPath: f })) } } : {}),
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        limit: 300
      }
    };
    if (cursor) q.structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
    const r = await fetch(`${BASE}:runQuery`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(q)
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Consulta de ${coleccion} falló (${r.status}): ${txt.slice(0, 160)}`);
    const filas = JSON.parse(txt);
    const docs = (Array.isArray(filas) ? filas : []).filter((x) => x.document).map((x) => ({
      id: x.document.name.split("/").pop(),
      ...Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, val(v)]))
    }));
    salida.push(...docs);
    cursor = docs.length ? `projects/${PROYECTO}/databases/(default)/documents/${coleccion}/${docs[docs.length - 1].id}` : "";
    if (docs.length < 300) break;
  } while (cursor);
  return salida;
}

(async () => {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const confirmado = args.includes("--confirmo-clientes-revisados");
  const verificar = args.includes("--verificar");
  const revertir = args.includes("--revertir");
  const limite = args.includes("--limite") ? Number(args[args.indexOf("--limite") + 1]) : Infinity;
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

  console.log("==============================================================");
  console.log(" MIGRACIÓN DE SERVICIOS — UNEFibra · KZ-UNEF-006");
  console.log(` modo: ${aplicar ? "APLICAR" : revertir ? "REVERTIR" : verificar ? "VERIFICAR" : "SIMULACIÓN"}`);
  console.log("==============================================================");

  if (aplicar && !confirmado) {
    console.log("\nSe pidió --aplicar sin --confirmo-clientes-revisados. NO se escribe nada.");
    process.exit(2);
  }

  const token = await tokenAcceso();
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  const clientes = await listar(token, "clientes", [
    "planId", "precioMensual", "fechaInicioServicio", "fechaVencimiento",
    "cicloCorte", "estadoCliente", "ip"
  ]);
  const servicios = await listar(token, "servicios", ["clienteId", "origen", "conciliacion", "fechaVencimiento", "precioMensual", "creadoEn"]);

  const porCliente = new Map();
  for (const s of servicios) {
    if (!s.clienteId) continue;
    porCliente.set(s.clienteId, (porCliente.get(s.clienteId) || 0) + 1);
  }

  const L = [];
  const log = (t) => { console.log(t); L.push(t); };

  /* ── Reversión ─────────────────────────────────────────────────────── */
  if (revertir) {
    const candidatos = servicios.filter((s) => s.origen === REFERENCIA);
    log(`\n── REVERSIÓN: ${candidatos.length} servicio(s) creados por esta migración ──`);
    const borrables = [], revisar = [];
    for (const s of candidatos) {
      const v = puedeRevertirse(s, { pagosAsociados: 0, fechaModificacion: null });
      (v.permitido ? borrables : revisar).push({ id: s.id, motivo: v.motivo });
    }
    log(`  borrables: ${borrables.length} · requieren revisión: ${revisar.length}`);
    for (const r of revisar.slice(0, 10)) log(`    ! ${r.id} → ${r.motivo}`);
    if (!args.includes("--confirmo-revertir")) {
      log("  SIMULACIÓN: añade --confirmo-revertir para borrar los borrables.");
    } else {
      let n = 0;
      for (const b of borrables) {
        const r = await fetch(`${BASE}/servicios/${b.id}`, { method: "DELETE", headers: H });
        if (r.ok) n++;
      }
      log(`  borrados: ${n}`);
    }
    fs.writeFileSync(LOG_LOCAL, L.join("\n") + "\n", "utf8");
    process.exit(0);
  }

  /* ── Verificación de asociaciones ──────────────────────────────────── */
  if (verificar) {
    const conServicio = new Set(servicios.map((s) => s.clienteId).filter(Boolean));
    const sinServicio = clientes.filter((c) => !conServicio.has(c.id));
    const deMigracion = servicios.filter((s) => s.origen === REFERENCIA);
    const pendientes = deMigracion.filter((s) => s.conciliacion && s.conciliacion.estado === "PENDIENTE_VALIDACION");
    const validados = deMigracion.filter((s) => s.conciliacion && s.conciliacion.estado === "VALIDADA");
    log(`\n── VERIFICACIÓN ──`);
    log(`  clientes: ${clientes.length} · servicios: ${servicios.length}`);
    log(`  clientes sin servicio: ${sinServicio.length}`);
    log(`  servicios creados por la migración: ${deMigracion.length}`);
    log(`    · pendientes de validación: ${pendientes.length}`);
    log(`    · ya validados: ${validados.length}`);
    fs.writeFileSync(LOG_LOCAL, L.join("\n") + "\n", "utf8");
    process.exit(0);
  }

  /* ── Simulación / aplicación ───────────────────────────────────────── */
  const manifiesto = { generado: new Date().toISOString(), referencia: REFERENCIA, migrables: [], omitidos: [], revision: [], errores: [] };

  for (const c of clientes) {
    const evaluacion = evaluarCandidato(c, { serviciosExistentes: porCliente.get(c.id) || 0 });
    if (!evaluacion.apto) {
      const destino = evaluacion.clase === "OMITIDO_YA_TIENE_SERVICIO" ? manifiesto.omitidos : manifiesto.revision;
      destino.push({ clienteId: c.id, motivos: evaluacion.motivos });
      continue;
    }
    let doc;
    try {
      doc = construirServicio(c, { serviciosExistentes: 0 });
    } catch (e) {
      manifiesto.errores.push({ clienteId: c.id, motivo: e.message });
      continue;
    }
    manifiesto.migrables.push({ clienteId: c.id, servicioId: doc.id, planId: doc.datos.planId, estado: doc.datos.estado, vencimiento: doc.datos.fechaVencimiento, conciliacion: doc.datos.conciliacion.estado });
  }

  log(`\n── RESULTADO ──`);
  log(`  migrables        : ${manifiesto.migrables.length}`);
  log(`  omitidos (ya tienen servicio) : ${manifiesto.omitidos.length}`);
  log(`  requieren revisión            : ${manifiesto.revision.length}`);
  log(`  errores de construcción       : ${manifiesto.errores.length}`);
  log(`  todos nacen en estado         : PENDIENTE_VALIDACION (sin automatismos)`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(manifiesto, null, 2), "utf8");
    log(`\n  manifiesto guardado en ${jsonOut}`);
  }

  if (aplicar) {
    log("\n── APLICANDO ──");
    let creados = 0, yaExistian = 0, fallos = 0;
    for (const m of manifiesto.migrables.slice(0, limite)) {
      const c = clientes.find((x) => x.id === m.clienteId);
      const doc = construirServicio(c, { serviciosExistentes: 0 });
      const r = await fetch(`${BASE}/servicios?documentId=${encodeURIComponent(doc.id)}`, {
        method: "POST", headers: H, body: JSON.stringify({ fields: aCampos(doc.datos) })
      });
      if (r.ok) { creados++; log(`  + ${doc.id}`); }
      else if (r.status === 409) yaExistian++;
      else { fallos++; log(`  ! ${doc.id} → HTTP ${r.status}`); }
    }
    log(`  creados=${creados} · ya existían=${yaExistian} · fallos=${fallos}`);
  } else {
    log("\n  NADA SE HA ESCRITO. Simulación.");
    log(`  Si se autorizara, crearía ${manifiesto.migrables.length} servicios con id "svc-<clienteId>",`);
    log(`  todos en conciliación pendiente y con origen "${REFERENCIA}".`);
  }

  fs.writeFileSync(LOG_LOCAL, L.join("\n") + "\n", "utf8");
  process.exit(0);
})().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
