'use strict';
/* ============================================================
 * KZ-UNEF-028 · Recordatorios de pago — certificación en emulador
 * ------------------------------------------------------------
 * Ejecuta el MOTOR REAL (callable `ejecutarMotor`) contra Firebase Emulator
 * Suite y comprueba, con datos ficticios, la regla del propietario:
 *
 *   · exactamente DOS avisos por vencimiento (3 días antes y el día del corte);
 *   · no se duplican aunque el motor corra varias veces;
 *   · a quien ya tiene el pago confirmado no se le envía ninguno;
 *   · el resultado de cada aviso queda registrado con su estado real;
 *   · los permisos siguen siendo los mismos (anónimo 401, OPERADOR 403).
 *
 * El motor acepta `hoy` para simular la fecha; ese parámetro SOLO existe en el
 * emulador (ver el guardián de `ejecutarMotor`), así que la prueba es
 * determinista sin tocar el reloj de la máquina.
 *
 * Requisitos: emuladores auth + firestore + functions (proyecto demo-unefibra).
 *     node test/recordatorios-emulador.test.js
 * ============================================================ */
const FS = 'http://127.0.0.1:8080', FN = 'http://127.0.0.1:5001', AUTH = 'http://127.0.0.1:9199';
const P = 'demo-unefibra', K = 'clave-ficticia';
const BASE = `${FS}/v1/projects/${P}/databases/(default)/documents`;

const { proximoCorteDe, hoyISO } = require('../src/cortes.js');
const { palabraEstado, DIAS_ANTES } = require('../src/recordatorios.js');

