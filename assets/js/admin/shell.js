/* ============================================================
 * UneFibra SAS — Admin: shell (sidebar + guard de autenticación)
 * ------------------------------------------------------------
 * - requireAuth(activeKey): verifica sesión + rol y dibuja el
 *   shell (sidebar, topbar, logout). Redirige a index.html si no
 *   hay sesión o el usuario no está activo.
 * - El rol se lee de Firestore `usuarios/{uid}` (no del frontend).
 * ============================================================ */

import { auth, db, isConfigured, MENSAJE_NO_CONFIGURADO } from "./core.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { esc } from "./ui.js";

/* ============================================================
 * Menú del panel — KZ-UNEF-028
 * ------------------------------------------------------------
 * El propietario no programa: el menú principal tiene SEIS entradas con
 * nombres comerciales (Inicio, Clientes, Vencimientos, Pagos, Recordatorios,
 * Planes). Lo técnico (conciliaciones, listas por ciclo, blog, usuarios,
 * auditoría) queda en «Más opciones», disponible pero fuera del camino diario.
 *
 * `min` NO es decorativo: requireAuth lo aplica también al abrir una página
 * por su URL, no solo al pintar el menú. `grupo` decide en qué bloque aparece.
 * ============================================================ */

const NAV = [
  { key: "dashboard", label: "Inicio", href: "dashboard.html", min: "OPERADOR", grupo: "principal", icono: "🏠" },
  { key: "clientes", label: "Clientes", href: "clientes.html", min: "OPERADOR", grupo: "principal", icono: "👤" },
  { key: "vencimientos", label: "Vencimientos", href: "vencimientos.html", min: "OPERADOR", grupo: "principal", icono: "📅" },
  { key: "pagos", label: "Pagos", href: "pagos.html", min: "OPERADOR", grupo: "principal", icono: "💵" },
  { key: "notificaciones", label: "Recordatorios", href: "notificaciones.html", min: "ADMIN", grupo: "principal", icono: "🔔" },
  { key: "planes", label: "Planes", href: "planes.html", min: "ADMIN", grupo: "principal", icono: "📶" },

  { key: "solicitudes", label: "Solicitudes de clientes", href: "solicitudes.html", min: "OPERADOR", grupo: "mas" },
  { key: "corte15", label: "Lista de cobro · corte 15", href: "lista-corte-15.html", min: "OPERADOR", grupo: "mas" },
  { key: "corte30", label: "Lista de cobro · corte 30", href: "lista-corte-30.html", min: "OPERADOR", grupo: "mas" },
  { key: "servicios", label: "Servicios e instalaciones", href: "servicios.html", min: "OPERADOR", grupo: "mas" },
  { key: "conciliacion", label: "Revisión de servicios importados", href: "conciliacion.html", min: "ADMIN", grupo: "mas" },
  { key: "pagos-historicos", label: "Revisión de pagos del Excel", href: "pagos-historicos.html", min: "ADMIN", grupo: "mas" },
  { key: "blog", label: "Blog del sitio", href: "blog.html", min: "ADMIN", grupo: "mas" },
  { key: "configuracion", label: "Configuración", href: "configuracion.html", min: "SUPERADMIN", grupo: "mas" },
  { key: "usuarios", label: "Usuarios y permisos", href: "usuarios.html", min: "SUPERADMIN", grupo: "mas" },
  { key: "auditoria", label: "Historial de cambios", href: "auditoria.html", min: "SUPERADMIN", grupo: "mas" }
];

const NIVEL = { OPERADOR: 1, ADMIN: 2, SUPERADMIN: 3 };

export function canAccess(rol, min) {
  return (NIVEL[rol] || 0) >= (NIVEL[min] || 0);
}

function enlaces(rol, activeKey, grupo) {
  return NAV
    .filter((n) => n.grupo === grupo && canAccess(rol, n.min))
    .map((n) => `<a href="${n.href}" class="side__link ${n.key === activeKey ? "is-active" : ""}" ${n.key === activeKey ? 'aria-current="page"' : ""}>${n.icono ? `<span class="side__icon" aria-hidden="true">${n.icono}</span>` : ""}${n.label}</a>`)
    .join("");
}

