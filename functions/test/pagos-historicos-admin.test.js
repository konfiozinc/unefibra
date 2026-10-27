'use strict';
/* ============================================================
 * KZ-UNEF-026 · Batería de certificación del panel administrativo
 * ------------------------------------------------------------
 * Invoca REALMENTE las tres callables del módulo de pagos históricos contra
 * Firebase Emulator Suite y comprueba los 14 puntos de la orden.
 *
 * Requisitos:
 *   · emuladores auth + firestore + functions en marcha (proyecto demo-unefibra)
 *   · el entorno del emulador con PAGOS_HISTORICOS_HABILITADO=true
 *   · un segundo arranque SIN la variable para el caso 12 (interruptor apagado)
 *
 *   PAGOS_HISTORICOS_HABILITADO=true firebase emulators:start \
 *     --config firebase.test.json --project demo-unefibra --only auth,firestore,functions
 *   node test/pagos-historicos-admin.test.js
 * ============================================================ */
const FS = 'http://127.0.0.1:8080', FN = 'http://127.0.0.1:5001', AUTH = 'http://127.0.0.1:9199';
const P = 'demo-unefibra', K = 'clave-ficticia';
const BASE = `${FS}/v1/projects/${P}/databases/(default)/documents`;

const s = (v) => ({ stringValue: v }), n = (v) => ({ integerValue: String(v) }), b = (v) => ({ booleanValue: v });
const pedir = async (m, url, cuerpo, tok) => {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h.Authorization = 'Bearer ' + tok;
  const r = await fetch(url, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { st: r.status, j, txt };
};
const crear = (col, id, fields, tok = 'owner') => pedir('POST', `${BASE}/${col}?documentId=${id}`, { fields }, tok);
const leer = (ruta) => pedir('GET', `${BASE}/${ruta}`, undefined, 'owner');
const callable = (nombre, datos, tok) => pedir('POST', `${FN}/${P}/us-central1/${nombre}`, { data: datos }, tok);
const listar = async (col) => {
  const r = await pedir('POST', `${FS}/v1/projects/${P}/databases/(default)/documents:runQuery`, { structuredQuery: { from: [{ collectionId: col }] } }, 'owner');
  return (Array.isArray(r.j) ? r.j : []).filter((x) => x.document).map((x) => x.document);
};
const alta = async (email) => {
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Ficticia#1', returnSecureToken: true }) });
  const j = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Ficticia#1', returnSecureToken: true }) })).json();
  return { uid: j.localId, tok: j.idToken };
};
const campo = (doc, k) => (doc && doc.fields && doc.fields[k] ? Object.values(doc.fields[k])[0] : undefined);

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(62) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(59) + (d || '')); }
};

