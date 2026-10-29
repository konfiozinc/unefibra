'use strict';
/* ============================================================
 * UneFibra SAS — Servidor LOCAL para que el propietario revise el panel
 * desde su teléfono (KZ-UNEF-028)
 * ------------------------------------------------------------
 * QUÉ PROBLEMA RESUELVE
 * El dueño no puede ver el panel en su celular sin publicarlo, y publicarlo no
 * está autorizado. Este servidor lo sirve SOLO dentro de la red local, con datos
 * ficticios del emulador, y con tres protecciones deliberadas:
 *
 *   1. SOLO sirve `/admin/` y `/assets/`. Todo lo demás responde 403: el
 *      repositorio tiene `import/clientes-parseados.json`, `Clientes.xlsx`,
 *      `functions/` y `tools/`, que no deben quedar accesibles por la red.
 *   2. FUERZA el modo emulador: cualquier página del panel se redirige a
 *      `?emulador=1`, así es imposible acabar viendo (o escribiendo en) los datos
 *      reales de producción por descuido. `--produccion` lo desactiva, y avisa.
 *   3. NO arranca si el emulador no está escuchando: si los datos ficticios no
 *      están, el panel mostraría errores y el dueño pensaría que está roto.
 *
 * Uso:
 *   node tools/servir-panel-local.js            # red local (para el teléfono)
 *   node tools/servir-panel-local.js --solo-local   # solo este computador
 *   node tools/servir-panel-local.js --puerto 8099
 * ============================================================ */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf("--" + nombre);
  if (i === -1) return porDefecto;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const PUERTO = Number(opcion("puerto", 8099)) || 8099;
const SOLO_LOCAL = args.includes("--solo-local");
const PERMITIR_PRODUCCION = args.includes("--produccion");
const HOST = SOLO_LOCAL ? "127.0.0.1" : "0.0.0.0";
const RAIZ = path.resolve(__dirname, "..");

/* Solo estas dos carpetas. El resto del repositorio NO se sirve. */
const PERMITIDAS = ["/admin/", "/assets/"];
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json"
};

function ipsLocales() {
  const salida = [];
  for (const [nombre, lista] of Object.entries(os.networkInterfaces())) {
    for (const d of lista || []) {
      if (d.family === "IPv4" && !d.internal) salida.push({ nombre, ip: d.address });
    }
  }
  return salida;
}

/** Fuerza `emulador=1` en las páginas del panel (salvo --produccion). */
function forzarEmulador(url) {
  if (PERMITIR_PRODUCCION) return null;
  if (!url.pathname.startsWith("/admin/")) return null;
  if (!/\.html$/.test(url.pathname) && url.pathname !== "/admin/") return null;
  if (url.searchParams.get("emulador") === "1") return null;
  url.searchParams.set("emulador", "1");
  return url.pathname + "?" + url.searchParams.toString();
}

const servidor = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://local"); } catch (e) { res.writeHead(400); return res.end("petición inválida"); }

  /* 2) Modo emulador obligatorio. */
  const redirigido = forzarEmulador(url);
  if (redirigido) {
    res.writeHead(302, { Location: redirigido, "Cache-Control": "no-store" });
    return res.end();
  }

  let ruta = decodeURIComponent(url.pathname);
  if (ruta === "/" || ruta === "") ruta = "/admin/index.html";
  if (ruta.endsWith("/")) ruta += "index.html";

  /* 1) Lista blanca de carpetas. */
  if (!PERMITIDAS.some((p) => ruta.startsWith(p))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Solo se sirve el panel (/admin/) y sus recursos (/assets/).\n" +
      "El resto del repositorio no se expone en la red local.");
  }

  const absoluta = path.join(RAIZ, ruta);
  if (!absoluta.startsWith(RAIZ)) { res.writeHead(403); return res.end("ruta no permitida"); }

  fs.readFile(absoluta, (error, datos) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("no encontrado");
    }
    res.writeHead(200, {
      "Content-Type": TIPOS[path.extname(absoluta).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      /* El iframe/hostiles no aplican aquí, pero se cierra igual. */
      "X-Frame-Options": "DENY"
    });
    res.end(datos);
  });
});

/** Comprueba que el emulador de Firestore esté escuchando (puerto 8080). */
async function emuladorArriba() {
  try {
    const r = await fetch("http://127.0.0.1:8080/", { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch (e) {
    return false;
  }
}

(async () => {
  const arriba = await emuladorArriba();
  if (!arriba) {
    console.error("\nNo arranco: el emulador de Firestore no responde en http://127.0.0.1:8080.");
    console.error("Sin el emulador no hay datos ficticios, y el panel mostraría errores.");
    console.error("Arráncalo primero:");
    console.error("  $env:JAVA_HOME=\"C:\\KZ-HERRAMIENTAS\\jre21\"; $env:PATH=\"$env:JAVA_HOME\\bin;$env:PATH\"");
    console.error("  firebase emulators:start --config firebase.test.json --project demo-unefibra --only auth,firestore,functions");
    process.exit(1);
  }

  servidor.listen(PUERTO, HOST, () => {
    const ips = ipsLocales();
    console.log("\n============================================================");
    console.log(" PANEL DE UNEFIBRA — revisión local" + (PERMITIR_PRODUCCION ? " (¡MODO PRODUCCIÓN!)" : " con datos de prueba"));
    console.log("============================================================");
    console.log(" En este computador:");
    console.log("   http://127.0.0.1:" + PUERTO + "/admin/");
    if (!SOLO_LOCAL && ips.length) {
      console.log("\n Desde el teléfono (misma red WiFi):");
      for (const { nombre, ip } of ips) console.log("   http://" + ip + ":" + PUERTO + "/admin/   (" + nombre + ")");
    } else if (SOLO_LOCAL) {
      console.log("\n (--solo-local: no se abre a la red, el teléfono no podrá entrar)");
    }
    console.log("\n Qué se sirve: SOLO /admin/ y /assets/. El resto del repositorio");
    console.log(" (funciones, herramientas, datos de clientes) responde 403.");
    if (!PERMITIR_PRODUCCION) {
      console.log("\n El modo de pruebas es obligatorio: cada página se abre con ?emulador=1,");
      console.log(" así que NO se puede acabar viendo los datos reales por descuido.");
    }
    console.log("\n Cuentas de prueba (datos ficticios):");
    console.log("   SUPERADMIN : super.duena@panel.test");
    console.log("   ADMIN      : admin@panel.test");
    console.log("   OPERADOR   : operador@panel.test");
    console.log("   contraseña : Ficticia#1");
    console.log("\n Para terminar: Ctrl + C en esta ventana.");
    console.log("============================================================\n");
  });
})();
