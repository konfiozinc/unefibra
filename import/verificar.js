/* ============================================================
 * UneFibra SAS — Verificación READ-ONLY de la coleccion `clientes`
 * ------------------------------------------------------------
 * Solo LEE. No escribe, no modifica, no borra nada.
 *
 *   node import/verificar.js
 *
 * Reporta total de documentos y agregados (ciclo, plan, precio,
 * conjunto a verificar, telefonos distintos). No imprime PII.
 * ============================================================ */
"use strict";

const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

function val(campo) {
  if (!campo) return null;
  const k = Object.keys(campo)[0];
  const v = campo[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}

(async () => {
  const tok = await tokenAcceso();
  const docs = [];
  let pageToken = "";
  let vueltas = 0;

  do {
    const url = `${BASE}/clientes?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) throw new Error("Firestore " + res.status + ": " + (await res.text()).slice(0, 300));
    const d = await res.json();
    (d.documents || []).forEach(doc => {
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
      docs.push(f);
    });
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);

  console.log("========================================================");
  console.log("VERIFICACION (solo lectura) — coleccion clientes");
  console.log("========================================================");
  console.log("  Documentos en Firestore          : " + docs.length);

  const porCiclo = new Map();
  docs.forEach(c => porCiclo.set(c.cicloCorte || "(sin ciclo)", (porCiclo.get(c.cicloCorte || "(sin ciclo)") || 0) + 1));
  console.log("\n  Por ciclo de corte:");
  [...porCiclo.entries()].sort().forEach(([k, v]) => console.log("    ciclo " + k + " : " + v));

  const porEstado = new Map();
  docs.forEach(c => porEstado.set(c.estadoCliente || "(sin estado)", (porEstado.get(c.estadoCliente || "(sin estado)") || 0) + 1));
  console.log("\n  Por estadoCliente:");
  [...porEstado.entries()].sort().forEach(([k, v]) => console.log("    " + k + " : " + v));

  const tels = new Set(docs.map(c => c.telefono).filter(Boolean));
  const sinDir = docs.filter(c => !c.direccion).length;
  const sinPlan = docs.filter(c => !c.planId).length;
  const sinPrecio = docs.filter(c => c.precioMensual === null || c.precioMensual === undefined).length;
  const sinConjunto = docs.filter(c => !c.edificioUnidad).length;
  const aVerificar = docs.filter(c => (c.observaciones || "").includes("Conjunto a verificar")).length;
  const sinBarrio = docs.filter(c => !c.barrio).length;
  const conTorre = docs.filter(c => c.torre).length;
  const conApto = docs.filter(c => c.apartamento).length;

  console.log("\n  Telefonos distintos              : " + tels.size);
  console.log("  Sin direccion                    : " + sinDir);
  console.log("  Sin planId (null)                : " + sinPlan);
  console.log("  Sin precioMensual (null)         : " + sinPrecio);
  console.log("  Sin edificioUnidad               : " + sinConjunto);
  console.log("  Con 'Conjunto a verificar'       : " + aVerificar);
  console.log("  Sin barrio                       : " + sinBarrio + "   (esperado: todos)");
  console.log("  Con torre                        : " + conTorre);
  console.log("  Con apartamento                  : " + conApto);

  const sinCampos = docs.filter(c => !c.nombreCompleto || !c.telefono || !c.direccion);
  console.log("  Docs incompletos (nombre/tel/dir): " + sinCampos.length);

  // Un mismo telefono puede tener 2 servicios en ciclos distintos -> 2 documentos.
  const porTel = new Map();
  docs.forEach(c => { if (c.telefono) porTel.set(c.telefono, (porTel.get(c.telefono) || 0) + 1); });
  const repes = [...porTel.entries()].filter(([, n]) => n > 1);
  console.log("\n  Telefonos distintos              : " + porTel.size);
  console.log("  Telefonos con 2 servicios        : " + repes.length + "   (esperado: 7)");
  repes.forEach(([t, n]) => console.log("    " + String(t).slice(0, 3) + "***" + String(t).slice(-2) + " -> " + n + " documentos"));

  console.log("\n  proximoCorte distintos: " + [...new Set(docs.map(c => c.proximoCorte))].sort().join(" | "));

  // Presencia de los campos que el panel necesita mostrar.
  const CAMPOS = ["nombreCompleto", "telefono", "direccion", "ip", "origen", "planId", "planNombre", "precioMensual",
    "cicloCorte", "proximoCorte", "fechaInicioServicio", "fechaVencimiento", "tipoVivienda",
    "edificioUnidad", "torre", "apartamento", "estadoCliente", "estadoServicio"];
  console.log("\n  Presencia de campos (sobre " + docs.length + "):");
  CAMPOS.forEach(k => {
    const n = docs.filter(c => c[k] !== null && c[k] !== undefined && String(c[k]).trim() !== "").length;
    console.log("    " + k.padEnd(20) + String(n).padStart(4) + (n === docs.length ? "  (todos)" : "   faltan " + (docs.length - n)));
  });

  // Un cliente de prueba, anonimizado: el que tenga los 16 campos completos.
  const completo = docs.find(c => CAMPOS.every(k => c[k] !== null && c[k] !== undefined && String(c[k]).trim() !== ""));
  if (completo) {
    console.log("\n  CLIENTE DE PRUEBA (anonimizado):");
    const mask = (s) => String(s).replace(/\d/g, "X").slice(0, 28);
    console.log("    nombre            : " + String(completo.nombreCompleto).slice(0, 1) + ".");
    console.log("    telefono          : " + String(completo.telefono).slice(0, 3) + "XXXXXXX");
    console.log("    direccion         : " + mask(completo.direccion));
    console.log("    plan              : " + completo.planNombre + "  (" + String(completo.planId).slice(0, 6) + "...)");
    console.log("    precioMensual     : " + completo.precioMensual);
    console.log("    cicloCorte        : " + completo.cicloCorte);
    console.log("    proximoCorte      : " + completo.proximoCorte);
    console.log("    tipoVivienda      : " + completo.tipoVivienda);
    console.log("    edificioUnidad    : " + completo.edificioUnidad);
    console.log("    torre/apartamento : " + completo.torre + " / " + completo.apartamento);
    console.log("    estadoCliente     : " + completo.estadoCliente + " | estadoServicio " + completo.estadoServicio);
  }

  console.log("  ========================================================");
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
