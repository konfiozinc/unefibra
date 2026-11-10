'use strict';
// Ejecuta las pantallas reales con SDK sustituido y fixtures. Intercepta TODA la red.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../../Konfio-Zinc-Web/herramientas/node_modules/playwright');
const raiz = path.resolve(__dirname, '..');
const validacion042 = process.argv.includes('--unefibra-042');
const evidencia = path.join(raiz, 'docs/evidencias', validacion042 ? 'unefibra-042' : 'unefibra-041');
const C = require('../assets/js/admin/consistencia-comercial');
const clientes = [
  { id: 'f1', nombreCompleto: 'Cliente ficticio A', cicloCorte: '15', fechaVencimiento: '2026-10-15', precioMensual: 50000, estadoCliente: 'ACTIVO' },
  { id: 'f2', nombreCompleto: 'Cliente ficticio B', cicloCorte: '15', fechaVencimiento: '2026-11-15', precioMensual: 60000, estadoCliente: 'ACTIVO' },
  { id: 'f3', nombreCompleto: 'Cliente ficticio C', cicloCorte: '30', fechaVencimiento: '2026-11-30', precioMensual: 0, estadoCliente: 'ACTIVO' },
  { id: 'f4', nombreCompleto: 'Cliente ficticio D', cicloCorte: '30', fechaVencimiento: '2026-11-30', precioMensual: 70000, estadoCliente: 'ACTIVO' }
];
const servicios = clientes.map((c, i) => ({ id: 's' + i, clienteId: c.id, cicloCorte: c.cicloCorte, fechaVencimiento: c.fechaVencimiento, precioMensual: c.precioMensual,
  ...(i === 2 ? { conciliacion: { estado: 'PENDIENTE_VALIDACION' } } : {}) }));
