# Datos pendientes del cliente — UneFibra SAS

> Revisado contra el código real (no contra notas anteriores).
> Cada punto indica el archivo y el campo exactos donde entra la respuesta.

## Cómo usar este documento

| Parte | Para qué |
|---|---|
| **0** | Lo urgente: dos afirmaciones publicadas que no están confirmadas |
| **1** | Mensaje listo para copiar y enviar al cliente |
| **2** | Anexo técnico: qué se hace con cada respuesta |
| **3** | Decisiones que NO dependen del cliente, pero hay que tomarlas |
| **4** | Lo ya confirmado (para no volver a preguntarlo) |

---

## Parte 0 — Urgente: dos afirmaciones publicadas sin confirmar

### 0.1 La instalación: la web se contradice a sí misma

| Dónde | Qué dice | Quién lo ve |
|---|---|---|
| Planes (texto para navegadores sin JS) | «Todos los planes **incluyen** instalación y soporte» | Los buscadores y quien navegue sin JS |
| Garantías | «**Instalación en 48 horas**» | Todos los visitantes |
| Ficha del producto (datos para Google) | «…con instalación en el hogar y sin contratos de permanencia» | Google |
| FAQ «¿Debo pagar la instalación?» | «Escríbenos y **te confirmamos las condiciones** según tu sector» | Todos los visitantes |
| Código | `<!-- TODO: confirmar con el cliente si la instalación tiene costo y si incluye equipo/router -->` | — |

El problema no es la palabra «instalación»: es que **«incluyen» significa que no se cobra aparte**, y la FAQ responde con evasivas a esa misma pregunta. Las dos cosas no pueden ser verdad al mismo tiempo.

- Si **se cobra**: la web está prometiendo gratis algo que se cobra, y quien reclame tendrá razón.
- Si **es gratis**: la FAQ está esquivando una pregunta que ya tiene respuesta, y se pierde una ventaja comercial fuerte.

### 0.2 «Instalación también para reportados» — repetida 6 veces, y sin confirmar

Aparece en la página **6 veces** (una en la sección de beneficios y una en cada una de las 5 tarjetas de plan).

En `config.js`, el comentario que respalda los planes dice literalmente: *«nombres y precios confirmados por el cliente»*. Los beneficios del plan **no** figuran como confirmados. Es decir: la web está afirmando que instalan a personas reportadas en centrales de riesgo, y ese dato nunca se validó.

Si no es exacto, atrae exactamente al cliente que después hay que rechazar. Hay que confirmarlo o retirarlo.

**Estos dos puntos bloquean cualquier campaña de publicidad.**

---

## Parte 1 — Mensaje para enviar al cliente

> **Asunto: datos que necesitamos para cerrar la web**

Hola. La página ya está publicada con los planes, la cobertura y el formulario. Para terminarla nos faltan unos datos. Los primeros 6 son los importantes, porque la página **ya está afirmando cosas que debemos confirmar**; los demás los cerramos después.

**Importantes**

1. **Instalación:** ¿el cliente paga la instalación? Si se cobra, ¿cuánto y en qué casos es gratis? ¿El router o módem está incluido o lo pone el cliente?
   *(Hoy la página dice que la instalación está incluida y la sección de preguntas dice que hay que consultar: necesitamos que las dos digan lo mismo.)*
2. **«Instalación también para reportados»:** aparece 6 veces en la página. ¿Es correcto que instalan a personas reportadas en Datacrédito? ¿Siempre, o solo en algunos casos? Si no aplica siempre, lo quitamos o lo precisamos.
3. **Velocidad garantizada:** ¿garantizan un porcentaje mínimo de la velocidad contratada (por ejemplo el 80%)? Si no garantizan ninguno, lo decimos así de claro.
4. **Cambio de plan:** ¿el cliente puede subir o bajar de plan? ¿Tiene algún costo? ¿Aplica desde el siguiente pago?
5. **Dirección definitiva:** ¿cuál es la dirección real? ¿Es una sede con atención al público o una oficina administrativa? *(Hoy figura una dirección provisional. Si es solo oficina, no conviene publicarla como punto de atención.)*
6. **Sector «Lusitania»:** ¿se escribe así, o es «Luzitania» u otro nombre? Aparece en la lista de cobertura.

