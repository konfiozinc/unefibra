/* ============================================================
 * UneFibra SAS — Importación de clientes desde Clientes.xlsx
 * ------------------------------------------------------------
 * Lee el Excel (ZIP+XML, sin librerías externas), transforma cada fila
 * al modelo de `clientes` de Firestore y, SOLO con --real, inserta.
 *
 * Por defecto corre en DRY-RUN: no escribe nada, solo reporta.
 *
 *   node import/clientes-import.js            -> dry-run
 *   node import/clientes-import.js --real     -> inserta
 *
 * NO importa: MAC, IP, usuario/contraseña de ONU, historial de pagos.
 * ============================================================ */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { proximoCorteDe, cicloValido } = require("../functions/src/cortes");
const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const RAIZ = path.resolve(__dirname, "..");
const XLSX = path.join(RAIZ, "Clientes.xlsx");
const REAL = process.argv.includes("--real");
const LOTE = 50;
const CONTADORES = { telsBasura: 0 };

// ── Hojas: cada una define su ciclo de corte ──────────────────────────────
// El "slug" es el identificador estable de la hoja de origen que se guarda en
// `clientes.origen`: sirve para rastrear de dónde vino cada cliente.
const HOJAS = [
  { nombre: "NUEVA LOS 15",          slug: "hoja-1", archivo: "sheet1.xml", ciclo: "15" },
  { nombre: "C nueva los 30",        slug: "hoja-2", archivo: "sheet2.xml", ciclo: "30" },
  { nombre: "Elkin y Darlys los 30", slug: "hoja-3", archivo: "sheet3.xml", ciclo: "30" },
  { nombre: "Elkin y darlys los 15", slug: "hoja-4", archivo: "sheet4.xml", ciclo: "15" }
];

// ── Planes reales de Firestore, indexados por velocidad ───────────────────
// Los de 50/60/70/80/90 Mbps se crearon desde el panel (precio 0: el negocio
// los ajusta despues). Los de 100-300 ya existian.
const PLANES_POR_VELOCIDAD = {
  50:  { id: "HMwzN4gDwCYTRPXbxUO0", nombre: "Plan 50 Mbps",      precio: 0 },
  60:  { id: "IML5y46vGMoR57zXDHDA", nombre: "Plan 60 Mbps",      precio: 0 },
  70:  { id: "L6dCiOgt0I9a5cUDGg7T", nombre: "Plan 70 Mbps",      precio: 0 },
  80:  { id: "qpo6otGyRq2jjxEY5m4r", nombre: "Plan 80 Mbps",      precio: 0 },
  90:  { id: "MvX0dLNiNTFVuy0bXsAs", nombre: "Plan 90 Mbps",      precio: 0 },
  100: { id: "QviXQ1asP979WZ8lXut6", nombre: "Básico 100 Mbps",   precio: 50000 },
  150: { id: "qIihHNunMMhgBjdTTluN", nombre: "Familiar 150 Mbps", precio: 60000 },
  200: { id: "qSdMSTAhyDYEb7p3eVZN", nombre: "Plus 200 Mbps",     precio: 70000 },
  250: { id: "BnXwsFaTDthircZC9R3L", nombre: "Premium 250 Mbps",  precio: 85000 },
  300: { id: "6RXlTH3ZkMPiEmqwTonn", nombre: "Ultra 300 Mbps",    precio: 100000 }
};

// ── Índices de columnas ───────────────────────────────────────────────────
const C = { IDX: 0, NOMBRE: 1, TELEFONO: 2, DIRECCION: 3, EQUIPOS: 4, CRED: 5, MAC: 6, IP: 7, FECHA: 8, VINICIAL: 9, VFACTURA: 10 };

// ============ LECTURA DEL XLSX (ZIP + XML) ================================
function extraerXlsx() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unefibra-imp-"));
  const zip = path.join(os.tmpdir(), "unefibra-imp-" + Date.now() + ".zip");
  fs.copyFileSync(XLSX, zip);
  try {
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: "ignore" });
  } catch (e) {
    throw new Error("No se pudo descomprimir el xlsx: " + e.message);
  }
  fs.rmSync(zip, { force: true });
  return tmp;
}

