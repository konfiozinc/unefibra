/* ============================================================
 * UneFibra SAS — Admin: Recordatorios de pago
 * ------------------------------------------------------------
 * KZ-UNEF-028 · Esta pantalla habla como el propietario, no como la base de
 * datos: cada aviso se muestra con su nombre comercial («3 días antes del
 * corte» / «Día del corte») y su estado en tres palabras: Pendiente, Enviado o
 * Fallido. El nombre técnico del estado y el tipo interno quedan en el detalle.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs } from "firebase/firestore";
import { msgError, esc, palabraEstadoAviso, etiquetaTipoAviso } from "../assets/js/admin/ui.js";

let ctx = null;
let notificaciones = [];
let clientes = [];
let filtro = "todos";

/* Los filtros usan las mismas palabras que ve el propietario. */
const ESTADOS = [
  { key: "todos", label: "Todos" },
  { key: "PENDIENTE", label: "Pendientes" },
  { key: "ENVIADA", label: "Enviados" },
  { key: "ERROR", label: "Fallidos" },
  { key: "CANCELADA", label: "Cancelados" }
];

const TONO = {
  PENDIENTE: "tone-amber",
  ENVIADA: "tone-green",
  ERROR: "tone-red",
  CANCELADA: "tone-violet"
};

function badgeNotif(e) {
  return `<span class="badge-estado ${esc(TONO[e] || "")}">${esc(palabraEstadoAviso(e))}</span>`;
}

function clienteNombre(id) {
  const c = clientes.find((x) => x.id === id);
  return esc(c ? c.nombreCompleto : id);
}

function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderToolbar() {
  const canSend = ["ADMIN", "SUPERADMIN"].includes(ctx.rol);
  return `
    <div class="toolbar">
      <div class="toolbar__left">
        <div class="filters">${ESTADOS.map((e) => `<button class="chip ${e.key === filtro ? "is-active" : ""}" data-filtro="${e.key}">${e.label}</button>`).join("")}</div>
      </div>
      ${canSend ? '<button class="btn btn--primary" id="btn-enviar">Enviar aviso a un cliente</button>' : ""}
    </div>
    <div class="panel" style="margin-bottom:14px;">
      <p class="muted" style="margin:0;font-size:0.88rem;">
        Cada cliente recibe <strong>dos avisos</strong> por cobro, a las 10:00 a.m.:
        <strong>3 días antes del corte</strong> y <strong>el día del corte</strong>
        (corte 15 → días 12 y 15 · corte 30 → días 27 y 30).
        Los avisos se preparan solos; aquí ves si salieron.
      </p>
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
      <td>${esc(fmtTs(n.fechaProgramada))}</td>
      <td>${clienteNombre(n.clienteId)}</td>
      <td>${esc(etiquetaTipoAviso(n.tipo))}<div class="muted" style="font-size:0.78rem;">${esc(n.tipo || "—")}</div></td>
      <td class="muted">${esc((n.mensaje || "").slice(0, 80))}${(n.mensaje || "").length > 80 ? "…" : ""}${n.error ? `<div class="muted" style="font-size:0.78rem;color:var(--red);">${esc(String(n.error).slice(0, 90))}</div>` : ""}</td>
      <td>${badgeNotif(n.estado)}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Aviso</th><th>Mensaje</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function abrirModal() {
  const root = document.getElementById("modal-root");
  const op = clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nombreCompleto)}</option>`).join("");

  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>Enviar aviso a un cliente</h2>
        <div class="form-grid">
          <label class="field"><span>Cliente *</span><select name="clienteId" required>${op || '<option value="">Sin clientes</option>'}</select></label>
          <label class="field"><span>Título</span><input name="titulo" value="UneFibra" /></label>
          <label class="field"><span>Mensaje *</span><textarea name="mensaje" rows="3" required></textarea></label>
        </div>
        <p class="muted" style="font-size:0.82rem;">Se entrega por notificación push a los dispositivos registrados del cliente. Si no hay dispositivos registrados, el aviso quedará como <strong>Fallido</strong> y verás el motivo en la lista.</p>
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
