'use strict';
/* Pruebas de functions/src/mikrotik.js — SIN router y SIN red.
   El transporte de RouterOS se sustituye por un doble que devuelve colas
   sintéticas. Se ejecuta con:  node test/mikrotik.test.js  */
const assert = require('assert');
const m = require('../src/mikrotik.js');

let ok = 0, fail = 0; const fallos = [];
function t(nombre, fn) {
  try { fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' Â· ' + e.message); }
}
async function ta(nombre, fn) {
  try { await fn(); ok++; console.log('  PASA  ' + nombre); }
  catch (e) { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + ' Â· ' + e.message); }
}

/* ── Doble de RouterOS: registra lo que se le pide y responde ── */
function transporteFalso(colas) {
  const llamadas = [];
  return {
    llamadas,
    connect: async () => { llamadas.push('connect'); },
    close: async () => { llamadas.push('close'); },
    write: async (comando, argumentos) => {
      llamadas.push(comando);
      if (comando === '/queue/simple/print') return colas;
      if (comando === '/queue/simple/set') return [];
      throw new Error('comando no esperado en la prueba: ' + comando);
    }
  };
}

/* Colas de ejemplo con la forma real de RouterOS (todo son cadenas). */
const COLAS = [
  { '.id': '*1', name: 'UF-Maria-Lopez-a1b2c3', target: '192.168.50.2/32', 'max-limit': '10M/10M', disabled: 'false' },
  { '.id': '*2', name: 'UF-Juan-Perez-d4e5f6', target: '192.168.50.3/32', 'max-limit': '20M/20M', disabled: 'true' },
  { '.id': '*3', name: 'UF-Sin-Cliente-999999', target: '192.168.50.9/32', 'max-limit': '5M/5M', disabled: 'false' },
  { '.id': '*4', name: '<dynamic-1>', target: '192.168.50.77/32', 'max-limit': '1M/1M', disabled: 'false' }
];

const CLIENTES = [
  { id: 'cli-000001', nombreCompleto: 'María López', ip: '192.168.50.2' },
  { id: 'cli-000002', nombreCompleto: 'Juan Pérez', ip: '192.168.50.3' },
  { id: 'cli-000003', nombreCompleto: 'Ana Ruiz', ip: '192.168.50.4' },   // sin cola
  { id: 'cli-000004', nombreCompleto: 'Pedro Gil' }                      // sin IP
];

console.log('=== 1. Normalización de IP (el dato de origen venía sucio) ===');

t('IPv4 completa se acepta', () => assert.strictEqual(m.normalizarIp('192.168.50.2'), '192.168.50.2'));
t('con /32 se limpia', () => assert.strictEqual(m.normalizarIp('192.168.50.2/32'), '192.168.50.2'));
t('incompleta se rechaza', () => assert.strictEqual(m.normalizarIp('192.168.50'), null));
t('texto se rechaza', () => assert.strictEqual(m.normalizarIp('sin ip'), null));
t('octeto fuera de rango se rechaza', () => assert.strictEqual(m.normalizarIp('192.168.50.999'), null));
t('nulo se rechaza', () => assert.strictEqual(m.normalizarIp(null), null));

console.log('\n=== 2. Nombre de cola estable y sin acentos ===');

t('el nombre propuesto no lleva espacios ni acentos', () => {
  const n = m.nombreQueueParaCliente({ id: 'cli-000001', nombreCompleto: 'María López' });
  assert.ok(/^UF-[A-Za-z0-9-]+$/.test(n), 'nombre inesperado: ' + n);
  assert.strictEqual(n.indexOf(' '), -1);
  assert.ok(n.endsWith('000001'), 'no termina con el id: ' + n);
});
t('el mismo cliente produce siempre el mismo nombre', () => {
  const a = m.nombreQueueParaCliente({ id: 'cli-9', nombreCompleto: 'Ana Ruiz' });
  const b = m.nombreQueueParaCliente({ id: 'cli-9', nombreCompleto: 'Ana Ruiz' });
  assert.strictEqual(a, b);
});
t('un cliente sin id lanza error claro', () => {
  assert.throws(() => m.nombreQueueParaCliente({ nombreCompleto: 'X' }), /id/);
});

