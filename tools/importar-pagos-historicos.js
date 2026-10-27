'use strict';
/* ============================================================
 * KZ-UNEF-021 · Importador de pagos históricos del Excel
 * ------------------------------------------------------------
 * Dos modos, y ninguno escribe en producción:
 *
 *   node tools/importar-pagos-historicos.js --datos <excel-datos.local.json>
 *        [--alcance simulacion|emulador] [--proyecto demo-unefibra]
 *        [--informe <ruta.json>]
 *
 *   simulacion  (por defecto) Lee Firestore real SOLO LECTURA, calcula las
 *               propuestas y escribe un informe en disco. Cero escrituras.
 *   emulador    Lee y escribe en el emulador local (127.0.0.1:8080). Rechaza
 *               cualquier host que no sea local: no hay forma de apuntarlo a
 *               producción ni con un flag.
 *
 * Reglas duras:
 *   · Solo hojas 1 y 2: el módulo de clasificación lanza error con otra hoja.
 *   · ID determinista (hoja+fila+período) → reejecutar no duplica: lo que ya
 *     existe devuelve 409 y se cuenta como «ya existía».
 *   · Nada nace confirmado: todo entra en `propuestas_pagos` estado PROPUESTA.
 *   · «XXXX» va a `marcas_historicas`, con la advertencia de que no es deuda.
 *   · No se transporta usuario, contraseña, MAC ni IP (el JSON de entrada ni
 *     siquiera los trae, y aquí no se piden).
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { tokenAcceso } = require('./lib/google-auth');
const P = require('./lib/pagos-historicos');
const V = require(path.join(REPO, 'functions', 'src', 'vencimientos'));

const args = process.argv.slice(2);
const arg = (n, def) => (args.includes(n) ? args[args.indexOf(n) + 1] : def);
const DATOS = arg('--datos', 'C:\\KZ-EVIDENCIA\\kz-unef-020\\excel-datos.local.json');
const ALCANCE = arg('--alcance', 'simulacion');
const PROYECTO = arg('--proyecto', 'une-fibra');
const INFORME = arg('--informe', null);
const EMULADOR = 'http://127.0.0.1:8080';

if (!['simulacion', 'emulador'].includes(ALCANCE)) {
  console.error('alcance inválido: use simulacion o emulador');
  process.exit(2);
}
/* Blindaje: el emulador es SIEMPRE local. No se acepta otro host. */
const BASE_EMULADOR = `${EMULADOR}/v1/projects/${PROYECTO}/databases/(default)/documents`;
if (!BASE_EMULADOR.startsWith('http://127.0.0.1:8080/')) {
  console.error('abortado: el alcance de escritura debe ser local');
  process.exit(2);
}

