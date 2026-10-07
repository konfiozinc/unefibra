/* ============================================================
 * UneFibra SAS — Ajustes de datos FASE 2 (sobre los clientes ya importados)
 * ------------------------------------------------------------
 * Hace 4 cosas, todas idempotentes:
 *   1. Archiva en `clientes_hoja3_4_backup` los clientes de las hojas 3-4
 *      (los de "Elkin y Darlys", otro cobrador) y los BORRA de `clientes`.
 *   2. Escribe `ip` y `origen` en los clientes que se quedan (hojas 1-2).
 *   3. Recalcula `proximoCorte` con la nueva regla: ciclo 15 -> corte el 20,
 *      ciclo 30 -> corte el 5 (antes 15 y 30).
 *   4. Asigna el plan de 150 Mbps al cliente que en el Excel decia 160 Mbps
 *      y limpia sus observaciones.
 *
 *   node import/fase2-datos.js           -> DRY-RUN (no escribe nada)
 *   node import/fase2-datos.js --real    -> escribe
 *
 * OJO: no toca MAC, usuario/contrasena de ONU ni historial de pagos.
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("../tools/lib/google-auth");
const { proximoCorteDe, cicloValido } = require("../functions/src/cortes");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const REAL = process.argv.includes("--real");
const JSON_IN = path.join(__dirname, "clientes-parseados.json");
const COL_CLIENTES = "clientes";
const COL_BACKUP = "clientes_hoja3_4_backup";
const HOJAS_EXCLUIDAS = ["hoja-3", "hoja-4"];
const PLAN_150 = { id: "qIihHNunMMhgBjdTTluN", nombre: "Familiar 150 Mbps" };

// ── Conversión JS <-> formato REST de Firestore ───────────────────────────
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f[k] = toValue(v);
  return f;
}
function fromValue(c) {
  const k = Object.keys(c)[0];
  const v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}
function fromDoc(doc) {
  const f = {};
  for (const [k, v] of Object.entries(doc.fields || {})) f[k] = fromValue(v);
  return f;
}

const claveDe = (telefono, ciclo) => String(telefono) + "|" + String(ciclo);
const mask = (t) => String(t).slice(0, 3) + "***" + String(t).slice(-2);

// ── Firestore ─────────────────────────────────────────────────────────────
async function listar(tok, coleccion) {
  const out = [];
  let pageToken = "", vueltas = 0;
  do {
    const url = `${BASE}/${coleccion}?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) throw new Error("GET " + coleccion + " -> " + res.status + ": " + (await res.text()).slice(0, 200));
    const d = await res.json();
    (d.documents || []).forEach(doc => out.push({ id: doc.name.split("/").pop(), data: fromDoc(doc) }));
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);
  return out;
}

async function patch(tok, coleccion, id, campos) {
  const q = Object.keys(campos).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const res = await fetch(`${BASE}/${coleccion}/${id}?${q}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFields(campos) })
  });
  if (!res.ok) throw new Error("PATCH " + id + " -> " + res.status + ": " + (await res.text()).slice(0, 200));
}

/** Crea el documento con un id fijo. Devuelve "creado" o "ya-existia" (409). */
async function crear(tok, coleccion, id, campos) {
  const res = await fetch(`${BASE}/${coleccion}?documentId=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFields(campos) })
  });
  if (res.status === 409) return "ya-existia";
  if (!res.ok) throw new Error("POST " + id + " -> " + res.status + ": " + (await res.text()).slice(0, 200));
  return "creado";
}

/** Borra el documento. Devuelve "borrado" o "no-existia" (404). */
async function borrar(tok, coleccion, id) {
  const res = await fetch(`${BASE}/${coleccion}/${id}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + tok }
  });
  if (res.status === 404) return "no-existia";
  if (!res.ok) throw new Error("DELETE " + id + " -> " + res.status + ": " + (await res.text()).slice(0, 200));
  return "borrado";
}

/** Quita "Plan a verificar" y la nota de la velocidad 160 y deja constancia del ajuste. */
function limpiarObservaciones160(obs) {
  const partes = String(obs || "").split(" · ").filter(p =>
    p && p !== "Plan a verificar" && !/^Velocidad en Excel:\s*160/i.test(p)
  );
  partes.push("Plan asignado: " + PLAN_150.nombre + " (en el Excel decia 160 Mbps)");
  return partes.join(" · ");
}

