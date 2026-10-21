'use strict';
/* Servidor estático mínimo para el panel/landing de UneFibra (sin dependencias).
   Sirve la raíz del proyecto por HTTP para que los módulos ES y Firebase Auth
   funcionen (no file://). Uso: node tools/servir.js [puerto] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const puerto = Number(process.argv[2] || 5171);
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
http.createServer((req, res) => {
  let ruta = decodeURIComponent(req.url.split('?')[0]);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const abs = path.join(raiz, ruta);
  if (!abs.startsWith(raiz)) { res.writeHead(403); return res.end(); }
  fs.readFile(abs, (e, b) => {
    if (e) { res.writeHead(404); return res.end('no encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(b);
  });
}).listen(puerto, '127.0.0.1', () => console.log('servidor UneFibra en http://127.0.0.1:' + puerto + '/'));
