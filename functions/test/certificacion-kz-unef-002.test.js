'use strict';
/* ============================================================
 * KZ-UNEF-002 · CERTIFICACIÓN PREVIA A PRODUCCIÓN
 * ------------------------------------------------------------
 * Cubre los escenarios que la misión exige y que las pruebas anteriores
 * NO tocaban:
 *   1. Pago de un cliente VENCIDO (el defecto crítico de KZ-UNEF-001).
 *   2. Renovación del periodo de un cliente al día.
 *   3. Prevención de cortes incorrectos (el motor no corta a quien pagó).
 *   4. Anulación de pagos confirmados, incluida la carrera con la confirmación.
 *   5. Prevención de pagos duplicados.
 *   7. Acceso no autorizado a las funciones administrativas.
 *
 * Requiere los emuladores:  firebase emulators:start --config firebase.test.json
 *   node test/certificacion-kz-unef-002.test.js
 * ============================================================ */
const FS = 'http://127.0.0.1:8080', FN = 'http://127.0.0.1:5001', AUTH = 'http://127.0.0.1:9199';
const P = 'demo-unefibra', K = 'clave-ficticia';
const u = (r) => `${FS}/v1/projects/${P}/databases/(default)/documents/${r}`;
const s = (v) => ({ stringValue: v }), n = (v) => ({ integerValue: String(v) }), b = (v) => ({ booleanValue: v });