function leerSharedStrings(tmp) {
  const xml = fs.readFileSync(path.join(tmp, "xl/sharedStrings.xml"), "utf8");
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").trim());
  }
  return out;
}

const colIdx = (ref) => { let n = 0; for (const ch of ref.match(/^([A-Z]+)/)[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function leerHoja(tmp, archivo, shared) {
  const p = path.join(tmp, "xl/worksheets", archivo);
  if (!fs.existsSync(p)) return [];
  const xml = fs.readFileSync(p, "utf8");
  const filas = [];
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = parseInt(rm[1]) - 1; const fila = [];
    for (const cm of rm[2].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = cm[1], inn = cm[2] || "";
      const ref = (at.match(/r="([A-Z]+\d+)"/) || [])[1]; if (!ref) continue;
      const t = (at.match(/t="([^"]+)"/) || [])[1];
      let v = ""; const vv = (inn.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === "s") v = shared[parseInt(vv)] || "";
      else if (t === "inlineStr") v = [...inn.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("");
      else v = (vv || "").trim();
      fila[colIdx(ref)] = String(v).trim();
    }
    filas[r] = fila;
  }
  return filas;
}

// ============ TRANSFORMACIONES ===========================================
const digitos = (s) => String(s || "").replace(/\D/g, "");
const limpiar = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** Serial de Excel -> "YYYY-MM-DD" (epoch Excel: 1899-12-30). */
function fechaDesdeExcel(v) {
  const s = limpiar(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const anio = m[3].length === 2 ? (parseInt(m[3]) + 2000) : parseInt(m[3]);
    return `${anio}-${String(parseInt(m[2])).padStart(2, "0")}-${String(parseInt(m[1])).padStart(2, "0")}`;
  }
  const n = Number(s);
  if (isFinite(n) && n > 20000 && n < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Teléfonos de una celda: devuelve las cadenas de 10 dígitos válidas.
 *  Solo se aceptan fijos/móviles de Colombia: empiezan por 3 (móvil) o 6 (fijo).
 *  Se descarta cualquier cosa que no encaje (evita inventar números). */
function telefonosDe(celda) {
  const out = [];
  let descartados = 0;
  for (const parte of String(celda || "").split(/[+/]|\sy\s|,/i)) {
    const d = digitos(parte);
    let cand = null;
    if (d.length === 10) cand = d;
    else if (d.length === 12 && d.startsWith("57")) cand = d.slice(2);
    if (cand && (cand[0] === "3" || cand[0] === "6")) out.push(cand);
    else if (d) descartados++;
  }
  const uniq = [...new Set(out)];
  uniq._descartados = descartados;
  return uniq;
}

/** Dirección: separa torre / apartamento / bloque cuando es parseable.
 *  Marca `esEdificio` si la dirección menciona apartamento (sirve para inferir
 *  el tipo de vivienda: con apartamento -> edificio; sin él -> casa). */
function partirDireccion(dir) {
  const s = limpiar(dir);
  const out = { direccion: s || null, torre: null, apartamento: null, barrio: null, esEdificio: false };
  if (!s) return out;
  let resto = s;
  const t = resto.match(/\b(?:TORRE|TR|TOR)\s*\.?\s*([0-9]{1,3}[A-Z]?)\b/i);
  if (t) { out.torre = t[1].toUpperCase(); resto = resto.replace(t[0], " "); }
  const a = resto.match(/\b(?:APTO|APARTAMENTO|AP|APT)\s*\.?\s*([0-9]{1,4}[A-Z]?)\b/i);
  if (a) { out.apartamento = a[1].toUpperCase(); out.esEdificio = true; resto = resto.replace(a[0], " "); }
  out.direccion = limpiar(resto).replace(/\s*[,;]\s*$/, "").replace(/\s{2,}/g, " ") || s;
  return out;
}

// ── Conjuntos / urbanizaciones ────────────────────────────────────────────
// Las direcciones empiezan con el nombre del conjunto y casi siempre terminan
// en "B" (bloque) o "T" (torre): "LAS FLORES B 3 402". Hay typos del mismo
// conjunto; este mapa los normaliza. Si algo no encaja, se deja el texto
// original y se marca en observaciones (no se adivina).
const CONJUNTOS = [
  { canonico: "Cantares",              re: /^CANT/ },
  { canonico: "Las Flores",            re: /^LAS\s+FLO?R/ },
  { canonico: "La Libertad",           re: /^(LA\s+)?LIBERT/ },
  { canonico: "Vento",                 re: /^VENT/ },
  { canonico: "Mirador de la Cascada", re: /^(L?MIRADOR|MIRA\s+D|MIRA\s+CASCADA|MR\s+DE)/ },
  { canonico: "La Cascada",            re: /^LA\s+CASCADA/ },
  { canonico: "La Montaña",            re: /^(LA\s+)?(LS\s+)?(MONT|MANT)/ },
  { canonico: "Atardeceres",           re: /^ATARDEC/ },
  { canonico: "Las Veletas",           re: /^(LAS\s+)?VELETAS/ },
  { canonico: "La Fuente",             re: /^LA\s+FUENTE/ },
  { canonico: "Jardines",              re: /^JARDINES/ }
];

// Tipos de via: si la direccion arranca asi, NO hay conjunto que extraer.
const TIPOS_VIA = /^(CRA|CARRERA|CL|CLL|CALLE|KR|DG|DIAGONAL|TV|TRANSVERSAL|AV|AVENIDA|MZ|MANZANA|CIR|CIRCULAR|AUTOPISTA|VIA)\b/;

/** Detecta el conjunto (edificioUnidad) y el bloque/torre desde la dirección. */
function detectarConjunto(dir) {
  const s = limpiar(dir).toUpperCase();
  let prefijo = s.split(/\d/)[0].replace(/[.,;]/g, " ").replace(/\s+/g, " ").trim();
  if (!prefijo) return { nombre: null, torre: null, ambiguo: false };

  // Bloque/torre al final del prefijo: B, BL o T
  let torre = null;
  const mt = prefijo.match(/\s+(BL|B|T)$/);
  if (mt) { torre = mt[1] === "T" ? "T" : "B"; prefijo = prefijo.slice(0, mt.index).trim(); }

  // Direccion normal sin conjunto (empieza por tipo de via) -> no se inventa nada
  if (TIPOS_VIA.test(prefijo) || prefijo.length < 4) return { nombre: null, torre, ambiguo: false };

  for (const c of CONJUNTOS) {
    if (c.re.test(prefijo)) return { nombre: c.canonico, torre, ambiguo: false };
  }
  // No reconocido: se conserva el texto original en Title Case y se marca.
  const bonito = prefijo.split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return { nombre: bonito || null, torre, ambiguo: true };
}

/** Velocidad (Mbps) desde el texto libre de "Equipos". */
function velocidadDe(txt) {
  const s = String(txt || "").toUpperCase();
  const m = s.match(/(\d{2,4})\s*(?:MEGAS|MEGSAS|MEGS|MEGA|MEG|MRGAS|ME|M)\b/);
  if (!m) return null;
  const n = parseInt(m[1]);
  return (n >= 20 && n <= 500) ? n : null;   // 1000 / 2000 / 25000 quedan fuera
}

/** Precio: <1000 se asume en miles. Devuelve {valor, dudoso}. */
function normalizarPrecio(v) {
  const s = limpiar(v);
  if (!s) return { valor: null, dudoso: true };
  const n = Number(s.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (!isFinite(n) || n <= 0) return { valor: null, dudoso: true };
  if (n < 1000) return { valor: Math.round(n * 1000), dudoso: false };
  return { valor: Math.round(n), dudoso: false };
}

/** Construye el documento `clientes` desde una fila. */
function filaACliente(fila, ciclo) {
  const nombre = limpiar(fila[C.NOMBRE]);
  const tels = telefonosDe(fila[C.TELEFONO]);
  CONTADORES.telsBasura += (tels._descartados || 0);
  if (!nombre || !tels.length) return null;

  const dir = partirDireccion(fila[C.DIRECCION]);
  const conj = detectarConjunto(fila[C.DIRECCION]);
  const vel = velocidadDe(fila[C.EQUIPOS]);
  const plan = vel ? PLANES_POR_VELOCIDAD[vel] || null : null;
  const precio = normalizarPrecio(fila[C.VFACTURA]);
  const vInicial = normalizarPrecio(fila[C.VINICIAL]);
  const equipos = limpiar(fila[C.EQUIPOS]);

  const obs = [];
  if (tels[1]) obs.push("Teléfono alterno: " + tels[1]);
  if (precio.dudoso) obs.push("Verificar valor factura");
  if (!plan) obs.push("Plan a verificar");
  if (vel && !plan) obs.push("Velocidad en Excel: " + vel + " Mbps (no hay plan con esa velocidad)");
  if (vInicial.valor) obs.push("Valor inicial: " + vInicial.valor.toLocaleString("es-CO"));
  if (conj.ambiguo && conj.nombre) obs.push("Conjunto a verificar");
  obs.push("Barrio a completar");
  if (equipos && /TVBOX|TV BOX|TBOX/i.test(equipos)) {
    const n = (equipos.match(/\b(\d)\s*(?:TVBOX|TV ?BOX|TBOX)/i) || [])[1];
    obs.push("TVBox: " + (n || "1"));
  }

  const fechaInicio = fechaDesdeExcel(fila[C.FECHA]);
  const hoy = new Date().toISOString().slice(0, 10);
  const base = fechaInicio || hoy;
  const cicloFinal = cicloValido(ciclo, base);
  // El proximo corte es el SIGUIENTE desde hoy (no desde la fecha de ingreso,
  // que puede ser de 2024 y daria una fecha ya pasada).
  const proximo = proximoCorteDe(cicloFinal);
  // Vencimiento = inicio + duracion del plan (todos los planes son de 30 dias).
  const duracion = plan ? 30 : 30;
  const venc = fechaInicio
    ? new Date(Date.parse(base + "T00:00:00Z") + duracion * 86400000).toISOString().slice(0, 10)
    : base;
  const esVencido = /VENCID|MES VENCIDO|DEBE/i.test(String(fila[C.VFACTURA] || "") + " " + String(fila[C.EQUIPOS] || ""));

  return {
    nombreCompleto: nombre,
    documento: null,
    telefono: tels[0],
    whatsapp: tels[0],
    whatsappOptIn: true,
    email: null,
    direccion: dir.direccion,
    barrio: dir.barrio,
    ciudad: "Medellín",
    tipoVivienda: dir.direccion ? (dir.esEdificio ? "edificio" : "casa") : null,
    edificioUnidad: conj.nombre,
    torre: conj.torre || dir.torre,
    apartamento: dir.apartamento,
    planId: plan ? plan.id : null,
    planNombre: plan ? plan.nombre : null,
    precioMensual: precio.valor,
    fechaInstalacion: fechaInicio,
    fechaInicioServicio: base,
    fechaVencimiento: venc,
    cicloCorte: cicloFinal,
    proximoCorte: proximo,
    estadoCliente: esVencido ? "SUSPENDIDO" : "ACTIVO",
    estadoServicio: esVencido ? "SUSPENDIDO" : "ACTIVO",
    metodoPagoPreferido: null,
    observaciones: obs.length ? obs.join(" · ") : null,
    activo: true,
    // IP del cliente: la usa el panel para identificar la conexion.
    ip: limpiar(fila[C.IP]) || null,
    _equipos: equipos,
    _completos: fila.filter(x => x && String(x).trim()).length,
    _hoja: null
  };
}

// ============ FIRESTORE (REST + token de la sesión) ======================
// Devuelve true si YA existe un cliente con el MISMO telefono Y el MISMO ciclo.
//
// IMPORTANTE: la clave de deduplicacion de este import es "telefono + ciclo",
// porque un mismo numero puede tener dos servicios en ciclos distintos (y hay 7
// casos asi). La comprobacion contra Firestore debe usar la MISMA clave:
// filtrar SOLO por telefono saltaba en silencio al segundo cliente de cada par.
// Si la consulta falla, LANZA (no devuelve null): preferimos abortar antes que
// insertar a ciegas y arriesgar duplicados.
async function existeCliente(tok, telefono, ciclo) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "clientes" }], where: { fieldFilter: { field: { fieldPath: "telefono" }, op: "EQUAL", value: { stringValue: telefono } } } } })
  });
  if (!res.ok) throw new Error("consulta de duplicados fallo (" + res.status + "): " + (await res.text()).slice(0, 200));
  const d = await res.json();
  return (d || []).some(x => x.document && String((((x.document.fields || {}).cicloCorte || {}).stringValue) || "") === String(ciclo));
}

