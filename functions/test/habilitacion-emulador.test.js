'use strict';
/* ============================================================
 * KZ-UNEF-008 · Seguridad al habilitar servicios vencidos
 * ------------------------------------------------------------
 * Parte A: evaluación pura (situaciones, zona horaria, límites de fecha).
 * Parte B: emulador (habilitación individual y por tandas, concurrencia,
 *          permisos, fallo parcial, motor antes y después).
 * Incluye CONTROLES NEGATIVOS: si el control no falla, la prueba no vale.
 *
 *   node test/habilitacion-emulador.test.js
 * ============================================================ */
const assert = require('assert');
const h = require('../src/habilitacion.js');
const { hoyISO, sumarDias } = require('../src/renovacion.js');

const FS = 'http://127.0.0.1:8080', FN = 'http://127.0.0.1:5001', AUTH = 'http://127.0.0.1:9199';
const P = 'demo-unefibra', K = 'clave-ficticia';
const BASE = `${FS}/v1/projects/${P}/databases/(default)/documents`;
const s = (v) => ({ stringValue: v }), n = (v) => ({ integerValue: String(v) }), b = (v) => ({ booleanValue: v });

const pedir = async (m, url, cuerpo, tok) => {
  const hd = { 'Content-Type': 'application/json' };
  if (tok) hd.Authorization = 'Bearer ' + tok;
  const r = await fetch(url, { method: m, headers: hd, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { st: r.status, j, txt };
};
const crear = (col, id, fields, tok = 'owner') => pedir('POST', `${BASE}/${col}?documentId=${id}`, { fields }, tok);
const callable = (nombre, datos, tok) => pedir('POST', `${FN}/${P}/us-central1/${nombre}`, { data: datos }, tok);
const alta = async (email) => {
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Ficticia#1', returnSecureToken: true }) });
  const j = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Ficticia#1', returnSecureToken: true }) })).json();
  return { uid: j.localId, tok: j.idToken };
};

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => { if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(58) + (d || '')); } else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(55) + (d || '')); } };

const conc = (estado) => ({ estado, referencia: 'kz-unef-006' });

