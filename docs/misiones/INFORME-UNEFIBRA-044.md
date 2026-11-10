# UNEFIBRA-044 — Cierre de reservas prepublicación

Fecha: 10-nov-2026. Proyecto: UneFibra SAS. Director: Darwin Montalvo — KONFÍO ZINC.

**Dictamen: GO. Las dos reservas técnicas de UNEFIBRA-043 quedan resueltas y probadas localmente. Publicar sigue requiriendo autorización expresa posterior.** No se ejecutó merge, push, Pages, Firebase ni ninguna operación comercial.

## Base, alcance y preservación

Rama conservada: `fix/unefibra-041-consistencia-comercial`. HEAD de entrada: `ab296b4666e97e0f61a3c8d265a95316cb20698e`. Paquete funcional anterior: `7e7e28a93285587e6700ee29412e9894ea5a08fd`. `main` local: `9ccbb85459189b9097e49daa05aade55b9f81d35`.

Se inspeccionaron Git, Service Worker, registro del worker en la landing, workflow y puntos de escritura del generador existente. No se reconstruyeron funciones comerciales. Se verificaron 40 archivos anteriores por SHA-256: paquete 041/042, ZIP, bundle, tres registros excluidos y Node portable. Todos permanecieron intactos. No se alteraron los dos commits previos ni se tocaron los cinco archivos originales sin seguimiento.

Esta misión agrega un commit local con los doce archivos enumerados abajo, incluido este informe; su identificador se comunica al cierre y se consulta con `git log -1 --format=%H -- docs/misiones/INFORME-UNEFIBRA-044.md`. No se introduce el hash del propio commit dentro de su contenido.

## 1. Service Worker

### Problema y cambio mínimo

La versión anterior `unefibras-v8` usa stale-while-revalidate para scripts y estilos: puede entregar primero archivos antiguos. Además, al activar borra todas las cachés de su origen salvo la actual, incluidas las de otras aplicaciones del mismo origen.

Se actualizó a **`unefibras-v9-041-042`**. Al activar, retira únicamente cachés anteriores cuyo nombre comienza con `unefibras-`. Las demás se conservan. Para rutas del panel (`admin/`), módulos compartidos (`assets/js/admin/`) y `assets/css/admin.css`, usa red con `cache: no-store`, sin leer ni escribir copias offline. Esas rutas ya no mezclan respuestas antiguas de Cache Storage o del caché HTTP una vez activado el nuevo worker.

Se mantiene el comportamiento anterior para el resto del sitio público. El worker solo procesa GET del mismo origen; Auth y Firestore externos no son interceptados. No se añaden accesos a cookies, localStorage, sessionStorage, IndexedDB o documentos administrativos. La limpieza de Cache Storage no elimina el almacenamiento de sesión de Firebase.

### Transición y límite de pestañas abiertas

Un worker nuevo no reemplaza el JavaScript que una pestaña ya ejecutó. No se fuerza recarga, cierre de sesión ni navegación, para no interrumpir formularios. Después de activarse el worker, la pestaña administrativa debe recargarse deliberadamente. No se promete que una petición atendida todavía por el worker anterior reciba el código nuevo.

Procedimiento futuro: terminar cualquier formulario pendiente, abrir/recargar la landing para actualizar el registro de `sw.js`, comprobar en Application → Service Workers que la versión nueva esté activada y recargar el panel. Comprobar en Cache Storage `unefibras-v9-041-042` y ausencia de `unefibras-v8`. El código real de registro sigue en `assets/js/main.js`, sin cambios. Una sesión que nunca instaló el worker obtiene los recursos directamente de red.

**Sin conexión, el panel falla de forma visible en lugar de entregar una copia antigua.** No se cambió la disponibilidad offline del resto de la landing.

### Prueba específica en Chromium

Con páginas y almacenamiento exclusivamente ficticios, un servidor HTTP de loopback y el worker real previo obtenido de Git, la prueba:

