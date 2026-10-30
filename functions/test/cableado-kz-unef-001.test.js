'use strict';
/* Pruebas de CABLEADO de KZ-UNEF-001 — sin emulador.
 *
 * Las pruebas de integración de este proyecto necesitan el emulador de
 * Firestore (que exige Java). Mientras eso no se pueda ejecutar aquí, estos
 * controles verifican sobre el FUENTE que las correcciones siguen en su sitio y
 * que no ha vuelto el patrón defectuoso. No prueban comportamiento; prueban
 * que el código es el que se quería.
 *
 *   node test/cableado-kz-unef-001.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const indice = leer('src/index.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' Â· ' + e.message); }
}

console.log('=== 1. El cálculo del periodo NO está duplicado en index.js ===');

t('index.js importa renovacion.js', () => {
  assert.ok(/require\("\.\/renovacion"\)/.test(indice), 'falta el require de ./renovacion');
});

t('index.js ya no define sumarDias por su cuenta', () => {
  assert.ok(!/function sumarDias\s*\(/.test(indice), 'volvio a definirse sumarDias en index.js');
});

t('confirmarPago usa calcularPeriodo', () => {
  assert.ok(/calcularPeriodo\(\{/.test(indice), 'confirmarPago no usa calcularPeriodo');
});

t('NO vuelve el patron defectuoso fechaVencimiento || hoyISO()', () => {
  assert.ok(
    !/fechaInicio\s*=\s*cliente\.fechaVencimiento\s*\|\|/.test(indice),
    'volvio la renovacion desde el vencimiento viejo'
  );
});

console.log('\n=== 2. La confirmacion no falsea la fecha de pago ni la de alta ===');

t('confirmarPago ya no reescribe fechaPago', () => {
  const bloque = indice.slice(indice.indexOf('exports.confirmarPago'), indice.indexOf('exports.anularPago'));
  assert.ok(!/fechaPago:\s*hoyISO\(\)/.test(bloque), 'confirmarPago sigue pisando fechaPago');
});

t('confirmarPago no sobrescribe fechaInicioServicio sin condicion', () => {
  const bloque = indice.slice(indice.indexOf('exports.confirmarPago'), indice.indexOf('exports.anularPago'));
  assert.ok(!/fechaInicioServicio:\s*periodoInicio,/.test(bloque), 'confirmarPago sigue pisando la fecha de alta');
});

t('el historial del pago registra el estado del CLIENTE, no el del pago', () => {
  const bloque = indice.slice(indice.indexOf('exports.confirmarPago'), indice.indexOf('exports.anularPago'));
  assert.ok(/registrarHistorial\(pagoFinal\.clienteId,\s*estadoPrevioCliente/.test(bloque),
    'el historial sigue guardando el estado del pago');
});

console.log('\n=== 3. Anulacion atomica y guardas compartidas ===');

t('anularPago corre dentro de una transaccion', () => {
  const bloque = indice.slice(indice.indexOf('exports.anularPago'), indice.indexOf('MODULO: ESTADOS DE SERVICIO'));
  assert.ok(/db\.runTransaction/.test(bloque), 'anularPago no usa transaccion');
  assert.ok(/t\.update\(pagoRef/.test(bloque), 'la escritura no va por la transaccion');
});

t('anularPago ya no lee el estado fuera de la transaccion', () => {
  const bloque = indice.slice(indice.indexOf('exports.anularPago'), indice.indexOf('MODULO: ESTADOS DE SERVICIO'));
  assert.ok(!/await pagoRef\.get\(\)/.test(bloque), 'sigue leyendo con pagoRef.get() suelto');
});

t('index.js usa las guardas de pagos-guardas.js (deja de ser codigo muerto)', () => {
  assert.ok(/require\("\.\/pagos-guardas"\)/.test(indice), 'no importa ./pagos-guardas');
  assert.ok(/puedeAnular\(/.test(indice), 'no usa puedeAnular');
  assert.ok(/validarMonto\(/.test(indice), 'no usa validarMonto');
});

console.log('\n=== 4. El monto se valida por tipo y se guarda el numero ===');

t('registrarPago exige typeof monto === number', () => {
  assert.ok(/typeof monto !== "number"/.test(indice), 'no comprueba el tipo del monto');
});

t('se persiste montoNum, no el valor original', () => {
  assert.ok(/monto:\s*montoNum/.test(indice), 'sigue guardando el monto sin normalizar');
});

t('hay antiduplicado por referencia', () => {
  assert.ok(/where\("referencia", "==", referenciaLimpia\)/.test(indice), 'falta la comprobacion de referencia repetida');
});

console.log('\n=== 5. Estados de servicio atomicos e idempotentes ===');

t('cambiarEstadoCliente escribe cliente y servicio en un lote', () => {
  const bloque = indice.slice(indice.indexOf('async function cambiarEstadoCliente'), indice.indexOf('exports.activarServicio'));
  assert.ok(/db\.batch\(\)/.test(bloque), 'no usa lote');
  assert.ok(/lote\.commit\(\)/.test(bloque), 'no confirma el lote');
});

t('cambiarEstadoCliente es idempotente', () => {
  const bloque = indice.slice(indice.indexOf('async function cambiarEstadoCliente'), indice.indexOf('exports.activarServicio'));
  assert.ok(/sinCambios: true/.test(bloque), 'no evita reescribir el mismo estado');
});

t('actualiza TODOS los servicios del cliente, no solo el primero', () => {
  const bloque = indice.slice(indice.indexOf('async function cambiarEstadoCliente'), indice.indexOf('exports.activarServicio'));
  assert.ok(/for \(const doc of servicios\.docs\)/.test(bloque), 'solo actualiza el primer servicio');
});

console.log('\n=== 6. La validacion de precioMensual no convierte basura en 0 ===');

t('no queda la limpieza replace(/[^\\d.-]/g)', () => {
  assert.ok(!/replace\(\/\[\^\\d\.-\]\/g/.test(indice), 'sigue limpiando el texto y convirtiendo "" en 0');
});

t('se valida el texto del importe con /^\\d+$/', () => {
  assert.ok(/\^\\d\+\$/.test(indice), 'no valida que el texto sea solo digitos');
});

console.log('\n=== 7. Los indices que las consultas necesitan estan declarados ===');

const indices = JSON.parse(leer('../firestore.indexes.json'));
const pagos = (indices.indexes || []).filter((i) => i.collectionGroup === 'pagos');
const tieneCampos = (campos) => pagos.some((i) => {
  const f = (i.fields || []).map((x) => x.fieldPath);
  return campos.every((c) => f.includes(c));
});

t('indice para pagoCubre (clienteId + estado + periodoFin)', () => {
  assert.ok(tieneCampos(['clienteId', 'estado', 'periodoFin']), 'falta el indice de periodoFin');
});

t('indice para el antiduplicado (clienteId + referencia + estado)', () => {
  assert.ok(tieneCampos(['clienteId', 'referencia', 'estado']), 'falta el indice de referencia');
});

/* El ORDEN importa: un indice compuesto solo sirve si los campos de igualdad
   van ANTES que el de rango. Si alguien reordena el JSON, la consulta deja de
   usar el indice y Firestore responde FAILED_PRECONDITION. */
