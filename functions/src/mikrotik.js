'use strict';
/* ============================================================
 * UneFibra SAS — Integración MikroTik (PREPARADA, no activada)
 * ------------------------------------------------------------
 * QUÉ HACE HOY: nada por sí sola. Este módulo traduce entre el modelo
 * de datos de Firestore (una colección `clientes`) y las colas simples
 * de RouterOS (`/queue/simple`), y expone el estado REAL del servicio
 * en el router. No se conecta a ningún router al cargarse.
 *
 * QUÉ NO HACE: no escribe en RouterOS. Las funciones de escritura
 * (`suspenderEnRouter`, `activarEnRouter`) EXISTEN pero están cerradas
 * por `permitirEscritura`, que es `false` salvo configuración explícita.
 * Nada del panel las llama todavía.
 *
 * POR QUÉ ASÍ: el estado del servicio en Firestore se puede desincronizar
 * del router (cortes hechos a mano en WinBox, reconexiones, pruebas). Antes
 * de automatizar un corte hay que poder LEER y comparar; automatizar el
 * corte sin esa lectura significa poder dejar sin Internet a un cliente que
 * sí pagó. Por eso esta entrega es de consulta, con escritura preparada y
 * apagada.
 *
 * SEGURIDAD: las credenciales salen de variables de entorno (secretos de
 * Cloud Functions), nunca del repositorio ni del cliente HTTP. El transporte
 * es inyectable para poder probar sin router (ver test/mikrotik.test.js).
 * ============================================================ */

const ESTADOS_ROUTER = { ACTIVO: 'ACTIVO', SUSPENDIDO: 'SUSPENDIDO', DESCONOCIDO: 'DESCONOCIDO' };

/** IPv4 completa (4 octetos, 0-255). Devuelve la IP normalizada o null. */
function normalizarIp(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/\/32$/i, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(texto)) return null;
  const partes = texto.split('.').map(Number);
  if (partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return partes.join('.');
}

/** Nombre de cola propuesto para un cliente: estable y sin espacios raros. */
function nombreQueueParaCliente(cliente) {
  const id = String((cliente && cliente.id) || '').trim();
  if (!id) throw new Error('El cliente necesita un id para derivar el nombre de la cola.');
  const base = String((cliente && cliente.nombreCompleto) || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return 'UF-' + (base || 'cliente') + '-' + id.slice(-6);
}

/** Normaliza una cola de RouterOS a la forma que usa el sistema.
 *  Es IDEMPOTENTE: si ya llega normalizada (con `objetivos`), se devuelve tal
 *  cual. Sin esto, `informeEstado` normalizaba dos veces (una en listarQueues y
 *  otra en emparejar) y la segunda pasada vaciaba los objetivos porque el campo
 *  ya no era `target` sino `objetivos`: el cruce salía con 0 emparejados. */
function normalizarQueue(q) {
  if (!q) return null;
  if (Array.isArray(q.objetivos) && q.disabled === undefined && q.target === undefined) {
    return q;
  }
  const disabled = q.disabled === 'true' || q.disabled === true;
  const objetivos = String(q.target || '')
    .split(',')
    .map((x) => normalizarIp(x))
    .filter(Boolean);
  return {
    id: q['.id'] || q.id || null,
    nombre: String(q.name || ''),
    objetivos,
    limite: q['max-limit'] || null,
    deshabilitada: disabled,
    dinamica: String(q.name || '').startsWith('<'),
    comentario: q.comment || null
  };
}

/** Estado del servicio según el router. */
function estadoDesdeQueue(queue) {
  if (!queue) return ESTADOS_ROUTER.DESCONOCIDO;
  return queue.deshabilitada ? ESTADOS_ROUTER.SUSPENDIDO : ESTADOS_ROUTER.ACTIVO;
}

/**
 * Empareja clientes con colas. Primero por IP (target), luego por nombre.
 * Devuelve un informe; NO decide nada por su cuenta.
 */
function emparejar(clientes, queues) {
  const listaClientes = Array.isArray(clientes) ? clientes : [];
  const listaQueues = (Array.isArray(queues) ? queues : []).map(normalizarQueue).filter(Boolean);

  const porIp = new Map();
  const porNombre = new Map();
  for (const q of listaQueues) {
    if (q.dinamica) continue;                    // las dinámicas no se gestionan
    for (const ip of q.objetivos) {
      if (!porIp.has(ip)) porIp.set(ip, []);
      porIp.get(ip).push(q);
    }
    if (q.nombre) porNombre.set(q.nombre.toLowerCase(), q);
  }

  const resultados = [];
  const usadas = new Set();

  for (const c of listaClientes) {
    const ip = normalizarIp(c.ip || c.ipCliente || c.direccionIP);
    const candidatas = ip ? (porIp.get(ip) || []) : [];
    let queue = candidatas.length === 1 ? candidatas[0] : null;
    let criterio = queue ? 'ip' : null;

    if (!queue) {
      const objetivo = nombreQueueParaCliente(c).toLowerCase();
      if (porNombre.has(objetivo)) { queue = porNombre.get(objetivo); criterio = 'nombre'; }
    }
    if (queue) usadas.add(queue.id || queue.nombre);

    resultados.push({
      clienteId: c.id,
      nombre: c.nombreCompleto || null,
      ip: ip,
      criterio,
      ambiguo: !queue && candidatas.length > 1,
      queue: queue || null,
      estadoRouter: estadoDesdeQueue(queue)
    });
  }

  const sinDueno = listaQueues.filter((q) => !q.dinamica && !usadas.has(q.id || q.nombre));
  return { resultados, sinDueno, totalQueues: listaQueues.length };
}

/** Configuración desde el entorno. Devuelve null si falta algo. */
function leerConfiguracion(env) {
  const e = env || process.env;
  const host = e.MIKROTIK_HOST;
  const usuario = e.MIKROTIK_USER || e.MIKROTIK_USUARIO;
  const clave = e.MIKROTIK_PASSWORD || e.MIKROTIK_CLAVE;
  if (!host || !usuario || !clave) return null;
  const puerto = Number(e.MIKROTIK_PORT || 8729);
  return {
    host,
    puerto,
    usuario,
    clave,
    tls: puerto === 8729,
    // Escritura apagada salvo que se encienda a mano y a propósito.
    permitirEscritura: String(e.MIKROTIK_PERMITIR_ESCRITURA || '').toLowerCase() === 'true'
  };
}

/** Transporte real. Solo se construye si alguien va a leer de verdad. */
function crearTransporteRouterOS(config) {
  const { RouterOSAPI } = require('node-routeros');
  return new RouterOSAPI({
    host: config.host,
    port: config.puerto,
    user: config.usuario,
    password: config.clave,
    timeout: 10,
    tls: config.tls ? { rejectUnauthorized: false } : undefined
  });
}

async function conConexion(config, transporteProporcionado, tarea) {
  const transporte = transporteProporcionado || crearTransporteRouterOS(config);
  let conectado = false;
  try {
    if (typeof transporte.connect === 'function') { await transporte.connect(); conectado = true; }
    return await tarea(transporte);
  } finally {
    if (conectado && typeof transporte.close === 'function') {
      try { await transporte.close(); } catch (e) { /* cerrar no debe romper el resultado */ }
    }
  }
}

/**
 * Lee las colas del router. SOLO LECTURA: un único comando de impresión.
 * `transporte` permite pasar un doble en las pruebas.
 */
async function listarQueues(config, transporte) {
  if (!config) throw new Error('Falta configuración de MikroTik (MIKROTIK_HOST/USER/PASSWORD).');
  return conConexion(config, transporte, async (t) => {
    const filas = await t.write('/queue/simple/print', []);
    return (Array.isArray(filas) ? filas : []).map(normalizarQueue).filter(Boolean);
  });
}

/**
 * Informe de estado: cruza Firestore con el router. Es lo único que hoy
 * se puede pedir desde el sistema.
 */
async function informeEstado({ clientes, config, transporte } = {}) {
  if (!config) return { configurado: false, motivo: 'MikroTik no está configurado en este entorno.' };
  const queues = await listarQueues(config, transporte);
  const { resultados, sinDueno, totalQueues } = emparejar(clientes, queues);
  const resumen = {
    configurado: true,
    totalQueues,
    emparejados: resultados.filter((r) => r.queue).length,
    sinCola: resultados.filter((r) => !r.queue).length,
    ambiguos: resultados.filter((r) => r.ambiguo).length,
    colasSinCliente: sinDueno.length,
    porEstado: resultados.reduce((acc, r) => {
      acc[r.estadoRouter] = (acc[r.estadoRouter] || 0) + 1;
      return acc;
    }, {})
  };
  return { ...resumen, clientes: resultados };
}

/**
 * Escritura PREPARADA y APAGADA. Solo actúa si `permitirEscritura` está
 * encendido en la configuración; si no, lanza. Nunca se llama desde el panel.
 */
async function cambiarEstadoQueue({ config, transporte, queueId, suspender, confirmado } = {}) {
  if (!config) throw new Error('Falta configuración de MikroTik.');
  if (!config.permitirEscritura) {
    throw new Error('La escritura en MikroTik está desactivada (MIKROTIK_PERMITIR_ESCRITURA != true).');
  }
  if (confirmado !== true) throw new Error('La escritura exige confirmación explícita (confirmado: true).');
  if (!queueId) throw new Error('Falta el identificador de la cola.');

  return conConexion(config, transporte, async (t) => {
    await t.write('/queue/simple/set', [
      '=.id=' + queueId,
      '=disabled=' + (suspender ? 'yes' : 'no')
    ]);
    return { queueId, deshabilitada: !!suspender };
  });
}

module.exports = {
  ESTADOS_ROUTER,
  normalizarIp,
  nombreQueueParaCliente,
  normalizarQueue,
  estadoDesdeQueue,
  emparejar,
  leerConfiguracion,
  listarQueues,
  informeEstado,
  cambiarEstadoQueue,
  crearTransporteRouterOS
};
