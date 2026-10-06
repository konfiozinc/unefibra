/* ============================================================
 * UneFibra SAS — Admin: ficha individual del cliente
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
import { fmtFecha, fmtMoney, badgeEstado, textoDias, urlWhatsApp, esc } from "../assets/js/admin/ui.js";

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

/* ============================================================
 * EDICIÓN Y ELIMINACIÓN DESDE LA FICHA
 * ------------------------------------------------------------
 * Misma experiencia que en el listado (admin/clientes.js). El ESTADO se cambia
 * con los botones de la barra de acciones (eso deja rastro en historial_estados
 * y sincroniza `servicios`); aquí solo se editan DATOS y se elimina el cliente,
 * y todo pasa por Cloud Functions, que validan el rol en el servidor.
 *
 * OJO: esta parte está DUPLICADA A PROPÓSITO desde admin/clientes.js. Se
 * prefirió duplicar antes que extraer un módulo compartido, para no tocar la
 * lista, que ya está en producción. Si se cambia una de las dos copias, hay
 * que cambiar la otra para que las dos pantallas se comporten igual.
 * ============================================================ */

/** Campos editables: los mismos 17 que acepta `actualizarCliente` en el backend. */
const CAMPOS_EDICION = [
  "nombreCompleto", "documento", "telefono", "whatsapp", "email",
  "direccion", "barrio", "ciudad", "tipoVivienda", "edificioUnidad",
  "torre", "apartamento", "planNombre", "precioMensual", "cicloCorte",
  "metodoPagoPreferido", "observaciones"
];

function usuarioActual() {
  return (ctx && (ctx.nombre || ctx.email)) || "";
}

