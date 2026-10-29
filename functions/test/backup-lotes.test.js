'use strict';
/* ============================================================
 * KZ-UNEF-028 · Respaldo por lotes: pruebas sin bucket ni Firestore reales
 * ------------------------------------------------------------
 * El defecto: la exportación de la base entera tardaba 536,8 s y la función
 * (gen 1, 540 s) moría sin poder verificar el respaldo. Aquí se prueba el diseño
 * que lo resuelve, con un reloj y una API de Firestore SIMULADOS:
 *
 *   · el presupuesto de tiempo de cada invocación se respeta;
 *   · la corrida se reanuda donde quedó, sin repetir lotes ya completados;
 *   · el respaldo solo se declara COMPLETADO cuando todo está verificado;
 *   · una colección que aparece después entra en el plan (no se queda fuera);
 *   · un lote sin objetos en el bucket NO cuenta como respaldo;
 *   · un error definitivo (permisos) no se reintenta y pide alerta;
 *   · el cerrojo impide dos corridas simultáneas.
 *
 *     node test/backup-lotes.test.js
 * ============================================================ */
const assert = require('assert');
const { planear, crearBackupPorLotes, segmento } = require('../src/backup-lotes.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}
async function ta(nombre, fn) {
  try { await fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' :: ' + e.message); }
}

/* ---------- Simulador de la API de Firestore y del bucket ---------- */
function simulador(opciones = {}) {
  const colecciones = opciones.colecciones || ['clientes', 'servicios', 'pagos', 'notificaciones', 'auditoria',
    'configuracion', 'historial_estados', 'planes', 'metodos_pago', 'tokens_notificacion', '_adminRegistros', 'posts'];
  const msPorLote = opciones.msPorLote === undefined ? 30000 : opciones.msPorLote;
  const prefijosExportados = new Set();
  const peticiones = [];
  let reloj = Date.parse('2026-10-29T08:00:00Z');
  let operacion = 0;

  const estado = opciones.estado || new Map();

  const deps = {
    ahora: () => reloj,
    dormir: async () => { reloj += 10; },
    log: () => {},
    tokenProveedor: async () => 'token-ficticio',
    proyectoId: 'demo-unefibra',
    bucket: 'unefibra-firestore-backups',
    listarColecciones: async () => (typeof colecciones === 'function' ? colecciones() : colecciones),
    fetchImpl: async (url, init) => {
      peticiones.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      if (/:exportDocuments$/.test(url)) {
        const body = JSON.parse(init.body);
        if (opciones.rechazar === 'PERMISO') return { status: 403, ok: false, text: async () => '{"error":{"status":"PERMISSION_DENIED"}}' };
        if (opciones.rechazar === 'SIN_COLECCION') return { status: 400, ok: false, text: async () => '{"error":{"message":"unknown collection"}}' };
        operacion++;
        prefijosExportados.add(body.outputUriPrefix.replace('gs://unefibra-firestore-backups/', '') + '/');
        reloj += msPorLote;                     // el lote tarda lo que se simule
        return { status: 200, ok: true, text: async () => JSON.stringify({ name: 'projects/p/operations/' + operacion }) };
      }
      if (/operations\//.test(url)) {
        return { status: 200, ok: true, text: async () => JSON.stringify({ done: true, name: 'op' }) };
      }
      return { status: 404, ok: false, text: async () => '{}', json: {} };
    },
    listarObjetos: async (prefijo) => {
      if (opciones.perderObjetos && opciones.perderObjetos(prefijo)) return [];
      if (!prefijosExportados.has(prefijo)) return [];
      return [prefijo + 'output-0', prefijo + 'all_namespaces_kind_x.export_metadata', prefijo + '.overall_export_metadata'];
    },
    estado: {
      leer: async (corrida) => estado.get(corrida) || null,
      guardar: async (corrida, datos) => {
        if (opciones.fallarAlGuardar) throw new Error('fallo de escritura simulado');
        estado.set(corrida, datos);
      }
    },
    lock: opciones.lock || { adquirir: async () => ({ ok: true }), liberar: async () => {} }
  };
  return { deps, peticiones, estado, reloj: () => reloj };
}

console.log('=== 1. Planificación en lotes ===');

t('una colección por lote (lo más granular para reanudar)', () => {
  const p = planear(['clientes', 'pagos', 'clientes'], 1);
  assert.strictEqual(p.total, 2, 'debe deduplicar');
  assert.strictEqual(p.lotes.length, 2);
  assert.deepStrictEqual(p.lotes[0].colecciones, ['clientes']);
});

