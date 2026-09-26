#!/usr/bin/env node
/* ============================================================
 * UneFibra SAS — Generador del blog estático
 * ------------------------------------------------------------
 * POR QUÉ EXISTE
 * Un blog que se pinta con JavaScript en el navegador NO lo indexa
 * Google: cada artículo tiene que ser una página HTML real. Este
 * script toma los artículos publicados en Firestore y escribe HTML
 * de verdad:
 *
 *   blog/index.html          → listado de artículos
 *   blog/<slug>/index.html   → cada artículo, con JSON-LD BlogPosting
 *
 * Además inserta las URLs del blog en sitemap.xml.
 *
 * CÓMO SE EJECUTA
 *   · En cada despliegue: .github/workflows/deploy.yml (y a diario)
 *   · A mano:             node tools/generar-blog.js
 *   · Pruebas sin red:    node tools/generar-blog.js --fixture=f.json --out=.tmp
 *
 * LECTURA DE FIRESTORE
 * Los artículos publicados son de lectura pública (ver firestore.rules), así
 * que se leen por la API REST con la API key web del proyecto, que YA es
 * pública (vive en assets/js/config.js). No se usa ninguna credencial
 * administrativa ni cuenta de servicio: nada que filtrar.
 * Se usa runQuery con filtro por `estado` porque las reglas solo autorizan
 * consultas filtradas a quien no tiene sesión.
 *
 * RESILIENCIA
 * Este script NUNCA debe romper un despliegue: si la lectura falla, lo
 * registra, deja el listado con un aviso honesto y sale con código 0. Así el
 * enlace "Blog" del sitio nunca apunta a una página inexistente.
 * ============================================================ */

"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");

// ---------------- Argumentos ----------------
const args = process.argv.slice(2);
function opcion(nombre) {
  const encontrado = args.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : null;
}

const FIXTURE = opcion("fixture");          // JSON local en vez de Firestore
const OUT = path.resolve(RAIZ, opcion("out") || ".");
const SILENCIOSO = args.includes("--silencioso");

function log(msg) {
  if (!SILENCIOSO) console.log(msg);
}

