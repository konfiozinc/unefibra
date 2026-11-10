'use strict';
// UNEFIBRA-044: conserva el blog público aprobado dentro del artefacto de Pages.
// Solo GET estáticos; no SDK, credenciales ni escrituras al repositorio/Firestore.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const raiz = path.resolve(__dirname, '..');
const referencia = require('./unefibra-blog-publicado.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function inventario(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw Error('No se permiten enlaces simbólicos');
    return e.isDirectory() ? inventario(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  }).sort();
}
async function preservar({ out, obtener = fetch, ref = referencia }) {
  const destino = path.resolve(out);
  if (!fs.existsSync(destino) || fs.realpathSync(destino) !== path.join(raiz, '_sitio')) {
    throw Error('El destino debe ser el artefacto _sitio existente, sin enlaces');
  }
  if (ref.origen !== 'https://konfiozinc.github.io/unefibra/') throw Error('Origen no autorizado');
  const rutas = ref.archivos.map(e => e.ruta);
  if (new Set(rutas).size !== rutas.length || !rutas.includes('blog/index.html') || !rutas.includes('sitemap.xml')
    || rutas.some(p => p !== 'sitemap.xml' && !/^blog\/(?:[a-z0-9-]+\/)*index\.html$/.test(p))) throw Error('Referencia inválida');
  const blog = inventario(path.join(destino, 'blog')).map(p => 'blog/' + p);
  if (JSON.stringify(blog) !== JSON.stringify(rutas.filter(p => p.startsWith('blog/')).sort())) throw Error('Inventario del blog distinto de la referencia');
  for (const ruta of rutas) {
    const p = path.join(destino, ruta);
    if (!fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink() || fs.realpathSync(p) !== p) throw Error('Ruta de artefacto inválida: ' + ruta);
  }
  const pendientes = [];
  for (const entrada of ref.archivos) {
    const res = await obtener(new URL(entrada.ruta, ref.origen), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (res.status !== 200) throw Error('HTTP inesperado: ' + entrada.ruta);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024 || sha256(bytes) !== entrada.sha256) throw Error('El blog público cambió: ' + entrada.ruta);
    pendientes.push({ ruta: entrada.ruta, bytes });
  }
  // Todas las descargas deben estar verificadas antes de tocar el artefacto.
  for (const e of pendientes) fs.writeFileSync(path.join(destino, e.ruta), e.bytes);
  return pendientes.map(e => ({ ruta: e.ruta, sha256: sha256(e.bytes) }));
}
module.exports = { preservar, sha256 };
if (require.main === module) {
  const arg = process.argv.slice(2);
  if (arg.length !== 1 || arg[0] !== '--out=_sitio') {
    console.error('Uso: node tools/preservar-blog-publicado.cjs --out=_sitio'); process.exitCode = 1;
  } else preservar({ out: path.join(raiz, '_sitio') }).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
