/* ============================================================
 * UneFibra SAS — Token de acceso para herramientas locales
 * ------------------------------------------------------------
 * Reutiliza la sesión de `firebase login` que ya está en esta máquina
 * para hablar con las APIs de Google (Firestore, Identity Toolkit) sin
 * descargar ninguna clave de servicio y sin guardar secretos nuevos.
 *
 * ES SOLO PARA HERRAMIENTAS DE DESARROLLO en un equipo con sesión
 * iniciada. No se usa en el navegador, no se despliega y no se importa
 * desde el panel ni desde las Cloud Functions.
 *
 * Requisito: tener sesión activa (`firebase login`).
 * ============================================================ */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Cliente público de la CLI de Firebase. Sirve para refrescar el token de una
// sesión ya iniciada; no es una credencial de la empresa ni da acceso por sí solo.
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

function rutaSesion() {
  return path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
}

/** Devuelve un token de acceso válido o lanza un error explicando qué falta. */
async function tokenAcceso() {
  const ruta = rutaSesion();
  if (!fs.existsSync(ruta)) {
    throw new Error("No hay sesión de firebase-tools. Ejecuta: firebase login");
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch (err) {
    throw new Error("No se pudo leer la sesión de firebase-tools: " + err.message);
  }

  const refresh = cfg.tokens && cfg.tokens.refresh_token;
  if (!refresh) {
    throw new Error("La sesión no tiene refresh_token. Ejecuta: firebase login --reauth");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token"
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("No se pudo obtener el token de acceso: " + JSON.stringify(data).slice(0, 300));
  }
  return data.access_token;
}

/** Cuenta con la que está iniciada la sesión (para dejar rastro en la auditoría). */
function cuentaSesion() {
  try {
    return JSON.parse(fs.readFileSync(rutaSesion(), "utf8")).user || null;
  } catch (err) {
    return null;
  }
}

module.exports = { tokenAcceso, cuentaSesion };