async function insertar(tok, c) {
  const campos = {};
  const push = (k, v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "boolean") campos[k] = { booleanValue: v };
    else if (typeof v === "number") campos[k] = { integerValue: String(v) };
    else campos[k] = { stringValue: String(v) };
  };
  for (const [k, v] of Object.entries(c)) { if (!k.startsWith("_")) push(k, v); }
  campos.createdAt = { timestampValue: new Date().toISOString() };
  campos.updatedAt = { timestampValue: new Date().toISOString() };

  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents/clientes`, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: campos })
  });
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 160));
  return (await res.json()).name.split("/").pop();
}

// ============ PRINCIPAL ==================================================
(async () => {
  console.log("=".repeat(72));
  console.log("IMPORTACION DE CLIENTES — UneFibra" + (REAL ? "   *** MODO REAL: VA A ESCRIBIR ***" : "   (DRY-RUN: no escribe nada)"));
  console.log("=".repeat(72));

  if (!fs.existsSync(XLSX)) { console.log("No se encontro " + XLSX); process.exit(1); }

  const tmp = extraerXlsx();
  const shared = leerSharedStrings(tmp);
  const hojasVistas = new Set();
  const candidatos = [];
  let filasLeidas = 0, sinNombreOTel = 0;

  for (const h of HOJAS) {
    if (hojasVistas.has(h.archivo)) continue;
    hojasVistas.add(h.archivo);
    const filas = leerHoja(tmp, h.archivo, shared);
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i] || [];
      if (f.filter(x => x && String(x).trim()).length === 0) continue;
      filasLeidas++;
      const c = filaACliente(f, h.ciclo);
      if (!c) { sinNombreOTel++; continue; }
      c._hoja = h.nombre;
      c._origen = h.slug;
      candidatos.push(c);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // Dedup: misma clave = mismo telefono + mismo ciclo
  const grupos = new Map();
  for (const c of candidatos) {
    const k = c.telefono + "|" + c.cicloCorte;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  const finales = [];
  let duplicadosMismaTanda = 0, sospechosos = 0;
  for (const [k, arr] of grupos) {
    if (arr.length === 1) { finales.push(arr[0]); continue; }
    sospechosos++;
    const elegido = arr.slice().sort((a, b) => b._completos - a._completos)[0];
    duplicadosMismaTanda += arr.length - 1;
    finales.push(elegido);
  }

  // Mismo telefono en ciclos distintos => 2 clientes (se conservan)
  const porTel = new Map();
  finales.forEach(c => { if (!porTel.has(c.telefono)) porTel.set(c.telefono, new Set()); porTel.get(c.telefono).add(c.cicloCorte); });
  const enDosCiclos = [...porTel.values()].filter(s => s.size > 1).length;

  // Stats
  const sinPlan = finales.filter(c => !c.planId).length;
  const sinPrecio = finales.filter(c => c.precioMensual === null).length;
  const sinDireccion = finales.filter(c => !c.direccion).length;
  const conTorre = finales.filter(c => c.torre).length;
  const conApto = finales.filter(c => c.apartamento).length;
  const conAlterno = finales.filter(c => c.observaciones && c.observaciones.includes("Teléfono alterno")).length;
  const suspendidos = finales.filter(c => c.estadoCliente === "SUSPENDIDO").length;
  const porCiclo = { "15": finales.filter(c => c.cicloCorte === "15").length, "30": finales.filter(c => c.cicloCorte === "30").length };

  const velocidades = new Map();
  finales.forEach(c => { const v = c._equipos ? velocidadDe(c._equipos) : null; const k = v ? v + " Mbps" : "(sin velocidad)"; velocidades.set(k, (velocidades.get(k) || 0) + 1); });

  console.log("\n--- LECTURA ---");
  console.log("  Filas con datos leidas                 : " + filasLeidas);
  console.log("  Descartadas (sin nombre o sin telefono): " + sinNombreOTel);
  console.log("  Candidatas                             : " + candidatos.length);

  console.log("\n--- DEDUPLICACION (por telefono + ciclo) ---");
  console.log("  Grupos con telefono repetido en la MISMA tanda : " + sospechosos);
  console.log("  Filas descartadas por duplicado                : " + duplicadosMismaTanda);
  console.log("  Clientes unicos a importar                     : " + finales.length);
  console.log("  Telefonos presentes en AMBOS ciclos (2 clientes): " + enDosCiclos);

  console.log("\n--- LO QUE SE VA A INSERTAR ---");
  console.log("  Ciclo 15 : " + porCiclo["15"]);
  console.log("  Ciclo 30 : " + porCiclo["30"]);
  console.log("  Sin plan asignado (planId null)   : " + sinPlan);
  console.log("  Sin precio (precioMensual null)   : " + sinPrecio);
  console.log("  Sin direccion                     : " + sinDireccion);
  console.log("  Con torre / apartamento detectado : " + conTorre + " / " + conApto);
  console.log("  tipoVivienda inferido             : edificio " + finales.filter(c => c.tipoVivienda === "edificio").length + " | casa " + finales.filter(c => c.tipoVivienda === "casa").length);
  console.log("  Con telefono alterno en observac. : " + conAlterno);
  console.log("  Marcados SUSPENDIDO (VENCIDO)     : " + suspendidos);
  console.log("  Numeros de telefono descartados   : " + CONTADORES.telsBasura + "  (no son fijos/moviles de Colombia: no empiezan por 3 ni 6)");
  console.log("  Con edificioUnidad asignado       : " + finales.filter(c => c.edificioUnidad).length);
  console.log("  Con torre/bloque (B o T)          : " + finales.filter(c => c.torre).length);
  console.log("  Conjunto a verificar (no reconocido): " + finales.filter(c => c.observaciones && c.observaciones.includes("Conjunto a verificar")).length);

  const conjuntos = new Map();
  finales.forEach(c => { const k = c.edificioUnidad || "(sin conjunto)"; conjuntos.set(k, (conjuntos.get(k) || 0) + 1); });
  console.log("\n--- CONJUNTOS DETECTADOS (" + conjuntos.size + " distintos) ---");
  [...conjuntos.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + String(v).padStart(4) + "  " + k));

  console.log("\n--- VELOCIDADES DETECTADAS EN 'Equipos' ---");
  [...velocidades.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const tiene = PLANES_POR_VELOCIDAD[parseInt(k)];
    console.log("  " + k.padEnd(16) + String(v).padStart(4) + " filas   " + (k === "(sin velocidad)" ? "" : (tiene ? "-> " + tiene.nombre : "*** NO HAY PLAN CON ESA VELOCIDAD ***")));
  });

  console.log("\n--- EJEMPLOS ANONIMIZADOS (3) ---");
  finales.slice(0, 3).forEach((c, i) => {
    console.log("  " + (i + 1) + ") " + c.nombreCompleto.slice(0, 1) + ". | tel " + c.telefono.slice(0, 3) + "***" + c.telefono.slice(-2) +
      " | ciclo " + c.cicloCorte + " | plan " + (c.planNombre || "null") + " | precio " + c.precioMensual +
      " | proximoCorte " + c.proximoCorte + " | obs: " + (c.observaciones || "-").slice(0, 60));
  });

  // ── Desglose por hoja de origen (SOLO LECTURA: no consulta ni escribe Firestore) ──
  if (process.argv.includes("--resumen")) {
    const porHoja = new Map();
    finales.forEach(c => porHoja.set(c._hoja, (porHoja.get(c._hoja) || 0) + 1));
    console.log("\n--- CLIENTES UNICOS POR HOJA DE ORIGEN ---");
    [...porHoja.entries()].sort().forEach(([k, v]) => {
      const h = HOJAS.find(x => x.nombre === k);
      console.log("  " + String(v).padStart(4) + "  " + k + "   (ciclo " + (h ? h.ciclo : "?") + ")");
    });
    const porCiclo = new Map();
    finales.forEach(c => porCiclo.set(c.cicloCorte, (porCiclo.get(c.cicloCorte) || 0) + 1));
    console.log("\n--- POR CICLO ---");
    [...porCiclo.entries()].sort().forEach(([k, v]) => console.log("  ciclo " + k + " : " + v));
    const hojas34 = finales.filter(c => c._hoja === "Elkin y Darlys los 30" || c._hoja === "Elkin y darlys los 15");
    console.log("\n--- HOJAS 3 y 4 (Elkin y Darlys) ---");
    console.log("  Clientes unicos en hojas 3-4 : " + hojas34.length);
    console.log("  Clientes en hojas 1-2        : " + (finales.length - hojas34.length));
    const c34 = new Map();
    hojas34.forEach(c => c34.set(c.cicloCorte, (c34.get(c.cicloCorte) || 0) + 1));
    [...c34.entries()].sort().forEach(([k, v]) => console.log("    ciclo " + k + " : " + v));
    console.log("\n(Modo --resumen: no se consulto ni se escribio Firestore.)");
    return;
  }

  // ── Exporta el resultado del parseo a JSON (no consulta ni escribe Firestore) ──
  // Lo consume import/fase2-datos.js. OJO: el archivo contiene datos personales de
  // los clientes; por eso se escribe DENTRO de import/, que esta gitignoreado.
  if (process.argv.includes("--emitir")) {
    const destino = path.join(__dirname, "clientes-parseados.json");
    const limpio = finales.map(c => {
      const o = {};
      for (const [k, v] of Object.entries(c)) if (!k.startsWith("_")) o[k] = v;
      o.origen = c._origen;
      o.hoja = c._hoja;
      return o;
    });
    fs.writeFileSync(destino, JSON.stringify(limpio, null, 1), "utf8");
    console.log("\n--- EXPORTADO ---");
    console.log("  " + limpio.length + " clientes -> " + destino);
    console.log("  Campos por cliente: " + Object.keys(limpio[0] || {}).length);
    console.log("  (Datos personales: el archivo vive en import/, que esta gitignoreado.)");
    return;
  }

  // Duplicados con Firebase
  if (finales.length) {
    const tok = await tokenAcceso();
    console.log("\n--- CONTRA FIREBASE ---");
    let yaExisten = 0;
    for (let i = 0; i < finales.length; i++) {
      if (await existeCliente(tok, finales[i].telefono, finales[i].cicloCorte)) yaExisten++;
    }
    console.log("  Ya existen (mismo telefono + mismo ciclo): " + yaExisten);
    console.log("  FALTAN POR INSERTAR                      : " + (finales.length - yaExisten));

    if (REAL) {
      console.log("\n--- INSERTANDO ---");
      let ok = 0, omitidos = 0, fallos = 0;
      for (let i = 0; i < finales.length; i++) {
        if (await existeCliente(tok, finales[i].telefono, finales[i].cicloCorte)) { omitidos++; continue; }
        try { await insertar(tok, finales[i]); ok++; }
        catch (e) { fallos++; if (fallos <= 5) console.log("    fallo [" + (i + 1) + "/" + finales.length + "]: " + e.message); }
        if ((i + 1) % LOTE === 0) console.log("  ... " + (i + 1) + "/" + finales.length + " procesados (insertados " + ok + ", omitidos " + omitidos + ", fallos " + fallos + ")");
      }
      console.log("\n  Insertados             : " + ok);
      console.log("  Ya existian (omitidos) : " + omitidos);
      console.log("  Fallos                 : " + fallos);
      const cuadra = (ok + omitidos + fallos) === finales.length;
      console.log("  Cuadre " + ok + " + " + omitidos + " + " + fallos + " = " + (ok + omitidos + fallos) + " de " + finales.length + " -> " + (cuadra ? "OK" : "*** NO CUADRA ***"));
    } else {
      console.log("\n*** DRY-RUN: no se inserto nada. ***");
      console.log("    Para ejecutar de verdad:  node import/clientes-import.js --real");
    }
  }
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