- Reprodujo contenido obsoleto en caché v8.
- Actualizó al worker nuevo y comprobó retiro de v8 y conservación de una caché ajena.
- Comprobó que no hubo navegación automática ni pérdida del borrador ficticio.
- Recargó de manera explícita y comparó byte a byte los cuatro módulos de pantalla, CSS y módulo comercial con el código actual de disco.
- Confirmó que las seis rutas administrativas no se almacenaron en caché y que un módulo nuevo respondió desde su primera petición.
- Conservó cookie, localStorage, sessionStorage e IndexedDB ficticios; no se inició sesión real de Firebase.
- Rechazó la entrega offline de una versión administrativa antigua.
- Probó reversión usando un identificador de caché nuevo (`unefibras-v10-reversion-qa`) sin perder la sesión ficticia.
- No realizó solicitudes externas ni cargó SDK productivo.

La prueba invoca `registration.update()` explícitamente para controlar el instante de transición; no certifica el tiempo que cada navegador o CDN tardará en detectar la publicación. Esa activación se verifica después de publicar, antes de usar el panel actualizado.

## 2. Pages y blog

### Comprobación pública efectuada

Se consultaron únicamente tres archivos estáticos públicos mediante GET desde `https://konfiozinc.github.io/unefibra/`: `blog/index.html`, `sitemap.xml` y `sw.js`. No se consultó Firestore ni datos personales. Se preservaron copias de los dos primeros en la carpeta de evidencia.

| Archivo | Comparación antes de los ajustes |
|---|---|
| `blog/index.html` | Diferente incluso normalizando CRLF. El archivo local agrega metadatos de marca/locale, favicon y crédito/enlace de privacidad que la versión pública no contiene. |
| `sitemap.xml` | Idéntico por SHA-256. No lista artículos del blog. |
| `sw.js` | Idéntico por SHA-256 a la versión v8 local previa. |

SHA-256 públicos aprobados:

- Blog: `d1fe2e132d8e4e3cf14ec0591d7c0cc4c8a06fb20f01e009209767ba8db68264`.
- Sitemap: `454e7802d7cfba06b3ade3c0ec9e73c5b598e231316e47bae8725ec98c416be7`.
- Worker previo: `76e9f8b2a96f4bc3ddbdc061532f6f8d44cb7ab7e6e517a557f28f49fef5db54`.

La referencia controlada contiene `blog/index.html` y `sitemap.xml`. El checkout contiene un único archivo bajo `blog/`; la página pública y sitemap consultados no anunciaron artículos. No se afirma haber enumerado URLs públicas huérfanas o el almacenamiento interno de GitHub Pages; no se accedió a ese almacenamiento.

### Qué regenera el generador existente

`tools/generar-blog.js` escribe `blog/index.html`, un `blog/<slug>/index.html` por artículo PUBLICADO, y `sitemap.xml`, donde retira y vuelve a insertar URLs de blog. Puede usar la fecha actual para lastmod. No limpia automáticamente carpetas antiguas. Cuando la lectura falla, genera un listado con aviso y actualiza sitemap sin artículos; su diseño permite terminar con código 0. No se modificó ese generador ni se ejecutó contra Firestore.

Se lo ejercitó en una raíz temporal con configuración y un artículo ficticios: produjo exactamente `blog/index.html`, `blog/articulo-ficticio/index.html` y `sitemap.xml`, sin red.

### Ejecución controlada preparada

En `.github/workflows/deploy.yml`:

1. Se conservan los eventos push a main, manual y programación diaria.
2. Se fija Node **22.23.4**, el runtime probado; no se cambia Node global ni el runtime productivo de Functions.
3. El generador se ejecuta **solo en el evento schedule**. Se conserva la actualización diaria previa, separada de esta publicación de panel.
4. Se prepara `_sitio` con la misma lista pública existente: ocho archivos raíz y las carpetas `assets`, `admin`, `blog`.
5. Para push o ejecución manual, `tools/preservar-blog-publicado.cjs --out=_sitio` obtiene únicamente blog y sitemap públicos, sin credenciales. Exige HTTP 200, sin redirecciones, verifica los dos SHA-256 aprobados y el inventario de archivos del blog. Solo después de verificar todas las respuestas escribe los bytes originales en el artefacto; **no sobrescribe las fuentes locales**.
6. Si hay un hash distinto, red no disponible, archivo ajeno o ruta inválida, la ejecución falla antes de subir/desplegar el artefacto. Este paso no tiene `continue-on-error`.
7. Se mantienen Configure Pages, Upload Pages Artifact y Deploy Pages.

