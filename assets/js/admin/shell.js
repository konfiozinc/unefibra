/* ============================================================
 * UNEFIBRAS SAS — Admin: shell (sidebar + guard de autenticación)
 * ------------------------------------------------------------
 * - requireAuth(activeKey): verifica sesión + rol y dibuja el
 *   shell (sidebar, topbar, logout). Redirige a index.html si no
 *   hay sesión o el usuario no está activo.
 * - El rol se lee de Firestore `usuarios/{uid}` (no del frontend).
 * ============================================================ */

import { auth, db, isConfigured, MENSAJE_NO_CONFIGURADO } from "./core.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const NAV = [
  { key: "dashboard", label: "Dashboard", href: "dashboard.html", min: "OPERADOR" },
  { key: "clientes", label: "Clientes", href: "clientes.html", min: "OPERADOR" },
  { key: "servicios", label: "Servicios", href: "servicios.html", min: "OPERADOR" },
  { key: "pagos", label: "Pagos", href: "pagos.html", min: "OPERADOR" },
  { key: "planes", label: "Planes", href: "planes.html", min: "ADMIN" },
  { key: "notificaciones", label: "Notificaciones", href: "notificaciones.html", min: "ADMIN" },
  { key: "configuracion", label: "Configuración", href: "configuracion.html", min: "SUPERADMIN" },
  { key: "usuarios", label: "Usuarios", href: "usuarios.html", min: "SUPERADMIN" },
  { key: "auditoria", label: "Auditoría", href: "auditoria.html", min: "SUPERADMIN" }
];

const NIVEL = { OPERADOR: 1, ADMIN: 2, SUPERADMIN: 3 };

export function canAccess(rol, min) {
  return (NIVEL[rol] || 0) >= (NIVEL[min] || 0);
}

function renderShell(activeKey, rol, nombre) {
  const shell = document.getElementById("app-shell");
  if (!shell) return;

  const enlaces = NAV
    .filter((n) => canAccess(rol, n.min))
    .map((n) => `<a href="${n.href}" class="side__link ${n.key === activeKey ? "is-active" : ""}">${n.label}</a>`)
    .join("");

  const activo = NAV.find((n) => n.key === activeKey);
  const titulo = activo ? activo.label : "UneFibra";

  shell.innerHTML = `
    <aside class="sidebar">
      <a class="side__brand" href="dashboard.html">UneFibra<span>Panel</span></a>
      <nav class="side__nav">${enlaces}</nav>
      <div class="side__foot">
        <span class="side__rol">${rol}</span>
        <button class="btn btn--ghost btn--block" id="btn-logout">Cerrar sesión</button>
      </div>
    </aside>
    <div class="layout">
      <header class="topbar">
        <span class="topbar__title">${titulo}</span>
        <span class="topbar__user">${nombre}</span>
      </header>
      <main class="content" id="app-content"></main>
    </div>`;

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await signOut(auth);
    location.replace("index.html");
  });
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
        renderShell(activeKey, data.rol, data.nombre || user.email);
        resolve({ uid: user.uid, rol: data.rol, nombre: data.nombre, email: user.email });
      } catch (err) {
        console.error("Error al verificar el rol:", err);
        resolve(null);
      }
    });
  });
}