/** Vacío → null (nunca cadena vacía) y `precioMensual` → número. */
function normalizarCampo(nombre, valor) {
  if (nombre === "precioMensual") {
    if (valor === null || valor === undefined || String(valor).trim() === "") return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(valor === null || valor === undefined ? "" : valor).trim();
  return s === "" ? null : s;
}

/**
 * Arma los <option> de un <select> marcando el valor actual. Con `etiquetaVacio`
 * se añade una opción vacía (marcada cuando el dato no existe): así, al guardar,
 * no se inventa un valor que el usuario no eligió.
 */
function opcionesSelect(pares, actual, etiquetaVacio) {
  const act = actual === null || actual === undefined ? "" : String(actual);
  const lista = (etiquetaVacio ? [["", etiquetaVacio]] : []).concat(pares);
  if (act !== "" && !lista.some((p) => String(p[0]) === act)) lista.push([act, act]);
  return lista
    .map(([valor, etiqueta]) => {
      const marcado = String(valor) === act ? " selected" : "";
      return `<option value="${esc(valor)}"${marcado}>${esc(etiqueta)}</option>`;
    })
    .join("");
}

function cerrarModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

/** Mensaje visible en la ficha. Nunca se falla en silencio. */
function aviso(texto, tipo) {
  const el = document.getElementById("ficha-msg");
  if (!el) return;
  el.textContent = texto || "";
  el.className = "modal__msg" + (tipo ? " " + tipo : "");
}

function abrirModalEditar(c) {
  const root = document.getElementById("modal-root");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>Editar cliente</h2>
        <div class="form-grid two">
          <label class="field"><span>Nombre completo *</span><input name="nombreCompleto" required maxlength="120" value="${esc(c.nombreCompleto || "")}" /></label>
          <label class="field"><span>Documento</span><input name="documento" value="${esc(c.documento || "")}" /></label>
          <label class="field"><span>Teléfono</span><input name="telefono" inputmode="tel" value="${esc(c.telefono || "")}" /></label>
          <label class="field"><span>WhatsApp</span><input name="whatsapp" inputmode="tel" value="${esc(c.whatsapp || "")}" /></label>
          <label class="field"><span>Email</span><input name="email" type="email" value="${esc(c.email || "")}" /></label>
          <label class="field"><span>Ciudad</span><input name="ciudad" value="${esc(c.ciudad || "")}" /></label>
          <label class="field"><span>Dirección</span><input name="direccion" value="${esc(c.direccion || "")}" /></label>
          <label class="field"><span>Barrio</span><input name="barrio" value="${esc(c.barrio || "")}" /></label>
          <label class="field"><span>Tipo de vivienda</span>
            <select name="tipoVivienda">${opcionesSelect(
              [["casa", "Casa"], ["edificio", "Edificio"], ["unidad", "Unidad residencial"]],
              c.tipoVivienda, "Sin especificar"
            )}</select>
          </label>
          <label class="field"><span>Edificio o unidad residencial</span><input name="edificioUnidad" value="${esc(c.edificioUnidad || "")}" /></label>
          <label class="field"><span>Torre</span><input name="torre" value="${esc(c.torre || "")}" /></label>
          <label class="field"><span>Apartamento</span><input name="apartamento" value="${esc(c.apartamento || "")}" /></label>
          <label class="field"><span>Plan</span><input name="planNombre" value="${esc(c.planNombre || "")}" /></label>
          <label class="field"><span>Precio mensual (COP)</span><input name="precioMensual" type="number" min="0" step="1" value="${esc(c.precioMensual ?? "")}" /></label>
          <label class="field"><span>Ciclo de corte</span>
            <select name="cicloCorte">${opcionesSelect(
              [["15", "Día 15"], ["30", "Día 30"]],
              c.cicloCorte, "Sin ciclo"
            )}</select>
          </label>
          <label class="field"><span>Estado del cliente</span>
            <div>${badgeEstado(c.estadoCliente)}</div>
            <span class="muted">Para cambiarlo usa los botones Activar / Suspender: así queda el historial de estados y se sincroniza el servicio.</span>
          </label>
          <label class="field"><span>Método de pago preferido</span><input name="metodoPagoPreferido" value="${esc(c.metodoPagoPreferido || "")}" /></label>
          <label class="field"><span>Observaciones</span><input name="observaciones" value="${esc(c.observaciones || "")}" /></label>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btn-guardar">Guardar cambios</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </form>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", cerrarModal);
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) cerrarModal();
  });
  root.querySelector("#modal-form").addEventListener("submit", (ev) => guardarEdicion(ev, c));
}

async function guardarEdicion(ev, c) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const data = Object.fromEntries(new FormData(ev.target).entries());

  if (!normalizarCampo("nombreCompleto", data.nombreCompleto)) {
    msg.textContent = "El nombre completo es obligatorio.";
    msg.className = "modal__msg err";
    return;
  }

  // Solo se envían los campos que de verdad cambiaron: el servidor audita uno
  // por uno y no se debe marcar como cambio lo que nadie tocó.
  const campos = {};
  CAMPOS_EDICION.forEach((campo) => {
    const nuevo = normalizarCampo(campo, data[campo]);
    const antes = normalizarCampo(campo, c[campo]);
    if (nuevo !== antes) campos[campo] = nuevo;
  });

  if (!Object.keys(campos).length) {
    msg.textContent = "No hay cambios que guardar.";
    msg.className = "modal__msg";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando…";
  msg.textContent = "";
  msg.className = "modal__msg";

  try {
    const res = await call("actualizarCliente")({
      clienteId: c.id,
      campos,
      usuarioNombre: usuarioActual()
    });

    // Se le hace caso al SERVIDOR: él dice qué aplicó (`cambios`) y qué ignoró
    // (`ignorados`), en vez de dar por hecho que todo se guardó.
    const d = (res && res.data) || {};
    const aplicados = Array.isArray(d.cambios) ? d.cambios : Object.keys(campos);
    const ignorados = Array.isArray(d.ignorados) ? d.ignorados : [];

    if (!aplicados.length) {
      msg.textContent = "No se actualizó ningún campo." +
        (ignorados.length ? ` El servidor ignoró: ${ignorados.join(", ")}.` : "");
      msg.className = "modal__msg err";
      btn.disabled = false;
      btn.textContent = "Guardar cambios";
      return;
    }

    msg.textContent = `Cliente actualizado. Campos actualizados: ${aplicados.length}.` +
      (ignorados.length ? ` El servidor ignoró: ${ignorados.join(", ")}.` : "");
    msg.className = "modal__msg ok";

    // Se relee el cliente para que la ficha muestre lo guardado. Es UNA lectura
    // de un documento, no la colección completa.
    setTimeout(async () => { cerrarModal(); await cargar(); }, 900);
  } catch (err) {
    console.error(err);
    msg.textContent = err && err.message ? err.message : msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
}

function confirmarEliminar(c) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  const nombre = esc(c.nombreCompleto || "este cliente");

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Eliminar cliente</h2>
        <p>¿Seguro que quieres eliminar a ${nombre}? Esta acción no se puede deshacer</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="button" class="btn btn--primary" id="btn-eliminar">Eliminar</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </div>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", cerrarModal);
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) cerrarModal();
  });
  root.querySelector("#btn-eliminar").addEventListener("click", () => eliminarCliente(c));
}

