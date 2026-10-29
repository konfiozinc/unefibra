'use strict';
/* KZ-UNEF-028 · PRUEBA DE RESPALDO RECUPERABLE (extremo a extremo, en local)
 * ---------------------------------------------------------------------------
 * No toca producción ni el Firestore real. Demuestra el ciclo completo:
 *
 *   1. Se siembra un conjunto de datos conocido en el emulador.
 *   2. Se toma el respaldo   (exportación del emulador, igual que la diaria).
 *   3. Se BORRA todo         (simula la pérdida).
 *   4. Se RESTAURA           (importación en una instancia limpia).
 *   5. Se verifica que volvió exactamente lo mismo: número de documentos por
 *      colección, un documento concreto campo por campo (incluidos los anidados)
 *      y una colección con arreglos.
 *   6. Se apaga el emulador de pruebas.
 *
 * Reutiliza el firebase-tools YA instalado en la máquina (Regla de Oro): no
 * descarga copias nuevas.
 *
 * Uso (requiere el emulador de Firestore en 8080):
 *   node tools/prueba-respaldo-recuperable.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const FS = 'http://127.0.0.1:8080';
const P = 'demo-unefibra';
const BASE = `${FS}/v1/projects/${P}/databases/(default)/documents`;
const DIR = 'C:\\KZ-EVIDENCIA\\kz-unef-028\\respaldo-recuperable';
const PUERTO_RESTAURADO = 8181;
const FIREBASE = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
const TOTAL_ESPERADO = 11;

const s = (v) => ({ stringValue: v }), n = (v) => ({ integerValue: String(v) }), b = (v) => ({ booleanValue: v });
const mapa = (o) => ({ mapValue: { fields: o } });
const arreglo = (xs) => ({ arrayValue: { values: xs } });
const crear = (col, id, fields) => fetch(`${BASE}/${col}?documentId=${id}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ fields })
});

let ok = 0, fail = 0; const fallos = [];
const chk = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log('  PASA  ' + nombre + (detalle ? '  (' + detalle + ')' : '')); }
  else { fail++; fallos.push(nombre); console.log('  FALLA ' + nombre + (detalle ? '  :: ' + detalle : '')); }
};

const listar = async (puerto, col) => {
  const r = await fetch(`http://127.0.0.1:${puerto}/v1/projects/${P}/databases/(default)/documents:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }] } })
  });
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  return arr.filter((x) => x && x.document).map((x) => x.document);
};
const campo = (doc, k) => (doc && doc.fields && doc.fields[k] ? Object.values(doc.fields[k])[0] : undefined);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== 1. Sembrar datos conocidos ===');
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });
  await crear('clientes', 'cli-1', {
    nombreCompleto: s('Cliente Respaldo Uno'), telefono: s('3001112233'), estadoCliente: s('ACTIVO'),
    cicloCorte: s('30'), fechaVencimiento: s('2026-11-30'), precioMensual: n(50000),
    activo: b(true), ip: s('192.168.50.20'),
    direccion: mapa({ linea1: s('Calle 1 #2-3'), ciudad: s('Medellin') })
  });
  await crear('clientes', 'cli-2', { nombreCompleto: s('Cliente Respaldo Dos'), telefono: s('3004445566'), estadoCliente: s('SUSPENDIDO'), cicloCorte: s('15'), fechaVencimiento: s('2026-11-15') });
  await crear('servicios', 'svc-1', { clienteId: s('cli-1'), estado: s('ACTIVO'), fechaVencimiento: s('2026-11-30'), precioMensual: n(50000) });
  await crear('pagos', 'pago-1', { clienteId: s('cli-1'), monto: n(50000), estado: s('CONFIRMADO'), periodoInicio: s('2026-10-30'), periodoFin: s('2026-11-29') });
  await crear('notificaciones', 'noti-1', { clienteId: s('cli-1'), tipo: s('CORTE_30_3_DIAS'), estado: s('PENDIENTE'), claveDedup: s('cli-1_corte-30-2026-11-30_CORTE_30_3_DIAS') });
  await crear('planes', 'plan-50', { nombre: s('Plan 50 mil'), precio: n(50000), duracion: n(30), estado: s('ACTIVO') });
  await crear('configuracion', 'diasSuspension', { clave: s('diasSuspension'), valor: n(3) });
  await crear('tokens_notificacion', 'tok-1', { clienteId: s('cli-1'), activo: b(true), token: s('ficticio-1') });
  await crear('historial_estados', 'hist-1', { clienteId: s('cli-1'), estadoNuevo: s('ACTIVO'), fecha: s('2026-10-01') });
  await crear('auditoria', 'aud-1', { accion: s('CREAR'), entidad: s('clientes'), entidadId: s('cli-1'), usuarioNombre: s('Sistema') });
  await crear('coleccionAnidada', 'anidado-1', {
    etiquetas: arreglo([s('uno'), s('dos')]), meta: mapa({ autor: s('KONFIO'), version: n(2) })
  });

  const COLECCIONES = ['clientes', 'servicios', 'pagos', 'notificaciones', 'planes', 'configuracion',
    'tokens_notificacion', 'historial_estados', 'auditoria', 'coleccionAnidada'];
  const antes = {};
  for (const c of COLECCIONES) antes[c] = (await listar(8080, c)).length;
  const totalAntes = Object.values(antes).reduce((a, b2) => a + b2, 0);
  console.log('  documentos sembrados: ' + totalAntes + ' en ' + COLECCIONES.length + ' colecciones');
  chk('se sembraron los documentos esperados', totalAntes === TOTAL_ESPERADO, JSON.stringify(antes));

  console.log('\n=== 2. Tomar el respaldo ===');
  if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true, force: true });
  const exportacion = spawnSync(FIREBASE, ['emulators:export', DIR, '--project', P, '--force'], {
    shell: true, encoding: 'utf8', timeout: 180000
  });
  const salidaExport = (exportacion.stdout || '') + (exportacion.stderr || '');
  const hayArchivos = fs.existsSync(DIR) && fs.readdirSync(DIR).length > 0;
  chk('la exportacion produjo archivos', hayArchivos, hayArchivos ? fs.readdirSync(DIR).join(', ') : salidaExport.slice(-300));
  if (!hayArchivos) { console.log(exportacion.stdout, exportacion.stderr); process.exit(1); }

  console.log('\n=== 3. Borrar todo (simula la perdida) ===');
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });
  let despuesBorrar = 0;
  for (const c of COLECCIONES) despuesBorrar += (await listar(8080, c)).length;
  chk('los datos desaparecieron', despuesBorrar === 0, despuesBorrar + ' documentos');

  console.log('\n=== 4. Restaurar en una instancia limpia (puerto ' + PUERTO_RESTAURADO + ') ===');
  const cfg = path.join(path.dirname(DIR), 'firebase-restaurado.json');
  fs.writeFileSync(cfg, JSON.stringify({
    firestore: { rules: './firestore.rules' },
    emulators: { firestore: { host: '127.0.0.1', port: PUERTO_RESTAURADO }, ui: { enabled: false } }
  }, null, 1));
  const proc = spawn(FIREBASE, ['emulators:start', '--only', 'firestore',
    '--project', P, '--config', cfg, '--import', DIR], {
    cwd: path.join(__dirname, '..'), shell: true, stdio: 'ignore'
  });

  let arriba = false;
  for (let i = 0; i < 45; i++) {
    await esperar(1000);
    try {
      const r = await fetch(`http://127.0.0.1:${PUERTO_RESTAURADO}/`);
      if (r.ok) { arriba = true; break; }
    } catch (e) { /* todavia arrancando */ }
  }
  chk('la instancia restaurada arranca', arriba);
  if (!arriba) { try { proc.kill(); } catch (e) {} process.exit(1); }

  console.log('\n=== 5. Verificar que volvio todo ===');
  await esperar(2500);
  const despues = {};
  for (const c of COLECCIONES) despues[c] = (await listar(PUERTO_RESTAURADO, c)).length;
  const totalDespues = Object.values(despues).reduce((a, b2) => a + b2, 0);
  chk('el numero total de documentos coincide', totalDespues === totalAntes, totalAntes + ' -> ' + totalDespues);
  chk('coincide coleccion por coleccion', JSON.stringify(despues) === JSON.stringify(antes), JSON.stringify(despues));

  const clientes = await listar(PUERTO_RESTAURADO, 'clientes');
  const c1 = clientes.find((d) => d.name.endsWith('/cli-1'));
  chk('el documento recuperado conserva sus campos',
    campo(c1, 'nombreCompleto') === 'Cliente Respaldo Uno' && String(campo(c1, 'precioMensual')) === '50000',
    JSON.stringify({ nombre: campo(c1, 'nombreCompleto'), precio: campo(c1, 'precioMensual'), ip: campo(c1, 'ip') }));

  const dir = c1 && c1.fields && c1.fields.direccion && c1.fields.direccion.mapValue && c1.fields.direccion.mapValue.fields;
  chk('los campos anidados (mapa) vuelven intactos', !!dir && Object.values(dir.linea1)[0] === 'Calle 1 #2-3', JSON.stringify(dir || {}));

  const anidado = (await listar(PUERTO_RESTAURADO, 'coleccionAnidada'))[0];
  const valores = anidado && anidado.fields && anidado.fields.etiquetas && anidado.fields.etiquetas.arrayValue.values;
  chk('los arreglos vuelven intactos', !!valores && valores.length === 2 && valores[0].stringValue === 'uno');

  console.log('\n=== 6. Procedimiento de restauracion (produccion) ===');
  console.log('  gcloud firestore import gs://unefibra-firestore-backups/daily/<AAAA-MM-DD>/<coleccion> --project=une-fibra');
  console.log('  Se repite por cada lote del manifiesto backups/<AAAA-MM-DD>.');
  console.log('  NO es reversible solo: restaurar sobre datos vivos reescribe documentos.');
  console.log('  Antes de restaurar en produccion: hacer una exportacion del estado actual.');

  /* Cierre limpio: se mata por PUERTO porque con shell:true el PID de spawn es
     el del cmd y el arbol de firebase queda vivo. */
  try { proc.kill(); } catch (e) { /* ya cerrado */ }
  await esperar(800);
  spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `$c = Get-NetTCPConnection -LocalPort ${PUERTO_RESTAURADO} -State Listen -ErrorAction SilentlyContinue; if ($c) { taskkill /F /T /PID $($c[0].OwningProcess) }`],
    { encoding: 'utf8' });
  await esperar(800);
  let sigue = false;
  try { const r = await fetch(`http://127.0.0.1:${PUERTO_RESTAURADO}/`); sigue = r.ok; } catch (e) { sigue = false; }
  chk('el emulador de pruebas queda apagado al terminar', !sigue);

  console.log('\n== Resumen ==');
  console.log('  comprobaciones: ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
  if (fail) { console.log('  fallos: ' + fallos.join(' | ')); process.exit(1); }
})();
