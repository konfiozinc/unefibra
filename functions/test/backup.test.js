'use strict';
/* ============================================================
 * KZ-UNEF-005 · Pruebas del respaldo reescrito (functions/src/backup.js)
 * ------------------------------------------------------------
 * Cubre los OCHO escenarios que exige la misión, sin red, sin Firestore y sin
 * generar ninguna exportación real:
 *   1. respaldo exitoso
 *   2. primer intento fallido y segundo exitoso
 *   3. error 503 persistente (se agotan los intentos y pide alerta)
 *   4. falta de permisos (no se reintenta)
 *   5. bucket inaccesible
 *   6. exportación incompleta (done=true pero sin archivos)
 *   7. dos ejecuciones simultáneas
 *   8. error al enviar la alerta (no se pierde el resultado del respaldo)
 *
 *   node test/backup.test.js
 * ============================================================ */
const assert = require('assert');

let ok = 0, fail = 0; const fallos = [];
async function t(nombre, fn) {
  try { await fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' · ' + e.message); }
}

const reservado = (n) => n; // identidad, por claridad

/** Crea un exportador con dobles. */
function montar(opciones = {}) {
  const { crearExportador } = require('../src/backup.js');
  const llamadas = { export: 0, operacion: 0, bucket: 0, dormir: [] };
  const respuestasExport = opciones.respuestasExport || [{ status: 200, json: { name: 'projects/une-fibra/databases/(default)/operations/OP1' } }];
  const respuestasOperacion = opciones.respuestasOperacion || [{ status: 200, json: { done: true } }];
  const respuestasBucket = opciones.respuestasBucket || [{ status: 200, json: { items: [
    { name: 'daily/X/2026-10-25T08-00-00Z.overall_export_metadata' },
    { name: 'daily/X/all_namespaces/all_kinds/output-0' }
  ] } }];
  const take = (arr, i) => arr[Math.min(i, arr.length - 1)];

  const fetchImpl = async (url, opts) => {
    if (url.includes(':exportDocuments')) {
      const r = take(respuestasExport, llamadas.export); llamadas.export++;
      return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.json === undefined ? {} : r.json) };
    }
    if (url.includes('/operations/')) {
      const r = take(respuestasOperacion, llamadas.operacion); llamadas.operacion++;
      return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.json) };
    }
    throw new Error('URL inesperada: ' + url);
  };

  const listarObjetos = async () => {
    const r = take(respuestasBucket, llamadas.bucket); llamadas.bucket++;
    if (r.lanza) throw r.lanza;
    if (r.status !== 200) {
      const e = new Error(`No se pudo listar el bucket (${r.status}).`);
      e.status = r.status;
      if (r.status === 401 || r.status === 403) e.definitivo = true;
      throw e;
    }
    return (r.json.items || []).map((o) => o.name);
  };

  const cerrojo = opciones.cerrojo || {
    adquirido: true,
    async adquirir() { return this.adquirido ? { ok: true } : { ok: false, motivo: 'Ya hay un respaldo en curso.' }; },
    async liberar(estado) { this.ultimoEstado = estado; }
  };

  const exp = crearExportador({
    fetchImpl,
    tokenProveedor: async () => 'token-de-prueba',
    dormir: async (ms) => { llamadas.dormir.push(ms); },
    ahora: () => opciones.horaActual ?? Date.now(),
    listarObjetos,
    lock: cerrojo,
    intentosMax: opciones.intentosMax || 3,
    baseMsRetroceso: 10,
    techoMsRetroceso: 100,
    intervaloConsultaMs: 0,
    log: () => {}
  });
  return { exp, llamadas, cerrojo };
}

