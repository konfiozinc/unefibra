'use strict';
const assert = require('assert');
const g = require('../src/pagos-guardas.js');
let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) { try { fn(); ok++; console.log('  PASA  ' + nombre); } catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' · ' + e.message); } }
t('monto válido 99900', () => assert.strictEqual(g.validarMonto(99900).ok, true));
t('monto válido normaliza valor', () => assert.strictEqual(g.validarMonto(49900).valor, 49900));
t('monto cero rechazado', () => assert.strictEqual(g.validarMonto(0).ok, false));
t('monto negativo rechazado', () => assert.strictEqual(g.validarMonto(-50000).ok, false));
t('monto texto rechazado', () => assert.strictEqual(g.validarMonto('99900').ok, false));
t('monto NaN rechazado', () => assert.strictEqual(g.validarMonto(NaN).ok, false));
t('monto Infinity rechazado', () => assert.strictEqual(g.validarMonto(Infinity).ok, false));
t('monto con decimales rechazado', () => assert.strictEqual(g.validarMonto(99900.5).ok, false));
t('fecha válida aceptada', () => assert.strictEqual(g.validarFechaPago('2026-10-19').ok, true));
t('fecha nula aceptada', () => assert.strictEqual(g.validarFechaPago(null).ok, true));
t('fecha malformada rechazada', () => assert.strictEqual(g.validarFechaPago('19/10/2026').ok, false));
t('confirmar PENDIENTE permitido', () => assert.strictEqual(g.puedeConfirmar('PENDIENTE').ok, true));
t('confirmar CONFIRMADO rechazado (doble renovación)', () => assert.strictEqual(g.puedeConfirmar('CONFIRMADO').ok, false));
t('confirmar ANULADO rechazado', () => assert.strictEqual(g.puedeConfirmar('ANULADO').ok, false));
t('anular PENDIENTE con motivo permitido', () => assert.strictEqual(g.puedeAnular('PENDIENTE', 'Comprobante inválido').ok, true));
t('anular CONFIRMADO rechazado', () => assert.strictEqual(g.puedeAnular('CONFIRMADO', 'motivo válido').ok, false));
t('anular ANULADO rechazado (duplicado)', () => assert.strictEqual(g.puedeAnular('ANULADO', 'motivo válido').ok, false));
t('anular sin motivo rechazado', () => assert.strictEqual(g.puedeAnular('PENDIENTE', '').ok, false));
t('anular con motivo corto rechazado', () => assert.strictEqual(g.puedeAnular('PENDIENTE', 'ab').ok, false));
t('anular con motivo nulo rechazado', () => assert.strictEqual(g.puedeAnular('PENDIENTE', null).ok, false));
console.log('\n  TOTAL ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }