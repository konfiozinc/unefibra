/* Lee la coleccion `configuracion` y los planes (SOLO LECTURA).
 *   node import/verificar-config.js
 */
"use strict";
const { tokenAcceso } = require("../tools/lib/google-auth");
const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "doubleValue") return Number(v);
  if (k === "booleanValue") return v;
  if (k === "arrayValue") return (v.values || []).map(val);
  return v;
}

(async () => {
  const tok = await tokenAcceso();
  const res = await fetch(BASE + "/configuracion", { headers: { Authorization: "Bearer " + tok } });
  if (!res.ok) throw new Error("configuracion -> " + res.status);
  const d = await res.json();
  console.log("=== configuracion ===");
  (d.documents || []).forEach(doc => {
    const f = {};
    for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
    console.log("  " + doc.name.split("/").pop() + " : " + JSON.stringify(f.valor !== undefined ? f.valor : f));
  });

  const rp = await fetch(BASE + "/planes?pageSize=50", { headers: { Authorization: "Bearer " + tok } });
  const dp = await rp.json();
  console.log("\n=== planes (" + (dp.documents || []).length + ") ===");
  (dp.documents || []).forEach(doc => {
    const f = {};
    for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
    console.log("  " + String(f.velocidad || "?").padEnd(10) + " " + String(f.nombre || "").padEnd(22) + " precio " + f.precio + "  " + (f.estado || ""));
  });

  // Usuarios del panel: el rol decide que botones se ven (OPERADOR no puede
  // editar ni eliminar). Se muestra el correo enmascarado.
  const ru = await fetch(BASE + "/usuarios?pageSize=50", { headers: { Authorization: "Bearer " + tok } });
  const du = await ru.json();
  const usuarios = (du.documents || []).map(doc => {
    const f = {};
    for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
    return f;
  });
  console.log("\n=== usuarios del panel (" + usuarios.length + ") ===");
  usuarios.forEach(f => {
    const correo = String(f.email || f.correo || "?");
    const partes = correo.split("@");
    const mascarado = partes[0].slice(0, 2) + "***@" + (partes[1] || "?");
    console.log("  " + String(f.rol || "?").padEnd(11) + " activo=" + String(f.activo) + "  " + mascarado + "  " + String(f.nombre || ""));
  });
  const roles = {};
  usuarios.forEach(f => { roles[f.rol] = (roles[f.rol] || 0) + 1; });
  console.log("  reparto de roles: " + JSON.stringify(roles));
  console.log("  NOTA: los roles ADMIN/SUPERADMIN ven Editar y Eliminar; OPERADOR no.");
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
