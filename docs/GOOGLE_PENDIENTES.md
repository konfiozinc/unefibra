# Pendientes de Google: qué está hecho, qué falta y cómo se cierra

> Este documento responde a los pendientes de la entrega relacionados con Google.
> Se actualizó el **27 de septiembre de 2026**.
> Fecha de referencia de todo lo que aquí se afirma: la del último despliegue.

---

## 1. Search Console y el asunto del `robots.txt`

### 1.1 Qué pasa realmente (no es un problema tan grave como parecía)

En un sitio de GitHub Pages **de proyecto** (el nuestro vive en
`konfiozinc.github.io/unefibra/`, dentro de un subdirectorio), los buscadores solo leen el
`robots.txt` de la **raíz del dominio**: `https://konfiozinc.github.io/robots.txt`.

Comprobado el 27/09/2026:

| Archivo | Resultado | Consecuencia |
|---|---|---|
| `https://konfiozinc.github.io/robots.txt` | **404 (no existe)** | Sin robots.txt, Google asume que **todo se puede rastrear**: el sitio **no está bloqueado** |
| `https://konfiozinc.github.io/unefibra/robots.txt` | 200, pero **se ignora** | Nuestras órdenes (`Disallow: /admin/`) no se aplican |
| `https://konfiozinc.github.io/unefibra/sitemap.xml` | 200, accesible | Sirve, pero Google no lo descubre solo (la línea `Sitemap:` del robots.txt se ignora) |

**Traducción:** la web es perfectamente indexable. Lo único que se pierde es el aviso
automático del sitemap y la orden de no rastrear `/admin/`.

### 1.2 Por qué el panel no corre peligro igualmente

`robots.txt` no es la única forma —ni la mejor— de decirle a Google que no indexe algo.
El mecanismo que **sí funciona en subcarpetas** es la etiqueta `noindex`, y ya está puesta:

- Las **15 páginas** de `/admin/` llevan `<meta name="robots" content="noindex, nofollow" />`.
- El blog lleva `noindex, follow` mientras no tenga artículos.
- Además, el panel exige sesión: sin usuario y contraseña no muestra ningún dato.

### 1.3 Cómo cerrarlo (3 minutos, con la cuenta de la agencia)

El sitio ya carga la etiqueta de Google Analytics de la agencia, y eso habilita el método
de verificación más rápido:

1. Entrar a <https://search.google.com/search-console> con **damoa1510@gmail.com**.
2. **Añadir propiedad** → tipo **Prefijo de la URL** →
   `https://konfiozinc.github.io/unefibra/`
3. Elegir el método **Google Analytics** y pulsar *Verificar*. Debe pasar al instante,
   porque la etiqueta `G-0JKTZNMPWX` ya está instalada en la página.
   *(Si no aparece ese método, se puede verificar subiendo un archivo HTML: Search Console
   da un nombre tipo `google1a2b3c4d5e6f.html`. Ese archivo se puede subir al repositorio y
   queda publicado en un minuto — solo hay que pasarnos el nombre exacto.)*
4. Ya dentro: **Sitemaps** → escribir `sitemap.xml` → *Enviar*.
   (O la URL completa: `https://konfiozinc.github.io/unefibra/sitemap.xml`.)
5. En 2 o 3 días, revisar **Cobertura/Indexación**: deberían aparecer indexadas la landing
   y las dos páginas legales.

### 1.4 El arreglo definitivo

Todo esto queda resuelto de raíz **con dominio propio** (`unefibra.co`): en un dominio
propio el `robots.txt` y el `sitemap.xml` viven en la raíz y funcionan normalmente.
El `robots.txt` del proyecto ya está escrito asumiendo ese escenario, así que el día de la
migración no hay que tocar nada.

---

## 2. Perfil de Empresa de Google (Google Business Profile)

### 2.1 Por qué no lo puedo crear yo

Es la única pieza de esta lista que **no se puede automatizar ni hacer desde aquí**, y
conviene saber por qué antes de intentarlo:

- Hay que crearlo con una **cuenta de Google del negocio** e iniciar sesión en
  <https://business.google.com> (pide correo y contraseña, y normalmente verificación en
  dos pasos: no tengo acceso a credenciales de Google, ni debo tenerlo).
- Google exige **verificar la titularidad** del negocio (video, teléfono o tarjeta postal a
  la dirección). Es un trámite entre Google y UneFibra, no algo que se pueda programar.
- Necesita un **dato que todavía no tenemos confirmado**: la dirección real. La que está en
  `config.js` es **provisional** y se retiró del JSON-LD justo por eso. Publicar una
  dirección falsa en Google es motivo de suspensión del perfil.

### 2.2 Ficha lista para copiar y pegar

Todo lo de abajo sale de datos ya aprobados por el cliente. No hay nada inventado.

