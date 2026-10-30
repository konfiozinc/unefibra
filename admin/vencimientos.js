/* ============================================================
 * UneFibra SAS — Admin: Vencimientos (pantalla para el propietario)
 * ------------------------------------------------------------
 * KZ-UNEF-028 · Tres grupos en lenguaje comercial, sin jerga técnica:
 *
 *     Vencidos    -> el corte ya pasó y no hay pago registrado
 *     Por vencer  -> el corte es en los próximos 7 días
 *     Al día      -> el corte es más adelante
 *
 * Cada cliente muestra su fecha de corte, cuánto falta y las DOS fechas en las
 * que se le avisa (3 días antes y el día del corte, a las 10:00 de Colombia).
 * Es solo lectura: aquí no se cobra ni se modifica nada; los botones llevan a
 * la ficha del cliente y a registrar el pago, que es donde se trabaja.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import {
  collection, getDocs
} from "firebase/firestore";
import {
  esc, fmtFecha, fmtMoney, diasRestantes, badgeEstado, textoCuandoVence,
  proximoCorteDe, cicloSegunFecha, etiquetaCorte, recordatoriosDelCorte, hoyColombia
} from "../assets/js/admin/ui.js";

let ctx = null;
let clientes = [];
let servicios = [];

const GRUPOS = [
  { key: "vencidos", titulo: "Vencidos", ayuda: "El corte ya pasó y no hay pago registrado.", tono: "tone-red" },
  { key: "porVencer", titulo: "Por vencer", ayuda: "Su corte es en los próximos 7 días.", tono: "tone-amber" },
  { key: "alDia", titulo: "Al día", ayuda: "Su corte es más adelante.", tono: "tone-green" }
];

/** Ciclo del cliente: el guardado o, si falta, el que se deduce de su vencimiento. */
function cicloDe(c) {
  const guardado = String(c.cicloCorte || "");
  if (guardado === "15" || guardado === "30") return guardado;
  return cicloSegunFecha(c.fechaVencimiento || c.fechaInicioServicio || c.fechaInstalacion) || "30";
}

/** Ficha lista para pintar: fecha de corte, cuánto falta y sus dos avisos. */
function preparar(c) {
  const ciclo = cicloDe(c);
  const corte = proximoCorteDe(ciclo);
  const dias = diasRestantes(corte);
  const avisos = recordatoriosDelCorte(corte);
  const grupo = dias < 0 ? "vencidos" : dias <= 7 ? "porVencer" : "alDia";
  const servicio = servicios.find((s) => s.clienteId === c.id) || null;
  return {
    id: c.id,
    nombre: c.nombreCompleto || c.nombre || "(sin nombre)",
    telefono: c.telefono || "",
    direccion: c.direccion || "",
    estado: c.estadoCliente || c.estado || "",
    precio: c.precioMensual || (servicio && servicio.precioMensual) || 0,
    ciclo,
    corte,
    dias,
    grupo,
    aviso1: avisos[0] ? avisos[0].fecha : null,
    aviso2: avisos[1] ? avisos[1].fecha : null,
    sinServicio: !servicio
  };
}

function tarjetaResumen(fichas) {
  const cuenta = (g) => fichas.filter((f) => f.grupo === g).length;
  const dinero = (g) => fichas.filter((f) => f.grupo === g).reduce((t, f) => t + Number(f.precio || 0), 0);
  return `
    <div class="cards">
      <div class="card card--accent">
        <div class="card__label">Al día</div>
        <div class="card__value">${cuenta("alDia")}</div>
        <div class="card__hint">clientes con su corte más adelante</div>
      </div>
      <div class="card">
        <div class="card__label">Por vencer</div>
        <div class="card__value">${cuenta("porVencer")}</div>
        <div class="card__hint">corte en los próximos 7 días</div>
      </div>
      <div class="card">
        <div class="card__label">Vencidos</div>
        <div class="card__value">${cuenta("vencidos")}</div>
        <div class="card__hint">${esc(fmtMoney(dinero("vencidos")))} por cobrar</div>
      </div>
    </div>`;
}

