/* ============================================================
 * UneFibra SAS — Conciliación de servicios (KZ-UNEF-007)
 * ------------------------------------------------------------
 * Módulo administrativo para revisar la cartera importada, preparar los
 * documentos de servicio que faltan y habilitarlos cuando una persona haya
 * comprobado sus condiciones.
 *
 * Tres operaciones SEPARADAS (permisos y auditoría propios en el servidor):
 *   PREPARAR  → crea el servicio y nace PENDIENTE_VALIDACION
 *   VALIDAR   → queda VALIDADA (revisado, todavía NO sujeto al motor)
 *   HABILITAR → queda HABILITADA (vuelve a la operación normal)
 *
 * El navegador NO decide nada: cada acción llama a una Cloud Function que
 * vuelve a validar el estado real. Los botones solo reflejan lo que el
 * servidor permite.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs } from "firebase/firestore";
import { esc, fmtFecha, fmtMoney } from "../assets/js/admin/ui.js";

let ctx = null;
let clientes = [];
let servicios = [];
let porCliente = new Map();
let filas = [];
let vista = "todos";           // todos | pendientes | validados | habilitados | incompletos
let busqueda = "";
let orden = "nombre";          // nombre | vencimiento | clase
let pagina = 1;
const POR_PAGINA = 25;
let seleccion = new Set();

const VALIDOS_CLIENTE = ["ACTIVO", "PENDIENTE_PAGO", "SUSPENDIDO", "INACTIVO"];

const puedeGestionar = () => ctx && ["ADMIN", "SUPERADMIN"].includes(ctx.rol);

/* ---------- utilidades de clasificación (espejo de functions/src/migracion.js) ---------- */

const esFecha = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function fechaOperacion() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function ipValida(v) {
  if (v === null || v === undefined || String(v).trim() === "") return "AUSENTE";
  const t = String(v).trim().replace(/\/\d+$/, "");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return "MALFORMADA";
  const p = t.split(".").map(Number);
  return p.some((n) => n < 0 || n > 255) ? "MALFORMADA" : "VALIDA";
}

/** Motivos por los que un cliente no puede convertirse en servicio. */
function motivosIncompleto(c) {
  const m = [];
  if (!c.planId) m.push("sin plan");
  if (!(typeof c.precioMensual === "number" && c.precioMensual > 0)) m.push("sin precio");
  if (!esFecha(c.fechaVencimiento)) m.push("sin vencimiento");
  if (!VALIDOS_CLIENTE.includes(c.estadoCliente)) m.push("estado fuera del modelo");
  return m;
}

/** Clase de cada cliente dentro del módulo. */
function clasificar(c) {
  const suyos = porCliente.get(c.id) || [];
  if (suyos.length > 1) return { clase: "AMBIGUO", etiqueta: "Ambiguo", detalle: `${suyos.length} servicios` };
  if (suyos.length === 1) {
    const servicio = suyos[0];
    const estado = (servicio.conciliacion || {}).estado || null;
    const vencimiento = servicio.fechaVencimiento || c.fechaVencimiento;
    const avisos = [];
    if (c.estadoCliente === "SUSPENDIDO") avisos.push("cliente suspendido: habilitación bloqueada");
    if (esFecha(vencimiento) && vencimiento < fechaOperacion()) avisos.push("servicio vencido: requiere autorización");
    const detalle = avisos.join(" · ");
    if (estado === "HABILITADA") return { clase: "HABILITADO", etiqueta: "Habilitado", servicioId: servicio.id, detalle };
    if (estado === "VALIDADA") return { clase: "VALIDADO", etiqueta: "Validado (sin habilitar)", servicioId: servicio.id, detalle };
    if (estado === "RECHAZADA") return { clase: "RECHAZADO", etiqueta: "Rechazado", servicioId: servicio.id, detalle };
    if (estado === "PENDIENTE_VALIDACION") return { clase: "PENDIENTE", etiqueta: "Conciliación pendiente", servicioId: servicio.id, detalle };
    return { clase: "CON_SERVICIO", etiqueta: "Con servicio", servicioId: servicio.id, detalle };
  }
  const faltan = motivosIncompleto(c);
  if (faltan.length) return { clase: "INCOMPLETO", etiqueta: "Revisión manual", detalle: faltan.join(", ") };
  return { clase: "CANDIDATO", etiqueta: "Candidato", detalle: "datos completos" };
}

