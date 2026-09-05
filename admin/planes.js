/* ============================================================
 * UNEFIBRAS SAS — Admin: planes configurables
 * ------------------------------------------------------------
 * Permite crear/editar/activar/desactivar planes. El precio y la
 * duración se usan para calcular el vencimiento de los clientes.
 * Las escrituras están restringidas a ADMIN+ por Security Rules.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { collection, getDocs, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { fmtMoney, badgeEstado, msgError } from "../assets/js/admin/ui.js";

let ctx = null;
let planes = [];

function renderToolbar() {
  const canWrite = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <span class="muted">El precio y la duración se usan al calcular vencimientos.</span>
      ${canWrite ? '<button class="btn btn--primary" id="btn-nuevo">+ Nuevo plan</button>' : ""}
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  const canWrite = ctx.rol !== "OPERADOR";

  if (!planes.length) {
    cont.innerHTML = '<div class="empty">No hay planes. Crea el primero para poder dar de alta clientes.</div>';
    return;
  }

  const rows = planes.map((p) => `
    <tr data-id="${p.id}">
      <td>${p.nombre || "—"}</td>
      <td>${p.velocidad || "—"}</td>
      <td>${fmtMoney(p.precio)}</td>
      <td>${p.duracion} ${p.unidadDuracion || "días"}</td>
      <td>${badgeEstado(p.estado)}</td>
      <td>${canWrite ? `
        <button class="btn btn--ghost btn--sm" data-edit="${p.id}">Editar</button>
        <button class="btn btn--ghost btn--sm" data-toggle="${p.id}">${p.estado === "ACTIVO" ? "Desactivar" : "Activar"}</button>` : "—"}
      </td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Velocidad</th><th>Precio</th><th>Duración</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => abrirModal(planes.find((p) => p.id === b.dataset.edit))));
  cont.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => togglePlan(b.dataset.toggle)));
}

function abrirModal(plan) {
  const root = document.getElementById("modal-root");
  const p = plan || {};
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>${plan ? "Editar plan" : "Nuevo plan"}</h2>
        <div class="form-grid two">
          <label class="field"><span>Nombre *</span><input name="nombre" required maxlength="120" value="${p.nombre || ""}" /></label>
          <label class="field"><span>Velocidad</span><input name="velocidad" placeholder="Ej. 100 Mbps" value="${p.velocidad || ""}" /></label>
          <label class="field"><span>Precio (COP) *</span><input name="precio" type="number" required min="0" value="${p.precio ?? ""}" /></label>
          <label class="field"><span>Duración (días) *</span><input name="duracion" type="number" required min="1" value="${p.duracion ?? 30}" /></label>
          <label class="field"><span>Descripción</span><input name="descripcion" value="${p.descripcion || ""}" /></label>
          <label class="field"><span>Estado</span>
            <select name="estado">
              <option value="ACTIVO" ${p.estado !== "INACTIVO" ? "selected" : ""}>Activo</option>
              <option value="INACTIVO" ${p.estado === "INACTIVO" ? "selected" : ""}>Inactivo</option>
            </select>
          </label>
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
  root.querySelector("#modal-form").addEventListener("submit", (ev) => guardarPlan(ev, plan));
}

async function guardarPlan(ev, plan) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const d = Object.fromEntries(new FormData(ev.target).entries());

  if (!d.nombre || !d.precio || !d.duracion) {
    msg.textContent = "Nombre, precio y duración son obligatorios.";
    msg.className = "modal__msg err";
    return;
  }

  const payload = {
    nombre: d.nombre.trim(),
    descripcion: d.descripcion.trim() || null,
    velocidad: d.velocidad.trim() || null,
    precio: Number(d.precio),
    duracion: Number(d.duracion),
    unidadDuracion: "días",
    estado: d.estado,
    updatedAt: serverTimestamp()
  };

  btn.disabled = true;
  btn.textContent = "Guardando…";
  msg.className = "modal__msg";
  msg.textContent = "";

  try {
    if (plan) {
      await updateDoc(doc(db, "planes", plan.id), payload);
    } else {
      await addDoc(collection(db, "planes"), { ...payload, createdAt: serverTimestamp() });
    }
    document.getElementById("modal-root").innerHTML = "";
    await cargar();
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

async function togglePlan(id) {
  const p = planes.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`${p.estado === "ACTIVO" ? "Desactivar" : "Activar"} el plan "${p.nombre}"?`)) return;
  try {
    await updateDoc(doc(db, "planes", id), {
      estado: p.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO",
      updatedAt: serverTimestamp()
    });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

async function cargar() {
  const snap = await getDocs(collection(db, "planes"));
  planes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTabla();
}

(async function main() {
  ctx = await requireAuth("planes");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();

  const btnNuevo = document.getElementById("btn-nuevo");
  if (btnNuevo) btnNuevo.addEventListener("click", () => abrirModal(null));

  try {
    await cargar();
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar los planes.</div>';
  }
})();
