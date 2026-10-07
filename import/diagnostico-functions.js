/* Diagnostico de las Cloud Functions desplegadas (SOLO LECTURA).
 *   node import/diagnostico-functions.js
 */
"use strict";
const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const UBICACION = "us-central1";

(async () => {
  const tok = await tokenAcceso();
  const url = `https://cloudfunctions.googleapis.com/v1/projects/${PROYECTO}/locations/${UBICACION}/functions`;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
  if (!res.ok) throw new Error("cloudfunctions -> " + res.status + ": " + (await res.text()).slice(0, 300));
  const d = await res.json();

  const funcs = (d.functions || []).map(f => ({
    nombre: f.name.split("/").pop(),
    estado: f.status,
    actualizado: (f.updateTime || "").slice(0, 19).replace("T", " "),
    runtime: f.runtime,
    schedule: f.labels && f.labels["deployment-scheduled"] ? "scheduled" : "",
    secretos: (f.secretEnvironmentVariables || []).map(s => s.key + "@" + s.version)
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));

  console.log("Funciones desplegadas: " + funcs.length);
  console.log("\n" + "FUNCION".padEnd(24) + "ESTADO".padEnd(10) + "ACTUALIZADO".padEnd(22) + "SECRETOS");
  funcs.forEach(f => console.log("  " + f.nombre.padEnd(22) + String(f.estado).padEnd(10) + f.actualizado.padEnd(22) + f.secretos.join(", ")));

  const pd = funcs.find(f => f.nombre === "processDueDates");
  console.log("\n=== processDueDates (el motor de vencimientos) ===");
  if (pd) {
    console.log("  ultima actualizacion : " + pd.actualizado);
    console.log("  estado               : " + pd.estado);
    console.log("  secretos que espera  : " + (pd.secretos.length ? pd.secretos.join(", ") : "(ninguno)"));
  } else {
    console.log("  *** NO ESTA DESPLEGADA ***");
  }
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
