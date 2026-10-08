/* Analisis READ-ONLY de nombres "sucios" en la coleccion `clientes`.
 * NO escribe nada. Genera la lista completa en import/nombres-sucios.txt
 *
 *   node import/analizar-nombres.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}
function fromDoc(doc) {
  const f = {};
  for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
  return f;
}

/* ---------------- Reglas de deteccion ----------------
 * Cada regla dice si el nombre esta contaminado y, si puede, como limpiarlo.
 * Se escribe el patron completo para poder revisarlo uno por uno. */
const REGLAS = [
  {
    id: "numero+paga",
    desc: 'Empieza con un numero (1-2 cifras) seguido de "paga": "25 paga MARIA..."',
    re: /^\s*\d{1,2}\s*paga\b[\s.:,-]*/i,
    limpiar: (n) => n.replace(/^\s*\d{1,2}\s*paga\b[\s.:,-]*/i, "").trim()
  },
  {
    id: "paga+numero",
    desc: '"paga" al principio, con o sin numero: "PAGA 25 JUAN", "PAGA JUAN"',
    re: /^\s*paga\b[\s.:,-]*\d{0,2}[\s.:,-]*/i,
    limpiar: (n) => n.replace(/^\s*paga\b[\s.:,-]*\d{0,2}[\s.:,-]*/i, "").trim()
  },
  {
    id: "empieza-numero",
    desc: "Empieza con un numero (posible anotacion pegada al nombre)",
    re: /^\s*\d/,
    limpiar: null // se revisa a mano: no se puede adivinar donde acaba el numero
  },
  {
    id: "paga-en-medio",
    desc: 'Contiene "paga" en cualquier posicion',
    re: /\bpaga\b/i,
    limpiar: null
  },
  {
    id: "contiene-numero",
    desc: "Contiene digitos dentro del nombre (no al principio)",
    re: /\d/,
    limpiar: null
  },
  {
    id: "empieza-simbolo",
    desc: "Empieza con simbolo o puntuacion (no letra)",
    re: /^\s*[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/,
    limpiar: null
  },
  {
    id: "palabra-clave",
    desc: "Contiene palabras de estado/anotacion: CANCEL, RETIR, NO PAGA, MOROS, MUDO, FALLEC, VENDIO, TRASLAD",
    re: /\b(cancel\w*|retir\w*|no\s+paga|moros\w*|mudo|fallec\w*|vendi\w*|traslad\w*|suspend\w*|desconect\w*|sin\s+servicio)\b/i,
    limpiar: null
  },
  {
    id: "simbolos-raros",
    desc: "Tiene caracteres raros: / \\ | * # @ ( ) [ ] { } < > = + % $ ¿ ? ¡ !",
    re: /[/\\|*#@()[\]{}<>=+%$¿?¡!]/,
    limpiar: null
  },
  {
    id: "conjunto-sin-numero",
    desc: "Contiene el nombre de un conjunto (direccion pegada SIN numero: la limpieza no la toca)",
    re: /\b(LA\s+LIBERTAD|LAS\s+FLO?RES|CANTARES|LA\s+CASCADA|MIRADOR|MIRA\s+CASCADA|LA\s+MONTA(?:Ñ|N)A|MONTA(?:Ñ|N)A|VENTO|ATARDECERES|VELETAS|JARDINES|CUCARACHO|LA\s+AURORA)\b/i,
    limpiar: null
  },
  {
    id: "muy-corto",
    desc: "Nombre muy corto (menos de 5 caracteres): posible dato incompleto",
    re: /^.{1,4}$/,
    limpiar: null
  },
  {
    id: "espacios-extra",
    desc: "Espacios dobles, al principio o al final, o guiones bajos",
    re: /^\s|\s$|\s{2,}|_/,
    limpiar: (n) => n.replace(/_/g, " ").replace(/\s+/g, " ").trim()
  }
];

(async () => {
  const tok = await tokenAcceso();
  const docs = [];
  let pageToken = "", vueltas = 0;
  do {
    const url = `${BASE}/clientes?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (!res.ok) throw new Error("Firestore " + res.status);
    const d = await res.json();
    (d.documents || []).forEach(doc => docs.push({ id: doc.name.split("/").pop(), data: fromDoc(doc) }));
    pageToken = d.nextPageToken || "";
    vueltas++;
  } while (pageToken && vueltas < 40);

  console.log("Clientes analizados: " + docs.length);

  const marcados = [];
  docs.forEach(d => {
    const n = String(d.data.nombreCompleto || "");
    const reglas = REGLAS.filter(r => r.re.test(n)).map(r => r.id);
    if (reglas.length) marcados.push({ id: d.id, nombre: n, reglas, ciclo: d.data.cicloCorte });
  });

  console.log("\n--- MARCAS POR REGLA ---");
  REGLAS.forEach(r => {
    const n = marcados.filter(m => m.reglas.includes(r.id)).length;
    console.log("  " + String(n).padStart(4) + "  " + r.id.padEnd(18) + r.desc);
  });

  console.log("\n  Clientes con al menos una marca : " + marcados.length + " de " + docs.length);
  console.log("  Clientes con nombre limpio      : " + (docs.length - marcados.length));

  // Cuantos son limpiables automaticamente sin ambiguedad.
  const auto = marcados.filter(m => {
    const r = REGLAS.find(x => x.id === (m.reglas.includes("numero+paga") ? "numero+paga" : m.reglas.includes("paga+numero") ? "paga+numero" : null));
    return r && r.limpiar && r.limpiar(m.nombre) && r.limpiar(m.nombre) !== m.nombre;
  });
  console.log("  Limpiables en automatico        : " + auto.length);
  console.log("  A revisar a mano                : " + (marcados.length - auto.length));

  console.log("\n--- EJEMPLOS DE LO LIMPIABLE (10, en crudo) ---");
  auto.slice(0, 10).forEach(m => {
    const r = REGLAS.find(x => x.limpiar && x.re.test(m.nombre));
    console.log('  "' + m.nombre + '"  ->  "' + r.limpiar(m.nombre) + '"');
  });

  console.log("\n--- LO QUE HAY QUE REVISAR A MANO (patron + primeros 40) ---");
  const manual = marcados.filter(m => !auto.includes(m));
  manual.slice(0, 40).forEach(m => console.log('  [' + m.reglas.join(",") + '] "' + m.nombre + '"'));
  if (manual.length > 40) console.log("  ... y " + (manual.length - 40) + " mas (ver el archivo)");

  const destino = path.join(__dirname, "nombres-sucios.txt");
  const lineas = ["# Nombres marcados (datos personales - archivo gitignoreado)", ""];
  auto.forEach(m => {
    const r = REGLAS.find(x => x.limpiar && x.re.test(m.nombre));
    lineas.push("AUTO    | " + m.nombre + "  ->  " + r.limpiar(m.nombre));
  });
  manual.forEach(m => lineas.push("REVISAR | [" + m.reglas.join(",") + "] " + m.nombre));
  fs.writeFileSync(destino, lineas.join("\n") + "\n", "utf8");
  console.log("\n  Lista completa -> " + destino);
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