| Campo | Valor |
|---|---|
| **Nombre del negocio** | `UneFibra` (si el cliente prefiere el legal: `UneFibra SAS`) |
| **Categoría principal** | `Proveedor de servicios de Internet` |
| **Categorías secundarias** | Elegir de las que Google sugiere al escribir (no inventar): proveedor de telecomunicaciones, servicio de instalación de Internet |
| **Tipo de negocio** | **Empresa de servicio a domicilio** (atiende en la zona de servicio, sin mostrar dirección) — evita publicar una dirección que no existe |
| **Zona de servicio** | Medellín, occidente: Ciudadela Nuevo Occidente, Robledo y sectores aledaños (las 22 zonas de la landing) |
| **Teléfono principal** | `321 749 0310` (voz). WhatsApp aparte: `304 465 4987` |
| **Sitio web** | `https://konfiozinc.github.io/unefibra/` (cambiar cuando haya dominio propio) |
| **Correo** | `unefibrasas@gmail.com` |
| **Horario** | Lunes a sábado, 8:00 a.m. – 6:00 p.m. |
| **NIT** | 9020925655 (para el trámite de verificación, no se publica) |

**Descripción sugerida** (cabe en el límite de 750 caracteres de Google):

> UneFibra SAS es un proveedor de Internet por fibra óptica en el occidente de Medellín.
> Llevamos conexión de alta velocidad a hogares de Robledo, Ciudadela Nuevo Occidente y
> sectores aledaños, con planes desde 100 hasta 300 Mbps. Instalamos en un máximo de 2 días
> hábiles, sin cláusulas de permanencia, y también instalamos a personas reportadas en
> centrales de riesgo. Incluye televisión por aplicación sin costo adicional. Atendemos de
> lunes a sábado de 8:00 a.m. a 6:00 p.m. Escríbenos por WhatsApp y verificamos la cobertura
> en tu sector.

**Servicios a listar** (sección "Servicios" del perfil, precios opcionales):

- Internet fibra óptica 100 Mbps / 150 Mbps / 200 Mbps / 250 Mbps / 300 Mbps
- Instalación de Internet residencial
- Televisión por aplicación (incluida)

**Fotos que conviene subir** (Google premia los perfiles con fotos reales; **no sirven
imágenes de banco**): logo en PNG con fondo transparente, foto del equipo instalando, foto
de la caja/ONT y del router ya instalados, y una foto del vehículo o del uniforme con la
marca. Pedírselas al cliente.

### 2.3 Después de crearlo

Cuando el perfil exista, hay que pegar dos enlaces en `assets/js/config.js` →
`empresa.googleResenas` (`urlPerfil` y `urlResena`): la landing **ya está programada** para
mostrar los botones de reseñas y el puntaje en cuanto esos campos tengan datos reales
(mientras estén vacíos no muestra nada: nunca se inventa una calificación).

---

## 3. Google Analytics 4 — ✅ ACTIVADO CON LA PROPIEDAD DE UNEFIBRA

**Estado:** activo desde el 27/09/2026, y con la propiedad correcta.

- ID instalado: **`G-MKD15Z7F0K`**
- Dónde: `assets/js/config.js` → `analytics.ga4Id`
- **De quién es: de UneFibra.** Google creó esta propiedad automáticamente al crear el proyecto
  Firebase `une-fibra` (propiedad «une-fibra», id `552867787`, cuenta de Analytics `396265363`)
  y **estaba sin usar**: su etiqueta no estaba instalada en ninguna parte. El tráfico **no se
  mezcla** con el de la agencia ni con el de otros clientes.
- Dónde se consulta: en la consola de Firebase → **Analytics**, y en
  <https://analytics.google.com> con la cuenta dueña del proyecto Firebase
  (`damoa1510@gmail.com`, la de la agencia). El día que el proyecto Firebase se migre al
  cliente, esta propiedad viaja con él.

> **Nota histórica:** durante unas horas quedó instalado `G-0JKTZNMPWX`, que es la propiedad de
> **KONFIO ZINC** (la misma de las demás landing pages de la agencia). Se cambió el mismo día, en
> cuanto se encontró por API la propiedad propia del proyecto: estaba disponible y es la correcta.
> No hay que crear ninguna propiedad nueva ni pedirle nada al cliente.

Los eventos ya están programados y empiezan a llegar solos: `cta_click`, `form_submit`,
`plan_select`, `cuestionario_respuesta`, `qr_view` y `calculo_ahorro`.

### 3.1 Consentimiento de cookies (hecho)

Como la ley colombiana (Ley 1581 de 2012) exige autorización previa para tratar datos
personales, y Google Analytics instala cookies de medición, la landing **ya no carga
analítica a ciegas**:

- Al entrar aparece un aviso abajo con **Aceptar / Rechazar** y enlace a la política.
- La analítica **solo se carga si el visitante pulsa Aceptar**.
- La decisión se guarda en el navegador; si rechaza, no se carga ningún script de terceros.
- La política de privacidad (sección 8) lo explica con detalle, incluida la transferencia
  internacional de datos a Google.

