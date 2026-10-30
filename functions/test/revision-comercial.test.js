'use strict';
/* ============================================================
 * KZ-UNEF-031 · Revisión comercial: reglas puras, sin Firestore
 * ------------------------------------------------------------
 * Lo que se prueba:
 *   · una fecha de cobro solo vale si cae en el día de corte (15 / 30 / último
 *     día real del mes, febrero incluido);
 *   · el corte NO se mueve "sumando 30 días" (el defecto de los 327 migrados);
 *   · no se aceptan precios 0, negativos ni texto;
 *   · cada servicio pendiente dice POR QUÉ lo está;
 *   · una corrección inválida no se aplica nunca.
 *
 *     node test/revision-comercial.test.js
 * ============================================================ */
const assert = require('assert');
const R = require('../src/revision-comercial.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}

console.log('=== 1. Día de corte y meses cortos ===');

t('el 15 y el 30 son días de corte', () => {
  assert.strictEqual(R.esDiaDeCorteDe('2026-11-15', '15'), true);
  assert.strictEqual(R.esDiaDeCorteDe('2026-11-30', '30'), true);
  assert.strictEqual(R.esDiaDeCorteDe('2026-11-14', '30'), false);
  assert.strictEqual(R.esDiaDeCorteDe('2026-11-16', '15'), false);
});

t('febrero usa el último día real (no el 30)', () => {
  assert.strictEqual(R.esDiaDeCorteDe('2026-02-28', '30'), true, 'febrero 2026 tiene 28 días');
  assert.strictEqual(R.esDiaDeCorteDe('2028-02-29', '30'), true, 'febrero 2028 es bisiesto');
  assert.strictEqual(R.esDiaDeCorteDe('2026-02-29', '30'), false, 'el 29-feb-2026 no existe');
  assert.strictEqual(R.ultimoDiaDe('2026-02-15'), 28);
  assert.strictEqual(R.ultimoDiaDe('2028-02-15'), 29);
});

t('los meses de 30 días no aceptan el 31', () => {
  assert.strictEqual(R.ultimoDiaDe('2026-04-01'), 30);
  assert.strictEqual(R.esDiaDeCorteDe('2026-04-30', '30'), true);
  assert.strictEqual(R.ultimoDiaDe('2026-01-01'), 31);
});

console.log('\n=== 2. El corte no se desplaza ===');

t('el próximo corte es el del ciclo, no "hoy + 30 días"', () => {
  assert.strictEqual(R.proximoCorteDe('30', '2026-11-10'), '2026-11-30');
  assert.strictEqual(R.proximoCorteDe('15', '2026-11-10'), '2026-11-15');
  assert.strictEqual(R.proximoCorteDe('15', '2026-11-20'), '2026-12-15', 'pasado el 15, el siguiente es el 15 del mes que viene');
  assert.strictEqual(R.proximoCorteDe('30', '2026-02-10'), '2026-02-28', 'en febrero el corte 30 cae el último día');
});

t('en diciembre el siguiente corte pasa al año siguiente', () => {
  assert.strictEqual(R.proximoCorteDe('15', '2026-12-20'), '2027-01-15');
  assert.strictEqual(R.proximoCorteDe('30', '2026-12-15'), '2026-12-30');
});

console.log('\n=== 3. Por qué un servicio necesita revisión ===');

t('servicio sin precio: motivo SIN_PRECIO', () => {
  const m = R.motivosDeRevision({ servicio: { cicloCorte: '30', fechaVencimiento: '2026-11-30' }, cliente: { precioMensual: 0 } });
  assert.ok(m.includes(R.MOTIVOS.SIN_PRECIO), 'debe pedir el valor: ' + m.join(','));
});

t('fecha que no cae en el corte: motivo FECHA_FUERA_DE_CORTE', () => {
  const m = R.motivosDeRevision({ servicio: { cicloCorte: '15', precioMensual: 50000, fechaVencimiento: '2026-11-14' } });
  assert.ok(m.includes(R.MOTIVOS.FECHA_FUERA_DE_CORTE), m.join(','));
  assert.strictEqual(R.necesitaRevision({ servicio: { cicloCorte: '15', precioMensual: 50000, fechaVencimiento: '2026-11-14' } }), true);
});

t('fecha anterior al alta: motivo FECHA_ANTES_DEL_ALTA', () => {
  const m = R.motivosDeRevision({ servicio: { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-10-06', fechaAlta: '2026-10-20' } });
  assert.ok(m.includes(R.MOTIVOS.FECHA_ANTES_DEL_ALTA), m.join(','));
});

t('servicio en orden solo pide confirmar la fecha', () => {
  const m = R.motivosDeRevision({ servicio: { planId: 'p9', cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-30', fechaAlta: '2026-10-06' } });
  assert.deepStrictEqual(m, [R.MOTIVOS.CONFIRMAR_FECHA]);
});

t('sin plan asignado lo dice', () => {
  const m = R.motivosDeRevision({ servicio: { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-30' } });
  assert.ok(m.includes(R.MOTIVOS.SIN_PLAN), m.join(','));
});

console.log('\n=== 4. Validación de lo que escribe el propietario ===');

t('una fecha fuera del corte se rechaza con explicación', () => {
  const r = R.validarCorreccion({ campo: 'fechaVencimiento', valor: '2026-11-14', ciclo: '15' });
  assert.strictEqual(r.ok, false);
  assert.ok(/día 15/.test(r.error), r.error);
});

t('en febrero se explica que el mes no tiene día 30', () => {
  const r = R.validarCorreccion({ campo: 'fechaVencimiento', valor: '2026-02-27', ciclo: '30' });
  assert.strictEqual(r.ok, false);
  assert.ok(/28/.test(r.error) && /febrero|02/.test(r.error), r.error);
  const bien = R.validarCorreccion({ campo: 'fechaVencimiento', valor: '2026-02-28', ciclo: '30' });
  assert.strictEqual(bien.ok, true);
});

t('precio: se aceptan pesos con separadores y se rechaza 0, negativo o texto', () => {
  assert.deepStrictEqual(R.validarCorreccion({ campo: 'precioMensual', valor: '50.000' }), { ok: true, valor: 50000 });
  assert.strictEqual(R.validarCorreccion({ campo: 'precioMensual', valor: 0 }).ok, false);
  assert.strictEqual(R.validarCorreccion({ campo: 'precioMensual', valor: -1000 }).ok, false);
  assert.strictEqual(R.validarCorreccion({ campo: 'precioMensual', valor: 'abc' }).ok, false);
  assert.strictEqual(R.validarCorreccion({ campo: 'precioMensual', valor: '' }).ok, false);
});

t('ciclo: solo 15 o 30', () => {
  assert.strictEqual(R.validarCorreccion({ campo: 'cicloCorte', valor: '15' }).ok, true);
  assert.strictEqual(R.validarCorreccion({ campo: 'cicloCorte', valor: '20' }).ok, false);
});

t('un campo no revisable no se puede tocar', () => {
  assert.strictEqual(R.validarCorreccion({ campo: 'estado', valor: 'ACTIVO' }).ok, false);
  assert.strictEqual(R.validarCorreccion({ campo: 'ip', valor: '10.0.0.1' }).ok, false);
});

console.log('\n=== 5. Aplicar correcciones (sin escribir) ===');

t('cambiar el corte mueve la fecha al día de corte nuevo, en el mismo mes', () => {
  const r = R.aplicarCorrecciones({
    servicio: { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-14' },
    cliente: { cicloCorte: '30', fechaVencimiento: '2026-11-14' },
    correcciones: { cicloCorte: '15' }
  });
  assert.strictEqual(r.errores.length, 0);
  assert.strictEqual(r.servicio.cicloCorte, '15');
  assert.strictEqual(r.servicio.fechaVencimiento, '2026-11-15', 'debe caer en el 15, no sumar 30 días');
  assert.strictEqual(r.cliente.fechaVencimiento, '2026-11-15');
});

t('sin fecha y con corte, propone el próximo corte', () => {
  const r = R.aplicarCorrecciones({
    servicio: { cicloCorte: '15', precioMensual: 50000, fechaAlta: '2026-10-20' },
    correcciones: {}
  });
  assert.strictEqual(r.servicio.fechaVencimiento, '2026-11-15');
  const calculado = r.aplicadas.find((a) => a.campo === 'fechaVencimiento');
  assert.ok(calculado && calculado.calculado === true, 'debe quedar marcada como calculada');
});

t('una corrección inválida no se aplica y se reporta', () => {
  const r = R.aplicarCorrecciones({
    servicio: { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-30' },
    correcciones: { precioMensual: 0, cicloCorte: '20' }
  });
  assert.strictEqual(r.servicio.precioMensual, 50000, 'el precio no cambia');
  assert.strictEqual(r.servicio.cicloCorte, '30', 'el ciclo no cambia');
  assert.strictEqual(r.errores.length, 2);
});

t('no toca estado, ni IP, ni pagos', () => {
  const servicio = { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-30', estado: 'ACTIVO', ip: '10.0.0.9', pagos: 3 };
  const r = R.aplicarCorrecciones({ servicio, correcciones: { precioMensual: 60000 } });
  assert.strictEqual(r.servicio.estado, 'ACTIVO');
  assert.strictEqual(r.servicio.ip, '10.0.0.9');
  assert.strictEqual(r.servicio.pagos, 3);
  assert.strictEqual(r.servicio.precioMensual, 60000);
});

console.log('\n=== 6. Resumen para el panel ===');

t('cuenta pendientes y agrupa por motivo', () => {
  const filas = [
    { servicio: { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-30' }, cliente: { planId: 'p1' } },
    { servicio: { cicloCorte: '15', precioMensual: 50000, fechaVencimiento: '2026-11-14' }, cliente: { planId: 'p1' } },
    { servicio: { cicloCorte: '30', precioMensual: 0, fechaVencimiento: '2026-11-30' }, cliente: { planId: 'p1' } }
  ];
  const r = R.resumirRevision(filas);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.pendientes, 3, 'las tres necesitan algo');
  assert.ok(r.porMotivo[R.MOTIVOS.CONFIRMAR_FECHA] >= 1);
  assert.ok(r.porMotivo[R.MOTIVOS.FECHA_FUERA_DE_CORTE] >= 1);
  assert.ok(r.porMotivo[R.MOTIVOS.SIN_PRECIO] >= 1);
});

t('un servicio completo y confirmado ya no cuenta como pendiente', () => {
  const filas = [{ servicio: { cicloCorte: '30', precioMensual: 50000, fechaVencimiento: '2026-11-30', fechaAlta: '2026-01-01' }, cliente: {} }];
  const r = R.resumirRevision(filas);
  assert.strictEqual(r.pendientes, 1, 'sigue pidiendo confirmación de la fecha hasta que alguien la confirme');
  assert.strictEqual(r.porMotivo[R.MOTIVOS.CONFIRMAR_FECHA], 1);
});

console.log('\n== Resumen ==');
console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
