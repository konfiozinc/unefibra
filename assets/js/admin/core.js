/* ============================================================
 * UneFibra SAS — Admin: núcleo Firebase (módulo ES)
 * ------------------------------------------------------------
 * Inicializa Firebase App/Auth/Firestore desde la configuración
 * centralizada (assets/js/config.js). Expone `isConfigured()` y
 * las instancias `auth`/`db` para el resto del panel.
 *
 * IMPORTANTE: los módulos ES y Firebase Auth requieren servir el
 * sitio por HTTP(S) (p. ej. `npx serve`), no por file://.
 * ============================================================ */

import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

const CFG = window.UNEFIBRAS_CONFIG;

function esPlaceholder(v) {
  return !v || typeof v !== "string" || v.startsWith("[") || v.indexOf("FIREBASE_") !== -1 || v.indexOf("[TU_") !== -1;
}

// Dev: ?emulador=1 conecta Auth/Firestore a los emuladores. El flag se guarda en
// sessionStorage para que sobreviva a las redirecciones internas del panel
// (login → dashboard), que usan rutas relativas sin el parámetro.
function esModoEmulador() {
  try {
    if (new URLSearchParams(window.location.search).get("emulador") === "1") {
      sessionStorage.setItem("unefibra-emulador", "1");
    }
    return sessionStorage.getItem("unefibra-emulador") === "1";
  } catch (e) {
    return false;
  }
}

/**
 * KZ-UNEF-028 · ¿Estamos en modo emulador? Se pregunta con el mismo criterio que
 * usa el resto del núcleo: el flag viaja en sessionStorage porque las
 * redirecciones internas del panel (login → dashboard) pierden el `?emulador=1`.
 * Lo consume callables.js para conectar TAMBIÉN las Cloud Functions al emulador;
 * antes solo miraba la URL, así que tras el primer salto las llamadas dejaban de
 * ir al emulador.
 */
export function modoEmuladorActivo() {
  return esModoEmulador();
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

// En modo emulador se usa el proyecto demo (singleProjectMode) del emulador,
// NUNCA el proyecto de producción.
const usarEmulador = esModoEmulador() && CFG && CFG.emulador;
if (usarEmulador) {
  const devCfg = { apiKey: "clave-ficticia", projectId: "demo-unefibra", appId: "demo" };
  app = initializeApp(devCfg);
  auth = getAuth(app);
  db = getFirestore(app);
  connectAuthEmulator(auth, `http://${CFG.emulador.host}:${CFG.emulador.authPort}`);
  connectFirestoreEmulator(db, CFG.emulador.host, CFG.emulador.firestorePort);
} else if (isConfigured()) {
  app = initializeApp(CFG.firebase.config);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };
