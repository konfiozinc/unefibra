/* ============================================================
 * UneFibra SAS — Admin: dashboard
 * ------------------------------------------------------------
 * Todos los indicadores provienen de Firestore (sin datos
 * simulados). Si no hay datos, se muestran ceros reales.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import "../assets/js/admin/consistencia-comercial.js";
const Comercial = globalThis.ConsistenciaComercial;
import { proximoCorteDe, fmtFecha, recordatoriosDelCorte } from "../assets/js/admin/ui.js";
import {
  collection, query, where, getCountFromServer, getAggregateFromServer, sum, getDocs
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

async function resumenComercial(hoy) {
  const datos = await Promise.all(["clientes", "servicios", "pagos"].map((nombre) => getDocs(collection(db, nombre))));
  const [clientes, servicios, pagos] = datos.map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  return Comercial.resumen(Comercial.prepararTodos(clientes, servicios, pagos, hoy));
}

/** Clientes asignados a un ciclo de corte ("15" o "30"). */
async function contarPorCiclo(ciclo) {
  const q = query(collection(db, "clientes"), where("cicloCorte", "==", ciclo));
  return (await getCountFromServer(q)).data().count;
}

/** Servicios importados que todavía esperan revisión comercial (KZ-UNEF-031). */
async function contarRevisionPendiente() {
  const q = query(collection(db, "servicios"), where("conciliacion.estado", "==", "PENDIENTE_VALIDACION"));
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

    const [
      activos, pendientes, suspendidos, inactivos,
      pagosMes, comercial,
      corte15, corte30
    ] = await Promise.all([
      contarPorEstado("ACTIVO"),
      contarPorEstado("PENDIENTE_PAGO"),
      contarPorEstado("SUSPENDIDO"),
      contarPorEstado("INACTIVO"),
      pagosDelMes(),
      resumenComercial(hoy),
      contarPorCiclo("15"),
      contarPorCiclo("30")
    ]);

    const proximo15 = fmtFecha(proximoCorteDe("15"));
    const proximo30 = fmtFecha(proximoCorteDe("30"));
    /* KZ-UNEF-031 · Cuántos servicios esperan revisión comercial. Si falla, no
       rompe el tablero: se muestra sin el número. */
    const porRevisar = await contarRevisionPendiente().catch(() => null);

    content.innerHTML = `
      <div class="cards">
        ${card("Clientes Corte 15", corte15, { tone: "tone-cyan", accent: true, hint: `Próximo corte: ${proximo15}` })}
        ${card("Clientes Corte 30", corte30, { tone: "tone-cyan", accent: true, hint: `Próximo corte: ${proximo30}` })}

        ${card("Estado administrativo: activo", activos, { tone: "tone-green", hint: "Estado guardado; no certifica pagos" })}
        ${card("Estado administrativo: pendiente de pago", pendientes, { tone: "tone-amber", hint: "Estado guardado; requiere evidencia comercial" })}
        ${card("Suspendidos", suspendidos, { tone: "tone-red", hint: "Servicio suspendido" })}
        ${card("Inactivos", inactivos, { tone: "tone-violet", hint: "Retirados o cancelados" })}

        ${card("Pagos del mes", pagosMes.cantidad, { tone: "tone-cyan", accent: true, hint: "Pagos confirmados este mes" })}
        ${card("Ingresos del mes", fmtMoney(pagosMes.total), { tone: "tone-cyan", accent: true, hint: "Suma de pagos confirmados" })}
        ${Comercial.GRUPOS.map((g) => card(g.titulo, comercial[g.key], { tone: "tone-amber", hint: g.ayuda })).join("")}
      </div>

      <div class="panel" style="margin-top:16px;">
        <h2>Próximos cortes</h2>
        <div class="kv">
          <div class="kv__item"><span class="kv__k">Corte 15</span><span>${proximo15} · ${corte15} cliente(s)</span></div>
          <div class="kv__item"><span class="kv__k">Corte 30</span><span>${proximo30} · ${corte30} cliente(s)</span></div>
        </div>
        <p class="muted" style="font-size:0.82rem;margin-top:10px;">
          El corte del ciclo 30 cae el último día del mes cuando el mes no llega a 30 (febrero).
        </p>
        <div style="margin-top:14px;">
          <a class="btn btn--primary" href="vencimientos.html">Consultar vencimientos y validación</a>
        </div>
      </div>

      <div class="panel" style="margin-top:16px;">
        <h2>Calendario de avisos por corte</h2>
        <p class="muted" style="font-size:0.88rem;margin-bottom:12px;">
          Fechas previstas: tres días antes del corte y el día del corte, a las 10:00 a.m. La programación no confirma deuda ni entrega del aviso.
        </p>
        <div class="kv">
          ${[
            { etiqueta: "Corte 15", corte: proximoCorteDe("15") },
            { etiqueta: "Corte 30", corte: proximoCorteDe("30") }
          ].map(({ etiqueta, corte }) => {
            const [a1, a2] = recordatoriosDelCorte(corte);
            return `<div class="kv__item"><span class="kv__k">${etiqueta}</span><span>${fmtFecha(a1.fecha)} y ${fmtFecha(a2.fecha)} · corte ${fmtFecha(corte)}</span></div>`;
          }).join("")}
        </div>
        <div style="margin-top:14px;">
          <a class="btn btn--ghost" href="notificaciones.html">Ver recordatorios enviados</a>
        </div>
      </div>

      <div class="panel" style="margin-top:16px;">
        <h2>Datos comerciales por revisar</h2>
        <p class="muted" style="font-size:0.88rem;margin-bottom:12px;">
          ${porRevisar === null
            ? "No se pudo contar ahora mismo cuántos servicios esperan revisión."
            : `Hay <strong>${porRevisar}</strong> servicio(s) importados a los que les falta confirmar el valor mensual, el día de corte o la fecha de cobro. Confirmar un dato no activa el cobro.`}
        </p>
        <a class="btn btn--primary" href="revision-clientes.html">Revisar y confirmar datos</a>
      </div>`;
  } catch (err) {
    console.error("Error al cargar el dashboard:", err);
    content.innerHTML = '<div class="card">No fue posible cargar los indicadores. Verifica tu conexión y permisos, e inténtalo de nuevo.</div>';
  }
})();
