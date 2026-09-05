/* ============================================================
 * UNEFIBRAS SAS — Admin: notificaciones
 * ------------------------------------------------------------
 * Lista el registro de notificaciones (colección `notificaciones`)
 * y permite enviar una notificación push manual vía Cloud Function.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs } from "firebase/firestore";
import { msgError } from "../assets/js/admin/ui.js";

let ctx = null;
let notificaciones = [];
let clientes = [];
let filtro = "todos";

const ESTADOS = [
  { key: "todos", label: "Todas" },
  { key: "PENDIENTE", label: "Pendientes" },
  { key: "ENVIADA", label: "Enviadas" },
  { key: "ERROR", label: "Con error" },
  { key: "CANCELADA", label: "Canceladas" }
];

function badgeNotif(e) {
  const map = {
    PENDIENTE: ["Pendiente", "tone-amber"],
    ENVIADA: ["Enviada", "tone-green"],
    ERROR: ["Error", "tone-red"],
    CANCELADA: ["Cancelada", "tone-violet"]
  };
  const [l, t] = map[e] || [e || "—", ""];
  return `<span class="badge-estado ${t}">${l}</span>`;
}

function clienteNombre(id) {
  const c = clientes.find((x) => x.id === id);
  return c ? c.nombreCompleto : id;
}

function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderToolbar() {
  const canSend = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <div class="filters">${ESTADOS.map((e) => `<button class="chip ${e.key === filtro ? "is-active" : ""}" data-filtro="${e.key}">${e.label}</button>`).join("")}</div>
      ${canSend ? '<button class="btn btn--primary" id="btn-enviar">Enviar notificación</button>' : ""}
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  let list = notificaciones.slice();
  if (filtro !== "todos") list = list.filter((n) => n.estado === filtro);
  list.sort((a, b) => {
    const ta = a.fechaProgramada && a.fechaProgramada.toDate ? a.fechaProgramada.toDate().getTime() : 0;
    const tb = b.fechaProgramada && b.fechaProgramada.toDate ? b.fechaProgramada.toDate().getTime() : 0;
    return tb - ta;
  });

  if (!list.length) {
    cont.innerHTML = '<div class="empty">No hay notificaciones en este filtro.</div>';
    return;
  }

  const rows = list.map((n) => `
    <tr>
      <td>${fmtTs(n.fechaProgramada)}</td>
      <td>${clienteNombre(n.clienteId)}</td>
      <td>${n.tipo || "—"}</td>
      <td class="muted">${(n.mensaje || "").slice(0, 80)}${(n.mensaje || "").length > 80 ? "…" : ""}</td>
      <td>${n.canal || "—"}</td>
      <td>${badgeNotif(n.estado)}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Mensaje</th><th>Canal</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function abrirModal() {
  const root = document.getElementById("modal-root");
  const op = clientes.map((c) => `<option value="${c.id}">${c.nombreCompleto}</option>`).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>Enviar notificación</h2>
        <div class="form-grid">
          <label class="field"><span>Cliente *</span><select name="clienteId" required>${op || '<option value="">Sin clientes</option>'}</select></label>
          <label class="field"><span>Título</span><input name="titulo" value="UneFibra" /></label>
          <label class="field"><span>Mensaje *</span><textarea name="mensaje" rows="3" required></textarea></label>
        </div>
        <p class="muted" style="font-size:0.82rem;">Se envía como push a los tokens registrados del cliente (requiere autorización previa del cliente).</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btn-guardar">Enviar</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </form>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) root.innerHTML = "";
  });
  root.querySelector("#modal-form").addEventListener("submit", enviar);
}

async function enviar(ev) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const d = Object.fromEntries(new FormData(ev.target).entries());

  if (!d.clienteId || !d.mensaje) {
    msg.textContent = "Cliente y mensaje son obligatorios.";
    msg.className = "modal__msg err";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Enviando…";
  msg.className = "modal__msg";
  msg.textContent = "";

  try {
    const res = await call("enviarNotificacion")({ clienteId: d.clienteId, titulo: d.titulo, mensaje: d.mensaje });
    const r = res.data || {};
    document.getElementById("modal-root").innerHTML = "";
    await cargar();
    alert(`Notificación procesada. Enviados: ${r.enviados ?? 0} de ${r.total ?? 0} tokens.`);
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Enviar";
  }
}

async function cargar() {
  const [notifSnap, cliSnap] = await Promise.all([
    getDocs(collection(db, "notificaciones")),
    getDocs(collection(db, "clientes"))
  ]);
  notificaciones = notifSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  clientes = cliSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTabla();
}

function bind() {
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    filtro = c.dataset.filtro;
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("is-active", x.dataset.filtro === filtro));
    renderTabla();
  }));
  const btn = document.getElementById("btn-enviar");
  if (btn) btn.addEventListener("click", abrirModal);
}

(async function main() {
  ctx = await requireAuth("notificaciones");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();
  bind();

  try {
    await cargar();
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar las notificaciones.</div>';
  }
})();
