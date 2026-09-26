/* ============================================================
 * UneFibra SAS — Admin: blog (artículos de la colección `posts`)
 * ------------------------------------------------------------
 * Permite crear/editar/publicar/despublicar/eliminar artículos.
 * El blog público se sirve como HTML estático generado, así que
 * estos cambios NO aparecen en el sitio hasta que se vuelva a
 * ejecutar el generador. Las escrituras están restringidas a
 * ADMIN+ por Security Rules.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { msgError } from "../assets/js/admin/ui.js";

let ctx = null;
let posts = [];

/** Escapa texto para insertarlo de forma segura en HTML/atributos. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Hoy en zona Colombia (UTC-5), formato "YYYY-MM-DD". */
function hoyISO() {
  const d = new Date(Date.now() - 5 * 3600000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/** Genera un slug desde el título: minúsculas, sin acentos, solo [a-z0-9] y guiones. */
function generarSlug(titulo) {
  return String(titulo || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Badge propio para el estado del artículo (NO usa badgeEstado de ui.js). */
function badgePost(estado) {
  if (estado === "PUBLICADO") {
    return '<span class="badge-estado tone-green">Publicado</span>';
  }
  return '<span class="badge-estado tone-amber">Borrador</span>';
}

function renderToolbar() {
  const canWrite = ctx.rol !== "OPERADOR";
  return `
    <div class="toolbar">
      <span class="muted">El blog se publica como HTML estático generado (lo indexan los buscadores). Los cambios NO aparecen en el sitio hasta que se vuelva a ejecutar el generador: ocurre solo en cada despliegue y una vez al día. Un artículo en BORRADOR nunca se publica.</span>
      ${canWrite ? '<button class="btn btn--primary" id="btn-nuevo">+ Nuevo artículo</button>' : ""}
    </div>
    <div class="table-wrap" id="tabla"></div>
    <div id="modal-root"></div>`;
}

function renderTabla() {
  const cont = document.getElementById("tabla");
  const canWrite = ctx.rol !== "OPERADOR";

  if (!posts.length) {
    cont.innerHTML = '<div class="empty">Todavía no hay artículos. Crea el primero y publícalo para que aparezca en el blog.</div>';
    return;
  }

  // Ordena por fecha descendente (más recientes primero).
  const ordenados = [...posts].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

  const rows = ordenados.map((p) => `
    <tr data-id="${p.id}">
      <td>${esc(p.titulo) || "—"}</td>
      <td>${esc(p.slug) || "—"}</td>
      <td>${badgePost(p.estado)}</td>
      <td>${esc(p.fecha) || "—"}</td>
      <td>${canWrite ? `
        <button class="btn btn--ghost btn--sm" data-edit="${p.id}">Editar</button>
        <button class="btn btn--ghost btn--sm" data-toggle="${p.id}">${p.estado === "PUBLICADO" ? "Despublicar" : "Publicar"}</button>
        <button class="btn btn--ghost btn--sm" data-del="${p.id}">Eliminar</button>` : "—"}
      </td>
    </tr>`).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Título</th><th>Slug</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  cont.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => abrirModal(posts.find((p) => p.id === b.dataset.edit))));
  cont.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => togglePublicado(b.dataset.toggle)));
  cont.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => eliminarPost(b.dataset.del)));
}

