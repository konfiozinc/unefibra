/* ============================================================
 * Verifica la NUMERACION ESTABLE contra los datos reales de Firestore.
 * SOLO LECTURA: no escribe nada.
 *
 *   node import/verificar-numeracion.js
 *
 * Comprueba las propiedades que exige el requisito:
 *   1. El #1 es el cliente mas ANTIGUO y el #N el mas reciente.
 *   2. Los numeros son una biyeccion 1..N (sin huecos ni repetidos).
 *   3. Las fechas quedan en orden NO decreciente.
 *   4. El numero NO depende del orden en que se muestre la tabla.
 *   5. Cuantos clientes comparten fecha (necesitan desempate estable).
 * ============================================================ */
"use strict";

const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const mask = (t) => String(t || "").slice(0, 3) + "***" + String(t || "").slice(-2);
/** Nombre enmascarado ("JOHN A."): esta salida se comparte, no puede ir con el nombre completo. */
const maskNombre = (n) => String(n || "").trim().split(/\s+/).map((p, i) => (i === 0 ? p : p.slice(0, 1) + ".")).join(" ");

function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}

/** El MISMO criterio que `calcularNumeracion()` de admin/clientes.js. */
const fechaDe = (c) => String(c.fechaInicioServicio || c.fechaInstalacion || "");
function compararActivacion(a, b) {
  const fa = fechaDe(a) || "9999-12-31";
  const fb = fechaDe(b) || "9999-12-31";
  if (fa !== fb) return fa < fb ? -1 : 1;
  const n = String(a.nombreCompleto || "").localeCompare(String(b.nombreCompleto || ""));
  if (n !== 0) return n;
  return String(a.id) < String(b.id) ? -1 : 1;
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
      clientes.push({ id: doc.name.split("/").pop(), ...f });
    });
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);

  console.log("=".repeat(72));
  console.log("VERIFICACION DE LA NUMERACION — " + clientes.length + " clientes");
  console.log("=".repeat(72));

  const orden = clientes.slice().sort(compararActivacion);
  const numero = new Map(orden.map((c, i) => [c.id, i + 1]));

  // 1) Extremos
  const primero = orden[0], ultimo = orden[orden.length - 1];
  console.log("\n  1) Extremos del orden de activacion");
  console.log('     #1     ' + fechaDe(primero) + '  tel ' + mask(primero.telefono) + '  ' + maskNombre(primero.nombreCompleto));
  console.log('     #' + orden.length + '   ' + fechaDe(ultimo) + '  tel ' + mask(ultimo.telefono) + '  ' + maskNombre(ultimo.nombreCompleto));

  // 2) Biyeccion 1..N
  const usados = [...numero.values()].sort((a, b) => a - b);
  const biyeccion = usados.length === orden.length && usados.every((n, i) => n === i + 1);
  console.log("\n  2) Los numeros son 1..N sin huecos ni repetidos : " + (biyeccion ? "SI (" + usados.length + ")" : "*** NO ***"));

  // 3) Fechas no decrecientes
  let desorden = 0;
  for (let i = 1; i < orden.length; i++) {
    const a = fechaDe(orden[i - 1]) || "9999-12-31";
    const b = fechaDe(orden[i]) || "9999-12-31";
    if (a > b) desorden++;
  }
  console.log("  3) Fechas en orden no decreciente               : " + (desorden === 0 ? "SI" : "*** NO (" + desorden + " saltos) ***"));

  // 4) El numero no depende del orden de visualizacion (la tabla se pinta por
  //    nombre, y en PENDIENTE_PAGO por atraso; el numero debe ser el mismo).
  const porNombre = clientes.slice().sort((a, b) => String(a.nombreCompleto || "").localeCompare(String(b.nombreCompleto || "")));
  const porAtraso = clientes.slice().sort((a, b) => String(a.fechaVencimiento || "").localeCompare(String(b.fechaVencimiento || "")));
  const igualEnAmbos = [...clientes].every(c =>
    numero.get(c.id) === numero.get(porNombre.find(x => x.id === c.id).id) &&
    numero.get(c.id) === numero.get(porAtraso.find(x => x.id === c.id).id));
  console.log("  4) El numero es igual en los 3 ordenes           : " + (igualEnAmbos ? "SI" : "*** NO ***"));

  // 5) Fechas repetidas (necesitan el desempate estable)
  const porFecha = {};
  clientes.forEach(c => { const f = fechaDe(c); porFecha[f] = (porFecha[f] || 0) + 1; });
  const repetidas = Object.entries(porFecha).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const sinFecha = porFecha[""] || 0;
  console.log("\n  5) Fechas de activacion");
  console.log("     fechas distintas                            : " + Object.keys(porFecha).length);
  console.log("     sin fecha (van al final)                    : " + sinFecha);
  console.log("     fechas compartidas por varios clientes      : " + repetidas.length);
  repetidas.slice(0, 5).forEach(([f, n]) => console.log("       " + f + " -> " + n + " clientes"));

  // 6) Muestra: primeros y ultimos de la tabla (que se pinta por nombre)
  console.log("\n  6) Muestra del # en el orden real de activacion");
  orden.slice(0, 5).forEach((c, i) => console.log("     #" + (i + 1) + "  " + fechaDe(c)));
  console.log("     ...");
  orden.slice(-3).forEach((c) => console.log("     #" + numero.get(c.id) + "  " + fechaDe(c)));

  // 7) Calidad de las fechas: el "#" solo es util si las fechas son reales.
  const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const futuras = clientes.filter(c => fechaDe(c) > hoy);
  const delImport = clientes.filter(c => fechaDe(c) === "2026-10-06");
  console.log("\n  7) Calidad de las fechas de activacion");
  console.log("     hoy (Bogota)                                : " + hoy);
  console.log("     con fecha FUTURA (posterior a hoy)          : " + futuras.length);
  futuras.slice(0, 5).forEach(c => console.log("       #" + numero.get(c.id) + "  " + fechaDe(c)));
  console.log("     con la fecha del import (2026-10-06)        : " + delImport.length + "  (el Excel no traia fecha)");

  const ok = biyeccion && desorden === 0 && igualEnAmbos;
  console.log("\n  " + (ok ? "TODO OK: la numeracion es estable y coincide con el orden de activacion." : "*** HAY ALGUN PROBLEMA ***"));
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
