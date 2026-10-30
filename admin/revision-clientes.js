/* ============================================================
 * UneFibra SAS — Admin: Revisión de clientes (KZ-UNEF-031)
 * ------------------------------------------------------------
 * QUÉ HACE
 * Le muestra al propietario, en lenguaje comercial, los servicios migrados a los
 * que les falta un dato (valor mensual, día de corte o fecha de cobro) y le deja
 * confirmarlos o corregirlos con tres controles: valor, día de corte y fecha.
 *
 * QUÉ NO HACE
 *  · No escribe nada sin que él pulse «Guardar y confirmar».
 *  · No cambia el estado de conciliación ni habilita el cobro: eso es un acto
 *    aparte. Confirmar el dato NO significa empezar a cobrar.
 *  · No inventa fechas: si propone una, es el próximo día de corte y se ve antes
 *    de guardar.
 *
 * Las reglas viven en dos copias (navegador y servidor) y una prueba de paridad
 * (functions/test/revision-reglas-paridad.test.js) falla si se separan.
 * ============================================================ */

import { db } from "../assets/js/admin/core.js";
import { requireAuth } from "../assets/js/admin/shell.js";
import { call } from "../assets/js/admin/callables.js";
import { esc, fmtMoney, fmtFecha } from "../assets/js/admin/ui.js";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";

const R = window.RevisionReglas;
const $ = (sel) => document.querySelector(sel);

const estado = {
  servicios: [],
  clientes: new Map(),
  planes: new Map(),
  filtro: "pendientes",
  busqueda: "",
  cargando: true,
  aviso: null
};

const CICLOS = ["15", "30"];
/* KZ-UNEF-033 · Recuerda el último guardado para que, al repintar la lista, esa
   tarjeta vuelva a mostrarse abierta con su mensaje (antes el aviso desaparecía). */
let ultimoGuardado = null;

function nombreDeCliente(id) {
  const c = estado.clientes.get(id);
  return c ? (c.nombreCompleto || c.nombre || "(sin nombre)") : "(cliente no encontrado)";
}

function planDe(servicio, cliente) {
  const id = servicio.planId || (cliente && cliente.planId);
  const p = id ? estado.planes.get(id) : null;
  return { id: id || null, nombre: (p && p.nombre) || (id ? "(plan sin nombre)" : null), precio: p ? p.precio : null };
}

function datosDe(servicio, cliente) {
  const plan = planDe(servicio, cliente);
  const motivos = R.motivosDeRevision({ servicio, cliente: cliente || {}, plan: plan.id ? { precio: plan.precio } : null });
  const confirmado = !!(servicio.revisionComercial && servicio.revisionComercial.estado === "CONFIRMADA");
  return {
    servicio, cliente: cliente || {}, plan, motivos, confirmado,
    precio: typeof servicio.precioMensual === "number" ? servicio.precioMensual
      : (cliente && typeof cliente.precioMensual === "number" ? cliente.precioMensual : null),
    ciclo: servicio.cicloCorte || (cliente && cliente.cicloCorte) || null,
    fecha: servicio.fechaVencimiento || (cliente && cliente.fechaVencimiento) || null
  };
}

async function cargar() {
  try {
    const [serviciosSnap, clientesSnap, planesSnap] = await Promise.all([
      getDocs(collection(db, "servicios")),
      getDocs(collection(db, "clientes")),
      getDocs(collection(db, "planes"))
    ]);
    estado.servicios = serviciosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.clientes = new Map(clientesSnap.docs.map((d) => [d.id, d.data()]));
    estado.planes = new Map(planesSnap.docs.map((d) => [d.id, d.data()]));
  } catch (e) {
    console.error("No se pudieron cargar los datos:", e);
    estado.aviso = "No se pudieron cargar los datos (" + (e.code || e.message) + "). Refresca la página.";
  }
  estado.cargando = false;
  render();
}

