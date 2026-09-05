/* ============================================================
 * UNEFIBRAS SAS — Admin: login
 * ------------------------------------------------------------
 * Autentica con Firebase Auth (email/password) y verifica que el
 * usuario exista en `usuarios/{uid}` y esté activo antes de entrar.
 * El rol lo imponen las Security Rules; aquí solo se valida acceso.
 * ============================================================ */

import { auth, db, isConfigured, MENSAJE_NO_CONFIGURADO } from "../assets/js/admin/core.js";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const form = document.getElementById("login-form");
const submit = document.getElementById("login-submit");
const msg = document.getElementById("login-msg");
const box = document.getElementById("login-box");

// Si Firebase no está configurado, se informa con claridad.
if (!isConfigured()) {
  box.innerHTML = MENSAJE_NO_CONFIGURADO;
  throw new Error("Firebase no configurado");
}

// Si ya hay sesión, ir directo al dashboard.
onAuthStateChanged(auth, (user) => {
  if (user) location.replace("dashboard.html");
});

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  msg.className = "login-msg";
  msg.textContent = "";

  const data = Object.fromEntries(new FormData(form).entries());
  const email = (data.email || "").trim();
  const password = data.password || "";

  if (!email || !password) {
    msg.textContent = "Ingresa tu correo y contraseña.";
    msg.className = "login-msg err";
    return;
  }

  submit.disabled = true;
  submit.textContent = "Verificando…";

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Verificar que el usuario administrativo existe y está activo.
    const snap = await getDoc(doc(db, "usuarios", cred.user.uid));
    if (!snap.exists() || snap.data().activo !== true) {
      await auth.signOut();
      msg.textContent = "Este usuario no tiene acceso al panel.";
      msg.className = "login-msg err";
      submit.disabled = false;
      submit.textContent = "Iniciar sesión";
      return;
    }
    location.replace("dashboard.html");
  } catch (err) {
    // Nunca exponer errores internos al usuario.
    console.error("Error de autenticación:", err);
    if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
      msg.textContent = "Correo o contraseña incorrectos.";
    } else if (err.code === "auth/invalid-email") {
      msg.textContent = "El correo no es válido.";
    } else if (err.code === "auth/too-many-requests") {
      msg.textContent = "Demasiados intentos. Espera un momento.";
    } else {
      msg.textContent = "No fue posible iniciar sesión. Intenta nuevamente.";
    }
    msg.className = "login-msg err";
    submit.disabled = false;
    submit.textContent = "Iniciar sesión";
  }
});