const propuesta = (id, clase, estado, extra = {}) => ({
  clienteId: s('cli-' + id), periodo: s('2026-03'), monto: n(50000), hoja: s('hoja-1'), fila: n(5),
  clase: s(clase), estado: s(estado), requiereRevision: b(clase !== 'COINCIDENCIA_INEQUIVOCA'),
  motivo: { nullValue: null }, referenciaPrivada: s('excel-historico-kz-unef-021:1:5:2026-03'),
  origen: s('excel-historico-kz-unef-021'), ...extra
});

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const adm = await alta('adm@cert.test');
  const ope = await alta('ope@cert.test');
  await crear('usuarios', adm.uid, { email: s('adm@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin Ficticio') });
  await crear('usuarios', ope.uid, { email: s('ope@cert.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador Ficticio') });

  /* Siembra: una de cada clasificación y estado */
  await crear('propuestas_pagos', 'p-inequivoca', propuesta('p-inequivoca', 'COINCIDENCIA_INEQUIVOCA', 'PROPUESTA'));
  await crear('propuestas_pagos', 'p-abono', propuesta('p-abono', 'POSIBLE_ABONO', 'PROPUESTA'));
  await crear('propuestas_pagos', 'p-extra', propuesta('p-extra', 'PAGO_EXTRAORDINARIO', 'PROPUESTA'));
  await crear('propuestas_pagos', 'p-ambigua', propuesta('p-ambigua', 'CELDA_AMBIGUA', 'PROPUESTA'));
  await crear('propuestas_pagos', 'p-sincliente', propuesta('p-sincliente', 'SIN_CLIENTE_UNICO', 'PROPUESTA', { clienteId: { nullValue: null } }));
  await crear('propuestas_pagos', 'p-dup', propuesta('p-dup', 'DUPLICADO', 'PROPUESTA'));
  await crear('propuestas_pagos', 'p-ya', propuesta('p-ya', 'COINCIDENCIA_INEQUIVOCA', 'APROBADA', { decididoPor: s('Admin Ficticio'), motivoDecision: s('revisado antes') }));
  /* Cliente y servicio protegido para el caso 14 */
  await crear('clientes', 'cli-x', { nombreCompleto: s('Cliente X'), estadoCliente: s('ACTIVO'), cicloCorte: s('15'), fechaVencimiento: s('2026-03-24'), precioMensual: n(50000), planId: s('p1'), telefono: s('3000000000'), activo: b(true), fechaInicioServicio: s('2026-01-10'), fechaInstalacion: s('2026-01-10') });
  await crear('servicios', 'svc-cli-x', { clienteId: s('cli-x'), estado: s('ACTIVO'), fechaVencimiento: s('2026-03-24'), precioMensual: n(50000), planId: s('p1'), origen: s('kz-unef-006'), conciliacion: { mapValue: { fields: { estado: s('PENDIENTE_VALIDACION'), referencia: s('kz-unef-006') } } } });

  console.log('=== 1-2. Acceso anónimo y de OPERADOR ===');
  const anon = await callable('listarPropuestasPagos', { limite: 10 });
  chk('anónimo rechazado (401)', anon.st === 401, `HTTP ${anon.st}`);
  const opeL = await callable('listarPropuestasPagos', { limite: 10 }, ope.tok);
  chk('OPERADOR rechazado en lectura (403)', opeL.st === 403, `HTTP ${opeL.st}`);
  const opeD = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-inequivoca', accion: 'APROBAR', motivo: 'prueba de permisos operador' }] }, ope.tok);
  chk('OPERADOR rechazado al decidir (403)', opeD.st === 403, `HTTP ${opeD.st}`);

  console.log('\n=== 3. Lectura autorizada por ADMIN ===');
  const lista = await callable('listarPropuestasPagos', { limite: 50 }, adm.tok);
  chk('ADMIN lee (200)', lista.st === 200, `HTTP ${lista.st}`);
  const arr = (lista.j && lista.j.result && lista.j.result.propuestas) || [];
  chk('devuelve las propuestas sembradas', arr.length >= 7, `${arr.length}`);
  chk('el campo aprobable viene del servidor', arr.every((x) => typeof x.aprobable === 'boolean'));
  chk('las ambiguas y sin cliente NO son aprobables',
    arr.filter((x) => ['CELDA_AMBIGUA', 'SIN_CLIENTE_UNICO'].includes(x.clase)).every((x) => x.aprobable === false));

  console.log('\n=== 4-5. Aprobación y rechazo válidos ===');
  const ap = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-inequivoca', accion: 'APROBAR', motivo: 'confirmado con el dueño por teléfono' }] }, adm.tok);
  chk('aprobación aceptada', ap.st === 200 && ap.j.result.resumen.APROBADA === 1, JSON.stringify(ap.j && ap.j.result && ap.j.result.resumen));
  const docAp = (await leer('propuestas_pagos/p-inequivoca')).j;
  chk('queda APROBADA con quién y cuándo', campo(docAp, 'estado') === 'APROBADA' && !!campo(docAp, 'decididoPor') && !!campo(docAp, 'decididoEn'));
  const re = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-abono', accion: 'RECHAZAR', motivo: 'no coincide con el importe de la factura' }] }, adm.tok);
  chk('rechazo aceptado', re.st === 200 && re.j.result.resumen.RECHAZADA === 1, JSON.stringify(re.j && re.j.result && re.j.result.resumen));

  console.log('\n=== 6. Justificación insuficiente ===');
  const corta = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-extra', accion: 'APROBAR', motivo: 'ok' }] }, adm.tok);
  chk('justificación corta rechazada', corta.j.result.resumen.MOTIVO_INSUFICIENTE === 1, JSON.stringify(corta.j.result.resumen));

  console.log('\n=== 7-8. Ambiguas y sin cliente único NO se aprueban ===');
  const am = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-ambigua', accion: 'APROBAR', motivo: 'intento de aprobar una ambigua' }] }, adm.tok);
  chk('ambigua rechazada por el servidor', am.j.result.resumen.REQUIERE_CORRECCION_PREVIA === 1, JSON.stringify(am.j.result.resumen));
  const sc = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-sincliente', accion: 'APROBAR', motivo: 'intento de aprobar sin cliente' }] }, adm.tok);
  chk('sin cliente único rechazada por el servidor', sc.j.result.resumen.REQUIERE_CORRECCION_PREVIA === 1, JSON.stringify(sc.j.result.resumen));
  chk('ninguna de las dos cambió de estado',
    campo((await leer('propuestas_pagos/p-ambigua')).j, 'estado') === 'PROPUESTA' &&
    campo((await leer('propuestas_pagos/p-sincliente')).j, 'estado') === 'PROPUESTA');

  console.log('\n=== 9. Intentar modificar una propuesta ya aprobada ===');
  const ya = await callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-ya', accion: 'RECHAZAR', motivo: 'intento de cambiar una ya aprobada' }] }, adm.tok);
  chk('se rechaza con YA_APROBADA', ya.j.result.resumen.YA_APROBADA === 1, JSON.stringify(ya.j.result.resumen));
  chk('sigue APROBADA', campo((await leer('propuestas_pagos/p-ya')).j, 'estado') === 'APROBADA');

  console.log('\n=== 10. Auditoría de las decisiones ===');
  const aud = await listar('auditoria');
  const acciones = aud.map((a) => campo(a, 'accion'));
  chk('se auditó la aprobación', acciones.includes('APROBAR_PAGO_HISTORICO'), acciones.join(','));
  chk('se auditó el rechazo', acciones.includes('RECHAZAR_PAGO_HISTORICO'));
  chk('se auditó el resumen de la tanda', acciones.includes('DECIDIR_PAGOS_HISTORICOS'));
  chk('la auditoría guarda el motivo', aud.some((a) => /confirmado con el dueño/.test(JSON.stringify(a.fields || {}))));

  console.log('\n=== 11. Máximo 50 por solicitud ===');
  const muchas = Array.from({ length: 51 }, (_, i) => ({ id: 'p-x-' + i, accion: 'APROBAR', motivo: 'prueba de límite de tanda' }));
  const lim = await callable('decidirPropuestasPagos', { decisiones: muchas }, adm.tok);
  chk('51 propuestas se rechazan de plano', lim.st === 400, `HTTP ${lim.st}`);

  console.log('\n=== 12. Concurrencia sobre la misma propuesta ===');
  const [c1, c2] = await Promise.all([
    callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-dup', accion: 'APROBAR', motivo: 'primera decisión concurrente' }] }, adm.tok),
    callable('decidirPropuestasPagos', { decisiones: [{ id: 'p-dup', accion: 'APROBAR', motivo: 'segunda decisión concurrente' }] }, adm.tok)
  ]);
  const res1 = c1.j.result.resumen, res2 = c2.j.result.resumen;
  const aprobadas = (res1.APROBADA || 0) + (res2.APROBADA || 0);
  const bloqueadas = (res1.YA_APROBADA || 0) + (res2.YA_APROBADA || 0);
  chk('solo una decisión prospera', aprobadas === 1 && bloqueadas === 1, `aprobadas=${aprobadas} bloqueadas=${bloqueadas}`);

  console.log('\n=== 13. Corrección contractual de vencimiento ===');
  const periodoMal = await callable('corregirVencimientoContractual', {
    clienteId: 'cli-x', fechaPropuesta: '2026-05-15', periodoUtilizado: '2026-03',
    justificacion: 'prueba con período que no corresponde', confirmado: true
  }, adm.tok);
  chk('período incorrecto → rechazado', periodoMal.st === 400, `HTTP ${periodoMal.st}`);
  const sinConfirmar = await callable('corregirVencimientoContractual', {
    clienteId: 'cli-x', fechaPropuesta: '2026-04-15', periodoUtilizado: '2026-03',
    justificacion: 'prueba sin confirmación expresa'
  }, adm.tok);
  chk('sin confirmación expresa → rechazado', sinConfirmar.st === 400, `HTTP ${sinConfirmar.st}`);
  const cicloMal = await callable('corregirVencimientoContractual', {
    clienteId: 'cli-x', fechaPropuesta: '2026-04-30', periodoUtilizado: '2026-03',
    justificacion: 'prueba con ciclo equivocado', confirmado: true
  }, adm.tok);
  chk('ciclo 15 no admite fecha de día 30', cicloMal.st === 400, `HTTP ${cicloMal.st}`);
  const buena = await callable('corregirVencimientoContractual', {
    clienteId: 'cli-x', fechaPropuesta: '2026-04-15', periodoUtilizado: '2026-03',
    justificacion: 'el dueño confirmó el pago de marzo y el corte es el 15', confirmado: true
  }, adm.tok);
  chk('corrección válida aceptada', buena.st === 200, `HTTP ${buena.st} ${buena.txt.slice(0, 120)}`);
  const cli = (await leer('clientes/cli-x')).j;
  chk('la fecha del cliente queda corregida', campo(cli, 'fechaVencimiento') === '2026-04-15', campo(cli, 'fechaVencimiento'));
  chk('la corrección no toca el estado del cliente', campo(cli, 'estadoCliente') === 'ACTIVO', campo(cli, 'estadoCliente'));

  console.log('\n=== 14. Servicios protegidos intactos ===');
  const svc = (await leer('servicios/svc-cli-x')).j;
  chk('el servicio sigue en PENDIENTE_VALIDACION', JSON.stringify((svc.j && svc.j.fields && svc.j.fields.conciliacion) || {}).includes('PENDIENTE_VALIDACION'));
  chk('el servicio no cambió de estado', campo(svc, 'estado') === 'ACTIVO', campo(svc, 'estado'));
  chk('ninguna decisión creó pagos', (await listar('pagos')).length === 0);
  chk('ninguna operación creó notificaciones', (await listar('notificaciones')).length === 0);

  console.log('\n' + '='.repeat(78));
  console.log(`KZ-UNEF-026 · CERTIFICACIÓN ADMIN: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(78));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e.message); process.exit(1); });
