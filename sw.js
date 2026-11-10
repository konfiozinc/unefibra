/* ============================================================
 * UneFibra SAS — Service Worker (PWA)
 * Estrategia:
 *   · Navegaciones → network-first (con fallback a caché)
 *   · CSS/JS       → stale-while-revalidate (respuesta rápida y
 *                    actualización en segundo plano, para que un
 *                    despliegue nuevo no quede "congelado")
 *   · Imágenes/fuentes → cache-first
 *
 * El panel y sus módulos usan red sin caché desde UNEFIBRA-044.
 * Para el resto del sitio, el JS se sirve con stale-while-revalidate: tras
 * publicar un cambio en scripts públicos la PRIMERA carga entrega el archivo
 * viejo (y el nuevo entra en la siguiente). Para que un cambio se vea de una,
 * HAY QUE SUBIR `CACHE` (v7 → v8 …): al activarse, `activate` borra las cachés
 * anteriores del sitio. Las pestañas abiertas deben recargarse una vez
 * activado el nuevo worker; no se fuerza recarga ni se borra la sesión.
 * ============================================================ */

const CACHE = "unefibras-v9-041-042";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/css/styles.css",
  "./assets/css/agente.css",
  "./assets/js/config.js",
  "./assets/js/main.js",
  "./assets/icons/icon-192.png",
  "./assets/img/logo.png",
  "./assets/img/logo.webp",
  "./assets/fonts/inter-latin-var.woff2",
  "./assets/fonts/sora-latin-var.woff2",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("unefibras-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Solo gestionar peticiones del mismo origen
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // UNEFIBRA-044: el panel requiere archivos actuales y no usa caché offline.
  // No se interceptan servicios externos de Auth/Firestore ni sus almacenes.
  const base = new URL(".", self.location.href).pathname;
  const ruta = url.pathname.slice(base.length);
  if (url.pathname.startsWith(base) && (ruta.startsWith("admin/")
    || ruta.startsWith("assets/js/admin/") || ruta === "assets/css/admin.css")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Navegaciones: network-first con fallback a caché
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Estilos y scripts: stale-while-revalidate
  if (request.destination === "style" || request.destination === "script") {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const red = fetch(request)
            .then((res) => {
              if (res && res.status === 200) cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || red;
        })
      )
    );
    return;
  }

  // Resto de estáticos (imágenes, fuentes): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      });
    })
  );
});
