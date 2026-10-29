'use strict';
/* ============================================================
 * KZ-UNEF-028 · Recordatorios de pago — regla definitiva del propietario
 * ------------------------------------------------------------
 * Pruebas puras (sin emulador, sin red, sin credenciales):
 *     node test/recordatorios.test.js
 *
 * Lo que se demuestra aquí:
 *   · EXACTAMENTE dos avisos por vencimiento, y solo dos.
 *   · Corte 15 → avisos el 12 y el 15.  Corte 30 → avisos el 27 y el 30.
 *   · Febrero (sin día 30) → corte el último día real y aviso 3 días antes.
 *   · Sin duplicados: la clave de deduplicación es estable.
 *   · Con pago confirmado no sale ningún aviso.
 *   · La ventana de recuperación no convierte dos avisos en tres.
 *   · Las palabras del propietario: Pendiente / Enviado / Fallido.
 * ============================================================ */
const assert = require('assert');
const r = require('../src/recordatorios.js');
const cortes = require('../src/cortes.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' · ' + e.message); }
}

console.log('=== 1. Los dos avisos de cada corte ===');

t('corte 15 → avisos el 12 y el 15', () => {
  const [previo, corte] = r.recordatoriosDelCorte('2026-11-15', '15');
  assert.strictEqual(previo.fecha, '2026-11-12');
  assert.strictEqual(corte.fecha, '2026-11-15');
});

t('corte 30 → avisos el 27 y el 30', () => {
  const [previo, corte] = r.recordatoriosDelCorte('2026-10-30', '30');
  assert.strictEqual(previo.fecha, '2026-10-27');
  assert.strictEqual(corte.fecha, '2026-10-30');
});

t('siempre son DOS, ni uno ni tres', () => {
  for (const [corteISO, ciclo] of [['2026-11-15', '15'], ['2026-10-30', '30'], ['2027-02-28', '30'], ['2027-01-15', '15']]) {
    const lista = r.recordatoriosDelCorte(corteISO, ciclo);
    assert.strictEqual(lista.length, 2, 'corte ' + corteISO + ' devolvió ' + lista.length);
    assert.deepStrictEqual(lista.map((x) => x.clave), ['previo', 'corte']);
  }
});

t('el aviso previo cae siempre 3 días antes', () => {
  for (const corteISO of ['2026-11-15', '2026-10-30', '2026-12-15', '2027-03-30']) {
    const [previo, corte] = r.recordatoriosDelCorte(corteISO);
    assert.strictEqual(previo.fecha, r.sumarDias(corte.fecha, -3), 'corte ' + corteISO);
  }
});

t('los tipos son los que ya usa la colección notificaciones', () => {
  const [previo, corte] = r.recordatoriosDelCorte('2026-11-15', '15');
  assert.strictEqual(previo.tipo, 'CORTE_15_3_DIAS');
  assert.strictEqual(corte.tipo, 'CORTE_15_VENCIDO');
});

console.log('\n=== 2. Febrero: el mes que no tiene día 30 ===');

t('febrero de año común: corte el 28 y aviso el 25', () => {
  const corte = r.fechaCorteDelPeriodo('2027-02', '30');
  assert.strictEqual(corte, '2027-02-28');
  const [previo] = r.recordatoriosDelCorte(corte, '30');
  assert.strictEqual(previo.fecha, '2027-02-25');
  assert.strictEqual(r.ultimoDiaDelMesDe('2027-02-10'), 28);
});

t('febrero bisiesto: corte el 29 y aviso el 26', () => {
  const corte = r.fechaCorteDelPeriodo('2028-02', '30');
  assert.strictEqual(corte, '2028-02-29');
  const [previo] = r.recordatoriosDelCorte(corte, '30');
  assert.strictEqual(previo.fecha, '2028-02-26');
  assert.strictEqual(r.ultimoDiaDelMesDe('2028-02-10'), 29);
});

t('el ciclo 15 no depende de la longitud del mes', () => {
  assert.strictEqual(r.fechaCorteDelPeriodo('2027-02', '15'), '2027-02-15');
  assert.strictEqual(r.fechaCorteDelPeriodo('2028-02', '15'), '2028-02-15');
});

t('el corte de cada mes coincide con la regla de cortes.js', () => {
  for (const ciclo of ['15', '30']) {
    for (const desde of ['2026-10-29', '2026-11-16', '2027-02-01', '2027-02-20', '2028-02-20']) {
      const pc = cortes.proximoCorteDe(ciclo, desde);
      const esperado = r.fechaCorteDelPeriodo(String(pc).slice(0, 7), ciclo);
      assert.strictEqual(pc, esperado, ciclo + ' desde ' + desde);
    }
  }
});

console.log('\n=== 3. Sin duplicados y sin avisos a quien ya pagó ===');

t('la clave de deduplicación es estable entre corridas', () => {
  const a = r.claveDedup('cli-1', 'corte-15-2026-11-15', 'CORTE_15_3_DIAS');
  const b = r.claveDedup('cli-1', 'corte-15-2026-11-15', 'CORTE_15_3_DIAS');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, r.claveDedup('cli-2', 'corte-15-2026-11-15', 'CORTE_15_3_DIAS'));
  assert.notStrictEqual(a, r.claveDedup('cli-1', 'corte-15-2026-12-15', 'CORTE_15_3_DIAS'));
});

t('el día del aviso previo se envía el primero y solo ese', () => {
  const hoy = '2026-11-12';
  const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: [], pagoConfirmado: false });
  assert.deepStrictEqual(d.map((x) => [x.recordatorio.clave, x.accion]), [['previo', 'enviar'], ['corte', 'omitir']]);
});

t('el día del corte se envía el segundo y solo ese', () => {
  const hoy = '2026-11-15';
  const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: ['previo'], pagoConfirmado: false });
  assert.deepStrictEqual(d.map((x) => [x.recordatorio.clave, x.accion]), [['previo', 'omitir'], ['corte', 'enviar']]);
});

t('correr el motor dos veces el mismo día no repite el aviso', () => {
  const hoy = '2026-11-12';
  const primera = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: [], pagoConfirmado: false });
  const enviados = primera.filter((x) => x.accion === 'enviar').map((x) => x.recordatorio.clave);
  const segunda = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: enviados, pagoConfirmado: false });
  assert.ok(segunda.every((x) => x.accion === 'omitir'));
  assert.strictEqual(segunda.find((x) => x.recordatorio.clave === 'previo').motivo, 'ya enviado en este corte');
});

t('con pago confirmado del período no sale ninguno, ni antes ni el día del corte', () => {
  for (const hoy of ['2026-11-12', '2026-11-14', '2026-11-15', '2026-11-16']) {
    const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: [], pagoConfirmado: true });
    assert.ok(d.every((x) => x.accion === 'omitir'), 'hoy ' + hoy);
    assert.strictEqual(d[0].motivo, 'pago confirmado del período');
  }
});

t('un día sin nada programado no envía nada', () => {
  for (const hoy of ['2026-11-01', '2026-11-08', '2026-11-11', '2026-11-20']) {
    const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: [], pagoConfirmado: false });
    assert.ok(d.every((x) => x.accion === 'omitir'), 'hoy ' + hoy);
  }
});

console.log('\n=== 4. Ventana de recuperación: si una corrida falla, el aviso no se pierde ===');

t('el aviso previo se recupera el día anterior al corte', () => {
  const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy: '2026-11-14', yaEnviados: [], pagoConfirmado: false });
  assert.strictEqual(d[0].accion, 'enviar');
});

t('el aviso previo NO se envía el día del corte', () => {
  const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy: '2026-11-15', yaEnviados: [], pagoConfirmado: false });
  assert.strictEqual(d[0].accion, 'omitir');
  assert.strictEqual(d[1].accion, 'enviar');
});

t('el aviso del corte se recupera hasta dos días después', () => {
  for (const [hoy, accion] of [['2026-11-15', 'enviar'], ['2026-11-16', 'enviar'], ['2026-11-17', 'enviar'], ['2026-11-18', 'omitir']]) {
    const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: [], pagoConfirmado: false });
    assert.strictEqual(d[1].accion, accion, 'hoy ' + hoy);
  }
});

t('en un período completo nunca se envían más de dos', () => {
  const enviados = [];
  let total = 0;
  for (let dia = 1; dia <= 30; dia++) {
    const hoy = '2026-11-' + String(dia).padStart(2, '0');
    const d = r.decidirRecordatorios({ corteISO: '2026-11-15', ciclo: '15', hoy, yaEnviados: enviados.slice(), pagoConfirmado: false });
    for (const x of d) {
      if (x.accion === 'enviar') { enviados.push(x.recordatorio.clave); total++; }
    }
  }
  assert.strictEqual(total, 2, 'se enviaron ' + total + ' avisos: ' + enviados.join(','));
});

console.log('\n=== 5. Palabras para el propietario ===');

t('el estado interno se traduce a Pendiente / Enviado / Fallido', () => {
  assert.strictEqual(r.palabraEstado('PENDIENTE'), 'Pendiente');
  assert.strictEqual(r.palabraEstado('ENVIADA'), 'Enviado');
  assert.strictEqual(r.palabraEstado('ERROR'), 'Fallido');
  assert.strictEqual(r.palabraEstado('CANCELADA'), 'Cancelado');
  assert.strictEqual(r.palabraEstado(undefined), 'Sin estado');
});

t('el resumen dice qué avisos tiene el cliente y cuándo', () => {
  const resumen = r.resumenParaPropietario({
    corteISO: '2026-11-15', ciclo: '15', hoy: '2026-11-12',
    estados: { previo: 'ENVIADA', corte: 'PENDIENTE' }
  });
  assert.strictEqual(resumen.corte, '2026-11-15');
  assert.deepStrictEqual(resumen.enPalabras.map((x) => x.estado), ['Enviado', 'Pendiente']);
  assert.deepStrictEqual(resumen.enPalabras.map((x) => x.cuando), ['3 días antes del corte', 'Día del corte']);
});

console.log('\n=== 6. La zona horaria y la hora son las del propietario ===');

t('zona America/Bogota y hora 10', () => {
  assert.strictEqual(r.ZONA, 'America/Bogota');
  assert.strictEqual(r.HORA_ENVIO, 10);
  assert.strictEqual(r.DIAS_ANTES, 3);
});

console.log('\n== Resumen ==');
console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
