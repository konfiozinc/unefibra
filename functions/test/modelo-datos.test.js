'use strict';
/* ============================================================
 * KZ-UNEF-005 · Modelo de datos (estados) y diagnóstico de correspondencias
 * ------------------------------------------------------------
 * Dos frentes:
 *   A. estados.js — el cliente y el servicio tienen vocabularios distintos y
 *      en producción apareció un cliente con "POR_VENCER" (valor de servicio).
 *   B. mikrotik.js — clasificar cliente ↔ cola en las seis categorías, sin
 *      tratar nunca una coincidencia «probable» como exacta.
 *
 *   node test/modelo-datos.test.js
 * ============================================================ */
const assert = require('assert');
const e = require('../src/estados.js');
const m = require('../src/mikrotik.js');

let ok = 0, fail = 0; const fallos = [];
const t = (n, fn) => {
  try { fn(); ok++; console.log('  PASA  ' + n); }
  catch (x) { fail++; fallos.push(n); console.log('  FALLA ' + n + ' · ' + x.message); }
};

console.log('=== A. ESTADOS DEL MODELO ===');

t('los catálogos son los del sistema', () => {
  assert.deepStrictEqual([...e.ESTADOS_CLIENTE], ['ACTIVO', 'PENDIENTE_PAGO', 'SUSPENDIDO', 'INACTIVO']);
  assert.deepStrictEqual([...e.ESTADOS_SERVICIO], ['ACTIVO', 'POR_VENCER', 'SUSPENDIDO', 'INACTIVO']);
  assert.deepStrictEqual([...e.ESTADOS_PAGO], ['PENDIENTE', 'CONFIRMADO', 'ANULADO']);
});

t('POR_VENCER en un cliente se detecta como estado de SERVICIO', () => {
  const d = e.diagnosticarEstado('POR_VENCER', 'cliente');
  assert.strictEqual(d.valido, false);
  assert.strictEqual(d.ambito, 'servicio');
  assert.strictEqual(d.equivalenteCliente, 'PENDIENTE_PAGO');
  assert.strictEqual(d.accion, 'NORMALIZAR_A_CLIENTE');
});

t('POR_VENCER en un servicio es válido', () => {
  const d = e.diagnosticarEstado('POR_VENCER', 'servicio');
  assert.strictEqual(d.valido, true);
  assert.strictEqual(d.accion, 'NINGUNA');
});

t('PENDIENTE_PAGO en un servicio se corrige a POR_VENCER', () => {
  const d = e.diagnosticarEstado('PENDIENTE_PAGO', 'servicio');
  assert.strictEqual(d.valido, false);
  assert.strictEqual(d.equivalenteServicio, 'POR_VENCER');
  assert.strictEqual(d.accion, 'NORMALIZAR_A_SERVICIO');
});

t('un estado inventado pide revisión, no se corrige solo', () => {
  const d = e.diagnosticarEstado('CORTADO_POR_MORA', 'cliente');
  assert.strictEqual(d.valido, false);
  assert.strictEqual(d.accion, 'REQUIERE_REVISION');
});

t('un estado vacío o ausente no se da por bueno', () => {
  assert.strictEqual(e.diagnosticarEstado(null, 'cliente').accion, 'REQUIERE_REVISION');
  assert.strictEqual(e.diagnosticarEstado('', 'servicio').accion, 'REQUIERE_REVISION');
});

t('cliente y servicio coherentes: ACTIVO/ACTIVO', () => {
  assert.strictEqual(e.verificarCoherencia('ACTIVO', 'ACTIVO').coherente, true);
});

t('cliente y servicio incoherentes: ACTIVO con servicio SUSPENDIDO', () => {
  const r = e.verificarCoherencia('ACTIVO', 'SUSPENDIDO');
  assert.strictEqual(r.coherente, false);
  assert.match(r.motivo, /ACTIVO/);
});

t('moroso coherente: PENDIENTE_PAGO con POR_VENCER', () => {
  assert.strictEqual(e.verificarCoherencia('PENDIENTE_PAGO', 'POR_VENCER').coherente, true);
});

t('el mapeo cliente→servicio existe para los cuatro estados', () => {
  for (const c of e.ESTADOS_CLIENTE) assert.ok(e.servicioEsperadoParaCliente(c), 'sin mapeo para ' + c);
});

console.log('\n=== B. DIAGNÓSTICO DE CORRESPONDENCIAS MIKROTIK ===');

/* Colas sintéticas con la forma real de RouterOS. */
const COLAS = [
  { '.id': '*1', name: 'UF-Cliente-A-000001', target: '192.168.200.10/32', disabled: 'false' },
  { '.id': '*2', name: 'UF-Cliente-B-000002', target: '192.168.200.11/32', disabled: 'false' },
  { '.id': '*3', name: 'UF-Cliente-C-000003', target: '192.168.200.12/32', disabled: 'false' },
  { '.id': '*4', name: 'UF-Cliente-D-000004', target: '192.168.200.12/32', disabled: 'false' }, // dos colas, misma IP
  { '.id': '*5', name: 'UF-Cliente-E-000005', target: '192.168.200.13/32', disabled: 'false' },
  { '.id': '*6', name: '<dynamic-1>', target: '192.168.200.99/32', disabled: 'false' }
];