const camposDe = (pred) => {
  const i = pagos.find(pred);
  return i ? (i.fields || []).map((x) => x.fieldPath) : null;
};

t('el indice de pagoCubre deja el rango (periodoFin) AL FINAL', () => {
  const f = camposDe((i) => (i.fields || []).some((x) => x.fieldPath === 'periodoFin'));
  assert.ok(f, 'no existe indice con periodoFin');
  assert.strictEqual(f[f.length - 1], 'periodoFin', 'periodoFin debe ser el ultimo campo: ' + f.join(','));
  assert.deepStrictEqual(f.slice(0, 2).sort(), ['clienteId', 'estado'], 'las igualdades van antes: ' + f.join(','));
});

t('el indice del antiduplicado tiene los tres campos', () => {
  const f = camposDe((i) => (i.fields || []).some((x) => x.fieldPath === 'referencia'));
  assert.ok(f, 'no existe indice con referencia');
  assert.deepStrictEqual(f.slice().sort(), ['clienteId', 'estado', 'referencia'], 'campos inesperados: ' + f.join(','));
});

t('firebase.json despliega ese mismo archivo de indices y de reglas', () => {
  const conf = JSON.parse(leer('../firebase.json'));
  assert.strictEqual(conf.firestore.indexes, 'firestore.indexes.json');
  assert.strictEqual(conf.firestore.rules, 'firestore.rules');
});

