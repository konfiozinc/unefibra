'use strict';
/* ============================================================
 * KZ-UNEF-006 · FASE 5 — Certificación con emuladores
 * ------------------------------------------------------------
 * Datos sintéticos con los 11 perfiles que exige la misión y las 10
 * comprobaciones: creación, duplicación rechazada, conservación de fechas y
 * precios, AUSENCIA DE SUSPENSIONES, AUSENCIA DE NOTIFICACIONES, ausencia de
 * operaciones MikroTik, reversión segura y accesos no autorizados.
 *
 * Lo importante de esta batería es el CONTROL POSITIVO: un cliente con
 * servicio normal y vencido SÍ se suspende. Si todo quedara bloqueado, el
 * guardia estaría roto en la otra dirección.
 *
 *   node test/migracion-emulador.test.js
 * ============================================================ */
const FS = 'http://127.0.0.1:8080', FN = 'http://127.0.0.1:5001', AUTH = 'http://127.0.0.1:9199';
const P = 'demo-unefibra', K = 'clave-ficticia';
const BASE = `${FS}/v1/projects/${P}/databases/(default)/documents`;

const s = (v) => ({ stringValue: v }), n = (v) => ({ integerValue: String(v) }), b = (v) => ({ booleanValue: v });
const mapa = (o) => ({ mapValue: { fields: o } });

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
  const r = await pedir('POST', `${FS}/v1/projects/${P}/databases/(default)/documents:runQuery`,
    { structuredQuery: { from: [{ collectionId: col }] } }, 'owner');
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

const OFFSET = -5 * 3600000;
const fecha = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
const hoy = () => fecha(Date.now());
const masDias = (x) => fecha(Date.now() + x * 86400000);
const campo = (doc, k) => (doc && doc.fields && doc.fields[k] ? Object.values(doc.fields[k])[0] : undefined);

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(58) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(55) + (d || '')); }
};

/* Bloque de conciliación tal como lo escribe la migración. */
const conciliacion = () => mapa({
  estado: s('PENDIENTE_VALIDACION'),
  desde: s('2026-10-26T00:00:00.000Z'),
  referencia: s('kz-unef-006'),
  motivo: s('Datos heredados de la importación: pendientes de validación administrativa.')
});