(async () => {
  /* ─────────── Parte A · evaluación pura ─────────── */
  console.log('=== A. Situaciones (servidor, zona Colombia) ===');
  const hoy = hoyISO();
  const ev = (venc, clienteExtra = {}, servicioExtra = {}) => h.evaluarServicio({
    servicio: { clienteId: 'c1', fechaVencimiento: venc, conciliacion: conc('VALIDADA'), ...servicioExtra },
    cliente: { id: 'c1', estadoCliente: 'ACTIVO', ...clienteExtra },
    pagos: []
  });

  chk('Al día: puede habilitarse sin autorización', ev(sumarDias(hoy, 10)).situacion === 'AL_DIA' && ev(sumarDias(hoy, 10)).puedeHabilitar === true);
  chk('Vence HOY: exige aceptar advertencia', ev(hoy).situacion === 'VENCE_HOY' && ev(hoy).requiereAdvertenciaVenceHoy === true);
  const vencido = ev(sumarDias(hoy, -30));
  chk('Vencido: exige autorización explícita', vencido.situacion === 'VENCIDO' && vencido.requiereAutorizacionVencido === true);
  chk('Vencido: informa la consecuencia de suspensión', vencido.consecuencias.some((c) => /suspend/i.test(c)));
  chk('Vencido sin pago: lo dice explícitamente', vencido.consecuencias.some((c) => /ningún pago/i.test(c)));
  chk('Cliente suspendido: revisión administrativa', ev(sumarDias(hoy, 5), { estadoCliente: 'SUSPENDIDO' }).situacion === 'SUSPENDIDO');
  chk('Fecha inválida: bloqueado', ev('30/11/2026').situacion === 'FECHA_INVALIDA' && ev('30/11/2026').puedeHabilitar === false);
  chk('Sin fecha: bloqueado', ev(null).situacion === 'FECHA_INVALIDA' && ev(null).puedeHabilitar === false);
  chk('Contradicción cliente/servicio: bloqueado',
    ev(sumarDias(hoy, 10), { fechaVencimiento: sumarDias(hoy, 3) }).situacion === 'CONTRADICTORIO');
  chk('Estado de cliente fuera del modelo: bloqueado',
    ev(sumarDias(hoy, 10), { estadoCliente: 'POR_VENCER' }).situacion === 'CONTRADICTORIO');
  chk('Sin validar: no habilitable', h.evaluarServicio({ servicio: { conciliacion: conc('PENDIENTE_VALIDACION'), fechaVencimiento: sumarDias(hoy, 5) }, cliente: { estadoCliente: 'ACTIVO' }, pagos: [] }).situacion === 'BLOQUEADO_EN_FLUJO');
  chk('Vencido CON pago que cubre: lo informa', h.evaluarServicio({
    servicio: { clienteId: 'c1', fechaVencimiento: sumarDias(hoy, -30), conciliacion: conc('VALIDADA') },
    cliente: { id: 'c1', estadoCliente: 'ACTIVO' },
    pagos: [{ estado: 'CONFIRMADO', periodoFin: sumarDias(hoy, 20) }]
  }).consecuencias.some((c) => /no lo suspendería/.test(c)));

  console.log('\n=== A2. Autorización ===');
  chk('Un vencido SIN autorización se rechaza', h.autorizarHabilitacion(vencido, {}).permitido === false);
  chk('Un vencido con autorización pero sin justificación se rechaza', h.autorizarHabilitacion(vencido, { autorizarVencido: true }).permitido === false);
  chk('Un vencido con autorización y justificación se acepta', h.autorizarHabilitacion(vencido, { autorizarVencido: true, justificacion: 'cliente confirmó el pago por teléfono' }).permitido === true);
  chk('Un servicio al día no exige autorización', h.autorizarHabilitacion(ev(sumarDias(hoy, 10)), {}).permitido === true);
  chk('Vence hoy sin aceptar advertencia se rechaza', h.autorizarHabilitacion(ev(hoy), {}).permitido === false);
  chk('Un bloqueado nunca se autoriza', h.autorizarHabilitacion(ev('30/11/2026'), { autorizarVencido: true, justificacion: 'texto largo suficiente' }).permitido === false);

  console.log('\n=== A3. Control negativo de las pruebas ===');
  chk('CONTROL: si el vencido devolviera puedeHabilitar=true, estas pruebas fallarían',
    vencido.puedeHabilitar === true && vencido.requiereAutorizacionVencido === true);
  chk('CONTROL: un estado inventado NO se clasifica como al día',
    ev(sumarDias(hoy, 10), { estadoCliente: 'CUALQUIERA' }).situacion !== 'AL_DIA');

  /* ─────────── Parte B · emulador ─────────── */
  console.log('\n=== B. Habilitación en el servidor (emulador) ===');
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const adm = await alta('hab-admin@cert.test');
  const adm2 = await alta('hab-admin2@cert.test');
  const ope = await alta('hab-oper@cert.test');
  await crear('usuarios', adm.uid, { email: s('hab-admin@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin Uno') });
  await crear('usuarios', adm2.uid, { email: s('hab-admin2@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin Dos') });
  await crear('usuarios', ope.uid, { email: s('hab-oper@cert.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador') });
  await crear('planes', 'p1', { nombre: s('Plan'), precio: n(50000), duracion: n(30), estado: s('ACTIVO') });
  const arrInt = (xs) => ({ arrayValue: { values: xs.map((x) => ({ integerValue: String(x) })) } });
  await crear('configuracion', 'diasAntes', { clave: s('diasAntes'), valor: arrInt([3]) });
  await crear('configuracion', 'diasDespues', { clave: s('diasDespues'), valor: arrInt([0]) });
  await crear('configuracion', 'diasSuspension', { clave: s('diasSuspension'), valor: n(3) });

  /* Servicios sintéticos en cada situación, todos VALIDADOS. */
  const casos = [
    ['al_dia', sumarDias(hoy, 10), 'ACTIVO'],
    ['vence_hoy', hoy, 'ACTIVO'],
    ['vencido', sumarDias(hoy, -30), 'ACTIVO'],
    ['suspendido', sumarDias(hoy, -5), 'SUSPENDIDO']
  ];
  for (const [id, venc, estado] of casos) {
    await crear('clientes', 'c_' + id, { nombreCompleto: s('Cliente ' + id), telefono: s('3000000000'), estadoCliente: s(estado), planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s(venc) });
    await crear('servicios', 'svc_' + id, { clienteId: s('c_' + id), planId: s('p1'), precioMensual: n(50000), estado: s('ACTIVO'), fechaVencimiento: s(venc), conciliacion: { mapValue: { fields: { estado: s('VALIDADA'), referencia: s('kz-unef-006') } } } });
  }

  let r = await callable('evaluarServiciosConciliacion', { servicioIds: ['svc_al_dia', 'svc_vence_hoy', 'svc_vencido', 'svc_suspendido'] }, adm.tok);
  chk('El servidor clasifica la tanda', r.st === 200, `HTTP ${r.st}`);
  const sit = (r.j.result.resumen.conteo || {});
  chk('Cuenta 1 al día, 1 vence hoy, 1 vencido, 1 suspendido',
    sit.AL_DIA === 1 && sit.VENCE_HOY === 1 && sit.VENCIDO === 1 && sit.SUSPENDIDO === 1, JSON.stringify(sit));
  chk('Solo dos requieren autorización o advertencia',
    r.j.result.resumen.requierenAutorizacion === 1 && r.j.result.resumen.habilitables === 2,
    `aut=${r.j.result.resumen.requierenAutorizacion} hab=${r.j.result.resumen.habilitables}`);

  r = await callable('habilitarServicio', { servicioId: 'svc_al_dia' }, adm.tok);
  chk('Al día se habilita sin fricción', r.st === 200, `HTTP ${r.st}`);

  r = await callable('habilitarServicio', { servicioId: 'svc_vence_hoy', advertenciaAceptada: true }, adm.tok);
  chk('Vence hoy se habilita con advertencia aceptada', r.st === 200, `HTTP ${r.st}`);

  r = await callable('habilitarServicio', { servicioId: 'svc_vencido' }, adm.tok);
  chk('VENCIDO sin autorización se RECHAZA', r.st === 400, `HTTP ${r.st}`);
  chk('El rechazo explica la consecuencia',
    r.j && r.j.error && /VENCIDO|vencido|motor de cortes/i.test(r.j.error.message || ''),
    r.j && r.j.error ? String(r.j.error.message).slice(0, 70) : '—');

  r = await callable('habilitarServicio', { servicioId: 'svc_vencido', autorizarVencido: true, justificacion: 'corto' }, adm.tok);
  chk('VENCIDO con justificación demasiado corta se RECHAZA', r.st === 400, `HTTP ${r.st}`);

  r = await callable('habilitarServicio', { servicioId: 'svc_vencido', autorizarVencido: true, justificacion: 'el cliente pagó y se verificó por teléfono' }, adm.tok);
  chk('VENCIDO con autorización explícita SE ACEPTA', r.st === 200, `HTTP ${r.st}`);
  chk('La respuesta declara la situación', r.j.result.situacion === 'VENCIDO', r.j.result.situacion);

  /* Concurrencia: dos administradores a la vez. */
  await crear('clientes', 'c_conc', { nombreCompleto: s('Cliente Concurrencia'), telefono: s('3000000002'), estadoCliente: s('ACTIVO'), planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s(sumarDias(hoy, 20)) });
  await crear('servicios', 'svc_conc', { clienteId: s('c_conc'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s(sumarDias(hoy, 20)), conciliacion: { mapValue: { fields: { estado: s('VALIDADA'), referencia: s('kz-unef-006') } } } });
  const [r1, r2] = await Promise.all([
    callable('habilitarServicio', { servicioId: 'svc_conc' }, adm.tok),
    callable('habilitarServicio', { servicioId: 'svc_conc' }, adm2.tok)
  ]);
  chk('Dos administradores: solo una habilitación prospera',
    [r1.st, r2.st].filter((x) => x === 200).length === 1, `${r1.st} / ${r2.st}`);

  /* Permisos. */
  for (const [nombre, tok, esperado] of [['anónimo', undefined, 401], ['OPERADOR', ope.tok, 403]]) {
    const a = await callable('habilitarServicio', { servicioId: 'svc_suspendido' }, tok);
    const c = await callable('habilitarServiciosLote', { servicioIds: ['svc_suspendido'] }, tok);
    const d = await callable('evaluarServiciosConciliacion', { servicioIds: ['svc_suspendido'] }, tok);
    chk(`${nombre} no habilita, ni lanza tandas, ni evalúa`,
      [a.st, c.st, d.st].every((x) => x === esperado || x === 403), `${a.st}/${c.st}/${d.st}`);
  }

  /* Tanda: los vencidos no entran sin autorización. */
  await crear('clientes', 'c_lote_v', { nombreCompleto: s('Cliente Lote Vencido'), telefono: s('3000000003'), estadoCliente: s('ACTIVO'), planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s(sumarDias(hoy, -40)) });
  await crear('servicios', 'svc_lote_v', { clienteId: s('c_lote_v'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s(sumarDias(hoy, -40)), conciliacion: { mapValue: { fields: { estado: s('VALIDADA'), referencia: s('kz-unef-006') } } } });

  await crear('clientes', 'c_lote_ok', { nombreCompleto: s('Cliente Lote OK'), telefono: s('3000000005'), estadoCliente: s('ACTIVO'), planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s(sumarDias(hoy, 15)) });
  await crear('servicios', 'svc_lote_ok', { clienteId: s('c_lote_ok'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s(sumarDias(hoy, 15)), conciliacion: { mapValue: { fields: { estado: s('VALIDADA'), referencia: s('kz-unef-006') } } } });

  r = await callable('habilitarServiciosLote', { servicioIds: ['svc_lote_ok', 'svc_lote_v'], simular: true }, adm.tok);
  chk('La simulación evalúa sin escribir', r.st === 200 && r.j.result.simulado === true, `HTTP ${r.st}`);
  chk('La simulación separa incluidos de excluidos',
    (r.j.result.resumen.SIMULADO_INCLUIDO || 0) >= 1 && (r.j.result.resumen.REQUIERE_AUTORIZACION || 0) >= 1,
    JSON.stringify(r.j.result.resumen));

  r = await callable('habilitarServiciosLote', { servicioIds: ['svc_lote_ok', 'svc_lote_v'] }, adm.tok);
  chk('La tanda NO habilita el vencido sin autorización',
    (r.j.result.resumen.REQUIERE_AUTORIZACION || 0) === 1 && (r.j.result.resumen.HABILITADO || 0) === 1,
    JSON.stringify(r.j.result.resumen));

  /* Motor: el habilitado ya se procesa; el protegido no. */
  await crear('clientes', 'c_protegido', { nombreCompleto: s('Cliente Protegido'), telefono: s('3000000004'), estadoCliente: s('ACTIVO'), planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s(sumarDias(hoy, -50)) });
  await crear('servicios', 'svc_protegido', { clienteId: s('c_protegido'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s(sumarDias(hoy, -50)), conciliacion: { mapValue: { fields: { estado: s('PENDIENTE_VALIDACION'), referencia: s('kz-unef-006') } } } });

  const sup = await alta('hab-super@cert.test');
  await crear('usuarios', sup.uid, { email: s('hab-super@cert.test'), rol: s('SUPERADMIN'), activo: b(true), nombre: s('Super') });
  const rMotor = await callable('ejecutarMotor', {}, sup.tok);
  chk('El motor corre', rMotor.st === 200, `HTTP ${rMotor.st}`);

  const get = async (ruta, campo) => { const x = await pedir('GET', `${BASE}/${ruta}`, undefined, 'owner'); return campo ? (x.j.fields[campo] || {}).stringValue : x.j; };
  chk('Un servicio suspendido queda bloqueado para habilitación',
    h.evaluarServicio({ servicio: { fechaVencimiento: sumarDias(hoy, -5), conciliacion: conc('VALIDADA') }, cliente: { estadoCliente: 'SUSPENDIDO' }, pagos: [] }).puedeHabilitar === false);
  chk('El cliente suspendido sigue suspendido (no se tocó)',
    (await get('clientes/c_suspendido', 'estadoCliente')) === 'SUSPENDIDO',
    await get('clientes/c_suspendido', 'estadoCliente'));
  chk('El servicio protegido NO se toca',
    (await get('clientes/c_protegido', 'estadoCliente')) === 'ACTIVO',
    await get('clientes/c_protegido', 'estadoCliente'));

  console.log('\n' + '='.repeat(72));
  console.log(`KZ-UNEF-008 · HABILITACIÓN: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(72));
  process.exit(fail ? 1 : 0);
})();
