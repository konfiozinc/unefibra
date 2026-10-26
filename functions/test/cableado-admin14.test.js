'use strict';
/* ============================================================
 * Cableado · firebase-admin 14 y la API modular (KZ-UNEF-018)
 * ------------------------------------------------------------
 * Por qué existe esta prueba:
 *   El 26-oct-2026 el respaldo diario de Firestore —ya «corregido» en
 *   KZ-UNEF-005/006— moría en 53 ms con «TypeError: admin.firestore is not a
 *   function». firebase-admin 14 eliminó los namespaces legacy, index.js se
 *   migró a la API modular y `backup.js` no. Las 17 pruebas de respaldo no lo
 *   detectaron porque inyectan dependencias (`deps`) y nunca ejercitan el
 *   cableado por defecto.
 *
 * Esta prueba vigila justo eso: que ninguna función de src/ vuelva a usar un
 * namespace eliminado, y que la API modular que sí se usa exista de verdad.
 *
 *   node test/cableado-admin14.test.js
 * ============================================================ */
const fs = require("fs");
const path = require("path");

let ok = 0, fail = 0; const fallos = [];
const chk = (nm, cond, d) => {
  if (cond) { ok++; console.log("  PASA  " + nm.padEnd(62) + (d || "")); }
  else { fail++; fallos.push(nm); console.log("  **FALLA** " + nm.padEnd(59) + (d || "")); }
};

const SRC = path.resolve(__dirname, "..", "src");
const archivos = fs.readdirSync(SRC).filter((f) => f.endsWith(".js"));

/* Quita comentarios: un comentario que EXPLICA el defecto no es el defecto.
   Sin esto, el propio aviso «admin.firestore() ya no existe» haría fallar
   la prueba que vigila que nadie lo use. */
const soloCodigo = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const fuentes = Object.fromEntries(archivos.map((f) => [f, soloCodigo(fs.readFileSync(path.join(SRC, f), "utf8"))]));

/* 1 · Ningún archivo usa los namespaces que firebase-admin 14 eliminó. */
console.log("=== 1. Sin namespaces legacy ===");
const PROHIBIDOS = [
  { patron: /\badmin\.firestore\s*\(/, nombre: "admin.firestore()" },
  { patron: /\badmin\.firestore\s*\./, nombre: "admin.firestore.*" },
  { patron: /\badmin\.messaging\s*\(/, nombre: "admin.messaging()" },
  { patron: /\badmin\.auth\s*\(/, nombre: "admin.auth()" },
  { patron: /\badmin\.storage\s*\(/, nombre: "admin.storage()" }
];
for (const { patron, nombre } of PROHIBIDOS) {
  const culpables = archivos.filter((f) => patron.test(fuentes[f]));
  chk(`ningún módulo usa ${nombre}` + (culpables.length ? " → " + culpables.join(", ") : ""), culpables.length === 0);
}

/* 2 · Quien toca Firestore importa de la ruta modular. */
console.log("\n=== 2. Importaciones modulares ===");
const tocanFirestore = archivos.filter((f) => /getFirestore|\.collection\(|runTransaction|FieldValue/.test(fuentes[f]));
chk("hay módulos que tocan Firestore", tocanFirestore.length > 0, tocanFirestore.join(", "));
for (const f of tocanFirestore) {
  const t = fuentes[f];
  const importaModular = /require\(\s*["']firebase-admin\/firestore["']\s*\)/.test(t);
  const usaNamespace = /admin\.firestore/.test(t);
  chk(`${f} usa firebase-admin/firestore`, importaModular && !usaNamespace);
}

/* 3 · La API modular que se usa EXISTE con la versión instalada. */
console.log("\n=== 3. La API modular existe de verdad ===");
const admin = require("firebase-admin");
const version = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "node_modules", "firebase-admin", "package.json"), "utf8")).version;
console.log("  firebase-admin instalado: " + version);
if (!admin.getApps().length) admin.initializeApp({ projectId: "demo-unefibra" });

let modulo = null; let errorModulo = null;
try { modulo = require("firebase-admin/firestore"); } catch (e) { errorModulo = e.message; }
chk("se puede requerir firebase-admin/firestore", modulo !== null, errorModulo || "");
if (modulo) {
  chk("getFirestore() devuelve algo con collection()", typeof modulo.getFirestore().collection === "function");
  chk("FieldValue.serverTimestamp() existe", typeof modulo.FieldValue.serverTimestamp === "function");
  chk("Timestamp.fromMillis() existe", typeof modulo.Timestamp.fromMillis === "function");
  chk("Timestamp.fromMillis(0) construye", modulo.Timestamp.fromMillis(0).toMillis() === 0);
}

/* 4 · El módulo de respaldo arranca con sus dependencias por defecto. */
console.log("\n=== 4. El respaldo se construye sin depender de namespaces muertos ===");
let backup = null; let errorBackup = null;
try { backup = require("../src/backup"); } catch (e) { errorBackup = e.message; }
chk("backup.js se carga", backup !== null, errorBackup || "");
if (backup) {
  chk("exporta crearExportador", typeof backup.crearExportador === "function");
  const fuente = fuentes["backup.js"];
  chk("backup.js ya no llama admin.firestore()", !/admin\.firestore\s*\(/.test(fuente));
  chk("backup.js usa getFirestore()", /getFirestore\s*\(/.test(fuente));
  /* Construcción con dependencias falsas: no debe lanzar. */
  let exportador = null; let errorExportador = null;
  try {
    exportador = backup.crearExportador({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) }) });
  } catch (e) { errorExportador = e.message; }
  chk("crearExportador() se construye sin tocar la red", exportador !== null, errorExportador || "");
}

console.log("\n" + "=".repeat(72));
console.log(`CABLEADO ADMIN 14: ${ok + fail} pruebas · PASAN ${ok} · FALLAN ${fail}`);
if (fail) console.log("  Fallan: " + fallos.join(" | "));
console.log("=".repeat(72));
process.exit(fail ? 1 : 0);
