'use strict';
/* ============================================================
 * KZ-UNEF-029 · Renovación alineada al ciclo de corte
 * ------------------------------------------------------------
 * El defecto que corrige: al confirmar un pago se sumaban 30 días fijos, así que
 * la fecha se salía de su día de corte en cuanto un mes tenía 31 días
 * (15-dic + 30 = 14-ene) y ya no volvía sola. La simulación de 6 renovaciones
 * seguidas terminaba en 2027-05-14 y 2027-05-29, fuera del ciclo.
 *
 * Pruebas puras:      node test/renovacion-ciclo.test.js
 * ============================================================ */
const assert = require('assert');
const { renovarPorCiclo } = require('../src/vencimientos.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}

const HOY = '2026-10-29';

console.log('=== 1. Cliente ya alineado: el período y el vencimiento siguen el calendario ===');

t('ciclo 15: período 15-nov a 14-dic y vence el 15-dic', () => {
  const r = renovarPorCiclo({ vencimiento: '2026-11-15', ciclo: '15', hoy: HOY });
  assert.ok(r, 'debe alinear');
  assert.strictEqual(r.periodoInicio, '2026-11-15');
  assert.strictEqual(r.periodoFin, '2026-12-14');
  assert.strictEqual(r.vencimiento, '2026-12-15');
  assert.strictEqual(r.origen, 'CICLO_DE_CORTE');
});

t('ciclo 30: período 30-nov a 29-dic y vence el 30-dic', () => {
  const r = renovarPorCiclo({ vencimiento: '2026-11-30', ciclo: 30, hoy: HOY });
  assert.strictEqual(r.periodoInicio, '2026-11-30');
  assert.strictEqual(r.periodoFin, '2026-12-29');
  assert.strictEqual(r.vencimiento, '2026-12-30');
});

t('febrero: período 28-feb a 29-mar y vence el 30-mar', () => {
  const r = renovarPorCiclo({ vencimiento: '2027-02-28', ciclo: 30, hoy: HOY });
  assert.strictEqual(r.periodoInicio, '2027-02-28');
  assert.strictEqual(r.periodoFin, '2027-03-29');
  assert.strictEqual(r.vencimiento, '2027-03-30');
});

t('febrero del ciclo 15 no cambia de comportamiento', () => {
  const r = renovarPorCiclo({ vencimiento: '2027-02-15', ciclo: 15, hoy: HOY });
  assert.strictEqual(r.vencimiento, '2027-03-15');
});

console.log('\n=== 2. La fecha NO se sale del ciclo al renovar muchas veces ===');

t('12 renovaciones seguidas siguen en el día de corte (ciclo 15)', () => {
  let vence = '2026-11-15';
  const { fechaDeCorte } = require('../src/vencimientos.js');
  for (let i = 0; i < 12; i++) {
    const r = renovarPorCiclo({ vencimiento: vence, ciclo: 15, hoy: vence });
    assert.ok(r, 'renovación ' + (i + 1) + ' no alineó');
    vence = r.vencimiento;
    const [a, m] = vence.split('-').map(Number);
    assert.strictEqual(fechaDeCorte(a, m, 15), vence, 'se salió del ciclo en la renovación ' + (i + 1) + ': ' + vence);
  }
});

t('12 renovaciones seguidas siguen en el día de corte (ciclo 30)', () => {
  let vence = '2026-11-30';
  const { fechaDeCorte } = require('../src/vencimientos.js');
  for (let i = 0; i < 12; i++) {
    const r = renovarPorCiclo({ vencimiento: vence, ciclo: 30, hoy: vence });
    assert.ok(r);
    vence = r.vencimiento;
    const [a, m] = vence.split('-').map(Number);
    assert.strictEqual(fechaDeCorte(a, m, 30), vence, 'se salió del ciclo en la renovación ' + (i + 1) + ': ' + vence);
  }
});

console.log('\n=== 3. A quien NO está alineado no se le toca nada ===');

t('fecha fuera de su día de corte: no se alinea (no se le quitan días pagados)', () => {
  assert.strictEqual(renovarPorCiclo({ vencimiento: '2026-11-07', ciclo: 15, hoy: HOY }), null);
  assert.strictEqual(renovarPorCiclo({ vencimiento: '2026-10-06', ciclo: 30, hoy: HOY }), null);
});

t('sin ciclo válido: no se alinea', () => {
  assert.strictEqual(renovarPorCiclo({ vencimiento: '2026-11-15', ciclo: null, hoy: HOY }), null);
  assert.strictEqual(renovarPorCiclo({ vencimiento: '2026-11-15', ciclo: '7', hoy: HOY }), null);
});

t('sin fecha válida: no se alinea', () => {
  assert.strictEqual(renovarPorCiclo({ vencimiento: '15/11/2026', ciclo: 15, hoy: HOY }), null);
  assert.strictEqual(renovarPorCiclo({ vencimiento: null, ciclo: 15, hoy: HOY }), null);
});

console.log('\n=== 4. Cliente vencido: nunca se renueva hacia atrás ===');

t('vencido desde mayo que paga hoy: el período arranca en el corte siguiente', () => {
  const r = renovarPorCiclo({ vencimiento: '2026-05-15', ciclo: 15, hoy: HOY });
  assert.ok(r);
  assert.ok(r.periodoInicio >= HOY, 'el período no puede empezar en el pasado: ' + r.periodoInicio);
  assert.strictEqual(r.periodoInicio, '2026-11-15');
  assert.strictEqual(r.vencimiento, '2026-12-15');
});

t('vencido ayer: arranca hoy y sigue en el ciclo', () => {
  const r = renovarPorCiclo({ vencimiento: '2026-10-15', ciclo: 15, hoy: HOY });
  assert.ok(r);
  assert.ok(r.periodoInicio > '2026-10-15');
});

console.log('\n== Resumen ==');
console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