const pedir = async (m, url, c, t) => {
  const h = { 'Content-Type': 'application/json' };
  if (t) h.Authorization = 'Bearer ' + t;
  const r = await fetch(url, { method: m, headers: h, body: c === undefined ? undefined : JSON.stringify(c) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { st: r.status, j, txt };
};
const crear = (c, id, f, t = 'owner') => pedir('POST', `${u(c)}?documentId=${id}`, { fields: f }, t);
const leer = (r, t = 'owner') => pedir('GET', u(r), undefined, t);
const callable = (nombre, datos, tok) => pedir('POST', `${FN}/${P}/us-central1/${nombre}`, { data: datos }, tok);
const listar = async (c) => {
  const r = await pedir('POST', `${FS}/v1/projects/${P}/databases/(default)/documents:runQuery`,
    { structuredQuery: { from: [{ collectionId: c }] } }, 'owner');
  return (Array.isArray(r.j) ? r.j : []).filter((x) => x.document).map((x) => x.document);
};
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

/* Fechas en zona Colombia, igual que el motor. */
const OFFSET = -5 * 3600000;
const fecha = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
const hoy = () => fecha(Date.now());
const masDias = (x) => fecha(Date.now() + x * 86400000);
const campo = (doc, k) => (doc && doc.fields && doc.fields[k] ? Object.values(doc.fields[k])[0] : undefined);

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, c, d) => {
  if (c) { ok++; console.log('  PASA   ' + nm.padEnd(58) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(55) + (d || '')); }
};

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const sa = await alta('super@cert.test');
  const adm = await alta('admin@cert.test');
  const ope = await alta('operador@cert.test');
  const usr = await alta('cliente@cert.test');
  await crear('usuarios', sa.uid, { email: s('super@cert.test'), rol: s('SUPERADMIN'), activo: b(true), nombre: s('Super Ficticio') });
  await crear('usuarios', adm.uid, { email: s('admin@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin Ficticio') });
  await crear('usuarios', ope.uid, { email: s('operador@cert.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador Ficticio') });
  await crear('usuarios', usr.uid, { email: s('cliente@cert.test'), rol: s('CLIENTE'), activo: b(true) });

  await crear('planes', 'p1', { nombre: s('Plan Ficticio'), precio: n(99900), duracion: n(30), estado: s('ACTIVO') });
  const arrInt = (xs) => ({ arrayValue: { values: xs.map((x) => ({ integerValue: String(x) })) } });
  await crear('configuracion', 'diasAntes', { clave: s('diasAntes'), valor: arrInt([3]) });
  await crear('configuracion', 'diasDespues', { clave: s('diasDespues'), valor: arrInt([0]) });
  await crear('configuracion', 'diasSuspension', { clave: s('diasSuspension'), valor: n(3) });

  /* ─────────── ESCENARIO 1 · Cliente VENCIDO que paga ─────────── */
  console.log('\n=== 1. Pago de un cliente vencido (defecto crítico de KZ-UNEF-001) ===');
  const vencimientoViejo = masDias(-60);
  await crear('clientes', 'vencido', {
    nombreCompleto: s('Cliente Moroso'), telefono: s('3001112233'), estadoCliente: s('SUSPENDIDO'),
    estadoServicio: s('SUSPENDIDO'), planId: s('p1'), precioMensual: n(99900),
    fechaVencimiento: s(vencimientoViejo), fechaInicioServicio: s(masDias(-200))
  });
  await crear('servicios', 'svc_vencido', {
    clienteId: s('vencido'), estado: s('SUSPENDIDO'), fechaVencimiento: s(vencimientoViejo), planId: s('p1')
  });

  const fechaPagoReal = masDias(-2);   // pagó hace dos días, se confirma hoy
  let r = await callable('registrarPago', { clienteId: 'vencido', monto: 99900, metodoPago: 'Nequi', fechaPago: fechaPagoReal }, adm.tok);
  const pagoVencido = r.j && r.j.result && r.j.result.id;
  chk('El pago del moroso se registra', r.st === 200 && !!pagoVencido, `HTTP ${r.st}`);

  r = await callable('confirmarPago', { pagoId: pagoVencido }, adm.tok);
  chk('La confirmación se acepta', r.st === 200, `HTTP ${r.st}`);

  const pagoDoc = (await leer('pagos/' + pagoVencido)).j;
  chk('El periodo empieza HOY, no en el vencimiento viejo',
    campo(pagoDoc, 'periodoInicio') === hoy(), `inicio=${campo(pagoDoc, 'periodoInicio')} hoy=${hoy()}`);
  chk('El periodo termina en hoy + 30 días',
    campo(pagoDoc, 'periodoFin') === masDias(30), `fin=${campo(pagoDoc, 'periodoFin')} esperado=${masDias(30)}`);

  const cliVencido = (await leer('clientes/vencido')).j;
  chk('El cliente queda ACTIVO', campo(cliVencido, 'estadoCliente') === 'ACTIVO', campo(cliVencido, 'estadoCliente'));
  chk('Su vencimiento queda en el futuro',
    campo(cliVencido, 'fechaVencimiento') === masDias(30), `vence=${campo(cliVencido, 'fechaVencimiento')}`);
  chk('La fecha de alta del cliente NO se sobrescribe',
    campo(cliVencido, 'fechaInicioServicio') === masDias(-200), `alta=${campo(cliVencido, 'fechaInicioServicio')}`);
  chk('La fecha real de pago se conserva (no la del clic)',
    campo(pagoDoc, 'fechaPago') === fechaPagoReal, `fechaPago=${campo(pagoDoc, 'fechaPago')}`);

  const svcVencido = (await leer('servicios/svc_vencido')).j;
  chk('El servicio queda ACTIVO y con el vencimiento nuevo',
    campo(svcVencido, 'estado') === 'ACTIVO' && campo(svcVencido, 'fechaVencimiento') === masDias(30),
    `${campo(svcVencido, 'estado')} · ${campo(svcVencido, 'fechaVencimiento')}`);

  const histVencido = (await listar('historial_estados')).filter((h) => campo(h, 'clienteId') === 'vencido');
  chk('El historial registra el estado del CLIENTE, no el del pago',
    histVencido.length > 0 && campo(histVencido[histVencido.length - 1], 'estadoAnterior') === 'SUSPENDIDO',
    `anterior=${histVencido.length ? campo(histVencido[histVencido.length - 1], 'estadoAnterior') : 'sin historial'}`);

  /* ─────────── ESCENARIO 2 · Cliente al día que renueva ─────────── */
  console.log('\n=== 2. Renovación del periodo de un cliente al día ===');
  const vencimientoFuturo = masDias(10);
  await crear('clientes', 'aldia', {
    nombreCompleto: s('Cliente Al Día'), telefono: s('3004445566'), estadoCliente: s('ACTIVO'),
    estadoServicio: s('ACTIVO'), planId: s('p1'), precioMensual: n(99900), fechaVencimiento: s(vencimientoFuturo)
  });
  await crear('servicios', 'svc_aldia', {
    clienteId: s('aldia'), estado: s('ACTIVO'), fechaVencimiento: s(vencimientoFuturo), planId: s('p1')
  });
  r = await callable('registrarPago', { clienteId: 'aldia', monto: 99900, metodoPago: 'Efectivo' }, adm.tok);
  const pagoAldia = r.j && r.j.result && r.j.result.id;
  await callable('confirmarPago', { pagoId: pagoAldia }, adm.tok);
  const pagoAldiaDoc = (await leer('pagos/' + pagoAldia)).j;
  chk('Encadena desde el vencimiento vigente (no regala ni cobra días)',
    campo(pagoAldiaDoc, 'periodoInicio') === vencimientoFuturo && campo(pagoAldiaDoc, 'periodoFin') === masDias(40),
    `${campo(pagoAldiaDoc, 'periodoInicio')} → ${campo(pagoAldiaDoc, 'periodoFin')}`);

  /* ─────────── ESCENARIO 3 · El motor NO corta a quien pagó ─────────── */
  console.log('\n=== 3. Prevención de cortes incorrectos ===');
  r = await callable('ejecutarMotor', {}, sa.tok);
  chk('El motor corre (SUPERADMIN)', r.st === 200, `HTTP ${r.st}`);
  const trasMotor = (await leer('clientes/vencido')).j;
  chk('Al moroso que pagó NO se le vuelve a suspender',
    campo(trasMotor, 'estadoCliente') === 'ACTIVO', `estado=${campo(trasMotor, 'estadoCliente')}`);
  chk('Su vencimiento no retrocede tras la corrida del motor',
    campo(trasMotor, 'fechaVencimiento') === masDias(30), `vence=${campo(trasMotor, 'fechaVencimiento')}`);
  const svcTrasMotor = (await leer('servicios/svc_vencido')).j;
  chk('El servicio sigue ACTIVO tras el motor',
    campo(svcTrasMotor, 'estado') === 'ACTIVO', campo(svcTrasMotor, 'estado'));
  const resumen = (r.j && r.j.result) || {};
  chk('El motor no suspendió a nadie', (resumen.suspendidos || 0) === 0, `suspendidos=${resumen.suspendidos}`);
  const aldiaTrasMotor = (await leer('clientes/aldia')).j;
  chk('El cliente al día sigue ACTIVO', campo(aldiaTrasMotor, 'estadoCliente') === 'ACTIVO', campo(aldiaTrasMotor, 'estadoCliente'));

  /* ─────────── ESCENARIO 4 · Anulación ─────────── */
  console.log('\n=== 4. Anulación de pagos ===');
  r = await callable('anularPago', { pagoId: pagoVencido, motivo: 'Intento sobre un pago ya confirmado' }, adm.tok);
  chk('Anular un pago CONFIRMADO se rechaza', r.st === 400 || r.st === 412, `HTTP ${r.st}`);
  const pagoSigueConfirmado = (await leer('pagos/' + pagoVencido)).j;
  chk('El pago confirmado sigue CONFIRMADO', campo(pagoSigueConfirmado, 'estado') === 'CONFIRMADO', campo(pagoSigueConfirmado, 'estado'));

  // Carrera: confirmar y anular el mismo pago a la vez.
  await crear('clientes', 'carrera', {
    nombreCompleto: s('Cliente Carrera'), telefono: s('3007778899'), estadoCliente: s('ACTIVO'),
    estadoServicio: s('ACTIVO'), planId: s('p1'), precioMensual: n(99900), fechaVencimiento: s(masDias(-5))
  });
  await crear('servicios', 'svc_carrera', {
    clienteId: s('carrera'), estado: s('ACTIVO'), fechaVencimiento: s(masDias(-5)), planId: s('p1')
  });
  const rr = await callable('registrarPago', { clienteId: 'carrera', monto: 99900, metodoPago: 'Nequi' }, adm.tok);
  const pagoCarrera = rr.j && rr.j.result && rr.j.result.id;
  const [conf, anu] = await Promise.all([
    callable('confirmarPago', { pagoId: pagoCarrera }, adm.tok),
    callable('anularPago', { pagoId: pagoCarrera, motivo: 'Anulación simultánea de prueba' }, adm.tok)
  ]);
  const exitos = [conf.st, anu.st].filter((x) => x === 200).length;
  chk('Confirmar y anular a la vez: como máximo uno tiene éxito', exitos <= 1, `confirmar=${conf.st} anular=${anu.st}`);
  const pagoCarreraDoc = (await leer('pagos/' + pagoCarrera)).j;
  const clienteCarrera = (await leer('clientes/carrera')).j;
  const estadoCarrera = campo(pagoCarreraDoc, 'estado');
  /* El cliente estaba vencido 5 días atrás, así que si la confirmación gana el
     periodo nuevo arranca HOY y termina en hoy+30 (no en hoy+25). */
  const renovado = campo(clienteCarrera, 'fechaVencimiento') === masDias(30);
  chk('Nunca queda ANULADO con el servicio renovado',
    !(estadoCarrera === 'ANULADO' && renovado), `pago=${estadoCarrera} vence=${campo(clienteCarrera, 'fechaVencimiento')}`);
  chk('El estado final es coherente (CONFIRMADO con renovación, o ANULADO sin ella)',
    (estadoCarrera === 'CONFIRMADO' && renovado) || (estadoCarrera === 'ANULADO' && !renovado), `pago=${estadoCarrera} renovado=${renovado}`);

  /* ─────────── ESCENARIO 5 · Pagos duplicados ─────────── */
  console.log('\n=== 5. Prevención de pagos duplicados ===');
  r = await callable('registrarPago', { clienteId: 'aldia', monto: 99900, metodoPago: 'Nequi', referencia: 'TRX-ABC-1' }, adm.tok);
  const pagoRef = r.j && r.j.result && r.j.result.id;
  chk('Primer pago con referencia se acepta', r.st === 200 && !!pagoRef, `HTTP ${r.st}`);
  r = await callable('registrarPago', { clienteId: 'aldia', monto: 99900, metodoPago: 'Nequi', referencia: 'TRX-ABC-1' }, adm.tok);
  chk('El MISMO comprobante se rechaza', r.st === 409 || r.st === 400, `HTTP ${r.st}`);
  const conRef = (await listar('pagos')).filter((p) => campo(p, 'referencia') === 'TRX-ABC-1');
  chk('Solo existe un pago con esa referencia', conRef.length === 1, `${conRef.length} pagos`);
  r = await callable('registrarPago', { clienteId: 'aldia', monto: 49900, metodoPago: 'Nequi', referencia: 'TRX-ABC-2' }, adm.tok);
  chk('Una referencia distinta sí se acepta', r.st === 200, `HTTP ${r.st}`);
  await callable('anularPago', { pagoId: pagoRef, motivo: 'Comprobante duplicado por error' }, adm.tok);
  r = await callable('registrarPago', { clienteId: 'aldia', monto: 99900, metodoPago: 'Nequi', referencia: 'TRX-ABC-1' }, adm.tok);
  chk('Tras anularlo, el mismo comprobante se puede volver a registrar', r.st === 200, `HTTP ${r.st}`);

  /* ─────────── ESCENARIO 7 · Acceso no autorizado ─────────── */
  console.log('\n=== 7. Acceso no autorizado a funciones administrativas ===');
  const ADMINISTRATIVAS = ['registrarPago', 'confirmarPago', 'anularPago', 'crearCliente', 'actualizarCliente',
    'eliminarCliente', 'activarServicio', 'suspenderServicio', 'desactivarServicio', 'reactivarServicio',
    'enviarNotificacion', 'crearUsuario', 'actualizarUsuario', 'ejecutarMotor', 'estadoMikrotik', 'seedDemo'];

  let anonOk = 0; const anonMal = [];
  for (const f of ADMINISTRATIVAS) {
    const x = await callable(f, {}, undefined);
    if (x.st === 401 || x.st === 403) anonOk++; else anonMal.push(`${f}=${x.st}`);
  }
  chk(`Anónimo rechazado en las ${ADMINISTRATIVAS.length} funciones`, anonOk === ADMINISTRATIVAS.length, anonMal.join(' '));

  let cliOk = 0; const cliMal = [];
  for (const f of ADMINISTRATIVAS) {
    const x = await callable(f, { clienteId: 'aldia', pagoId: pagoVencido }, usr.tok);
    if (x.st === 401 || x.st === 403) cliOk++; else cliMal.push(`${f}=${x.st}`);
  }
  chk('Un usuario CLIENTE no ejecuta ninguna', cliOk === ADMINISTRATIVAS.length, cliMal.join(' '));

  r = await callable('registrarPago', { clienteId: 'aldia', monto: 99900 }, ope.tok);
  chk('OPERADOR no registra pagos', r.st === 403, `HTTP ${r.st}`);
  r = await callable('crearCliente', { nombreCompleto: 'X', telefono: '3000000000', planId: 'p1' }, ope.tok);
  chk('OPERADOR no crea clientes', r.st === 403, `HTTP ${r.st}`);
  r = await callable('ejecutarMotor', {}, ope.tok);
  chk('OPERADOR no dispara el motor', r.st === 403, `HTTP ${r.st}`);
  r = await callable('activarServicio', { clienteId: 'aldia' }, ope.tok);
  chk('OPERADOR no activa servicios', r.st === 403, `HTTP ${r.st}`);
  r = await callable('mensajeCobro', { clienteId: 'aldia' }, ope.tok);
  chk('OPERADOR sí puede preparar el mensaje de cobro', r.st === 200, `HTTP ${r.st}`);

  r = await callable('estadoMikrotik', {}, adm.tok);
  const mik = r.j && r.j.result;
  chk('estadoMikrotik responde sin credenciales y NO se conecta',
    r.st === 200 && mik && mik.configurado === false, r.st === 200 ? `configurado=${mik && mik.configurado}` : `HTTP ${r.st}`);

  /* ─────────── EXTRA · Validaciones que protegen los datos ─────────── */
  console.log('\n=== 8. Validaciones de entrada (datos que no deben corromperse) ===');
  r = await callable('registrarPago', { clienteId: 'aldia', monto: true }, adm.tok);
  chk('Monto booleano rechazado', r.st === 400, `HTTP ${r.st}`);
  r = await callable('registrarPago', { clienteId: 'aldia', monto: [99900] }, adm.tok);
  chk('Monto en lista rechazado', r.st === 400, `HTTP ${r.st}`);
  r = await callable('actualizarCliente', { clienteId: 'aldia', campos: { precioMensual: 'abc' } }, adm.tok);
  chk('precioMensual no numérico rechazado', r.st === 400, `HTTP ${r.st}`);
  const aldiaDoc = (await leer('clientes/aldia')).j;
  /* integerValue viaja como TEXTO en la API REST: se compara como número. */
  chk('El precio del cliente no se convirtió en 0',
    Number(campo(aldiaDoc, 'precioMensual')) === 99900, `precio=${campo(aldiaDoc, 'precioMensual')}`);
  r = await callable('actualizarCliente', { clienteId: 'aldia', campos: { precioMensual: 120000 } }, adm.tok);
  chk('Un precio válido sí se acepta', r.st === 200, `HTTP ${r.st}`);

  console.log('\n' + '='.repeat(72));
  console.log(`CERTIFICACIÓN KZ-UNEF-002: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(72));
  process.exit(fail ? 1 : 0);
})();
