'use strict';
/* ============================================================
 * KZ-UNEF-031 · Revisión comercial: escritura real en el emulador
 * ------------------------------------------------------------
 * Prueba la callable `confirmarRevisionComercial` de punta a punta con datos
 * FICTICIOS del emulador. Nunca toca el proyecto real.
 *
 * Lo que se exige:
 *   · una corrección inválida se rechaza y NO escribe nada;
 *   · una válida guarda servicio + cliente, deja sello (quién y cuándo) y mueve la
 *     fecha al día de corte (no suma 30 días);
 *   · `conciliacion.estado` NO cambia: confirmar no habilita el cobro;
 *   · `pagos` no se toca;
 *   · repetir la misma confirmación no duplica;
 *   · con pagos registrados, mover la fecha exige motivo escrito;
 *   · permisos: OPERADOR fuera, ADMIN dentro.
 *
 *     node test/revision-comercial-emulador.test.js
 * ============================================================ */
const assert = require('assert');

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
const crear = (col, id, fields) => pedir('POST', `${BASE}/${col}?documentId=${id}`, { fields }, 'owner');
const leer = async (col, id) => {
  const r = await pedir('GET', `${BASE}/${col}/${id}`, undefined, 'owner');
  return r.st === 200 ? r.j.fields : null;
};
const callable = (nombre, datos, tok) => pedir('POST', `${FN}/${P}/us-central1/${nombre}`, { data: datos }, tok);
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
  if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(56) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(56) + (d || '')); }
};

const sufijo = Date.now();
const IDP = 'revp' + sufijo, IDC = 'revc' + sufijo, IDS = 'revs' + sufijo, IDS2 = 'revs2' + sufijo;

