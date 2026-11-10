/* UNEFIBRA-041: consulta comercial. Sin escrituras. */
import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { collection, getDocs } from "firebase/firestore";
import { esc, fmtFecha, badgeEstado, hoyColombia } from "../assets/js/admin/ui.js";
import "../assets/js/admin/consistencia-comercial.js";
const Comercial = globalThis.ConsistenciaComercial;

function fila(f) {
  return `<tr>
    <td data-label="Cliente / estado"><div><strong>${esc(f.nombre)}</strong><div class="muted">${badgeEstado(f.estado)}</div></div></td>
    <td data-label="Vencimiento registrado"><div>${esc(fmtFecha(f.fecha))}<div class="muted">${f.dias === null ? "Sin fecha válida" : f.dias < 0 ? Math.abs(f.dias) + " día(s) atrás" : f.dias === 0 ? "Hoy" : "En " + f.dias + " día(s)"}</div></div></td>
    <td data-label="Próximo corte"><div>${esc(fmtFecha(f.corte))}<div class="muted">${f.corte ? "Ciclo " + esc(f.ciclo) : "Corte por confirmar"}</div></div></td>
    <td data-label="Pago / validación"><div>${esc(f.situacion)}${f.motivos.length ? "<ul>" + f.motivos.map((m) => "<li>" + esc(m) + "</li>").join("") + "</ul>" : ""}</div></td>
    <td data-label="Valor mensual"><div>${esc(Comercial.precioTexto(f.precio))}</div></td>
    <td data-label="Consulta"><div><a class="btn btn--ghost" href="cliente.html?id=${encodeURIComponent(f.id)}">Ver ficha</a></div></td>
  </tr>`;
}

function render(fichas, hoy) {
  const conteos = Comercial.resumen(fichas);
  document.getElementById("app-content").innerHTML = `
    <div class="toolbar"><div><h1>Vencimientos</h1><p class="muted">Fecha de consulta: ${esc(fmtFecha(hoy))}</p></div><a class="btn btn--ghost" href="dashboard.html">Volver al inicio</a></div>
    <div class="panel"><p>El <strong>próximo corte</strong> es una fecha del calendario 15/30. El <strong>vencimiento registrado</strong> conserva la fecha almacenada, incluso si ya pasó.</p><p>Una fecha atrasada o la ausencia de pagos no confirma deuda. Los registros pendientes requieren validación comercial.</p></div>
    <div class="cards">${Comercial.GRUPOS.map((g) => '<div class="card"><div class="card__label">' + g.titulo + '</div><div class="card__value">' + conteos[g.key] + '</div><div class="card__hint">' + g.ayuda + '</div></div>').join("")}</div>
    ${Comercial.GRUPOS.map((g) => {
      const filas = fichas.filter((f) => f.grupo === g.key);
      return '<div class="panel"><h2>' + g.titulo + ' (' + filas.length + ')</h2><p class="muted">' + g.ayuda + '</p>' + (filas.length ? '<div class="table-wrap"><table class="comercial-tabla"><thead><tr><th>Cliente / estado administrativo</th><th>Vencimiento registrado</th><th>Próximo corte</th><th>Situación de pago / validación</th><th>Valor mensual</th><th>Consulta</th></tr></thead><tbody>' + filas.map(fila).join("") + '</tbody></table></div>' : '<div class="empty">Ningún cliente en este grupo.</div>') + '</div>';
    }).join("")}`;
}

(async function main() {
  if (!await requireAuth("vencimientos")) return;
  const cont = document.getElementById("app-content");
  cont.innerHTML = '<div class="empty">Cargando información comercial…</div>';
  try {
    const snapshots = await Promise.all(["clientes", "servicios", "pagos"].map((nombre) => getDocs(collection(db, nombre))));
    const [clientes, servicios, pagos] = snapshots.map((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    const hoy = hoyColombia();
    const fichas = Comercial.prepararTodos(clientes, servicios, pagos, hoy).map((f, i) => ({ ...f,
      nombre: clientes[i].nombreCompleto || clientes[i].nombre || "(sin nombre)",
      estado: clientes[i].estadoCliente || clientes[i].estado || "" }));
    fichas.sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
    render(fichas, hoy);
  } catch (err) {
    console.error("No se pudo cargar la consulta comercial", err);
    cont.innerHTML = '<div class="empty">No fue posible cargar los vencimientos. Revisa tu conexión y permisos; no se calcularon indicadores parciales.</div>';
  }
})();
