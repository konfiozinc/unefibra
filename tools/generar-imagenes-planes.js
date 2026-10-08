/* ============================================================
 * UneFibra SAS — Imágenes de los planes (para WhatsApp y Commerce Manager)
 * ------------------------------------------------------------
 * Genera una imagen cuadrada por plan PÚBLICO (los que tienen precio), con la
 * paleta y las tipografías REALES del sitio, y las deja en assets/img/planes/.
 *
 * Por qué así:
 *  · WhatsApp NO muestra WebP ni SVG en los adjuntos: solo JPEG y PNG. Por eso
 *    se exporta en JPEG (además pesa menos que PNG para fotos con degradados).
 *  · Se renderiza con Chrome (Playwright) y no con sharp: sharp no está
 *    instalado en este proyecto, y además Chrome es el único que garantiza que
 *    Sora e Inter se vean EXACTAMENTE como en el sitio, sin descargar nada.
 *
 *   node tools/generar-imagenes-planes.js             -> genera
 *   node tools/generar-imagenes-planes.js --solo 200  -> solo un plan (prueba)
 *
 * Los planes se leen de FIRESTORE (estado ACTIVO y precio > 0), que es lo que
 * el negocio vende de verdad: si cambia un precio en el panel, se vuelve a
 * correr esto y las imágenes quedan al día.
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const RAIZ = path.resolve(__dirname, "..");
const SALIDA = path.join(RAIZ, "assets", "img", "planes");
const TEMP_HTML = path.join(RAIZ, ".tmp-plan.html");

// Playwright vive en el proyecto de la web de Konfío Zinc; se carga por ruta
// absoluta para no tener que duplicar la dependencia en UneFibra.
const CANDIDATOS_PLAYWRIGHT = [
  path.join(RAIZ, "..", "Konfio-Zinc-Web", "herramientas", "node_modules", "playwright"),
  "playwright"
];

// Paleta REAL del sitio (assets/css/styles.css). Ojo: no es #004AAD.
const C = {
  bg: "#081a3a",
  bgSoft: "#0c2248",
  surface: "#10294f",
  line: "rgba(150, 175, 215, 0.16)",
  text: "#eaf2ff",
  muted: "#a6b7d8",
  cyan: "#00b0f0",
  violet: "#0060e0"
};

function cargarPlaywright() {
  for (const c of CANDIDATOS_PLAYWRIGHT) {
    try { return require(c); } catch (e) { /* siguiente */ }
  }
  throw new Error(
    "No se encontro Playwright. Instalalo en este proyecto con:\n" +
    "  cd " + RAIZ + " && npm install --no-save playwright\n" +
    "o deja el del proyecto Konfio-Zinc-Web/herramientas."
  );
}

function val(c) {
  const k = Object.keys(c)[0], v = c[k];
  if (k === "nullValue") return null;
  if (k === "integerValue") return Number(v);
  if (k === "booleanValue") return v;
  return v;
}

async function planesPublicos(tok) {
  const res = await fetch(`${BASE}/planes?pageSize=50`, { headers: { Authorization: "Bearer " + tok } });
  if (!res.ok) throw new Error("Firestore planes -> " + res.status);
  const d = await res.json();
  return (d.documents || []).map(doc => {
    const f = {};
    for (const [k, v] of Object.entries(doc.fields || {})) f[k] = val(v);
    return f;
  })
    // Solo lo que se vende: ACTIVO y con precio. Los planes de 0 pesos son
    // configuracion interna (50-90 Mbps) y no se publican.
    .filter(p => p.precio > 0 && String(p.estado || "ACTIVO") === "ACTIVO")
    .sort((a, b) => Number(a.precio) - Number(b.precio));
}

const pesos = (n) => "$" + Number(n).toLocaleString("es-CO");