const norm = (s) => String(s == null ? '' : s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const telef = (s) => String(s || '').replace(/\D/g, ' ').split(/\s+/)
  .filter((x) => x.length >= 7).map((x) => (x.length > 10 ? x.slice(-10) : x));
const val = (c) => c === undefined ? undefined
  : c.stringValue !== undefined ? c.stringValue
  : c.integerValue !== undefined ? Number(c.integerValue)
  : c.doubleValue !== undefined ? Number(c.doubleValue)
  : c.booleanValue !== undefined ? c.booleanValue
  : c.nullValue !== undefined ? null
  : c.mapValue ? Object.fromEntries(Object.entries(c.mapValue.fields || {}).map(([k, v]) => [k, val(v)]))
  : null;

async function leerClientes(modo) {
  const out = []; let cursor = '';
  if (modo === 'emulador') {
    do {
      const q = { structuredQuery: { from: [{ collectionId: 'clientes' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 300 } };
      if (cursor) q.structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
      const r = await fetch(`${BASE_EMULADOR}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify(q) });
      const filas = JSON.parse(await r.text());
      const docs = (Array.isArray(filas) ? filas : []).filter((x) => x.document).map((x) => ({
        id: x.document.name.split('/').pop(),
        ...Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, val(v)]))
      }));
      out.push(...docs);
      cursor = docs.length ? `projects/${PROYECTO}/databases/(default)/documents/clientes/${docs[docs.length - 1].id}` : '';
      if (docs.length < 300) break;
    } while (cursor);
    return out;
  }
  const token = await tokenAcceso();
  const BASE = `https://firestore.googleapis.com/v1/projects/${P_ID}/databases/(default)/documents`;
  do {
    const q = { structuredQuery: { from: [{ collectionId: 'clientes' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 300 } };
    if (cursor) q.structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
    const r = await fetch(`${BASE}:runQuery`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
    const filas = JSON.parse(await r.text());
    const docs = (Array.isArray(filas) ? filas : []).filter((x) => x.document).map((x) => ({
      id: x.document.name.split('/').pop(),
      ...Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, val(v)]))
    }));
    out.push(...docs);
    cursor = docs.length ? `projects/${P_ID}/databases/(default)/documents/clientes/${docs[docs.length - 1].id}` : '';
    if (docs.length < 300) break;
  } while (cursor);
  return out;
}
const P_ID = PROYECTO;

/** Emparejamiento por teléfono y nombre, con la hoja como restricción suave. */
function emparejar(filas, clientes) {
  const idxTel = new Map(), idxNom = new Map();
  for (const c of clientes) {
    for (const t of new Set([...telef(c.telefono), ...telef(c.whatsapp)])) {
      if (!idxTel.has(t)) idxTel.set(t, new Set());
      idxTel.get(t).add(c.id);
    }
    const n = norm(c.nombreCompleto || c.nombre);
    if (n.length >= 6) { if (!idxNom.has(n)) idxNom.set(n, new Set()); idxNom.get(n).add(c.id); }
  }
  const porFila = new Map();
  for (const f of filas) {
    const porTel = new Set();
    for (const t of f.telefonos) for (const id of idxTel.get(t) || []) porTel.add(id);
    const porNom = idxNom.get(norm(f.nombre)) || new Set();
    const inter = [...porTel].filter((id) => porNom.has(id));
    let clienteId = null, metodo = 'SIN_CORRESPONDENCIA';
    if (inter.length === 1) { clienteId = inter[0]; metodo = 'TELEFONO_Y_NOMBRE'; }
    else if (porTel.size === 1) { clienteId = [...porTel][0]; metodo = 'TELEFONO'; }
    else if (porNom.size === 1) { clienteId = [...porNom][0]; metodo = 'NOMBRE'; }
    porFila.set(f.fila, { clienteId, metodo });
  }
  return porFila;
}

(async () => {
  console.log('=== IMPORTADOR DE PAGOS HISTÓRICOS · KZ-UNEF-021 ===');
  console.log(`  datos:   ${DATOS}`);
  console.log(`  alcance: ${ALCANCE}${ALCANCE === 'simulacion' ? ' (sin escrituras)' : ' (emulador local)'}`);

  const crudo = JSON.parse(fs.readFileSync(DATOS, 'utf8'));
  /* Doble guarda: aquí y en el módulo. */
  const intrusas = crudo.filter((f) => ![1, 2].includes(Number(f.hoja)));
  if (intrusas.length) {
    console.error(`  ABORTADO: el archivo trae ${intrusas.length} registro(s) de hojas no autorizadas (3 o 4).`);
    process.exit(3);
  }
  const filas = crudo.filter((f) => [1, 2].includes(Number(f.hoja)));
  console.log(`  registros autorizados: ${filas.length} (hojas 1 y 2)`);

  const clientes = await leerClientes(ALCANCE);
  console.log(`  clientes leídos: ${clientes.length}`);
  const emp = emparejar(filas, clientes);

  /* Filas que apuntan al mismo cliente: se marcan para revisión. */
  const cuenta = new Map();
  for (const e of emp.values()) if (e.clienteId) cuenta.set(e.clienteId, (cuenta.get(e.clienteId) || 0) + 1);
  for (const [fila, e] of emp) if (e.clienteId && cuenta.get(e.clienteId) > 1) emp.set(fila, { ...e, duplicadoDeLinea: true });

  const { propuestas, marcas, resumen, rechazadas } = P.construirPropuestas(filas, emp);
  console.log('\n=== CLASIFICACIÓN ===');
  for (const [k, v] of Object.entries(resumen)) console.log(`  ${k.padEnd(20)} ${v}`);

  /* Propuesta de vencimiento por cliente (solo lectura, sin escribir nada). */
  const ultimoPago = P.ultimoPeriodoPorCliente(propuestas);
  const clientesPorId = new Map(clientes.map((c) => [c.id, c]));
  const vencimientos = [];
  for (const [clienteId, periodo] of ultimoPago) {
    const c = clientesPorId.get(clienteId);
    if (!c) continue;
    const prop = V.proponerVencimiento({
      ultimoPeriodoPagado: periodo, ciclo: c.cicloCorte,
      fechaAlta: c.fechaInstalacion || null,
      periodosConMarcaNoPago: marcas.filter((m) => m.clienteId === clienteId).map((m) => m.periodo)
    });
    vencimientos.push({
      clienteId, ciclo: Number(c.cicloCorte), ultimoPeriodoPagado: periodo,
      vencimientoActual: c.fechaVencimiento || null, vencimientoPropuesto: prop.vencimiento,
      origen: prop.origen, motivo: prop.motivo, advertencias: prop.advertencias
    });
  }
  const conCambio = vencimientos.filter((x) => x.vencimientoActual && x.vencimientoPropuesto && x.vencimientoActual !== x.vencimientoPropuesto);
  console.log('\n=== VENCIMIENTOS PROPUESTOS (sin escribir) ===');
  console.log(`  clientes con último período pagado: ${vencimientos.length}`);
  console.log(`  con propuesta calculada:            ${vencimientos.filter((x) => x.vencimientoPropuesto).length}`);
  console.log(`  que difieren del panel:             ${conCambio.length}`);

  let escritura = { propuestas: 0, yaExistian: 0, marcas: 0, marcasYaExistian: 0, errores: 0 };
  if (ALCANCE === 'emulador') {
    console.log('\n=== ESCRITURA EN EMULADOR (127.0.0.1:8080) ===');
    const aCampos = (o) => {
      const f = {};
      for (const [k, v] of Object.entries(o)) {
        if (v === null || v === undefined) f[k] = { nullValue: null };
        else if (typeof v === 'number') f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
        else if (typeof v === 'boolean') f[k] = { booleanValue: v };
        else f[k] = { stringValue: String(v) };
      }
      return f;
    };
    const crear = async (col, id, datos) => {
      const r = await fetch(`${BASE_EMULADOR}/${col}?documentId=${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ fields: aCampos(datos) })
      });
      return r.status;
    };
    for (const p of propuestas) {
      const st = await crear('propuestas_pagos', p.id, {
        ...p, creadoEn: new Date().toISOString(), lote: 'kz-unef-021-simulacion'
      });
      if (st === 200) escritura.propuestas++; else if (st === 409) escritura.yaExistian++; else escritura.errores++;
    }
    for (const m of marcas) {
      const st = await crear('marcas_historicas', m.id, { ...m, creadoEn: new Date().toISOString() });
      if (st === 200) escritura.marcas++; else if (st === 409) escritura.marcasYaExistian++; else escritura.errores++;
    }
    console.log(`  propuestas creadas=${escritura.propuestas} · ya existían=${escritura.yaExistian} · errores=${escritura.errores}`);
    console.log(`  marcas creadas=${escritura.marcas} · ya existían=${escritura.marcasYaExistian}`);
  } else {
    console.log('\n  NADA SE HA ESCRITO. Alcance simulación.');
  }

  if (INFORME) {
    fs.writeFileSync(INFORME, JSON.stringify({
      generado: new Date().toISOString(), alcance: ALCANCE, proyecto: PROYECTO,
      registrosExcel: filas.length, clientesLeidos: clientes.length,
      resumen, rechazadas: rechazadas.slice(0, 50), escritura,
      vencimientos, propuestas
    }, null, 2), 'utf8');
    console.log(`\n  informe guardado en ${INFORME}`);
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
