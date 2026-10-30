'use strict';
/* ============================================================
 * KZ-UNEF-032 · La renovación respeta el día de corte
 * ------------------------------------------------------------
 * El defecto que se certifica aquí: al confirmar un pago se sumaban 30 días fijos,
 * así que un cliente del corte 30 que pagaba el 30-nov quedaba con vencimiento el
 * 29-dic, y de ahí se salía un día por mes sin volver nunca a su corte.
 *
 * Se prueba la regla, no Firestore: `renovarAlCorte` es pura.
 *
 *     node test/renovacion-corte.test.js
 * ============================================================ */
const assert = require('assert');
const { renovarAlCorte, esDiaDeCorte, fechaDeCorte } = (() => {
  const v = require('../src/vencimientos.js');
  return { renovarAlCorte: v.renovarAlCorte, esDiaDeCorte: (f, c) => v.fechaDeCorte(Number(f.slice(0, 4)), Number(f.slice(5, 7)), c) === f, fechaDeCorte: v.fechaDeCorte };
})();

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}

console.log('=== 1. El caso que falló en el recorrido (29-dic) ===');

t('corte 30 pagando el 30-nov renueva al 30-dic, NO al 29-dic', () => {
  const r = renovarAlCorte({ ciclo: '30', base: '2026-11-30' });
  assert.strictEqual(r.vencimiento, '2026-12-30');
  assert.ok(r.vencimiento !== '2026-12-29', 'no puede quedar un día por debajo del corte');
});

t('corte 15 pagando el 15-nov renueva al 15-dic', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '15', base: '2026-11-15' }).vencimiento, '2026-12-15');
});

t('una fecha ya desviada vuelve a su corte', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2026-11-29' }).vencimiento, '2026-11-30');
  assert.strictEqual(renovarAlCorte({ ciclo: '15', base: '2026-11-14' }).vencimiento, '2026-11-15');
});

console.log('\n=== 2. Renovaciones consecutivas no se salen del ciclo ===');

t('12 renovaciones seguidas del corte 30 caen siempre en día de corte', () => {
  let base = '2026-10-30';
  for (let i = 0; i < 12; i++) {
    const r = renovarAlCorte({ ciclo: '30', base });
    assert.ok(r, 'la renovación ' + (i + 1) + ' no devolvió período');
    assert.ok(esDiaDeCorte(r.vencimiento, '30'), 'se salió del corte en la renovación ' + (i + 1) + ': ' + r.vencimiento);
    base = r.vencimiento;
  }
});

t('12 renovaciones seguidas del corte 15 también', () => {
  let base = '2026-10-15';
  for (let i = 0; i < 12; i++) {
    const r = renovarAlCorte({ ciclo: '15', base });
    assert.ok(esDiaDeCorte(r.vencimiento, '15'), 'se salió del corte: ' + r.vencimiento);
    base = r.vencimiento;
  }
});

console.log('\n=== 3. Febrero y meses cortos ===');

t('corte 30 en enero renueva al 28 de febrero (2026 no bisiesto)', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2026-01-30' }).vencimiento, '2026-02-28');
});

t('corte 30 en febrero de 2028 (bisiesto) renueva al 29', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2028-02-29' }).vencimiento, '2028-03-30');
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2028-01-30' }).vencimiento, '2028-02-29');
});

t('corte 30 en abril (mes de 30 días) renueva al 30', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2026-04-30' }).vencimiento, '2026-05-30');
});

console.log('\n=== 4. Cambio de año y casos límite ===');

t('el 30-dic renueva al 30-ene del año siguiente', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2026-12-30' }).vencimiento, '2027-01-30');
});

t('el 15-dic renueva al 15-ene del año siguiente', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '15', base: '2026-12-15' }).vencimiento, '2027-01-15');
});

t('nunca renueva hacia atrás: desde una fecha posterior al corte pasa al siguiente mes', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '2026-11-31'.replace('31', '30') === '2026-11-30' ? '2026-12-05' : '' }).vencimiento, '2026-12-30');
});

t('sin ciclo, o con fecha inválida, no inventa período', () => {
  assert.strictEqual(renovarAlCorte({ ciclo: null, base: '2026-11-30' }), null);
  assert.strictEqual(renovarAlCorte({ ciclo: '20', base: '2026-11-30' }), null);
  assert.strictEqual(renovarAlCorte({ ciclo: '30', base: '30/11/2026' }), null);
});

t('el período cobrado termina el día anterior al corte siguiente', () => {
  const r = renovarAlCorte({ ciclo: '30', base: '2026-11-30' });
  assert.strictEqual(r.periodoInicio, '2026-12-30');
  assert.strictEqual(r.periodoFin, '2027-01-29');
  assert.strictEqual(fechaDeCorte(2027, 1, 30), '2027-01-30');
});

console.log('\n== Resumen ==');
console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
