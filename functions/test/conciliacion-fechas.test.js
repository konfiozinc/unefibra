'use strict';
/* ============================================================
 * KZ-UNEF-028 · Conciliación de fechas: pruebas puras
 * ------------------------------------------------------------
 * Lo que se demuestra:
 *   · una fecha solo se da por CONFIABLE si cae en su día de corte, es posterior
 *     al alta y (si hay pagos) coincide con lo que dicen los pagos confirmados;
 *   · si hay pagos confirmados que determinan otra fecha, se PROPONE esa fecha y
 *     se deja claro que viene de evidencia, no de una suposición;
 *   · si no hay evidencia, NO se inventa fecha: `fechaPropuesta` queda en null y
 *     se devuelve la pregunta que hay que hacerle al propietario;
 *   · febrero (ciclo 30) cuenta como día de corte el último día real del mes;
 *   · el precio que falta no invalida una fecha correcta (son dos problemas).
 *
 *     node test/conciliacion-fechas.test.js
 * ============================================================ */
const assert = require('assert');
const c = require('../src/conciliacion-fechas.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}

console.log('=== 1. Fechas que se pueden dar por buenas ===');

t('ciclo 15 que cae el 15, posterior al alta y con precio -> CONFIABLE', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'CONFIABLE');
  assert.strictEqual(r.fechaPropuesta, null, 'una fecha confiable no necesita propuesta');
  assert.strictEqual(r.fuente, 'REGLA_DE_CORTE');
});

t('ciclo 30 que cae el 30 -> CONFIABLE', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2026-11-30', ciclo: '30', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'CONFIABLE');
});

t('febrero de anio comun: el corte del ciclo 30 es el 28', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2027-02-28', ciclo: '30', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'CONFIABLE');
  assert.ok(c.esDiaDeCorte('2027-02-28', 30));
  assert.ok(!c.esDiaDeCorte('2027-02-27', 30), 'el 27 no es dia de corte');
});

t('febrero bisiesto: el corte del ciclo 30 es el 29', () => {
  assert.ok(c.esDiaDeCorte('2028-02-29', 30));
  const r = c.clasificarServicio({ fechaVencimiento: '2028-02-29', ciclo: 30, fechaInicioServicio: '2027-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'CONFIABLE');
});

t('el ciclo puede venir como numero o como texto', () => {
  const a = c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: 15, fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  const b = c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.deepStrictEqual(a.clase, b.clase);
});

t('si falta el precio pero la fecha es valida, la fecha sigue siendo confiable', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 0 });
  assert.strictEqual(r.clase, 'CONFIABLE', 'un problema de precio no invalida el calendario');
  assert.ok(/precio/.test(r.motivos.join(' ')));
});

console.log('\n=== 2. La fecha guardada no cuadra, pero los pagos si deciden ===');

t('pago confirmado del periodo noviembre: el proximo vencimiento es el corte de diciembre', () => {
  const r = c.clasificarServicio({
    fechaVencimiento: '2026-12-25', ciclo: '30', fechaInicioServicio: '2026-01-05', precioMensual: 50000,
    pagos: [{ estado: 'CONFIRMADO', periodoInicio: '2026-11-30', periodoFin: '2026-12-29' }]
  });
  assert.strictEqual(r.clase, 'PROPUESTA_CON_EVIDENCIA');
  assert.strictEqual(r.fechaPropuesta, '2026-12-30');
  assert.strictEqual(r.fuente, 'PAGOS_CONFIRMADOS');
  assert.strictEqual(r.detalle.ultimoPeriodoPagado, '2026-11');
  assert.ok(r.pregunta, 'debe quedar una pregunta para el propietario');
});

t('si la fecha coincide con la que resulta del pago, es CONFIABLE', () => {
  const r = c.clasificarServicio({
    fechaVencimiento: '2026-12-30', ciclo: '30', fechaInicioServicio: '2026-01-05', precioMensual: 50000,
    pagos: [{ estado: 'CONFIRMADO', periodoInicio: '2026-11-30', periodoFin: '2026-12-29' }]
  });
  assert.strictEqual(r.clase, 'CONFIABLE');
  assert.strictEqual(r.fuente, 'PAGOS_CONFIRMADOS');
});

