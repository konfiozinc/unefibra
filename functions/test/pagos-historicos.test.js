'use strict';
/* ============================================================
 * KZ-UNEF-021 · Pruebas puras (sin emulador ni red)
 * ------------------------------------------------------------
 * Cubre el cálculo de vencimientos y la lógica de clasificación del
 * importador de pagos históricos.
 *
 *   node test/pagos-historicos.test.js
 * ============================================================ */
const v = require('../src/vencimientos');
const p = require('../../tools/lib/pagos-historicos');

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log('  PASA  ' + nm.padEnd(64) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(61) + (d || '')); }
};

console.log('=== 1. Ciclos válidos y fechas de corte ===');
chk('ciclo 15 → día 15', v.fechaDeCorte(2026, 3, 15) === '2026-03-15', v.fechaDeCorte(2026, 3, 15));
chk('ciclo 30 → día 30', v.fechaDeCorte(2026, 3, 30) === '2026-03-30', v.fechaDeCorte(2026, 3, 30));
chk('ciclo 30 en febrero → último día real (28)', v.fechaDeCorte(2026, 2, 30) === '2026-02-28', v.fechaDeCorte(2026, 2, 30));
chk('ciclo 30 en febrero bisiesto → 29', v.fechaDeCorte(2028, 2, 30) === '2028-02-29', v.fechaDeCorte(2028, 2, 30));
chk('ciclo 30 en abril → 30', v.fechaDeCorte(2026, 4, 30) === '2026-04-30');
chk('ciclo 31 rechazado', v.fechaDeCorte(2026, 3, 31) === null);
chk('ciclo 0 rechazado', v.fechaDeCorte(2026, 3, 0) === null);
chk('mes 13 rechazado', v.fechaDeCorte(2026, 13, 30) === null);
chk('normalizarCiclo("15") = 15', v.normalizarCiclo('15') === 15);
chk('normalizarCiclo("quince") = null', v.normalizarCiclo('quince') === null);

console.log('\n=== 2. Períodos y ventanas ===');
chk('desplazar período dentro del año', v.desplazarPeriodo('2026-03', 1) === '2026-04');
chk('desplazar período cruzando diciembre', v.desplazarPeriodo('2025-12', 1) === '2026-01');
chk('desplazar período hacia atrás', v.desplazarPeriodo('2026-01', -1) === '2025-12');
chk('desplazar 12 meses', v.desplazarPeriodo('2026-03', 12) === '2027-03');
chk('período inválido → null', v.desplazarPeriodo('2026-13', 1) === null);
const cub = v.cubiertoPor('2026-04', 30);
chk('abril ciclo 30 cubre 30-abr → 29-may', cub.desde === '2026-04-30' && cub.hasta === '2026-05-29', JSON.stringify(cub));
const cub15 = v.cubiertoPor('2026-04', 15);
chk('abril ciclo 15 cubre 15-abr → 14-may', cub15.desde === '2026-04-15' && cub15.hasta === '2026-05-14', JSON.stringify(cub15));
const cubFeb = v.cubiertoPor('2026-02', 30);
chk('febrero ciclo 30 cubre 28-feb → 29-mar (el corte de febrero es el 28)',
  cubFeb.desde === '2026-02-28' && cubFeb.hasta === '2026-03-29', JSON.stringify(cubFeb));

console.log('\n=== 3. El punto delicado: pagar un mes NO cubre el siguiente ===');
chk('pagó abril (corte 30) → vence 30 de mayo, no abril',
  v.vencimientoTrasPeriodo('2026-04', 30) === '2026-05-30', v.vencimientoTrasPeriodo('2026-04', 30));
chk('pagó abril (corte 15) → vence 15 de mayo',
  v.vencimientoTrasPeriodo('2026-04', 15) === '2026-05-15');
chk('pagó diciembre (corte 30) → vence 30 de enero del año siguiente',
  v.vencimientoTrasPeriodo('2025-12', 30) === '2026-01-30', v.vencimientoTrasPeriodo('2025-12', 30));
chk('pagó enero (corte 30) → vence 28 de febrero',
  v.vencimientoTrasPeriodo('2026-01', 30) === '2026-02-28');
chk('período inválido → null', v.vencimientoTrasPeriodo('2026-4', 30) === null);

console.log('\n=== 4. Vencimiento desde el alta (sin pagos) ===');
chk('alta 2026-03-10, ciclo 15 → 2026-03-15',
  v.vencimientoDesdeAlta('2026-03-10', 15) === '2026-03-15', v.vencimientoDesdeAlta('2026-03-10', 15));
chk('alta 2026-03-20, ciclo 15 → 2026-04-15',
  v.vencimientoDesdeAlta('2026-03-20', 15) === '2026-04-15', v.vencimientoDesdeAlta('2026-03-20', 15));
chk('alta exactamente el día de corte (2026-03-15, ciclo 15) → siguiente corte',
  v.vencimientoDesdeAlta('2026-03-15', 15) === '2026-04-15', v.vencimientoDesdeAlta('2026-03-15', 15));
chk('alta 2026-12-20, ciclo 30 → 2026-12-30',
  v.vencimientoDesdeAlta('2026-12-20', 30) === '2026-12-30');
chk('alta 2027-01-05, ciclo 30 → 2027-01-30',
  v.vencimientoDesdeAlta('2027-01-05', 30) === '2027-01-30');
chk('alta inválida → null', v.vencimientoDesdeAlta('10/03/2026', 30) === null);

console.log('\n=== 5. Fecha de cobro ≠ período cubierto ===');
chk('pago el 2026-03-20 con corte 30 → período 2026-03', v.periodoDePago('2026-03-20', 30) === '2026-03');
chk('pago el 2026-04-02 con corte 30 → período 2026-04', v.periodoDePago('2026-04-02', 30) === '2026-04');
chk('pago el 2026-05-20 con corte 15 → período 2026-06', v.periodoDePago('2026-05-20', 15) === '2026-06');
chk('pago el 2026-05-10 con corte 15 → período 2026-05', v.periodoDePago('2026-05-10', 15) === '2026-05');

console.log('\n=== 6. Propuesta con trazabilidad ===');
const prop1 = v.proponerVencimiento({ ultimoPeriodoPagado: '2026-04', ciclo: 30, periodosConMarcaNoPago: ['2026-05'] });
chk('propuesta usa el último período pagado', prop1.vencimiento === '2026-05-30' && prop1.origen === 'ULTIMO_PERIODO_PAGADO', JSON.stringify(prop1));
chk('avisa de las marcas de no pago sin llamarlas deuda',
  prop1.advertencias.some((a) => /no deuda|no confirmada|marca del dueño/i.test(a)), JSON.stringify(prop1.advertencias));
const prop2 = v.proponerVencimiento({ ciclo: 30, fechaAlta: '2026-06-10' });
chk('sin pagos usa el alta', prop2.vencimiento === '2026-06-30' && prop2.origen === 'FECHA_DE_ALTA', JSON.stringify(prop2));
const prop3 = v.proponerVencimiento({ ciclo: 7, ultimoPeriodoPagado: '2026-04' });
chk('ciclo inválido no calcula nada', prop3.vencimiento === null && prop3.origen === 'SIN_CALCULO', JSON.stringify(prop3));
const prop4 = v.proponerVencimiento({ ciclo: 30 });
chk('sin datos no inventa', prop4.vencimiento === null, JSON.stringify(prop4));

console.log('\n=== 7. IDs deterministas e idempotentes ===');
const id1 = p.idPropuesta(1, 12, '2026-04');
const id2 = p.idPropuesta(1, 12, '2026-04');
chk('el mismo origen da el mismo ID', id1 === id2, id1);
chk('el ID contiene hoja, fila y período', /^hist-h1-f0012-2026-04$/.test(id1), id1);
chk('fila distinta → ID distinto', p.idPropuesta(1, 13, '2026-04') !== id1);
chk('período distinto → ID distinto', p.idPropuesta(1, 12, '2026-05') !== id1);
chk('hoja 3 rechazada con error', (() => { try { p.idPropuesta(3, 1, '2026-04'); return false; } catch (e) { return true; } })());
chk('hoja 4 rechazada con error', (() => { try { p.idPropuesta(4, 1, '2026-04'); return false; } catch (e) { return true; } })());
chk('período con formato raro rechazado', (() => { try { p.idPropuesta(1, 1, 'abril'); return false; } catch (e) { return true; } })());
chk('marca de no pago tiene su propio ID', /^marca-h2-f0007-2026-03$/.test(p.idMarca(2, 7, '2026-03')));

console.log('\n=== 8. Importes: nada se convierte en pago confirmado ===');
chk('importe igual a la factura → inequívoca', p.clasificarImporte(50000, 50000).clase === 'COINCIDENCIA_INEQUIVOCA');
chk('importe menor → posible abono', p.clasificarImporte(30000, 50000).clase === 'POSIBLE_ABONO');
chk('importe mayor → extraordinario', p.clasificarImporte(100000, 50000).clase === 'PAGO_EXTRAORDINARIO');
chk('importe no legible → ambigua', p.clasificarImporte(null, 50000).clase === 'CELDA_AMBIGUA');
chk('sin valor de factura → inequívoca pero sin comparación', p.clasificarImporte(50000, null).clase === 'COINCIDENCIA_INEQUIVOCA');

