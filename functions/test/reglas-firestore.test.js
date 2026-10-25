'use strict';
/* ============================================================
 * KZ-UNEF-002 · REGLAS DE FIRESTORE contra el emulador
 * ------------------------------------------------------------
 * Prueba las reglas REALES (no su texto): cada petición va con el token de un
 * usuario del emulador de Auth, así que Firestore evalúa `firestore.rules` tal
 * como lo hará en producción.
 *
 * Cubre el escenario 6 de la misión (XSS desde el alta pública) y el
 * endurecimiento de KZ-UNEF-001 (pagos, auditoría, notificaciones, campos
 * sensibles de clientes y servicios).
 *
 *   node test/reglas-firestore.test.js
 * ============================================================ */
const FS = 'http://127.0.0.1:8080', AUTH = 'http://127.0.0.1:9199';
const P = 'demo-unefibra', K = 'clave-ficticia';
const base = `${FS}/v1/projects/${P}/databases/(default)/documents`;
const s = (v) => ({ stringValue: v }), b = (v) => ({ booleanValue: v }), n = (v) => ({ integerValue: String(v) });

const pedir = async (m, url, cuerpo, tok) => {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h.Authorization = 'Bearer ' + tok;
  const r = await fetch(url, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { st: r.status, j, txt };
};
/* Escrituras con token 'owner' saltan las reglas: es el Admin SDK del emulador. */
const crearAdmin = (c, id, f) => pedir('POST', `${base}/${c}?documentId=${id}`, { fields: f }, 'owner');

/* Escritura CON reglas (token de usuario real o ninguna). */
const crearConReglas = (c, id, campos, tok) => {
  const fields = {};
  for (const [k, v] of Object.entries(campos)) {
    if (typeof v === 'boolean') fields[k] = b(v);
    else if (typeof v === 'number') fields[k] = n(v);
    else fields[k] = s(v);
  }
  return pedir('POST', `${base}/${c}?documentId=${id}`, { fields }, tok);
};
const actualizarConReglas = (ruta, campos, tok) => {
  const fields = {};
  for (const [k, v] of Object.entries(campos)) fields[k] = typeof v === 'number' ? n(v) : s(v);
  const mascara = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + k).join('&');
  return pedir('PATCH', `${base}/${ruta}?${mascara}`, { fields }, tok);
};
const leerConReglas = (ruta, tok) => pedir('GET', `${base}/${ruta}`, undefined, tok);

