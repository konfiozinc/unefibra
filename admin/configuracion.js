/* ============================================================
 * UneFibra SAS — Admin: configuración (SUPERADMIN)
 * ------------------------------------------------------------
 *  · Métodos de pago (colección `metodos_pago`): alta, edición,
 *    activar/desactivar y eliminar. Incluye los datos bancarios
 *    (tipo de cuenta, número y titular) y la cuenta principal.
 *  · Recordatorios automáticos (colección `configuracion`):
 *    intervalos que usa el motor de vencimientos.
 *  · WhatsApp de soporte (documento `configuracion/soporte`).
 *  · Plantillas de los mensajes de cobro
 *    (documento `configuracion/plantillasMensaje`).
 * Las escrituras están restringidas a SUPERADMIN por Security Rules.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs, addDoc, doc, updateDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { msgError, esc } from "../assets/js/admin/ui.js";

let metodos = [];

// ---------------- Métodos de pago ----------------
function renderMetodos() {
  const cont = document.getElementById("metodos-lista");
  if (!cont) return;
  if (!metodos.length) {
    cont.innerHTML = '<p class="muted">Sin métodos configurados.</p>';
    return;
  }
  cont.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Método</th><th>Tipo de cuenta</th><th>Número de cuenta</th><th>Titular</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          ${metodos.map((m) => `
            <tr>
              <td>${esc(m.nombre)}${m.principal ? ' <span class="badge-estado tone-green">Principal</span>' : ""}</td>
              <td>${esc(m.tipoCuenta || "—")}</td>
              <td>${esc(m.numeroCuenta || "—")}</td>
              <td>${esc(m.titular || "—")}</td>
              <td>${m.activo === false ? "Inactivo" : "Activo"}</td>
              <td>
                <button class="btn btn--ghost btn--sm" data-edit="${esc(m.id)}">Editar</button>
                <button class="btn btn--ghost btn--sm" data-toggle="${esc(m.id)}">${m.activo === false ? "Activar" : "Desactivar"}</button>
                <button class="btn btn--ghost btn--sm" data-del="${esc(m.id)}">Eliminar</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  cont.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => abrirModalMetodo(metodos.find((m) => m.id === b.dataset.edit))));
  cont.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => toggleMetodo(b.dataset.toggle)));
  cont.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => eliminarMetodo(b.dataset.del)));
}

async function cargarMetodos() {
  const snap = await getDocs(collection(db, "metodos_pago"));
  metodos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderMetodos();
}

async function toggleMetodo(id) {
  const m = metodos.find((x) => x.id === id);
  if (!m) return;
  try {
    await updateDoc(doc(db, "metodos_pago", id), { activo: m.activo === false });
    await cargarMetodos();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

async function eliminarMetodo(id) {
  if (!confirm("¿Eliminar este método de pago?")) return;
  try {
    await deleteDoc(doc(db, "metodos_pago", id));
    await cargarMetodos();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

// Quita `principal: true` de todas las cuentas salvo la indicada,
// para que solo exista UNA cuenta principal a la vez.
async function quitarPrincipalDeOtros(exceptId) {
  const snap = await getDocs(collection(db, "metodos_pago"));
  const tareas = [];
  snap.forEach((d) => {
    if (d.id !== exceptId && d.data().principal === true) {
      tareas.push(updateDoc(doc(db, "metodos_pago", d.id), { principal: false }));
    }
  });
  await Promise.all(tareas);
}

async function agregarMetodo(ev) {
  ev.preventDefault();
  const form = ev.target;
  const nombre = (form.querySelector("input[name=nombre]").value || "").trim();
  const tipoCuenta = form.querySelector("select[name=tipoCuenta]").value || "Ahorros";
  const numeroCuenta = (form.querySelector("input[name=numeroCuenta]").value || "").trim();
  const titular = (form.querySelector("input[name=titular]").value || "").trim();
  const principal = form.querySelector("input[name=principal]").checked;
  if (!nombre) return;
  try {
    if (principal) await quitarPrincipalDeOtros(null);
    await addDoc(collection(db, "metodos_pago"), {
      nombre,
      tipoCuenta,
      numeroCuenta: numeroCuenta || null,
      titular: titular || null,
      principal: !!principal,
      tipo: "otro",
      descripcion: null,
      activo: true,
      orden: 0,
      createdAt: serverTimestamp()
    });
    form.reset();
    await cargarMetodos();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

function abrirModalMetodo(metodo) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  const m = metodo || {};
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-metodo" novalidate>
        <h2>Editar método de pago</h2>
        <div class="form-grid two">
          <label class="field"><span>Nombre *</span><input name="nombre" required maxlength="60" value="${esc(m.nombre || "")}" /></label>
          <label class="field"><span>Tipo de cuenta</span>
            <select name="tipoCuenta">
              <option value="Ahorros" ${m.tipoCuenta === "Ahorros" ? "selected" : ""}>Ahorros</option>
              <option value="Corriente" ${m.tipoCuenta === "Corriente" ? "selected" : ""}>Corriente</option>
            </select>
          </label>
          <label class="field"><span>Número de cuenta</span><input name="numeroCuenta" value="${esc(m.numeroCuenta || "")}" /></label>
          <label class="field"><span>Titular</span><input name="titular" value="${esc(m.titular || "")}" /></label>
        </div>
        <label class="radio"><input type="checkbox" name="principal" ${m.principal ? "checked" : ""} /> Usar como cuenta principal para el cobro</label>
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
  root.querySelector("#modal-metodo").addEventListener("submit", (ev) => guardarMetodo(ev, metodo));
}

async function guardarMetodo(ev, metodo) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const d = Object.fromEntries(new FormData(ev.target).entries());
  const nombre = (d.nombre || "").trim();
  const principal = ev.target.querySelector("input[name=principal]").checked;

  if (!nombre) {
    msg.textContent = "El nombre es obligatorio.";
    msg.className = "modal__msg err";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando…";
  msg.className = "modal__msg";
  msg.textContent = "";

  try {
    if (principal) await quitarPrincipalDeOtros(metodo.id);
    await updateDoc(doc(db, "metodos_pago", metodo.id), {
      nombre,
      tipoCuenta: d.tipoCuenta,
      numeroCuenta: (d.numeroCuenta || "").trim() || null,
      titular: (d.titular || "").trim() || null,
      principal: !!principal,
      updatedAt: serverTimestamp()
    });
    document.getElementById("modal-root").innerHTML = "";
    await cargarMetodos();
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

// ---------------- Recordatorios ----------------
async function cargarConfig() {
  const snap = await getDocs(collection(db, "configuracion"));
  const cfg = {};
  snap.forEach((d) => { cfg[d.id] = d.data().valor; });
  document.getElementById("cfg-diasSuspension").value = cfg.diasSuspension ?? 3;

  document.getElementById("cfg-whatsapp1").value = (cfg.soporte && cfg.soporte.whatsapp1) || "";
  document.getElementById("cfg-whatsapp2").value = (cfg.soporte && cfg.soporte.whatsapp2) || "";

  document.getElementById("cfg-plantilla-antes").value = (cfg.plantillasMensaje && cfg.plantillasMensaje.antesCorte) || "";
  document.getElementById("cfg-plantilla-despues").value = (cfg.plantillasMensaje && cfg.plantillasMensaje.despuesCorte) || "";
  document.getElementById("plantilla-nota").textContent = cfg.plantillasMensaje
    ? ""
    : "Todavía no has guardado plantillas propias: el sistema está usando las de fábrica. Si guardas algo aquí, reemplazará a las de fábrica.";
}

/* KZ-UNEF-028 · Los días de aviso ya NO se configuran: la regla es fija (dos
   avisos por corte, 3 días antes y el día del corte, a las 10:00). Se quitó el
   formulario editable para no ofrecer un ajuste que no hace nada. Lo único que
   sigue siendo configurable es cuántos días de mora se esperan para suspender. */
async function guardarConfig() {
  const msg = document.getElementById("cfg-msg");
  const diasSuspension = Number(document.getElementById("cfg-diasSuspension").value);

  if (!diasSuspension || diasSuspension < 1 || diasSuspension > 60) {
    msg.textContent = "Escribe un número de días entre 1 y 60.";
    msg.className = "modal__msg err";
    return;
  }

  msg.className = "modal__msg";
  msg.textContent = "Guardando…";

  try {
    await setDoc(doc(db, "configuracion", "diasSuspension"), {
      clave: "diasSuspension", valor: diasSuspension, descripcion: "Días de mora para suspender", updatedAt: serverTimestamp()
    });
    msg.textContent = "Configuración guardada.";
    msg.className = "modal__msg ok";
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
  }
}

// ---------------- WhatsApp de soporte ----------------
async function guardarSoporte() {
  const msg = document.getElementById("soporte-msg");
  const w1 = (document.getElementById("cfg-whatsapp1").value || "").trim().replace(/\D/g, "");
  const w2 = (document.getElementById("cfg-whatsapp2").value || "").trim().replace(/\D/g, "");

  if (w1.length < 7 || w2.length < 7) {
    msg.textContent = "Cada WhatsApp debe tener al menos 7 dígitos.";
    msg.className = "modal__msg err";
    return;
  }

  msg.className = "modal__msg";
  msg.textContent = "Guardando…";

  try {
    await setDoc(doc(db, "configuracion", "soporte"), {
      clave: "soporte",
      valor: { whatsapp1: w1, whatsapp2: w2 },
      descripcion: "WhatsApp que aparecen en los mensajes de cobro",
      updatedAt: serverTimestamp()
    });
    msg.textContent = "WhatsApp de soporte guardados.";
    msg.className = "modal__msg ok";
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
  }
}