/* ---------- render ---------- */

function indicadores() {
  const cuenta = (k) => filas.filter((f) => f.clase === k).length;
  const tarjeta = (titulo, valor, nota, tono) => `
    <div class="card" style="flex:1 1 160px;min-width:150px">
      <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em">${esc(titulo)}</div>
      <div style="font-size:26px;font-weight:800;color:${tono || "inherit"}">${valor}</div>
      <div class="muted" style="font-size:12px">${esc(nota)}</div>
    </div>`;

  return `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      ${tarjeta("Clientes", clientes.length, "registrados", "")}
      ${tarjeta("Servicios", servicios.length, "documentos existentes", "")}
      ${tarjeta("Candidatos", cuenta("CANDIDATO"), "listos para preparar", "#0ea5e9")}
      ${tarjeta("Revisión manual", cuenta("INCOMPLETO"), "datos incompletos", "#f59e0b")}
      ${tarjeta("Pendientes", cuenta("PENDIENTE"), "en conciliación", "#a855f7")}
      ${tarjeta("Habilitados", cuenta("HABILITADO"), "en el motor", "#10b981")}
    </div>`;
}

function barra() {
  return `
    <div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div class="search"><input id="buscar" type="search" placeholder="Buscar por nombre, documento o id…" value="${esc(busqueda)}" aria-label="Buscar cliente" /></div>
      <select id="vista" aria-label="Filtrar por estado">
        ${[["todos", "Todos"], ["pendientes", "En conciliación"], ["validados", "Validados"], ["habilitados", "Habilitados"], ["rechazados", "Rechazados"], ["incompletos", "Revisión manual"], ["candidatos", "Candidatos"]]
          .map(([k, t]) => `<option value="${k}"${vista === k ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <select id="orden" aria-label="Ordenar">
        ${[["nombre", "Por nombre"], ["vencimiento", "Por vencimiento"], ["clase", "Por estado"]]
          .map(([k, t]) => `<option value="${k}"${orden === k ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <button class="btn btn--ghost" id="exportar">Exportar CSV</button>
      ${puedeGestionar() ? '<span class="muted" id="sel-info" style="margin-left:auto">0 seleccionados</span>' : ""}
    </div>`;
}

function etiquetaClase(f) {
  const tonos = {
    CANDIDATO: "tone-cyan", INCOMPLETO: "tone-amber", PENDIENTE: "tone-violet",
    VALIDADO: "tone-blue", HABILITADO: "tone-green", RECHAZADO: "tone-red",
    AMBIGUO: "tone-red", CON_SERVICIO: "tone-green"
  };
  return `<span class="badge-estado ${tonos[f.clase] || ""}">${esc(f.etiqueta)}</span>`;
}

function tabla() {
  const filtradas = listaFiltrada();
  const total = filtradas.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (pagina > paginas) pagina = paginas;
  const desde = (pagina - 1) * POR_PAGINA;
  const trozo = filtradas.slice(desde, desde + POR_PAGINA);

  const filasHtml = trozo.map((f) => `
    <tr data-id="${esc(f.id)}">
      ${puedeGestionar() ? `<td><input type="checkbox" class="sel" data-id="${esc(f.id)}"${seleccion.has(f.id) ? " checked" : ""} aria-label="Seleccionar ${esc(f.nombre)}" /></td>` : ""}
      <td>${esc(f.nombre)}</td>
      <td>${etiquetaClase(f)}</td>
      <td class="muted">${esc(f.detalle || "—")}</td>
      <td>${f.vencimiento ? fmtFecha(f.vencimiento) : '<span class="muted">sin fecha</span>'}</td>
      <td class="muted">${f.precio ? fmtMoney(f.precio) : "—"}</td>
      <td><button class="btn btn--sm btn--ghost" data-ver="${esc(f.id)}">Detalle</button></td>
    </tr>`).join("");

  return `
    ${filasHtml ? `
    <p class="conc-table-hint">Desliza la tabla horizontalmente para consultar vencimiento, precio y abrir el detalle.</p>
    <div class="conc-table-wrap" tabindex="0" aria-label="Tabla de conciliación; desplazamiento horizontal disponible">
      <table>
        <thead><tr>
          ${puedeGestionar() ? "<th></th>" : ""}
          <th>Cliente</th><th>Estado</th><th>Observación</th><th>Vencimiento</th><th>Precio</th><th></th>
        </tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn--sm btn--ghost" id="prev"${pagina <= 1 ? " disabled" : ""}>Anterior</button>
      <span class="muted">Página ${pagina} de ${paginas} · ${total} registros</span>
      <button class="btn btn--sm btn--ghost" id="next"${pagina >= paginas ? " disabled" : ""}>Siguiente</button>
      ${puedeGestionar() ? `<button class="btn btn--sm" id="lote-simular">Simular tanda</button>
      <button class="btn btn--sm btn--primary" id="lote-habilitar">Habilitar tanda</button>` : ""}
    </div>` : '<div class="empty">No hay registros para este filtro.</div>'}`;
}

function listaFiltrada() {
  const q = busqueda.trim().toLowerCase();
  let l = filas.filter((f) => {
    if (vista === "pendientes") return f.clase === "PENDIENTE";
    if (vista === "validados") return f.clase === "VALIDADO";
    if (vista === "habilitados") return f.clase === "HABILITADO";
    if (vista === "rechazados") return f.clase === "RECHAZADO";
    if (vista === "incompletos") return f.clase === "INCOMPLETO";
    if (vista === "candidatos") return f.clase === "CANDIDATO";
    return true;
  });
  if (q) l = l.filter((f) => (f.nombre || "").toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  l.sort((a, b) => {
    if (orden === "vencimiento") return String(a.vencimiento || "9999").localeCompare(String(b.vencimiento || "9999"));
    if (orden === "clase") return a.clase.localeCompare(b.clase);
    return String(a.nombre || "").localeCompare(String(b.nombre || ""));
  });
  return l;
}

/** Ficha con la clasificación de cada dato: confirmado / heredado / faltante / inconsistente. */
function fichas(f) {
  const c = clientes.find((x) => x.id === f.id) || {};
  const servicio = (porCliente.get(f.id) || [{}])[0];
  const marca = (estado, texto) => {
    const tonos = { confirmada: "#10b981", heredada: "#f59e0b", faltante: "#ef4444", inconsistente: "#a855f7" };
    return `<span style="color:${tonos[estado]};font-size:12px;font-weight:600">${esc(texto)}</span>`;
  };
  const dato = (titulo, valor, estado, nota) => `
    <div style="padding:8px 0;border-bottom:1px solid rgba(128,128,128,.18)">
      <div class="muted" style="font-size:12px">${esc(titulo)}</div>
      <div style="font-weight:600">${valor === null || valor === undefined || valor === "" ? '<span class="muted">—</span>' : esc(String(valor))}</div>
      <div>${marca(estado, estado.toUpperCase())}${nota ? ` <span class="muted" style="font-size:12px">${esc(nota)}</span>` : ""}</div>
    </div>`;

  const venc = c.fechaVencimiento;
  const estadoVenc = !venc ? "faltante" : !esFecha(venc) ? "inconsistente" : "heredada";
  const precioEstado = typeof c.precioMensual === "number" && c.precioMensual > 0 ? "heredada" : "faltante";
  const planEstado = c.planId ? "heredada" : "faltante";
  const ipClase = ipValida(c.ip);
  const estadoClienteOk = VALIDOS_CLIENTE.includes(c.estadoCliente);
  const fechaServicio = servicio.fechaVencimiento || venc;
  const estaVencido = esFecha(fechaServicio) && fechaServicio < fechaOperacion();
  const estaSuspendido = c.estadoCliente === "SUSPENDIDO";
  const avisoRiesgo = f.clase === "VALIDADO" && (estaVencido || estaSuspendido) ? `
    <div class="conc-risk ${estaSuspendido ? "conc-risk--blocked" : "conc-risk--expired"}" role="alert">
      <strong>${estaSuspendido ? "Habilitación bloqueada: cliente suspendido" : "Servicio vencido: requiere autorización expresa"}</strong>
      <span>${estaSuspendido
        ? "La validación no elimina la suspensión administrativa. Este servicio no puede habilitarse desde esta ficha."
        : "Habilitarlo lo devuelve al motor automático y puede provocar una suspensión en la próxima corrida."}</span>
    </div>` : "";

  return `
    <div class="modal-backdrop" id="detalle">
      <div class="modal conc-modal" role="dialog" aria-modal="true" aria-labelledby="conc-titulo" style="max-width:640px">
        <header class="conc-modal-header">
          <div class="conc-modal-titulo">
            <h2 id="conc-titulo">${esc(f.nombre)}</h2>
            <p class="muted">${esc(f.etiqueta)}${f.detalle ? " · " + esc(f.detalle) : ""}</p>
          </div>
          <button class="conc-modal-close" id="cerrar-detalle-x" type="button" aria-label="Cerrar detalle">×</button>
        </header>
        <div class="conc-modal-body">
          ${avisoRiesgo}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 18px">
            ${dato("Cliente (solo lectura)", f.nombre, "confirmada")}
            ${dato("Plan", c.planId || null, planEstado, "heredado de la importación")}
            ${dato("Precio mensual", c.precioMensual ? fmtMoney(c.precioMensual) : null, precioEstado)}
            ${dato("Ciclo de corte", c.cicloCorte || null, c.cicloCorte ? "heredada" : "faltante")}
            ${dato("Fecha de vencimiento", venc || null, estadoVenc)}
            ${dato("Fecha de instalación", c.fechaInicioServicio || null, c.fechaInicioServicio ? "heredada" : "faltante")}
            ${dato("Dirección IP", c.ip || null, ipClase === "VALIDA" ? "heredada" : "faltante",
              ipClase === "VALIDA" ? "formato correcto" : ipClase === "MALFORMADA" ? "malformada: no se usa para MikroTik" : "ausente")}
            ${dato("Estado administrativo", c.estadoCliente || null, estadoClienteOk ? "heredada" : "inconsistente")}
            ${dato("Estado del servicio", servicio.estado || null, "confirmada", "campo distinto del cliente")}
            ${dato("Origen del registro", c.importado === false ? "alta administrativa" : "importación", "confirmada")}
          </div>
        </div>
        <footer class="conc-modal-footer">
          <button class="btn btn--ghost" id="cerrar-detalle">Cerrar</button>
          ${puedeGestionar() && f.clase === "CANDIDATO" ? '<button class="btn btn--primary" id="accion-preparar">Preparar servicio</button>' : ""}
          ${puedeGestionar() && f.clase === "PENDIENTE" ? '<button class="btn btn--primary" id="accion-validar">Validar</button>' : ""}
          ${puedeGestionar() && f.clase === "VALIDADO" ? `<button class="btn btn--warning" id="accion-habilitar"${estaSuspendido ? " disabled" : ""}>${estaSuspendido ? "Habilitación bloqueada" : estaVencido ? "Habilitar vencido" : "Habilitar"}</button>` : ""}
        </footer>
      </div>
    </div>`;
}

/* ---------- acciones ---------- */

async function accion(nombre, datos, exito) {
  try {
    const r = await call(nombre)(datos);
    alert(`${exito}\n\n${JSON.stringify(r && r.data ? r.data : r, null, 1).slice(0, 400)}`);
    await cargar();
  } catch (err) {
    console.error(err);
    alert("No se pudo completar: " + (err && err.message ? err.message : String(err)));
  }
}

function exportarCsv() {
  const l = listaFiltrada();
  const cabecera = "cliente_id;clase;vencimiento;precio;ip_estado";
  const cuerpo = l.map((f) => {
    const c = clientes.find((x) => x.id === f.id) || {};
    return [f.id, f.clase, f.vencimiento || "", c.precioMensual || "", ipValida(c.ip)].join(";");
  }).join("\n");
  const blob = new Blob([cabecera + "\n" + cuerpo], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "conciliacion-servicios.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Pide al SERVIDOR la situación real de cada servicio antes de hacer nada. */
async function evaluarAntes(ids) {
  const r = await call("evaluarServiciosConciliacion")({ servicioIds: ids });
  return r && r.data ? r.data : null;
}

function resumenTexto(info) {
  const c = (info && info.resumen && info.resumen.conteo) || {};
  const linea = (k, t) => (c[k] ? `${t}: ${c[k]}\n` : "");
  return "Resumen del servidor:\n\n"
    + linea("AL_DIA", "Al día")
    + linea("VENCE_HOY", "Vence hoy")
    + linea("VENCIDO", "Vencidos")
    + linea("SUSPENDIDO", "Cliente suspendido")
    + linea("FECHA_INVALIDA", "Fecha inválida (bloqueado)")
    + linea("CONTRADICTORIO", "Información contradictoria (bloqueado)")
    + linea("BLOQUEADO_EN_FLUJO", "Sin validar (no habilitable)")
    + `\nSe habilitarían ahora: ${info.resumen.habilitables}`
    + `\nRequieren autorización expresa (vencidos): ${info.resumen.requierenAutorizacion}`
    + `\nBloqueados: ${info.resumen.bloqueados}`;
}

async function lote(simular) {
  const ids = [...seleccion].map((id) => (filas.find((f) => f.id === id) || {}).servicioId).filter(Boolean);
  if (!ids.length) { alert("Selecciona clientes que ya tengan servicio para habilitar."); return; }
  if (ids.length > 50) { alert("La tanda no puede pasar de 50 servicios."); return; }

  let info;
  try { info = await evaluarAntes(ids); } catch (err) { alert("No se pudo evaluar la tanda: " + err.message); return; }
  if (!info) { alert("El servidor no devolvió la evaluación."); return; }

  const vencidos = (info.detalle || []).filter((d) => d.existe && d.evaluacion.situacion === "VENCIDO").map((d) => d.servicioId);

  if (simular) {
    await accion("habilitarServiciosLote", { servicioIds: ids, simular: true },
      "SIMULACIÓN (no se escribió nada)\n\n" + resumenTexto(info));
    return;
  }

  if (!confirm(resumenTexto(info) + "\n\n¿Continuar? Los vencidos NO se habilitarán sin autorización expresa.")) return;

  let autorizar = [];
  let justificacion = "";
  if (vencidos.length) {
    if (!confirm(`Hay ${vencidos.length} servicio(s) VENCIDO(S).\n\nHabilitarlos los expone al motor de cortes: el cliente podría suspenderse en la próxima corrida.\n\n¿Autorizas habilitar esos vencidos?`)) {
      alert("Se habilitarán solo los que están al día.");
    } else {
      justificacion = prompt("Justificación de la autorización (mínimo 10 caracteres):") || "";
      if (justificacion.trim().length < 10) {
        alert("Sin justificación válida no se autoriza ningún vencido. Se habilitarán solo los que están al día.");
        justificacion = "";
      } else {
        autorizar = vencidos;
      }
    }
  }

  await accion("habilitarServiciosLote", { servicioIds: ids, autorizarVencidos: autorizar, justificacion }, "Tanda procesada");
}

/** Habilitación individual con aviso del riesgo real (calculado en el servidor). */
async function habilitarIndividual(servicioId) {
  let info;
  try { info = await evaluarAntes([servicioId]); } catch (err) { alert("No se pudo evaluar: " + err.message); return; }
  const ev = info && info.detalle && info.detalle[0] && info.detalle[0].evaluacion;
  if (!ev) { alert("El servidor no devolvió la evaluación del servicio."); return; }

  let texto = `Situación: ${ev.etiqueta}\nVencimiento: ${ev.vencimiento || "—"}\n`;
  if (ev.dias !== null && ev.dias !== undefined) texto += `Días: ${ev.dias}\n`;
  if (ev.consecuencias && ev.consecuencias.length) texto += "\n" + ev.consecuencias.join("\n") + "\n";
  texto += "\nVALIDAR NO ES HABILITAR: al habilitar, este servicio pasa a ser procesado por el motor automático.";

  if (!ev.puedeHabilitar) { alert("NO SE PUEDE HABILITAR\n\n" + texto + "\n\nMotivo: " + (ev.motivos || []).join("; ")); return; }

  if (ev.requiereAutorizacionVencido) {
    if (!confirm("SERVICIO VENCIDO\n\n" + texto + "\n\n¿Autorizas exponerlo al motor de cortes?")) return;
    const just = prompt("Justificación (mínimo 10 caracteres):") || "";
    if (just.trim().length < 10) { alert("Sin justificación no se habilita."); return; }
    await accion("habilitarServicio", { servicioId, autorizarVencido: true, justificacion: just.trim() }, "Servicio habilitado (con autorización de vencido)");
    return;
  }

  if (!confirm(texto + "\n\n¿Habilitar?")) return;
  await accion("habilitarServicio", { servicioId }, "Servicio habilitado");
}

/* ---------- carga ---------- */

async function cargar() {
  const [cliSnap, servSnap] = await Promise.all([
    getDocs(collection(db, "clientes")),
    getDocs(collection(db, "servicios"))
  ]);
  clientes = cliSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  servicios = servSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  porCliente = new Map();
  for (const s of servicios) {
    if (!s.clienteId) continue;
    if (!porCliente.has(s.clienteId)) porCliente.set(s.clienteId, []);
    porCliente.get(s.clienteId).push(s);
  }
  filas = clientes.map((c) => {
    const cl = clasificar(c);
    return {
      id: c.id,
      nombre: c.nombreCompleto || c.id,
      vencimiento: esFecha(c.fechaVencimiento) ? c.fechaVencimiento : null,
      precio: typeof c.precioMensual === "number" ? c.precioMensual : null,
      ...cl
    };
  });
  pintar();
}

function pintar() {
  const cont = document.getElementById("app-content");
  cont.innerHTML = indicadores() + barra() + tabla() + '<div id="detalle-root"></div>';
  conectar();
}

function conectar() {
  document.getElementById("buscar").addEventListener("input", (e) => { busqueda = e.target.value; pagina = 1; pintar(); });
  document.getElementById("vista").addEventListener("change", (e) => { vista = e.target.value; pagina = 1; pintar(); });
  document.getElementById("orden").addEventListener("change", (e) => { orden = e.target.value; pintar(); });
  document.getElementById("exportar").addEventListener("click", exportarCsv);

  const prev = document.getElementById("prev"), next = document.getElementById("next");
  if (prev) prev.addEventListener("click", () => { pagina--; pintar(); });
  if (next) next.addEventListener("click", () => { pagina++; pintar(); });

  const sim = document.getElementById("lote-simular"), hab = document.getElementById("lote-habilitar");
  if (sim) sim.addEventListener("click", () => lote(true));
  if (hab) hab.addEventListener("click", () => lote(false));

  document.querySelectorAll(".sel").forEach((chk) => chk.addEventListener("change", (e) => {
    if (e.target.checked) seleccion.add(e.target.dataset.id); else seleccion.delete(e.target.dataset.id);
    const info = document.getElementById("sel-info");
    if (info) info.textContent = `${seleccion.size} seleccionados`;
  }));

  document.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", () => {
    const f = filas.find((x) => x.id === b.dataset.ver);
    const root = document.getElementById("detalle-root");
    const disparador = b;
    root.innerHTML = fichas(f);
    const cerrar = () => {
      root.innerHTML = "";
      document.removeEventListener("keydown", cerrarConEscape);
      /* Al cerrar, el foco vuelve al boton que abrio el dialogo. */
      if (disparador && typeof disparador.focus === "function") disparador.focus();
    };
    const cerrarConEscape = (e) => { if (e.key === "Escape") cerrar(); };
    const cerrarDetalle = cerrar;
        document.getElementById("cerrar-detalle").addEventListener("click", cerrarDetalle);
        document.getElementById("cerrar-detalle-x").addEventListener("click", cerrarDetalle);
        const aspaDetalle = document.getElementById("cerrar-detalle-x");
        if (aspaDetalle) aspaDetalle.focus();
    document.getElementById("cerrar-detalle-x").addEventListener("click", cerrar);
    document.getElementById("detalle").addEventListener("click", (e) => { if (e.target.id === "detalle") cerrar(); });
    document.addEventListener("keydown", cerrarConEscape);
    const prep = document.getElementById("accion-preparar");
    if (prep) prep.addEventListener("click", () => accion("prepararServicioConciliacion", { clienteId: f.id }, "Servicio preparado en conciliación"));
    const val = document.getElementById("accion-validar");
    if (val) val.addEventListener("click", () => accion("validarServicioConciliado", { servicioId: f.servicioId }, "Servicio validado (aún no habilitado)"));
    const hab2 = document.getElementById("accion-habilitar");
    if (hab2) hab2.addEventListener("click", () => habilitarIndividual(f.servicioId));
  }));
}

(async function main() {
  ctx = await requireAuth("conciliacion");
  if (!ctx) return;
  const content = document.getElementById("app-content");
  content.innerHTML = '<div class="empty">Cargando conciliación…</div>';
  try {
    await cargar();
  } catch (err) {
    console.error(err);
    content.innerHTML = '<div class="empty"><p>No fue posible cargar la conciliación.</p><button class="btn btn--ghost" id="reintentar-carga" type="button">Reintentar</button></div>';
    document.getElementById("reintentar-carga").addEventListener("click", cargar);
  }
})();
