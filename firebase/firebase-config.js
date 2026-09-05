/* ============================================================
 * UNEFIBRAS SAS — Configuración pública de Firebase Web
 * ------------------------------------------------------------
 * Este archivo contiene SOLO la configuración pública del SDK
 * Web de Firebase (segura de exponer en el frontend).
 *
 * NUNCA coloques aquí: service account, claves privadas,
 * credenciales del Admin SDK ni secretos.
 *
 * PASOS PARA ACTIVAR:
 * 1. Crea un proyecto en https://console.firebase.google.com
 * 2. Añade una "App Web" (Project settings → Your apps → Web).
 * 3. Copia aquí los valores que te entrega la consola.
 * 4. En assets/js/config.js pon  habilitado: true  y pega el
 *    mismo objeto en la propiedad `firebase.config`.
 * ============================================================ */

const firebaseConfig = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID"
  // measurementId es opcional (Analytics)
};

// Se expone globalmente para los módulos del frontend
window.firebaseConfig = firebaseConfig;
