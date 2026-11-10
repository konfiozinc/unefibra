'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const { chromium } = require('../../Konfio-Zinc-Web/herramientas/node_modules/playwright');
const raiz = path.resolve(__dirname, '..');
const evidencia = path.join(raiz, 'docs/evidencias/unefibra-044');
let pass = 0;
const check = (nombre, valor) => { assert.ok(valor, nombre); pass++; console.log('PASS ' + nombre); };
async function probarBlog() {
  // Copia el mismo módulo a una raíz temporal para aislar el artefacto de prueba.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'unefibra-044-'));
  fs.mkdirSync(path.join(temp, 'tools'));
  for (const archivo of ['preservar-blog-publicado.cjs', 'unefibra-blog-publicado.json']) fs.copyFileSync(path.join(__dirname, archivo), path.join(temp, 'tools', archivo));
  const { preservar, sha256 } = require(path.join(temp, 'tools/preservar-blog-publicado.cjs'));
  const ref = require('./unefibra-blog-publicado.json');
  const out = path.join(temp, '_sitio');
  fs.mkdirSync(path.join(out, 'blog'), { recursive: true });
  fs.writeFileSync(path.join(out, 'blog/index.html'), 'checkout diferente');
  fs.writeFileSync(path.join(out, 'sitemap.xml'), 'checkout diferente');
  fs.writeFileSync(path.join(out, 'panel.txt'), 'no tocar');
  const bytes = {
    'blog/index.html': fs.readFileSync(path.join(evidencia, 'blog-publicado.html')),
    'sitemap.xml': fs.readFileSync(path.join(evidencia, 'sitemap-publicado.xml'))
  };
  const llamadas = [];
  const obtener = async (url, opts) => {
    llamadas.push(String(url));
    assert.equal(opts.redirect, 'error'); assert.equal(opts.cache, 'no-store');
    const ruta = String(url).replace(ref.origen, '');
    return new Response(bytes[ruta], { status: 200 });
  };
  check('referencia corresponde a captura pública', ref.archivos.every(e => sha256(bytes[e.ruta]) === e.sha256));
  await preservar({ out, obtener });
  check('artefacto conserva blog y sitemap byte a byte', ref.archivos.every(e => sha256(fs.readFileSync(path.join(out, e.ruta))) === e.sha256));
  check('solo GET públicos esperados', llamadas.length === 2 && llamadas.every(u => u.startsWith(ref.origen)));
  check('otros archivos del artefacto intactos', fs.readFileSync(path.join(out, 'panel.txt'), 'utf8') === 'no tocar');
  await preservar({ out, obtener });
  check('segunda preparación es idempotente', ref.archivos.every(e => sha256(fs.readFileSync(path.join(out, e.ruta))) === e.sha256));
  const antes = ref.archivos.map(e => sha256(fs.readFileSync(path.join(out, e.ruta))));
  for (const [nombre, obtenerFallo] of [
    ['cambio de hash', async () => new Response('cambió')],
    ['HTTP 404', async () => new Response('no existe', { status: 404 })],
    ['fallo de red', async () => { throw Error('sin red'); }],
    ['segunda descarga inválida', async url => String(url).endsWith('sitemap.xml') ? new Response('cambió') : new Response(bytes['blog/index.html'])]
  ]) {
    await assert.rejects(preservar({ out, obtener: obtenerFallo }));
    check(nombre + ' detiene sin cambiar artefacto', JSON.stringify(antes) === JSON.stringify(ref.archivos.map(e => sha256(fs.readFileSync(path.join(out, e.ruta))))));
  }
  await assert.rejects(preservar({ out: temp, obtener })); check('rechaza destino fuera del artefacto', true);
  await assert.rejects(preservar({ out, obtener, ref: { ...ref, origen: 'https://example.test/' } })); check('rechaza origen distinto', true);
  fs.writeFileSync(path.join(out, 'blog/ajeno.html'), 'no incluir');
  await assert.rejects(preservar({ out, obtener })); check('rechaza archivos ajenos en blog', true);
  const flujo = fs.readFileSync(path.join(raiz, '.github/workflows/deploy.yml'), 'utf8');
  check('generación reservada al evento schedule', /Generar el blog[^\n]*\n\s+if: github.event_name == 'schedule'/.test(flujo));
  check('push y manual preservan blog publicado', /Preservar blog publicado[^\n]*\n\s+if: github.event_name != 'schedule'/.test(flujo));
  check('preservación se ejecuta antes de cargar artefacto', flujo.indexOf('node tools/preservar-blog-publicado.cjs') < flujo.indexOf('actions/upload-pages-artifact'));
  check('fuente blog no coincide con publicación y no se sobrescribe', sha256(fs.readFileSync(path.join(raiz, 'blog/index.html'))) !== ref.archivos[0].sha256);
  const yaml = require('../functions/node_modules/js-yaml');
  const doc = yaml.load(flujo);
  check('YAML de workflow válido y conserva eventos', !!doc.on.push && Object.hasOwn(doc.on, 'workflow_dispatch') && Array.isArray(doc.on.schedule));
  const pasos = doc.jobs.deploy.steps;
  check('workflow fija el runtime probado', pasos.find(e => e.uses === 'actions/setup-node@v4').with['node-version'] === '22.23.4');
  check('regeneración solo programada en YAML efectivo', pasos.find(e => e.run === 'node tools/generar-blog.js').if === "github.event_name == 'schedule'");
  const preservarPaso = pasos.find(e => e.run === 'node tools/preservar-blog-publicado.cjs --out=_sitio');
  check('fallo de preservación bloquea el deploy', preservarPaso.if === "github.event_name != 'schedule'" && !preservarPaso['continue-on-error']);
  // El generador existente se ejercita con un artículo ficticio y raíz aislada.
  fs.copyFileSync(path.join(__dirname, 'generar-blog.js'), path.join(temp, 'tools/generar-blog.js'));
  fs.mkdirSync(path.join(temp, 'assets/js'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'assets/js/config.js'), 'window.UNEFIBRAS_CONFIG={seo:{url:"https://example.test/"}};');
  fs.writeFileSync(path.join(temp, 'sitemap.xml'), '<urlset></urlset>');
  const fixture = path.join(temp, 'fixture.json');
  const campos = { estado: 'PUBLICADO', titulo: 'Artículo ficticio', slug: 'articulo-ficticio', contenido: 'DATOS FICTICIOS', fecha: '2026-11-10' };
  fs.writeFileSync(fixture, JSON.stringify([{ document: { name: 'ficticio', fields: Object.fromEntries(Object.entries(campos).map(([k,v]) => [k,{stringValue:v}])) } }]));
  const generado = path.join(temp, 'generado');
  const r = spawnSync(process.execPath, [path.join(temp, 'tools/generar-blog.js'), '--fixture='+fixture, '--out='+generado], { encoding: 'utf8' });
  check('generador existente funciona sin producción', r.status === 0 && fs.existsSync(path.join(generado, 'blog/articulo-ficticio/index.html')));
  check('inventario exacto de regeneración ficticia', JSON.stringify(inventarioGenerado(generado)) === JSON.stringify(['blog/articulo-ficticio/index.html','blog/index.html','sitemap.xml']));
}
function inventarioGenerado(dir, base=dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?inventarioGenerado(path.join(dir,e.name),base):[path.relative(base,path.join(dir,e.name)).split(path.sep).join('/')]).sort();
}
async function probarWorker() {
  const viejo = spawnSync('git', ['show', 'ab296b4666e97e0f61a3c8d265a95316cb20698e:sw.js'], { encoding: 'utf8', cwd: raiz });
  assert.equal(viejo.status, 0);
  const nuevo = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
  let version = viejo.stdout;
  const rutas = ['admin/dashboard.js', 'admin/pagos.js', 'admin/planes.js', 'admin/vencimientos.js', 'assets/css/admin.css', 'assets/js/admin/consistencia-comercial.js'];
  const pagina = '<!doctype html><html lang="es"><meta charset="utf-8"><title>QA UNEFIBRA-044</title><h1>UNEFIBRA-044 · DATOS FICTICIOS</h1><p>Prueba local de actualización. Sin Firebase ni clientes reales.</p><pre id="resultado"></pre></html>';
  const servidor = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/unefibra/sw.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(version); }
    const ruta = req.url.split('?')[0].replace(/^\/unefibra\//, '');
    if (rutas.includes(ruta)) { res.setHeader('Content-Type', ruta.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(path.join(raiz, ruta))); }
    if (ruta === 'assets/js/admin/qa-nuevo.js') return res.end('nuevo-en-red');
    res.setHeader('Content-Type', 'text/html'); res.end(pagina);
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const origen = 'http://127.0.0.1:' + servidor.address().port;
  const browser = await chromium.launch({ headless: true });
  console.log('Chromium ' + browser.version());
  try {
    const contexto = await browser.newContext({ viewport: { width: 1000, height: 740 } });
    const page = await contexto.newPage();
    const externas = [];
    contexto.on('request', req => { if (!req.url().startsWith(origen)) externas.push(req.url()); });
    await page.goto(origen + '/unefibra/admin/qa.html');
    await page.evaluate(async () => { await navigator.serviceWorker.register('../sw.js'); await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async rutas => {
      localStorage.setItem('sesion-ficticia', 'conservada'); sessionStorage.setItem('formulario-ficticio', 'borrador'); document.cookie = 'qaFicticia=conservada; path=/';
      await new Promise((resolve, reject) => {const r=indexedDB.open('qa-sesion-ficticia',1);r.onupgradeneeded=()=>r.result.createObjectStore('sesion');r.onsuccess=()=>{const db=r.result;const t=db.transaction('sesion','readwrite');t.objectStore('sesion').put('conservada','usuario');t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});
      const cache = await caches.open('unefibras-v8');
      for (const ruta of rutas) await cache.put('/unefibra/' + ruta, new Response('VERSION-ANTERIOR'));
      await (await caches.open('otra-aplicacion-ficticia')).put('/test', new Response('conservar'));
    }, rutas);
    check('worker anterior reproduce contenido obsoleto', await page.evaluate(async () => (await (await fetch('dashboard.js')).text()) === 'VERSION-ANTERIOR'));
    version = nuevo;
    let navegaciones = 0;
    page.on('framenavigated', () => navegaciones++);
    await page.evaluate(async () => { const r=await navigator.serviceWorker.getRegistration();await r.update(); });
    await page.waitForFunction(async () => (await caches.keys()).includes('unefibras-v9-041-042') && !(await caches.keys()).includes('unefibras-v8'));
    check('actualización activa nueva caché y retira la anterior', true);
    check('no fuerza navegación ni interrumpe borrador', navegaciones === 0 && await page.evaluate(() => sessionStorage.getItem('formulario-ficticio') === 'borrador'));
    check('conserva caché ajena', await page.evaluate(async () => (await caches.keys()).includes('otra-aplicacion-ficticia')));
    await page.reload();
    for (const ruta of rutas) {
      const obtenido = await page.evaluate(async ruta => (await fetch('/unefibra/' + ruta)).text(), ruta);
      check('archivo actual tras actualización: ' + ruta, obtenido === fs.readFileSync(path.join(raiz, ruta), 'utf8'));
    }
    check('recursos administrativos no se almacenan en caché', await page.evaluate(async rutas => {
      for (const nombre of await caches.keys()) for (const r of await (await caches.open(nombre)).keys()) if (rutas.some(p => r.url.endsWith('/'+p))) return false;
      return true;
    }, rutas));
    check('cookie, localStorage y borrador conservados', await page.evaluate(() => document.cookie.includes('qaFicticia=conservada') && localStorage.getItem('sesion-ficticia') === 'conservada' && sessionStorage.getItem('formulario-ficticio') === 'borrador'));
    check('IndexedDB de sesión intacto', await page.evaluate(() => new Promise(resolve => { const r=indexedDB.open('qa-sesion-ficticia',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('sesion').objectStore('sesion').get('usuario');q.onsuccess=()=>{db.close();resolve(q.result==='conservada');};}; })));
    // Dos peticiones sucesivas comprueban red sin usar versiones previas.
    check('módulo nuevo accesible en primera petición', await page.evaluate(async () => (await (await fetch('/unefibra/assets/js/admin/qa-nuevo.js')).text()) === 'nuevo-en-red'));
    await contexto.setOffline(true);
    check('offline no devuelve un panel anterior', await page.evaluate(async () => {try {await fetch('dashboard.js');return false;}catch{return true;}}));
    await contexto.setOffline(false);
    version = nuevo.replace('unefibras-v9-041-042', 'unefibras-v10-reversion-qa');
    await page.evaluate(async () => {const r=await navigator.serviceWorker.getRegistration();await r.update();});
    await page.waitForFunction(async () => (await caches.keys()).includes('unefibras-v10-reversion-qa') && !(await caches.keys()).includes('unefibras-v9-041-042'));
    check('reversión usa nueva versión de caché', true);
    check('sesión conservada durante reversión', await page.evaluate(() => localStorage.getItem('sesion-ficticia') === 'conservada'));
    check('sin solicitudes externas ni SDK productivo', externas.length === 0);
    await page.locator('#resultado').textContent();
    await page.evaluate(n => { document.querySelector('#resultado').textContent='PASS: actualización v8 → v9 y reversión v10\n6 archivos administrativos actuales\nSesión ficticia, IndexedDB y caché ajena preservados\nSin conexiones externas\n'+n+' comprobaciones hasta este punto'; }, pass);
    await page.screenshot({ path: path.join(evidencia, 'actualizacion-worker-ficticia.png'), fullPage: true });
    await contexto.close();
  } finally { await browser.close(); await new Promise(resolve => servidor.close(resolve)); }
}
(async () => { await probarBlog(); await probarWorker(); console.log(`TOTAL ${pass} PASS / 0 FAIL; ${process.version}`); })().catch(e => { console.error(e); process.exitCode=1; });
