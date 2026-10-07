/* Verificacion de la regla de cortes (solo lectura, no toca nada).
 *   node import/test-cortes.js
 */
"use strict";
const path = require("path");

const cjs = require("../functions/src/cortes");

function diasHasta(iso, hoy) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(hoy + "T00:00:00Z")) / 86400000);
}
function fmt(iso) {
  const [a, m, d] = iso.split("-");
  const dias = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  const dow = dias[new Date(iso + "T00:00:00Z").getUTCDay()];
  return `${d}/${m}/${a} (${dow})`;
}

(async () => {
  const esm = await import(path.resolve(__dirname, "../assets/js/admin/ui.js").replace(/\\/g, "/").replace("C:", "file:///C:"));

  console.log("=== 1) La copia del panel coincide con el modulo compartido? ===");
  let ok = true;
  for (const ciclo of ["15", "30"]) {
    for (const d of ["2026-01-31", "2026-02-28", "2026-06-15", "2026-12-31"]) {
      const a = cjs.proximoCorteDe(ciclo, d), b = esm.proximoCorteDe(ciclo, d);
      if (a !== b) { ok = false; console.log("  DESACUERDO ciclo " + ciclo + " " + d + ": cjs=" + a + " panel=" + b); }
    }
    if (cjs.diaCorteDeMes(ciclo) !== esm.diaCorteDeMes(ciclo)) { ok = false; console.log("  DESACUERDO diaCorteDeMes ciclo " + ciclo); }
  }
  console.log(ok ? "  OK: identicas (cortes y dia de corte)." : "  *** HAY DESACUERDOS ***");

  console.log("\n=== 2) Dia de corte por ciclo ===");
  console.log("  ciclo \"15\" (aviso el 15) -> corte el dia " + cjs.diaCorteDeMes("15"));
  console.log("  ciclo \"30\" (aviso el 30) -> corte el dia " + cjs.diaCorteDeMes("30"));

  console.log("\n=== 3) Proximo corte desde varias fechas ===");
  for (const d of ["2026-10-06", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-31", "2026-11-04", "2026-11-05", "2026-11-06"]) {
    console.log("  hoy " + d + "  ->  ciclo 15: " + cjs.proximoCorteDe("15", d) + "   |  ciclo 30: " + cjs.proximoCorteDe("30", d));
  }

  console.log("\n=== 4) Fechas REALES de aviso y corte (oct-dic 2026) ===");
  console.log("  El motor avisa cuando faltan 5 dias para el corte, y el mismo dia del corte.");
  for (const ciclo of ["15", "30"]) {
    const avisos = [], cortes = [];
    for (let t = Date.parse("2026-10-01T00:00:00Z"); t <= Date.parse("2026-12-31T00:00:00Z"); t += 86400000) {
      const hoy = new Date(t).toISOString().slice(0, 10);
      const pc = cjs.proximoCorteDe(ciclo, hoy);
      if (diasHasta(pc, hoy) === 5) avisos.push(hoy);
      if (diasHasta(pc, hoy) === 0) cortes.push(hoy);
    }
    console.log("  ciclo " + ciclo + ":");
    console.log("    avisos: " + avisos.map(fmt).join("  |  "));
    console.log("    cortes: " + cortes.map(fmt).join("  |  "));
  }

  console.log("\n=== 5) Cuantos avisos y cortes por ciclo (deben ser 1 por mes) ===");
  for (const ciclo of ["15", "30"]) {
    let a = 0, c = 0;
    for (let t = Date.parse("2026-01-01T00:00:00Z"); t <= Date.parse("2026-12-31T00:00:00Z"); t += 86400000) {
      const hoy = new Date(t).toISOString().slice(0, 10);
      const pc = cjs.proximoCorteDe(ciclo, hoy);
      if (diasHasta(pc, hoy) === 5) a++;
      if (diasHasta(pc, hoy) === 0) c++;
    }
    console.log("  ciclo " + ciclo + " en 2026 -> avisos: " + a + " (esperado 12)  |  cortes: " + c + " (esperado 12)");
  }
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
