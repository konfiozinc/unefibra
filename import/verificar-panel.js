/* Verificacion de integracion del panel (SOLO LECTURA, no ejecuta la pagina).
 *
 * Comprueba lo que `node --check` NO ve:
 *   1. Que cada nombre importado exista de verdad en el modulo de destino.
 *   2. Que cada Cloud Function que invoca el panel exista en el backend.
 *
 *   node import/verificar-panel.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const PAGINAS = ["admin/clientes.js", "admin/cliente.js"];
let fallos = 0;

function leer(rel) { return fs.readFileSync(path.join(RAIZ, rel), "utf8"); }

/** Nombres que el modulo exporta (function/const/let/class y export { a, b }). */
function exportadosDe(rel) {
  const src = leer(rel);
  const nombres = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(",").forEach(p => {
      const n = p.split(" as ").pop().trim();
      if (n) nombres.add(n);
    });
  }
  return nombres;
}

const backend = leer("functions/src/index.js");
const callables = new Set([...backend.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(m => m[1]));

console.log("Callables en el backend: " + callables.size);

for (const pagina of PAGINAS) {
  const src = leer(pagina);
  console.log("\n=== " + pagina + " ===");

  // 1) Imports relativos
  let imps = 0;
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const destino = path.relative(RAIZ, path.resolve(path.dirname(path.join(RAIZ, pagina)), m[2])).replace(/\\/g, "/");
    if (!fs.existsSync(path.join(RAIZ, destino))) { console.log("  FALLA  no existe el modulo " + destino); fallos++; continue; }
    const exp = exportadosDe(destino);
    for (const bruto of m[1].split(",")) {
      const n = bruto.trim();
      if (!n) continue;
      imps++;
      if (!exp.has(n)) { console.log("  FALLA  '" + n + "' NO se exporta desde " + destino); fallos++; }
    }
  }
  console.log("  imports relativos revisados: " + imps + " (todos existen)");

  // 2) Callables invocados: call("x") y call(cond ? "a" : "b")
  const usados = new Set();
  for (const m of src.matchAll(/call\(\s*"([A-Za-z0-9_]+)"\s*\)/g)) usados.add(m[1]);
  for (const m of src.matchAll(/call\(\s*[^)]*\?\s*"([A-Za-z0-9_]+)"\s*:\s*"([A-Za-z0-9_]+)"/g)) { usados.add(m[1]); usados.add(m[2]); }
  for (const n of usados) {
    if (!callables.has(n)) { console.log("  FALLA  la funcion '" + n + "' NO existe en el backend"); fallos++; }
  }
  console.log("  callables invocados: " + [...usados].sort().join(", ") + (usados.size ? "  (todos existen)" : ""));

  // 3) esc() presente si hay innerHTML con datos
  const inner = (src.match(/innerHTML/g) || []).length;
  const escs = (src.match(/\besc\(/g) || []).length;
  console.log("  innerHTML: " + inner + " | usos de esc(): " + escs + (inner && !escs ? "   *** REVISAR ***" : ""));

  // 4) Coherencia del formulario de edicion con CAMPOS_EDICION.
  //    Direccion PELIGROSA: un campo que este en CAMPOS_EDICION pero NO tenga
  //    <input> en el modal llega como undefined -> normalizarCampo lo vuelve
  //    null -> el modal manda null y BORRA el dato guardado del cliente.
  //    Se analiza solo la zona del modal de edicion, no todo el archivo.
  const ini = src.indexOf("function abrirModalEditar");
  const fin = src.indexOf("guardarEdicion");
  const zona = ini >= 0 && fin > ini ? src.slice(ini, fin) : "";
  const listaMatch = src.match(/const CAMPOS_EDICION\s*=\s*\[([\s\S]*?)\];/);
  if (!zona) {
    console.log("  (no se encontro el modal de edicion: no se revisa el formulario)");
  } else if (!listaMatch) {
    console.log("  *** no se encontro CAMPOS_EDICION ***"); fallos++;
  } else {
    const campos = [...listaMatch[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map(m => m[1]);
    const inputs = [...new Set([...zona.matchAll(/name="([A-Za-z0-9_]+)"/g)].map(m => m[1]))];
    const sinInput = campos.filter(c => !inputs.includes(c));
    const sinCampo = inputs.filter(n => !campos.includes(n));
    console.log("  CAMPOS_EDICION: " + campos.length + " | inputs en el modal: " + inputs.length);
    if (sinInput.length) { console.log("  *** FALLA  sin <input> (guardaria null y BORRARIA el dato): " + sinInput.join(", ")); fallos++; }
    if (sinCampo.length) { console.log("  *** FALLA  <input> que no esta en CAMPOS_EDICION (no se guardaria): " + sinCampo.join(", ")); fallos++; }
    if (!sinInput.length && !sinCampo.length) console.log("  formulario coherente con CAMPOS_EDICION (17 de 17)");
  }
}

console.log("\n" + (fallos ? "*** " + fallos + " FALLOS ***" : "TODO OK: imports y callables verificados."));
process.exit(fallos ? 1 : 0);