// =========================================================================
(async () => {
  console.log("=".repeat(72));
  console.log("AJUSTES FASE 2 — UneFibra" + (REAL ? "   *** MODO REAL: VA A ESCRIBIR ***" : "   (DRY-RUN: no escribe nada)"));
  console.log("=".repeat(72));

  if (!fs.existsSync(JSON_IN)) {
    console.log("No se encontro " + JSON_IN + "\nEjecuta antes:  node import/clientes-import.js --emitir");
    process.exit(1);
  }
  const parseados = JSON.parse(fs.readFileSync(JSON_IN, "utf8"));
  const tok = await tokenAcceso();

  const docsClientes = await listar(tok, COL_CLIENTES);
  const porClave = new Map();
  docsClientes.forEach(d => {
    const k = claveDe(d.data.telefono, d.data.cicloCorte);
    if (!porClave.has(k)) porClave.set(k, d);
  });

  const archivar = parseados.filter(c => HOJAS_EXCLUIDAS.includes(c.origen));
  const conservar = parseados.filter(c => !HOJAS_EXCLUIDAS.includes(c.origen));

  console.log("\n--- 1) ARCHIVAR Y SACAR LAS HOJAS 3-4 ---");
  const porHoja = new Map(), porCicloArch = new Map();
  archivar.forEach(c => {
    porHoja.set(c.origen, (porHoja.get(c.origen) || 0) + 1);
    porCicloArch.set(c.cicloCorte, (porCicloArch.get(c.cicloCorte) || 0) + 1);
  });
  console.log("  A archivar en " + COL_BACKUP + " : " + archivar.length);
  [...porHoja.entries()].sort().forEach(([k, v]) => console.log("    " + k + " : " + v + "   (ciclo " + (k === "hoja-3" ? 30 : 15) + ")"));
  console.log("  Desglose por ciclo: " + [...porCicloArch.entries()].sort().map(([k, v]) => k + "=" + v).join(", "));
  console.log("  Se borraran de " + COL_CLIENTES + "        : " + archivar.filter(c => porClave.has(claveDe(c.telefono, c.cicloCorte))).length);
  const archSinMatch = archivar.filter(c => !porClave.has(claveDe(c.telefono, c.cicloCorte)));
  if (archSinMatch.length) console.log("  (ya no estan en " + COL_CLIENTES + ": " + archSinMatch.length + " — normal si ya se corrio antes)");

  console.log("\n--- 2) LO QUE SE QUEDA: ip + origen + proximoCorte ---");
  console.log("  Clientes que se quedan (hojas 1-2) : " + conservar.length);
  const conservarSinMatch = conservar.filter(c => !porClave.has(claveDe(c.telefono, c.cicloCorte)));
  console.log("  Sin correspondencia en Firestore    : " + conservarSinMatch.length + (conservarSinMatch.length ? "   *** ABORTAR: la base y el Excel no cuadran ***" : "  (ok)"));

  const cambios = [];
  const cambiosIp = [], cambiosOrigen = [], cambiosProximo = [], cambiosPlan = [];
  for (const c of conservar) {
    const ref = porClave.get(claveDe(c.telefono, c.cicloCorte));
    if (!ref) continue;
    const nuevoProximo = proximoCorteDe(cicloValido(c.cicloCorte, c.fechaInicioServicio));
    const campos = {}, etiquetas = [];

    if (c.ip && ref.data.ip !== c.ip) { campos.ip = c.ip; cambiosIp.push(c); etiquetas.push("ip"); }
    if (ref.data.origen !== c.origen) { campos.origen = c.origen; cambiosOrigen.push(c); etiquetas.push("origen"); }
    if (ref.data.proximoCorte !== nuevoProximo) { campos.proximoCorte = nuevoProximo; cambiosProximo.push({ c, antes: ref.data.proximoCorte }); etiquetas.push("proximoCorte"); }

    const es160 = /160\s*Mbps/i.test(String(c.observaciones || ""));
    if (es160) {
      campos.planId = PLAN_150.id;
      campos.planNombre = PLAN_150.nombre;
      campos.observaciones = limpiarObservaciones160(c.observaciones);
      cambiosPlan.push(c);
      etiquetas.push("plan150");
    }
    if (etiquetas.length) cambios.push({ id: ref.id, campos, tel: c.telefono, ciclo: c.cicloCorte, etiquetas });
  }

  console.log("  Se actualizaran                     : " + cambios.length + " de " + conservar.length);
  console.log("    con ip nueva                      : " + cambiosIp.length);
  console.log("    con origen nuevo                  : " + cambiosOrigen.length);
  console.log("    con proximoCorte nuevo            : " + cambiosProximo.length);
  console.log("    con plan de 150 Mbps              : " + cambiosPlan.length + "   (el del Excel de 160 Mbps)");

  const antesDespues = new Map();
  cambiosProximo.forEach(x => {
    const k = "ciclo " + x.c.cicloCorte + ": " + (x.antes || "null") + "  ->  " + proximoCorteDe(cicloValido(x.c.cicloCorte, x.c.fechaInicioServicio));
    antesDespues.set(k, (antesDespues.get(k) || 0) + 1);
  });
  console.log("\n  proximoCorte antes -> despues:");
  [...antesDespues.entries()].sort().forEach(([k, v]) => console.log("    " + String(v).padStart(4) + "  " + k));

  const sinIp = conservar.filter(c => !c.ip);
  console.log("\n  Clientes que se quedan SIN ip       : " + sinIp.length + "   (el panel mostrara — en su columna IP)");
  const docsExtra = docsClientes.filter(d => !parseados.some(c => claveDe(c.telefono, c.cicloCorte) === claveDe(d.data.telefono, d.data.cicloCorte)));
  console.log("  Documentos en Firestore que NO vienen del Excel: " + docsExtra.length + "  (no se tocan)");
  docsExtra.forEach(d => {
    console.log("    tel " + mask(d.data.telefono || "?") + " | ciclo " + (d.data.cicloCorte || "-") + " | " + (d.data.estadoCliente || "-") +
      " | plan " + (d.data.planNombre || "-") + " | creado " + String(d.data.createdAt || "-").slice(0, 10) +
      " | id parece demo: " + /demo|seed|prueba|test/i.test(d.id));
  });

  if (conservarSinMatch.length) {
    console.log("\n*** ABORTADO: hay clientes del Excel que no estan en Firestore. No se escribio nada. ***");
    process.exit(1);
  }

  if (cambiosPlan.length) {
    console.log("\n  Cliente al que se le asigna el plan de 150 Mbps:");
    cambiosPlan.forEach(c => console.log("    tel " + mask(c.telefono) + " | ciclo " + c.cicloCorte + " | obs antes: " + String(c.observaciones).slice(0, 90)));
  }

  if (!REAL) {
    console.log("\n*** DRY-RUN: no se escribio nada. ***");
    console.log("    Para ejecutar de verdad:  node import/fase2-datos.js --real");
    return;
  }

  // ───────────────────────── ESCRITURA ─────────────────────────
  console.log("\n--- ESCRIBIENDO ---");
  const ahora = new Date().toISOString();
  let creados = 0, yaEstaban = 0, borrados = 0, yaBorrados = 0, actualizados = 0, fallos = 0;

  for (let i = 0; i < archivar.length; i++) {
    const c = archivar[i];
    const idBackup = "h34-" + c.telefono + "-" + c.cicloCorte;
    const ref = porClave.get(claveDe(c.telefono, c.cicloCorte));
    try {
      const doc = { ...c, archivadoEn: ahora, archivadoPor: "import/fase2-datos.js", motivoArchivo: "Hoja 3-4 (Elkin y Darlys): otro cobrador, fuera del panel de UneFibra", clienteIdOriginal: ref ? ref.id : null };
      delete doc.hoja;
      const r = await crear(tok, COL_BACKUP, idBackup, doc);
      r === "creado" ? creados++ : yaEstaban++;
      if (ref) {
        const rb = await borrar(tok, COL_CLIENTES, ref.id);
        rb === "borrado" ? borrados++ : yaBorrados++;
      }
    } catch (e) { fallos++; if (fallos <= 5) console.log("    fallo archivo " + mask(c.telefono) + ": " + e.message); }
    if ((i + 1) % 20 === 0) console.log("  ... " + (i + 1) + "/" + archivar.length + " archivados (creados " + creados + ", ya estaban " + yaEstaban + ", borrados " + borrados + ")");
  }

  for (let i = 0; i < cambios.length; i++) {
    try { await patch(tok, COL_CLIENTES, cambios[i].id, cambios[i].campos); actualizados++; }
    catch (e) { fallos++; if (fallos <= 5) console.log("    fallo update " + mask(cambios[i].tel) + ": " + e.message); }
    if ((i + 1) % 50 === 0) console.log("  ... " + (i + 1) + "/" + cambios.length + " actualizados (ok " + actualizados + ")");
  }

  console.log("\n  Archivados (nuevos)        : " + creados);
  console.log("  Ya estaban archivados      : " + yaEstaban);
  console.log("  Borrados de clientes       : " + borrados);
  console.log("  Ya no estaban en clientes  : " + yaBorrados);
  console.log("  Clientes actualizados      : " + actualizados);
  console.log("  Fallos                     : " + fallos);
  console.log("  Cuadre: " + conservar.length + " se quedan, " + archivar.length + " se archivan, " + actualizados + " actualizados");

  console.log("\n--- VERIFICACION FINAL (releyendo Firestore) ---");
  const finClientes = await listar(tok, COL_CLIENTES);
  const finBackup = await listar(tok, COL_BACKUP);
  const aSacar = archivar.filter(c => porClave.has(claveDe(c.telefono, c.cicloCorte))).length;
  const esperadoClientes = docsClientes.length - aSacar;
  console.log("  Documentos en " + COL_CLIENTES + "        : " + finClientes.length + "  (esperado " + esperadoClientes + " = " + docsClientes.length + " que habia - " + aSacar + " archivados)");
  console.log("  Documentos en " + COL_BACKUP + " : " + finBackup.length + "  (esperado " + archivar.length + ")");
  const fc15 = finClientes.filter(d => String(d.data.cicloCorte) === "15").length;
  const fc30 = finClientes.filter(d => String(d.data.cicloCorte) === "30").length;
  console.log("  Ciclo 15 / Ciclo 30                   : " + fc15 + " / " + fc30);
  console.log("  Con ip                                : " + finClientes.filter(d => d.data.ip).length);
  console.log("  proximoCorte distintos                : " + [...new Set(finClientes.map(d => d.data.proximoCorte))].sort().join(" | "));
  console.log("  Sin plan                              : " + finClientes.filter(d => !d.data.planId).length);
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