function filas() {
  const q = estado.busqueda.trim().toLowerCase();
  return estado.servicios
    .map((s) => datosDe(s, estado.clientes.get(s.clienteId)))
    .filter((f) => {
      if (estado.filtro === "pendientes") { if (f.confirmado) return false; }
      else if (estado.filtro === "confirmados") { if (!f.confirmado) return false; }
      if (!q) return true;
      const c = f.cliente || {};
      const heno = [c.nombreCompleto, c.nombre, c.documento, c.telefono, f.servicio.id, f.servicio.ip]
        .filter(Boolean).join(" ").toLowerCase();
      return heno.indexOf(q) !== -1;
    })
    .sort((a, b) => {
      // Primero lo que impide cobrar, después lo que solo hay que confirmar.
      const peso = (f) => f.motivos.includes("SIN_PRECIO") ? 0 : (f.motivos.includes("SIN_CORTE") ? 1 : 2);
      const d = peso(a) - peso(b);
      return d !== 0 ? d : nombreDeCliente(a.servicio.clienteId).localeCompare(nombreDeCliente(b.servicio.clienteId));
    });
}

function contadores() {
  let pendientes = 0, confirmados = 0;
  for (const s of estado.servicios) {
    if (s.revisionComercial && s.revisionComercial.estado === "CONFIRMADA") confirmados++;
    else if (R.necesitaRevision({ servicio: s, cliente: estado.clientes.get(s.clienteId) || {} })) pendientes++;
  }
  return { pendientes, confirmados };
}

function tarjeta(f) {
  const c = f.cliente || {};
  const recien = !!(ultimoGuardado && ultimoGuardado.servicioId === f.servicio.id);
  const nombre = esc(c.nombreCompleto || c.nombre || "(sin nombre)");
  const planTxt = f.plan.nombre ? esc(f.plan.nombre) : '<span class="muted">sin plan</span>';
  const valorTxt = typeof f.precio === "number" && f.precio > 0 ? fmtMoney(f.precio) : '<span class="muted">sin valor</span>';
  const corteTxt = f.ciclo ? "día " + esc(f.ciclo) : '<span class="muted">sin día de corte</span>';
  const fechaTxt = f.fecha ? fmtFecha(f.fecha) : '<span class="muted">sin fecha</span>';
  const valorInput = f.precio || "";
  const cicloPropuesto = f.ciclo || "30";
  const fechaPropuesta = f.fecha || R.proximoCorteDe(cicloPropuesto, new Date().toISOString().slice(0, 10)) || "";
  const tono = f.confirmado ? "tone-green" : (f.motivos.includes("SIN_PRECIO") ? "tone-red" : "tone-amber");
  const etiqueta = f.confirmado ? "Confirmado" : "Por revisar";

  const falta = f.motivos.length
    ? `<div class="rev__falta"><strong>Qué falta confirmar</strong><ul>${f.motivos.map((m) => `<li>${esc(R.TEXTO[m] || m)}</li>`).join("")}</ul></div>`
    : `<div class="rev__falta" style="background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.3)"><strong>Datos completos</strong><div class="muted">Ya está confirmado con estos valores.</div></div>`;

  /* KZ-UNEF-033 · La tarjeta muestra SOLO el resumen (nombre, plan, valor, corte,
     fecha, estado y qué falta). El formulario se abre con «Revisar cliente», para
     que el propietario pueda recorrer la lista sin seis controles por tarjeta. */
  return `<article class="card" data-servicio="${esc(f.servicio.id)}">
    <div class="rev__head">
      <h3>${nombre}</h3>
      <span class="badge-estado ${tono}">${etiqueta}</span>
    </div>
    <div class="rev__datos">
      <span>Plan: <b>${planTxt}</b></span>
      <span>Valor mensual: <b>${valorTxt}</b></span>
      <span>Corte: <b>${corteTxt}</b></span>
      <span>Fecha de cobro: <b>${fechaTxt}</b></span>
    </div>
    ${falta}
    <div class="rev__acciones">
      <button class="btn btn--primary" data-accion="revisar" aria-expanded="${recien ? "true" : "false"}" aria-controls="editor-${esc(f.servicio.id)}">${recien ? "Ocultar formulario" : "Revisar cliente"}</button>
      <a class="btn btn--ghost" href="cliente.html?id=${encodeURIComponent(f.servicio.clienteId || "")}">Ver ficha</a>
    </div>
    <div class="rev__editor" id="editor-${esc(f.servicio.id)}"${recien ? "" : " hidden"}>
      <div class="rev__form">
        <label class="field"><span>Valor mensual (COP)</span>
          <input type="number" min="1" step="1000" inputmode="numeric" data-campo="precioMensual" value="${esc(valorInput)}" /></label>
        <label class="field"><span>Día de corte</span>
          <select class="sel" data-campo="cicloCorte">${CICLOS.map((v) => `<option value="${v}" ${String(f.ciclo) === v ? "selected" : ""}>Día ${v}</option>`).join("")}</select></label>
        <label class="field"><span>Fecha de cobro</span>
          <input type="date" data-campo="fechaVencimiento" value="${esc(fechaPropuesta)}" /></label>
      </div>
      <label class="field" style="margin-top:10px"><span>Motivo del cambio (obligatorio si el cliente ya tiene pagos)</span>
        <input data-campo="motivo" maxlength="200" placeholder="Ej.: el cliente cambió al corte 15" /></label>
      <div class="rev__acciones">
        <button class="btn btn--primary" data-accion="guardar">Guardar y confirmar</button>
        <button class="btn btn--ghost" type="button" data-accion="cerrar">Cancelar</button>
      </div>
      <p class="rev__msg${recien ? " is-ok" : ""}"${recien ? "" : " hidden"}>${recien ? esc(ultimoGuardado.mensaje) : ""}</p>
    </div>
  </article>`;
}