t('los pagos ANULADOS o PENDIENTES no cuentan como evidencia', () => {
  const r = c.clasificarServicio({
    fechaVencimiento: '2026-12-30', ciclo: '30', fechaInicioServicio: '2026-01-05', precioMensual: 50000,
    pagos: [
      { estado: 'ANULADO', periodoFin: '2026-11-29' },
      { estado: 'PENDIENTE', periodoFin: '2026-11-29' }
    ]
  });
  assert.strictEqual(r.detalle.pagosConfirmados, 0, 'ningun pago vale como evidencia');
  /* La fecha sigue siendo buena por la regla de corte: son dos cosas distintas. */
  assert.strictEqual(r.clase, 'CONFIABLE');
  assert.strictEqual(r.fuente, 'REGLA_DE_CORTE');
});

t('toma el ultimo periodo confirmado, no el primero', () => {
  const r = c.clasificarServicio({
    fechaVencimiento: '2026-12-15', ciclo: '15', fechaInicioServicio: '2026-01-05', precioMensual: 50000,
    pagos: [
      { estado: 'CONFIRMADO', periodoFin: '2026-04-14' },
      { estado: 'CONFIRMADO', periodoFin: '2026-11-15' },
      { estado: 'CONFIRMADO', periodoFin: '2026-08-14' }
    ]
  });
  assert.strictEqual(r.detalle.ultimoPeriodoPagado, '2026-11');
  assert.strictEqual(r.clase, 'CONFIABLE');
});

console.log('\n=== 3. Cuando no hay evidencia, NO se inventa la fecha ===');

t('fecha anterior al alta -> requiere confirmacion y sin propuesta', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2025-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.strictEqual(r.fechaPropuesta, null, 'nunca una fecha inventada');
  assert.ok(/anterior o igual al inicio/.test(r.motivos.join(' ')));
  assert.ok(/desde cu.ndo paga/i.test(r.pregunta));
});

t('fecha que no cae en dia de corte -> requiere confirmacion', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2026-11-07', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.strictEqual(r.fechaPropuesta, null);
  assert.ok(/no cae en un d.a de corte/.test(r.motivos.join(' ')));
});

t('sin ciclo -> requiere confirmacion y pregunta por la tanda', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: null, fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.ok(/15 o los 30/.test(r.pregunta));
});

t('sin fecha de vencimiento -> requiere confirmacion', () => {
  const r = c.clasificarServicio({ fechaVencimiento: null, ciclo: '30', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.ok(/no tiene fecha/.test(r.motivos.join(' ')));
});

t('fecha con formato invalido -> requiere confirmacion', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '15/11/2026', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 });
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.ok(/formato/.test(r.motivos.join(' ')));
});

t('sin fecha de inicio -> requiere confirmacion (no se asume nada)', () => {
  const r = c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: null, precioMensual: 50000 });
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.ok(/fecha de inicio/.test(r.motivos.join(' ')));
});

t('un servicio vacio no rompe el clasificador', () => {
  const r = c.clasificarServicio({});
  assert.strictEqual(r.clase, 'REQUIERE_CONFIRMACION');
  assert.strictEqual(r.fechaPropuesta, null);
});

console.log('\n=== 4. Resumen agregado ===');

t('el resumen cuenta por clase y ordena los motivos', () => {
  const items = [
    c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 }),
    c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 }),
    c.clasificarServicio({ fechaVencimiento: '2025-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 }),
    c.clasificarServicio({ fechaVencimiento: '2026-11-07', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 })
  ];
  const r = c.resumirClasificaciones(items);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.confiables, 2);
  assert.strictEqual(r.requierenConfirmacion, 2);
  assert.ok(Array.isArray(r.motivosFrecuentes) && r.motivosFrecuentes.length > 0);
});

t('el resumen no arrastra datos personales (solo agregados)', () => {
  const items = [c.clasificarServicio({ fechaVencimiento: '2026-11-15', ciclo: '15', fechaInicioServicio: '2026-10-01', precioMensual: 50000 })];
  const json = JSON.stringify(c.resumirClasificaciones(items));
  assert.ok(!/nombre|telefono|direccion|documento/i.test(json));
});

console.log('\n== Resumen ==');
console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