/** HTML de la ficha de un plan (1080x1080). */
function html(plan) {
  const mbps = String(plan.velocidad || "").replace(/[^\d]/g, "");
  const desc = String(plan.descripcion || "").replace(/\.$/, "");
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<style>
  @font-face { font-family: "Sora"; src: url("assets/fonts/sora-latin-var.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
  @font-face { font-family: "Inter"; src: url("assets/fonts/inter-latin-var.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1080px; height: 1080px; overflow: hidden;
    background: ${C.bg};
    font-family: "Inter", sans-serif; color: ${C.text};
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  /* Resplandor de fibra: los mismos dos azules de la marca */
  .glow-c { position: absolute; width: 900px; height: 900px; border-radius: 50%;
    background: radial-gradient(circle, rgba(0,176,240,0.30) 0%, rgba(0,176,240,0) 65%);
    top: -320px; right: -260px; }
  .glow-v { position: absolute; width: 900px; height: 900px; border-radius: 50%;
    background: radial-gradient(circle, rgba(0,96,224,0.34) 0%, rgba(0,96,224,0) 65%);
    bottom: -340px; left: -280px; }
  .rejilla { position: absolute; inset: 0; opacity: 0.35;
    background-image: linear-gradient(rgba(150,175,215,0.10) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(150,175,215,0.10) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: radial-gradient(ellipse at center, black 25%, transparent 72%); }
  .tarjeta {
    position: relative; width: 880px; height: 880px; border-radius: 44px;
    background: linear-gradient(160deg, ${C.surface} 0%, ${C.bgSoft} 100%);
    border: 2px solid ${C.line};
    box-shadow: 0 40px 90px -30px rgba(0,0,0,0.75), 0 0 0 2px rgba(0,176,240,0.10);
    padding: 74px 78px; display: flex; flex-direction: column;
  }
  .logo { height: 88px; width: auto; align-self: flex-start; }
  .etiqueta { margin-top: 56px; font-size: 30px; letter-spacing: 5px;
    text-transform: uppercase; color: ${C.cyan}; font-weight: 600; }
  .nombre { margin-top: 14px; font-family: "Sora", sans-serif; font-weight: 800;
    font-size: 88px; line-height: 1.04; letter-spacing: -1.5px; }
  .velocidad { margin-top: 40px; display: flex; align-items: baseline; gap: 18px;
    font-family: "Sora", sans-serif; }
  .velocidad b { font-size: 168px; font-weight: 800; line-height: 1;
    background: linear-gradient(120deg, ${C.cyan} 0%, ${C.violet} 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .velocidad span { font-size: 54px; font-weight: 600; color: ${C.muted}; }
  .desc { margin-top: 34px; font-size: 34px; line-height: 1.4; color: ${C.muted}; max-width: 700px; }
  .pie { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; }
  .precio { font-family: "Sora", sans-serif; font-weight: 800; font-size: 76px; letter-spacing: -1px; }
  .precio small { display: block; font-family: "Inter", sans-serif; font-weight: 500;
    font-size: 28px; color: ${C.muted}; letter-spacing: 0; margin-top: 6px; }
  .sello { text-align: right; font-size: 26px; color: ${C.muted}; line-height: 1.5; }
  .sello b { color: ${C.text}; font-weight: 600; }
</style></head>
<body>
  <div class="glow-c"></div><div class="glow-v"></div><div class="rejilla"></div>
  <div class="tarjeta">
    <img class="logo" src="assets/img/logo.png" alt="UneFibra" />
    <div class="etiqueta">Plan de Internet</div>
    <div class="nombre">${plan.nombre || ""}</div>
    <div class="velocidad"><b>${mbps}</b><span>Mbps</span></div>
    ${desc ? `<div class="desc">${desc}.</div>` : ""}
    <div class="pie">
      <div class="precio">${pesos(plan.precio)}<small>por mes</small></div>
      <div class="sello"><b>100% fibra óptica</b><br />Medellín · sin permanencia</div>
    </div>
  </div>
</body></html>`;
}

(async () => {
  const solo = (process.argv.includes("--solo") ? process.argv[process.argv.indexOf("--solo") + 1] : null);
  const { chromium } = cargarPlaywright();
  const tok = await tokenAcceso();

  let planes = await planesPublicos(tok);
  if (solo) planes = planes.filter(p => String(p.velocidad).startsWith(solo));
  if (!planes.length) throw new Error("No hay planes publicos que generar.");

  fs.mkdirSync(SALIDA, { recursive: true });
  console.log("Planes a generar: " + planes.length);
  planes.forEach(p => console.log("  " + p.velocidad.padEnd(10) + " " + p.nombre.padEnd(22) + pesos(p.precio)));

  // Chrome instalado en la maquina: no hace falta descargar el de Playwright.
  const navegador = await chromium.launch({ channel: "chrome" });
  const pagina = await navegador.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });

  const generadas = [];
  for (const p of planes) {
    fs.writeFileSync(TEMP_HTML, html(p), "utf8");
    await pagina.goto("file:///" + TEMP_HTML.replace(/\\/g, "/"));
    // Espera a que las fuentes esten listas: sin esto Chrome puede capturar
    // con la tipografia de reserva y la imagen sale con otra letra.
    await pagina.evaluate(() => document.fonts.ready);
    // `fonts.ready` resuelve aunque una fuente FALLE, asi que se comprueba
    // aparte que Sora e Inter esten realmente disponibles.
    const fuentes = await pagina.evaluate(() => ({
      sora: document.fonts.check("800 88px Sora"),
      inter: document.fonts.check("400 34px Inter")
    }));
    if (!fuentes.sora || !fuentes.inter) {
      throw new Error("no cargaron las tipografias de marca (Sora=" + fuentes.sora + ", Inter=" + fuentes.inter + "): la imagen saldria con otra letra");
    }
    const archivo = path.join(SALIDA, String(p.velocidad).replace(/[^\d]/g, "") + ".jpg");
    await pagina.screenshot({ path: archivo, type: "jpeg", quality: 90 });
    generadas.push({ archivo, plan: p, kb: Math.round(fs.statSync(archivo).size / 1024) });
    console.log("  generada " + path.basename(archivo) + "  (" + generadas[generadas.length - 1].kb + " KB)");
  }

  await navegador.close();
  if (fs.existsSync(TEMP_HTML)) fs.rmSync(TEMP_HTML);

  console.log("\n--- RESULTADO ---");
  let grandes = 0;
  generadas.forEach(g => {
    const ok = g.kb <= 200;
    if (!ok) grandes++;
    console.log("  " + path.basename(g.archivo).padEnd(10) + String(g.kb).padStart(4) + " KB  " + (ok ? "OK" : "*** PASA DE 200 KB ***"));
  });
  console.log("  Carpeta: " + path.relative(RAIZ, SALIDA));
  if (grandes) console.log("  ATENCION: " + grandes + " imagen(es) pasan de 200 KB.");
})().catch(e => {
  if (fs.existsSync(TEMP_HTML)) { try { fs.rmSync(TEMP_HTML); } catch (x) {} }
  console.log("ERROR: " + e.message);
  process.exit(1);
});
