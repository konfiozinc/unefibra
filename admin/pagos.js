/* ============================================================
 * UNEFIBRAS SAS — Admin: pagos
 * ------------------------------------------------------------
 * Registra pagos (PENDIENTE), confirma (renueva el servicio vía
 * Cloud Function) y anula. Todo con datos reales de Firestore.
 * Acepta ?clienteId=… para pre-seleccionar un cliente (desde la
 * ficha del cliente).
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs } from "firebase/firestore";
import { fmtFecha, fmtMoney, hoyColombia, msgError } from "../assets/js/admin/ui.js";

let ctx = null;
let pagos = [];
let clientes = [];
let metodos = [];
let filtro = "todos";
let busqueda = "";
const clientePreseleccionado = new URLSearchParams(location.search).get("clienteId") || "";

const ESTADOS = [
  { key: "todos", label: "Todos" },
  { key: "PENDIENTE", label: "Pendientes" },
  { key: "CONFIRMADO", label: "Confirmados" },
  { key: "RECHAZADO", label: "Rechazados" },
  { key: "ANULADO", label: "Anulados" }
];

function badgePago(e) {
  const map = {
    PENDIENTE: ["Pendiente", "tone-amber"],
    CONFIRMADO: ["Confirmado", "tone-green"],
    RECHAZADO: ["Rechazado", "tone-red"],
    ANULADO: ["Anulado", "tone-violet"]
  };
  const [l, t] = map[e] || [e || "—", ""];
  return `<span class="badge-estado ${t}">${l}</span>`;
}

function clienteNombre(id) {
  const c = clientes.find((x) => x.id === id);
  return c ? c.nombreCompleto : id;
}

function renderToolbar() {
  const canWrite = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <div class="toolbar__left">
        <div class="search"><input id="buscar" type="search" placeholder="Buscar cliente…" value="${busqueda}" /></div>
        <div class="filters">${ESTADOS.map((e) => `<button class="chip ${e.key === filtro ? "is-active" : ""}" data-filtro="${e.key}">${e.label}</button>`).join("")}</div>
      </div>
      ${canWrite ? '<button class="btn btn--primary" id="btn-registrar">+ Registrar pago</button>' : ""}
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function filtrar() {
  let list = pagos.slice();
  if (filtro !== "todos") list = list.filter((p) => p.estado === filtro);
  if (busqueda) {
    const q = busqueda.toLowerCase();
    list = list.filter((p) => (clienteNombre(p.clienteId) || "").toLowerCase().includes(q));
  }
  list.sort((a, b) => String(b.fechaPago || "").localeCompare(String(a.fechaPago || "")));
  return list;
}

function accionesPago(p) {
  if (ctx.rol === "OPERADOR") return "—";
  const btns = [];
  if (p.estado === "PENDIENTE") btns.push(`<button class="btn btn--primary btn--sm" data-confirmar="${p.id}">Confirmar</button>`);
  if (p.estado === "PENDIENTE" || p.estado === "RECHAZADO") btns.push(`<button class="btn btn--ghost btn--sm" data-anular="${p.id}">Anular</button>`);
  return btns.join(" ");
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  const list = filtrar();
  if (!list.length) {
    cont.innerHTML = '<div class="empty">No hay pagos en este filtro.</div>';
    return;
  }

  const rows = list.map((p) => `
    <tr data-id="${p.id}">
      <td>${fmtFecha(p.fechaPago)}</td>
      <td>${clienteNombre(p.clienteId)}</td>
      <td>${p.metodoPago || "—"}</td>
      <td>${fmtMoney(p.monto)}</td>
      <td class="muted">${fmtFecha(p.periodoInicio)} – ${fmtFecha(p.periodoFin)}</td>
      <td>${badgePago(p.estado)}</td>
      <td>${accionesPago(p)}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Método</th><th>Monto</th><th>Periodo</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------------- Registrar pago ----------------
function abrirModal() {
  const root = document.getElementById("modal-root");
  const opClientes = clientes.map((c) => `<option value="${c.id}" ${c.id === clientePreseleccionado ? "selected" : ""}>${c.nombreCompleto}</option>`).join("");
  const opMetodos = metodos.map((m) => `<option value="${m}">${m}</option>`).join("") || "<option>Otro</option>";

  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>Registrar pago</h2>
        <div class="form-grid two">
          <label class="field"><span>Cliente *</span><select name="clienteId" required>${opClientes || '<option value="">Sin clientes</option>'}</select></label>
          <label class="field"><span>Monto (COP) *</span><input name="monto" type="number" required min="0" step="1" /></label>
          <label class="field"><span>Método de pago</span><select name="metodoPago">${opMetodos}</select></label>
          <label class="field"><span>Fecha de pago</span><input name="fechaPago" type="date" value="${hoyColombia()}" /></label>
          <label class="field"><span>Referencia</span><input name="referencia" /></label>
        </div>
        <p class="muted" style="font-size:0.82rem;">El pago queda en PENDIENTE; al confirmarlo se renueva el servicio del cliente.</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btn-guardar">Registrar</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </form>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) root.innerHTML = "";
  });
  root.querySelector("#modal-form").addEventListener("submit", registrarPago);
}

async function registrarPago(ev) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const d = Object.fromEntries(new FormData(ev.target).entries());

  if (!d.clienteId || !d.monto) {
    msg.textContent = "Cliente y monto son obligatorios.";
    msg.className = "modal__msg err";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Registrando…";
  msg.className = "modal__msg";
  msg.textContent = "";

  try {
    await call("registrarPago")({
      clienteId: d.clienteId,
      monto: Number(d.monto),
      metodoPago: d.metodoPago,
      fechaPago: d.fechaPago || hoyColombia(),
      referencia: d.referencia.trim() || null
    });
    document.getElementById("modal-root").innerHTML = "";
    await cargar();
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Registrar";
  }
}

// ---------------- Confirmar / anular ----------------
async function confirmarPago(id) {
  if (!confirm("¿Confirmar este pago? Se renovará el servicio del cliente.")) return;
  try {
    await call("confirmarPago")({ pagoId: id });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

async function anularPago(id) {
  if (!confirm("¿Anular este pago?")) return;
  try {
    await call("anularPago")({ pagoId: id });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

// ---------------- Carga ----------------
async function cargar() {
  const [pagosSnap, cliSnap, metSnap] = await Promise.all([
    getDocs(collection(db, "pagos")),
    getDocs(collection(db, "clientes")),
    getDocs(collection(db, "metodos_pago"))
  ]);

  pagos = pagosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  clientes = cliSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const activos = metSnap.docs.map((d) => d.data()).filter((m) => m.activo !== false).map((m) => m.nombre);
  const cfg = window.UNEFIBRAS_CONFIG;
  metodos = activos.length ? activos : ((cfg && cfg.metodosPagoPorDefecto) || ["Otro"]);

  renderTabla();
}

// ---------------- Eventos ----------------
function bind() {
  const input = document.getElementById("buscar");
  if (input) input.addEventListener("input", () => { busqueda = input.value.trim(); renderTabla(); });

  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    filtro = c.dataset.filtro;
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("is-active", x.dataset.filtro === filtro));
    renderTabla();
  }));

  const btnReg = document.getElementById("btn-registrar");
  if (btnReg) btnReg.addEventListener("click", abrirModal);

  const tabla = document.getElementById("tabla");
  if (tabla) tabla.addEventListener("click", (e) => {
    const conf = e.target.closest("[data-confirmar]");
    const anul = e.target.closest("[data-anular]");
    if (conf) confirmarPago(conf.dataset.confirmar);
    if (anul) anularPago(anul.dataset.anular);
  });
}

(async function main() {
  ctx = await requireAuth("pagos");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();
  bind();

  try {
    await cargar();
    if (clientePreseleccionado && ctx.rol !== "OPERADOR") abrirModal();
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar los pagos.</div>';
  }
})();