// ---------------- Plantillas de los mensajes de cobro ----------------
async function guardarPlantillas() {
  const msg = document.getElementById("plantillas-msg");
  const antesCorte = document.getElementById("cfg-plantilla-antes").value.trim();
  const despuesCorte = document.getElementById("cfg-plantilla-despues").value.trim();

  if (!antesCorte || !despuesCorte) {
    msg.textContent = "Las dos plantillas son obligatorias: no pueden quedar vacías.";
    msg.className = "modal__msg err";
    return;
  }

  msg.className = "modal__msg";
  msg.textContent = "Guardando…";

  try {
    await setDoc(doc(db, "configuracion", "plantillasMensaje"), {
      clave: "plantillasMensaje",
      valor: { antesCorte, despuesCorte },
      descripcion: "Plantillas de los mensajes de cobro",
      updatedAt: serverTimestamp()
    });
    document.getElementById("plantilla-nota").textContent = "";
    msg.textContent = "Plantillas guardadas.";
    msg.className = "modal__msg ok";
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
  }
}

// ---------------- Datos de demostración ----------------
async function seedDemo() {
  const msg = document.getElementById("demo-msg");
  msg.className = "modal__msg";
  msg.textContent = "Creando…";
  try {
    const res = await call("seedDemo")();
    msg.textContent = `Se crearon ${res.data && res.data.creados} clientes DEMO.`;
    msg.className = "modal__msg ok";
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
  }
}

async function borrarDemo() {
  if (!confirm("¿Borrar todos los datos DEMO? (No afecta datos reales)")) return;
  const msg = document.getElementById("demo-msg");
  msg.className = "modal__msg";
  msg.textContent = "Borrando…";
  try {
    const res = await call("borrarDemo")();
    msg.textContent = `Se eliminaron ${res.data && res.data.eliminados} documentos DEMO.`;
    msg.className = "modal__msg ok";
  } catch (err) {
    console.error(err);
    msg.textContent = msgError(err);
    msg.className = "modal__msg err";
  }
}

