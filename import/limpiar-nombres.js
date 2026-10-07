/* ============================================================
 * UneFibra SAS — Limpieza de nombres contaminados
 * ------------------------------------------------------------
 * El campo "nombre" del Excel traia, pegado al nombre, la direccion y el IP:
 *     "MARIA PEREZ LA LIBERTAD B3 APTO 111 IP 101.2"
 *     "25 paga MARIA PEREZ"
 * (Los nombres de los ejemplos son inventados: este archivo se versiona en un
 * repositorio PUBLICO y no puede citar clientes reales.)
 * Esa informacion YA esta guardada en `direccion`, `edificioUnidad`, `torre`,
 * `apartamento` e `ip`, asi que quitarla del nombre no pierde nada... y de paso
 * arregla los mensajes de WhatsApp, que hoy saludan a "Hola MARIA PEREZ
 * LA LIBERTAD B3 APTO 111".
 *
 * El nombre anterior se guarda en `nombreOriginal` para que el cambio sea
 * auditable y reversible.
 *
 *   node import/limpiar-nombres.js           -> DRY-RUN (no escribe nada)
 *   node import/limpiar-nombres.js --real    -> escribe
 *
 * NO toca el estado, ni la direccion, ni el telefono: solo `nombreCompleto`.
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const REAL = process.argv.includes("--real");

// ── 1) Anotaciones de pago pegadas al nombre ──────────────────────────────
// "25 paga MARIA...", "paga los 5 ANA...", "PAGA 25 JUAN", "JUAN PEREZ
// LOS 5 DE CADA ME", "JUAN PEREZ PAGA EL 20". (Nombres inventados.)
const NOTAS = [
  { id: "PAGO_nota", re: /^\s*\d{0,2}\s*paga\s*(?:los\s*)?\d{0,2}\b[\s.:,-]*/i },
  { id: "PAGO_nota", re: /\s+los?\s*\d{1,2}\s+de\s+cada\s+me(?:s)?\s*$/i },
  { id: "PAGO_nota", re: /\s+(?:paga|pago)\s+(?:el\s+)?\d{1,2}\s*$/i },
  { id: "PAGO_nota", re: /\s+\d{1,2}\s+(?:paga|pago)\s*$/i }
];

// ── 2) Donde empieza la direccion ─────────────────────────────────────────
// Se separan en DOS grupos porque el riesgo es distinto:
//
//  · LARGOS: tienen 2 palabras o 7+ letras ("LA CASCADA", "CUCARACHO",
//    "JARDINES"). Se permiten PEGADOS al nombre, porque en el Excel quedaron
//    asi: "PEREZLA CASCADA", "GOMEZCUCARACHO", "LOPEZJARDINES".
//  · CORTOS: 1 palabra y pocas letras ("MIR", "MIRA", "VENT0"). Estos EXIGEN
//    ir tras un espacio o al principio: si no, "MIRA" cortaria dentro de un
//    nombre que termina en "-MIRA" y lo dejaria reducido a un resto sin sentido.
//    (Paso de verdad en este dataset, con un nombre real.)
const CONJUNTOS_LARGOS = [
  "LA?\\s*LIBERTAD",
  "LA{1,2}\\s*F[KL]O?R(?:ES)?", "LAS\\s*F[KL]O?R(?:ES)?",
  "LA\\s*CASCADA", "MIRA\\s*D(?:E|L)?\\s*(?:LA\\s*)?CASCADA", "MIRADOR",
  "CANTARES",
  "ATARDECER(?:ES)?",
  "LAS\\s*CASITAS", "LAS\\s*VELETAS", "VELETAS", "LA\\s*FUENTE",
  "CUCARACHO", "CALLEJON", "CHAGUALON", "PEDREGAL", "LLASMILA",
  "PARQUEDERO", "PORTON", "HIJA\\s+DE", "PEDRE\\s+BAJO",
  "LA\\s*AURORA", "ZAPATOS", "FRECITAS", "RENACER", "IGLESIA", "JARDINES"
];

const CONJUNTOS_CORTOS = [
  "MIRA?", "NIRA", "MIR", "MR",
  "MONTA(?:Ñ|N)A", "MANTA(?:Ñ|N)A", "MOTA(?:Ñ|N)S?", "M9NTA(?:Ñ|N)A",
  "VENT[O0]", "CASCA(?:DA)?", "CASCASA", "LIBERTAD", "JARDI"
];

const VIAS = ["CRA", "CARRERA", "CALLE", "CLL", "KR", "DG", "DIAGONAL", "TRANSVERSAL", "AVENIDA", "MANZANA"];

// Un bloque/torre con apartamento, SIN nombre de conjunto delante:
// "NORA ANGELA SEPULVEDA JULIO MOLINA B4 APTO 302". Es tan especifico que no
// puede confundirse con un nombre de persona.
const PATRON_BLOQUE = /\s+[BT]\s*\d{1,3}\s+(?:APTO|APARTAMENTO|AP|APT|AOTO|ATPTO)\b/i;

