/* Muestra registros completos (sin telefono) para comparar nombre vs direccion.
 * SOLO LECTURA.  node import/inspeccionar-nombres.js
 */
"use strict";
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

(async () => {
  const tok = await tokenAcceso();
  const docs = [];
  let pageToken = "", vueltas = 0;
  do {
    const url = `${BASE}/clientes?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    const d = await res.json();
    (d.documents || []).forEach(doc => {
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
      docs.push(f);
    });
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);

  const CAMPOS = ["nombreCompleto", "direccion", "edificioUnidad", "torre", "apartamento", "tipoVivienda", "ip", "observaciones"];
  const conNumero = docs.filter(d => /\d/.test(String(d.nombreCompleto || "")));

  console.log("Clientes: " + docs.length + " | con algun digito en el nombre: " + conNumero.length);
  console.log("\n=== 8 registros con digito en el nombre ===");
  conNumero.slice(0, 8).forEach((d, i) => {
    console.log("\n--- " + (i + 1) + ") ---");
    CAMPOS.forEach(c => console.log("  " + c.padEnd(17) + ": " + String(d[c] === undefined ? "(no existe)" : d[c])));
  });

  // Cuantos nombres CONTIENEN la direccion como sufijo (redundancia demostrable)
  console.log("\n=== ¿el nombre termina con la direccion? ===");
  let contiene = 0, noContiene = 0;
  const ejemplos = [];
  docs.forEach(d => {
    const n = String(d.nombreCompleto || "").trim();
    const dir = String(d.direccion || "").trim();
    if (!dir || n === dir) return;
    if (n.toLowerCase().endsWith(dir.toLowerCase())) {
      contiene++;
      if (ejemplos.length < 5) ejemplos.push([n, dir]);
    } else noContiene++;
  });
  console.log("  nombres que TERMINAN con la direccion : " + contiene);
  console.log("  nombres con direccion pero no al final: " + noContiene);
  ejemplos.forEach(([n, dir]) => console.log('    "' + n + '"\n      termina con direccion "' + dir + '"'));
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
