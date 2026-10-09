/* ============================================================
 * UneFibra SAS — Reconstrucción de IPs de clientes (DRY-RUN)
 * ------------------------------------------------------------
 * El Excel trae las IPs a medias: 35 completas y 309 fragmentos. Se confirmó
 * que el fragmento son los DOS ÚLTIMOS octetos de una LAN 192.168.x.x (el
 * 3er octeto de las completas y el 1er octeto de los fragmentos son el mismo
 * conjunto), así que "101.2" -> "192.168.101.2".
 *
 * ESTE SCRIPT NO ESCRIBE NADA EN FIRESTORE. Solo:
 *   - clasifica cada IP y propone la reconstrucción,
 *   - guarda la propuesta en import/ips-reconstruidas.json (GITIGNOREADO)
 *     para que el paso de "aplicar" la consuma más tarde, DESPUÉS de validar
 *     contra las queues reales del router.
 *
 *   node import/arreglar-ips.js
 *
 * También exporta `reconstruirIp` y `leerClientes` para que
 * import/test-mikrotik.js use el MISMO criterio sin duplicarlo.
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}

/** Lee TODA la colección clientes (solo lectura). */
async function leerClientes(tok) {
  const out = [];
  let pageToken = "", vueltas = 0;
  do {
    const url = `${BASE}/clientes?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) throw new Error("Firestore " + res.status);
    const d = await res.json();
    (d.documents || []).forEach(doc => {
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
      out.push({ id: doc.name.split("/").pop(), ...f });
    });
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);
  return out;
}

const octetoOk = (o) => /^\d{1,3}$/.test(o) && Number(o) >= 0 && Number(o) <= 255;
const esIPv4 = (s) => {
  const p = String(s || "").trim().split(".");
  return p.length === 4 && p.every(octetoOk);
};

/**
 * Devuelve { tipo, ip, detalle }:
 *   tipo: "sin-ip" | "completa" | "reconstruida" | "corregida" | "incompleta" | "basura"
 *   ip: la IP propuesta (o null si no se puede).
 */
function reconstruirIp(crudo) {
  const s = String(crudo || "").trim();
  if (!s) return { tipo: "sin-ip", ip: null };

  if (esIPv4(s)) return { tipo: "completa", ip: s };

  // Normalización de errores de digitación del Excel.
  const t = s
    .replace(/\s*\+\s*$/, "")   // "101.133 +" -> "101.133"
    .replace(/[;,]/g, ".")      // "50,2" -> "50.2", "192.168,100." -> "192.168.100."
    .replace(/-/g, ".")         // "192.168.50-2" -> "192.168.50.2"
    .replace(/\.{2,}/g, ".")    // "100..107" -> "100.107"
    .replace(/^\.+|\.+$/g, "")
    .trim();

  if (t !== s && esIPv4(t)) return { tipo: "corregida", ip: t, detalle: s };

  const p = t.split(".");

  // Fragmento de 2 octetos válidos -> 192.168.x.x
  if (p.length === 2 && p.every(octetoOk)) {
    return { tipo: "reconstruida", ip: "192.168." + p[0] + "." + p[1], detalle: s };
  }

  // 3 octetos 192.168.x: falta el host, no se puede completar solo.
  if (p.length === 3 && p[0] === "192" && p[1] === "168" && octetoOk(p[2])) {
    return { tipo: "incompleta", ip: null, detalle: s };
  }

  return { tipo: "basura", ip: null, detalle: s };
}

const mascara = (ip) => String(ip || "").replace(/\.(\d+)$/, ".XXX");

async function main() {
  const tok = await tokenAcceso();
  const clientes = await leerClientes(tok);

  const filas = [];
  const resumen = { "sin-ip": 0, completa: 0, corregida: 0, reconstruida: 0, incompleta: 0, basura: 0 };

  clientes.forEach(c => {
    const r = reconstruirIp(c.ip);
    resumen[r.tipo] = (resumen[r.tipo] || 0) + 1;
    filas.push({
      clienteId: c.id,
      nombre: c.nombreCompleto,
      telefono: c.telefono,
      ipAnterior: c.ip || null,
      ipPropuesta: r.ip,
      tipo: r.tipo,
      // El limite original NO se conoce aun: se lee de la queue real de
      // MikroTik en import/test-mikrotik.js. Aquí va null a proposito, para no
      // inventar un valor a partir del plan (que puede no coincidir).
      maxLimitOriginal: null
    });
  });

  console.log("=".repeat(72));
  console.log("RECONSTRUCCION DE IPs — DRY-RUN (no escribe nada en Firestore)");
  console.log("=".repeat(72));
  console.log("\n  Clientes leidos          : " + clientes.length);
  console.log("  --- CLASIFICACION ---");
  console.log("  sin IP                   : " + (resumen["sin-ip"] || 0));
  console.log("  IPv4 completa (se queda) : " + (resumen.completa || 0));
  console.log("  corregida a mano         : " + (resumen.corregida || 0) + "   (comas, guiones, doble punto)");
  console.log("  reconstruida 192.168.x.x : " + (resumen.reconstruida || 0));
  console.log("  incompleta (3 octetos)   : " + (resumen.incompleta || 0));
  console.log("  basura sin arreglo       : " + (resumen.basura || 0));

  const aprovechables = (resumen.completa || 0) + (resumen.corregida || 0) + (resumen.reconstruida || 0);
  console.log("\n  TOTAL aprovechable       : " + aprovechables + " de " + (clientes.length - (resumen["sin-ip"] || 0)));

  console.log("\n  --- CORREGIDAS A MANO ---");
  filas.filter(f => f.tipo === "corregida").forEach(f =>
    console.log("    '" + f.ipAnterior + "'  ->  " + mascara(f.ipPropuesta)));

  console.log("\n  --- MUESTRA DE RECONSTRUIDAS (ultimo octeto oculto) ---");
  filas.filter(f => f.tipo === "reconstruida").slice(0, 10).forEach(f =>
    console.log("    '" + f.ipAnterior + "'  ->  " + mascara(f.ipPropuesta)));

  console.log("\n  --- SIN ARREGLO AUTOMATICO (quedan null o pendientes) ---");
  filas.filter(f => f.tipo === "incompleta" || f.tipo === "basura").forEach(f => {
    const nom = String(f.nombre || "").split(" ").slice(0, 2).join(" ") || "(sin nombre)";
    console.log("    '" + f.ipAnterior + "'  ->  " + (f.tipo === "incompleta" ? "FALTA EL HOST (revisar)" : "NULL (revisar)") + "  |  " + nom + " ...");
  });

  console.log("\n  --- maxLimitOriginal ---");
  console.log("  Asignado: 0. Queda null para todos a proposito: se rellena con el");
  console.log("  max-limit REAL que devuelve /queue/simple/print (test-mikrotik.js).");

  const destino = path.join(__dirname, "ips-reconstruidas.json");
  fs.writeFileSync(destino, JSON.stringify(filas, null, 1), "utf8");
  console.log("\n  Propuesta completa -> " + destino + "  (gitignoreado)");
  console.log("\n*** DRY-RUN: NO se escribio nada en Firestore. ***");
}

module.exports = { reconstruirIp, leerClientes };

if (require.main === module) {
  main().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
}