// `(?![A-ZÑ])` evita cortar dentro de una palabra mas larga.
const PATRON_CONJUNTO = new RegExp(
  "\\s*(?:(?:" + CONJUNTOS_LARGOS.join("|") + ")|(?:(?:^|\\s+)(?:" + CONJUNTOS_CORTOS.join("|") + ")))(?![A-ZÑ])",
  "i"
);
const PATRON_VIA = new RegExp("(?:^|\\s+)(?:\\b(?:" + VIAS.join("|") + ")\\b)(?![A-ZÑ])", "i");

/** Cuantas palabras hay que avanzar (tras el corte) hasta encontrar un digito. -1 si no hay. */
function palabrasHastaElDigito(texto) {
  return String(texto).trim().split(/\s+/).findIndex(w => /\d/.test(w));
}

/** Posicion donde empieza el texto encontrado (sin el espacio previo). */
function inicioDelTexto(n, m) {
  const lead = m[0].match(/^\s+/);
  return m.index + (lead ? lead[0].length : 0);
}

function limpiarNombre(nombre) {
  let n = String(nombre || "");
  const aplicados = [];

  for (const p of NOTAS) {
    if (p.re.test(n) && !aplicados.includes(p.id)) {
      n = n.replace(p.re, "").trim();
      aplicados.push(p.id);
    }
  }

  // Orden de preferencia: primero el CONJUNTO (es el marcador fiable del inicio
  // de la direccion), luego el bloque con apartamento y, si no hay nada de eso,
  // el tipo de via. El orden importa: "MARIA CALLE MIRA CASCADA B1" debe
  // cortarse en "MIRA CASCADA", no en "CALLE" (que ahi es un APELLIDO).
  const m = n.match(PATRON_CONJUNTO) || n.match(PATRON_BLOQUE) || n.match(PATRON_VIA);
  if (m) {
    const corte = inicioDelTexto(n, m);
    // Guardia: delante debe venir una direccion, o sea un numero cerca (hasta 5
    // palabras). Asi "DIEGO GARCIA VENTO1 T 3" se limpia, pero un apellido
    // suelto como "MARIA VENTO" no se toca. Y el nombre debe quedar con algo.
    const pos = palabrasHastaElDigito(n.slice(corte));
    if (corte >= 3 && pos >= 0 && pos <= 5) { n = n.slice(0, corte).trim(); aplicados.push("DIRECCION"); }
  }

  // Limpieza final de restos: comas, puntos y espacios sobrantes al final.
  n = n.replace(/[\s.,;:_-]+$/, "").replace(/\s{2,}/g, " ").trim();
  return { limpio: n, aplicados };
}

