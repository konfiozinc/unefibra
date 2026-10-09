/* ============================================================
 * Analisis READ-ONLY de las IP de los clientes, para la integracion MikroTik.
 * NO escribe nada.
 *
 *   node import/analizar-ips.js
 *
 * Lo que se quiere saber: si el campo `ip` sirve para ENLAZAR con la queue de
 * MikroTik (que identifica al cliente por su target, ej. "192.168.50.2/32").
 * ============================================================ */
"use strict";

const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const mascara = (ip) => String(ip || "").replace(/\.(\d+)$/, ".XXX");

function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}

(async () => {
  const tok = await tokenAcceso();
  const clientes = [];
  let pageToken = "", vueltas = 0;
  do {
    const url = `${BASE}/clientes?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) throw new Error("Firestore " + res.status);
    const d = await res.json();
    (d.documents || []).forEach(doc => {
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
      clientes.push(f);
    });
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);

  const conIp = clientes.filter(c => c.ip);
  const sinIp = clientes.filter(c => !c.ip);

  const esIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s).trim()) &&
    String(s).trim().split(".").every(o => Number(o) >= 0 && Number(o) <= 255);
  const octetos = (s) => String(s).trim().split(".").filter(x => x !== "").length;

  const completas = conIp.filter(c => esIPv4(c.ip));
  const parciales = conIp.filter(c => !esIPv4(c.ip));

  console.log("=".repeat(72));
  console.log("ANALISIS DE LAS IP DE LOS CLIENTES — " + clientes.length + " clientes");
  console.log("=".repeat(72));
  console.log("\n  Con campo `ip`            : " + conIp.length);
  console.log("  Sin campo `ip`            : " + sinIp.length);
  console.log("\n  --- CALIDAD DEL DATO ---");
  console.log("  IPv4 COMPLETA (4 octetos) : " + completas.length + "   <- las unicas que pueden enlazar con MikroTik");
  console.log("  INCOMPLETA / fragmento    : " + parciales.length);

  const porOctetos = {};
  parciales.forEach(c => { const n = octetos(c.ip); porOctetos[n] = (porOctetos[n] || 0) + 1; });
  console.log("\n  Como son las incompletas:");
  Object.entries(porOctetos).sort().forEach(([n, v]) => console.log("    con " + n + " octeto(s): " + v));

  const rangos = {};
  completas.forEach(c => {
    const p = String(c.ip).trim().split(".");
    const r = p[0] + "." + p[1] + ".x.x";
    rangos[r] = (rangos[r] || 0) + 1;
  });
  console.log("\n  Rangos de las IP completas:");
  Object.entries(rangos).sort((a, b) => b[1] - a[1]).forEach(([r, v]) => console.log("    " + r.padEnd(12) + v));
  const lan = completas.filter(c => String(c.ip).trim().startsWith("192.168.")).length;
  console.log("  En rango LAN 192.168.x.x : " + lan + "   (el que usa MikroTik en la captura de WinBox)");

  console.log("\n  --- MUESTRA (ultimo octeto oculto) ---");
  conIp.slice(0, 12).forEach(c => {
    console.log("    " + mascara(c.ip).padEnd(18) + (esIPv4(c.ip) ? "completa" : "INCOMPLETA"));
  });

  // ── La otra via de enlace: el nombre de la queue ────────────────────────
  // En WinBox la queue se llama como el cliente CON la direccion pegada
  // ("JHON REYES CANTARES1 T3 APTO 103"), o sea el nombre sucio del Excel.
  // Al limpiar los nombres se guardo el anterior en `nombreOriginal`.
  const conOriginal = clientes.filter(c => c.nombreOriginal).length;
  const nombreTraeDireccion = clientes.filter(c => /(CANTARES|LIBERTAD|CASCADA|FLORES|MONTA|VENTO|MIRADOR|VELETAS|JARDINES|CASITAS|FRECITAS|APTO|B\d|T\d)/i.test(String(c.nombreCompleto || ""))).length;
  console.log("\n  --- LA OTRA VIA DE ENLACE: EL NOMBRE DE LA QUEUE ---");
  console.log("  Con `nombreOriginal` guardado (el nombre sucio del Excel) : " + conOriginal);
  console.log("  Nombres actuales que todavia traen direccion o bloque     : " + nombreTraeDireccion);

  console.log("\n  --- CONCLUSION ---");
  const pct = Math.round((completas.length / Math.max(1, conIp.length)) * 100);
  console.log("  Solo " + completas.length + " de " + conIp.length + " IP (" + pct + "%) son IPv4 completas.");
  console.log("  Enlazar por IP funciona para esas " + completas.length + "; las otras " + (conIp.length - completas.length) + " NO pueden enlazarse por IP.");

  /* ── HIPOTESIS: los fragmentos son los DOS ULTIMOS octetos de una IP
   * 192.168.x.x. En la captura de WinBox las IPs son 192.168.50.2,
   * 192.168.80.28 y 192.168.200.4, y el Excel trae "101.2", "90.35", "201.68"…
   * Si es asi, la IP real es "192.168." + fragmento y se puede reconstruir.
   * ──────────────────────────────────────────────────────────────────────── */
  const terceros = [...new Set(completas.filter(c => String(c.ip).startsWith("192.168."))
    .map(c => Number(String(c.ip).trim().split(".")[2])))].sort((a, b) => a - b);
  const primerosFragmento = [...new Set(parciales.filter(c => octetos(c.ip) === 2)
    .map(c => Number(String(c.ip).trim().split(".")[0])))].sort((a, b) => a - b);

  console.log("\n  --- HIPOTESIS: el fragmento son los 2 ultimos octetos de 192.168.x.x ---");
  console.log("  3er octeto de las IP COMPLETAS  : " + terceros.join(", "));
  console.log("  1er octeto de los 303 fragmentos: " + primerosFragmento.join(", "));
  const solapan = primerosFragmento.filter(n => n >= 40 && n <= 255).length;
  console.log("  Fragmentos con 1er octeto en rango LAN plausible (40-255): " + solapan + " de " + primerosFragmento.length + " valores distintos");
  // ¿Alguno de esos "fragmentos" reproduce el 3er+4to octeto de una IP completa
  // de OTRO cliente? Seria la prueba de que son el mismo tipo de dato.
  const colas = new Set(completas.filter(c => String(c.ip).startsWith("192.168."))
    .map(c => String(c.ip).trim().split(".").slice(2).join(".")));
  const coinciden = parciales.filter(c => colas.has(String(c.ip).trim())).length;
  console.log("  Fragmentos que coinciden con el 3er+4to octeto de una IP completa de otro cliente: " + coinciden);

  /* ── CUANTOS SIRVEN DE VERDAD ───────────────────────────────────────────── */
  const octetoOk = (o) => /^\d{1,3}$/.test(o) && Number(o) >= 0 && Number(o) <= 255;
  const reconstruibles = parciales.filter(c => {
    const p = String(c.ip).trim().split(".");
    return p.length === 2 && p.every(octetoOk);
  });
  const rotas = parciales.filter(c => !reconstruibles.includes(c));
  const aprovechables = completas.length + reconstruibles.length;
  const nombreCorto = (c) => String(c.nombreCompleto || "").split(" ").slice(0, 2).join(" ") || "(sin nombre)";

  console.log("\n  --- CUANTOS SIRVEN DE VERDAD ---");
  console.log("  IPv4 completas y validas               : " + completas.length);
  console.log("  Reconstruibles (192.168. + fragmento)  : " + reconstruibles.length);
  console.log("  TOTAL aprovechable                     : " + aprovechables + " de " + conIp.length +
    "  (" + Math.round((aprovechables / conIp.length) * 100) + "%)");
  console.log("  Sin arreglo posible (dato basura)      : " + rotas.length);
  rotas.forEach(c => console.log("     valor '" + String(c.ip).slice(0, 12) + "'  ->  " + nombreCorto(c) + " ..."));

  console.log("\n  OJO: reconstruir NO es adivinar. La prueba de que el fragmento es el");
  console.log("  final de una LAN 192.168.x.x es que los valores del 3er octeto de las");
  console.log("  IP completas y los del 1er octeto de los fragmentos son EL MISMO conjunto.");
  console.log("  Antes de escribir nada hay que cotejarlo con las queues REALES del");
  console.log("  router, que se volcaran en la Fase 4 (solo lectura).");
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