// ---------------- Utilidades de texto ----------------
function escapar(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON para incrustar dentro de <script type="application/ld+json">.
// JSON.stringify NO escapa "<", así que un artículo que contenga "</script>"
// cerraría el bloque antes de tiempo y lo que venga después se interpretaría
// como HTML: es una vía real de inyección. Se escapan "<", ">" y "&" con
// secuencias unicode, que siguen siendo JSON válido y los buscadores decodifican
// exactamente igual.
function jsonSeguro(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function aSlug(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function fechaLegible(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${Number(m[3])} de ${meses[Number(m[2]) - 1]} de ${m[1]}`;
}

// Marcado sencillo → HTML. Se escapa SIEMPRE antes de aplicar el formato, para
// que un artículo nunca pueda inyectar etiquetas ni scripts.
function enLinea(texto) {
  return texto
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

function markdown(texto) {
  const lineas = String(texto || "").replace(/\r\n/g, "\n").split("\n");
  const salida = [];
  let lista = null;
  let parrafo = [];

  const cerrarParrafo = () => {
    if (parrafo.length) {
      salida.push("<p>" + enLinea(escapar(parrafo.join(" "))) + "</p>");
      parrafo = [];
    }
  };
  const cerrarLista = () => {
    if (lista) { salida.push(`</${lista}>`); lista = null; }
  };

  for (const cruda of lineas) {
    const l = cruda.trim();

    if (!l) { cerrarParrafo(); cerrarLista(); continue; }

    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      cerrarParrafo(); cerrarLista();
      const nivel = Math.min(Math.max(m[1].length, 2), 4);
      salida.push(`<h${nivel}>${enLinea(escapar(m[2]))}</h${nivel}>`);
      continue;
    }
    if ((m = l.match(/^[-*]\s+(.*)$/))) {
      cerrarParrafo();
      if (lista !== "ul") { cerrarLista(); salida.push("<ul>"); lista = "ul"; }
      salida.push(`<li>${enLinea(escapar(m[1]))}</li>`);
      continue;
    }
    if ((m = l.match(/^\d+[.)]\s+(.*)$/))) {
      cerrarParrafo();
      if (lista !== "ol") { cerrarLista(); salida.push("<ol>"); lista = "ol"; }
      salida.push(`<li>${enLinea(escapar(m[1]))}</li>`);
      continue;
    }

    cerrarLista();
    parrafo.push(l);
  }

  cerrarParrafo();
  cerrarLista();
  return salida.join("\n");
}

// ---------------- Configuración del sitio ----------------
function cargarConfig() {
  const ruta = path.join(RAIZ, "assets", "js", "config.js");
  const src = fs.readFileSync(ruta, "utf8");
  // config.js es un script de navegador: asigna window.UNEFIBRAS_CONFIG.
  const falsoWindow = {};
  new Function("window", "document", src)(falsoWindow, {});
  if (!falsoWindow.UNEFIBRAS_CONFIG) {
    throw new Error("config.js no definió window.UNEFIBRAS_CONFIG");
  }
  return falsoWindow.UNEFIBRAS_CONFIG;
}

// ---------------- Lectura de Firestore (REST) ----------------
// Convierte los tipos "tipados" de la API REST a valores de JavaScript.
function valorFirestore(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valorFirestore);
  if ("mapValue" in v) return camposFirestore(v.mapValue.fields);
  return null;
}

function camposFirestore(fields) {
  const salida = {};
  for (const [clave, v] of Object.entries(fields || {})) salida[clave] = valorFirestore(v);
  return salida;
}

function normalizar(respuesta) {
  const docs = [];
  for (const fila of Array.isArray(respuesta) ? respuesta : []) {
    const doc = fila && fila.document;
    if (!doc || !doc.fields) continue;
    const datos = camposFirestore(doc.fields);
    datos.id = String(doc.name || "").split("/").pop();
    docs.push(datos);
  }
  return docs;
}

async function leerPublicados(cfg) {
  if (FIXTURE) {
    log(`  Fuente: archivo local ${path.relative(RAIZ, FIXTURE)} (modo prueba)`);
    return normalizar(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));
  }

  const conf = (cfg.firebase && cfg.firebase.config) || {};
  const proyecto = conf.projectId;
  const apiKey = conf.apiKey;
  if (!proyecto || !apiKey) throw new Error("Falta firebase.config en config.js");

  const url = `https://firestore.googleapis.com/v1/projects/${proyecto}` +
    `/databases/(default)/documents:runQuery?key=${apiKey}`;

  // El filtro por `estado` no es opcional: las reglas solo dejan leer a quien
  // no tiene sesión si la consulta está filtrada por artículos publicados.
  const consulta = {
    structuredQuery: {
      from: [{ collectionId: "posts" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "estado" },
          op: "EQUAL",
          value: { stringValue: "PUBLICADO" }
        }
      }
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(consulta)
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`Firestore respondió ${res.status}: ${detalle.slice(0, 300)}`);
  }

  log(`  Fuente: Firestore (proyecto ${proyecto}), solo artículos PUBLICADO`);
  return normalizar(await res.json());
}

// Ordena por fecha descendente y garantiza slug único.
function preparar(docs) {
  const usados = new Set();
  return docs
    .filter((d) => d && d.estado === "PUBLICADO" && String(d.titulo || "").trim())
    .map((d) => {
      let slug = aSlug(d.slug || d.titulo);
      if (!slug) slug = "articulo";
      let final = slug;
      let n = 2;
      while (usados.has(final)) { final = `${slug}-${n}`; n++; }
      usados.add(final);
      return {
        titulo: String(d.titulo).trim(),
        slug: final,
        resumen: String(d.resumen || "").trim(),
        contenido: String(d.contenido || ""),
        etiquetas: Array.isArray(d.etiquetas) ? d.etiquetas.filter(Boolean) : [],
        imagen: d.imagen || "",
        fecha: String(d.fecha || "").slice(0, 10) || String(d.createdAt || "").slice(0, 10)
      };
    })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ---------------- Plantillas ----------------
const ESTILOS_BLOG = `
  .blog-top { border-bottom: 1px solid var(--line); background: var(--bg-soft); }
  .blog-top__in { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; }
  .blog-top__marca { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-weight: 800; color: var(--text); }
  .blog-top__marca img { height: 32px; width: auto; }
  .blog-wrap { max-width: 780px; margin: 0 auto; padding: 40px 20px 64px; }
  .blog-h1 { font-family: var(--font-display); font-size: clamp(1.7rem, 5vw, 2.5rem); line-height: 1.15; }
  .blog-intro { color: var(--text-muted); margin-top: 12px; font-size: 1.03rem; }
  .blog-meta { color: var(--text-muted); font-size: 0.9rem; margin-top: 10px; }
  .blog-etiquetas { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .blog-etiqueta { font-size: 0.78rem; color: var(--cyan); background: rgba(0,176,240,0.08); padding: 4px 10px; border-radius: 999px; }
  .blog-lista { display: grid; gap: 16px; margin-top: 30px; }
  .blog-item { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); padding: 20px; }
  .blog-item h2 { font-family: var(--font-display); font-size: 1.25rem; line-height: 1.25; }
  .blog-item h2 a { color: var(--text); }
  .blog-item h2 a:hover { color: var(--cyan); }
  .blog-item p { color: var(--text-muted); margin-top: 8px; font-size: 0.95rem; }
  .blog-articulo { font-size: 1.02rem; line-height: 1.75; }
  .blog-articulo h2 { font-family: var(--font-display); font-size: 1.5rem; margin: 34px 0 10px; }
  .blog-articulo h3 { font-family: var(--font-display); font-size: 1.2rem; margin: 26px 0 8px; }
  .blog-articulo h4 { font-family: var(--font-display); font-size: 1.05rem; margin: 22px 0 6px; }
  .blog-articulo p { margin: 14px 0; color: #dbe6f7; }
  .blog-articulo ul, .blog-articulo ol { margin: 14px 0 14px 22px; color: #dbe6f7; }
  .blog-articulo li { margin: 6px 0; }
  .blog-articulo a { color: var(--cyan); text-decoration: underline; }
  .blog-articulo strong { color: var(--text); }
  .blog-lead { font-size: 1.1rem; color: var(--text); border-left: 3px solid var(--cyan); padding-left: 14px; margin: 18px 0 26px; }
  .blog-vacio { border: 1px dashed var(--line); border-radius: var(--radius); padding: 24px; color: var(--text-muted); margin-top: 26px; }
  .blog-cta { margin-top: 40px; padding: 22px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
  .blog-cta h2 { font-family: var(--font-display); font-size: 1.2rem; }
  .blog-cta p { color: var(--text-muted); margin: 8px 0 16px; }
  .blog-foot { border-top: 1px solid var(--line); padding: 26px 0; color: var(--text-muted); font-size: 0.9rem; }
  .blog-foot a { color: var(--cyan); }
`;

function plantilla(cfg, o) {
  const seo = cfg.seo || {};
  const emp = cfg.empresa || {};
  const pref = o.pref;
  const jsonLd = o.jsonLd
    ? `\n  <script type="application/ld+json">\n${jsonSeguro(o.jsonLd)}\n  </script>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapar(o.titulo)}</title>
  <meta name="description" content="${escapar(o.descripcion)}" />
${o.robots ? `  <meta name="robots" content="${escapar(o.robots)}" />\n` : ""}  <link rel="canonical" href="${escapar(o.canonical)}" />
  <meta property="og:type" content="${o.tipo || "website"}" />
  <meta property="og:title" content="${escapar(o.titulo)}" />
  <meta property="og:description" content="${escapar(o.descripcion)}" />
  <meta property="og:url" content="${escapar(o.canonical)}" />
  <meta property="og:image" content="${escapar(seo.imagen || "")}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="${pref}assets/icons/favicon.png" type="image/png" />
  <link rel="stylesheet" href="${pref}assets/css/styles.css" />
  <style>${ESTILOS_BLOG}</style>${jsonLd}
</head>
<body>
  <header class="blog-top">
    <div class="container blog-top__in">
      <a class="blog-top__marca" href="${pref}">
        <img src="${pref}assets/img/logo.png" alt="${escapar(emp.nombre || "UneFibra")}" width="120" height="56" />
        <span>Blog</span>
      </a>
      <a class="btn btn--primary" href="${pref}#contacto">Quiero Internet</a>
    </div>
  </header>

  <main class="blog-wrap">
${o.contenido}
  </main>

  <footer class="blog-foot">
    <div class="container">
      <p>${escapar(emp.nombreLegal || emp.nombre || "UneFibra")}${emp.nit ? ` — NIT ${escapar(emp.nit)}` : ""}</p>
      <p><a href="${pref}">Volver al inicio</a> · <a href="${pref}#planes">Ver planes</a> · <a href="blog/">Todos los artículos</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

function paginaListado(cfg, posts, estado) {
  const seo = cfg.seo || {};
  const base = (seo.url || "").replace(/\/?$/, "/");
  const pref = "../";

  let contenido;
  if (estado === "error") {
    contenido = `    <h1 class="blog-h1">Blog de UneFibra</h1>
    <p class="blog-intro">Estamos actualizando esta sección.</p>
    <div class="blog-vacio">
      No pudimos cargar los artículos en este momento. Vuelve a intentarlo más tarde
      o <a href="${pref}#contacto">escríbenos</a> si necesitas información ahora.
    </div>`;
  } else if (!posts.length) {
    contenido = `    <h1 class="blog-h1">Blog de UneFibra</h1>
    <p class="blog-intro">Aquí publicaremos guías sobre fibra óptica, cobertura y rendimiento de tu conexión.</p>
    <div class="blog-vacio">
      Todavía no hemos publicado artículos. Estamos preparando el primero:
      mientras tanto, puedes <a href="${pref}#planes">ver los planes</a> o
      <a href="${pref}#contacto">consultar la cobertura en tu sector</a>.
    </div>`;
  } else {
    const items = posts.map((p) => `      <article class="blog-item">
        <h2><a href="${p.slug}/">${escapar(p.titulo)}</a></h2>
        ${p.fecha ? `<p class="blog-meta">${escapar(fechaLegible(p.fecha))}</p>` : ""}
        ${p.resumen ? `<p>${escapar(p.resumen)}</p>` : ""}
      </article>`).join("\n");

    contenido = `    <h1 class="blog-h1">Blog de UneFibra</h1>
    <p class="blog-intro">Guías sobre fibra óptica, cobertura y rendimiento de tu conexión en Medellín.</p>
    <div class="blog-lista">
${items}
    </div>`;
  }

  const jsonLd = posts.length
    ? {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Blog de UneFibra",
        url: base + "blog/",
        inLanguage: "es-CO",
        publisher: {
          "@type": "Organization",
          name: (cfg.empresa && cfg.empresa.nombreLegal) || "UneFibra SAS"
        },
        blogPost: posts.map((p) => ({
          "@type": "BlogPosting",
          headline: p.titulo,
          url: base + "blog/" + p.slug + "/",
          datePublished: p.fecha || undefined
        }))
      }
    : null;

  return plantilla(cfg, {
    pref,
    titulo: posts.length ? "Blog | UneFibra SAS" : "Blog | UneFibra SAS",
    descripcion: "Guías y artículos sobre Internet por fibra óptica, cobertura y rendimiento de la conexión en Medellín.",
    canonical: base + "blog/",
    // Un listado vacío o con error no debe indexarse: sería una página pobre.
    robots: posts.length ? null : "noindex, follow",
    jsonLd,
    contenido
  });
}

function paginaArticulo(cfg, p, todos) {
  const seo = cfg.seo || {};
  const emp = cfg.empresa || {};
  const base = (seo.url || "").replace(/\/?$/, "/");
  const pref = "../../";
  const url = base + "blog/" + p.slug + "/";

  const etiquetas = p.etiquetas.length
    ? `    <div class="blog-etiquetas">${p.etiquetas
        .map((e) => `<span class="blog-etiqueta">${escapar(e)}</span>`).join("")}</div>\n`
    : "";

  const contenido = `    <article class="blog-articulo">
      <h1 class="blog-h1">${escapar(p.titulo)}</h1>
      ${p.fecha ? `<p class="blog-meta">${escapar(fechaLegible(p.fecha))}</p>` : ""}
${etiquetas}      ${p.resumen ? `<p class="blog-lead">${escapar(p.resumen)}</p>` : ""}
      ${markdown(p.contenido)}
    </article>

    <div class="blog-cta">
      <h2>¿Quieres fibra óptica en tu casa?</h2>
      <p>Consulta si llegamos a tu sector y conoce los planes disponibles.</p>
      <a class="btn btn--primary" href="${pref}#contacto">Verificar cobertura</a>
    </div>

    <p class="blog-meta"><a href="../">← Volver a todos los artículos</a></p>`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.titulo,
    description: p.resumen || undefined,
    datePublished: p.fecha || undefined,
    dateModified: p.fecha || undefined,
    inLanguage: "es-CO",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: {
      "@type": "Organization",
      name: emp.nombreLegal || "UneFibra SAS",
      url: base
    },
    publisher: {
      "@type": "Organization",
      name: emp.nombreLegal || "UneFibra SAS",
      logo: { "@type": "ImageObject", url: (seo.imagen || "") }
    }
  };
  if (p.imagen) jsonLd.image = [p.imagen];

  return plantilla(cfg, {
    pref,
    titulo: `${p.titulo} | Blog de UneFibra`,
    descripcion: p.resumen || p.titulo,
    canonical: url,
    tipo: "article",
    jsonLd,
    contenido
  });
}

// ---------------- Sitemap ----------------
function entradaSitemap(loc, lastmod, changefreq, priority) {
  return `  <url>
    <loc>${escapar(loc)}</loc>
    <lastmod>${escapar(lastmod)}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function actualizarSitemap(cfg, posts) {
  const destino = path.join(OUT, "sitemap.xml");
  const origen = fs.existsSync(destino) ? destino : path.join(RAIZ, "sitemap.xml");
  let xml = fs.existsSync(origen) ? fs.readFileSync(origen, "utf8") : "";

  if (!xml.includes("<urlset")) {
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`;
  }

  // Idempotente: se retiran las URLs del blog ya presentes y se reinsertan.
  xml = xml.replace(/\s*<url>\s*<loc>[^<]*\/blog\/[^<]*<\/loc>[\s\S]*?<\/url>/g, "");

  if (posts.length) {
    const base = (cfg.seo && cfg.seo.url ? cfg.seo.url : "").replace(/\/?$/, "/");
    const hoy = new Date().toISOString().slice(0, 10);
    const nuevas = [
      entradaSitemap(base + "blog/", hoy, "weekly", "0.7"),
      ...posts.map((p) => entradaSitemap(base + "blog/" + p.slug + "/", p.fecha || hoy, "monthly", "0.6"))
    ].join("\n");
    xml = xml.replace("</urlset>", nuevas + "\n</urlset>");
  }

  fs.writeFileSync(destino, xml, "utf8");
  return path.relative(OUT, destino) || "sitemap.xml";
}

// Último recurso: una página mínima que NO depende de config.js ni de
// Firestore. Existe para que el enlace "Blog" del sitio nunca lleve a un 404,
// pase lo que pase durante el despliegue.
function paginaMinima() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog | UneFibra SAS</title>
  <meta name="robots" content="noindex, follow" />
  <link rel="stylesheet" href="../assets/css/styles.css" />
  <style>${ESTILOS_BLOG}</style>
</head>
<body>
  <main class="blog-wrap">
    <h1 class="blog-h1">Blog de UneFibra</h1>
    <div class="blog-vacio">
      El blog no está disponible en este momento. Puedes <a href="../">volver al inicio</a>
      o <a href="../#contacto">escribirnos</a> mientras lo reparamos.
    </div>
  </main>
</body>
</html>
`;
}

// ---------------- Programa principal ----------------
async function main() {
  log("Blog de UneFibra — generación de HTML estático");

  const cfg = cargarConfig();
  let posts = [];
  let estado = "ok";

  try {
    posts = preparar(await leerPublicados(cfg));
    log(`  Artículos publicados encontrados: ${posts.length}`);
  } catch (err) {
    // No se rompe el despliegue: se avisa y el listado queda con un texto honesto.
    estado = "error";
    console.error("  AVISO: no se pudieron leer los artículos: " + err.message);
    console.error("  Se generará el listado con un aviso; el resto del sitio no se toca.");
  }

  const dirListado = path.join(OUT, "blog");
  fs.mkdirSync(dirListado, { recursive: true });
  fs.writeFileSync(path.join(dirListado, "index.html"), paginaListado(cfg, posts, estado), "utf8");

  let escritos = 1;
  if (estado === "ok") {
    for (const p of posts) {
      const dir = path.join(dirListado, p.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "index.html"), paginaArticulo(cfg, p, posts), "utf8");
      escritos++;
    }
  }

  const sitemap = actualizarSitemap(cfg, estado === "ok" ? posts : []);

  for (const p of posts) log(`  · blog/${p.slug}/index.html  → ${p.titulo}`);
  log(`  Archivos escritos: ${escritos} (+ ${sitemap})`);
  log(estado === "ok" ? "  Listo." : "  Listo con avisos (ver arriba).");
}

main().catch((err) => {
  // Último cortafuegos: un fallo inesperado tampoco debe tumbar el despliegue
  // ni dejar el enlace del blog apuntando a una página que no existe.
  console.error("Blog: fallo inesperado: " + (err && err.stack ? err.stack : err));
  try {
    const dir = path.join(OUT, "blog");
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, "index.html");
    if (!fs.existsSync(destino)) {
      fs.writeFileSync(destino, paginaMinima(), "utf8");
      console.error("  Se escribió un listado mínimo para no dejar un enlace roto.");
    }
  } catch (err2) {
    console.error("  Tampoco se pudo escribir el listado mínimo: " + err2.message);
  }
  process.exitCode = 0;
});
