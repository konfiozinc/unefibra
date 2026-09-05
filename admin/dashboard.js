/* ============================================================
 * UNEFIBRAS SAS — Admin: dashboard
 * ------------------------------------------------------------
 * Todos los indicadores provienen de Firestore (sin datos
 * simulados). Si no hay datos, se muestran ceros reales.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import {
  collection, query, where, getCountFromServer, getAggregateFromServer, sum
} from "firebase/firestore";

// ---- Utilidades de fecha (zona Colombia, UTC-5) ----
const COLOMBIA_UTC_OFFSET_MS = -5 * 3600000;

function fechaISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}
function hoyColombia() {
  return fechaISO(new Date(Date.now() + COLOMBIA_UTC_OFFSET_MS));
}
function sumarDias(fechaStr, dias) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  return fechaISO(new Date(base.getTime() + dias * 86400000));
}
function inicioMes() {
  const h = new Date(Date.now() + COLOMBIA_UTC_OFFSET_MS);
  return fechaISO(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1)));
}

const fmtMoney = (v) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0);

// ---- Consultas ----
async function contarPorEstado(estado) {
  const q = query(collection(db, "clientes"), where("estadoCliente", "==", estado));
  return (await getCountFromServer(q)).data().count;
}

async function pagosDelMes() {
  const q = query(
    collection(db, "pagos"),
    where("estado", "==", "CONFIRMADO"),
    where("fechaPago", ">=", inicioMes()),
    where("fechaPago", "<=", hoyColombia())
  );
  const cantidad = (await getCountFromServer(q)).data().count;
  const agg = await getAggregateFromServer(q, { total: sum("monto") });
  return { cantidad, total: agg.data().total || 0 };
}

async function contarVencimientosEnRango(desde, hasta) {
  const q = query(
    collection(db, "clientes"),
    where("fechaVencimiento", ">=", desde),
    where("fechaVencimiento", "<=", hasta)
  );
  return (await getCountFromServer(q)).data().count;
}

// ---- Render ----
function card(label, value, opts = {}) {
  return `
    <div class="card ${opts.accent ? "card--accent" : ""}">
      <div class="card__label">${label}</div>
      <div class="card__value ${opts.tone || ""}">${value}${opts.unit ? `<span class="unit"> ${opts.unit}</span>` : ""}</div>
      ${opts.hint ? `<div class="card__hint">${opts.hint}</div>` : ""}
    </div>`;
}

(async function main() {
  const ctx = await requireAuth("dashboard");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = '<div class="spinner"></div>';

  try {
    const hoy = hoyColombia();
    const manana = sumarDias(hoy, 1);
    const en7Dias = sumarDias(hoy, 7);

    const [
      activos, porVencer, pendientes, suspendidos, inactivos,
      pagosMes, vencimientosHoy, vencimientosProximos
    ] = await Promise.all([
      contarPorEstado("ACTIVO"),
      contarPorEstado("POR_VENCER"),
      contarPorEstado("PENDIENTE_PAGO"),
      contarPorEstado("SUSPENDIDO"),
      contarPorEstado("INACTIVO"),
      pagosDelMes(),
      contarVencimientosEnRango(hoy, hoy),
      contarVencimientosEnRango(manana, en7Dias)
    ]);

    content.innerHTML = `
      <div class="cards">
        ${card("Clientes activos", activos, { tone: "tone-green", hint: "Servicio habilitado y al día" })}
        ${card("Por vencer", porVencer, { tone: "tone-amber", hint: "Próximos 7 días" })}
        ${card("Pendientes de pago", pendientes, { tone: "tone-red", hint: "Vencidos sin pago que cubra el periodo" })}
        ${card("Suspendidos", suspendidos, { tone: "tone-red", hint: "Servicio suspendido" })}
        ${card("Inactivos", inactivos, { tone: "tone-violet", hint: "Retirados o cancelados" })}

        ${card("Pagos del mes", pagosMes.cantidad, { tone: "tone-cyan", accent: true, hint: "Pagos confirmados este mes" })}
        ${card("Ingresos del mes", fmtMoney(pagosMes.total), { tone: "tone-cyan", accent: true, hint: "Suma de pagos confirmados" })}
        ${card("Vencen hoy", vencimientosHoy, { tone: "tone-amber", hint: `Fecha de corte: ${hoy}` })}
        ${card("Vencen próximos 7 días", vencimientosProximos, { tone: "tone-amber", hint: `${manana} a ${en7Dias}` })}
      </div>`;
  } catch (err) {
    console.error("Error al cargar el dashboard:", err);
    content.innerHTML = '<div class="card">No fue posible cargar los indicadores. Verifica tu conexión y permisos, e inténtalo de nuevo.</div>';
  }
})();