**Cuando puedan**

7. **Redes sociales:** ¿tienen Facebook, Instagram o TikTok? Si sí, mándenos los enlaces. Si todavía no existen, no se publica nada (hoy la web no enlaza ninguna).
8. **Perfil de Empresa de Google:** ¿ya existe la ficha de UneFibra en Google Maps? Si no existe, hay que crearla: es lo que nos permite mostrar **reseñas reales** en la web. Nos sirve el enlace del perfil y el de «escribir reseña».
9. **Testimonios reales:** ¿hay 3 clientes que quieran dar su nombre, su sector y una frase corta, autorizando su publicación? *(Quitamos los tres de ejemplo porque eran inventados: preferimos no mostrar prueba social a mostrar una falsa.)*
10. **Fotos:** fotos de esos clientes, del equipo o de instalaciones, con autorización de uso de imagen.
11. **Estadísticas:** ¿tienen cuenta de Google Analytics 4? Necesitamos el identificador (formato `G-XXXXXXXX`). Si van a pautar en Facebook o Instagram, también el píxel de Meta.
12. **Métodos de pago:** ¿cuáles aceptan y quieren mostrar? (Nequi, Bancolombia, PSE…).
13. **Antispam del formulario:** ¿autorizan activar la protección de Google reCAPTCHA? Evita que lleguen solicitudes falsas. Requiere crear una clave en la cuenta de Google del negocio.
14. **Correo:** hoy usamos `unefibrasas@gmail.com`. Si van a tener dominio propio, conviene pasar a algo como `contacto@…`.

Gracias. Con los 6 primeros podemos publicar sin afirmar nada que no sea cierto.

---

## Parte 2 — Anexo técnico: qué se hace con cada respuesta

| # | Dato | Dónde entra exactamente | Qué cambia |
|---|---|---|---|
| 1 | Costo de instalación + router | `index.html`: texto de Planes (bloque sin JS), Comparador, FAQ «¿Debo pagar la instalación?» **y** el `FAQPage` del JSON-LD (deben coincidir) | Se retiran los `TODO` y se alinean los 3 textos |
| 2 | «Reportados» | `assets/js/config.js` → `planBeneficios` **y** los 5 textos estáticos de las tarjetas + sección de beneficios en `index.html` | Se confirma, se precisa o se retira de las 6 apariciones |
| 3 | Velocidad garantizada | `index.html` FAQ «¿Hay una velocidad mínima garantizada?» + su `FAQPage` | Respuesta concreta en vez de genérica |
| 4 | Cambio de plan | `index.html` FAQ «¿Puedo cambiar de plan?» + su `FAQPage` | Ídem |
| 5 | Dirección real | `assets/js/config.js` → `empresa.direccion` **y** `index.html` → JSON-LD `streetAddress` | Mapa, ficha de Google y `LocalBusiness` |
| 6 | Lusitania | `assets/js/config.js` → `cobertura.zonas` **y** los 22 sectores de `#cobertura` en `index.html` | Ortografía de la cobertura |
| 7 | Redes sociales | `assets/js/config.js` → `empresa.redes` (`facebook`, `instagram`, `tiktok` + `confirmadas: true`) | Aparecen en el footer y en `sameAs` del JSON-LD. Con `false` no se enlaza nada |
| 8 | Perfil de Google | `assets/js/config.js` → `empresa.googleResenas` (`urlPerfil`, `urlResena`, `placeId`, `puntaje`, `cantidad`) | La sección de opiniones **se muestra sola** al llenar los enlaces |
| 9 | Testimonios | `assets/js/config.js` → `testimonios: []` con `{ nombre, sector, frase }` | Se pinta la rejilla; con el arreglo vacío queda oculta |
| 10 | Fotos | `assets/img/` + campo `imagen` de cada testimonio | Sustituyen a las iniciales |
| 11 | GA4 / Meta Pixel | `assets/js/config.js` → `analytics.ga4Id` y `analytics.metaPixelId` | Se activan los eventos que **ya están programados** (`cta_click`, `form_submit`, `plan_select`, `qr_view`, `calculo_ahorro`). Con los IDs vacíos no se carga ningún script externo |
| 12 | Métodos de pago | Panel de administración → Configuración (colección `metodos_pago`) | No requiere programar nada |
| 13 | reCAPTCHA | `assets/js/config.js` → `appCheck.siteKey` + `habilitado: true` | Refuerza el formulario contra spam |
| 14 | Correo corporativo | `assets/js/config.js` → `empresa.email` | Botón «Correo» y JSON-LD |

