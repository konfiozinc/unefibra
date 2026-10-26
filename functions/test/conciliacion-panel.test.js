'use strict';
/* ============================================================
 * KZ-UNEF-007 · Flujos del panel de conciliación (emulador)
 * ------------------------------------------------------------
 * Certifica las tres operaciones separadas —preparar, validar, habilitar— y
 * la tanda, con sus permisos, límites y guardarraíles.
 *
 *   node test/conciliacion-panel.test.js
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

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(58) + (d || "")); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(55) + (d || "")); }
};

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

  const adm = await alta('panel-admin@cert.test');
  const ope = await alta('panel-operador@cert.test');
  await crear('usuarios', adm.uid, { email: s('panel-admin@cert.test'), rol: s('ADMIN'), activo: b(true), nombre: s('Admin Panel') });
  await crear('usuarios', ope.uid, { email: s('panel-operador@cert.test'), rol: s('OPERADOR'), activo: b(true), nombre: s('Operador Panel') });

  await crear('planes', 'p1', { nombre: s('Plan Ficticio'), precio: n(50000), duracion: n(30), estado: s('ACTIVO') });

  const cli = (id, extra = {}) => crear('clientes', id, {
    nombreCompleto: s('Cliente ' + id), telefono: s('3000000000'),
    estadoCliente: s('ACTIVO'), estadoServicio: s('ACTIVO'),
    planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s('2026-11-30'),
    fechaInicioServicio: s('2026-10-31'), cicloCorte: s('30'), ...extra
  });

  await cli('c_ok');
  await cli('c_sin_plan', { planId: { nullValue: null } });
  await cli('c_sin_precio', { precioMensual: { nullValue: null } });
  await crear('servicios', 'svc-existente', { clienteId: s('c_ok'), planId: s('p1'), estado: s('ACTIVO'), fechaVencimiento: s('2026-11-30') });

  console.log('=== 1. PREPARAR (crea en conciliación, sin activar nada) ===');
  let r = await callable('prepararServicioConciliacion', { clienteId: 'c_ok' }, adm.tok);
  chk('No duplica: el cliente ya tiene servicio', r.st === 400 || r.st === 409, `HTTP ${r.st}`);

  await crear('clientes', 'c_nuevo', {
    nombreCompleto: s('Cliente Nuevo'), telefono: s('3001112233'), estadoCliente: s('ACTIVO'),
    planId: s('p1'), precioMensual: n(45000), fechaVencimiento: s('2026-12-15'), cicloCorte: s('15')
  });
  r = await callable('prepararServicioConciliacion', { clienteId: 'c_nuevo' }, adm.tok);
  chk('Prepara el servicio del cliente completo', r.st === 200, `HTTP ${r.st}`);
  const svcNuevo = r.j && r.j.result ? r.j.result.servicioId : null;
  chk('Nace en PENDIENTE_VALIDACION', r.j && r.j.result && r.j.result.conciliacion === 'PENDIENTE_VALIDACION',
    r.j && r.j.result ? r.j.result.conciliacion : 'sin respuesta');

  const docNuevo = (await leer('servicios/' + svcNuevo)).j;
  const campos = docNuevo.fields;
  chk('Copia el precio sin inventarlo', campos.precioMensual.integerValue === '45000', campos.precioMensual.integerValue);
  chk('Copia el vencimiento original', campos.fechaVencimiento.stringValue === '2026-12-15', campos.fechaVencimiento.stringValue);
  chk('Sin fecha de instalación queda null (no se inventa)', campos.fechaInicio.nullValue !== undefined, JSON.stringify(Object.keys(campos.fechaInicio)));

  r = await callable('prepararServicioConciliacion', { clienteId: 'c_sin_plan' }, adm.tok);
  chk('NO prepara un cliente sin plan', r.st === 400, `HTTP ${r.st}`);
  r = await callable('prepararServicioConciliacion', { clienteId: 'c_sin_precio' }, adm.tok);
  chk('NO prepara un cliente sin precio', r.st === 400, `HTTP ${r.st}`);

  console.log('\n=== 2. VALIDAR ≠ HABILITAR ===');
  r = await callable('habilitarServicio', { servicioId: svcNuevo }, adm.tok);
  chk('No se habilita algo solo PENDIENTE', r.st === 400, `HTTP ${r.st}`);

  r = await callable('validarServicioConciliado', { servicioId: svcNuevo }, adm.tok);
  chk('Validar se acepta', r.st === 200, `HTTP ${r.st}`);
  chk('Queda VALIDADA, no habilitada', r.j && r.j.result && r.j.result.conciliacion === 'VALIDADA',
    r.j && r.j.result ? r.j.result.conciliacion : '—');

  r = await callable('validarServicioConciliado', { servicioId: svcNuevo }, adm.tok);
  chk('Validar dos veces se rechaza (sin duplicar historial)', r.st === 400, `HTTP ${r.st}`);

  r = await callable('habilitarServicio', { servicioId: svcNuevo }, adm.tok);
  chk('Habilitar tras validar se acepta', r.st === 200, `HTTP ${r.st}`);
  chk('Queda HABILITADA', r.j && r.j.result && r.j.result.conciliacion === 'HABILITADA',
    r.j && r.j.result ? r.j.result.conciliacion : '—');

  console.log('\n=== 3. TANDA (con límite, simulación y resumen) ===');
  const svcA = [];
  for (const id of ['c_l1', 'c_l2', 'c_l3']) {
    await crear('clientes', id, {
      nombreCompleto: s('Cliente ' + id), telefono: s('3000000001'), estadoCliente: s('ACTIVO'),
      planId: s('p1'), precioMensual: n(50000), fechaVencimiento: s('2026-12-01')
    });
    const rr = await callable('prepararServicioConciliacion', { clienteId: id }, adm.tok);
    svcA.push(rr.j.result.servicioId);
  }
  await callable('validarServicioConciliado', { servicioId: svcA[0] }, adm.tok);
  await callable('validarServicioConciliado', { servicioId: svcA[1] }, adm.tok);

  r = await callable('habilitarServiciosLote', { servicioIds: svcA, simular: true }, adm.tok);
  chk('La simulación se acepta', r.st === 200, `HTTP ${r.st}`);
  chk('La simulación NO escribe', r.j.result.resumen.SIMULADO_INCLUIDO === 2 && !r.j.result.resumen.HABILITADO,
    JSON.stringify(r.j.result.resumen));
  const trasSimular = (await leer('servicios/' + svcA[0])).j;
  chk('Tras simular sigue VALIDADA',
    trasSimular.fields.conciliacion.mapValue.fields.estado.stringValue === 'VALIDADA',
    trasSimular.fields.conciliacion.mapValue.fields.estado.stringValue);

  r = await callable('habilitarServiciosLote', { servicioIds: svcA }, adm.tok);
  chk('La tanda real procesa solo los validados', r.j.result.resumen.HABILITADO === 2, JSON.stringify(r.j.result.resumen));
  chk('El no validado se informa y no se toca', r.j.result.resumen.NO_VALIDADO === 1, JSON.stringify(r.j.result.resumen));
  const svcC = (await leer('servicios/' + svcA[2])).j;
  chk('El no validado sigue pendiente',
    svcC.fields.conciliacion.mapValue.fields.estado.stringValue === 'PENDIENTE_VALIDACION',
    svcC.fields.conciliacion.mapValue.fields.estado.stringValue);

  r = await callable('habilitarServiciosLote', { servicioIds: Array.from({ length: 51 }, (_, i) => 'svc-' + i) }, adm.tok);
  chk('Una tanda de más de 50 se rechaza', r.st === 400, `HTTP ${r.st}`);

  console.log('\n=== 4. AUTORIZACIÓN ===');
  for (const [nombre, tok, esperado] of [['anónimo', undefined, 401], ['OPERADOR', ope.tok, 403]]) {
    const a = await callable('prepararServicioConciliacion', { clienteId: 'c_ok' }, tok);
    const v = await callable('validarServicioConciliado', { servicioId: svcA[2] }, tok);
    const h = await callable('habilitarServicio', { servicioId: svcA[2] }, tok);
    const l = await callable('habilitarServiciosLote', { servicioIds: [svcA[2]] }, tok);
    chk(`${nombre} no prepara, valida, habilita ni lanza tandas`,
      [a.st, v.st, h.st, l.st].every((x) => x === esperado || x === 403),
      `preparar=${a.st} validar=${v.st} habilitar=${h.st} lote=${l.st}`);
  }

  console.log('\n=== 5. AUDITORÍA ===');
  const aud = await listar('auditoria');
  const acciones = aud.map((x) => (x.fields.accion || {}).stringValue);
  chk('Se audita PREPARAR', acciones.includes('PREPARAR_SERVICIO'), `${acciones.length} registros`);
  chk('Se audita VALIDAR', acciones.includes('VALIDAR_CONCILIACION'));
  chk('Se audita HABILITAR', acciones.includes('HABILITAR_SERVICIO'));
  chk('Se audita la tanda con su resumen', acciones.includes('HABILITAR_LOTE_RESUMEN'));

  console.log('\n' + '='.repeat(72));
  console.log(`KZ-UNEF-007 · PANEL: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(72));
  process.exit(fail ? 1 : 0);
})();