console.log('\n=== 9. Construcción de propuestas ===');
const filas = [
  { hoja: 1, fila: 5, valorFactura: '50000', meses: [
    { periodo: '2026-03', clase: 'PAGO', monto: 50000 },
    { periodo: '2026-04', clase: 'PAGO', monto: 30000 },
    { periodo: '2026-05', clase: 'NO_PAGO' },
    { periodo: '2026-06', clase: 'AMBIGUO', monto: 50000 },
    { periodo: '2026-07', clase: 'VACIA' }] },
  { hoja: 2, fila: 9, valorFactura: '65000', meses: [
    { periodo: '2026-03', clase: 'PAGO', monto: 65000 },
    { periodo: '2026-04', clase: 'PAGO', monto: 130000 }] }
];
const emp = new Map([[5, { clienteId: 'cli-A', metodo: 'TELEFONO' }], [9, { clienteId: 'cli-B', metodo: 'TELEFONO' }]]);
const r = p.construirPropuestas(filas, emp);
chk('nace todo en estado PROPUESTA', r.propuestas.every((x) => x.estado === 'PROPUESTA'));
chk('nada nace como pago confirmado', !r.propuestas.some((x) => x.estado === 'CONFIRMADO'));
chk('XXXX se guarda como marca, no como propuesta',
  r.marcas.length === 1 && r.marcas[0].tipo === 'NO_PAGO_HISTORICO' && /no es deuda/i.test(r.marcas[0].advertencia),
  JSON.stringify(r.marcas[0]).slice(0, 120));
chk('la celda ambigua queda marcada para revisión',
  r.propuestas.some((x) => x.clase === 'CELDA_AMBIGUA' && x.requiereRevision === true));
chk('el abono parcial se distingue', r.propuestas.some((x) => x.clase === 'POSIBLE_ABONO'));
chk('el pago doble se distingue como extraordinario', r.propuestas.some((x) => x.clase === 'PAGO_EXTRAORDINARIO'));
chk('la celda vacía no genera nada', !r.propuestas.some((x) => x.periodo === '2026-07'));
chk('todas las propuestas llevan procedencia y referencia privada',
  r.propuestas.every((x) => x.origen === p.REFERENCIA && typeof x.referenciaPrivada === 'string'));
chk('no se copian credenciales, MAC ni IP',
  !JSON.stringify(r).match(/contrasen|contraseñ|usuario"|mac"|"ip"/i), 'ninguna clave sensible');

console.log('\n=== 10. Duplicados y clientes ambiguos ===');
const filasDup = [
  { hoja: 2, fila: 20, valorFactura: '50000', meses: [{ periodo: '2026-04', clase: 'PAGO', monto: 50000 }] },
  { hoja: 2, fila: 21, valorFactura: '50000', meses: [{ periodo: '2026-04', clase: 'PAGO', monto: 50000 }] }
];
const rDup = p.construirPropuestas(filasDup, new Map([[20, { clienteId: 'cli-X' }], [21, { clienteId: 'cli-X' }]]));
chk('el mismo cliente y período dos veces → DUPLICADO',
  rDup.propuestas.some((x) => x.clase === 'DUPLICADO' && x.requiereRevision), JSON.stringify(rDup.resumen));
chk('los dos IDs son distintos aunque sean el mismo dinero',
  rDup.propuestas[0].id !== rDup.propuestas[1].id);
/* Solo las celdas que en origen eran PAGO deben caer en estas clases:
   la celda ambigua conserva un importe pero su clase es CELDA_AMBIGUA. */
const pagosOrigen = filas[0].meses.filter((m) => m.clase === 'PAGO').map((m) => m.periodo);
const rSin = p.construirPropuestas([filas[0]], new Map());
chk('sin cliente único no se propone como cobro',
  rSin.propuestas.filter((x) => pagosOrigen.includes(x.periodo)).every((x) => x.clase === p.CLASES.SIN_CLIENTE));
const rLinea = p.construirPropuestas([filas[0]], new Map([[5, { clienteId: 'cli-A', duplicadoDeLinea: true }]]));
chk('cliente con varias líneas → revisión',
  rLinea.propuestas.filter((x) => pagosOrigen.includes(x.periodo)).every((x) => x.clase === 'CLIENTE_CON_VARIAS_LINEAS'));

console.log('\n=== 11. Hojas 3 y 4 rechazadas de forma explícita ===');
let rechazoHoja3 = false;
try { p.construirPropuestas([{ hoja: 3, fila: 1, valorFactura: '50000', meses: [{ periodo: '2026-04', clase: 'PAGO', monto: 50000 }] }], new Map()); }
catch (e) { rechazoHoja3 = /no autorizada/.test(e.message); }
chk('una fila de la hoja 3 detiene la importación', rechazoHoja3);
let rechazoHoja4 = false;
try { p.construirPropuestas([{ hoja: 4, fila: 1, valorFactura: '50000', meses: [] }], new Map()); }
catch (e) { rechazoHoja4 = /no autorizada/.test(e.message); }
chk('una fila de la hoja 4 detiene la importación', rechazoHoja4);

console.log('\n=== 12. Último período pagado por cliente ===');
const up = p.ultimoPeriodoPorCliente(r.propuestas);
chk('toma el período más reciente inequívoco', up.get('cli-A') === '2026-03', String(up.get('cli-A')));
chk('ignora abonos y ambiguas para el último período', up.get('cli-B') === '2026-03', String(up.get('cli-B')));

console.log('\n' + '='.repeat(78));
console.log(`PAGOS HISTÓRICOS · PRUEBAS PURAS: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
if (fail) console.log('  Fallan: ' + fallos.join(' | '));
console.log('='.repeat(78));
process.exit(fail ? 1 : 0);