t('los lotes agrupados respetan el tamaño pedido', () => {
  const p = planear(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepStrictEqual(p.lotes.map((l) => l.colecciones.length), [2, 2, 1]);
});

t('el id del lote es un segmento seguro de ruta en el bucket', () => {
  assert.strictEqual(segmento('_adminRegistros'), '_adminRegistros');
  assert.ok(!/[^A-Za-z0-9_-]/.test(segmento('coleccion con espacios/raro')));
});

(async () => {
  console.log('\n=== 2. Con presupuesto suficiente, la corrida se completa ===');

  await ta('12 colecciones, 12 lotes, todos verificados', async () => {
    const s = simulador();
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.strictEqual(r.estado, 'COMPLETADO');
    assert.strictEqual(r.total, 12);
    assert.strictEqual(r.completadas, 12);
    assert.strictEqual(s.peticiones.filter((p) => p.body && p.body.collectionIds).length, 12, 'una exportación por lote');
    assert.ok(r.prefijo === 'daily/2026-10-29');
    assert.ok(r.objetos >= 12 * 3, 'cada lote aporta sus objetos verificados');
  });

  await ta('cada lote pide SOLO su colección (nunca la base entera)', async () => {
    const s = simulador();
    const backup = crearBackupPorLotes(s.deps);
    await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    const cuerpos = s.peticiones.filter((p) => p.body && p.body.collectionIds).map((p) => p.body.collectionIds);
    assert.strictEqual(cuerpos.length, 12);
    for (const c of cuerpos) assert.strictEqual(c.length, 1, 'un lote = una colección');
  });

  await ta('el manifiesto guarda el tiempo de cada lote (para dimensionar en producción)', async () => {
    const s = simulador({ msPorLote: 45000 });
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.ok(r.masLento && r.masLento.ms >= 45000, 'debe registrar el lote más lento');
    assert.strictEqual(r.detalle.length, 12);
    assert.ok(r.detalle.every((d) => d.estado === 'COMPLETADO' && d.ms > 0));
  });

  console.log('\n=== 3. El presupuesto de tiempo de la invocación se respeta ===');

  await ta('presupuesto de 2 minutos: solo caben los lotes que quepan', async () => {
    const s = simulador({ msPorLote: 30000 });
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 120000, fecha: '2026-10-29' });
    const exportados = s.peticiones.filter((p) => p.body && p.body.collectionIds).length;
    assert.strictEqual(r.estado, 'PARCIAL', 'con 12 colecciones no puede completar en 2 minutos');
    assert.strictEqual(exportados, 4, '30 s por lote dentro de 120 s = 4 lotes');
    assert.strictEqual(r.completadas, 4);
    assert.strictEqual(r.pendientes, 8);
    assert.ok(r.msTotal <= 120000 + 30000, 'no se pasa del presupuesto más de un lote');
  });

  console.log('\n=== 4. La corrida se reanuda donde quedó ===');

  await ta('tres invocaciones completan lo que una no puede, sin repetir lotes', async () => {
    const s = simulador({ msPorLote: 30000 });
    const backup = crearBackupPorLotes(s.deps);
    const r1 = await backup.ejecutar({ presupuestoMs: 120000, fecha: '2026-10-29' });
    const r2 = await backup.ejecutar({ presupuestoMs: 120000, fecha: '2026-10-29' });
    const r3 = await backup.ejecutar({ presupuestoMs: 120000, fecha: '2026-10-29' });
    assert.strictEqual(r1.estado, 'PARCIAL');
    assert.strictEqual(r2.estado, 'PARCIAL');
    assert.strictEqual(r3.estado, 'COMPLETADO');
    assert.strictEqual(r3.completadas, 12);
    const exportados = s.peticiones.filter((p) => p.body && p.body.collectionIds).length;
    assert.strictEqual(exportados, 12, 'ningún lote se exporta dos veces');
  });

  await ta('una corrida ya completa no vuelve a exportar nada', async () => {
    const s = simulador({ msPorLote: 1000 });
    const backup = crearBackupPorLotes(s.deps);
    await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    const antes = s.peticiones.filter((p) => p.body && p.body.collectionIds).length;
    const r = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    const despues = s.peticiones.filter((p) => p.body && p.body.collectionIds).length;
    assert.strictEqual(r.estado, 'COMPLETADO');
    assert.strictEqual(r.yaEstaba, true);
    assert.strictEqual(despues, antes, 'no debe exportar de nuevo');
  });

  await ta('una colección nueva entra al plan y se exporta', async () => {
    let lista = ['clientes', 'pagos'];
    const s = simulador({ msPorLote: 1000, colecciones: () => lista });
    const backup = crearBackupPorLotes(s.deps);
    const r1 = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.strictEqual(r1.estado, 'COMPLETADO');
    assert.strictEqual(r1.total, 2);
    lista = ['clientes', 'pagos', 'cupones'];
    const r2 = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.strictEqual(r2.nuevos, 1, 'la colección nueva debe detectarse');
    assert.strictEqual(r2.total, 3);
    assert.strictEqual(r2.estado, 'COMPLETADO');
  });

  console.log('\n=== 5. Un respaldo incompleto nunca se da por bueno ===');

  await ta('si el bucket no tiene los objetos, el lote NO se marca completado', async () => {
    const s = simulador({ msPorLote: 1000, perderObjetos: (prefijo) => /notificaciones/.test(prefijo), intentosMax: 2 });
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.notStrictEqual(r.estado, 'COMPLETADO', 'no puede declararse completo con un lote vacío');
    const loteNoti = r.detalle.find((d) => d.colecciones.includes('notificaciones'));
    assert.strictEqual(loteNoti.estado, 'FALLIDO');
    assert.strictEqual(r.completadas, 11);
  });

  await ta('un lote fallido se reintenta dentro del mismo intento', async () => {
    let primeraVez = true;
    const s = simulador({ msPorLote: 1000, intentosMax: 3 });
    const fetchOriginal = s.deps.fetchImpl;
    s.deps.fetchImpl = async (url, init) => {
      if (/:exportDocuments$/.test(url) && primeraVez) {
        primeraVez = false;
        return { status: 503, ok: false, text: async () => '{"error":{"status":"UNAVAILABLE"}}' };
      }
      return fetchOriginal(url, init);
    };
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.strictEqual(r.estado, 'COMPLETADO', 'el fallo transitorio no debe romper la corrida');
  });

  await ta('un error de permisos no se reintenta y pide alerta', async () => {
    const s = simulador({ rechazar: 'PERMISO' });
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    assert.strictEqual(r.estado, 'FALLIDO');
    assert.strictEqual(r.requiereAlerta, true);
    const intentos = s.peticiones.filter((p) => p.body && p.body.collectionIds).length;
    assert.strictEqual(intentos, 1, 'un 403 no se reintenta');
  });

  await ta('sin colecciones legibles no se declara respaldo', async () => {
    const s = simulador({ colecciones: () => [] });
    const backup = crearBackupPorLotes(s.deps);
    let lanzo = false;
    try { await backup.ejecutar({ presupuestoMs: 60000, fecha: '2026-10-29' }); } catch (e) { lanzo = true; }
    assert.ok(lanzo, 'debe fallar en vez de fingir un respaldo vacío');
  });

  console.log('\n=== 6. Cerrojo y aislamiento entre corridas ===');

  await ta('si otra corrida tiene el cerrojo, esta se omite', async () => {
    const s = simulador({ lock: { adquirir: async () => ({ ok: false, motivo: 'Ya hay un respaldo en curso.' }), liberar: async () => {} } });
    const backup = crearBackupPorLotes(s.deps);
    const r = await backup.ejecutar({ presupuestoMs: 60000, fecha: '2026-10-29' });
    assert.strictEqual(r.estado, 'OMITIDO');
    assert.strictEqual(s.peticiones.length, 0, 'no debe exportar nada');
  });

  await ta('dos días distintos llevan prefijos distintos en el bucket', async () => {
    const s = simulador({ msPorLote: 100 });
    const backup = crearBackupPorLotes(s.deps);
    await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' });
    await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-30' });
    const prefijos = s.peticiones.filter((p) => p.body && p.body.outputUriPrefix).map((p) => p.body.outputUriPrefix);
    assert.ok(prefijos.some((u) => u.includes('/daily/2026-10-29/')));
    assert.ok(prefijos.some((u) => u.includes('/daily/2026-10-30/')));
  });

  await ta('si la función muere a mitad, el progreso ya quedó guardado', async () => {
    const s = simulador({ msPorLote: 10000 });
    const backup = crearBackupPorLotes(s.deps);
    /* Se simula la muerte del proceso lanzando desde el guardado del estado. */
    let guardados = 0;
    const guardarOriginal = s.deps.estado.guardar;
    s.deps.estado.guardar = async (corrida, datos) => {
      guardados++;
      if (guardados === 3) throw new Error('proceso terminado a la fuerza');
      return guardarOriginal(corrida, datos);
    };
    let lanzo = false;
    try { await backup.ejecutar({ presupuestoMs: 600000, fecha: '2026-10-29' }); } catch (e) { lanzo = true; }
    assert.ok(lanzo, 'la muerte se propaga');
    const guardado = s.estado.get('2026-10-29');
    assert.ok(guardado, 'el progreso anterior quedó en Firestore');
    const completados = Object.values(guardado.lotes).filter((l) => l.estado === 'COMPLETADO').length;
    assert.ok(completados >= 2, 'al menos los dos lotes anteriores están registrados: ' + completados);
  });

  console.log('\n== Resumen ==');
  console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
  if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
})();
