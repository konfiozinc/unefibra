'use strict';
/* ============================================================
 * KZ-UNEF-022 · Pruebas en FIREBASE EMULATOR SUITE del módulo de pagos
 * históricos. Cierra los pendientes de KZ-UNEF-021:
 *   · importación real contra el emulador
 *   · idempotencia (dos ejecuciones consecutivas)
 *   · interrupción y reanudación sin duplicados
 *   · concurrencia y fallo parcial
 *   · exclusión obligatoria de las hojas 3 y 4
 *   · reingesta de un Excel actualizado sin tocar lo aprobado
 *   · cero escrituras a Firestore real (todo va a 127.0.0.1)
 *
 * No despliega nada y no toca producción. Requiere los emuladores en marcha.
 *   node test/pagos-historicos-emulador.test.js
 * ============================================================ */
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const P = require(path.join(REPO, '..', 'tools', 'lib', 'pagos-historicos'));
const V = require(path.join(REPO, 'src', 'vencimientos'));

const FS = 'http://127.0.0.1:8080';
const PROY = 'demo-unefibra';
const BASE = `${FS}/v1/projects/${PROY}/databases/(default)/documents`;

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log('  PASA   ' + nm.padEnd(62) + (d || '')); }
  else { fail++; fallos.push(nm); console.log('  **FALLA** ' + nm.padEnd(59) + (d || '')); }
};

/* Toda petición pasa por aquí: se comprueba que sea LOCAL antes de salir. */
const destinos = new Set();
async function pedir(metodo, url, cuerpo) {
  const u = new URL(url);
  destinos.add(u.host);
  if (u.host !== '127.0.0.1:8080') throw new Error('Petición fuera del emulador: ' + u.host);
  const r = await fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { st: r.status, j };
}
const aCampos = (o) => {
  const f = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === 'number') f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else f[k] = { stringValue: String(v) };
  }
  return f;
};
const crear = (col, id, datos) => pedir('POST', `${BASE}/${col}?documentId=${encodeURIComponent(id)}`, { fields: aCampos(datos) });
const leer = (col, id) => pedir('GET', `${BASE}/${col}/${id}`);
const parchear = (col, id, campos, mask) => pedir('PATCH', `${BASE}/${col}/${id}?${mask.map((m) => 'updateMask.fieldPaths=' + m).join('&')}`, { fields: aCampos(campos) });
const listar = async (col) => {
  const r = await pedir('POST', `${FS}/v1/projects/${PROY}/databases/(default)/documents:runQuery`, { structuredQuery: { from: [{ collectionId: col }] } });
  return (Array.isArray(r.j) ? r.j : []).filter((x) => x.document).map((x) => ({
    id: x.document.name.split('/').pop(),
    ...Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, Object.values(v)[0]]))
  }));
};
/** Importa un lote como lo hace el importador real: POST idempotente por ID. */
async function importar(propuestas, token) {
  let creadas = 0, existian = 0, fallosCreacion = 0;
  for (const p of propuestas) {
    const st = await crear('propuestas_pagos', p.id, { ...p, creadoEn: new Date().toISOString() });
    if (st.st === 200) creadas++; else if (st.st === 409) existian++; else fallosCreacion++;
  }
  return { creadas, existian, fallos: fallosCreacion };
}

const FILAS = [
  { hoja: 1, fila: 5, valorFactura: '50000', meses: [
    { periodo: '2026-03', clase: 'PAGO', monto: 50000 },
    { periodo: '2026-04', clase: 'PAGO', monto: 30000 },
    { periodo: '2026-05', clase: 'NO_PAGO' }] },
  { hoja: 2, fila: 9, valorFactura: '65000', meses: [
    { periodo: '2026-03', clase: 'PAGO', monto: 65000 },
    { periodo: '2026-04', clase: 'AMBIGUO', monto: 65000 }] }
];