function fila(f) {
  return `
    <tr>
      <td>
        <strong>${esc(f.nombre)}</strong>
        <div class="muted" style="font-size:0.82rem;">${esc(f.telefono || "sin teléfono")}${f.sinServicio ? " · sin servicio registrado" : ""}</div>
      </td>
      <td>${badgeEstado(f.estado)}</td>
      <td>${esc(fmtFecha(f.corte))}<div class="muted" style="font-size:0.82rem;">${esc(etiquetaCorte(f.ciclo))}</div></td>
      <td>${esc(textoCuandoVence(f.dias))}</td>
      <td class="muted" style="font-size:0.82rem;">${esc(fmtFecha(f.aviso1))} y ${esc(fmtFecha(f.aviso2))}</td>
      <td>${esc(fmtMoney(f.precio))}</td>
      <td>
        <a class="btn btn--ghost" href="cliente.html?id=${esc(f.id)}">Ver ficha</a>
        <a class="btn btn--ghost" href="pagos.html">Registrar pago</a>
      </td>
    </tr>`;
}

function tabla(grupo, fichas) {
  const delGrupo = fichas.filter((f) => f.grupo === grupo.key);
  if (!delGrupo.length) {
    return `<div class="panel"><h2>${grupo.titulo}</h2><div class="empty">Ningún cliente en este grupo.</div></div>`;
  }
  return `
    <div class="panel">
      <h2>${grupo.titulo} <span class="badge-estado ${grupo.tono}">${delGrupo.length}</span></h2>
      <p class="muted" style="margin:-6px 0 14px;font-size:0.86rem;">${grupo.ayuda}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th><th>Estado</th><th>Fecha de corte</th><th>Cuándo</th>
              <th>Se le avisa</th><th>Valor mensual</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>${delGrupo.map(fila).join("")}</tbody>
        </table>
      </div>
    </div>`;
}

function render(fichas) {
  const cont = document.getElementById("app-content");
  const hoy = hoyColombia();
  cont.innerHTML = `
    <div class="toolbar">
      <div class="toolbar__left">
        <div>
          <h1 style="font-family:var(--font-display);font-size:1.5rem;margin:0;">Vencimientos</h1>
          <p class="muted" style="margin:6px 0 0;font-size:0.9rem;">Hoy es ${esc(fmtFecha(hoy))}. Cada cliente recibe dos avisos: 3 días antes de su corte y el día del corte, a las 10:00 a.m.</p>
        </div>
      </div>
      <a class="btn btn--ghost" href="dashboard.html">Volver al inicio</a>
    </div>
    ${tarjetaResumen(fichas)}
    ${GRUPOS.map((g) => tabla(g, fichas)).join("")}
    <p class="muted" style="font-size:0.82rem;margin-top:16px;">
      Los avisos los prepara el sistema y quedan en <a href="notificaciones.html">Recordatorios</a> con su estado
      (Pendiente, Enviado o Fallido). El envío al cliente se hace hoy por WhatsApp Business de forma manual,
      con el mensaje ya redactado en la lista de cobro.
    </p>`;
}

(async function main() {
  ctx = await requireAuth("vencimientos");
  if (!ctx) return;

  const cont = document.getElementById("app-content");
  cont.innerHTML = '<div class="empty">Cargando clientes…</div>';

  try {
    const [cliSnap, svcSnap] = await Promise.all([
      getDocs(collection(db, "clientes")),
      getDocs(collection(db, "servicios"))
    ]);
    clientes = cliSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    servicios = svcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const fichas = clientes.map(preparar);
    /* Primero lo que duele: vencidos, después por vencer, y al final el resto. */
    const orden = { vencidos: 0, porVencer: 1, alDia: 2 };
    fichas.sort((a, b) => (orden[a.grupo] - orden[b.grupo]) || String(a.corte).localeCompare(String(b.corte)));
    render(fichas);
  } catch (err) {
    console.error(err);
    cont.innerHTML = '<div class="empty">No fue posible cargar los vencimientos. Revisa tu conexión e intenta de nuevo.</div>';
  }
})();