const CLIENTES = [
  { id: 'cA', nombreCompleto: 'Cliente A', ip: '192.168.200.10' },      // IP repetida con cH
  { id: 'cB', nombreCompleto: 'Cliente B', ip: '192.168.200.11' },      // exacta (*2)
  { id: 'cC', nombreCompleto: 'Cliente C', ip: '192.168.200.12' },      // conflicto (2 colas)
  /* El nombre de la cola se deriva del nombre + últimos 6 del id: para que
     coincida con "UF-Cliente-E-000005" el id debe ser "000005". */
  { id: '000005', nombreCompleto: 'Cliente E', ip: '192.168.200.50' },  // probable por nombre
  { id: 'cF', nombreCompleto: 'Cliente F', ip: '101.11' },              // dato incompleto (residuo de Excel)
  { id: 'cG', nombreCompleto: 'Cliente G' },                            // sin IP ni nombre → incompleto
  { id: 'cH', nombreCompleto: 'Cliente H', ip: '192.168.200.10' }       // IP repetida con cA
];

const d = m.diagnosticarCorrespondencias(CLIENTES, COLAS);
const clase = (id) => (d.filas.find((f) => f.clienteId === id) || {}).clase;

t('coincidencia exacta por IP única', () => {
  assert.strictEqual(clase('cB'), m.DIAGNOSTICO.COINCIDENCIA_EXACTA);
  assert.strictEqual(clase('cA'), m.DIAGNOSTICO.IP_DUPLICADA); // cA comparte IP con cH
});

t('dos colas para la misma IP es CONFLICTO, no coincidencia', () => {
  assert.strictEqual(clase('cC'), m.DIAGNOSTICO.CONFLICTO);
});

t('misma IP en dos clientes es IP_DUPLICADA', () => {
  assert.strictEqual(clase('cH'), m.DIAGNOSTICO.IP_DUPLICADA);
});

t('sin IP pero con nombre de cola es COINCIDENCIA_PROBABLE', () => {
  assert.strictEqual(clase('000005'), m.DIAGNOSTICO.COINCIDENCIA_PROBABLE);
});

t('un residuo tipo "101.11" es DATOS_INCOMPLETOS', () => {
  assert.strictEqual(clase('cF'), m.DIAGNOSTICO.DATOS_INCOMPLETOS);
});

t('sin IP y sin nombre es DATOS_INCOMPLETOS', () => {
  assert.strictEqual(clase('cG'), m.DIAGNOSTICO.DATOS_INCOMPLETOS);
});

t('SOLO la coincidencia exacta permite actuar', () => {
  for (const f of d.filas) {
    assert.strictEqual(f.accionPermitida, f.clase === m.DIAGNOSTICO.COINCIDENCIA_EXACTA,
      `${f.clienteId} (${f.clase}) tiene accionPermitida=${f.accionPermitida}`);
  }
});

t('el resumen cuadra con las filas', () => {
  const suma = Object.values(m.DIAGNOSTICO).reduce((a, k) => a + d.resumen[k], 0);
  assert.strictEqual(suma, d.filas.length);
  assert.strictEqual(d.resumen.totalClientes, CLIENTES.length);
});

t('las colas dinámicas no cuentan como huérfanas', () => {
  assert.ok(d.colasSinUso.every((q) => !q.dinamica));
});

t('una cola sin cliente se reporta como sobrante', () => {
  const nombres = d.colasSinUso.map((q) => q.nombre);
  assert.ok(nombres.includes('UF-Cliente-D-000004') || nombres.includes('UF-Cliente-C-000003'),
    'no se reportó ninguna de las dos colas que apuntan a la IP en conflicto: ' + nombres.join(','));
});

t('toda categoría tiene su significado legible', () => {
  for (const k of Object.values(m.DIAGNOSTICO)) {
    assert.ok(typeof m.SIGNIFICADO[k] === 'string' && m.SIGNIFICADO[k].length > 10, 'sin significado: ' + k);
  }
});

t('un cliente con IP duplicada NUNCA queda como exacta', () => {
  const f = d.filas.find((x) => x.clienteId === 'cA');
  assert.strictEqual(f.accionPermitida, false);
});

t('caso limpio: un cliente y una cola → exacta y accionable', () => {
  const r = m.diagnosticarCorrespondencias(
    [{ id: 'x1', nombreCompleto: 'Uno', ip: '10.0.0.5' }],
    [{ '.id': '*a', name: 'UF-Uno-000001', target: '10.0.0.5/32', disabled: 'false' }]
  );
  assert.strictEqual(r.resumen.COINCIDENCIA_EXACTA, 1);
  assert.strictEqual(r.resumen.accionesPermitidas, 1);
});

console.log('\n  TOTAL ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }
