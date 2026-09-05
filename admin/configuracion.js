/* ============================================================
 * UNEFIBRAS SAS — Admin: configuración (SUPERADMIN)
 * ------------------------------------------------------------
 *  · Métodos de pago (colección `metodos_pago`): alta, activar/
 *    desactivar y eliminar. Se muestran en la landing.
 *  · Recordatorios automáticos (colección `configuracion`):
 *    intervalos que usa el motor de vencimientos.
 * Las escrituras están restringidas a SUPERADMIN por Security Rules.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { collection, getDocs, addDoc, doc, updateDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { msgError } from "../assets/js/admin/ui.js";

let metodos = [];

// ---------------- Métodos de pago ----------------
function renderMetodos() {
  const cont = document.getElementById("metodos-lista");
  if (!cont) return;
  if (!metodos.length) {
    cont.innerHTML = '<p class="muted">Sin métodos configurados.</p>';
    return;
  }
  cont.innerHTML = metodos.map((m) => `
    <div class="kv__item">
      <span>${m.nombre} <span class="muted">· ${m.activo === false ? "inactivo" : "activo"}</span></span>
      <div class="actions">
        <button class="btn btn--ghost btn--sm" data-toggle="${m.id}">${m.activo === false ? "Activar" : "Desactivar"}</button>
        <button class="btn btn--ghost btn--sm" data-del="${m.id}">Eliminar</button>
      </div>
    </div>`).join("");

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

async function agregarMetodo(ev) {
  ev.preventDefault();
  const input = ev.target.querySelector("input[name=nombre]");
  const nombre = (input.value || "").trim();
  if (!nombre) return;
  try {
    await addDoc(collection(db, "metodos_pago"), {
      nombre,
      tipo: "otro",
      numeroCuenta: null,
      titular: null,
      descripcion: null,
      activo: true,
      orden: 0,
      createdAt: serverTimestamp()
    });
    input.value = "";
    await cargarMetodos();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

// ---------------- Recordatorios ----------------
function parseLista(id) {
  const el = document.getElementById(id);
  return el.value.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
}

async function cargarConfig() {
  const snap = await getDocs(collection(db, "configuracion"));
  const cfg = {};
  snap.forEach((d) => { cfg[d.id] = d.data().valor; });
  document.getElementById("cfg-diasAntes").value = (cfg.diasAntes || [7, 5, 3, 1]).join(", ");
  document.getElementById("cfg-diasDespues").value = (cfg.diasDespues || [0, -1, -3]).join(", ");
  document.getElementById("cfg-diasSuspension").value = cfg.diasSuspension ?? 5;
}

async function guardarConfig() {
  const msg = document.getElementById("cfg-msg");
  const diasAntes = parseLista("cfg-diasAntes");
  const diasDespues = parseLista("cfg-diasDespues");
  const diasSuspension = Number(document.getElementById("cfg-diasSuspension").value);

  if (!diasAntes.length || !diasDespues.length || !diasSuspension) {
    msg.textContent = "Revisa los valores ingresados.";
    msg.className = "modal__msg err";
    return;
  }

  msg.className = "modal__msg";
  msg.textContent = "Guardando…";

  try {
    await Promise.all([
      setDoc(doc(db, "configuracion", "diasAntes"), {
        clave: "diasAntes", valor: diasAntes, descripcion: "Días antes del vencimiento para recordatorios", updatedAt: serverTimestamp()
      }),
      setDoc(doc(db, "configuracion", "diasDespues"), {
        clave: "diasDespues", valor: diasDespues, descripcion: "Día del vencimiento (0) y posteriores (negativos)", updatedAt: serverTimestamp()
      }),
      setDoc(doc(db, "configuracion", "diasSuspension"), {
        clave: "diasSuspension", valor: diasSuspension, descripcion: "Días de mora para suspender", updatedAt: serverTimestamp()
      })
    ]);
    msg.textContent = "Configuración guardada.";
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
        <div id="metodos-lista" class="kv"></div>
        <form id="form-metodo" class="form-grid" style="margin-top:16px;">
          <label class="field"><span>Nuevo método</span><input name="nombre" placeholder="Ej. PSE" required maxlength="60" /></label>
          <div class="actions"><button class="btn btn--primary">Agregar</button></div>
        </form>
        <p class="muted" style="font-size:0.82rem;margin-top:10px;">Los métodos activos se muestran públicamente en la landing.</p>
      </div>

      <div class="panel span-2">
        <h2>Recordatorios automáticos</h2>
        <div class="form-grid">
          <label class="field"><span>Días antes del vencimiento (separados por coma)</span><input id="cfg-diasAntes" /></label>
          <label class="field"><span>Día del vencimiento y posteriores (0 = hoy, negativos = después)</span><input id="cfg-diasDespues" /></label>
          <label class="field"><span>Días de mora para suspender</span><input id="cfg-diasSuspension" type="number" min="1" /></label>
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
    </div>`;

  document.getElementById("form-metodo").addEventListener("submit", agregarMetodo);
  document.getElementById("btn-guardar-config").addEventListener("click", guardarConfig);
  document.getElementById("btn-seed-demo").addEventListener("click", seedDemo);
  document.getElementById("btn-borrar-demo").addEventListener("click", borrarDemo);

  await cargarMetodos();
  await cargarConfig();
})();
