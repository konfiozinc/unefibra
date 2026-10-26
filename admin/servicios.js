/* ============================================================
 * UneFibra SAS — Admin: lista de servicios
 * ------------------------------------------------------------
 * Lee la colección `servicios` (entidad distinta del cliente) y
 * la cruza con clientes/planes para mostrar un listado útil.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { collection, getDocs } from "firebase/firestore";
import { badgeEstado, fmtFecha, textoDias, esc } from "../assets/js/admin/ui.js";

let servicios = [];
let clientesMap = {};
let planesMap = {};
let filtro = "todos";

const ESTADOS = [
  { key: "todos", label: "Todos" },
  { key: "ACTIVO", label: "Activos" },
  { key: "POR_VENCER", label: "Por vencer" },
  { key: "SUSPENDIDO", label: "Suspendidos" },
  { key: "INACTIVO", label: "Inactivos" }
];

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="filters">${ESTADOS.map((e) => `<button class="chip ${e.key === filtro ? "is-active" : ""}" data-filtro="${e.key}">${e.label}</button>`).join("")}</div>
    </div>
    <div class="table-wrap" id="tabla"></div>`;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  let list = servicios.slice();
  if (filtro !== "todos") list = list.filter((s) => s.estado === filtro);
  list.sort((a, b) => String(a.fechaVencimiento || "").localeCompare(String(b.fechaVencimiento || "")));

  if (!list.length) {
    cont.innerHTML = '<div class="empty">No hay servicios en este filtro.</div>';
    return;
  }

  const rows = list.map((s) => `
    <tr data-id="${esc(s.clienteId)}">
      <td>${esc(clientesMap[s.clienteId] || "—")}</td>
      <td>${esc(planesMap[s.planId] || "—")}</td>
      <td>${fmtFecha(s.fechaInicio)}</td>
      <td>${fmtFecha(s.fechaVencimiento)}</td>
      <td>${badgeEstado(s.estado)}</td>
      <td class="muted">${textoDias(s.fechaVencimiento)}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Cliente</th><th>Plan</th><th>Inicio</th><th>Vencimiento</th><th>Estado</th><th>Días</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => (location.href = `cliente.html?id=${tr.dataset.id}`));
  });
}

/** Aviso de cartera sin servicio (KZ-UNEF-005). */
function avisarSinServicio(cantidad) {
  const cont = document.getElementById("tabla");
  if (!cont || !cont.parentNode || !cantidad) return;
  const aviso = document.createElement("div");
  aviso.className = "empty";
  aviso.setAttribute("role", "status");
  aviso.style.borderColor = "#b45309";
  aviso.textContent =
    "Atención: " + cantidad + " cliente(s) no tienen servicio asociado. " +
    "No aparecen en esta lista y el motor de vencimientos no los alcanza: " +
    "revísalos con la conciliación antes de cobrar o suspender nada.";
  cont.parentNode.insertBefore(aviso, cont);
}

(async function main() {  const ctx = await requireAuth("servicios");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filtro;
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c.dataset.filtro === filtro));
      renderTabla();
    });
  });

  try {
    const [servSnap, cliSnap, planSnap] = await Promise.all([
      getDocs(collection(db, "servicios")),
      getDocs(collection(db, "clientes")),
      getDocs(collection(db, "planes"))
    ]);

    servicios = servSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    clientesMap = {};
    cliSnap.docs.forEach((d) => (clientesMap[d.id] = d.data().nombreCompleto || d.id));
    planesMap = {};
    planSnap.docs.forEach((d) => (planesMap[d.id] = d.data().nombre || d.id));

    /* KZ-UNEF-005 · Un cliente sin documento de servicio no aparece en esta
       pantalla y parece no existir. El motor de vencimientos también itera
       sobre `servicios`, así que a ese cliente no le llega ni el recordatorio
       ni la suspensión. Se avisa con el número real en vez de mostrar una
       lista incompleta como si fuera toda la cartera. */
    const idsConServicio = new Set(servicios.map((s) => s.clienteId).filter(Boolean));
    const sinServicio = cliSnap.docs.filter((d) => !idsConServicio.has(d.id)).length;

    renderTabla();
    avisarSinServicio(sinServicio);
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar los servicios.</div>';
  }
})();