function render() {
  if (!estado.aviso && estado.cargando) return;
  const lista = $("#lista");
  if (!lista) return;
  const c = contadores();
  const filasVisibles = filas();

  $("#contador").textContent = c.pendientes + " por revisar · " + c.confirmados + " confirmados · " + estado.servicios.length + " servicios";
  document.querySelectorAll("[data-filtro]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.filtro === estado.filtro);
    if (b.dataset.filtro === "pendientes") b.textContent = "Por revisar (" + c.pendientes + ")";
    if (b.dataset.filtro === "confirmados") b.textContent = "Confirmados (" + c.confirmados + ")";
  });

  const aviso = $("#aviso");
  if (estado.aviso) {
    aviso.innerHTML = `<div class="panel aviso-lectura"><p>${esc(estado.aviso)}</p></div>`;
  }

  lista.innerHTML = filasVisibles.length
    ? filasVisibles.map(tarjeta).join("")
    : `<div class="panel empty">${estado.busqueda ? "No hay coincidencias con esa búsqueda." : (estado.filtro === "pendientes" ? "No queda ningún dato por revisar. 🎉" : "Todavía no hay registros confirmados.")}</div>`;

  lista.querySelectorAll("[data-accion='guardar']").forEach((btn) => {
    btn.addEventListener("click", () => guardar(btn.closest(".card")));
  });

  /* «Revisar cliente» abre el formulario de ESA tarjeta; «Cancelar» lo cierra sin
     guardar nada (protección contra cambios accidentales). */
  lista.querySelectorAll("[data-accion='revisar']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const editor = card.querySelector(".rev__editor");
      if (!editor) return;
      editor.hidden = !editor.hidden;
      btn.setAttribute("aria-expanded", String(!editor.hidden));
      btn.textContent = editor.hidden ? "Revisar cliente" : "Ocultar formulario";
      if (!editor.hidden) {
        const primero = editor.querySelector("input, select");
        if (primero) primero.focus({ preventScroll: true });
        editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  });
  lista.querySelectorAll("[data-accion='cerrar']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const editor = card.querySelector(".rev__editor");
      const abrir = card.querySelector("[data-accion='revisar']");
      if (editor) editor.hidden = true;
      if (abrir) { abrir.setAttribute("aria-expanded", "false"); abrir.textContent = "Revisar cliente"; }
    });
  });
}

