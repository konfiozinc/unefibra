'use strict';
/* ============================================================
 * KZ-UNEF-031 · Paridad de reglas: navegador vs servidor
 * ------------------------------------------------------------
 * El panel decide "qué falta confirmar" con assets/js/admin/revision-reglas.js y
 * el servidor valida con functions/src/revision-comercial.js. Si las dos copias
 * se separan, el propietario ve una cosa y el servidor guarda otra.
 *
 * Esta prueba recorre un conjunto amplio de fechas, ciclos y precios y exige que
 * las dos implementaciones respondan EXACTAMENTE igual.
 *
 *     node test/revision-reglas-paridad.test.js
 * ============================================================ */
const assert = require('assert');
const path = require('node:path');
const servidor = require('../src/revision-comercial.js');
const navegador = require(path.join(__dirname, '..', '..', 'assets', 'js', 'admin', 'revision-reglas.js'));

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}

const FECHAS = [];
for (const anio of [2026, 2027, 2028]) {
  for (let mes = 1; mes <= 12; mes++) {
    for (const dia of [1, 14, 15, 16, 28, 29, 30, 31]) {
      FECHAS.push(`${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
    }
  }
}

console.log('=== 1. Días de corte y último día del mes ===');

t('misma respuesta al preguntar si es día de corte (' + FECHAS.length + ' fechas × 2 ciclos)', () => {
  let comparadas = 0;
  for (const f of FECHAS) {
    for (const ciclo of ['15', '30']) {
      assert.strictEqual(navegador.esDiaDeCorteDe(f, ciclo), servidor.esDiaDeCorteDe(f, ciclo), 'difiere en ' + f + ' ciclo ' + ciclo);
      comparadas++;
    }
  }
  assert.ok(comparadas === FECHAS.length * 2);
});

t('mismo último día de mes en los tres años', () => {
  for (const f of FECHAS) {
    assert.strictEqual(navegador.ultimoDiaDe(f), servidor.ultimoDiaDe(f), 'difiere en ' + f);
  }
});

t('febrero de 2028 (bisiesto) coincide', () => {
  assert.strictEqual(navegador.ultimoDiaDe('2028-02-01'), 29);
  assert.strictEqual(servidor.ultimoDiaDe('2028-02-01'), 29);
  assert.strictEqual(navegador.esDiaDeCorteDe('2028-02-29', '30'), true);
  assert.strictEqual(servidor.esDiaDeCorteDe('2028-02-29', '30'), true);
});

console.log('\n=== 2. Próximo corte ===');

t('mismo próximo corte para todas las fechas y ambos ciclos', () => {
  for (const f of FECHAS) {
    for (const ciclo of ['15', '30']) {
      assert.strictEqual(navegador.proximoCorteDe(ciclo, f), servidor.proximoCorteDe(ciclo, f), 'difiere en ' + f + ' ciclo ' + ciclo);
    }
  }
});

t('ninguno desplaza el corte con "+30 días"', () => {
  for (const f of FECHAS) {
    for (const ciclo of ['15', '30']) {
      const p = servidor.proximoCorteDe(ciclo, f);
      assert.ok(servidor.esDiaDeCorteDe(p, ciclo), 'el resultado debe caer en el día de corte: ' + f + ' -> ' + p);
    }
  }
});

console.log('\n=== 3. Motivos de revisión ===');

t('los mismos motivos para combinaciones de plan, precio, ciclo y fecha', () => {
  const precios = [undefined, 0, 30000, -5];
  const ciclos = [undefined, '15', '30'];
  let casos = 0;
  for (const fecha of ['2026-11-30', '2026-11-14', '2026-02-28', null]) {
    for (const precio of precios) {
      for (const ciclo of ciclos) {
        const entrada = {
          servicio: { planId: 'p1', cicloCorte: ciclo, precioMensual: precio, fechaVencimiento: fecha, fechaAlta: '2026-10-06' },
          cliente: {},
          plan: { precio: 40000 }
        };
        const a = navegador.motivosDeRevision(entrada);
        const b = servidor.motivosDeRevision(entrada);
        assert.deepStrictEqual(a, b, 'difieren con fecha=' + fecha + ' precio=' + precio + ' ciclo=' + ciclo);
        casos++;
      }
    }
  }
  assert.ok(casos >= 40, 'se compararon ' + casos + ' combinaciones');
});

t('sin plan en ninguno de los dos lados', () => {
  const entrada = { servicio: { cicloCorte: '30', precioMensual: 1000, fechaVencimiento: '2026-11-30' }, cliente: {} };
  assert.deepStrictEqual(navegador.motivosDeRevision(entrada), servidor.motivosDeRevision(entrada));
  assert.ok(servidor.motivosDeRevision(entrada).includes('SIN_PLAN'));
});

t('las etiquetas de texto existen en ambas copias', () => {
  for (const clave of Object.keys(servidor.TEXTO)) {
    assert.ok(navegador.TEXTO[clave], 'falta el texto de ' + clave + ' en el navegador');
    assert.strictEqual(navegador.TEXTO[clave], servidor.TEXTO[clave], 'texto distinto en ' + clave);
  }
});

console.log('\n== Resumen ==');
console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