const servicioMigrado = (clienteId, vence, extra = {}) => ({
  clienteId: s(clienteId),
  planId: s('p1'),
  precioMensual: n(50000),
  estado: s('ACTIVO'),
  fechaVencimiento: s(vence),
  fechaInicio: s(masDias(-60)),
  origen: s('kz-unef-006'),
  conciliacion: conciliacion(),
  ...extra
});

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const sup = await alta('mig-super@cert.test');
  const adm = await alta('mig-admin@cert.test');
  const ope = await alta('mig-operador@cert.test');
  await crear('usuarios', sup.uid, { email: s('mig-super@cert.test'), rol: s('SUPERADMIN'), activo: b(true), nombre: s('Super Ficticio') });
  await crear('usuarios', adm.uid, { email: s('mig-admin@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin Ficticio') });
  await crear('usuarios', ope.uid, { email: s('mig-operador@cert.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador Ficticio') });

  await crear('planes', 'p1', { nombre: s('Plan Ficticio'), precio: n(50000), duracion: n(30), estado: s('ACTIVO') });
  const arrInt = (xs) => ({ arrayValue: { values: xs.map((x) => ({ integerValue: String(x) })) } });
  await crear('configuracion', 'diasAntes', { clave: s('diasAntes'), valor: arrInt([3]) });
  await crear('configuracion', 'diasDespues', { clave: s('diasDespues'), valor: arrInt([0]) });
  await crear('configuracion', 'diasSuspension', { clave: s('diasSuspension'), valor: n(3) });

  /* ── Los 11 perfiles sintéticos ── */
  const cliente = (id, estado, vence, extra = {}) => crear('clientes', id, {
    nombreCompleto: s('Cliente ' + id), telefono: s('3000000000'), estadoCliente: s(estado),
    estadoServicio: s('ACTIVO'), planId: s('p1'), precioMensual: n(50000),
    fechaVencimiento: s(vence), fechaInicioServicio: s(masDias(-60)), cicloCorte: s('30'), ...extra
  });

  await cliente('c_aldia', 'ACTIVO', masDias(10));                       // 1 al día + servicio normal
  await crear('servicios', 'svc-c_aldia', { clienteId: s('c_aldia'), planId: s('p1'), precioMensual: n(50000), estado: s('ACTIVO'), fechaVencimiento: s(masDias(10)) });

  await cliente('c_vencido', 'ACTIVO', masDias(-30));                    // 2 vencido + servicio migrado
  await crear('servicios', 'svc-c_vencido', servicioMigrado('c_vencido', masDias(-30)));

  await cliente('c_suspendido', 'SUSPENDIDO', masDias(-40));             // 3 suspendido + migrado
  await crear('servicios', 'svc-c_suspendido', servicioMigrado('c_suspendido', masDias(-40)));

  await cliente('c_retirado', 'INACTIVO', masDias(-60));                 // 4 retirado + migrado
  await crear('servicios', 'svc-c_retirado', servicioMigrado('c_retirado', masDias(-60)));

  await cliente('c_sin_ip', 'ACTIVO', masDias(-30));                     // 5 sin IP + migrado
  await crear('servicios', 'svc-c_sin_ip', servicioMigrado('c_sin_ip', masDias(-30)));

  await cliente('c_sin_plan', 'ACTIVO', masDias(-30), { planId: { nullValue: null } });  // 6 sin plan (no migrado)

  await cliente('c_sin_precio', 'ACTIVO', masDias(-30), { precioMensual: { nullValue: null } }); // 7 sin precio

  await cliente('c_con_servicio', 'ACTIVO', masDias(-30));                // 8 CONTROL: servicio normal
  await crear('servicios', 'svc-c_con_servicio', { clienteId: s('c_con_servicio'), planId: s('p1'), precioMensual: n(50000), estado: s('ACTIVO'), fechaVencimiento: s(masDias(-30)) });

  await cliente('c_duplicado', 'ACTIVO', masDias(-30));                  // 9 dos servicios
  await crear('servicios', 'svc-c_duplicado', { clienteId: s('c_duplicado'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s(masDias(-30)) });
  await crear('servicios', 'svc-c_duplicado-2', productoDuplicado());

  function productoDuplicado() {
    return { clienteId: s('c_duplicado'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s(masDias(-30)), origen: s('kz-unef-006'), conciliacion: conciliacion() };
  }

  await cliente('c_pago_concurrente', 'ACTIVO', masDias(-5));            // 10 con pago
  await crear('servicios', 'svc-c_pago_concurrente', servicioMigrado('c_pago_concurrente', masDias(-5)));
  const rp = await callable('registrarPago', { clienteId: 'c_pago_concurrente', monto: 50000, metodoPago: 'Nequi' }, adm.tok);
  const pagoId = rp.j && rp.j.result && rp.j.result.id;

  await cliente('c_cambia', 'ACTIVO', masDias(-30));                     // 11 cambia durante la migración
  await crear('servicios', 'svc-c_cambia', servicioMigrado('c_cambia', masDias(-30)));
  await pedir('PATCH', `${BASE}/servicios/svc-c_cambia?updateMask.fieldPaths=fechaVencimiento&updateMask.fieldPaths=precioMensual`,
    { fields: { fechaVencimiento: s(masDias(20)), precioMensual: n(70000) } }, 'owner');

  /* ── 1. El motor NO suspende lo que está en conciliación ── */
  console.log('\n=== 1. Ausencia de suspensiones sobre servicios migrados ===');
  const rMotor = await callable('ejecutarMotor', {}, sup.tok);
  chk('El motor corre', rMotor.st === 200, `HTTP ${rMotor.st}`);

  const vencido = (await leer('clientes/c_vencido')).j;
  chk('Cliente vencido con servicio migrado NO se suspende', campo(vencido, 'estadoCliente') === 'ACTIVO', campo(vencido, 'estadoCliente'));
  const svcVencido = (await leer('servicios/svc-c_vencido')).j;
  chk('Su servicio sigue ACTIVO', campo(svcVencido, 'estado') === 'ACTIVO', campo(svcVencido, 'estado'));
  chk('La fecha de vencimiento NO se alteró', campo(svcVencido, 'fechaVencimiento') === masDias(-30), campo(svcVencido, 'fechaVencimiento'));

  const suspendido = (await leer('clientes/c_suspendido')).j;
  chk('Cliente suspendido no cambia', campo(suspendido, 'estadoCliente') === 'SUSPENDIDO', campo(suspendido, 'estadoCliente'));
  const retirado = (await leer('clientes/c_retirado')).j;
  chk('Cliente retirado no cambia', campo(retirado, 'estadoCliente') === 'INACTIVO', campo(retirado, 'estadoCliente'));

  /* CONTROL POSITIVO: sin el bloque de conciliación, el motor sí suspende. */
  const conServicio = (await leer('clientes/c_con_servicio')).j;
  chk('CONTROL: el mismo caso SIN conciliación sí se suspende',
    campo(conServicio, 'estadoCliente') === 'SUSPENDIDO', campo(conServicio, 'estadoCliente'));

  const aldia = (await leer('clientes/c_aldia')).j;
  chk('El cliente al día sigue activo', campo(aldia, 'estadoCliente') === 'ACTIVO', campo(aldia, 'estadoCliente'));

  /* ── 2. Sin notificaciones ── */
  console.log('\n=== 2. Ausencia de notificaciones ===');
  const notis = await listar('notificaciones');
  const notisMigrados = notis.filter((x) => ['c_vencido', 'c_suspendido', 'c_retirado', 'c_sin_ip', 'c_cambia']
    .includes(campo(x, 'clienteId')));
  chk('Ningún servicio migrado generó avisos', notisMigrados.length === 0, `${notisMigrados.length} avisos`);

  /* ── 3. Pagos bloqueados y fechas conservadas ── */
  console.log('\n=== 3. Renovación bloqueada sobre servicios en conciliación ===');
  const antesVence = campo((await leer('servicios/svc-c_pago_concurrente')).j, 'fechaVencimiento');
  const rConf = await callable('confirmarPago', { pagoId }, adm.tok);
  chk('Confirmar pago sobre servicio en conciliación se rechaza',
    rConf.st === 400 || rConf.st === 412, `HTTP ${rConf.st}`);
  const despuesVence = campo((await leer('servicios/svc-c_pago_concurrente')).j, 'fechaVencimiento');
  chk('La fecha de vencimiento no cambió', antesVence === despuesVence, `${antesVence} → ${despuesVence}`);
  const pagoDoc = (await leer('pagos/' + pagoId)).j;
  chk('El pago quedó PENDIENTE (la transacción se revirtió)',
    campo(pagoDoc, 'estado') === 'PENDIENTE', campo(pagoDoc, 'estado'));

  /* ── 4. Cambios de estado manuales bloqueados ── */
  console.log('\n=== 4. Suspensión y reactivación manuales bloqueadas ===');
  const rSusp = await callable('suspenderServicio', { clienteId: 'c_vencido' }, adm.tok);
  chk('Suspender manual rechazado', rSusp.st === 400, `HTTP ${rSusp.st}`);
  const rAct = await callable('activarServicio', { clienteId: 'c_suspendido' }, adm.tok);
  chk('Activar manual rechazado', rAct.st === 400, `HTTP ${rAct.st}`);

  /* ── 5. Validación: devuelve el servicio a la operación ── */
  console.log('\n=== 5. Validación administrativa ===');
  const rVal = await callable('validarServicioConciliado', { servicioId: 'svc-c_sin_ip' }, adm.tok);
  chk('ADMIN valida un servicio', rVal.st === 200, `HTTP ${rVal.st}`);
  chk('Queda en VALIDADA', rVal.j && rVal.j.result && rVal.j.result.conciliacion === 'VALIDADA',
    rVal.j && rVal.j.result ? rVal.j.result.conciliacion : 'sin respuesta');
  const svcValidado = (await leer('servicios/svc-c_sin_ip')).j;
  const bloqueConc = svcValidado && svcValidado.fields && svcValidado.fields.conciliacion
    ? svcValidado.fields.conciliacion.mapValue.fields : null;
  chk('El bloque guardado dice VALIDADA y quién lo validó',
    bloqueConc && bloqueConc.estado.stringValue === 'VALIDADA' && !!bloqueConc.validadoPor,
    bloqueConc ? bloqueConc.estado.stringValue + ' · ' + (bloqueConc.validadoPor ? bloqueConc.validadoPor.stringValue : 'sin autor') : 'sin bloque');

  const rMotor2 = await callable('ejecutarMotor', {}, sup.tok);
  chk('El motor vuelve a correr', rMotor2.st === 200, `HTTP ${rMotor2.st}`);
  const sinIp = (await leer('clientes/c_sin_ip')).j;
  chk('Ya validado, el motor SÍ lo procesa (lo suspende por mora)',
    campo(sinIp, 'estadoCliente') === 'SUSPENDIDO', campo(sinIp, 'estadoCliente'));
  const vencido2 = (await leer('clientes/c_vencido')).j;
  chk('Los que siguen pendientes NO se tocan', campo(vencido2, 'estadoCliente') === 'ACTIVO', campo(vencido2, 'estadoCliente'));

  /* ── 6. Rechazo ── */
  console.log('\n=== 6. Rechazo con motivo ===');
  const rRecSin = await callable('rechazarServicioConciliado', { servicioId: 'svc-c_cambia' }, adm.tok);
  chk('Rechazar sin motivo se rechaza', rRecSin.st === 400, `HTTP ${rRecSin.st}`);
  const rRec = await callable('rechazarServicioConciliado', { servicioId: 'svc-c_cambia', motivo: 'precio no coincide con el contrato' }, adm.tok);
  chk('Rechazar con motivo se acepta', rRec.st === 200, `HTTP ${rRec.st}`);

  /* ── 7. Accesos no autorizados ── */
  console.log('\n=== 7. Accesos no autorizados ===');
  for (const [nombre, tok, esperado] of [
    ['anónimo', undefined, 401],
    ['OPERADOR', ope.tok, 403]
  ]) {
    const r1 = await callable('validarServicioConciliado', { servicioId: 'svc-c_vencido' }, tok);
    const r2 = await callable('rechazarServicioConciliado', { servicioId: 'svc-c_vencido', motivo: 'prueba' }, tok);
    chk(`${nombre} no puede validar ni rechazar`,
      (r1.st === esperado || r1.st === 403) && (r2.st === esperado || r2.st === 403), `validar=${r1.st} rechazar=${r2.st}`);
  }

  /* ── 8. Idempotencia: el mismo servicio no se duplica ── */
  console.log('\n=== 8. Duplicación rechazada ===');
  const dup1 = await crear('servicios', 'svc-c_nuevo', servicioMigrado('c_nuevo', masDias(5)));
  chk('Primera creación aceptada', dup1.st === 200, `HTTP ${dup1.st}`);
  const dup2 = await crear('servicios', 'svc-c_nuevo', servicioMigrado('c_nuevo', masDias(5)));
  chk('Segunda creación del MISMO id rechazada (409)', dup2.st === 409, `HTTP ${dup2.st}`);
  const cuantos = (await listar('servicios')).filter((x) => x.name.endsWith('/svc-c_nuevo'));
  chk('Solo existe un documento', cuantos.length === 1, `${cuantos.length}`);

  /* ── 9. MikroTik no se toca ── */
  console.log('\n=== 9. Ausencia de operaciones MikroTik ===');
  const rMik = await callable('estadoMikrotik', {}, adm.tok);
  const mik = rMik.j && rMik.j.result;
  chk('estadoMikrotik responde sin conectarse', rMik.st === 200 && mik && mik.configurado === false,
    rMik.st === 200 ? `configurado=${mik && mik.configurado}` : `HTTP ${rMik.st}`);

  /* ── 10. Reversión segura con evidencia de actividad ── */
  console.log('\n=== 10. Reversión detenida ante actividad posterior ===');
  const { puedeRevertirse } = require('../src/migracion.js');
  const migradoLimpio = { origen: 'kz-unef-006', conciliacion: { estado: 'PENDIENTE_VALIDACION' }, creadoEn: '2026-10-26T00:00:00.000Z' };
  chk('Un servicio migrado sin actividad se puede revertir', puedeRevertirse(migradoLimpio, {}).permitido === true);
  chk('Con un pago asociado NO se revierte', puedeRevertirse(migradoLimpio, { pagosAsociados: 1 }).permitido === false);
  chk('Si un administrador lo modificó, NO se revierte',
    puedeRevertirse(migradoLimpio, { fechaModificacion: '2026-10-28T00:00:00.000Z' }).permitido === false);
  chk('Un servicio ya validado NO se revierte',
    puedeRevertirse({ ...migradoLimpio, conciliacion: { estado: 'VALIDADA' } }, {}).permitido === false);

  console.log('\n' + '='.repeat(72));
  console.log(`KZ-UNEF-006 · FASE 5: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(72));
  process.exit(fail ? 1 : 0);
})();