async function eliminarCliente(c) {
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-eliminar");

  btn.disabled = true;
  btn.textContent = "Eliminando…";
  msg.textContent = "";
  msg.className = "modal__msg";

  try {
    const res = await call("eliminarCliente")({
      clienteId: c.id,
      usuarioNombre: usuarioActual()
    });
    const d = (res && res.data) || {};

    // El borrado arrastra los servicios pero CONSERVA los pagos (registro
    // financiero): se dice en pantalla para que no queden dudas.
    let texto = `Cliente "${c.nombreCompleto || c.id}" eliminado.`;
    if (typeof d.serviciosEliminados === "number") texto += ` Servicios eliminados: ${d.serviciosEliminados}.`;
    if (d.pagosConservados) texto += ` Pagos conservados: ${d.pagosConservados}.`;
    texto += " Volviendo a la lista…";
    msg.textContent = texto;
    msg.className = "modal__msg ok";

    // La ficha ya no tiene sentido: el cliente no existe. Se vuelve a la lista.
    setTimeout(() => { location.href = "clientes.html"; }, 1200);
  } catch (err) {
    console.error(err);
    msg.textContent = err && err.message ? err.message : msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Eliminar";
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
    // Editar los DATOS del cliente (no el estado: eso es lo de arriba).
    btns.push('<button class="btn btn--primary" data-accion="editar">Editar</button>');
    const msgWa = `Hola ${cliente.nombreCompleto || ""}, te escribimos de UneFibra. Tu servicio de Internet vence el ${fmtFecha(cliente.fechaVencimiento)} (valor ${fmtMoney(cliente.precioMensual)}).`;
    btns.push(`<a class="btn btn--ghost" target="_blank" rel="noopener" href="${urlWhatsApp(msgWa)}">Enviar WhatsApp</a>`);
    btns.push(`<a class="btn btn--ghost" href="pagos.html?clienteId=${cliente.id}">Registrar pago</a>`);
    // Se deja al final por ser la acción destructiva, con confirmación aparte.
    btns.push('<button class="btn btn--ghost" data-accion="eliminar">Eliminar</button>');
  }

  return `<div class="actions">${btns.join("")}</div>`;
}

