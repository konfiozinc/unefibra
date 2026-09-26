/* ============================================================
 * UneFibra SAS — Admin: listas por ciclo de corte
 * ------------------------------------------------------------
 * Módulo compartido por admin/lista-corte-15.html y
 * admin/lista-corte-30.html. Una sola implementación para las dos
 * listas: si se duplicara, tarde o temprano una quedaría distinta.
 *
 * Muestra los clientes que pertenecen al ciclo de corte (día 15 o
 * día 30) con su vencimiento, la fecha del próximo corte y una acción
 * directa de WhatsApp para cobrar.
 *
 * SOBRE EL ORDEN: en el modelo de corte mensual TODOS los clientes de
 * un ciclo comparten la misma fecha de próximo corte, así que ordenar
 * por esa fecha no ordena nada. Se ordena por fecha de vencimiento
 * ascendente: primero quien más debe, que es lo útil para cobrar.
 * ============================================================ */

import { db } from "./core.js";
import { requireAuth } from "./shell.js";
import { call } from "./callables.js";
import { collection, getDocs } from "firebase/firestore";
import {
  badgeEstado, fmtFecha, textoDias, diasRestantes,
  proximoCorteDe, etiquetaCorte, urlWhatsApp
} from "./ui.js";

const FILTROS = [
  { key: "todos", label: "Todos" },
  { key: "ACTIVO", label: "Activos" },
  { key: "POR_VENCER", label: "Por vencer" },
  { key: "PENDIENTE_PAGO", label: "Pendientes" },
  { key: "SUSPENDIDO", label: "Suspendidos" },
  { key: "INACTIVO", label: "Inactivos" }
];

let clientes = [];
let filtro = "todos";
let busqueda = "";

/** Escapa texto para insertarlo en HTML o en un atributo. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Clientes que pertenecen al ciclo indicado. */
function delCiclo(ciclo) {
  return clientes.filter((c) => String(c.cicloCorte || "") === String(ciclo));
}

/** Aplica búsqueda, filtro de estado y orden. */
function filtrar(ciclo) {
  let list = delCiclo(ciclo);

  if (filtro !== "todos") list = list.filter((c) => c.estadoCliente === filtro);

  if (busqueda) {
    const q = busqueda.toLowerCase();
    list = list.filter((c) =>
      (c.nombreCompleto || "").toLowerCase().includes(q) ||
      (c.documento || "").toLowerCase().includes(q) ||
      (c.telefono || "").toLowerCase().includes(q)
    );
  }

  // Quien más debe, primero.
  list.sort((a, b) => (diasRestantes(a.fechaVencimiento) ?? 9999) - (diasRestantes(b.fechaVencimiento) ?? 9999));
  return list;
}

function renderVista(ciclo) {
  const proximo = proximoCorteDe(ciclo);
  return `
    <div class="panel" style="margin-bottom:16px;">
      <h2>${etiquetaCorte(ciclo)} · próximo corte: ${fmtFecha(proximo)}</h2>
      <p class="muted" id="resumen-corte">Cargando…</p>
    </div>
    <div class="toolbar">
      <div class="toolbar__left">
        <div class="search"><input id="buscar" type="search" placeholder="Buscar nombre, documento o teléfono…" /></div>
        <div class="filters">${FILTROS.map((f) => `<button class="chip ${f.key === filtro ? "is-active" : ""}" data-filtro="${f.key}">${f.label}</button>`).join("")}</div>
      </div>
    </div>
    <div class="table-wrap" id="tabla"></div>`;
}

/** Contador de la parte superior: total, por vencer y vencidos del ciclo. */
function renderResumen(ciclo) {
  const cont = document.getElementById("resumen-corte");
  if (!cont) return;

  const todos = delCiclo(ciclo);
  const vencidos = todos.filter((c) => (diasRestantes(c.fechaVencimiento) ?? 0) < 0).length;
  const porVencer = todos.filter((c) => {
    const d = diasRestantes(c.fechaVencimiento);
    return d !== null && d >= 0 && d <= 7;
  }).length;
  const suspendidos = todos.filter((c) => c.estadoCliente === "SUSPENDIDO").length;

  cont.textContent = `Total clientes: ${todos.length} · Por vencer: ${porVencer} · ` +
    `Vencidos: ${vencidos} · Suspendidos: ${suspendidos}`;
}

function renderTabla(ciclo) {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  renderResumen(ciclo);
  const list = filtrar(ciclo);

  if (!list.length) {
    cont.innerHTML = `<div class="empty">No hay clientes en el ${etiquetaCorte(ciclo)} con este filtro.</div>`;
    return;
  }

  const proximo = proximoCorteDe(ciclo);

  const rows = list.map((c) => `
    <tr data-id="${esc(c.id)}">
      <td>${esc(c.nombreCompleto) || "—"}</td>
      <td>${esc(c.planNombre) || "—"}</td>
      <td>${esc(c.telefono) || "—"}</td>
      <td>${fmtFecha(c.fechaVencimiento)}</td>
      <td>${fmtFecha(proximo)}</td>
      <td class="muted">${textoDias(c.fechaVencimiento)}</td>
      <td>${badgeEstado(c.estadoCliente)}</td>
      <td>
        <button type="button" class="btn btn--ghost btn--sm" data-wa="${esc(c.id)}">Cobrar</button>
      </td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr>
        <th>Cliente</th><th>Plan</th><th>Teléfono</th><th>Vencimiento</th>
        <th>Próximo corte</th><th>Días</th><th>Estado</th><th>Acción</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // El texto NO se arma aquí: lo construye la Cloud Function `mensajeCobro` con
  // la plantilla, la cuenta bancaria y los WhatsApp configurados. Así el mensaje
  // que envía el operador es exactamente el mismo que manda el sistema solo, y el
  // panel no necesita tener los datos bancarios en memoria.
  cont.querySelectorAll("[data-wa]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        const res = await call("mensajeCobro")({ clienteId: btn.dataset.wa });
        const texto = res.data && res.data.texto;
        if (!texto) throw new Error("La función no devolvió el mensaje.");
        window.open(urlWhatsApp(texto), "_blank", "noopener");
      } catch (err) {
        console.error(err);
        alert("No se pudo preparar el mensaje de cobro. Revisa la cuenta bancaria y las plantillas en Configuración.");
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  cont.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", (ev) => {
      // El botón de cobro no debe abrir además la ficha del cliente.
      if (ev.target.closest("[data-wa]")) return;
      location.href = `cliente.html?id=${tr.dataset.id}`;
    });
  });
}

function bind(ciclo) {
  const input = document.getElementById("buscar");
  if (input) input.addEventListener("input", () => { busqueda = input.value.trim(); renderTabla(ciclo); });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filtro;
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c.dataset.filtro === filtro));
      renderTabla(ciclo);
    });
  });
}

/**
 * Arranca una de las dos listas.
 * @param {"15"|"30"} ciclo  ciclo de corte que muestra la página
 * @param {string} claveNav  clave de la entrada del menú lateral
 */
export async function iniciarListaCorte(ciclo, claveNav) {
  const ctx = await requireAuth(claveNav);
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderVista(ciclo);
  bind(ciclo);

  try {
    const snap = await getDocs(collection(db, "clientes"));
    clientes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTabla(ciclo);
  } catch (err) {
    console.error(err);
    const tabla = document.getElementById("tabla");
    if (tabla) tabla.innerHTML = '<div class="empty">No fue posible cargar los clientes. Intenta nuevamente.</div>';
  }
}