(async function main() {
  const ctx = await requireAuth("configuracion");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = `
    <div class="detail-grid">
      <div class="panel span-2">
        <h2>Métodos de pago</h2>
        <div id="metodos-lista"></div>
        <form id="form-metodo" class="form-grid" style="margin-top:16px;">
          <label class="field"><span>Nuevo método *</span><input name="nombre" placeholder="Ej. PSE" required maxlength="60" /></label>
          <label class="field"><span>Tipo de cuenta</span>
            <select name="tipoCuenta">
              <option value="Ahorros">Ahorros</option>
              <option value="Corriente">Corriente</option>
            </select>
          </label>
          <label class="field"><span>Número de cuenta</span><input name="numeroCuenta" /></label>
          <label class="field"><span>Titular</span><input name="titular" /></label>
          <label class="radio"><input type="checkbox" name="principal" /> Usar como cuenta principal para el cobro</label>
          <div class="actions"><button class="btn btn--primary">Agregar</button></div>
        </form>
        <p class="muted" style="font-size:0.82rem;margin-top:10px;">Los métodos activos se muestran públicamente en la landing.</p>
        <p class="muted" style="font-size:0.82rem;margin-top:10px;">La cuenta principal es la que aparece en los mensajes de cobro que se envían a los clientes.</p>
        <div id="modal-root"></div>
      </div>

      <div class="panel span-2">
        <h2>Recordatorios de pago</h2>
        <div class="panel" style="background:var(--surface-2);border-color:rgba(0,176,240,0.3);">
          <p style="margin:0 0 8px;font-weight:600;">La regla es fija: dos avisos por cada corte, a las 10:00 a.m.</p>
          <ul class="muted" style="margin:0 0 0 18px;font-size:0.9rem;line-height:1.7;">
            <li>Corte del <strong>15</strong>: aviso el <strong>12</strong> y el <strong>15</strong>.</li>
            <li>Corte del <strong>30</strong>: aviso el <strong>27</strong> y el <strong>30</strong> (en febrero, el último día del mes).</li>
            <li>Si el cliente ya pagó, no se le envía ninguno.</li>
          </ul>
          <p class="muted" style="margin:10px 0 0;font-size:0.82rem;">Los mensajes de esos dos avisos se editan abajo, en «Plantillas de los mensajes de cobro».</p>
        </div>
        <div class="form-grid" style="margin-top:14px;">
          <label class="field"><span>Días de mora antes de suspender el servicio</span><input id="cfg-diasSuspension" type="number" min="1" max="60" /></label>
        </div>
        <div class="actions" style="margin-top:16px;"><button class="btn btn--primary" id="btn-guardar-config">Guardar configuración</button></div>
        <p class="modal__msg" id="cfg-msg" role="status"></p>
      </div>

      <div class="panel span-2">
        <h2>Datos de demostración</h2>
        <p class="muted" style="margin-bottom:12px;">Crea o elimina clientes DEMO claramente identificados (campo <code>demo: true</code>). Úsalo solo en pruebas, nunca mezclado con datos reales.</p>
        <div class="actions">
          <button class="btn btn--primary" id="btn-seed-demo">Crear datos DEMO</button>
          <button class="btn btn--ghost" id="btn-borrar-demo">Borrar datos DEMO</button>
        </div>
        <p class="modal__msg" id="demo-msg" role="status"></p>
      </div>

      <div class="panel span-2">
        <h2>WhatsApp de soporte</h2>
        <div class="form-grid">
          <label class="field"><span>WhatsApp de soporte 1</span><input id="cfg-whatsapp1" placeholder="Solo números" /></label>
          <label class="field"><span>WhatsApp de soporte 2</span><input id="cfg-whatsapp2" placeholder="Solo números" /></label>
        </div>
        <div class="actions" style="margin-top:16px;"><button class="btn btn--primary" id="btn-guardar-soporte">Guardar WhatsApp</button></div>
        <p class="modal__msg" id="soporte-msg" role="status"></p>
      </div>

      <div class="panel span-2">
        <h2>Plantillas de los mensajes de cobro</h2>
        <div class="form-grid">
          <label class="field"><span>Mensaje antes del corte</span><textarea id="cfg-plantilla-antes" rows="4"></textarea></label>
          <label class="field"><span>Mensaje después del corte</span><textarea id="cfg-plantilla-despues" rows="4"></textarea></label>
        </div>
        <p class="muted" id="plantilla-nota"></p>
        <p class="muted">Marcadores disponibles: {nombre} {mes} {valor} {fechaLimite} {banco} {tipoCuenta} {numeroCuenta} {titular} {whatsappSoporte1} {whatsappSoporte2}</p>
        <div class="actions" style="margin-top:16px;"><button class="btn btn--primary" id="btn-guardar-plantillas">Guardar plantillas</button></div>
        <p class="modal__msg" id="plantillas-msg" role="status"></p>
      </div>
    </div>`;

  document.getElementById("form-metodo").addEventListener("submit", agregarMetodo);
  document.getElementById("btn-guardar-config").addEventListener("click", guardarConfig);
  document.getElementById("btn-seed-demo").addEventListener("click", seedDemo);
  document.getElementById("btn-borrar-demo").addEventListener("click", borrarDemo);
  document.getElementById("btn-guardar-soporte").addEventListener("click", guardarSoporte);
  document.getElementById("btn-guardar-plantillas").addEventListener("click", guardarPlantillas);

  await cargarMetodos();
  await cargarConfig();
})();
