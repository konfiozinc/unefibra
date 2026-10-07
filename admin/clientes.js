/* ============================================================
 * UneFibra SAS — Admin: lista de clientes
 * ------------------------------------------------------------
 * Lee clientes reales de Firestore, con búsqueda, filtros por
 * estado y por ciclo de corte, y acciones por fila (editar,
 * eliminar, suspender/activar).
 *
 * REGLA DEL PROYECTO: todo lo que MODIFICA datos va por Cloud
 * Functions (validan el rol y dejan auditoría en el servidor);
 * el panel nunca escribe directo a Firestore para eso.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import {
  badgeEstado, fmtFecha, fmtMoney, diasRestantes,
  hoyColombia, sumarDias, cicloSegunFecha, proximoCorteDe, etiquetaCorte, esc
} from "../assets/js/admin/ui.js";

let ctx = null;
let clientes = [];
let planes = [];
let filtro = "todos";
let filtroCiclo = "todos";
let busqueda = "";
// Obligatoriedad de los datos de dirección. La manda `configuracion` para que el
// panel y el servidor exijan lo mismo; si no se puede leer, se exige (más seguro).
let exigirDireccion = true;

const FILTROS = [
  { key: "todos", label: "Todos" },
  { key: "ACTIVO", label: "Activos" },
  { key: "POR_VENCER", label: "Por vencer" },
  { key: "PENDIENTE_PAGO", label: "Pendientes" },
  { key: "SUSPENDIDO", label: "Suspendidos" },
  { key: "INACTIVO", label: "Inactivos" }
];

// Ciclo de corte: el negocio cobra en dos tandas (día 15 y día 30). Se compara
// con el MISMO criterio que las listas de corte (assets/js/admin/cortes.js):
// el campo puede venir como número en clientes viejos, así que se compara como
// texto: String(c.cicloCorte || "") === String(ciclo).
const CICLOS = [
  { key: "todos", label: "Todos" },
  { key: "15", label: "Ciclo 15" },
  { key: "30", label: "Ciclo 30" }
];

// Etiquetas legibles del estado para el <select> del modal de edición.
const ETIQUETA_ESTADO = {
  ACTIVO: "Activo",
  POR_VENCER: "Por vencer",
  PENDIENTE_PAGO: "Pendiente de pago",
  SUSPENDIDO: "Suspendido",
  INACTIVO: "Inactivo"
};

// Campos editables del cliente (modal "Editar"). Se envían SOLO los que cambien.
// `precioMensual` viaja como número y los vacíos como null.
//
// OJO: `estadoCliente` NO está aquí A PROPÓSITO. El estado se cambia solo con
// los botones Suspender/Activar, que pasan por `cambiarEstadoCliente` en el
// servidor: eso además deja rastro en `historial_estados` y sincroniza el
// documento de `servicios`. Si se editara como un campo cualquiera, el estado
// cambiaría sin historial y el servicio quedaría desincronizado.
const CAMPOS_EDICION = [
  "nombreCompleto", "documento", "telefono", "whatsapp", "email",
  "direccion", "barrio", "ciudad", "tipoVivienda", "edificioUnidad",
  "torre", "apartamento", "planNombre", "precioMensual", "cicloCorte",
  "metodoPagoPreferido", "observaciones"
];

function msgError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("already-exists")) return "Ya existe un cliente con ese documento.";
  if (code.includes("permission-denied")) return "No tienes permisos para esta operación.";
  if (code.includes("invalid-argument")) return "Datos incompletos o inválidos. Revisa el formulario.";
  return "No fue posible completar la operación. Intenta nuevamente.";
}

/**
 * Nombre del usuario autenticado que se manda a las Cloud Functions para que
 * quede en la auditoría. `ctx` lo devuelve requireAuth() (shell.js) leyendo
 * `usuarios/{uid}` en Firestore; si el usuario no tiene nombre, cae al email.
 */
function usuarioActual() {
  return (ctx && (ctx.nombre || ctx.email)) || "";
}