> **Nota de seguridad:** ningún dato de contacto se escribe como texto visible ni en `href="tel:"`/`mailto:` del HTML. Vive en `config.js` y el navegador construye el enlace al vuelo. Por eso un auditor que solo lea el HTML «no los encuentra»: es intencional, no un fallo.

---

## Parte 3 — Decisiones que no dependen del cliente

### 3.1 Dominio propio — **recomendado, y cuanto antes**

Hoy el sitio vive en `konfiozinc.github.io/unefibra/`. Consecuencias reales, no teóricas:

1. **El `robots.txt` no se aplica.** Los buscadores leen `konfiozinc.github.io/robots.txt` (la raíz) y no el del subdirectorio, así que el archivo que dejamos no sirve hoy. (El panel `/admin/` está igualmente protegido: sus 13 páginas llevan `noindex, nofollow` y exigen sesión.)
2. **El sitemap hay que enviarlo a mano** a Search Console, porque no lo descubren solos.
3. **La dirección muestra el nombre de otra empresa.** Un cliente que dude de una web con `konfiozinc.github.io` en la barra de direcciones es un cliente perdido.
4. **Riesgo de propiedad.** El contenido vive en la cuenta de GitHub de la agencia, no en la del cliente.

El propio `robots.txt` del proyecto ya asume `unefibra.co` como dominio previsto. Con dominio propio se arreglan los 4 puntos de una vez.

### 3.2 Google Search Console + Perfil de Empresa
Dar de alta el sitio y enviar el `sitemap.xml`. El Perfil de Empresa es además el requisito para las reseñas reales (punto 8).

### 3.3 Contador de eventos en el panel
Pendiente de decisión técnica: agregar los clics requiere escrituras desde el navegador hacia Firestore, lo que abre la base de datos a escrituras públicas. Lo correcto es una Cloud Function con App Check. Hoy los eventos ya se emiten, pero solo se ven cuando existan los IDs de Analytics.

---

## Parte 4 — Ya confirmado (no volver a preguntar)

- Nombre **UneFibra** y razón social **UneFibra SAS**, NIT **9020925655**.
- **Dos teléfonos, ambos reales y distintos:** `321 749 0310` para llamadas y `304 465 4987` para WhatsApp. No unificar.
- Correo `unefibrasas@gmail.com`.
- Horario: lunes a sábado, 8:00 a.m. – 6:00 p.m.
- **5 planes y sus precios:** Básico 100 `$50.000` · Familiar 150 `$60.000` · Plus 200 `$70.000` · Premium 250 `$85.000` · Ultra 300 `$100.000`.
- **22 sectores** de cobertura en el occidente de Medellín y el mapa centrado en El Cucaracho.
- Sin contratos de permanencia.
- Soporte por WhatsApp (la garantía de «instalación en 48 horas» está publicada; conviene confirmarla junto con el punto 1).

---

## Orden de trabajo sugerido

1. Respuestas 1 a 6 → corregir los textos publicados y eliminar las afirmaciones sin respaldo.
2. Comprar dominio y apuntarlo → arregla el `robots.txt`, el sitemap y la marca.
3. Crear el Perfil de Empresa → habilita reseñas reales.
4. Cargar Analytics y App Check → dejar de volar a ciegas y cerrar el spam.
5. Testimonios y fotos reales → activar la prueba social.