Así, una publicación controlada conserva el blog público exactamente, en lugar de incorporar los cambios locales de marca o regenerarlo desde datos variables. La referencia aprobada está versionada en `tools/unefibra-blog-publicado.json`; si el blog cambia antes de publicar, el flujo se detendrá. Se debe volver a comparar y aprobar una referencia nueva, nunca desactivar la comprobación para forzar la publicación.

El programa solo admite como salida el directorio `_sitio` del repositorio donde se ejecuta, rechaza enlaces simbólicos/rutas ajenas y no borra archivos. Las descargas se verifican antes de modificar el artefacto. Las pruebas usan el mismo programa copiado a una raíz temporal con respuestas simuladas que contienen los bytes públicos aprobados.

La preparación es reproducible para esos bytes aprobados: entrega la misma referencia o falla; **no se afirma que todo el archivo comprimido de Pages sea binariamente idéntico entre ejecuciones**. La actualización programada sigue siendo dinámica, como antes, y puede modificar el blog independientemente de esta misión. Si ocurre antes de publicar y cambia la referencia, el control de hashes impedirá una publicación silenciosa.

## Archivos afectados: lista exacta

Código/configuración existentes modificados:

1. `sw.js` — versión, limpieza limitada y red sin caché para panel.
2. `.github/workflows/deploy.yml` — separación de generación/preservación y Node probado.

Archivos nuevos:

3. `tools/preservar-blog-publicado.cjs` — preparación controlada de blog/sitemap en artefacto.
4. `tools/unefibra-blog-publicado.json` — origen y hashes estáticos aprobados.
5. `tools/test-unefibra-044.cjs` — pruebas específicas reutilizables, sin producción.
6. `docs/evidencias/unefibra-044/blog-publicado.html` — captura pública original.
7. `docs/evidencias/unefibra-044/sitemap-publicado.xml` — captura pública original.
8. `docs/evidencias/unefibra-044/actualizacion-worker-ficticia.png` — evidencia visual sin datos reales.
9. `docs/evidencias/unefibra-044/pruebas-especificas.txt` — 40 PASS de pruebas específicas.
10. `docs/evidencias/unefibra-044/VERIFICACION-044.json` — hashes, comparación y preservación.
11. `docs/misiones/INFORME-UNEFIBRA-044.md` — este informe.
12. `.gitattributes` — dos reglas específicas que preservan los bytes de las capturas públicas HTML/XML en checkouts Windows/Linux. No alteran las reglas globales existentes.

No se modificaron fuentes `blog/index.html` o `sitemap.xml`, archivos funcionales 041/042, reglas, índices, Functions, configuración Firebase, credenciales o dependencias. Los doce archivos se incorporan mediante rutas explícitas; no se usa adición global de Git.

## Pruebas y evidencia

Runtime: Node portable 22.23.4. Navegador: Chromium 153.0.8010.12, Playwright existente. YAML validado con js-yaml ya instalado en `functions/node_modules`. Sin instalaciones adicionales.

| Validación final de UNEFIBRA-044 | PASS | FAIL |
|---|---:|---:|
| Pruebas específicas de worker, blog, generador ficticio y workflow | 40 | 0 |
| consistencia-comercial | 12 | 0 |
| revision-reglas-paridad | 8 | 0 |
| pagos-guardas | 20 | 0 |
| **Total** | **80** | **0** |

Además: sintaxis de worker y dos programas nuevos, YAML efectivo del workflow, `git diff --check`, conservación SHA-256 de 40 archivos anteriores. El paquete no incluye respaldos, Node portable, cachés, registros ajenos ni datos de clientes. Las capturas públicas contienen el sitio comercial público, no información personal de clientes.

