/* ============================================================
 * UneFibra SAS — Admin: solicitudes (leads del formulario)
 * ------------------------------------------------------------
 * Lee la colección `solicitudes_contacto` (alta desde la landing),
 * con búsqueda, filtro por estado y acciones: contactar por
 * WhatsApp, marcar como atendida/reabrir y eliminar (SUPERADMIN).
 * Las reglas de Firestore ya permiten leer/actualizar a cualquier
 * rol y borrar solo a SUPERADMIN, así que no requiere Cloud Function.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { collection, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";

let ctx = null;
let solicitudes = [];
let filtro = "NUEVA";
let busqueda = "";

const FILTROS = [
  { key: "todas", label: "Todas" },
  { key: "NUEVA", label: "Nuevas" },
  { key: "ATENDIDA", label: "Atendidas" }
];

function badge(estado) {
  const map = {
    NUEVA: ["Nueva", "tone-green"],
    ATENDIDA: ["Atendida", "tone-violet"]
  };
  const [label, tone] = map[estado] || [estado || "—", ""];
  return `<span class="badge-estado ${tone}">${label}</span>`;
}

function fechaHora(v) {
  if (!v) return "—";
  const d = v && v.toDate ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "300 123 4567" -> "573001234567" para wa.me */
function waNumero(t) {
  const limpio = String(t || "").replace(/[^\d]/g, "");
  if (!limpio) return null;
  if (limpio.startsWith("57") && limpio.length >= 12) return limpio;
  if (limpio.length === 10) return "57" + limpio;
  return limpio;
}

/** Escapa HTML de los datos del usuario (evita inyección en el panel). */
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar__left">
        <div class="search"><input id="buscar" type="search" placeholder="Buscar por nombre, teléfono o barrio…" /></div>
        <div class="filters">${FILTROS.map((f) => `<button class="chip ${f.key === filtro ? "is-active" : ""}" data-filtro="${f.key}">${f.label}</button>`).join("")}</div>
      </div>
      <button class="btn btn--ghost" id="btn-refrescar">Actualizar</button>
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function filtrar() {
  let list = solicitudes.slice();

  if (filtro !== "todas") list = list.filter((s) => s.estado === filtro);

  if (busqueda) {
    const q = busqueda.toLowerCase();
    list = list.filter((s) =>
      (s.nombre || "").toLowerCase().includes(q) ||
      (s.telefono || "").toLowerCase().includes(q) ||
      (s.barrio || "").toLowerCase().includes(q)
    );
  }

  // Más recientes primero
  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return list;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  const list = filtrar();
  const totalNuevas = solicitudes.filter((s) => s.estado === "NUEVA").length;

  if (!list.length) {
    cont.innerHTML = `<div class="empty">No hay solicitudes en este filtro.${totalNuevas ? ` Hay <strong>${totalNuevas}</strong> nuevas sin atender.` : ""}</div>`;
    return;
  }

  const esSuper = ctx.rol === "SUPERADMIN";
  const rows = list.map((s) => {
    const wa = waNumero(s.telefono || s.whatsapp);
    const msg = `Hola ${s.nombre || ""}, te saludamos de UneFibra. Recibimos tu solicitud de Internet por fibra óptica${s.barrio ? ` (${s.barrio})` : ""}. ¿En qué te podemos ayudar?`;
    const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : "#";

    const acciones = `
      ${wa ? `<a class="btn btn--sm btn--whatsapp" href="${waHref}" target="_blank" rel="noopener" data-act="wa">WhatsApp</a>` : ""}
      <button class="btn btn--sm ${s.estado === "NUEVA" ? "btn--primary" : "btn--ghost"}" data-act="toggle" data-id="${s.id}" data-estado="${s.estado}">${s.estado === "NUEVA" ? "Atender" : "Reabrir"}</button>
      ${esSuper ? `<button class="btn btn--sm btn--ghost" data-act="borrar" data-id="${s.id}">Eliminar</button>` : ""}
    `;

    return `
      <tr data-id="${esc(s.id)}">
        <td class="muted">${fechaHora(s.createdAt)}</td>
        <td>${esc(s.nombre || "—")}</td>
        <td>${esc(s.telefono || "—")}${s.whatsapp && s.whatsapp !== s.telefono ? `<div class="muted">${esc(s.whatsapp)}</div>` : ""}</td>
        <td>${esc(s.barrio || "—")}</td>
        <td>${esc(s.planInteres || "—")}</td>
        <td>${badge(s.estado)}</td>
        <td><div class="actions">${acciones}</div></td>
      </tr>`;
  }).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Recibida</th><th>Nombre</th><th>Teléfono</th><th>Barrio</th><th>Plan</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  bindFilas(cont);
}

