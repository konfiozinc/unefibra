/* ============================================================
 * UneFibra SAS — Test de conexión a MikroTik (SOLO LECTURA)
 * ------------------------------------------------------------
 * Vuelca las queues reales del router (/queue/simple/print) a un JSON local y
 * las cruza contra Firestore para saber cuántos clientes se pueden enlazar por
 * IP y cuántos por nombre. NO modifica el router NI Firestore.
 *
 * Uso (con las credenciales del usuario api-panel que cree el cliente):
 *
 *   $env:MIKROTIK_HOST="186.97.86.26"
 *   $env:MIKROTIK_PORT="8729"          # 8729 = api-ssl (recomendado); 8728 = plano
 *   $env:MIKROTIK_USER="api-panel"
 *   $env:MIKROTIK_PASSWORD="la-contrasena"
 *   node import/test-mikrotik.js
 *
 * La salida de las queues queda en import/queues-mikrotik.json (GITIGNOREADO):
 * ahí está el detalle completo con nombre, target, max-limit y disabled. En la
 * consola se muestran los nombres ENMASCARADOS y solo los conteos.
 *
 * OJO sobre TLS: el certificado de api-ssl suele ser AUTOFIRMADO, por eso se
 * conecta con `rejectUnauthorized: false`. No confundir "aceptar el certificado
 * del router" con "no cifrar": el trafico SI va cifrado.
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { RouterOSAPI } = require("../functions/node_modules/node-routeros");
const { tokenAcceso } = require("../tools/lib/google-auth");
const { reconstruirIp, leerClientes } = require("./arreglar-ips");

const HOST = process.env.MIKROTIK_HOST;
const PORT = Number(process.env.MIKROTIK_PORT || "8728");
const USER = process.env.MIKROTIK_USER;
const PASSWORD = process.env.MIKROTIK_PASSWORD;

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const nombreCorto = (n) => {
  const p = String(n || "").trim().split(/\s+/);
  return (p[0] || "?") + " " + (p[1] ? p[1].slice(0, 1) + "." : "");
};

async function main() {
  if (!HOST || !USER || !PASSWORD) {
    console.log("Faltan variables de entorno. Uso:");
    console.log('  $env:MIKROTIK_HOST="186.97.86.26"');
    console.log('  $env:MIKROTIK_PORT="8729"');
    console.log('  $env:MIKROTIK_USER="api-panel"');
    console.log('  $env:MIKROTIK_PASSWORD="..."');
    console.log("  node import/test-mikrotik.js");
    process.exit(0);
  }

  console.log("=".repeat(72));
  console.log("TEST MIKROTIK — SOLO LECTURA");
  console.log("=".repeat(72));
  console.log("  Host: " + HOST + ":" + PORT + (PORT === 8729 ? " (api-ssl/TLS)" : " (plano)"));

  const conn = new RouterOSAPI({
    host: HOST,
    user: USER,
    password: PASSWORD,
    port: PORT,
    timeout: 10,
    ...(PORT === 8729 ? { tls: { rejectUnauthorized: false } } : {})
  });

  await conn.connect();
  let queues = [];
  try {
    queues = await conn.write("/queue/simple/print", []);
  } finally {
    await conn.close();
  }

  // Normalizar targets: vienen como "192.168.50.2/32" o listas separadas por coma.
  const targets = new Set();
  const nombres = new Set();
  const filas = queues.map(q => {
    const t = String(q.target || "");
    const nombre = String(q.name || "");
    t.split(",").forEach(x => { const v = x.trim().replace(/\/32$/i, ""); if (v) targets.add(v); });
    if (nombre) nombres.add(norm(nombre));
    return {
      nombre,
      target: t,
      maxLimit: q["max-limit"] || null,
      disabled: q.disabled === "true" || q.disabled === true,
      idInterno: q[".id"] || null
    };
  });

  const deshabilitadas = filas.filter(f => f.disabled).length;
  console.log("\n  Queues encontradas        : " + filas.length);
  console.log("  Deshabilitadas (disabled) : " + deshabilitadas);
  console.log("  Ejemplos de nombre (enmascarado):");
  filas.slice(0, 8).forEach(f =>
    console.log("    " + (f.disabled ? "[DISABLED] " : "          ") + nombreCorto(f.nombre) + "  | target " + f.target + "  | " + (f.maxLimit || "?")));

  // Guardar el volcado completo (gitignoreado).
  const destino = path.join(__dirname, "queues-mikrotik.json");
  fs.writeFileSync(destino, JSON.stringify({
    fecha: new Date().toISOString(),
    host: HOST + ":" + PORT,
    total: filas.length,
    queues: filas
  }, null, 1), "utf8");

  // ── Cruce contra Firestore ──────────────────────────────────────────────
  const tok = await tokenAcceso();
  const clientes = await leerClientes(tok);

  let porIp = 0, porNombre = 0, porAmbas = 0, sinMatch = [];
  clientes.forEach(c => {
    const r = reconstruirIp(c.ip);
    const okIp = r.ip && targets.has(r.ip);

    const candidatos = [norm(c.nombreOriginal || ""), norm(c.nombreCompleto || "")].filter(Boolean);
    // Un nombre de queue "JHON REYES CANTARES1 T3 APTO 103" CONTIENE el nombre
    // limpio "JHON REYES ..." o el original sucio. Se compara por inclusion.
    const okNombre = candidatos.some(cand =>
      [...nombres].some(n => n.includes(cand) || cand.includes(n)));

    if (okIp && okNombre) porAmbas++;
    else if (okIp) porIp++;
    else if (okNombre) porNombre++;
    else sinMatch.push(c);
  });

  console.log("\n  --- CRUCE CONTRA FIRESTORE (" + clientes.length + " clientes) ---");
  console.log("  Enlazan por IP           : " + (porIp + porAmbas));
  console.log("  Enlazan por NOMBRE       : " + (porNombre + porAmbas));
  console.log("  (por ambas              : " + porAmbas + ")");
  console.log("  SIN match (ni IP ni nombre): " + sinMatch.length);
  sinMatch.slice(0, 15).forEach(c =>
    console.log("    " + nombreCorto(c.nombreCompleto) + "  | ip " + (c.ip || "-")));
  if (sinMatch.length > 15) console.log("    ... y " + (sinMatch.length - 15) + " mas (ver queues-mikrotik.json)");

  console.log("\n  Volcado completo -> " + destino + "  (gitignoreado)");
  console.log("\n*** SOLO LECTURA: no se modifico el router ni Firestore. ***");
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => {
    console.log("ERROR: " + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
