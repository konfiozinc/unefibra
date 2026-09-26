#!/usr/bin/env node
/* ============================================================
 * UneFibra SAS — Alta del administrador corporativo
 * ------------------------------------------------------------
 * Crea (o reutiliza) la cuenta de Firebase Authentication del correo
 * corporativo y le asigna rol SUPERADMIN en Firestore, igual que el
 * administrador que ya existe.
 *
 * CÓMO SE EJECUTA
 *   node tools/crear-admin-unefibra.js
 *   node tools/crear-admin-unefibra.js --password="MiClaveSegura1!"
 *   node tools/crear-admin-unefibra.js --email=otro@correo.com
 *
 * QUÉ HACE
 *   1. Si el correo ya existe en Authentication, REUTILIZA su UID (no crea
 *      una cuenta duplicada) y solo le asigna el rol.
 *   2. Si no existe, crea la cuenta con contraseña temporal y correo marcado
 *      como verificado.
 *   3. Escribe usuarios/{uid} con rol SUPERADMIN y activo: true.
 *   4. Guarda la contraseña SOLO en CREDENCIALES_ADMIN.md, que está en
 *      .gitignore, y comprueba que git efectivamente lo ignora.
 *
 * La contraseña nunca se escribe en el repositorio ni en el historial.
 * Usa la sesión local de firebase-tools (ver tools/lib/google-auth.js).
 * ============================================================ */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { tokenAcceso, cuentaSesion } = require("./lib/google-auth");

const PROYECTO = "une-fibra";
const RAIZ = path.resolve(__dirname, "..");
const ARCHIVO_CLAVES = path.join(RAIZ, "CREDENCIALES_ADMIN.md");
const URL_PANEL = "https://konfiozinc.github.io/unefibra/admin/";

function opcion(nombre) {
  const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return arg ? arg.slice(nombre.length + 3) : null;
}

const EMAIL = opcion("email") || "unefibrasas@gmail.com";
const NOMBRE = opcion("nombre") || "Administrador Corporativo";

/** Contraseña temporal fuerte: grupos garantizados y mezcla criptográfica. */
function generarPassword() {
  const grupos = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const todos = grupos.join("");
  const elegir = (s) => s[crypto.randomInt(s.length)];
  const chars = grupos.map(elegir);
  while (chars.length < 16) chars.push(elegir(todos));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function buscarUid(token, email) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROYECTO}/accounts:lookup`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ email: [email] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("No se pudo consultar la cuenta: " + JSON.stringify(data).slice(0, 200));
  const usuario = (data.users || [])[0];
  return usuario ? usuario.localId : null;
}

async function crearOReutilizarCuenta(token, email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROYECTO}/accounts`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, emailVerified: true, displayName: NOMBRE })
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const mensaje = (data.error && data.error.message) || JSON.stringify(data);
    if (/EMAIL_EXISTS/i.test(mensaje)) {
      const uid = await buscarUid(token, email);
      if (!uid) throw new Error("El correo ya existe pero no se pudo obtener su UID.");
      return { uid, creada: false };
    }
    throw new Error("No se pudo crear la cuenta: " + mensaje);
  }
  return { uid: data.localId, creada: true };
}

async function escribirUsuario(token, uid, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROYECTO}` +
    `/databases/(default)/documents/usuarios/${uid}`;
  // Misma forma que el administrador que ya existe, más `creadoPor` para
  // saber de dónde salió la cuenta.
  const cuerpo = {
    fields: {
      nombre: { stringValue: NOMBRE },
      email: { stringValue: email },
      rol: { stringValue: "SUPERADMIN" },
      activo: { booleanValue: true },
      creadoPor: { stringValue: "tools/crear-admin-unefibra.js" },
      createdAt: { timestampValue: new Date().toISOString() }
    }
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });
  if (!res.ok) {
    throw new Error(`No se pudo escribir usuarios/${uid}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

/** Comprueba con git que el archivo de credenciales está realmente ignorado. */
function estaIgnorado(ruta) {
  try {
    execFileSync("git", ["check-ignore", "-q", ruta], { cwd: RAIZ, stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

(async function main() {
  console.log("Alta del administrador — proyecto " + PROYECTO);
  console.log("Correo: " + EMAIL + "\n");

  const token = await tokenAcceso();
  console.log("  Sesión de firebase-tools: " + (cuentaSesion() || "(desconocida)"));

  const password = opcion("password") || generarPassword();
  const { uid, creada } = await crearOReutilizarCuenta(token, EMAIL, password);
  console.log("  Authentication: " + (creada ? "cuenta CREADA" : "la cuenta ya existía, se reutiliza el UID"));
  console.log("  UID: " + uid);

  await escribirUsuario(token, uid, EMAIL);
  console.log("  Firestore usuarios/" + uid + ": rol SUPERADMIN, activo = true");

  const fecha = new Date().toISOString();
  const contenido = `# Credenciales del administrador — UneFibra SAS

> Archivo PRIVADO. Está en .gitignore y no debe subirse al repositorio ni
> compartirse por canales públicos. Si se filtra, cambia la contraseña de inmediato.

## Acceso al panel

- **URL:** ${URL_PANEL}
- **Correo:** ${EMAIL}
- **Contraseña temporal:** \`${password}\`
- **Rol:** SUPERADMIN
- **UID de Firebase:** ${uid}
- **Creado:** ${fecha}

## Primer ingreso (para el cliente)

1. Abrir ${URL_PANEL}
2. Iniciar sesión con el correo y la contraseña temporal de arriba.
3. **Cambiar la contraseña de inmediato**: en el panel, sección **Usuarios**, o
   desde "¿Olvidaste tu contraseña?" en la pantalla de acceso.
4. Verificar que entra al panel completo: Dashboard, Clientes, Lista Corte 15,
   Lista Corte 30, Servicios, Pagos, Planes, Notificaciones.

## Si la contraseña temporal no funciona

Puede que alguien la haya cambiado ya. Se restablece desde la pantalla de acceso
con "¿Olvidaste tu contraseña?" (llega un correo a ${EMAIL}), o volviendo a
ejecutar:

    node tools/crear-admin-unefibra.js --password="NuevaClave1!"

## Notas

- El documento \`usuarios/${uid}\` en Firestore es el que da los permisos; si se
  borra, la cuenta deja de poder entrar aunque la contraseña sea correcta.
- El correo ${EMAIL} es también el correo de contacto público de la empresa.
`;
  fs.writeFileSync(ARCHIVO_CLAVES, contenido, "utf8");

  const ignorado = estaIgnorado("CREDENCIALES_ADMIN.md");
  console.log("  Credenciales escritas en: CREDENCIALES_ADMIN.md");
  console.log("  ¿git lo ignora?: " + (ignorado ? "SÍ (correcto)" : "NO — ¡revisar .gitignore antes de commitear!"));

  console.log("\n--- Credenciales de acceso ---");
  console.log("  URL:        " + URL_PANEL);
  console.log("  Correo:     " + EMAIL);
  console.log("  Contraseña: " + password + (opcion("password") ? "  (la que indicaste)" : "  (temporal, cámbiala al entrar)"));
  console.log("  Rol:        SUPERADMIN");

  if (!ignorado) {
    console.error("\nATENCIÓN: CREDENCIALES_ADMIN.md NO está ignorado por git. " +
      "Añádelo a .gitignore antes de hacer commit.");
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error("\nNo se pudo completar el alta: " + err.message);
  process.exitCode = 1;
});