(async () => {
  console.log('=== Preparación de datos ficticios ===');
  const admin = await alta(`revision-admin-${sufijo}@panel.test`);
  const oper = await alta(`revision-oper-${sufijo}@panel.test`);
  await crear('usuarios', admin.uid, { rol: s('ADMIN'), activo: b(true), nombre: s('Dueña Ficticia') });
  await crear('usuarios', oper.uid, { rol: s('OPERADOR'), activo: b(true), nombre: s('Operador Ficticio') });
  await crear('planes', IDP, { nombre: s('Plan Ficticio 40'), precio: n(40000), duracion: n(30), estado: s('ACTIVO') });
  await crear('clientes', IDC, {
    nombreCompleto: s('CLIENTE FICTICIO REVISION'), documento: s('0000' + sufijo),
    telefono: s('3000000000'), planId: s(IDP), cicloCorte: s('30'), precioMensual: n(0),
    fechaVencimiento: s('2026-11-14'), fechaAlta: s('2026-10-06')
  });
  await crear('servicios', IDS, {
    clienteId: s(IDC), planId: s(IDP), cicloCorte: s('30'), precioMensual: n(0),
    fechaVencimiento: s('2026-11-14'), fechaAlta: s('2026-10-06'),
    conciliacion: { mapValue: { fields: { estado: s('PENDIENTE_VALIDACION') } } }
  });
  chk('datos ficticios creados (cliente, servicio, plan, usuarios)', !!(await leer('servicios', IDS)));

  console.log('\n=== 1. Permisos ===');
  const anon = await callable('confirmarRevisionComercial', { servicioId: IDS, correcciones: {} });
  chk('anónimo no puede confirmar', anon.st >= 400, 'HTTP ' + anon.st);
  const conOper = await callable('confirmarRevisionComercial', { servicioId: IDS, correcciones: {} }, oper.tok);
  chk('OPERADOR no puede confirmar (solo ADMIN)', conOper.st >= 400, 'HTTP ' + conOper.st);

  console.log('\n=== 2. Validación: lo inválido no escribe ===');
  const malaFecha = await callable('confirmarRevisionComercial', { servicioId: IDS, correcciones: { fechaVencimiento: '2026-11-14' } }, admin.tok);
  chk('fecha fuera del día de corte → rechazo', malaFecha.st >= 400, 'HTTP ' + malaFecha.st);
  const malPrecio = await callable('confirmarRevisionComercial', { servicioId: IDS, correcciones: { precioMensual: 0 } }, admin.tok);
  chk('precio 0 → rechazo', malPrecio.st >= 400, 'HTTP ' + malPrecio.st);
  const sinCambios = await leer('servicios', IDS);
  chk('tras los rechazos el servicio sigue igual', sinCambios.fechaVencimiento.stringValue === '2026-11-14' && sinCambios.precioMensual.integerValue === '0');

  console.log('\n=== 3. Corrección válida: guarda y mueve la fecha al corte ===');
  const buena = await callable('confirmarRevisionComercial', {
    servicioId: IDS,
    correcciones: { precioMensual: 45000, cicloCorte: '15' },
    motivo: 'El cliente paga los 15; valor acordado 45.000'
  }, admin.tok);
  chk('la confirmación se acepta', buena.st === 200 && buena.j && buena.j.result, 'HTTP ' + buena.st);
  const sv = await leer('servicios', IDS);
  const cl = await leer('clientes', IDC);
  chk('guarda el valor mensual', sv.precioMensual.integerValue === '45000');
  chk('guarda el día de corte', sv.cicloCorte.stringValue === '15');
  chk('mueve la fecha al 15 (no suma 30 días)', sv.fechaVencimiento.stringValue === '2026-11-15', sv.fechaVencimiento.stringValue);
  chk('el cliente queda con la misma fecha', cl.fechaVencimiento.stringValue === '2026-11-15');
  chk('deja sello con responsable y fecha', sv.revisionComercial.mapValue.fields.estado.stringValue === 'CONFIRMADA' &&
    sv.revisionComercial.mapValue.fields.por.stringValue === admin.uid &&
    !!sv.revisionComercial.mapValue.fields.en.timestampValue);
  chk('NO cambia el estado de conciliación (no habilita el cobro)',
    sv.conciliacion.mapValue.fields.estado.stringValue === 'PENDIENTE_VALIDACION');
  const estado = sv.estado ? sv.estado.stringValue : null;
  chk('no toca el estado administrativo del servicio', estado === null || estado === 'PENDIENTE');

  console.log('\n=== 4. Repetir no duplica ===');
  const otra = await callable('confirmarRevisionComercial', { servicioId: IDS, correcciones: { precioMensual: 45000, cicloCorte: '15' } }, admin.tok);
  chk('repetir devuelve cambiado=false', otra.st === 200 && otra.j.result && otra.j.result.cambiado === false, JSON.stringify(otra.j && otra.j.result && otra.j.result.mensaje));
  const sv2 = await leer('servicios', IDS);
  chk('el sello no se reescribe', sv2.revisionComercial.mapValue.fields.en.timestampValue === sv.revisionComercial.mapValue.fields.en.timestampValue);

  console.log('\n=== 5. Con pagos: mover la fecha exige motivo ===');
  await crear('pagos', 'revpago' + sufijo, {
    clienteId: s(IDC), monto: n(45000), estado: s('CONFIRMADO'), fechaPago: s('2026-11-16'), periodoFin: s('2026-11-30')
  });
  await crear('servicios', IDS2, {
    clienteId: s(IDC), planId: s(IDP), cicloCorte: s('15'), precioMensual: n(45000),
    fechaVencimiento: s('2026-12-15'), fechaAlta: s('2026-10-06'),
    conciliacion: { mapValue: { fields: { estado: s('PENDIENTE_VALIDACION') } } }
  });
  const sinMotivo = await callable('confirmarRevisionComercial', {
    servicioId: IDS2, correcciones: { cicloCorte: '30' }
  }, admin.tok);
  chk('cambio de fecha con pagos y sin motivo → rechazo', sinMotivo.st >= 400, 'HTTP ' + sinMotivo.st);
  const conMotivo = await callable('confirmarRevisionComercial', {
    servicioId: IDS2, correcciones: { cicloCorte: '30' }, motivo: 'El cliente cambió al corte 30'
  }, admin.tok);
  chk('con motivo escrito se acepta', conMotivo.st === 200 && conMotivo.j && conMotivo.j.result, 'HTTP ' + conMotivo.st);
  const sv2b = await leer('servicios', IDS2);
  chk('la fecha se movió al corte 30 del mismo mes', sv2b.fechaVencimiento.stringValue === '2026-12-30', sv2b.fechaVencimiento.stringValue);
  const pago = await leer('pagos', 'revpago' + sufijo);
  chk('el pago NO se toca', pago.estado.stringValue === 'CONFIRMADO' && pago.monto.integerValue === '45000');

  console.log('\n=== 6. Servicio inexistente ===');
  const fantasma = await callable('confirmarRevisionComercial', { servicioId: 'no-existe-' + sufijo, correcciones: {} }, admin.tok);
  chk('servicio inexistente → error claro', fantasma.st >= 400, 'HTTP ' + fantasma.st);

  console.log('\n== Resumen ==');
  console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
  if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
})();
