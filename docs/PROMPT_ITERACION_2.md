# PROMPT PARA DEEPSEEK HARNESS — Iteración 2 · Sitio UneFibra SAS

> **Cómo usarlo:** copia desde "INSTRUCCIÓN INICIAL" hasta el final y pégalo en
> DeepSeek Harness. Este documento es el estado verificado del proyecto y la
> lista de tareas pendientes reales (la iteración 1 ya está hecha y desplegada).

---

## INSTRUCCIÓN INICIAL

EJECUTA TODAS LAS INSTRUCCIONES DE ESTE PROMPT PARA CONTINUAR LA OPTIMIZACIÓN
DEL SITIO DE UNEFIBRA. Trabaja sobre el repositorio existente, haz commit y push
a `main`, y verifica el despliegue en vivo. No rehagas lo que ya está hecho
(sección 0) y respeta las restricciones de la sección 2.

- **Repositorio:** https://github.com/konfiozinc/unefibra
- **Sitio en vivo:** https://konfiozinc.github.io/unefibra/
- **Panel admin:** https://konfiozinc.github.io/unefibra/admin/
- **Carpeta local:** `C:\Users\PC\Documents\KONFIO_ZINC\4-Tarjetas Premium\unefibras`
- **Rama:** `main` (GitHub Pages despliega automáticamente con GitHub Actions)

---

## 0. ESTADO ACTUAL VERIFICADO — NO REHACER

La iteración 1 quedó implementada, desplegada y verificada (**62 comprobaciones
en navegador real, 0 fallas**). Ya está resuelto:

| Área | Estado |
|---|---|
| Formulario de contacto | ✅ Envía a WhatsApp **y** a Firestore, con validación (nombre, teléfono, barrio) y confirmación en pantalla |
| Enlaces de WhatsApp | ✅ Los 10 botones apuntan a `https://wa.me/573044654987` (generados por JS) |
| Mapa de Google | ✅ `<iframe>` embebido, centrado en El Cucaracho (Robledo) — **no tocar** |
| Teléfonos clicables | ✅ Detrás del botón "Llamar" (`tel:+573217490310`) |
| Datos de contacto expuestos | ✅ Ocultos: no hay teléfonos, correo ni dirección visibles ni en el HTML estático (solo en el JSON-LD, por SEO) |
| Obra social / prueba social | ✅ Sección de testimonios + garantías |
| CRM / gestor de leads | ✅ Módulo **Solicitudes** en el panel (`admin/solicitudes.html`) |
| Chatbot / chat en vivo | ✅ Agente IA con Gemini (chat flotante) + base para WhatsApp Business |
| Plan recomendado | ✅ `Familiar 150 Mbps` destacado (`plan-card--featured`) |
| Imagen OG | ✅ `assets/img/og-image.png` 1200×630 PNG, generada con `sharp` |
| Código QR | ✅ `assets/img/qr-whatsapp.png` (250×250, con el logo dentro, verificado por decodificación); generador en `tools/generar-qr.js` |
| Testimonios en cobertura | ✅ Robledo · Nuevo Occidente · Robledo |
| SEO | ✅ Título, meta descripción, canonical, JSON-LD (LocalBusiness + Product), `sitemap.xml` |
| Accesibilidad | ✅ Contraste WCAG AA verificado, `<label for>` en los 8 campos, `aria-label`, skip-link |
| Rendimiento | ✅ Fuentes autoalojadas (woff2), logo WebP, sin `document.write`, Service Worker |
| PWA | ✅ `manifest.json` + `sw.js` (caché `unefibras-v3`) |
| Panel admin en móvil | ✅ Menú hamburguesa (drawer), toques grandes, tablas con scroll táctil |
| Agente IA (Cloudflare) | ✅ Worker `unefibra-agente` desplegado (datos nuevos ya publicados) |

---

## 1. DATOS OFICIALES (fuente de verdad: `assets/js/config.js`)

| Dato | Valor |
|---|---|
| Nombre comercial / legal | `UneFibra` / `UneFibra SAS` |
| NIT | `9020925655` |
| WhatsApp (canal principal) | `304 465 4987` → `573044654987` |
| Teléfono de llamadas | `321 749 0310` |
| WhatsApp/teléfono anteriores | `302 858 9954` (conservados en config sin publicar) |
| Correo | `unefibrasas@gmail.com` |
| Dirección | `Calle 100 # 15-20, Medellín` (provisional) |
| Horario | Lunes a sábado, 8:00 a.m. – 6:00 p.m. |
| Planes (precios NO cambiar) | Básico 100 Mbps $50.000 · Familiar 150 Mbps $60.000 · Plus 200 Mbps $70.000 · Premium 250 Mbps $85.000 · Ultra 300 Mbps $100.000 |
| Cobertura | 22 sectores del occidente de Medellín (Robledo / Ciudadela Nuevo Occidente) |

**Reglas de marca:** siempre `UneFibra` (pegado, U y F mayúsculas) y
`UneFibra SAS` como nombre legal. Nunca variantes separadas, en plural ni en
mayúsculas sostenidas. Los identificadores técnicos `window.UNEFIBRAS_CONFIG`,
`unefibras-functions` y la caché `unefibras-v3` **no** se renombran.

**Datos de contacto ocultos:** los teléfonos, el correo y la dirección **no se
escriben nunca** en el HTML. Viven en `config.js` y `main.js → initContacto()`
los inyecta en los botones (`.js-tel`, `.js-mail`, `.js-mapa`, `.js-whatsapp`).

---

## 2. RESTRICCIONES DURAS (NO VIOLAR)

1. **NO eliminar ni modificar** la sección de cobertura ni el mapa de Google Maps.
2. **NO cambiar** los 5 planes, sus nombres ni sus precios.
3. **NO exponer** teléfonos, correo ni dirección como texto visible ni en
   `href="tel:"` / `href="mailto:"` del HTML estático (sí en el JSON-LD).
