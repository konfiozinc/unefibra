/* ============================================================
 * UNEFIBRAS SAS — Admin: ficha individual del cliente
 * ------------------------------------------------------------
 * Muestra datos personales, servicio, pagos recientes e historial
 * de estados (todo real desde Firestore) y permite acciones
 * (suspender/activar/desactivar/reactivar, WhatsApp) vía Cloud
 * Functions, que validan el rol en el servidor.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { fmtFecha, fmtMoney, badgeEstado, textoDias, urlWhatsApp } from "../assets/js/admin/ui.js";

const params = new URLSearchParams(location.search);
const clienteId = params.get("id");
let ctx = null;

function msgError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("permission-denied")) return "No tienes permisos para esta operación.";
  return "No fue posible completar la operación. Intenta nuevamente.";
}

function fmtTimestamp(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`;
}

async function accionEstado(nombreFn, mensaje) {
  if (!confirm(mensaje)) return;
  const btns = document.querySelectorAll("[data-accion]");
  btns.forEach((b) => (b.disabled = true));
  try {
    const fn = call(nombreFn);
    await fn({ clienteId });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
    btns.forEach((b) => (b.disabled = false));
  }
}

function acciones(cliente) {
  const esOperador = ctx.rol === "OPERADOR";
  const e = cliente.estadoCliente;
  const btns = [];

  if (!esOperador) {
    if (e === "SUSPENDIDO" || e === "PENDIENTE_PAGO") {
      btns.push('<button class="btn btn--primary" data-accion="activarServicio">Activar</button>');
    }
    if (e !== "SUSPENDIDO" && e !== "INACTIVO") {
      btns.push('<button class="btn btn--ghost" data-accion="suspenderServicio">Suspender</button>');
    }
    if (e !== "INACTIVO") {
      btns.push('<button class="btn btn--ghost" data-accion="desactivarServicio">Desactivar</button>');
    }
    if (e === "INACTIVO") {
      btns.push('<button class="btn btn--primary" data-accion="reactivarServicio">Reactivar</button>');
    }
    const msgWa = `Hola ${cliente.nombreCompleto || ""}, te escribimos de UneFibra. Tu servicio de Internet vence el ${fmtFecha(cliente.fechaVencimiento)} (valor ${fmtMoney(cliente.precioMensual)}).`;
    btns.push(`<a class="btn btn--ghost" target="_blank" rel="noopener" href="${urlWhatsApp(msgWa)}">Enviar WhatsApp</a>`);
    btns.push(`<a class="btn btn--ghost" href="pagos.html?clienteId=${cliente.id}">Registrar pago</a>`);
  }

  return `<div class="actions">${btns.join("")}</div>`;
}

function panelDatos(cliente) {
  const filas = [
    ["Nombre", cliente.nombreCompleto],
    ["Documento", cliente.documento],
    ["Teléfono", cliente.telefono],
    ["WhatsApp", cliente.whatsapp],
    ["Email", cliente.email],
    ["Dirección", cliente.direccion],
    ["Barrio", cliente.barrio],
    ["Ciudad", cliente.ciudad]
  ];
  return `<div class="panel">
    <h2>Datos personales</h2>
    <div class="kv">${filas.map(([k, v]) => `<div class="kv__item"><span class="kv__k">${k}</span><span class="kv__v">${v || "—"}</span></div>`).join("")}</div>
  </div>`;
}

function panelServicio(cliente, servicio, plan) {
  const filas = [
    ["Plan", cliente.planNombre],
    ["Velocidad", plan && plan.velocidad ? plan.velocidad : "—"],
    ["Precio", fmtMoney(cliente.precioMensual)],
    ["Fecha instalación", fmtFecha(cliente.fechaInstalacion)],
    ["Inicio de servicio", fmtFecha(cliente.fechaInicioServicio)],
    ["Vencimiento", fmtFecha(cliente.fechaVencimiento)],
    ["Estado servicio", badgeEstado(servicio ? servicio.estado : cliente.estadoServicio)],
    ["Método preferido", cliente.metodoPagoPreferido]
  ];
  return `<div class="panel">
    <h2>Servicio</h2>
    <div class="kv">${filas.map(([k, v]) => `<div class="kv__item"><span class="kv__k">${k}</span><span class="kv__v">${v}</span></div>`).join("")}</div>
  </div>`;
}

function panelPagos(pagos) {
  if (!pagos.length) {
    return '<div class="panel"><h2>Pagos recientes</h2><p class="muted">Sin pagos registrados.</p></div>';
  }
  const filas = pagos.map((p) => `
    <div class="kv__item">
      <span class="kv__k">${fmtFecha(p.fechaPago)} · ${p.metodoPago || "—"}</span>
      <span class="kv__v">${fmtMoney(p.monto)} <span class="muted">(${p.estado})</span></span>
    </div>`).join("");
  return `<div class="panel"><h2>Pagos recientes</h2><div class="kv">${filas}</div></div>`;
}

function panelHistorial(historial) {
  if (!historial.length) {
    return '<div class="panel span-2"><h2>Historial de estados</h2><p class="muted">Sin cambios registrados.</p></div>';
  }
  const items = historial.map((h) => `
    <div class="timeline__item">
      <p><strong>${h.estadoAnterior || "—"} → ${h.estadoNuevo || "—"}</strong> <span class="muted">· ${h.motivo || "Sin motivo"}</span></p>
      <p class="muted">${fmtTimestamp(h.fecha)} · ${h.usuarioNombre || h.usuarioId || "sistema"}</p>
    </div>`).join("");
  return `<div class="panel span-2"><h2>Historial de estados</h2><div class="timeline">${items}</div></div>`;
}

async function cargar() {
  const content = document.getElementById("app-content");
  content.innerHTML = '<div class="spinner"></div>';

  const [clienteSnap, servicioSnap, pagosSnap, historialSnap] = await Promise.all([
    getDoc(doc(db, "clientes", clienteId)),
    getDocs(query(collection(db, "servicios"), where("clienteId", "==", clienteId), limit(1))),
    getDocs(query(collection(db, "pagos"), where("clienteId", "==", clienteId), orderBy("fechaPago", "desc"), limit(5))),
    getDocs(query(collection(db, "historial_estados"), where("clienteId", "==", clienteId), orderBy("fecha", "desc"), limit(20)))
  ]);

  if (!clienteSnap.exists()) {
    content.innerHTML = '<div class="empty">Cliente no encontrado. <a href="clientes.html">Volver</a></div>';
    return;
  }

  const cliente = { id: clienteSnap.id, ...clienteSnap.data() };
  const servicio = servicioSnap.docs[0] ? { id: servicioSnap.docs[0].id, ...servicioSnap.docs[0].data() } : null;
  const pagos = pagosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const historial = historialSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let plan = null;
  if (cliente.planId) {
    const planSnap = await getDoc(doc(db, "planes", cliente.planId));
    if (planSnap.exists()) plan = { id: planSnap.id, ...planSnap.data() };
  }

  content.innerHTML = `
    <div>
      <a class="back-link" href="clientes.html">← Volver a clientes</a>
      <h1 style="font-family:var(--font-display);font-size:1.6rem;margin-bottom:4px;">${cliente.nombreCompleto || "Cliente"}</h1>
      <p class="muted" style="margin-bottom:18px;">${badgeEstado(cliente.estadoCliente)} · ${textoDias(cliente.fechaVencimiento)}</p>
    </div>
    ${acciones(cliente)}
    <div class="detail-grid">
      ${panelDatos(cliente)}
      ${panelServicio(cliente, servicio, plan)}
      ${panelPagos(pagos)}
      ${panelHistorial(historial)}
    </div>`;

  document.querySelectorAll("[data-accion]").forEach((b) => {
    b.addEventListener("click", () => {
      const mapa = {
        activarServicio: ["activarServicio", "¿Activar el servicio de este cliente?"],
        suspenderServicio: ["suspenderServicio", "¿Suspender el servicio de este cliente?"],
        desactivarServicio: ["desactivarServicio", "¿Desactivar (retirar) a este cliente? Conservará su historial."],
        reactivarServicio: ["reactivarServicio", "¿Reactivar a este cliente?"]
      };
      const [fn, msg] = mapa[b.dataset.accion] || [];
      if (fn) accionEstado(fn, msg);
    });
  });
}

(async function main() {
  ctx = await requireAuth("clientes");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  if (!clienteId) {
    content.innerHTML = '<div class="empty">Cliente no especificado. <a href="clientes.html">Volver</a></div>';
    return;
  }

  try {
    await cargar();
  } catch (err) {
    console.error(err);
    document.getElementById("app-content").innerHTML = '<div class="empty">No fue posible cargar el cliente.</div>';
  }
})();