Comando local específico, sin red externa:

```powershell
& './node_modules/.unefibra-042-node22/node-v22.23.4-win-x64/node.exe' --require ./tools/unefibra-041-network-guard.cjs tools/test-unefibra-044.cjs
```

El resultado de 511 comprobaciones de 042 sigue siendo histórico y no se suma al total de esta misión. No se repitieron auditorías generales ni emuladores.

## Publicación futura — preparada, NO EJECUTADA

1. Obtener autorización expresa de Darwin que incluya merge, push y despliegue. Verificar base remota y ausencia de conflictos; conservar todos los archivos locales excluidos. Registrar el commit/artefacto realmente publicado como punto de recuperación. Esta misión no hizo fetch ni verificó el HEAD remoto.
2. Integrar en un worktree separado como se describe en 043. Revisar que la diferencia corresponda exclusivamente a 041/042 y sus ajustes de entrega de 044. Repetir las pruebas pertinentes sobre la integración si hubo cambios.
3. Confirmar que la referencia pública del blog sigue coincidiendo. El flujo lo verificará nuevamente durante push/manual. Si no coincide, detenerse y renovar la referencia solo después de revisar y aprobar la diferencia.
4. Crear el commit de integración y hacer **un único push autorizado a main**. Dejar que el evento push ejecute el flujo controlado; no lanzar también una ejecución manual. No usar el evento schedule para publicar estas correcciones.
5. Exigir ejecución exitosa del paso de preservación y comprobar hashes de blog/sitemap dentro del artefacto. Verificar que el artefacto contiene los seis archivos comerciales, el worker nuevo y solo las rutas públicas permitidas; no `docs`, `tools`, `functions`, respaldos ni dependencias.
6. Después de desplegar, comparar blog y sitemap públicos con los SHA-256 aprobados. Verificar HTTP/contenido del worker y recursos administrativos. Confirmar activación del worker, recargar panel deliberadamente y comprobar escritorio/móvil y consola. No registrar pagos, editar planes ni cambiar estados para comprobar la publicación.
7. Darwin verifica su sesión autenticada sin generar capturas con datos personales. Si la red está desconectada, no usar el panel; el resto de la landing mantiene su estrategia offline.

## Reversión futura — preparada, NO EJECUTADA

- Si falla la comprobación del blog o el workflow antes de desplegar, la versión publicada permanece anterior: revisar el fallo sin forzar un nuevo deploy ni omitir hashes.
- Si se publica y aparecen fallos, conservar evidencia y el punto de recuperación. En un worktree de reversión, recuperar desde el commit productivo anterior los cinco archivos de interfaz anteriores a 041/042, manteniendo la entrega controlada del blog. No restaurar indiscriminadamente este árbol ni borrar registros/evidencias.
- Conservar la política de no servir caché administrativa y usar un identificador de caché nuevo y único, por ejemplo `unefibras-v10-reversion-041-042`. No volver a v8 ni reutilizar v9. El mecanismo fue probado localmente; la prueba no pretende certificar código remoto no consultado.
- Validar, crear el commit local de recuperación y publicar una sola vez únicamente con autorización. Verificar worker activo, recarga deliberada y hashes del blog. No revertir automáticamente todo 044: se perdería la protección que evita regeneraciones ajenas del blog.
- No hay reversión de Firebase, pagos o datos porque estas misiones no los modifican. `main` local y los commits previos se preservan; ningún historial se reescribe.

## Cierre

**GO técnico para solicitar publicación controlada de 041/042 + ajustes de entrega 044.** No quedan abiertas las dos reservas de 043. Se mantienen como condiciones operativas normales la autorización de Darwin, comprobación de base remota, activación del worker/recarga y coincidencia de hashes en el instante de publicar. Un cambio posterior del blog hace que el flujo falle de forma segura y exige revisión; no es autorización para incorporar contenido nuevo.

Se detiene el trabajo después del commit local y la verificación de Git. Sin merge, push, despliegues, escrituras reales, activación de servicios, cambios de precios, MikroTik o notificaciones.