/**
 * Estado listo para pintar con badgeEstado().
 *
 * Ya NO escapa nada: la causa raíz se arregló en `badgeEstado()` de ui.js, que
 * ahora escapa por su cuenta cualquier estado que no reconozca. Escapar aquí
 * también provocaría DOBLE escapado (un "&" se vería como "&amp;").
 */
function estadoSeguro(v) {
  return v === null || v === undefined ? "" : v;
}

/** Precio mensual en pesos; "—" cuando el dato no existe o es null. */
function fmtPrecio(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? fmtMoney(n) : "—";
}

/** Mensaje visible en la vista. Nunca se falla en silencio. */
function aviso(texto, tipo) {
  const el = document.getElementById("lista-msg");
  if (!el) return;
  el.textContent = texto || "";
  el.className = "modal__msg" + (tipo ? " " + tipo : "");
}

/**
 * Normaliza el valor de un campo para compararlo y enviarlo:
 * vacío → null (nunca cadena vacía) y `precioMensual` → número.
 */
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
 * Arma los <option> de un <select> marcando el valor actual.
 * Si se pasa `etiquetaVacio` se añade una opción vacía (marcada cuando el dato
 * guardado no existe): así, al guardar, no se inventa un valor que el usuario
 * no eligió. Si el valor guardado no está en la lista, se agrega tal cual.
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

/** Cierra el modal abierto (el contenedor lo comparten alta, edición y borrado). */
function cerrarModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
}

