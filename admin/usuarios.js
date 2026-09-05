/* ============================================================
 * UNEFIBRAS SAS — Admin: usuarios y roles (SUPERADMIN)
 * ------------------------------------------------------------
 * Alta de usuarios (crea el usuario en Firebase Auth + documento
 * en `usuarios`), cambio de rol y activación/desactivación.
 * Todo vía Cloud Functions que validan SUPERADMIN en el servidor.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs } from "firebase/firestore";
import { msgError } from "../assets/js/admin/ui.js";

let ctx = null;
let usuarios = [];

const ROLES = ["SUPERADMIN", "ADMIN", "OPERADOR"];

function badgeActivo(v) {
  const activo = v !== false;
  return `<span class="badge-estado ${activo ? "tone-green" : "tone-violet"}">${activo ? "Activo" : "Inactivo"}</span>`;
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <span class="muted">El rol lo imponen las Security Rules y las Cloud Functions.</span>
      <button class="btn btn--primary" id="btn-nuevo">+ Nuevo usuario</button>
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  if (!cont) return;

  const rows = usuarios.map((u) => `
    <tr data-id="${u.id}">
      <td>${u.nombre || "—"}</td>
      <td>${u.email || "—"}</td>
      <td>
        <select data-rol="${u.id}" ${u.id === ctx.uid ? "disabled" : ""}>
          ${ROLES.map((r) => `<option value="${r}" ${u.rol === r ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </td>
      <td>${badgeActivo(u.activo)}</td>
      <td>${u.id === ctx.uid ? '<span class="muted">—</span>' : `<button class="btn btn--ghost btn--sm" data-toggle="${u.id}">${u.activo === false ? "Activar" : "Desactivar"}</button>`}</td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("select[data-rol]").forEach((s) =>
    s.addEventListener("change", () => cambiarRol(s.dataset.rol, s.value)));
  cont.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => toggleUsuario(b.dataset.toggle)));
}

// ---------------- Modal alta ----------------
function abrirModal() {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>Nuevo usuario</h2>
        <div class="form-grid two">
          <label class="field"><span>Nombre *</span><input name="nombre" required maxlength="120" /></label>
          <label class="field"><span>Email *</span><input name="email" type="email" required /></label>
          <label class="field"><span>Contraseña * (mín. 6)</span><input name="password" type="password" required minlength="6" /></label>
          <label class="field"><span>Rol</span>
            <select name="rol">
              <option value="OPERADOR" selected>OPERADOR</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPERADMIN">SUPERADMIN</option>
            </select>
          </label>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" id="btn-cancelar">Cancelar</button>
          <button type="submit" class="btn btn--primary" id="btn-guardar">Crear</button>
        </div>
        <p class="modal__msg" id="modal-msg" role="status"></p>
      </form>
    </div>`;

  root.querySelector("#btn-cancelar").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) root.innerHTML = "";
  });
  root.querySelector("#modal-form").addEventListener("submit", crearUsuario);
}

async function crearUsuario(ev) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const d = Object.fromEntries(new FormData(ev.target).entries());

  if (!d.nombre || !d.email || !d.password) {
    msg.textContent = "Todos los campos son obligatorios.";
    msg.className = "modal__msg err";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creando…";
  msg.className = "modal__msg";
  msg.textContent = "";

  try {
    await call("crearUsuario")({ nombre: d.nombre.trim(), email: d.email.trim(), password: d.password, rol: d.rol });
    document.getElementById("modal-root").innerHTML = "";
    await cargar();
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Crear";
  }
}

// ---------------- Cambios ----------------
async function cambiarRol(uid, rol) {
  try {
    await call("actualizarUsuario")({ uid, rol });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
    await cargar();
  }
}

async function toggleUsuario(uid) {
  const u = usuarios.find((x) => x.id === uid);
  if (!u) return;
  const nuevo = u.activo === false;
  if (!confirm(`${nuevo ? "Activar" : "Desactivar"} a ${u.nombre || u.email}?`)) return;
  try {
    await call("actualizarUsuario")({ uid, activo: nuevo });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

async function cargar() {
  const snap = await getDocs(collection(db, "usuarios"));
  usuarios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTabla();
}

(async function main() {
  ctx = await requireAuth("usuarios");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();
  document.getElementById("btn-nuevo").addEventListener("click", abrirModal);

  try {
    await cargar();
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar los usuarios.</div>';
  }
})();
