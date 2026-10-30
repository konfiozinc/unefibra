'use strict';
/* Reconocimiento de producción — SOLO LECTURA, solo agregados.
   No imprime nombres, teléfonos, direcciones ni documentos completos. */
const { tokenAcceso } = require("../tools/lib/google-auth");
const P = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;

async function token() { return tokenAcceso(); }

async function contar(t, coleccion, filtros = {}) {
  const donde = Object.entries(filtros).map(([campo, valor]) => ({
    fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: { stringValue: String(valor) } }
  }));
  const consulta = { from: [{ collectionId: coleccion }], limit: 5000 };
  if (donde.length === 1) consulta.where = donde[0];
  else if (donde.length > 1) consulta.where = { compositeFilter: { op: "AND", filters: donde } };
  const r = await fetch(`${BASE}:runQuery`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
    body: JSON.stringify({ structuredQuery: consulta })
  });
  if (!r.ok) return { error: r.status, texto: (await r.text()).slice(0, 200) };
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  return { total: arr.filter((x) => x && x.document).length };
}

(async () => {
  const t = await token();
  console.log("=== Producción: une-fibra (solo agregados) ===\n");
  for (const [etiqueta, col, filtros] of [
    ["servicios (todos)", "servicios", {}],
    ["servicios en PENDIENTE_VALIDACION", "servicios", { "conciliacion.estado": "PENDIENTE_VALIDACION" }],
    ["servicios PUBLICADO/activos", "servicios", { estado: "ACTIVO" }],
    ["clientes", "clientes", {}],
    ["pagos", "pagos", {}],
    ["pagos CONFIRMADOS", "pagos", { estado: "CONFIRMADO" }],
    ["notificaciones", "notificaciones", {}],
    ["usuarios", "usuarios", {}]
  ]) {
    const r = await contar(t, col, filtros);
    console.log("  " + etiqueta.padEnd(38) + (r.error ? "ERROR " + r.error + " " + r.texto : r.total + " documentos"));
  }

  console.log("\n=== Colecciones raíz que existen ===");
  const r = await fetch(`${BASE}:listCollectionIds`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
    body: JSON.stringify({ pageSize: 100 })
  });
  if (r.ok) {
    const j = await r.json();
    console.log("  " + (j.collectionIds || []).join(", "));
  } else {
    console.log("  no se pudo listar (" + r.status + ")");
  }
})().catch((e) => { console.error("ERROR: " + e.message); process.exit(1); });
