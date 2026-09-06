/* ============================================================
 * UNEFIBRAS SAS — Configuración pública de Firebase Web
 * ------------------------------------------------------------
 * Este archivo contiene SOLO la configuración pública del SDK
 * Web de Firebase (segura de exponer en el frontend).
 *
 * NUNCA coloques aquí: service account, claves privadas,
 * credenciales del Admin SDK ni secretos.
 * ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAwQu8B6OafKszXSuL373Di4wyvotc9VWY",
  authDomain: "une-fibra.firebaseapp.com",
  projectId: "une-fibra",
  storageBucket: "une-fibra.firebasestorage.app",
  messagingSenderId: "215843872771",
  appId: "1:215843872771:web:4620cbc4a46b9b53a0ae36"
};

// Se expone globalmente para los módulos del frontend
window.firebaseConfig = firebaseConfig;