function renderShell(activeKey, rol, nombre) {
  const shell = document.getElementById("app-shell");
  if (!shell) return;

  const activo = NAV.find((n) => n.key === activeKey);
  const titulo = activo ? activo.label : "UneFibra";
  const hayMas = enlaces(rol, activeKey, "mas").length > 0;

  shell.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <a class="side__brand" href="dashboard.html">UneFibra<span>Panel</span></a>
      <nav class="side__nav" aria-label="Principal">
        ${enlaces(rol, activeKey, "principal")}
        ${hayMas ? `<details class="side__mas">
          <summary>Más opciones</summary>
          <nav aria-label="Más opciones">${enlaces(rol, activeKey, "mas")}</nav>
        </details>` : ""}
      </nav>
      <div class="side__foot">
        <span class="side__rol">${esc(rol)}</span>
        <button class="btn btn--ghost btn--block" id="btn-logout">Cerrar sesión</button>
      </div>
    </aside>
    <div class="scrim" id="scrim" hidden></div>
    <div class="layout">
      <header class="topbar">
        <button class="menu-toggle" id="menu-toggle" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="sidebar">
          <span></span><span></span><span></span>
        </button>
        <span class="topbar__title">${esc(titulo)}</span>
        <span class="topbar__user">${esc(nombre)}</span>
      </header>
      <main class="content" id="app-content"></main>
    </div>`;

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await signOut(auth);
    location.replace("index.html");
  });

  /* Si la página activa está en «Más opciones», el desplegable se abre solo,
     para que el usuario vea dónde está. */
  const mas = shell.querySelector(".side__mas");
  if (mas && NAV.find((n) => n.key === activeKey && n.grupo === "mas")) mas.open = true;

  initMobileNav();
}

/**
 * Navegación móvil: el menú hamburguesa abre/cierra la sidebar como un
 * panel deslizante (drawer) con fondo oscurecido. En escritorio no hace nada
 * porque el botón está oculto por CSS.
 */
function initMobileNav() {
  const toggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  if (!toggle || !sidebar || !scrim) return;

  const cerrar = () => {
    sidebar.classList.remove("is-open");
    scrim.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Abrir menú");
    document.body.classList.remove("nav-locked");
  };
  const abrir = () => {
    sidebar.classList.add("is-open");
    scrim.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Cerrar menú");
    document.body.classList.add("nav-locked");
  };

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("is-open")) cerrar();
    else abrir();
  });
  scrim.addEventListener("click", cerrar);
  sidebar.querySelectorAll(".side__link").forEach((a) => a.addEventListener("click", cerrar));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });
}

/**
 * Guard de autenticación. Devuelve { uid, rol, nombre, email } o null
 * (y redirige al login). Si Firebase no está configurado, muestra un
 * aviso claro y devuelve null.
 */
export function requireAuth(activeKey) {
  if (!isConfigured()) {
    const shell = document.getElementById("app-shell");
    if (shell) shell.innerHTML = `<div class="content">${MENSAJE_NO_CONFIGURADO}</div>`;
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        location.replace("index.html");
        resolve(null);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "usuarios", user.uid));
        const data = snap.exists() ? snap.data() : null;
        if (!data || data.activo !== true) {
          await signOut(auth);
          location.replace("index.html");
          resolve(null);
          return;
        }
        /* KZ-UNEF-001 · El rol tiene que ser UNO de los tres del sistema.
           Antes bastaba con que el usuario estuviera activo: un rol corrupto
           ("ADMININ", vacío, null) entraba al panel y la interfaz lo trataba
           como privilegiado, mientras las reglas y las callables lo trataban
           como nadie. Mejor cerrar la sesión y pedir que lo corrijan. */
        const ROLES_VALIDOS = ["SUPERADMIN", "ADMIN", "OPERADOR"];
        if (!ROLES_VALIDOS.includes(data.rol)) {
          console.error("Rol no reconocido en usuarios/" + user.uid + ": " + String(data.rol));
          const shell = document.getElementById("app-shell");
          if (shell) {
            shell.innerHTML = '<div class="content"><p>Tu usuario tiene un rol no reconocido (' +
              String(data.rol).replace(/[<>&"]/g, "") +
              '). Pide a un SUPERADMIN que lo corrija antes de continuar.</p></div>';
          }
          await signOut(auth);
          resolve(null);
          return;
        }
        /* KZ-UNEF-028 · El rol mínimo de la página se aplica TAMBIÉN al abrirla
           por su URL. Antes `min` solo filtraba el menú: un ADMIN podía escribir
           configuracion.html (datos bancarios) o un OPERADOR conciliacion.html
           (cartera completa) y la pantalla se pintaba igual. Las Security Rules
           protegían la escritura, no la lectura. Ahora se niega la pantalla y se
           devuelve null, igual que cuando no hay sesión, para que la página no
           intente pintar su contenido. */
        const entrada = NAV.find((n) => n.key === activeKey);
        if (entrada && !canAccess(data.rol, entrada.min)) {
          const shell0 = document.getElementById("app-shell");
          if (shell0) {
            shell0.innerHTML = `<div class="content"><div class="panel">
              <h2>No tienes acceso a esta pantalla</h2>
              <p class="muted">Tu usuario es <strong>${esc(data.rol)}</strong> y esta sección requiere
              <strong>${esc(entrada.min)}</strong>. Pide a un administrador que revise tus permisos.</p>
              <p><a class="btn btn--ghost" href="dashboard.html">Volver al inicio</a></p>
            </div></div>`;
          }
          resolve(null);
          return;
        }
        renderShell(activeKey, data.rol, data.nombre || user.email);
        resolve({ uid: user.uid, rol: data.rol, nombre: data.nombre, email: user.email });
      } catch (err) {
        console.error("Error al verificar el rol:", err);
        resolve(null);
      }
    });
  });
}