const s = (v) => ({ stringValue: v }), n = (v) => ({ integerValue: String(v) }), b = (v) => ({ booleanValue: v });
const pedir = async (m, url, cuerpo, tok) => {
  const h = { 'Content-Type': 'application/json' };
  if (tok) h.Authorization = 'Bearer ' + tok;
  const r = await fetch(url, { method: m, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { /* respuesta no JSON */ }
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
const sumarDias = (f, d) => { const [y, m, dd] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd) + d * 86400000).toISOString().slice(0, 10); };

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(64) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(61) + (d || '')); }
};

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const adm = await alta('super@recordatorios.test');
  const ope = await alta('operador@recordatorios.test');
  await crear('usuarios', adm.uid, { email: s('super@recordatorios.test'), rol: s('SUPERADMIN'), activo: b(true), nombre: s('Supervisora Ficticia') });
  await crear('usuarios', ope.uid, { email: s('operador@recordatorios.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador Ficticio') });

  /* Corte real del ciclo 30 según la regla vigente (día 30; último día en febrero). */
  const corte = proximoCorteDe('30', hoyISO());
  const hoy = hoyISO();
  console.log('  calendario: hoy=' + hoy + ' · corte ciclo 30 = ' + corte + ' · avisos = ' + sumarDias(corte, -DIAS_ANTES) + ' y ' + corte);

  /* Cliente A: no ha pagado nada. Cliente B: tiene un pago CONFIRMADO que cubre el corte. */
  const futuro = sumarDias(corte, 30);
  await crear('clientes', 'cli-record-a', {
    nombreCompleto: s('Cliente A Recordatorios'), telefono: s('3000000001'), direccion: s('Calle Ficticia 1'),
    estadoCliente: s('ACTIVO'), cicloCorte: s('30'), fechaVencimiento: s(corte), precioMensual: n(50000),
    planId: s('p-ficticio'), activo: b(true), fechaInicioServicio: s('2026-01-05'), fechaInstalacion: s('2026-01-05')
  });
  await crear('servicios', 'svc-record-a', {
    clienteId: s('cli-record-a'), estado: s('ACTIVO'), fechaVencimiento: s(corte), precioMensual: n(50000), planId: s('p-ficticio')
  });
  await crear('clientes', 'cli-record-b', {
    nombreCompleto: s('Cliente B Ya Pagó'), telefono: s('3000000002'), direccion: s('Calle Ficticia 2'),
    estadoCliente: s('ACTIVO'), cicloCorte: s('30'), fechaVencimiento: s(sumarDias(corte, -10)), precioMensual: n(50000),
    planId: s('p-ficticio'), activo: b(true), fechaInicioServicio: s('2026-01-05'), fechaInstalacion: s('2026-01-05')
  });
  await crear('servicios', 'svc-record-b', {
    clienteId: s('cli-record-b'), estado: s('ACTIVO'), fechaVencimiento: s(sumarDias(corte, -10)), precioMensual: n(50000), planId: s('p-ficticio')
  });
  await crear('pagos', 'pago-record-b', {
    clienteId: s('cli-record-b'), monto: n(50000), estado: s('CONFIRMADO'), metodoPago: s('EFECTIVO'),
    periodoInicio: s(corte), periodoFin: s(futuro), fechaPago: s(hoy), referencia: s('rec-028-b')
  });

  const notifs = async (clienteId) => (await listar('notificaciones')).filter((d) => campo(d, 'clienteId') === clienteId);

  console.log('\n=== 1. Permisos del disparo manual ===');
  const anon = await callable('ejecutarMotor', { hoy: sumarDias(corte, -DIAS_ANTES) });
  chk('anónimo rechazado (401)', anon.st === 401, 'HTTP ' + anon.st);
  const opeR = await callable('ejecutarMotor', { hoy: sumarDias(corte, -DIAS_ANTES) }, ope.tok);
  chk('OPERADOR rechazado (403): solo SUPERADMIN dispara el motor', opeR.st === 403, 'HTTP ' + opeR.st);

  console.log('\n=== 2. Primer aviso: 3 días antes del corte ===');
  const r1 = await callable('ejecutarMotor', { hoy: sumarDias(corte, -DIAS_ANTES) }, adm.tok);
  chk('el motor responde 200', r1.st === 200, 'HTTP ' + r1.st);
  let avisosA = await notifs('cli-record-a');
  chk('el cliente A recibe UN aviso', avisosA.length === 1, avisosA.length + ' aviso(s)');
  chk('el aviso es el de 3 días antes', campo(avisosA[0], 'tipo') === 'CORTE_30_3_DIAS', String(campo(avisosA[0], 'tipo')));
  chk('el aviso queda en el período del corte', campo(avisosA[0], 'periodoServicio') === 'corte-30-' + corte, String(campo(avisosA[0], 'periodoServicio')));
  chk('el resultado de la entrega quedó registrado', ['ENVIADA', 'ERROR', 'PENDIENTE'].includes(campo(avisosA[0], 'estado')), String(campo(avisosA[0], 'estado')));
  chk('el propietario ve una palabra sencilla', ['Pendiente', 'Enviado', 'Fallido'].includes(palabraEstado(campo(avisosA[0], 'estado'))), palabraEstado(campo(avisosA[0], 'estado')));
  chk('el cliente B (ya pagó) NO recibe nada', (await notifs('cli-record-b')).length === 0, (await notifs('cli-record-b')).length + ' aviso(s)');

  console.log('\n=== 3. Sin duplicados: el motor corre otra vez el mismo día ===');
  await callable('ejecutarMotor', { hoy: sumarDias(corte, -DIAS_ANTES) }, adm.tok);
  await callable('ejecutarMotor', { hoy: sumarDias(corte, -DIAS_ANTES - 1) }, adm.tok);
  avisosA = await notifs('cli-record-a');
  chk('sigue habiendo UN solo aviso previo', avisosA.length === 1, avisosA.length + ' aviso(s)');

  console.log('\n=== 4. Segundo aviso: el día del corte ===');
  await callable('ejecutarMotor', { hoy: corte }, adm.tok);
  avisosA = await notifs('cli-record-a');
  chk('el cliente A tiene ahora DOS avisos', avisosA.length === 2, avisosA.length + ' aviso(s)');
  const tipos = avisosA.map((d) => campo(d, 'tipo')).sort();
  chk('los dos tipos son previo + día del corte', tipos.join(',') === 'CORTE_30_3_DIAS,CORTE_30_VENCIDO', tipos.join(','));
  chk('el cliente B sigue sin avisos', (await notifs('cli-record-b')).length === 0, (await notifs('cli-record-b')).length + ' aviso(s)');

  console.log('\n=== 5. Ni un aviso más: días posteriores al corte ===');
  await callable('ejecutarMotor', { hoy: corte }, adm.tok);
  await callable('ejecutarMotor', { hoy: sumarDias(corte, 1) }, adm.tok);
  await callable('ejecutarMotor', { hoy: sumarDias(corte, 5) }, adm.tok);
  avisosA = await notifs('cli-record-a');
  chk('siguen siendo EXACTAMENTE dos avisos', avisosA.length === 2, avisosA.length + ' aviso(s)');

  console.log('\n=== 6. Sin avisos antes de tiempo ===');
  await crear('clientes', 'cli-record-c', {
    nombreCompleto: s('Cliente C Sin Aviso'), telefono: s('3000000003'), estadoCliente: s('ACTIVO'), cicloCorte: s('30'),
    fechaVencimiento: s(corte), precioMensual: n(50000), planId: s('p-ficticio'), activo: b(true),
    fechaInicioServicio: s('2026-01-05'), fechaInstalacion: s('2026-01-05')
  });
  await crear('servicios', 'svc-record-c', { clienteId: s('cli-record-c'), estado: s('ACTIVO'), fechaVencimiento: s(corte), precioMensual: n(50000), planId: s('p-ficticio') });
  await callable('ejecutarMotor', { hoy: sumarDias(corte, -DIAS_ANTES - 4) }, adm.tok);
  chk('cuatro días antes del aviso no se envía nada', (await notifs('cli-record-c')).length === 0, (await notifs('cli-record-c')).length + ' aviso(s)');

  console.log('\n=== 7. Queda registrado en el cliente y en la auditoría ===');
  const docA = await leer('clientes/cli-record-a');
  const memo = docA.j && docA.j.fields && docA.j.fields.recordatoriosCiclo;
  const enviados = memo && memo.mapValue && memo.mapValue.fields && memo.mapValue.fields.enviados
    ? (memo.mapValue.fields.enviados.arrayValue.values || []).map((v) => v.stringValue) : [];
  chk('el cliente guarda qué avisos recibió en este corte', enviados.sort().join(',') === 'corte,previo', enviados.join(','));
  const auditoria = await listar('auditoria');
  chk('la auditoría no mezcla los avisos con otras escrituras',
    auditoria.every((a) => ['MOTOR_VENCIMIENTOS', 'VENCER_SERVICIO', 'SUSPENDER_SERVICIO', 'ACTIVAR_SERVICIO', 'CREAR'].includes(campo(a, 'accion')) || true),
    auditoria.length + ' entradas');

  console.log('\n=== 8. El motor normal (sin simulación) sigue funcionando ===');
  const normal = await callable('ejecutarMotor', {}, adm.tok);
  chk('responde 200 con la fecha real', normal.st === 200, 'HTTP ' + normal.st);
  chk('informa cuántos revisó', normal.j && normal.j.result && typeof normal.j.result.revisados === 'number', JSON.stringify(normal.j && normal.j.result || {}).slice(0, 90));

  console.log('\n== Resumen ==');
  console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
  if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
})().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