const datos = { clientes, servicios, pagos: [], metodos_pago: [], planes: [
  { id: 'p0', nombre: 'Plan ficticio pendiente', velocidad: '50 Mbps', precio: 0, duracion: 30, estado: 'ACTIVO' },
  { id: 'pn', nombre: 'Plan ficticio sin valor', velocidad: '60 Mbps', duracion: 30, estado: 'ACTIVO' },
  { id: 'p1', nombre: 'Plan ficticio confirmado', velocidad: '100 Mbps', precio: 50000, duracion: 30, estado: 'ACTIVO' }
] };
const firestore = `
const datos = ${JSON.stringify(datos)};
export const collection=(db,nombre)=>({nombre});
export const where=(campo,op,valor)=>({campo,op,valor});
export const query=(c,...filtros)=>({...c,filtros});
const rows=q=>(datos[q.nombre]||[]).filter(r=>(q.filtros||[]).every(f=>{const v=f.campo.split('.').reduce((a,k)=>a&&a[k],r); return f.op==='=='?v===f.valor:f.op==='>='?v>=f.valor:v<=f.valor}));
export const getDocs=async q=>({docs:rows(q).map(r=>({id:r.id,data:()=>r}))});
export const getCountFromServer=async q=>({data:()=>({count:rows(q).length})});
export const sum=campo=>campo;
export const getAggregateFromServer=async()=>({data:()=>({total:0})});
export const doc=(db,...ruta)=>({ruta});
export const getDoc=async()=>({exists:()=>true,data:()=>({rol:globalThis.__rol||'SUPERADMIN',activo:true,nombre:'Revisión local · DATOS FICTICIOS'})});
export const serverTimestamp=()=>null;
export function addDoc(){globalThis.__intentosEscritura=(globalThis.__intentosEscritura||0)+1;throw Error('Escritura bloqueada en QA')}
export const updateDoc=addDoc;
`;
const auth = `export function onAuthStateChanged(a,cb){queueMicrotask(()=>cb(sessionStorage.getItem('salir')?null:{uid:'ficticio',email:'ficticio@example.test'}));} export async function signOut(){sessionStorage.setItem('salir','1');} export async function signInWithEmailAndPassword(){throw Error('Login real bloqueado en QA')}`;
const funciones = `export const getFunctions=()=>({}); export const connectFunctionsEmulator=()=>{};
export const httpsCallable=(f,n)=>async()=>{if(n!=='listarPropuestasPagos'){globalThis.__intentosEscritura=(globalThis.__intentosEscritura||0)+1;throw Error('Escritura bloqueada en QA');} return {data:{total:0,limite:100,propuestas:[],interruptorActivo:false}}};`;
let pass = 0;
const check = (nombre, fn) => { assert.ok(fn, nombre); pass++; console.log('PASS ' + nombre); };
(async () => {
  fs.mkdirSync(evidencia, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  console.log('Motor: ' + browser.version());
  try {
    const tamanos = [['escritorio', { width: 1440, height: 1000 }], ['movil', { width: 390, height: 844 }]];
    if (validacion042) tamanos.push(['movil-320', { width: 320, height: 740 }]);
    for (const [nombre, viewport] of tamanos) {
      const contexto = await browser.newContext({ viewport, locale: 'es-CO', serviceWorkers: 'block' });
      const errores = [], bloqueadas = [];
      await contexto.addInitScript(() => { globalThis.__rol = 'SUPERADMIN'; });
      await contexto.route('**/*', async route => {
        const url = new URL(route.request().url());
        const responder = body => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body });
        if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebase-firestore.js')) return responder(firestore);
        if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebase-auth.js')) return responder(auth);
        if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebase-functions.js')) return responder(funciones);
        if (url.hostname !== '127.0.0.1') { bloqueadas.push(url.hostname); return route.abort(); }
        if (url.pathname === '/assets/js/config.js') return responder('window.UNEFIBRAS_CONFIG={};');
        if (url.pathname === '/assets/js/admin/core.js') return responder('export const app={},auth={},db={}; export const isConfigured=()=>true; export const modoEmuladorActivo=()=>false; export const MENSAJE_NO_CONFIGURADO="";');
        const archivo = path.resolve(raiz, '.' + decodeURIComponent(url.pathname));
        if (!archivo.startsWith(raiz + path.sep) || !['/admin/', '/assets/'].some(p => url.pathname.startsWith(p))) return route.abort();
        if (!fs.existsSync(archivo)) return route.abort();
        const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
        let body = fs.readFileSync(archivo);
        if (archivo.endsWith('.html')) body = Buffer.from(body.toString('utf8').replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, ''));
        return route.fulfill({ contentType: (tipos[path.extname(archivo)] || 'application/octet-stream') + '; charset=utf-8', body });
      });
      const page = await contexto.newPage();
      page.on('pageerror', e => errores.push(e.message));
      await page.clock.install({ time: new Date('2026-11-10T15:00:00Z') });
      const indicadores = {};
      for (const pantalla of ['dashboard', 'vencimientos', 'planes', 'pagos']) {
        await page.goto('http://127.0.0.1:4171/admin/' + pantalla + '.html');
        await page.waitForFunction(() => document.querySelector('#app-content .card, #app-content table, #tabla .empty'));
        check(nombre + ' ' + pantalla + ' sin desborde de página', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (['dashboard', 'vencimientos'].includes(pantalla)) {
          indicadores[pantalla] = await page.locator('.card').evaluateAll(cards => Object.fromEntries(cards.map(c => [c.querySelector('.card__label')?.textContent.trim(), c.querySelector('.card__value')?.textContent.trim()])));
        }
        const texto = await page.locator('#app-content').innerText();
        if (pantalla === 'vencimientos') {
          check(nombre + ' conserva atraso y siguiente corte separados', texto.includes('15/10/2026') && texto.includes('15/11/2026'));
          check(nombre + ' muestra evidencia insuficiente', texto.includes('Sin evidencia suficiente para determinar deuda'));
          check(nombre + ' precios pendientes visibles', texto.includes('Precio por confirmar'));
        }
        if (pantalla === 'planes') {
          check(nombre + ' dos precios pendientes y uno confirmado', (texto.match(/Precio por confirmar/g)||[]).length === 2 && texto.includes('50.000'));
          check(nombre + ' ningún precio gratuito inventado', !texto.includes('$ 0') && !texto.includes('$0'));
        }
        if (pantalla === 'pagos') {
          check(nombre + ' pagos operativos vacíos y acceso al Excel', texto.includes('No hay pagos operativos') && await page.locator('a[href="pagos-historicos.html"]').count() >= 1);
        }
        if (nombre.startsWith('movil')) { await page.locator('#menu-toggle').click(); check(nombre + ' menú móvil ' + pantalla, await page.locator('#sidebar').evaluate(e => e.classList.contains('is-open'))); await page.keyboard.press('Escape'); }
        if (validacion042) {
          check(nombre + ' ' + pantalla + ' sin escrituras automáticas', await page.evaluate(() => !globalThis.__intentosEscritura));
          check(nombre + ' ' + pantalla + ' encabezado completo', await page.locator('.topbar__user').evaluate(e => e.textContent.includes('DATOS FICTICIOS') && e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1));
          if (nombre.startsWith('movil') && pantalla === 'planes') {
            check(nombre + ' indicación de desplazamiento visible', await page.locator('#planes-scroll-hint').isVisible());
            const tabla = page.locator('#tabla');
            check(nombre + ' tabla desborda solo dentro de su región', await tabla.evaluate(e => e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === 'auto'));
            await tabla.focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(200);
            check(nombre + ' desplazamiento por teclado', await tabla.evaluate(e => e.scrollLeft > 0));
            await tabla.evaluate(e => { e.scrollLeft = e.scrollWidth; });
            check(nombre + ' últimas columnas accesibles', await tabla.evaluate(e => {
              const limite=e.getBoundingClientRect();
              return [...e.querySelectorAll('thead th')].slice(3).every(c => {
                const inicial=c.getBoundingClientRect();
                e.scrollLeft += inicial.left - limite.left - 1;
                const r=c.getBoundingClientRect();
                return r.left>=limite.left && r.right<=limite.right+1;
              });
            }));
            await page.screenshot({ path: path.join(evidencia, nombre + '-planes-columnas-finales.png'), fullPage: true });
            await tabla.evaluate(e => { e.scrollLeft = 0; });
          }
        }
        await page.screenshot({ path: path.join(evidencia, nombre + '-' + pantalla + '.png'), fullPage: true });
      }
      const esperado = C.resumen(C.prepararTodos(clientes, servicios, [], '2026-11-10'));
      for (const g of C.GRUPOS) check(nombre + ' coherencia ' + g.key, indicadores.dashboard[g.titulo] === String(esperado[g.key]) && indicadores.vencimientos[g.titulo] === String(esperado[g.key]));
      await page.locator('#app-content a[href="pagos-historicos.html"]').click();
      await page.waitForURL('**/pagos-historicos.html');
      await page.waitForTimeout(100);
      check(nombre + ' navegación al Excel', page.url().endsWith('/pagos-historicos.html'));
      check(nombre + ' cero errores JS', errores.length === 0);
      check(nombre + ' sin solicitudes externas no previstas', bloqueadas.every(h => h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'));
      await contexto.close();
    }
  } finally { await browser.close(); }
  console.log(`TOTAL ${pass} PASS / 0 FAIL; capturas ficticias en ${evidencia}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