function abrirModal(post) {
  const root = document.getElementById("modal-root");
  const p = post || {};
  const etiquetas = (p.etiquetas || []).join(", ");
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modal-form" novalidate>
        <h2>${post ? "Editar artículo" : "Nuevo artículo"}</h2>
        <div class="form-grid two">
          <label class="field"><span>Título *</span><input name="titulo" required maxlength="120" value="${esc(p.titulo)}" /></label>
          <label class="field"><span>Slug</span><input name="slug" placeholder="se genera del título" value="${esc(p.slug)}" /></label>
        </div>
        <label class="field"><span>Resumen (meta descripción)</span><textarea name="resumen" maxlength="200" rows="2">${esc(p.resumen)}</textarea></label>
        <label class="field"><span>Contenido *</span><textarea name="contenido" required rows="10">${esc(p.contenido)}</textarea></label>
        <p class="muted">Formato del contenido: párrafos separados por línea en blanco, "## " para subtítulos, "- " para listas y **negrita**.</p>
        <div class="form-grid two">
          <label class="field"><span>Etiquetas (separadas por coma)</span><input name="etiquetas" placeholder="fibra, internet" value="${esc(etiquetas)}" /></label>
          <label class="field"><span>Imagen (URL)</span><input name="imagen" type="url" placeholder="https://…" value="${esc(p.imagen)}" /></label>
          <label class="field"><span>Estado</span>
            <select name="estado">
              <option value="BORRADOR" ${p.estado !== "PUBLICADO" ? "selected" : ""}>Borrador</option>
              <option value="PUBLICADO" ${p.estado === "PUBLICADO" ? "selected" : ""}>Publicado</option>
            </select>
          </label>
          <label class="field"><span>Fecha de publicación</span><input name="fecha" type="date" value="${esc(p.fecha || hoyISO())}" /></label>
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
  root.querySelector("#modal-form").addEventListener("submit", (ev) => guardarPost(ev, post));
}

async function guardarPost(ev, post) {
  ev.preventDefault();
  const msg = document.getElementById("modal-msg");
  const btn = document.getElementById("btn-guardar");
  const d = Object.fromEntries(new FormData(ev.target).entries());

  const titulo = (d.titulo || "").trim();
  const contenido = (d.contenido || "").trim();

  if (!titulo || !contenido) {
    msg.textContent = "Título y contenido son obligatorios.";
    msg.className = "modal__msg err";
    return;
  }

  let slug = (d.slug || "").trim().toLowerCase();
  if (!slug) slug = generarSlug(titulo);
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || /^-|-$/.test(slug)) {
    msg.textContent = "El slug solo admite minúsculas, números y guiones (sin guiones al inicio o al final).";
    msg.className = "modal__msg err";
    return;
  }

  // El slug debe ser único en la colección (excluye el propio documento al editar).
  const duplicado = posts.some((x) => x.slug === slug && x.id !== (post && post.id));
  if (duplicado) {
    msg.textContent = "Ya existe otro artículo con ese slug. Usa uno distinto o deja el campo vacío para generarlo del título.";
    msg.className = "modal__msg err";
    return;
  }

  const etiquetas = String(d.etiquetas || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const payload = {
    titulo,
    slug,
    resumen: (d.resumen || "").trim() || null,
    contenido,
    etiquetas,
    imagen: (d.imagen || "").trim() || null,
    estado: d.estado,
    fecha: d.fecha || hoyISO(),
    updatedAt: serverTimestamp()
  };

  btn.disabled = true;
  btn.textContent = "Guardando…";
  msg.className = "modal__msg";
  msg.textContent = "";

  try {
    if (post) {
      await updateDoc(doc(db, "posts", post.id), payload);
    } else {
      await addDoc(collection(db, "posts"), { ...payload, createdAt: serverTimestamp() });
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

async function togglePublicado(id) {
  const p = posts.find((x) => x.id === id);
  if (!p) return;
  const publicar = p.estado !== "PUBLICADO";
  if (!confirm(`¿${publicar ? "Publicar" : "Despublicar"} el artículo "${p.titulo}"?`)) return;
  try {
    await updateDoc(doc(db, "posts", id), {
      estado: publicar ? "PUBLICADO" : "BORRADOR",
      updatedAt: serverTimestamp()
    });
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

async function eliminarPost(id) {
  const p = posts.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`¿Eliminar el artículo "${p.titulo}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "posts", id));
    await cargar();
  } catch (err) {
    console.error(err);
    alert(msgError(err));
  }
}

async function cargar() {
  const snap = await getDocs(collection(db, "posts"));
  posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTabla();
}

(async function main() {
  ctx = await requireAuth("blog");
  if (!ctx) return;

  const content = document.getElementById("app-content");
  content.innerHTML = renderToolbar();

  const btnNuevo = document.getElementById("btn-nuevo");
  if (btnNuevo) btnNuevo.addEventListener("click", () => abrirModal(null));

  try {
    await cargar();
  } catch (err) {
    console.error(err);
    document.getElementById("tabla").innerHTML = '<div class="empty">No fue posible cargar los artículos.</div>';
  }
})();