function bindFilas(cont) {
  cont.querySelectorAll("tbody tr").forEach((tr) => {
    // El clic en una fila abre el detalle; en los botones no.
    tr.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", (e) => e.stopPropagation()));
    tr.addEventListener("click", () => abrirDetalle(tr.dataset.id));
  });
}

async function abrirDetalle(id) {
  const s = solicitudes.find((x) => x.id === id);
  if (!s) return;
  const root = document.getElementById("modal-root");
  const wa = waNumero(s.telefono || s.whatsapp);

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${esc(s.nombre || "Solicitud")}</h2>
        <div class="kv">
          <div class="kv__item"><span class="kv__k">Estado</span><span class="kv__v">${badge(s.estado)}</span></div>
          <div class="kv__item"><span class="kv__k">Recibida</span><span class="kv__v">${fechaHora(s.createdAt)}</span></div>
          <div class="kv__item"><span class="kv__k">Teléfono</span><span class="kv__v">${esc(s.telefono || "—")}</span></div>
          ${s.whatsapp && s.whatsapp !== s.telefono ? `<div class="kv__item"><span class="kv__k">WhatsApp</span><span class="kv__v">${esc(s.whatsapp)}</span></div>` : ""}
          <div class="kv__item"><span class="kv__k">Barrio</span><span class="kv__v">${esc(s.barrio || "—")}</span></div>
          <div class="kv__item"><span class="kv__k">Ciudad</span><span class="kv__v">${esc(s.ciudad || "—")}</span></div>
          <div class="kv__item"><span class="kv__k">Dirección</span><span class="kv__v">${esc(s.direccion || "—")}</span></div>
          <div class="kv__item"><span class="kv__k">Plan de interés</span><span class="kv__v">${esc(s.planInteres || "—")}</span></div>
          <div class="kv__item"><span class="kv__k">Observaciones</span><span class="kv__v">${esc(s.observaciones || "—")}</span></div>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="det-cerrar">Cerrar</button>
          ${wa ? `<a class="btn btn--whatsapp" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          <button type="button" class="btn btn--primary" id="det-toggle">${s.estado === "NUEVA" ? "Marcar atendida" : "Reabrir"}</button>
        </div>
      </div>
    </div>`;

  root.querySelector("#det-cerrar").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) root.innerHTML = ""; });
  root.querySelector("#det-toggle").addEventListener("click", async () => {
    const nuevo = s.estado === "NUEVA" ? "ATENDIDA" : "NUEVA";
    await cambiarEstado(id, nuevo);
    root.innerHTML = "";
  });
}

async function cambiarEstado(id, nuevo) {
  try {
    await updateDoc(doc(db, "solicitudes_contacto", id), {
      estado: nuevo,
      atendidoPor: ctx.nombre || ctx.email,
      atendidoEn: new Date().toISOString()
    });
    const s = solicitudes.find((x) => x.id === id);
    if (s) { s.estado = nuevo; s.atendidoPor = ctx.nombre; s.atendidoEn = new Date().toISOString(); }
    renderTabla();
  } catch (err) {
    console.error(err);
    alert("No fue posible actualizar la solicitud.");
  }
}

async function eliminar(id) {
  if (!confirm("¿Eliminar esta solicitud? Esta acción no se puede deshacer.")) return;
  try {
    await deleteDoc(doc(db, "solicitudes_contacto", id));
    solicitudes = solicitudes.filter((x) => x.id !== id);
    renderTabla();
  } catch (err) {
    console.error(err);
    alert("No fue posible eliminar la solicitud.");
  }
}

async function cargarSolicitudes() {
  const snap = await getDocs(collection(db, "solicitudes_contacto"));
  solicitudes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTabla();
}

function bind() {
  const input = document.getElementById("buscar");
  if (input) input.addEventListener("input", () => { busqueda = input.value.trim(); renderTabla(); });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filtro;
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c.dataset.filtro === filtro));
      renderTabla();
    });
  });

  const refresh = document.getElementById("btn-refrescar");
  if (refresh) refresh.addEventListener("click", () => cargarSolicitudes());

  // Acciones delegadas (los botones de la tabla se re-renderizan)
  const tabla = document.getElementById("tabla");
  tabla.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    e.stopPropagation();
    const { act, id } = btn.dataset;
    if (act === "toggle") {
      const s = solicitudes.find((x) => x.id === id);
      cambiarEstado(id, s && s.estado === "NUEVA" ? "ATENDIDA" : "NUEVA");
    } else if (act === "borrar") {
      eliminar(id);
    }
    // "wa" es un enlace: navega solo, sin más acción.
  });
}

(async function main() {
  ctx = await requireAuth("solicitudes");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();
  bind();

  try {
    await cargarSolicitudes();
  } catch (err) {
    console.error(err);
    const tabla = document.getElementById("tabla");
    if (tabla) tabla.innerHTML = '<div class="empty">No fue posible cargar las solicitudes. Verifica tu conexión y permisos.</div>';
  }
})();