4. **NO inventar** datos empresariales, legales, de cobertura ni comerciales.
   Si falta un dato, déjalo con `// TODO: Reemplazar con dato real` y repórtalo.
5. **NO subir** al repositorio secretos, service accounts, tokens ni
   `CREDENCIALES.txt` (está en `.gitignore`).
6. **NO tocar** `agente-ia/` salvo para actualizar datos de contacto.
7. Mantener la paleta (navy `#081a3a` + cian `#00b0f0`) y el estilo visual actual.

---

## 3. TAREAS DE ESTA ITERACIÓN

### 3.1 Analytics y píxeles de conversión (requiere IDs del cliente)
- Preparar la integración de **Google Analytics 4** y **Meta Pixel** en
  `index.html`, con los IDs en `config.js` (`analytics.ga4Id`, `analytics.metaPixelId`).
- **No cargar los scripts si el ID está vacío** (evita peticiones fallidas).
- Añadir eventos: clic en CTA (`cta_click`), envío de formulario (`form_submit`)
  y apertura del QR (`qr_view`).
- **PENDIENTE DEL CLIENTE:** el ID `G-XXXXXXXXXX` de GA4 y el `PIXEL_ID` de Meta.
  Sin ellos, dejar el código inerte y avisar al usuario.

### 3.2 FAQ expandible (requiere respuestas validadas por el cliente)
- Crear una sección `#faq` con acordeón accesible (`<details>/<summary>`, como
  el listado de cobertura) y **FAQPage** en JSON-LD.
- Preguntas a incluir (⚠️ **necesitan respuesta oficial del cliente**; no inventar):
  1. ¿Qué diferencia hay entre cobre y fibra óptica?
  2. ¿Debo pagar la instalación?
  3. ¿Hay velocidad mínima garantizada?
  4. ¿Qué pasa si se daña la línea o hay una falla?
  5. ¿Puedo cambiar de plan?
  6. ¿Hay contrato de permanencia?
- Marcar cada respuesta no confirmada con `<!-- TODO: confirmar con el cliente -->`.

### 3.3 Validador de cobertura interactivo (modal)
- Botón "¿Tengo cobertura?" en el hero (CTA secundario) que abra un modal con:
  - Campo de sector con autocompletado usando `cobertura.zonas` (22 sectores).
  - Respuesta inmediata: **"Sí, tenemos cobertura"** → botón a WhatsApp con el
    sector en el mensaje; o **"Aún no llegamos"** → ofrecer dejar el correo o
    avisar por WhatsApp.
- Reutilizar el estilo de modal del panel (`.modal-backdrop`, `.modal`).
- Accesible: `role="dialog"`, `aria-modal`, foco atrapado, cierre con `Escape`.
- **No eliminar** la sección `#cobertura` con los chips ni el mapa.

### 3.4 Testimonios con avatar/foto
- Los testimonios hoy usan iniciales (MG, CP, AR). Si el cliente entrega fotos
  reales, reemplazar por `<img>` con `alt`, `width/height` y `loading="lazy"`.
- Si no hay fotos, mantener las iniciales (es una solución válida) y avisar.
- **No inventar** testimonios nuevos ni cifras ("+500 clientes", "desde 2020"):
  esas afirmaciones requieren confirmación del cliente.

### 3.5 Activación del backend Firebase (bloqueante para producción)
No se puede verificar desde el repo. Ejecutar y confirmar:
```bash
firebase login
cd "…/4-Tarjetas Premium/unefibras"
firebase use une-fibra
firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && cd ..
firebase deploy --only functions
```

### 3.6 Endurecimiento del formulario
- Activar **App Check / reCAPTCHA v3** (`config.js → appCheck`) para evitar spam.
- Alternativa ligera: campo honeypot + límite de envíos por sesión.

### 3.7 SEO local
- Añadir `robots.txt` (nota: en GitHub Pages de proyecto, `/unefibra/robots.txt`
  **no lo leen** los buscadores; documentarlo). Enviar `sitemap.xml` a Search
  Console y crear el Perfil de Empresa de Google.

### 3.8 Datos por confirmar con el cliente
- Dirección real · NIT (confirmado) · redes sociales (no existen aún) ·
  ortografía de "Sector Lusitania" · respuestas del FAQ.

---

## 4. VERIFICACIÓN OBLIGATORIA ANTES DE CERRAR

1. Servidor local + navegador headless (Chrome por CDP). Comprobar:
   - Sin errores de consola, de red ni respuestas HTTP ≥ 400.
   - Los enlaces de WhatsApp usan `573044654987`; "Llamar" usa `tel:+573217490310`;
     "Correo" usa `mailto:unefibrasas@gmail.com`.
   - **Ningún** teléfono, correo ni dirección visible en pantalla.
   - La sección de cobertura con sus 22 chips y el mapa siguen presentes e intactos.
   - Los 5 planes con sus nombres y precios exactos.
   - El QR carga (250×250) y **se decodifica** al enlace de WhatsApp.
   - Sin desbordamiento horizontal a 390 px; menú móvil funcional.
   - Contraste WCAG AA en los textos nuevos.
2. Tras el push: esperar el despliegue de GitHub Pages y repetir las
   comprobaciones contra la URL en vivo.
3. Si se toca `agente-ia/`: `npx wrangler deploy` (token en `.secrets/cf_token.txt`)
   y probar el worker respondiendo con los datos nuevos.

---

## 5. ENTREGA

Informe breve con: archivos modificados, comandos ejecutados, resultado de las
comprobaciones (OK / fallos), URLs verificadas, y lista de pendientes que
dependen del cliente. Commit y push a `main`.