function renderToolbar() {
  const canWrite = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <div class="toolbar__left">
        <a class="btn btn--ghost btn--sm" href="dashboard.html">← Inicio</a>
        <div class="search"><input id="buscar" type="search" placeholder="Buscar nombre, documento o teléfono…" /></div>
        <div class="filters">${FILTROS.map((f) => `<button type="button" class="chip ${f.key === filtro ? "is-active" : ""}" data-filtro="${f.key}">${f.label}</button>`).join("")}</div>
        <span class="muted">Ciclo de corte:</span>
        <div class="filters">${CICLOS.map((c) => `<button type="button" class="chip ${c.key === filtroCiclo ? "is-active" : ""}" data-ciclo="${c.key}">${c.label}</button>`).join("")}</div>
      </div>
      ${canWrite ? '<button class="btn btn--primary" id="btn-nuevo">+ Nuevo cliente</button>' : ""}
    </div>
    <p class="modal__msg" id="lista-msg" role="status"></p>
    <p class="muted" id="contador"></p>
    <div class="table-wrap" id="tabla"></div>
    <!-- Segundo "Inicio" al final: con 354 filas, volver arriba a mano es tedioso. -->
    <p><a class="btn btn--ghost btn--sm" href="dashboard.html">← Inicio</a></p>
    <div id="modal-root"></div>`;
}

/* ============================================================
 * NUMERACIÓN ESTABLE DE CLIENTES
 * ------------------------------------------------------------
 * El "#" NO es el número de fila visible: es la posición del cliente en el
 * ORDEN DE ACTIVACIÓN (fechaInicioServicio ascendente). El #1 es el cliente más
 * antiguo y el #N el más reciente, y el número de un cliente NO cambia al
 * aplicar filtros, buscar ni reordenar la tabla: así "el cliente #45" siempre
 * es el mismo.
 *
 * Se calcula sobre TODOS los clientes cargados, nunca sobre la lista filtrada.
 */
let numeros = new Map();

function calcularNumeracion() {
  const fecha = (c) => String(c.fechaInicioServicio || c.fechaInstalacion || "");
  const orden = clientes.slice().sort((a, b) => {
    const fa = fecha(a) || "9999-12-31"; // sin fecha: al final, no como el más antiguo
    const fb = fecha(b) || "9999-12-31";
    if (fa !== fb) return fa < fb ? -1 : 1;
    // Desempate ESTABLE: dos clientes con la misma fecha no pueden intercambiarse
    // el número entre recargas.
    const n = String(a.nombreCompleto || "").localeCompare(String(b.nombreCompleto || ""));
    if (n !== 0) return n;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  numeros = new Map(orden.map((c, i) => [c.id, i + 1]));
}

/** "Mostrando X de Y clientes", con el detalle de los filtros activos. */
function actualizarContador(mostrando) {
  const el = document.getElementById("contador");
  if (!el) return;
  const activos = [];
  if (filtro !== "todos") activos.push((FILTROS.find((f) => f.key === filtro) || {}).label || filtro);
  if (filtroCiclo !== "todos") activos.push((CICLOS.find((c) => c.key === filtroCiclo) || {}).label || filtroCiclo);
  if (busqueda) activos.push('búsqueda "' + busqueda + '"');
  // textContent y no innerHTML: la búsqueda la escribe el usuario.
  el.textContent = "Mostrando " + mostrando + " de " + clientes.length + " clientes" +
    (activos.length ? " (filtrado por " + activos.join(" + ") + ")" : "");
}

function filtrar() {
  let list = clientes.slice();

  if (filtro !== "todos") list = list.filter((c) => c.estadoCliente === filtro);

  // Ciclo de corte (día 15 / día 30), igual que en las listas de corte.
  if (filtroCiclo !== "todos") {
    list = list.filter((c) => String(c.cicloCorte || "") === String(filtroCiclo));
  }

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

  // La numeración se recalcula sobre TODOS los clientes en cada render: así un
  // cliente recién creado ya tiene su número y el orden nunca queda desfasado.
  calcularNumeracion();

  const list = filtrar();
  // El contador se actualiza ANTES del return de la lista vacía: con un filtro
  // sin resultados hay que ver "Mostrando 0 de 354", no quedarse sin contador.
  actualizarContador(list.length);

  if (!list.length) {
    cont.innerHTML = '<div class="empty">No hay clientes en este filtro.</div>';
    return;
  }

  const canWrite = ctx.rol !== "OPERADOR";

  const rows = list.map((c) => {
    // El estado manda: si está suspendido o inactivo se ofrece "Activar"; en
    // cualquier otro caso (activo, por vencer, pendiente) se ofrece "Suspender".
    const puedeActivar = c.estadoCliente === "SUSPENDIDO" || c.estadoCliente === "INACTIVO";
    const acciones = canWrite
      ? `
        <button type="button" class="btn btn--ghost btn--sm" data-edit="${esc(c.id)}">Editar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-estado="${esc(c.id)}" data-op="${puedeActivar ? "activar" : "suspender"}">${puedeActivar ? "Activar" : "Suspender"}</button>
        <button type="button" class="btn btn--ghost btn--sm" data-del="${esc(c.id)}">Eliminar</button>`
      : '<span class="muted">—</span>';

    return `
    <tr data-id="${esc(c.id)}">
      <td class="muted">${esc(numeros.get(c.id) ?? "—")}</td>
      <td>${esc(c.nombreCompleto || "—")}</td>
      <td>${esc(c.telefono || "—")}</td>
      <td class="muted">${esc(c.ip || "—")}</td>
      <td>${esc(c.planNombre || "Sin plan")}</td>
      <td>${fmtPrecio(c.precioMensual)}</td>
      <td>${esc(c.cicloCorte || "—")}</td>
      <td>${badgeEstado(estadoSeguro(c.estadoCliente))}</td>
      <td>${fmtFecha(c.fechaInicioServicio || c.fechaInstalacion)}</td>
      <td>${acciones}</td>
    </tr>`;
  }).join("");

  cont.innerHTML = `
    <table>
      <thead><tr>
        <th>#</th><th>Nombre</th><th>Teléfono</th><th>IP</th><th>Plan</th><th>Precio mensual</th>
        <th>Ciclo</th><th>Estado</th><th>Fecha de ingreso</th><th>Acciones</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => abrirModalEditar(b.dataset.edit)));
  cont.querySelectorAll("[data-estado]").forEach((b) =>
    b.addEventListener("click", () => cambiarEstado(b.dataset.estado, b.dataset.op)));
  cont.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => abrirModalEliminar(b.dataset.del)));

  cont.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", (ev) => {
      // Los botones de la columna Acciones no deben abrir además la ficha.
      if (ev.target.closest("button")) return;
      location.href = `cliente.html?id=${tr.dataset.id}`;
    });
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
    ? planes.map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)} — ${fmtMoney(p.precio)}</option>`).join("")
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
          <label class="field"><span>Tipo de vivienda</span>
            <select name="tipoVivienda" id="cli-tipo-vivienda">
              <option value="">Selecciona…</option>
              <option value="casa">Casa</option>
              <option value="edificio">Edificio</option>
              <option value="unidad">Unidad residencial</option>
            </select>
          </label>
          <!-- Solo para edificio o unidad: en una casa no existen. El JS los
               muestra y los marca obligatorios según el tipo elegido. -->
          <label class="field" data-dir="edificio" hidden><span>Edificio o unidad residencial *</span><input name="edificioUnidad" /></label>
          <label class="field" data-dir="edificio" hidden><span>Torre *</span><input name="torre" /></label>
          <label class="field" data-dir="edificio" hidden><span>Apartamento *</span><input name="apartamento" /></label>
          <label class="field"><span>Plan</span><select name="planId">${opciones}</select></label>
          <label class="field"><span>Fecha de inicio del servicio</span><input name="fechaInicioServicio" type="date" value="${hoyColombia()}" /></label>
          <label class="field"><span>Observaciones</span><input name="observaciones" /></label>
        </div>

        <!-- Ciclo de corte: el negocio cobra en dos tandas, el día 15 y el día 30.
             Se sugiere a partir del vencimiento estimado (inicio + duración del
             plan), pero manda lo que elija el usuario: hay clientes que se
             cambian de tanda a propósito. -->
        <div class="form-grid two">
          <div class="field">
            <span>Ciclo de corte *</span>
            <div class="radios">
              <label class="radio"><input type="radio" name="cicloCorte" value="15" checked /> Día 15</label>
              <label class="radio"><input type="radio" name="cicloCorte" value="30" /> Día 30</label>
            </div>
          </div>
          <p class="muted" id="ciclo-ayuda" style="font-size:0.84rem;"></p>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btn-guardar">Guardar</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </form>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", cerrarModal);
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) cerrarModal();
  });
  root.querySelector("#modal-form").addEventListener("submit", guardarCliente);

  // ---------------- Sugerencia del ciclo de corte ----------------
  const selPlan = root.querySelector('select[name="planId"]');
  const inpInicio = root.querySelector('input[name="fechaInicioServicio"]');
  const ayuda = root.querySelector("#ciclo-ayuda");
  const radios = Array.from(root.querySelectorAll('input[name="cicloCorte"]'));
  let cicloManual = false; // si el usuario toca el ciclo, dejamos de sugerir

  const cicloElegido = () => (radios.find((r) => r.checked) || {}).value || "15";

  function vencimientoEstimado() {
    const plan = planes.find((p) => p.id === (selPlan && selPlan.value));
    const duracion = Number(plan && plan.duracion) || 30;
    const inicio = (inpInicio && inpInicio.value) || hoyColombia();
    return sumarDias(inicio, duracion);
  }

  function refrescarCiclo() {
    const vencimiento = vencimientoEstimado();
    if (!cicloManual) {
      const sugerido = cicloSegunFecha(vencimiento) || "15";
      radios.forEach((r) => { r.checked = r.value === sugerido; });
    }
    if (ayuda) {
      const ciclo = cicloElegido();
      ayuda.textContent = `Vencimiento estimado: ${fmtFecha(vencimiento)} · ` +
        `${etiquetaCorte(ciclo)} · Próximo corte: ${fmtFecha(proximoCorteDe(ciclo))}`;
    }
  }

  radios.forEach((r) => r.addEventListener("change", () => { cicloManual = true; refrescarCiclo(); }));
  if (selPlan) selPlan.addEventListener("change", refrescarCiclo);
  if (inpInicio) inpInicio.addEventListener("change", refrescarCiclo);
  refrescarCiclo();

  // ---------------- Datos de dirección ----------------
  // En una casa no hay torre ni apartamento: se muestran y se exigen solo para
  // edificio o unidad residencial. Así no se fuerza a inventar datos ("N/A").
  const selVivienda = root.querySelector('select[name="tipoVivienda"]');
  const camposEdificio = Array.from(root.querySelectorAll('[data-dir="edificio"]'));

  function refrescarDireccion() {
    const tipo = selVivienda ? selVivienda.value : "";
    const esEdificio = tipo === "edificio" || tipo === "unidad";
    camposEdificio.forEach((campo) => {
      campo.hidden = !esEdificio;
      const input = campo.querySelector("input");
      if (input) input.required = esEdificio && exigirDireccion;
    });
  }

  if (selVivienda) selVivienda.addEventListener("change", refrescarDireccion);

  getDoc(doc(db, "configuracion", "camposDireccionObligatorios"))
    .then((snap) => {
      if (snap.exists() && snap.data().valor === false) exigirDireccion = false;
      refrescarDireccion();
    })
    .catch(() => refrescarDireccion());
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

  // Datos de dirección (tarea 3). El servidor los vuelve a validar, así que este
  // aviso es solo para no hacer esperar al operador con un error de red.
  const tipoVivienda = (data.tipoVivienda || "").trim();
  if (exigirDireccion) {
    const faltantes = [];
    if (!(data.direccion || "").trim()) faltantes.push("la dirección");
    if (!(data.barrio || "").trim()) faltantes.push("el barrio o sector");
    if (!tipoVivienda) faltantes.push("el tipo de vivienda");
    if (tipoVivienda === "edificio" || tipoVivienda === "unidad") {
      if (!(data.edificioUnidad || "").trim()) faltantes.push("el edificio o unidad residencial");
      if (!(data.torre || "").trim()) faltantes.push("la torre");
      if (!(data.apartamento || "").trim()) faltantes.push("el apartamento");
    }
    if (faltantes.length) {
      msg.textContent = "Faltan datos de dirección: " + faltantes.join(", ") + ".";
      msg.className = "modal__msg err";
      return;
    }
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
      direccion: (data.direccion || "").trim() || null,
      barrio: (data.barrio || "").trim() || null,
      ciudad: (data.ciudad || "").trim() || "Medellín",
      tipoVivienda: tipoVivienda || null,
      edificioUnidad: (data.edificioUnidad || "").trim() || null,
      torre: (data.torre || "").trim() || null,
      apartamento: (data.apartamento || "").trim() || null,
      planId: data.planId || null,
      fechaInicioServicio: data.fechaInicioServicio || null,
      cicloCorte: data.cicloCorte || null,
      observaciones: data.observaciones.trim() || null
    });
    const id = res.data && res.data.id;
    cerrarModal();
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

// ---------------- Modal de edición ----------------
function abrirModalEditar(id) {
  const c = clientes.find((x) => x.id === id);
  if (!c) {
    aviso("No se encontró el cliente en la lista. Recarga la página.", "err");
    return;
  }

  const root = document.getElementById("modal-root");
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
            <input value="${esc(ETIQUETA_ESTADO[c.estadoCliente] || c.estadoCliente || "—")}" disabled />
            <span class="muted">Para cambiarlo usa los botones Suspender / Activar: así queda el historial de estados y se sincroniza el servicio.</span>
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

async function guardarEdicion(ev, cliente) {
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
  // por uno y no queremos marcar como cambio lo que nadie tocó.
  const campos = {};
  CAMPOS_EDICION.forEach((campo) => {
    const nuevo = normalizarCampo(campo, data[campo]);
    const antes = normalizarCampo(campo, cliente[campo]);
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
      clienteId: cliente.id,
      campos,
      usuarioNombre: usuarioActual()
    });

    // El servidor responde qué aplicó (`cambios`) y qué ignoró (`ignorados`): se
    // hace caso a ÉL, no a lo que creemos que se guardó. Así un campo que el
    // backend no acepta se avisa en pantalla y no se pinta como si hubiera
    // cambiado.
    const data = (res && res.data) || {};
    const aplicados = Array.isArray(data.cambios) ? data.cambios : Object.keys(campos);
    const ignorados = Array.isArray(data.ignorados) ? data.ignorados : [];

    // Se actualiza el cliente en memoria y se repinta la tabla: no se vuelve a
    // descargar la colección completa (353 clientes) por una edición.
    aplicados.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(campos, k)) cliente[k] = campos[k];
    });
    renderTabla();

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
    setTimeout(cerrarModal, 1200);
  } catch (err) {
    console.error(err);
    msg.textContent = err && err.message ? err.message : msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
}

// ---------------- Modal de eliminación ----------------
function abrirModalEliminar(id) {
  const c = clientes.find((x) => x.id === id);
  if (!c) {
    aviso("No se encontró el cliente en la lista. Recarga la página.", "err");
    return;
  }

  const root = document.getElementById("modal-root");
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

async function eliminarCliente(cliente) {
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-eliminar");

  btn.disabled = true;
  btn.textContent = "Eliminando…";
  msg.textContent = "";
  msg.className = "modal__msg";

  try {
    const res = await call("eliminarCliente")({
      clienteId: cliente.id,
      usuarioNombre: usuarioActual()
    });
    const data = (res && res.data) || {};

    // Se quita de la lista en memoria y se repinta: sin volver a descargar todo.
    clientes = clientes.filter((x) => x.id !== cliente.id);
    cerrarModal();
    renderTabla();

    // El borrado arrastra los servicios pero conserva los pagos (registro
    // financiero): se dice en pantalla para que no queden dudas.
    let texto = `Cliente "${cliente.nombreCompleto || cliente.id}" eliminado.`;
    if (typeof data.serviciosEliminados === "number") texto += ` Servicios eliminados: ${data.serviciosEliminados}.`;
    if (data.pagosConservados) texto += ` Pagos conservados: ${data.pagosConservados}.`;
    aviso(texto, "ok");
  } catch (err) {
    console.error(err);
    msg.textContent = err && err.message ? err.message : msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Eliminar";
  }
}

// ---------------- Suspender / activar ----------------
// No se pide motivo: el proyecto no tiene un patrón de captura de motivo y la
// Cloud Function ya trae el suyo por defecto ("Suspensión administrativa").
async function cambiarEstado(id, op) {
  const c = clientes.find((x) => x.id === id);
  if (!c) {
    aviso("No se encontró el cliente en la lista. Recarga la página.", "err");
    return;
  }

  const suspender = op !== "activar";
  const btn = Array.from(document.querySelectorAll("[data-estado]")).find((b) => b.dataset.estado === id);
  const textoOriginal = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }

  try {
    const res = await call(suspender ? "suspenderServicio" : "activarServicio")({ clienteId: id });
    const estado = (res && res.data && res.data.estado) || (suspender ? "SUSPENDIDO" : "ACTIVO");

    // El servidor ya cambió el estado: solo se refleja en la lista en memoria.
    c.estadoCliente = estado;
    renderTabla();
    aviso(suspender ? "Servicio suspendido." : "Servicio activado.", "ok");
  } catch (err) {
    console.error(err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
    aviso(err && err.message ? err.message : msgError(err), "err");
  }
}

// ---------------- Eventos ----------------
function bind() {
  const input = document.getElementById("buscar");
  if (input) input.addEventListener("input", () => { busqueda = input.value.trim(); renderTabla(); });

  // Filtro por estado (los chips llevan data-filtro; los de ciclo, data-ciclo,
  // para que los dos grupos no se pisen al marcar el activo).
  document.querySelectorAll(".chip[data-filtro]").forEach((chip) => {
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filtro;
      document.querySelectorAll(".chip[data-filtro]").forEach((c) => c.classList.toggle("is-active", c.dataset.filtro === filtro));
      renderTabla();
    });
  });

  // Filtro por ciclo de corte
  document.querySelectorAll(".chip[data-ciclo]").forEach((chip) => {
    chip.addEventListener("click", () => {
      filtroCiclo = chip.dataset.ciclo;
      document.querySelectorAll(".chip[data-ciclo]").forEach((c) => c.classList.toggle("is-active", c.dataset.ciclo === filtroCiclo));
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