console.log('\n=== 3. Lectura de la cola de RouterOS ===');

t('una cola deshabilitada se marca deshabilitada', () => {
  const q = m.normalizarQueue(COLAS[1]);
  assert.strictEqual(q.deshabilitada, true);
  assert.deepStrictEqual(q.objetivos, ['192.168.50.3']);
  assert.strictEqual(q.limite, '20M/20M');
});
t('una cola activa no se marca deshabilitada', () => {
  assert.strictEqual(m.normalizarQueue(COLAS[0]).deshabilitada, false);
});
t('las colas dinámicas se reconocen', () => {
  assert.strictEqual(m.normalizarQueue(COLAS[3]).dinamica, true);
});
t('estado desde cola: deshabilitada = SUSPENDIDO', () => {
  assert.strictEqual(m.estadoDesdeQueue(m.normalizarQueue(COLAS[1])), 'SUSPENDIDO');
});
t('estado desde cola: habilitada = ACTIVO', () => {
  assert.strictEqual(m.estadoDesdeQueue(m.normalizarQueue(COLAS[0])), 'ACTIVO');
});
t('sin cola = DESCONOCIDO', () => assert.strictEqual(m.estadoDesdeQueue(null), 'DESCONOCIDO'));
t('normalizarQueue es idempotente (no vacía los objetivos)', () => {
  const una = m.normalizarQueue(COLAS[0]);
  const dos = m.normalizarQueue(una);
  assert.deepStrictEqual(dos.objetivos, ['192.168.50.2']);
  assert.strictEqual(dos.deshabilitada, false);
});

console.log('\n=== 4. Emparejamiento cliente ↔ cola ===');

const informe = m.emparejar(CLIENTES, COLAS);

t('empareja por IP', () => {
  const r = informe.resultados.find((x) => x.clienteId === 'cli-000001');
  assert.strictEqual(r.criterio, 'ip');
  assert.strictEqual(r.estadoRouter, 'ACTIVO');
});
t('detecta el cliente suspendido en el router', () => {
  const r = informe.resultados.find((x) => x.clienteId === 'cli-000002');
  assert.strictEqual(r.estadoRouter, 'SUSPENDIDO');
});
t('un cliente sin cola queda como DESCONOCIDO', () => {
  const r = informe.resultados.find((x) => x.clienteId === 'cli-000003');
  assert.strictEqual(r.queue, null);
  assert.strictEqual(r.estadoRouter, 'DESCONOCIDO');
});
t('un cliente sin IP no rompe el emparejamiento', () => {
  const r = informe.resultados.find((x) => x.clienteId === 'cli-000004');
  assert.strictEqual(r.ip, null);
  assert.strictEqual(r.estadoRouter, 'DESCONOCIDO');
});
t('las colas huérfanas se listan aparte', () => {
  assert.strictEqual(informe.sinDueno.length, 1);
  assert.strictEqual(informe.sinDueno[0].nombre, 'UF-Sin-Cliente-999999');
});
t('las colas dinámicas no cuentan como huérfanas', () => {
  assert.ok(informe.sinDueno.every((q) => !q.dinamica));
});
t('avisa de ambigüedad en vez de elegir a ciegas', () => {
  const colasDobles = [
    { '.id': '*9', name: 'A', target: '10.0.0.5/32', disabled: 'false' },
    { '.id': '*10', name: 'B', target: '10.0.0.5/32', disabled: 'false' }
  ];
  const r = m.emparejar([{ id: 'c1', nombreCompleto: 'X', ip: '10.0.0.5' }], colasDobles);
  assert.strictEqual(r.resultados[0].ambiguo, true);
  assert.strictEqual(r.resultados[0].queue, null, 'eligió una cola en un caso ambiguo');
});

console.log('\n=== 5. Configuración desde el entorno ===');