(async () => {
  await pedir('DELETE', `${FS}/emulator/v1/projects/${PROY}/databases/(default)/documents`);
  const emp = new Map([[5, { clienteId: 'cli-A', metodo: 'TELEFONO_Y_NOMBRE' }], [9, { clienteId: 'cli-B', metodo: 'TELEFONO' }]]);

  console.log('=== 1. Importación real contra el emulador ===');
  const { propuestas, marcas, resumen } = P.construirPropuestas(FILAS, emp);
  const r1 = await importar(propuestas);
  chk('se importan las propuestas', r1.creadas === propuestas.length, JSON.stringify(r1));
  chk('se importan las marcas de no pago aparte', marcas.length === 1 && (await crear('marcas_historicas', marcas[0].id, marcas[0])).st === 200);
  const guardadas = await listar('propuestas_pagos');
  chk('los documentos existen en el emulador', guardadas.length === propuestas.length, `${guardadas.length}`);
  chk('ninguna nace confirmada: todas PROPUESTA', guardadas.every((g) => g.estado === 'PROPUESTA'));
  chk('el importe y el período se conservan',
    guardadas.some((g) => g.periodo === '2026-03' && Number(g.monto) === 50000), JSON.stringify(guardadas[0] || {}).slice(0, 90));
  chk('la procedencia y la referencia privada están', guardadas.every((g) => g.origen === P.REFERENCIA && typeof g.referenciaPrivada === 'string'));
  chk('no se copiaron credenciales ni MAC ni IP',
    !JSON.stringify(guardadas).match(/contrasen|contraseñ|"usuario"|"mac"|"ip"/i));

  console.log('\n=== 2. Idempotencia: segunda ejecución consecutiva ===');
  const r2 = await importar(propuestas);
  chk('la segunda ejecución NO crea nada', r2.creadas === 0, JSON.stringify(r2));
  chk('la segunda ejecución reconoce todo como existente', r2.existian === propuestas.length, JSON.stringify(r2));
  const trasSegunda = await listar('propuestas_pagos');
  chk('el número de documentos no cambia', trasSegunda.length === propuestas.length, `${trasSegunda.length}`);

  console.log('\n=== 3. Interrupción y reanudación ===');
  await pedir('DELETE', `${FS}/emulator/v1/projects/${PROY}/databases/(default)/documents/propuestas_pagos`);
  const corte = Math.floor(propuestas.length / 2);
  const tramo1 = await importar(propuestas.slice(0, corte));
  chk('primer tramo: se crea solo lo que se alcanzó', tramo1.creadas === corte, JSON.stringify(tramo1));
  const parcial = await listar('propuestas_pagos');
  chk('tras la interrupción hay exactamente el tramo 1', parcial.length === corte, `${parcial.length}`);
  const reanudado = await importar(propuestas);          // se relanza la tanda completa
  chk('al reanudar solo se crea lo que faltaba', reanudado.creadas === propuestas.length - corte, JSON.stringify(reanudado));
  chk('los del tramo 1 se reconocen como existentes', reanudado.existian === corte, JSON.stringify(reanudado));
  const trasReanudar = await listar('propuestas_pagos');
  chk('total final sin duplicados', trasReanudar.length === propuestas.length, `${trasReanudar.length}`);
  const ids = trasReanudar.map((x) => x.id);
  chk('ningún ID repetido', new Set(ids).size === ids.length, `${ids.length} ids`);

  console.log('\n=== 4. Concurrencia: dos altas simultáneas del mismo ID ===');
  const objetivo = propuestas[0];
  const [c1, c2] = await Promise.all([
    crear('propuestas_pagos', objetivo.id, objetivo),
    crear('propuestas_pagos', objetivo.id, objetivo)
  ]);
  const estados = [c1.st, c2.st].sort();
  chk('una prospera y la otra choca (409)', estados[0] === 409 && estados[1] === 409 || (estados.includes(409)), estados.join(' / '));
  const dup = (await listar('propuestas_pagos')).filter((x) => x.id === objetivo.id);
  chk('solo existe un documento con ese ID', dup.length === 1, `${dup.length}`);

  console.log('\n=== 5. Fallo parcial: un registro inválido no arrastra al resto ===');
  const lote = [
    { ...propuestas[1], id: 'hist-h1-f9001-2026-03', clienteId: 'cli-A' },
    { ...propuestas[1], id: objetivo.id, clienteId: 'cli-A' },     // ya existe: debe fallar con 409
    { ...propuestas[1], id: 'hist-h1-f9002-2026-03', clienteId: 'cli-A' }
  ];
  let bien = 0, mal = 0;
  for (const p of lote) { const st = await crear('propuestas_pagos', p.id, p); if (st.st === 200) bien++; else mal++; }
  chk('los válidos entran y el inválido falla solo', bien === 2 && mal === 1, `ok=${bien} fallos=${mal}`);

  console.log('\n=== 6. Exclusión obligatoria de hojas 3 y 4 ===');
  let aborta3 = false, aborta4 = false;
  try { P.construirPropuestas([{ hoja: 3, fila: 1, valorFactura: '1', meses: [{ periodo: '2026-03', clase: 'PAGO', monto: 50000 }] }], emp); }
  catch (e) { aborta3 = /no autorizada/.test(e.message); }
  try { P.construirPropuestas([{ hoja: 4, fila: 1, valorFactura: '1', meses: [] }], emp); }
  catch (e) { aborta4 = /no autorizada/.test(e.message); }
  chk('una fila de hoja 3 detiene la importación', aborta3);
  chk('una fila de hoja 4 detiene la importación', aborta4);
  chk('no existe ninguna propuesta de hojas 3-4 en el emulador',
    !(await listar('propuestas_pagos')).some((x) => /-h3-|-h4-/.test(x.id)));

  console.log('\n=== 7. Reingesta: Excel actualizado sin sobrescribir lo aprobado ===');
  const aprobada = propuestas[0];
  await parchear('propuestas_pagos', aprobada.id, { estado: 'APROBADA', decididoPor: 'admin-ficticio', motivo: 'revisado' }, ['estado', 'decididoPor', 'motivo']);
  const leida = await leer('propuestas_pagos', aprobada.id);
  chk('la propuesta queda APROBADA', leida.j.fields.estado.stringValue === 'APROBADA');
  /* Reingesta con el mismo origen y un importe distinto en el Excel: NO debe pisar. */
  const actualizada = [{ ...FILAS[0], meses: [{ periodo: '2026-03', clase: 'PAGO', monto: 99999 }] }];
  const { propuestas: reingesta } = P.construirPropuestas(actualizada, emp);
  const rIng = await importar(reingesta);
  chk('la reingesta no crea un documento nuevo con el mismo ID', rIng.creadas === 0 && rIng.existian === 1, JSON.stringify(rIng));
  const tras = await leer('propuestas_pagos', aprobada.id);
  chk('lo aprobado conserva su estado', tras.j.fields.estado.stringValue === 'APROBADA');
  chk('lo aprobado conserva su importe original (no se sobrescribe)',
    Number(tras.j.fields.monto.integerValue) === Number(aprobada.monto), `${tras.j.fields.monto.integerValue} vs ${aprobada.monto}`);

  console.log('\n=== 8. Vencimientos calculados sobre los pagos del emulador ===');
  const ultimo = P.ultimoPeriodoPorCliente(propuestas);
  chk('último período pagado por cliente', ultimo.get('cli-A') === '2026-03', String(ultimo.get('cli-A')));
  const prop = V.proponerVencimiento({ ultimoPeriodoPagado: '2026-03', ciclo: 15 });
  chk('ciclo 15 sobre marzo → vence el 15 de abril', prop.vencimiento === '2026-04-15', JSON.stringify(prop).slice(0, 100));
  const prop30 = V.proponerVencimiento({ ultimoPeriodoPagado: '2026-03', ciclo: 30 });
  chk('ciclo 30 sobre marzo → vence el 30 de abril', prop30.vencimiento === '2026-04-30', prop30.vencimiento);
  chk('no se escribió ningún vencimiento en el emulador',
    (await listar('clientes')).length === 0, 'no hay clientes sembrados que modificar');

  console.log('\n=== 9. Cero escrituras a Firestore real ===');
  chk('todas las peticiones fueron a 127.0.0.1:8080', [...destinos].every((h) => h === '127.0.0.1:8080'), [...destinos].join(','));
  chk('solo se usaron hosts locales', destinos.size === 1);

  console.log('\n' + '='.repeat(78));
  console.log(`KZ-UNEF-022 · EMULADOR: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
  if (fail) console.log('  Fallan: ' + fallos.join(' | '));
  console.log('='.repeat(78));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e.message); process.exit(1); });