---

## 4. Píxel de Meta (Facebook/Instagram) — ❌ NO EXISTE AÚN

**No hay ningún píxel creado para UneFibra** en ninguno de los proyectos revisados, así que
esa casilla sigue vacía a propósito: `assets/js/config.js` → `analytics.metaPixelId`.

No lo puedo crear yo porque hace falta una cuenta de Facebook/Meta del negocio (o del
administrador de la agencia) y aceptar las condiciones de Meta.

1. <https://business.facebook.com> → **Administrador de eventos**.
2. **Conectar fuentes de datos → Web** → crear el píxel con el nombre `UneFibra`.
3. Copiar el **ID del píxel** (15 o 16 dígitos).
4. Pegarlo en `assets/js/config.js` → `analytics.metaPixelId` y publicar.

En cuanto tenga ID, la landing lo carga **solo con consentimiento** (mismo aviso de cookies)
y ya envía los mismos eventos que GA4. Si además se va a declarar en la política de
privacidad, avisar: el texto ya anticipa que hoy no está instalado.

---

## 5. Firebase App Check — ⚠️ PREPARADO, NO ACTIVADO (y por qué)

**Lo que hice:**

- Comprobé el estado real con la API de Firebase: **no hay ninguna site key registrada** y
  la aplicación de App Check está **desactivada** (nada bloqueado, nada roto).
- El bloque `appCheck` de `config.js` era **configuración muerta**: ningún archivo lo leía.
  Aunque alguien hubiera pegado la clave, no habría pasado nada. **Ya está conectado:**
  `main.js` carga `firebase-app-check-compat.js` y activa App Check **solo si**
  `appCheck.habilitado` es `true` **y** la clave tiene formato real (`6L...`). Hoy está en
  `false`, así que el comportamiento del sitio es idéntico al de antes.

**Lo que NO hice y por qué:** activar la aplicación obligatoria hoy **rompería el panel de
administración**. App Check se aplica a *todas* las peticiones del proyecto: las 15 páginas
del panel también tendrían que enviar su token, y ninguna está conectada. Si se activa la
"aplicación obligatoria" en la consola sin haber conectado antes el panel, el cliente se
queda sin poder entrar a su panel de administración. Es exactamente el tipo de cambio que no
se hace el día de la entrega.

**Los 5 pasos, en orden, para hacerlo bien más adelante:**

1. En la consola de Firebase → **App Check** → app `une-fibra-web` → **reCAPTCHA v3** →
   registrar el proveedor. La consola pide una site key: se crea en
   <https://www.google.com/recaptcha/admin/create> (tipo **v3**, dominio
   `konfiozinc.github.io` y, cuando exista, `unefibra.co`).
   *(La clave `6LeIxAcTAAAAAJcZVRqyYh71UMIEGNQ_MXjiZKhI` que aparece en el proyecto de la
   agencia **no sirve**: es la clave pública de prueba de Google, que siempre aprueba. No
   debe usarse en producción.)*
2. Pegar la site key en `config.js` → `appCheck.siteKey` y poner `habilitado: true`.
3. **Conectar también el panel**: sus 15 páginas usan el SDK modular
   (`firebase/app` 10.12.2 + importmap) y necesitan `firebase/app-check` inicializado antes
   de la primera consulta a Firestore. Sin este paso, no activar nada.
4. Publicar y dejar **24–48 horas en modo monitor** (sin obligar): en la consola se ven las
   peticiones verificadas y las que fallarían. Si el porcentaje de verificadas es ~100 %,
   seguir.
5. Solo entonces activar **Aplicación obligatoria** en Firestore y en Authentication.
   Coste: reCAPTCHA v3 es **gratis**.

**Alternativa que sí recomiendo evaluar:** para el riesgo concreto que más importa (que
alguien automatice el formulario público y llene `solicitudes_contacto` de basura), es más
barato y menos arriesgado poner un límite de escrituras en las reglas de Firestore que
activar App Check en todo el proyecto.

---

## Resumen en una tabla

| Pendiente | Estado | Quién lo cierra |
|---|---|---|
| `robots.txt` en subcarpeta | **Sin efecto real** (no hay bloqueo; el panel ya lleva `noindex`) | Nada urgente; se resuelve con dominio propio |
| Sitemap en Search Console | Listo para enviar (medición ya activa permite verificarlo en 1 paso) | Agencia, 3 min con `damoa1510@gmail.com` |
| Perfil de Empresa de Google | **Ficha lista** (sección 2.2) | **Cliente** (credenciales + verificación + dirección real) |
| Google Analytics 4 | ✅ **Activo con la propiedad propia de UneFibra** (`G-MKD15Z7F0K`) | Hecho. Nada que pedirle al cliente |
| Píxel de Meta | ❌ No existe | **Cliente** o agencia, con cuenta de Meta |
| App Check | ⚠️ Código preparado, desactivado a propósito | Fase 2, con los 5 pasos de la sección 5 |