const alta = async (email) => {
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Ficticia#1', returnSecureToken: true })
  });
  const j = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Ficticia#1', returnSecureToken: true })
  })).json();
  return { uid: j.localId, tok: j.idToken };
};

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, c, d) => {
  if (c) { ok++; console.log('  PASA   ' + nm.padEnd(58) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(55) + (d || '')); }
};
const denegado = (r) => r.st === 403 || r.st === 401;
const permitido = (r) => r.st === 200 || r.st === 201 || r.st === 404 && false;

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const adm = await alta('rules-admin@cert.test');
  const ope = await alta('rules-operador@cert.test');
  const superAdm = await alta('rules-super@cert.test');
  await crearAdmin('usuarios', adm.uid, { email: s('rules-admin@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin R') });
  await crearAdmin('usuarios', ope.uid, { email: s('rules-operador@cert.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador R') });
  await crearAdmin('usuarios', superAdm.uid, { email: s('rules-super@cert.test'), rol: s('SUPERADMIN'), activo: b(true), nombre: s('Super R') });
  await crearAdmin('clientes', 'r_cli', { nombreCompleto: s('Cliente Reglas'), estadoCliente: s('ACTIVO'), precioMensual: n(99900) });
  await crearAdmin('servicios', 'r_svc', { clienteId: s('r_cli'), estado: s('ACTIVO') });

  /* ─────────── Escenario 6 · XSS desde el alta pública ─────────── */
  console.log('\n=== 6. Alta pública: XSS y campos arbitrarios (SIN sesión) ===');

  let r = await crearConReglas('solicitudes_contacto', 'ok1',
    { nombre: 'Ana Ficticia', telefono: '3001112233', barrio: 'Centro', estado: 'NUEVA' });
  chk('Una solicitud legítima se acepta', r.st === 200, `HTTP ${r.st}`);

  r = await crearConReglas('solicitudes_contacto', 'xss1',
    { nombre: 'Mallory', telefono: '3009998877', estado: '"><img src=x onerror=alert(1)>' });
  chk('Estado con HTML inyectado se RECHAZA', denegado(r), `HTTP ${r.st}`);

  r = await crearConReglas('solicitudes_contacto', 'xss2',
    { nombre: 'Mallory', telefono: '3009998877', campoInventado: '<script>alert(1)</script>' });
  chk('Campo no previsto por el formulario se RECHAZA', denegado(r), `HTTP ${r.st}`);

  r = await crearConReglas('solicitudes_contacto', 'xss3', { nombre: 'Mallory' });
  chk('Solicitud sin teléfono se RECHAZA', denegado(r), `HTTP ${r.st}`);

  r = await crearConReglas('solicitudes_contacto', 'xss4', { nombre: 'M', telefono: '123' });
  chk('Teléfono demasiado corto se RECHAZA', denegado(r), `HTTP ${r.st}`);

  r = await leerConReglas('clientes/r_cli', undefined);
  chk('Sin sesión NO se leen clientes', denegado(r), `HTTP ${r.st}`);

  r = await leerConReglas('pagos/' + 'ninguno', undefined);
  chk('Sin sesión NO se leen pagos', denegado(r), `HTTP ${r.st}`);

  /* ─────────── Colecciones que solo escribe el servidor ─────────── */
  console.log('\n=== Pagos y auditoría: solo el servidor ===');

  r = await crearConReglas('pagos', 'p_intruso', { clienteId: 'r_cli', monto: 99900, estado: 'CONFIRMADO', periodoFin: '2030-01-01' }, adm.tok);
  chk('ADMIN NO puede fabricar un pago desde el navegador', denegado(r), `HTTP ${r.st}`);

  r = await crearConReglas('auditoria', 'a_intruso', { accion: 'FALSA', usuarioId: 'x' }, ope.tok);
  chk('OPERADOR NO puede escribir auditoría', denegado(r), `HTTP ${r.st}`);

  r = await crearConReglas('historial_estados', 'h_intruso', { clienteId: 'r_cli', estadoNuevo: 'ACTIVO' }, adm.tok);
  chk('ADMIN NO puede fabricar historial', denegado(r), `HTTP ${r.st}`);

  /* ─────────── Notificaciones: registro anti-fraude ─────────── */
  console.log('\n=== Notificaciones: el antiduplicado no se puede falsificar ===');

  r = await crearConReglas('notificaciones', 'n_intruso', { clienteId: 'r_cli', estado: 'ENVIADA', claveDedup: 'r_cli_x_CORTE_15_3_DIAS' }, adm.tok);
  chk('ADMIN NO puede escribir notificaciones (borraría avisos de cobro)', denegado(r), `HTTP ${r.st}`);

  r = await leerConReglas('notificaciones/' + 'ninguna', ope.tok);
  chk('OPERADOR sí puede leerlas (404 = permitido y vacío)', r.st === 404 || r.st === 200, `HTTP ${r.st}`);

  /* ─────────── Campos sensibles de clientes y servicios ─────────── */
  console.log('\n=== Clientes y servicios: los campos sensibles son del servidor ===');

  /* Se ataca con un valor DISTINTO: reescribir el mismo valor no es un cambio
     real y `diff()` no lo cuenta (así que pasa, y es correcto). */
  r = await actualizarConReglas('clientes/r_cli', { estadoCliente: 'SUSPENDIDO' }, adm.tok);
  chk('ADMIN NO cambia estadoCliente directamente', denegado(r), `HTTP ${r.st}`);

  r = await actualizarConReglas('clientes/r_cli', { estadoCliente: 'ACTIVO' }, adm.tok);
  chk('Reescribir el MISMO estado no rompe nada (no es un cambio)', permitido(r), `HTTP ${r.st}`);

  r = await actualizarConReglas('clientes/r_cli', { precioMensual: 1 }, adm.tok);
  chk('ADMIN NO cambia el precio directamente', denegado(r), `HTTP ${r.st}`);

  r = await actualizarConReglas('clientes/r_cli', { fechaVencimiento: '2031-01-01' }, adm.tok);
  chk('ADMIN NO cambia el vencimiento directamente', denegado(r), `HTTP ${r.st}`);

  r = await actualizarConReglas('servicios/r_svc', { estado: 'SUSPENDIDO' }, adm.tok);
  chk('ADMIN NO cambia el estado del servicio directamente', denegado(r), `HTTP ${r.st}`);

  r = await actualizarConReglas('clientes/r_cli', { observaciones: 'Nota de prueba' }, adm.tok);
  chk('ADMIN SÍ puede editar un campo no sensible (el panel no se rompe)', permitido(r), `HTTP ${r.st}`);

  r = await actualizarConReglas('clientes/r_cli', { observaciones: 'Otra nota' }, ope.tok);
  chk('OPERADOR NO escribe clientes', denegado(r), `HTTP ${r.st}`);

  /* ─────────── Lecturas por rol ─────────── */
  console.log('\n=== Lecturas por rol ===');

  r = await leerConReglas('clientes/r_cli', ope.tok);
  chk('OPERADOR lee clientes', permitido(r), `HTTP ${r.st}`);

  r = await leerConReglas('auditoria/' + 'ninguna', adm.tok);
  chk('ADMIN NO lee auditoría (solo SUPERADMIN)', denegado(r), `HTTP ${r.st}`);

  r = await leerConReglas('auditoria/' + 'ninguna', superAdm.tok);
  chk('SUPERADMIN sí lee auditoría', r.st === 404 || r.st === 200, `HTTP ${r.st}`);

  /* ─────────── El alta de tokens sigue siendo pública (riesgo declarado) ─────────── */
  console.log('\n=== Tokens de notificación (alta pública) ===');

  r = await crearConReglas('tokens_notificacion', 't_pub', { clienteId: 'r_cli', token: 'x'.repeat(40) });
  chk('El alta anónima de token sigue permitida (riesgo declarado)', r.st === 200, `HTTP ${r.st}`);

  r = await crearConReglas('tokens_notificacion', 't_malo', { clienteId: 'r_cli', token: 'corto' });
  chk('Un token con forma inválida se rechaza', denegado(r), `HTTP ${r.st}`);

  console.log('\n' + '='.repeat(72));
  console.log(`REGLAS FIRESTORE: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(72));
  process.exit(fail ? 1 : 0);
})();