function panelDatos(cliente) {
  // Los tres últimos solo existen en edificio o unidad residencial: en una casa
  // aparecen vacíos ("—"), no con datos inventados.
  const TIPOS_VIVIENDA = { casa: "Casa", edificio: "Edificio", unidad: "Unidad residencial" };
  const filas = [
    ["Nombre", cliente.nombreCompleto],
    ["Documento", cliente.documento],
    ["Teléfono", cliente.telefono],
    ["WhatsApp", cliente.whatsapp],
    ["Email", cliente.email],
    ["Dirección", cliente.direccion],
    ["Barrio", cliente.barrio],
    ["Ciudad", cliente.ciudad],
    ["Tipo de vivienda", TIPOS_VIVIENDA[cliente.tipoVivienda] || cliente.tipoVivienda],
    ["Edificio o unidad", cliente.edificioUnidad],
    ["Torre", cliente.torre],
    ["Apartamento", cliente.apartamento]
  ];
  return `<div class="panel">
    <h2>Datos personales</h2>
    <div class="kv">${filas.map(([k, v]) => `<div class="kv__item"><span class="kv__k">${k}</span><span class="kv__v">${esc(v || "—")}</span></div>`).join("")}</div>
  </div>`;
}

function panelServicio(cliente, servicio, plan) {
  const filas = [
    ["Plan", esc(cliente.planNombre)],
    ["Velocidad", esc(plan && plan.velocidad ? plan.velocidad : "—")],
    ["Precio", fmtMoney(cliente.precioMensual)],
    ["Fecha instalación", fmtFecha(cliente.fechaInstalacion)],
    ["Inicio de servicio", fmtFecha(cliente.fechaInicioServicio)],
    ["Vencimiento", fmtFecha(cliente.fechaVencimiento)],
    ["Estado servicio", badgeEstado(servicio ? servicio.estado : cliente.estadoServicio)],
    ["Método preferido", esc(cliente.metodoPagoPreferido)]
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
      <span class="kv__k">${fmtFecha(p.fechaPago)} · ${esc(p.metodoPago || "—")}</span>
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
      <p><strong>${esc(h.estadoAnterior || "—")} → ${esc(h.estadoNuevo || "—")}</strong> <span class="muted">· ${esc(h.motivo || "Sin motivo")}</span></p>
      <p class="muted">${fmtTimestamp(h.fecha)} · ${esc(h.usuarioNombre || h.usuarioId || "sistema")}</p>
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
      <!-- Navegación de la ficha: al panel (inicio) y de vuelta a la lista. -->
      <a class="back-link" href="dashboard.html">← Inicio</a>
      <span class="muted"> · </span>
      <a class="back-link" href="clientes.html">← Volver a clientes</a>
      <h1 style="font-family:var(--font-display);font-size:1.6rem;margin-bottom:4px;">${esc(cliente.nombreCompleto || "Cliente")}</h1>
      <p class="muted" style="margin-bottom:18px;">${badgeEstado(cliente.estadoCliente)} · ${textoDias(cliente.fechaVencimiento)}</p>
    </div>
    ${acciones(cliente)}
    <p class="modal__msg" id="ficha-msg" role="status"></p>
    <div class="detail-grid">
      ${panelDatos(cliente)}
      ${panelServicio(cliente, servicio, plan)}
      ${panelPagos(pagos)}
      ${panelHistorial(historial)}
    </div>
    <div id="modal-root"></div>`;

  document.querySelectorAll("[data-accion]").forEach((b) => {
    b.addEventListener("click", () => {
      const acc = b.dataset.accion;

      // Editar y Eliminar no son cambios de estado: no pasan por accionEstado
      // (que recarga la ficha) y llevan su propio diálogo.
      if (acc === "editar") { abrirModalEditar(cliente); return; }
      if (acc === "eliminar") { confirmarEliminar(cliente); return; }

      const mapa = {
        activarServicio: ["activarServicio", "¿Activar el servicio de este cliente?"],
        suspenderServicio: ["suspenderServicio", "¿Suspender el servicio de este cliente?"],
        desactivarServicio: ["desactivarServicio", "¿Desactivar (retirar) a este cliente? Conservará su historial."],
        reactivarServicio: ["reactivarServicio", "¿Reactivar a este cliente?"]
      };
      const [fn, msg] = mapa[acc] || [];
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