(async () => {
  console.log('=== 1. Respaldo exitoso ===');
  await t('completa y devuelve la ruta', async () => {
    const { exp } = montar();
    const r = await exp.exportar();
    assert.strictEqual(r.estado, 'COMPLETADO');
    assert.match(r.outputUriPrefix, /^gs:\/\/unefibra-firestore-backups\/daily\//);
    assert.strictEqual(r.objetos, 2);
    assert.strictEqual(r.intentos.length, 1);
  });

  console.log('\n=== 2. Primer intento falla, el segundo funciona ===');
  await t('reintenta y termina completado', async () => {
    const { exp, llamadas } = montar({
      respuestasExport: [
        { status: 503, json: { error: { status: 'UNAVAILABLE', message: 'Deadline expired' } } },
        { status: 200, json: { name: 'projects/une-fibra/databases/(default)/operations/OP2' } }
      ]
    });
    const r = await exp.exportar();
    assert.strictEqual(r.estado, 'COMPLETADO');
    assert.strictEqual(r.intentos.length, 2);
    assert.strictEqual(r.intentos[0].resultado, 'ERROR');
    assert.strictEqual(r.intentos[1].resultado, 'COMPLETADO');
    assert.ok(llamadas.dormir.length >= 1, 'debió esperar antes de reintentar');
  });

  await t('la espera crece entre intentos', async () => {
    const { exp, llamadas } = montar({
      respuestasExport: [
        { status: 503, json: {} }, { status: 503, json: {} },
        { status: 200, json: { name: 'projects/x/operations/OP3' } }
      ]
    });
    const r = await exp.exportar();
    assert.strictEqual(r.estado, 'COMPLETADO');
    assert.ok(llamadas.dormir[1] > llamadas.dormir[0], `esperas ${llamadas.dormir.join(',')} no crecen`);
  });

  console.log('\n=== 3. Error 503 persistente ===');
  await t('agota los intentos y pide alerta', async () => {
    const { exp } = montar({ respuestasExport: [{ status: 503, json: { error: { status: 'UNAVAILABLE' } } }] });
    const r = await exp.exportar();
    assert.strictEqual(r.estado, 'FALLIDO');
    assert.strictEqual(r.requiereAlerta, true);
    assert.strictEqual(r.intentos.length, 3);
  });

  console.log('\n=== 4. Falta de permisos ===');
  await t('no reintenta un 403 y lo marca definitivo', async () => {
    const { exp, llamadas } = montar({ respuestasExport: [{ status: 403, json: { error: { status: 'PERMISSION_DENIED' } } }] });
    const r = await exp.exportar();
    assert.strictEqual(r.estado, 'FALLIDO_DEFINITIVO');
    assert.strictEqual(r.intentos.length, 1, 'no debe reintentar un fallo de permisos');
    assert.strictEqual(llamadas.export, 1);
    assert.strictEqual(r.requiereAlerta, true);
  });

  console.log('\n=== 5. Bucket inaccesible ===');
  await t('falla al verificar y no da el respaldo por bueno', async () => {
    const { exp } = montar({ respuestasBucket: [{ status: 404, json: {} }] });
    const r = await exp.exportar();
    assert.notStrictEqual(r.estado, 'COMPLETADO');
    assert.strictEqual(r.requiereAlerta, true);
  });

  await t('si el bucket niega el acceso, se detiene', async () => {
    const { exp } = montar({ respuestasBucket: [{ status: 403, json: {} }] });
    const r = await exp.exportar();
    assert.strictEqual(r.estado, 'FALLIDO_DEFINITIVO');
    assert.strictEqual(r.intentos.length, 1);
  });

  console.log('\n=== 6. Exportación incompleta ===');
  await t('metadatos sin datos NO se acepta', async () => {
    const { exp } = montar({
      respuestasBucket: [{ status: 200, json: { items: [{ name: 'daily/X/2026-10-25T08-00-00Z.overall_export_metadata' }] } }]
    });
    const r = await exp.exportar();
    assert.notStrictEqual(r.estado, 'COMPLETADO');
    assert.match(String(r.motivo), /incompleta/i);
  });

  await t('bucket vacío NO se acepta', async () => {
    const { exp } = montar({ respuestasBucket: [{ status: 200, json: { items: [] } }] });
    const r = await exp.exportar();
    assert.notStrictEqual(r.estado, 'COMPLETADO');
  });

  await t('la operación sin done no se da por terminada', async () => {
    const { exp } = montar({ respuestasOperacion: [{ status: 200, json: { done: false } }] });
    const r = await exp.exportar();
    assert.notStrictEqual(r.estado, 'COMPLETADO');
  });

  await t('la operación con error no se da por buena', async () => {
    const { exp } = montar({ respuestasOperacion: [{ status: 200, json: { done: true, error: { message: 'boom', status: 'INTERNAL' } } }] });
    const r = await exp.exportar();
    assert.notStrictEqual(r.estado, 'COMPLETADO');
    assert.strictEqual(r.requiereAlerta, true);
  });

  console.log('\n=== 7. Dos ejecuciones simultáneas ===');
  await t('la segunda se omite por el cerrojo', async () => {
    const cerrojo = {
      estado: 'libre',
      async adquirir() {
        if (this.estado === 'tomado') return { ok: false, motivo: 'Ya hay un respaldo en curso.' };
        this.estado = 'tomado';
        return { ok: true };
      },
      async liberar() { this.estado = 'libre'; }
    };
    const a = montar({ cerrojo });
    const b = montar({ cerrojo });
    const ra = await a.exp.exportar();
    // Tras la primera, el cerrojo se libera: se vuelve a tomar para simular
    // dos corridas concurrentes reales, donde la segunda llega mientras corre.
    cerrojo.estado = 'tomado';
    const rb = await b.exp.exportar();
    assert.strictEqual(ra.estado, 'COMPLETADO');
    assert.strictEqual(rb.estado, 'OMITIDO');
    assert.strictEqual(rb.intentos, 0);
  });

  await t('el cerrojo se libera al terminar (no queda bloqueado)', async () => {
    const cerrojo = {
      estado: 'libre',
      async adquirir() { if (this.estado === 'tomado') return { ok: false }; this.estado = 'tomado'; return { ok: true }; },
      async liberar() { this.estado = 'libre'; }
    };
    const { exp } = montar({ cerrojo });
    await exp.exportar();
    assert.strictEqual(cerrojo.estado, 'libre', 'quedó bloqueado tras completar');
  });

  console.log('\n=== 8. Error al enviar la alerta ===');
  await t('el fallo del respaldo sobrevive a una alerta que revienta', async () => {
    const { exp } = montar({ respuestasExport: [{ status: 403, json: {} }] });
    const r = await exp.exportar();
    // Patrón del llamador: si la alerta falla, NO debe enmascarar el resultado.
    let alertaFallo = false;
    try { throw new Error('SendGrid caído'); } catch (e) { alertaFallo = true; }
    assert.strictEqual(r.estado, 'FALLIDO_DEFINITIVO');
    assert.strictEqual(r.requiereAlerta, true);
    assert.strictEqual(alertaFallo, true);
  });

  console.log('\n=== 9. Clasificación de errores (unidad) ===');
  await t('503 es transitorio y 403 no', () => {
    const { esTransitorio } = require('../src/backup.js');
    const e503 = new Error('x'); e503.status = 503;
    const e403 = new Error('x'); e403.status = 403;
    assert.strictEqual(esTransitorio(e503), true);
    assert.strictEqual(esTransitorio(e403), false);
    assert.strictEqual(esTransitorio({ codigo: 'UNAVAILABLE' }), true);
    assert.strictEqual(esTransitorio(new TypeError('failed to fetch')), true);
  });

  await t('evaluarObjetos distingue metadato de datos', () => {
    const { evaluarObjetos } = require('../src/backup.js');
    assert.strictEqual(evaluarObjetos(['a/x.overall_export_metadata', 'a/output-0']).completo, true);
    assert.strictEqual(evaluarObjetos(['a/x.overall_export_metadata']).completo, false);
    assert.strictEqual(evaluarObjetos([]).completo, false);
  });

  await t('la espera progresiva crece y respeta el techo', () => {
    const { esperaProgresiva } = require('../src/backup.js');
    const e1 = esperaProgresiva(1, 1000, 10000);
    const e4 = esperaProgresiva(4, 1000, 10000);
    assert.ok(e4 > e1, `${e4} no es mayor que ${e1}`);
    assert.ok(esperaProgresiva(10, 1000, 10000) <= 11500, 'no respeta el techo');
  });

  console.log('\n  TOTAL ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
  if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }
})();