// ── Firestore ─────────────────────────────────────────────────────────────
function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function toFields(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f[k] = toValue(v);
  return f;
}
async function patch(tok, id, campos) {
  const q = Object.keys(campos).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const res = await fetch(`${BASE}/clientes/${id}?${q}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFields(campos) })
  });
  if (!res.ok) throw new Error("PATCH " + id + " -> " + res.status + ": " + (await res.text()).slice(0, 200));
}

(async () => {
  console.log("=".repeat(72));
  console.log("LIMPIEZA DE NOMBRES — UneFibra" + (REAL ? "   *** MODO REAL: VA A ESCRIBIR ***" : "   (DRY-RUN: no escribe nada)"));
  console.log("=".repeat(72));

  const tok = await tokenAcceso();
  const docs = [];
  let pageToken = "", vueltas = 0;
  do {
    const url = `${BASE}/clientes?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) throw new Error("Firestore " + res.status);
    const d = await res.json();
    (d.documents || []).forEach(doc => {
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
      docs.push({ id: doc.name.split("/").pop(), data: f });
    });
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);

  console.log("\nClientes revisados: " + docs.length);

  const cambios = [], sinTocar = [], dudosos = [];
  docs.forEach(d => {
    const original = String(d.data.nombreCompleto || "").trim();
    if (!original) return;
    const { limpio, aplicados } = limpiarNombre(original);
    if (!aplicados.length) { if (/\d/.test(original)) dudosos.push({ d, original }); return; }
    if (!limpio || limpio === original) return;
    // Salvaguardas: no dejar un nombre vacio, ni de 1-2 letras, ni sin letras.
    if (limpio.length < 3 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}/.test(limpio)) {
      dudosos.push({ d, original, motivo: "el resultado quedaria en '" + limpio + "'" });
      return;
    }
    cambios.push({ id: d.id, original, limpio, aplicados, ciclo: d.data.cicloCorte });
    sinTocar.push(d);
  });

  const porTipo = {};
  cambios.forEach(c => c.aplicados.forEach(a => { porTipo[a] = (porTipo[a] || 0) + 1; }));
  console.log("\n--- QUE SE VA A LIMPIAR ---");
  console.log("  Nombres a corregir            : " + cambios.length + " de " + docs.length);
  console.log("    con direccion pegada        : " + (porTipo.DIRECCION || 0));
  console.log("    con anotacion de pago       : " + (porTipo.PAGO_nota || 0));
  console.log("  Nombres que ya estan bien     : " + (docs.length - cambios.length - dudosos.length));
  console.log("  Con digitos pero SIN patron claro (no se tocan): " + dudosos.length);

  console.log("\n--- 5 EJEMPLOS ANTES / DESPUES ---");
  cambios.slice(0, 5).forEach((c, i) => {
    console.log("  " + (i + 1) + ") ANTES  : " + c.original);
    console.log("     DESPUES: " + c.limpio);
  });

  // Red de seguridad: un nombre que queda de una sola palabra o muy corto es
  // donde se veria un corte mal hecho. Se listan para revisarlos ANTES de escribir.
  const sospechosos = cambios.filter(c => c.limpio.split(/\s+/).length < 2 || c.limpio.length < 10);
  console.log("\n--- RESULTADOS SOSPECHOSOS (revisar antes de escribir): " + sospechosos.length + " ---");
  if (!sospechosos.length) console.log("  ninguno: todos los resultados tienen 2 o mas palabras");
  sospechosos.forEach(c => console.log('  "' + c.original + '"  ->  "' + c.limpio + '"'));

  // Muestra amplia: 1 de cada 20, para detectar un error sistematico que las dos
  // redes anteriores no verian (un patron que corte siempre en el sitio erroneo).
  console.log("\n--- MUESTRA (1 de cada 20) ---");
  cambios.filter((_, i) => i % 20 === 0).forEach(c => {
    console.log('  "' + c.original + '"');
    console.log('     -> "' + c.limpio + '"');
  });

  if (dudosos.length) {
    console.log("\n--- DUDOSOS (tienen numeros pero no encaja el patron; NO se tocan) ---");
    dudosos.slice(0, 25).forEach(x => console.log('  "' + x.original + '"' + (x.motivo ? "   [" + x.motivo + "]" : "")));
    if (dudosos.length > 25) console.log("  ... y " + (dudosos.length - 25) + " mas (ver el archivo)");
  }

  const destino = path.join(__dirname, "nombres-limpieza.txt");
  fs.writeFileSync(destino,
    "# Limpieza de nombres (datos personales - archivo gitignoreado)\n\n" +
    "== A CORREGIR (" + cambios.length + ") ==\n" +
    cambios.map(c => c.aplicados.join("+") + " | " + c.original + "  ->  " + c.limpio).join("\n") +
    "\n\n== DUDOSOS, NO SE TOCAN (" + dudosos.length + ") ==\n" +
    dudosos.map(x => x.original + (x.motivo ? "   [" + x.motivo + "]" : "")).join("\n") + "\n", "utf8");
  console.log("\n  Detalle completo -> " + destino);

  if (!REAL) {
    console.log("\n*** DRY-RUN: no se escribio nada. ***");
    console.log("    Para ejecutar de verdad:  node import/limpiar-nombres.js --real");
    return;
  }

  console.log("\n--- ESCRIBIENDO ---");
  let ok = 0, fallos = 0;
  for (let i = 0; i < cambios.length; i++) {
    const c = cambios[i];
    try {
      await patch(tok, c.id, {
        nombreCompleto: c.limpio,
        nombreOriginal: c.original,
        updatedAt: new Date().toISOString()
      });
      ok++;
    } catch (e) {
      fallos++;
      if (fallos <= 5) console.log('    fallo en "' + c.limpio.slice(0, 20) + '...": ' + e.message);
    }
    if ((i + 1) % 50 === 0) console.log("  ... " + (i + 1) + "/" + cambios.length + " (ok " + ok + ", fallos " + fallos + ")");
  }

  console.log("\n  Nombres corregidos : " + ok);
  console.log("  Fallos             : " + fallos);
  console.log("  Cuadre " + ok + " + " + fallos + " = " + (ok + fallos) + " de " + cambios.length + " -> " + ((ok + fallos) === cambios.length ? "OK" : "*** NO CUADRA ***"));

  // Verificacion: se relee y se comprueba que ya no queda ningun nombre con el patron.
  const quedan = [];
  let pt = "", v = 0;
  do {
    const url = `${BASE}/clientes?pageSize=300${pt ? "&pageToken=" + encodeURIComponent(pt) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    const d = await res.json();
    (d.documents || []).forEach(doc => {
      const f = {};
      for (const [k, val2] of Object.entries(doc.fields || {})) f[k] = val(val2);
      const n = String(f.nombreCompleto || "");
      if (PATRON_CONJUNTO.test(n) || PATRON_BLOQUE.test(n)) quedan.push(n);
    });
    pt = d.nextPageToken || ""; v++;
  } while (pt && v < 40);

  console.log("\n--- VERIFICACION (releyendo Firestore) ---");
  console.log("  Nombres que TODAVIA parecen traer direccion: " + quedan.length + "  (deben ser los dudosos de arriba)");
  quedan.slice(0, 10).forEach(n => console.log('    "' + n + '"'));
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