t('sin variables no hay configuración', () => assert.strictEqual(m.leerConfiguracion({}), null));
t('configuración completa con TLS por defecto', () => {
  const c = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p' });
  assert.strictEqual(c.puerto, 8729);
  assert.strictEqual(c.tls, true);
});
t('la escritura viene APAGADA por defecto', () => {
  const c = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p' });
  assert.strictEqual(c.permitirEscritura, false);
});
t('la escritura solo se enciende de forma explícita', () => {
  const c = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p', MIKROTIK_PERMITIR_ESCRITURA: 'true' });
  assert.strictEqual(c.permitirEscritura, true);
});

console.log('\n=== 6. Consulta real contra el doble (sin router) ===');

(async () => {
  await ta('listarQueues usa UN solo comando de lectura y cierra la conexión', async () => {
    const falso = transporteFalso(COLAS);
    const config = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p' });
    const colas = await m.listarQueues(config, falso);
    assert.strictEqual(colas.length, 4);
    const escrituras = falso.llamadas.filter((c) => c.startsWith('/queue/simple/set'));
    assert.strictEqual(escrituras.length, 0, 'la consulta intentó escribir');
    assert.ok(falso.llamadas.includes('close'), 'no cerró la conexión');
  });

  await ta('informeEstado resume el cruce', async () => {
    const falso = transporteFalso(COLAS);
    const config = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p' });
    const info = await m.informeEstado({ clientes: CLIENTES, config, transporte: falso });
    assert.strictEqual(info.configurado, true);
    assert.strictEqual(info.emparejados, 2);
    assert.strictEqual(info.sinCola, 2);
    assert.strictEqual(info.colasSinCliente, 1);
    assert.strictEqual(info.porEstado.ACTIVO, 1);
    assert.strictEqual(info.porEstado.SUSPENDIDO, 1);
  });

  await ta('sin configuración el informe lo dice y NO se conecta', async () => {
    const falso = transporteFalso(COLAS);
    const info = await m.informeEstado({ clientes: CLIENTES, config: null, transporte: falso });
    assert.strictEqual(info.configurado, false);
    assert.strictEqual(falso.llamadas.length, 0, 'se conectó sin configuración');
  });

  console.log('\n=== 7. La escritura está cerrada por defecto ===');

  await ta('cambiarEstadoQueue se niega si la escritura está apagada', async () => {
    const config = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p' });
    const falso = transporteFalso(COLAS);
    await assert.rejects(
      () => m.cambiarEstadoQueue({ config, transporte: falso, queueId: '*1', suspender: true, confirmado: true }),
      /desactivada/
    );
    assert.strictEqual(falso.llamadas.length, 0, 'tocó el router con la escritura apagada');
  });

  await ta('cambiarEstadoQueue exige confirmación explícita', async () => {
    const config = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p', MIKROTIK_PERMITIR_ESCRITURA: 'true' });
    const falso = transporteFalso(COLAS);
    await assert.rejects(
      () => m.cambiarEstadoQueue({ config, transporte: falso, queueId: '*1', suspender: true }),
      /confirmación/
    );
    assert.strictEqual(falso.llamadas.length, 0);
  });

  await ta('con permiso y confirmación, escribe UNA vez y cierra', async () => {
    const config = m.leerConfiguracion({ MIKROTIK_HOST: 'h', MIKROTIK_USER: 'u', MIKROTIK_PASSWORD: 'p', MIKROTIK_PERMITIR_ESCRITURA: 'true' });
    const falso = transporteFalso(COLAS);
    const r = await m.cambiarEstadoQueue({ config, transporte: falso, queueId: '*1', suspender: true, confirmado: true });
    assert.strictEqual(r.deshabilitada, true);
    assert.strictEqual(falso.llamadas.filter((c) => c === '/queue/simple/set').length, 1);
    assert.ok(falso.llamadas.includes('close'));
  });

  console.log('\n  TOTAL ' + (ok + fail) + ' Â· PASA ' + ok + ' Â· FALLA ' + fail);
  if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }
})();