async function guardar(card) {
  const servicioId = card.dataset.servicio;
  const f = filas().find((x) => x.servicio.id === servicioId) || datosDe(estado.servicios.find((s) => s.id === servicioId), {});
  const msg = card.querySelector(".rev__msg");
  const boton = card.querySelector("[data-accion='guardar']");

  const leer = (campo) => {
    const el = card.querySelector("[data-campo='" + campo + "']");
    return el ? el.value : "";
  };
  const correcciones = {};
  const precio = leer("precioMensual");
  const ciclo = leer("cicloCorte");
  const fecha = leer("fechaVencimiento");
  if (precio && Number(precio) !== f.precio) correcciones.precioMensual = Number(precio);
  if (ciclo && String(ciclo) !== String(f.ciclo)) correcciones.cicloCorte = String(ciclo);
  if (fecha && fecha !== f.fecha) correcciones.fechaVencimiento = fecha;
  /* El motivo viaja siempre que se escriba: el servidor lo exige si el cliente ya
     tiene pagos y el cambio toca la fecha, y lo guarda en el historial. */
  const motivo = String(leer("motivo") || "").trim();

  boton.disabled = true;
  boton.textContent = "Guardando…";
  msg.hidden = true;
  try {
    const r = await call("confirmarRevisionComercial")({ servicioId, correcciones, motivo: motivo || null });
    msg.hidden = false;
    msg.className = "rev__msg is-ok";
    msg.textContent = (r.data && r.data.mensaje) || "Guardado.";
    /* El repintado de la lista borraría el aviso: se recuerda para que esa tarjeta
       vuelva a aparecer abierta, con el mensaje a la vista. */
    ultimoGuardado = { servicioId, mensaje: msg.textContent };
    // Refresca solo el servicio tocado, sin recargar la pantalla entera.
    const snap = await getDoc(doc(db, "servicios", servicioId));
    if (snap.exists()) {
      const i = estado.servicios.findIndex((s) => s.id === servicioId);
      if (i >= 0) estado.servicios[i] = { id: servicioId, ...snap.data() };
    }
    render();
  } catch (e) {
    msg.hidden = false;
    msg.className = "rev__msg is-error";
    const detalle = (e && e.message) ? String(e.message).replace(/^FirebaseError:\s*/, "") : "No se pudo guardar.";
    if (/not-found|unavailable|internal/i.test(String(e && e.code) + " " + detalle)) {
      estado.aviso = "Para guardar hace falta la función «confirmarRevisionComercial», que todavía no está publicada (pendiente de autorización). Mientras tanto esta pantalla es de consulta: los datos que ves son los reales.";
      render();
    } else {
      msg.textContent = detalle;
      boton.disabled = false;
      boton.textContent = "Guardar y confirmar";
    }
  }
}

(async () => {
  const sesion = await requireAuth("revision");
  if (!sesion) return;
  const contenido = document.getElementById("app-content");
  contenido.innerHTML = `
    <div class="panel" style="margin-bottom:16px">
      <h2>Revisión de clientes</h2>
      <p class="muted">Aquí se confirman los datos comerciales de los servicios que se importaron sin evidencia: el valor mensual, el día de corte y la fecha de cobro. Confirmar un dato <strong>no</strong> activa el cobro; solo deja el registro correcto.</p>
    </div>
    <div id="aviso"></div>
    <div class="toolbar" style="margin-bottom:16px">
      <div class="toolbar__left">
        <input class="search" id="q" type="search" placeholder="Buscar por nombre, documento o teléfono…" aria-label="Buscar cliente" />
        <button class="chip is-active" data-filtro="pendientes" type="button">Por revisar</button>
        <button class="chip" data-filtro="confirmados" type="button">Confirmados</button>
      </div>
      <span class="muted rev__contador" id="contador">Cargando…</span>
    </div>
    <div class="cards" id="lista"><div class="panel empty">Cargando clientes…</div></div>`;

  document.getElementById("q").addEventListener("input", (e) => {
    estado.busqueda = e.target.value;
    render();
  });
  document.querySelectorAll("[data-filtro]").forEach((b) => {
    b.addEventListener("click", () => { estado.filtro = b.dataset.filtro; render(); });
  });
  await cargar();
})();
