/* ============================================================
 * UneFibra SAS — Admin: historial de cambios (SUPERADMIN)
 * ------------------------------------------------------------
 * Registro inmutable de operaciones importantes (colección
 * `auditoria`), con búsqueda por acción, entidad o usuario.
 *
 * KZ-UNEF-028 · Este módulo era el único del panel que interpolaba datos de
 * Firestore sin escapar (`usuarioNombre`, `accion`, `entidad`, `entidadId`).
 * `usuarioNombre` lo escribe un operador desde el alta de usuarios, así que un
 * nombre con HTML se ejecutaba en el navegador de quien abriera el historial.
 * Ahora todo pasa por esc().
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { collection, getDocs } from "firebase/firestore";
import { esc } from "../assets/js/admin/ui.js";

let registros = [];
let busqueda = "";

function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="search"><input id="buscar" type="search" placeholder="Buscar por acción, entidad o usuario…" /></div>
    </div>
    <div class="table-wrap" id="tabla"></div>`;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  let list = registros.slice();
  if (busqueda) {
    const q = busqueda.toLowerCase();
    list = list.filter((r) =>
      (r.accion || "").toLowerCase().includes(q) ||
      (r.entidad || "").toLowerCase().includes(q) ||
      (r.usuarioNombre || "").toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    const ta = a.fecha && a.fecha.toDate ? a.fecha.toDate().getTime() : 0;
    const tb = b.fecha && b.fecha.toDate ? b.fecha.toDate().getTime() : 0;
    return tb - ta;
  });

  if (!list.length) {
    cont.innerHTML = '<div class="empty">Sin registros de auditoría.</div>';
    return;
  }

  const rows = list.slice(0, 200).map((r) => `
    <tr>
      <td>${esc(fmtTs(r.fecha))}</td>
      <td>${esc(r.usuarioNombre || r.usuarioId || "sistema")}</td>
      <td>${esc(r.accion || "—")}</td>
      <td>${esc(r.entidad || "—")}${r.entidadId ? " #" + esc(r.entidadId) : ""}</td>
    </tr>`).join("");

  const recortado = list.length > 200
    ? `<p class="muted" style="font-size:0.82rem;margin-top:10px;">Se muestran los 200 cambios más recientes de ${list.length} cargados. Usa la búsqueda para encontrar uno concreto.</p>`
    : "";

  cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${recortado}`;
}

(async function main() {
  const ctx = await requireAuth("auditoria");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();

  const input = document.getElementById("buscar");
  input.addEventListener("input", () => { busqueda = input.value.trim(); renderTabla(); });

  try {
    const snap = await getDocs(collection(db, "auditoria"));
    registros = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTabla();
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar la auditoría.</div>';
  }
})();
