/* ============================================================
 * UNEFIBRAS SAS — Admin: lista de clientes
 * ------------------------------------------------------------
 * Lee clientes reales de Firestore, con búsqueda, filtros por
 * estado y orden (los pendientes se ordenan por mayor atraso).
 * El alta se hace vía Cloud Function (valida rol + anti-duplicado).
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs } from "firebase/firestore";
import { badgeEstado, fmtFecha, textoDias, fmtMoney, diasRestantes } from "../assets/js/admin/ui.js";

let ctx = null;
let clientes = [];
let planes = [];
let filtro = "todos";
let busqueda = "";

const FILTROS = [
  { key: "todos", label: "Todos" },
  { key: "ACTIVO", label: "Activos" },
  { key: "POR_VENCER", label: "Por vencer" },
  { key: "PENDIENTE_PAGO", label: "Pendientes" },
  { key: "SUSPENDIDO", label: "Suspendidos" },
  { key: "INACTIVO", label: "Inactivos" }
];

function msgError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("already-exists")) return "Ya existe un cliente con ese documento.";
  if (code.includes("permission-denied")) return "No tienes permisos para esta operación.";
  if (code.includes("invalid-argument")) return "Datos incompletos o inválidos. Revisa el formulario.";
  return "No fue posible completar la operación. Intenta nuevamente.";
}

function renderToolbar() {
  const canWrite = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <div class="toolbar__left">
        <div class="search"><input id="buscar" type="search" placeholder="Buscar nombre, documento o teléfono…" /></div>
        <div class="filters">${FILTROS.map((f) => `<button class="chip ${f.key === filtro ? "is-active" : ""}" data-filtro="${f.key}">${f.label}</button>`).join("")}</div>
      </div>
      ${canWrite ? '<button class="btn btn--primary" id="btn-nuevo">+ Nuevo cliente</button>' : ""}
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function filtrar() {
  let list = clientes.slice();

  if (filtro !== "todos") list = list.filter((c) => c.estadoCliente === filtro);

  if (busqueda) {
    const q = busqueda.toLowerCase();
    list = list.filter((c) =>
      (c.nombreCompleto || "").toLowerCase().includes(q) ||
      (c.documento || "").toLowerCase().includes(q) ||
      (c.telefono || "").toLowerCase().includes(q)
    );
  }

  if (filtro === "PENDIENTE_PAGO") {
    // Orden por mayor atraso (más negativo primero)
    list.sort((a, b) => (diasRestantes(a.fechaVencimiento) ?? 0) - (diasRestantes(b.fechaVencimiento) ?? 0));
  } else {
    list.sort((a, b) => (a.nombreCompleto || "").localeCompare(b.nombreCompleto || ""));
  }
  return list;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  const list = filtrar();
  if (!list.length) {
    cont.innerHTML = '<div class="empty">No hay clientes en este filtro.</div>';
    return;
  }

  const rows = list.map((c) => `
    <tr data-id="${c.id}">
      <td>${c.nombreCompleto || "—"}</td>
      <td class="muted">${c.documento || "—"}</td>
      <td>${c.telefono || "—"}</td>
      <td>${c.planNombre || "—"}</td>
      <td>${badgeEstado(c.estadoCliente)}</td>
      <td>${fmtFecha(c.fechaVencimiento)}</td>
      <td class="muted">${textoDias(c.fechaVencimiento)}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Plan</th><th>Estado</th><th>Vencimiento</th><th>Días</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => (location.href = `cliente.html?id=${tr.dataset.id}`));
  });
}

async function cargarClientes() {
  const snap = await getDocs(collection(db, "clientes"));
  clientes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTabla();
}

// ---------------- Modal de alta ----------------
async function abrirModal() {
  if (!planes.length) {
    const snap = await getDocs(collection(db, "planes"));
    planes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const root = document.getElementById("modal-root");
  const opciones = planes.length
    ? planes.map((p) => `<option value="${p.id}">${p.nombre} — ${fmtMoney(p.precio)}</option>`).join("")
    : '<option value="">Sin planes (crea uno en Planes)</option>';

  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>Nuevo cliente</h2>
        <div class="form-grid two">
          <label class="field"><span>Nombre completo *</span><input name="nombreCompleto" required maxlength="120" /></label>
          <label class="field"><span>Documento</span><input name="documento" /></label>
          <label class="field"><span>Teléfono *</span><input name="telefono" required inputmode="tel" /></label>
          <label class="field"><span>WhatsApp</span><input name="whatsapp" inputmode="tel" /></label>
          <label class="field"><span>Email</span><input name="email" type="email" /></label>
          <label class="field"><span>Ciudad</span><input name="ciudad" value="Medellín" /></label>
          <label class="field"><span>Dirección</span><input name="direccion" /></label>
          <label class="field"><span>Barrio</span><input name="barrio" /></label>
          <label class="field"><span>Plan</span><select name="planId">${opciones}</select></label>
          <label class="field"><span>Observaciones</span><input name="observaciones" /></label>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btn-guardar">Guardar</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </form>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) root.innerHTML = "";
  });
  root.querySelector("#modal-form").addEventListener("submit", guardarCliente);
}

async function guardarCliente(ev) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const data = Object.fromEntries(new FormData(ev.target).entries());

  if (!data.nombreCompleto || !data.telefono) {
    msg.textContent = "Nombre y teléfono son obligatorios.";
    msg.className = "modal__msg err";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando…";
  msg.textContent = "";
  msg.className = "modal__msg";

  try {
    const crearCliente = call("crearCliente");
    const res = await crearCliente({
      nombreCompleto: data.nombreCompleto.trim(),
      documento: data.documento.trim() || null,
      telefono: data.telefono.trim(),
      whatsapp: data.whatsapp.trim() || data.telefono.trim(),
      email: data.email.trim() || null,
      direccion: data.direccion.trim() || null,
      barrio: data.barrio.trim() || null,
      ciudad: data.ciudad.trim() || "Medellín",
      planId: data.planId || null,
      observaciones: data.observaciones.trim() || null
    });
    const id = res.data && res.data.id;
    document.getElementById("modal-root").innerHTML = "";
    if (id) {
      location.href = `cliente.html?id=${id}`;
    } else {
      await cargarClientes();
    }
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

// ---------------- Eventos ----------------
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

  const btnNuevo = document.getElementById("btn-nuevo");
  if (btnNuevo) btnNuevo.addEventListener("click", abrirModal);
}

(async function main() {
  ctx = await requireAuth("clientes");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();
  bind();

  try {
    await cargarClientes();
  } catch (err) {
    console.error(err);
    const tabla = document.getElementById("tabla");
    if (tabla) tabla.innerHTML = '<div class="empty">No fue posible cargar los clientes. Intenta nuevamente.</div>';
  }
})();
