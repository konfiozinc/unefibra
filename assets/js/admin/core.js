/* ============================================================
 * UNEFIBRAS SAS — Admin: núcleo Firebase (módulo ES)
 * ------------------------------------------------------------
 * Inicializa Firebase App/Auth/Firestore desde la configuración
 * centralizada (assets/js/config.js). Expone `isConfigured()` y
 * las instancias `auth`/`db` para el resto del panel.
 *
 * IMPORTANTE: los módulos ES y Firebase Auth requieren servir el
 * sitio por HTTP(S) (p. ej. `npx serve`), no por file://.
 * ============================================================ */

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const CFG = window.UNEFIBRAS_CONFIG;

function esPlaceholder(v) {
  return !v || typeof v !== "string" || v.startsWith("[") || v.indexOf("FIREBASE_") !== -1 || v.indexOf("[TU_") !== -1;
}

/** Indica si Firebase está realmente configurado (sin placeholders). */
export function isConfigured() {
  const f = CFG && CFG.firebase;
  if (!f || !f.habilitado) return false;
  const c = f.config || {};
  return !esPlaceholder(c.apiKey) && !esPlaceholder(c.projectId) && !esPlaceholder(c.appId);
}

/** Mensaje honesto cuando Firebase no está configurado. */
export const MENSAJE_NO_CONFIGURADO = `
  <div class="nocfg">
    <h1>Firebase no configurado</h1>
    <p>El panel administrativo requiere un proyecto Firebase real (sin datos simulados).</p>
    <ol>
      <li>Pega tus credenciales públicas en <code>firebase/firebase-config.js</code>.</li>
      <li>En <code>assets/js/config.js</code> pon <code>habilitado: true</code> y pega el mismo objeto en <code>firebase.config</code>.</li>
      <li>Sirve el proyecto por HTTP(S), por ejemplo <code>npx serve</code>.</li>
    </ol>
    <a class="btn btn--ghost" href="../index.html">Volver al sitio público</a>
  </div>`;

let app = null;
let auth = null;
let db = null;

if (isConfigured()) {
  app = initializeApp(CFG.firebase.config);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };
