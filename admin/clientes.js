/* ============================================================
 * UneFibra SAS — Admin: lista de clientes
 * ------------------------------------------------------------
 * Lee clientes reales de Firestore, con búsqueda, filtros por
 * estado y orden (los pendientes se ordenan por mayor atraso).
 * El alta se hace vía Cloud Function (valida rol + anti-duplicado).
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import {
  badgeEstado, fmtFecha, textoDias, fmtMoney, diasRestantes,
  hoyColombia, sumarDias, cicloSegunFecha, proximoCorteDe, etiquetaCorte
} from "../assets/js/admin/ui.js";

let ctx = null;
let clientes = [];
let planes = [];
let filtro = "todos";
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

function msgError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("already-exists")) return "Ya existe un cliente con ese documento.";
  if (code.includes("permission-denied")) return "No tienes permisos para esta operación.";
  if (code.includes("invalid-argument")) return "Datos incompletos o inválidos. Revisa el formulario.";
  return "No fue posible completar la operación. Intenta nuevamente.";
}

function renderToolbar() {
  const canWrite = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <div class="toolbar__left">
        <div class="search"><input id="buscar" type="search" placeholder="Buscar nombre, documento o teléfono…" /></div>
        <div class="filters">${FILTROS.map((f) => `<button class="chip ${f.key === filtro ? "is-active" : ""}" data-filtro="${f.key}">${f.label}</button>`).join("")}</div>
      </div>
      ${canWrite ? '<button class="btn btn--primary" id="btn-nuevo">+ Nuevo cliente</button>' : ""}
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function filtrar() {
  let list = clientes.slice();

  if (filtro !== "todos") list = list.filter((c) => c.estadoCliente === filtro);

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

  const list = filtrar();
  if (!list.length) {
    cont.innerHTML = '<div class="empty">No hay clientes en este filtro.</div>';
    return;
  }

  const rows = list.map((c) => `
    <tr data-id="${c.id}">
      <td>${c.nombreCompleto || "—"}</td>
      <td class="muted">${c.documento || "—"}</td>
      <td>${c.telefono || "—"}</td>
      <td>${c.planNombre || "—"}</td>
      <td>${badgeEstado(c.estadoCliente)}</td>
      <td>${fmtFecha(c.fechaVencimiento)}</td>
      <td class="muted">${textoDias(c.fechaVencimiento)}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Plan</th><th>Estado</th><th>Vencimiento</th><th>Días</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => (location.href = `cliente.html?id=${tr.dataset.id}`));
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
    ? planes.map((p) => `<option value="${p.id}">${p.nombre} — ${fmtMoney(p.precio)}</option>`).join("")
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

  root.querySelector("#btn-cancelar").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) root.innerHTML = "";
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
    document.getElementById("modal-root").innerHTML = "";
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

// ---------------- Eventos ----------------
function bind() {
  const input = document.getElementById("buscar");
  if (input) input.addEventListener("input", () => { busqueda = input.value.trim(); renderTabla(); });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filtro;
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c.dataset.filtro === filtro));
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
