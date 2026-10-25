'use strict';
/* Pruebas de functions/src/renovacion.js — sin emulador, sin credenciales.
   Se ejecuta con:  node test/renovacion.test.js
   El primer bloque es el defecto crítico de KZ-UNEF-001: un cliente moroso
   que paga quedaba con el periodo en el pasado y el motor lo volvía a
   suspender al día siguiente. */
const assert = require('assert');
const r = require('../src/renovacion.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' Â· ' + e.message); }
}

console.log('=== 1. El periodo de un moroso empieza HOY, no en su vencimiento viejo ===');

t('vencido hace meses: el periodo nuevo cubre desde hoy', () => {
  const p = r.calcularPeriodo({ vencimiento: '2026-05-01', duracion: 30, hoy: '2026-10-25' });
  assert.strictEqual(p.periodoInicio, '2026-10-25');
  assert.strictEqual(p.periodoFin, '2026-11-24');
  assert.strictEqual(p.base, '2026-10-25');
});

t('vencido ayer: el periodo nuevo empieza hoy', () => {
  const p = r.calcularPeriodo({ vencimiento: '2026-10-24', duracion: 30, hoy: '2026-10-25' });
  assert.strictEqual(p.periodoInicio, '2026-10-25');
  assert.strictEqual(p.periodoFin, '2026-11-24');
});

t('vencido hoy mismo: encadena desde hoy', () => {
  const p = r.calcularPeriodo({ vencimiento: '2026-10-25', duracion: 30, hoy: '2026-10-25' });
  assert.strictEqual(p.periodoInicio, '2026-10-25');
  assert.strictEqual(p.periodoFin, '2026-11-24');
});

console.log('\n=== 2. El cliente al día no pierde los días que le quedan ===');

t('vence en el futuro: encadena desde el vencimiento', () => {
  const p = r.calcularPeriodo({ vencimiento: '2026-11-10', duracion: 30, hoy: '2026-10-25' });
  assert.strictEqual(p.periodoInicio, '2026-11-10');
  assert.strictEqual(p.periodoFin, '2026-12-10');
});

t('sin vencimiento: empieza hoy', () => {
  const p = r.calcularPeriodo({ vencimiento: null, duracion: 30, hoy: '2026-10-25' });
  assert.strictEqual(p.periodoInicio, '2026-10-25');
});

t('no regala dias: 45 dias desde el vencimiento', () => {
  const p = r.calcularPeriodo({ vencimiento: '2026-11-01', duracion: 45, hoy: '2026-10-25' });
  assert.strictEqual(p.periodoFin, '2026-12-16');
});

console.log('\n=== 3. Fines de mes y años bisiestos (se suma en dias, no en meses) ===');

t('31 de enero + 30 dias = 2 de marzo', () => {
  assert.strictEqual(r.sumarDias('2026-01-31', 30), '2026-03-02');
});

t('28 de febrero (2026 no bisiesto) + 1 dia = 1 de marzo', () => {
  assert.strictEqual(r.sumarDias('2026-02-28', 1), '2026-03-01');
});

t('29 de febrero (2028 bisiesto) existe y suma bien', () => {
  assert.strictEqual(r.sumarDias('2028-02-29', 1), '2028-03-01');
});

t('31 de diciembre + 1 dia = 1 de enero del año siguiente', () => {
  assert.strictEqual(r.sumarDias('2026-12-31', 1), '2027-01-01');
});

console.log('\n=== 4. Duración inválida no se acepta en silencio ===');

t('duracion 0 se rechaza', () => {
  assert.throws(() => r.calcularPeriodo({ vencimiento: '2026-11-01', duracion: 0, hoy: '2026-10-25' }));
});

t('duracion negativa se rechaza', () => {
  assert.throws(() => r.calcularPeriodo({ vencimiento: '2026-11-01', duracion: -30, hoy: '2026-10-25' }));
});

t('duracion ausente se rechaza', () => {
  assert.throws(() => r.calcularPeriodo({ vencimiento: '2026-11-01' }));
});

console.log('\n=== 5. Zona horaria de Colombia (UTC-5) ===');

t('a las 02:00 UTC del 26 en Bogota todavia es 25', () => {
  assert.strictEqual(r.hoyISO(new Date('2026-10-26T02:00:00Z')), '2026-10-25');
});

t('a las 05:00 UTC del 26 en Bogota ya es 26', () => {
  assert.strictEqual(r.hoyISO(new Date('2026-10-26T05:00:00Z')), '2026-10-26');
});

t('sin fecha, normalizarFecha usa el dia de Colombia', () => {
  const d = r.normalizarFecha(null);
  assert.ok(d instanceof Date);
  assert.strictEqual(r.fechaISO(d), r.hoyISO());
});

t('una Date con hora se normaliza a medianoche UTC de su dia', () => {
  assert.strictEqual(r.fechaISO(r.normalizarFecha(new Date('2026-10-25T23:30:00Z'))), '2026-10-25');
});

console.log('\n=== 6. baseRenovacion deja claro de donde arranca ===');

t('base = hoy si esta vencido', () => {
  assert.strictEqual(r.baseRenovacion('2026-01-15', '2026-10-25'), '2026-10-25');
});

t('base = vencimiento si esta vigente', () => {
  assert.strictEqual(r.baseRenovacion('2026-12-01', '2026-10-25'), '2026-12-01');
});

t('base = hoy si no hay vencimiento', () => {
  assert.strictEqual(r.baseRenovacion(null, '2026-10-25'), '2026-10-25');
});

console.log('\n  TOTAL ' + (ok + fail) + ' Â· PASA ' + ok + ' Â· FALLA ' + fail);
if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }
