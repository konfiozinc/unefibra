'use strict';
// UNEFIBRA-041: solo datos ficticios y módulos puros; sin SDK ni red.
const assert = require('node:assert/strict');
const C = require('../../assets/js/admin/consistencia-comercial');
const guardias = require('../src/conciliacion').guardias;
const { calcularPeriodo, sumarDias } = require('../src/renovacion');
const { construirPropuestas } = require('../../tools/lib/pagos-historicos');
let ok = 0;
const t = (nombre, fn) => { fn(); ok++; console.log('PASS ' + nombre); };
const hoy = '2026-11-10';
const cliente = { id: 'ficticio', cicloCorte: '15', precioMensual: 50000, fechaVencimiento: '2026-11-15' };
const servicio = { clienteId: cliente.id, cicloCorte: '15', precioMensual: 50000, fechaVencimiento: '2026-11-15' };
const preparar = (c = {}, s = {}, pagos = []) => C.preparar({ ...cliente, ...c }, [{ ...servicio, ...s }], pagos, hoy);
const pago = { clienteId: cliente.id, monto: 50000, estado: 'CONFIRMADO', fechaPago: '2026-11-01', periodoInicio: '2026-11-01', periodoFin: '2026-11-30' };
t('cortes 15 y 30; el día de corte no avanza', () => {
  assert.equal(C.proximoCorte('15', hoy), '2026-11-15');
  assert.equal(C.proximoCorte('30', hoy), '2026-11-30');
  assert.equal(C.proximoCorte('15', '2026-11-15'), '2026-11-15');
  assert.equal(C.proximoCorte('30', '2026-12-31'), '2027-01-30');
});
t('febrero normal y bisiesto; corte 15 se conserva', () => {
  assert.equal(C.proximoCorte('30', '2026-02-10'), '2026-02-28');
  assert.equal(C.proximoCorte('30', '2028-02-10'), '2028-02-29');
  assert.equal(C.proximoCorte('15', '2026-02-10'), '2026-02-15');
});
t('atrasado se conserva aunque el siguiente corte esté en el futuro', () => {
  const f = preparar({ fechaVencimiento: '2026-10-15' }, { fechaVencimiento: '2026-10-15' });
  assert.equal(f.grupo, 'atrasados'); assert.equal(f.dias, -26); assert.equal(f.corte, '2026-11-15');
  assert.match(f.situacion, /Sin evidencia suficiente/);
});
t('límites de hoy y próximos siete días', () => {
  for (const [fecha, grupo] of [['2026-11-10', 'hoy'], ['2026-11-11', 'proximos'], ['2026-11-17', 'proximos'], ['2026-11-18', 'posteriores']]) {
    assert.equal(preparar({ fechaVencimiento: fecha }, { fechaVencimiento: fecha }).grupo, grupo);
  }
});
t('pago anticipado confirmado es evidencia; futuro o propuesta no lo es', () => {
  assert.match(preparar({}, {}, [pago]).situacion, /^Pago confirmado/);
  for (const cambio of [{ estado: 'PROPUESTA' }, { estado: 'APROBADA' }, { estado: 'PENDIENTE' }, { estado: 'ANULADO' }, { fechaPago: '2026-11-11' }, { periodoInicio: '2026-11-15' }, { monto: 0 }, { clienteId: 'otro' }]) {
    assert.match(preparar({}, {}, [{ ...pago, ...cambio }]).situacion, /Sin evidencia suficiente/);
  }
});
t('pago atrasado válido cubre desde su período; no borra fecha registrada', () => {
  const f = preparar({ fechaVencimiento: '2026-10-15' }, { fechaVencimiento: '2026-10-15' }, [{ ...pago, fechaPago: hoy, periodoInicio: hoy }]);
  assert.equal(f.grupo, 'atrasados'); assert.match(f.situacion, /^Pago confirmado/);
  assert.equal(calcularPeriodo({ vencimiento: '2026-10-15', duracion: 30, hoy }).periodoFin, sumarDias(hoy, 30));
});
t('validación pendiente prevalece incluso con pago confirmado', () => {
  for (const estado of ['PENDIENTE_VALIDACION', 'VALIDADA']) {
    assert.equal(preparar({}, { conciliacion: { estado } }, [pago]).grupo, 'pendientes');
    assert.equal(preparar({}, { conciliacion: { estado } }, [pago]).situacion, 'Pendiente de validación');
  }
});
t('fechas inválidas, conflictos y falta de servicio exigen revisión', () => {
  assert.equal(preparar({ fechaVencimiento: '2026-02-30' }).grupo, 'pendientes');
  assert.equal(preparar({}, { fechaVencimiento: '2026-11-30' }).grupo, 'pendientes');
  assert.equal(preparar({}, { cicloCorte: '30' }).grupo, 'pendientes');
  assert.equal(C.preparar(cliente, [], [], hoy).grupo, 'pendientes');
  assert.equal(C.preparar(cliente, [servicio, servicio], [], hoy).grupo, 'pendientes');
});
t('precios desconocidos no se presentan como gratuitos', () => {
  for (const valor of [0, null, undefined, '', -1, NaN, '50000']) assert.equal(C.precioTexto(valor), 'Precio por confirmar');
  assert.match(C.precioTexto(50000), /50.000/);
  assert.equal(preparar({}, { precioMensual: 0 }).grupo, 'pendientes');
});
t('resumen utiliza exactamente los grupos de las fichas; no pierde registros', () => {
  const fichas = [preparar(), preparar({}, { conciliacion: { estado: 'PENDIENTE_VALIDACION' } }), preparar({ fechaVencimiento: '2026-10-15' }, { fechaVencimiento: '2026-10-15' })];
  const r = C.resumen(fichas);
  assert.equal(r.proximos, 1); assert.equal(r.pendientes, 1); assert.equal(r.atrasados, 1);
  assert.equal(Object.values(r).reduce((a, b) => a + b, 0), fichas.length);
});
t('lectura conserva datos; históricos siguen siendo propuestas', () => {
  const c = structuredClone(cliente), s = structuredClone(servicio), ps = [structuredClone(pago)];
  const antes = JSON.stringify([c, s, ps]); C.preparar(c, [s], ps, hoy);
  assert.equal(JSON.stringify([c, s, ps]), antes);
  const r = construirPropuestas([{ hoja: 1, fila: 1, valorFactura: 50000, meses: [{ clase: 'PAGO', periodo: '2026-10', monto: 50000 }] }], new Map([[1, { clienteId: c.id }]]));
  assert.ok(r.propuestas.length > 0); assert.ok(r.propuestas.every((p) => p.estado === 'PROPUESTA'));
  assert.equal(r.pagos, undefined);
});
t('protecciones de cobro, suspensión, renovación y router intactas', () => {
  for (const estado of ['PENDIENTE_VALIDACION', 'VALIDADA']) {
    for (const fn of Object.values(guardias)) assert.equal(fn({ conciliacion: { estado } }).permitido, false);
  }
});
console.log(`TOTAL ${ok} PASS / 0 FAIL`);