t('las dos consultas nuevas tienen su indice y coinciden con lo declarado', () => {
  assert.ok(/where\("clienteId", "==", cliente\.id\)[\s\S]{0,220}where\("estado", "==", ESTADO_PAGO\.CONFIRMADO\)[\s\S]{0,220}where\("periodoFin", ">=", hoyISO\(\)\)/.test(indice),
    'la consulta de pagoCubre no coincide con lo esperado');
  assert.ok(/where\("clienteId", "==", clienteId\)[\s\S]{0,220}where\("referencia", "==", referenciaLimpia\)[\s\S]{0,220}where\("estado", "in",/.test(indice),
    'la consulta del antiduplicado no coincide con lo esperado');
});

console.log('\n=== 8. Las notificaciones registran su entrega real ===');

t('existe marcarEntregaPush', () => {
  assert.ok(/async function marcarEntregaPush/.test(indice), 'no existe marcarEntregaPush');
});

/* KZ-UNEF-028 · El motor ya no calcula la ventana dentro del bucle: delega en
   src/recordatorios.js, que es puro y tiene su propia batería
   (test/recordatorios.test.js, 22 comprobaciones). Aquí se comprueba que el
   cableado sigue existiendo: el motor decide, marca la entrega real y no envía
   nada a quien ya pagó. */
t('se marca el resultado en los envios del motor', () => {
  const llamadas = (indice.match(/await marcarEntregaPush\(/g) || []).length;
  assert.ok(llamadas >= 2, 'se esperaban al menos 2 marcas del motor y hay ' + llamadas);
});

t('el motor delega los recordatorios en el modulo probado', () => {
  assert.ok(/decidirRecordatorios\(/.test(indice), 'el motor no usa decidirRecordatorios');
  assert.ok(/pagoConfirmadoCubreCorte\(/.test(indice), 'el motor no comprueba el pago confirmado');
});

t('registrarNotificacion devuelve la referencia del documento', () => {
  assert.ok(/const ref = await db\.collection\("notificaciones"\)\.add\(/.test(indice), 'no devuelve la referencia');
  assert.ok(/return ref;/.test(indice), 'no hace return ref');
});

t('el envio manual no escribe ENVIADA si no salio nada', () => {
  const bloque = indice.slice(indice.indexOf('exports.enviarNotificacion'));
  assert.ok(/estado: enviados > 0 \? ESTADO_NOTIFICACION\.ENVIADA : ESTADO_NOTIFICACION\.ERROR/.test(bloque),
    'sigue escribiendo ENVIADA sin condición');
});

t('los errores de FCM no reconocidos se registran', () => {
  assert.ok(/Envío push falló/.test(indice), 'no hay log del fallo de FCM');
});

console.log('\n=== 9. El recordatorio tiene ventana de recuperacion ===');

/* KZ-UNEF-028 · La ventana ya no está escrita como condición dentro del motor:
   vive en src/recordatorios.js (enVentana / decidirRecordatorios) y se prueba
   caso por caso en test/recordatorios.test.js. Aquí se comprueba que la regla
   nueva está cableada y que la antigua igualdad exacta no sobrevive. */
t('el motor ya no exige el dia exacto suelto', () => {
  assert.ok(!/if \(diasAviso > n \|\| diasAviso < 0\) continue;/.test(indice), 'sigue el bucle viejo con igualdad exacta');
  assert.ok(/decidirRecordatorios\(\{/.test(indice), 'el motor no llama a la decisión probada');
});

t('la ventana de recuperación está en el módulo probado', () => {
  const mod = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'recordatorios.js'), 'utf8');
  assert.ok(/function enVentana/.test(mod), 'no existe enVentana');
  assert.ok(/VENTANA_PREVIO/.test(mod) && /VENTANA_CORTE/.test(mod), 'faltan las ventanas');
});

t('el cron del motor tiene timeout propio', () => {
  assert.ok(/timeoutSeconds: 540, memory: "512MB"/.test(indice), 'el cron no tiene timeout ampliado');
});

console.log('\n  TOTAL ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }
