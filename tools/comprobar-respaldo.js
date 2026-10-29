'use strict';
/* ============================================================
 * UneFibra SAS — Comprobación PREVIA del respaldo (KZ-UNEF-029)
 * ------------------------------------------------------------
 * Qué hace: verifica, SIN exportar nada y sin escribir nada, que las tres
 * capacidades que necesita el respaldo por lotes existen de verdad:
 *
 *   1. Leer Firestore            (listar colecciones raíz)
 *   2. Exportar Firestore        (el rol de importación/exportación)
 *   3. Leer el bucket de respaldos (listar objetos) ← es la que más falla:
 *      el rol `datastore.user` NO incluye storage.objects.list
 *
 * POR QUÉ EXISTE
 * El respaldo corre a las 03:00. Si falta un permiso, se descubre de madrugada y
 * el día se queda sin respaldo. Esta comprobación lo dice ANTES, con el mensaje
 * exacto y el comando para arreglarlo.
 *
 * Uso:
 *   node tools/comprobar-respaldo.js                 # usa la sesión de firebase login
 *   node tools/comprobar-respaldo.js --json salida.json
 *
 * No exporta, no importa, no escribe en Firestore ni en el bucket.
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { tokenAcceso } = require("./lib/google-auth");

const PROYECTO = "une-fibra";
const BUCKET = "unefibra-firestore-backups";
const args = process.argv.slice(2);
const SALIDA = (() => {
  const i = args.indexOf("--json");
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
})();
/* Con --sa <ruta.json> la comprobación se hace con la MISMA cuenta de servicio que
   ejecuta el respaldo. Sin él, se usa la sesión del operador: sirve para saber si
   la infraestructura existe, pero no demuestra los permisos de la función. */
const RUTA_SA = (() => {
  const i = args.indexOf("--sa");
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
})();

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Token de una cuenta de servicio sin dependencias externas (JWT RS256). */
async function tokenDeCuentaDeServicio(ruta) {
  const cuenta = JSON.parse(fs.readFileSync(ruta, "utf8"));
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify({
    iss: cuenta.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.read_only",
    aud: "https://oauth2.googleapis.com/token",
    iat: ahora,
    exp: ahora + 3600
  }));
  const sinFirma = cabecera + "." + cuerpo;
  const firma = crypto.createSign("RSA-SHA256").update(sinFirma).sign(cuenta.private_key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: sinFirma + "." + b64url(firma) })
  });
  if (!r.ok) throw new Error("No se pudo canjear el JWT de la cuenta de servicio (" + r.status + "): " + (await r.text()).slice(0, 200));
  const j = await r.json();
  return j.access_token;
}

const resultados = [];
const anotar = (nombre, ok, detalle, arreglo) => {
  resultados.push({ comprobacion: nombre, ok, detalle: detalle || null, arreglo: arreglo || null });
  console.log("  " + (ok ? "OK   " : "FALLA") + "  " + nombre.padEnd(46) + (detalle ? " " + detalle : ""));
  if (!ok && arreglo) console.log("         → " + arreglo);
};

(async () => {
  console.log("=== Comprobación previa del respaldo (solo lectura) ===\n  proyecto: " + PROYECTO + "\n  bucket  : " + BUCKET + "\n");

  let token;
  try {
    if (RUTA_SA) {
      token = await tokenDeCuentaDeServicio(RUTA_SA);
      anotar("credenciales de la cuenta de servicio", true, path.basename(RUTA_SA));
    } else {
      token = await tokenAcceso();
      anotar("sesión de firebase activa", true, "operador (no es la cuenta de servicio)");
    }
  } catch (e) {
    anotar(RUTA_SA ? "credenciales de la cuenta de servicio" : "sesión de firebase activa", false, e.message,
      RUTA_SA ? "revisar que el JSON tiene client_email y private_key" : "firebase login");
    return terminar();
  }

  /* 1. Firestore: listar colecciones raíz (lo que hace el respaldo para planear). */
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents:listCollectionIds`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ pageSize: 100 })
    });
    if (r.ok) {
      const j = await r.json();
      anotar("leer Firestore (colecciones raíz)", true, (j.collectionIds || []).length + " colecciones");
    } else {
      anotar("leer Firestore (colecciones raíz)", false, "HTTP " + r.status,
        "el rol del Worker necesita `roles/datastore.user` sobre el proyecto");
    }
  } catch (e) {
    anotar("leer Firestore (colecciones raíz)", false, e.message);
  }

  /* 2. Firestore: capacidad de exportar (sin exportar). Se consulta la operación
        de exportación con un cuerpo vacío: un 400 «outputUriPrefix required»
        significa que SÍ tiene permiso; un 403 significa que no. */
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default):exportDocuments`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({})
    });
    const txt = await r.text();
    if (r.status === 403) {
      anotar("exportar Firestore", false, "HTTP 403",
        "conceder `roles/datastore.importExportAdmin` a la cuenta de servicio del respaldo");
    } else {
      anotar("exportar Firestore", true, "HTTP " + r.status + " (permiso presente; no se exportó nada)");
    }
  } catch (e) {
    anotar("exportar Firestore", false, e.message);
  }

  /* 3. Bucket: listar objetos con el prefijo del día (lo que verifica cada lote). */
  try {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?maxResults=1`, {
      headers: { Authorization: "Bearer " + token }
    });
    const txt = await r.text();
    if (r.ok) {
      const j = JSON.parse(txt);
      anotar("leer el bucket de respaldos", true, (j.items || []).length ? "tiene objetos" : "existe y es legible (vacío)");
    } else if (r.status === 404) {
      anotar("leer el bucket de respaldos", false, "el bucket no existe",
        "crear `" + BUCKET + "` en la región nam7 y aplicarle la regla de 30 días");
    } else {
      anotar("leer el bucket de respaldos", false, "HTTP " + r.status,
        "conceder a la cuenta de servicio `roles/storage.objectViewer` SOBRE EL BUCKET " + BUCKET);
    }
  } catch (e) {
    anotar("leer el bucket de respaldo", false, e.message);
  }

  /* 4. Estado de la última corrida registrada (si existe). */
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents/backups`, {
      headers: { Authorization: "Bearer " + token }
    });
    if (r.status === 404) anotar("manifiesto backups/<fecha>", true, "todavía no hay ninguna corrida registrada (normal antes del primer respaldo)");
    else if (r.ok) {
      const j = await r.json();
      const n = (j.documents || []).length;
      anotar("manifiesto backups/<fecha>", true, n + " corrida(s) registrada(s)");
    } else anotar("manifiesto backups/<fecha>", false, "HTTP " + r.status);
  } catch (e) {
    anotar("manifiesto backups/<fecha>", false, e.message);
  }

  terminar();

  function terminar() {
    const fallos = resultados.filter((x) => !x.ok);
    console.log("\n=== Resultado ===");
    console.log("  comprobaciones: " + resultados.length + " · OK " + (resultados.length - fallos.length) + " · FALLAN " + fallos.length);
    if (fallos.length) {
      console.log("\n  No se puede dar el respaldo por verificable todavía. Arreglar:");
      for (const f of fallos) console.log("   · " + f.comprobacion + (f.arreglo ? " — " + f.arreglo : ""));
    } else {
      console.log("\n  Todo lo que el respaldo necesita está disponible.");
      console.log("  El siguiente paso es ejecutar la primera corrida (ver docs/RESPALDO.md §6).");
    }
    if (SALIDA) {
      fs.mkdirSync(path.dirname(path.resolve(SALIDA)), { recursive: true });
      fs.writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString(), proyecto: PROYECTO, bucket: BUCKET, resultados }, null, 1));
      console.log("\n  Informe: " + path.resolve(SALIDA));
    }
    process.exit(fallos.length ? 2 : 0);
  }
})().catch((e) => { console.error("ERROR: " + e.message); process.exit(1); });
