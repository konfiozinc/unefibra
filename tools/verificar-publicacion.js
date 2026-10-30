#!/usr/bin/env node
/* ============================================================
 * UneFibra SAS — Puerta de publicación (KZ-UNEF-032)
 * ------------------------------------------------------------
 * POR QUÉ EXISTE
 * El panel puede publicarse por GitHub Pages en cuanto `main` cambie, pero las
 * funciones que usa se despliegan aparte y con autorización. Publicar el panel
 * antes que sus funciones deja botones que no hacen nada (pasó con
 * `confirmarRevisionComercial` en KZ-031).
 *
 * QUÉ COMPRUEBA (solo lectura, sin desplegar ni escribir nada)
 *   1. Las funciones que el panel necesita existen y están ACTIVE.
 *   2. La página del panel responde.
 *   3. El código del repositorio trae los archivos del panel nuevo.
 *
 * USO
 *   node tools/verificar-publicacion.js            # contra producción (solo lectura)
 *   node tools/verificar-publicacion.js --antes    # antes de publicar (debe FALLAR)
 *   node tools/verificar-publicacion.js --despues  # después de publicar (debe PASAR)
 * ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { tokenAcceso } = require("./lib/google-auth");

const RAIZ = path.join(__dirname, "..");
const PROYECTO = "une-fibra";
const FUNCIONES_NECESARIAS = ["confirmarRevisionComercial", "backupFirestore", "continuarBackup"];
const PAGINA = "https://konfiozinc.github.io/unefibra/admin/revision-clientes.html";
const ARCHIVOS_PANEL = [
  "admin/revision-clientes.html",
  "admin/revision-clientes.js",
  "assets/js/admin/revision-reglas.js",
  "assets/js/admin/shell.js"
];

const modo = process.argv.includes("--antes") ? "antes" : (process.argv.includes("--despues") ? "despues" : "diagnostico");
const filas = [];
const anotar = (nombre, ok, detalle) => filas.push({ nombre, ok, detalle });

async function desplegadas(t) {
  const r = await fetch(`https://cloudfunctions.googleapis.com/v1/projects/${PROYECTO}/locations/-/functions?pageSize=100`, {
    headers: { Authorization: "Bearer " + t }
  });
  if (r.status !== 200) throw new Error("no se pudo listar funciones (HTTP " + r.status + ")");
  const j = await r.json();
  return (j.functions || []).map((f) => ({ nombre: f.name.split("/").pop(), estado: f.status, version: f.versionId, actualizada: f.updateTime }));
}

(async () => {
  const t = await tokenAcceso();
  const lista = await desplegadas(t);

  for (const nombre of FUNCIONES_NECESARIAS) {
    const f = lista.find((x) => x.nombre === nombre);
    const ok = !!(f && f.estado === "ACTIVE");
    anotar("función " + nombre, ok, f ? `${f.estado} v${f.version}` : "NO DESPLEGADA");
  }

  for (const rel of ARCHIVOS_PANEL) {
    const existe = fs.existsSync(path.join(RAIZ, rel));
    anotar("archivo " + rel, existe, existe ? "presente" : "FALTA");
  }

  try {
    const r = await fetch(PAGINA, { redirect: "follow" });
    anotar("página del panel responde", r.status === 200, "HTTP " + r.status);
  } catch (e) {
    anotar("página del panel responde", false, e.message.slice(0, 80));
  }

  console.log("=== Puerta de publicación · UneFibra (" + modo + ") ===");
  for (const f of filas) console.log((f.ok ? "  OK    " : "  BLOQUEO ") + f.nombre.padEnd(42) + f.detalle);
  const bloqueos = filas.filter((f) => !f.ok);
  console.log("");
  if (!bloqueos.length) {
    console.log("RESULTADO: LISTO PARA PUBLICAR — todas las funciones necesarias están desplegadas.");
    process.exit(0);
  }
  console.log("RESULTADO: NO PUBLICAR todavía — " + bloqueos.length + " requisito(s) sin cumplir:");
  bloqueos.forEach((b) => console.log("   · " + b.nombre + " (" + b.detalle + ")"));
  console.log("\nQué hacer: desplegar solo la función que falta (con autorización), volver a ejecutar");
  console.log("con --despues y, si pasa, publicar el panel. Si ya está publicado, revertir la rama.");
  process.exit(modo === "antes" ? 0 : 2);
})().catch((e) => { console.error("ERROR: " + e.message); process.exit(3); });
