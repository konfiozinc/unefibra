# Informe — Iteración 2 · Sitio UneFibra SAS

**Rama:** `main` · **Commits:** `3ad096d` → `7337df6`
**Sitio:** https://konfiozinc.github.io/unefibra/

---

## 1. Auditoría inicial (hallazgos reales)

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | Las **tarjetas de planes se generaban solo con JavaScript** (`#planes-container` vacío en el HTML estático): un rastreador sin JS no veía ningún plan. | 🔴 Crítico (SEO/conversión) | ✅ Corregido |
| 2 | No existía **verificador de cobertura** (solo la lista de sectores). | 🔴 Alto (conversión) | ✅ Implementado |
| 3 | No existía **FAQ** ni `FAQPage`. | 🟠 Medio | ✅ Implementado |
| 4 | No existía **robots.txt**. | 🟠 Medio | ✅ Creado |
| 5 | Sin **protección anti-spam** en el formulario. | 🟠 Medio | ✅ Honeypot |
| 6 | Sin preparación de **analytics/eventos**. | 🟠 Medio | ✅ Inerte |
| 7 | El remoto de Git había **perdido el token** de push. | 🟠 Medio | ✅ Reconfigurado |

> Nota: algunas afirmaciones del prompt de auditoría (planes invisibles, ausencia
> de testimonios/garantías/sectores, promesas de "48 h"/"24/7") **no coincidían**
> con el repositorio real: la iteración 1 ya incluía testimonios, garantías con
> esas promesas confirmadas, 22 sectores y QR. El único punto realmente abierto
> de esa lista era el **renderizado de planes por JavaScript**.

## 2. Implementado en esta iteración

### 2.1 Planes estáticos (crítico)
Los 5 planes (Básico 100 · Familiar 150 · Plus 200 · Premium 250 · Ultra 300)
quedaron **escritos en el HTML**, con nombre, precio, beneficios y CTA.
`main.js` los sigue re-renderizando desde `config.js`.
⚠️ **Si cambias un precio en `config.js`, replica el cambio en `index.html`.**

### 2.2 Verificador de cobertura (tarea 3.3)
- CTA secundario en el hero: **«¿Tengo cobertura?»**.
- Modal accesible (`role="dialog"`, `aria-modal`, cierre con `Escape` y clic en fondo).
- Autocompletado con los **22 sectores** de `config.js → cobertura.zonas`.
- Resultados: 🟢 *cobertura registrada* → WhatsApp con el sector ·
  🟡 *sin registro* → verificar con el equipo.
- Comparación **sin tildes ni mayúsculas**. Es un orientador, no un diagnóstico.

### 2.3 FAQ + FAQPage (tarea 3.2)
7 preguntas en acordeón `<details>/<summary>` (accesible, sin JS) + `FAQPage` en
JSON-LD. Las respuestas se apoyan en las **Garantías confirmadas** (sin
permanencia, soporte por WhatsApp); las que faltan llevan
`<!-- TODO: confirmar con el cliente -->`.

### 2.4 Honeypot anti-spam (tarea 3.6)
Campo oculto `website`; si un bot lo rellena, el envío se **descarta en silencio**
(no llega a WhatsApp ni a Firestore).

### 2.5 Analytics inerte (tarea 3.1)
`config.js → analytics { ga4Id, metaPixelId }`. Con los IDs **vacíos no se carga
ningún script externo**. Eventos listos: `cta_click`, `form_submit`, `qr_view`,
`plan_select` (vía `window.ufTrack`).

### 2.6 Extras solicitados por el cliente
- **Comparador de planes** (tabla responsive con scroll y `role="region"`).
- **«Internet para…»**: Hogar · Teletrabajo · Gaming · Entretenimiento.
- **Recomendador de velocidad**: 3 preguntas → sugiere un plan real + WhatsApp.
  Marcado como *orientación comercial*, no diagnóstico técnico.

### 2.7 SEO
- `robots.txt` (con la nota de que en GitHub Pages de proyecto no se lee).
- `FAQPage` en JSON-LD, enlace «Preguntas» en el menú.

## 3. QA ejecutado
| Prueba | Resultado |
|---|---|
| `node --check main.js` / `config.js` | ✅ Sin errores de sintaxis |
| Elementos nuevos en el DOM | ✅ 9/9 encontrados |
| Restricciones (planes, precios, cobertura, mapa, paleta) | ✅ Intactas |
| Datos sensibles fuera del HTML estático | ✅ Solo en `config.js` y JSON-LD |
| Commit + push a `main` | ✅ `7337df6` |

## 4. Pendientes que dependen del cliente
1. **Respuestas oficiales del FAQ** (instalación: ¿tiene costo? · ¿velocidad mínima garantizada? · ¿procedimiento de cambio de plan?).
2. **IDs de Analytics** (GA4 y Meta Pixel).
3. **Fotos reales** de los testimonios (hoy usan iniciales, válido).
4. **Dirección real** (hoy provisional) · **redes sociales** (no existen).
5. **Ortografía de "Sector Lusitania"**.
6. **Search Console + Perfil de Empresa de Google**.
7. **App Check / reCAPTCHA v3** (requiere site key).

## 5. Cómo publicar
Push a `main` → GitHub Actions (`.github/workflows/deploy.yml`) publica en
GitHub Pages. Verificar en la URL en vivo tras ~1 minuto (recarga con `Ctrl+Shift+R`).
