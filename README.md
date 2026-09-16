# UneFibra SAS — Plataforma Web

Sistema operativo digital de **UneFibra SAS**, prestadora de servicios de Internet
por fibra óptica en Medellín, Antioquia, Colombia.

Composición:

- **Sitio público (landing)** — conversión, planes, cobertura, contacto, WhatsApp.
- **Panel administrativo privado** — clientes, servicios, pagos, vencimientos, notificaciones.
- **Backend Firebase** — Firestore, Authentication, Cloud Functions, FCM.

> Estado del proyecto: **FASES 1–10 completadas** — sistema web integral de
> UneFibra SAS entregado (código completo y documentado). La activación en vivo
> requiere conectar las credenciales Firebase del propietario
> (ver `docs/DESPLEGUE.md` y `docs/PLAN_PRUEBAS.md`).

---

## Arquitectura

```
                    INTERNET
                       │
                       ▼
              ┌─────────────────┐
              │   GITHUB PAGES  │  frontend estático (landing + /admin)
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │     FIREBASE    │
              │ Authentication  │  → roles (SUPERADMIN/ADMIN/OPERADOR)
              │ Firestore       │  → 12 colecciones
              │ Cloud Functions │  → operaciones privilegiadas + vencimientos
              │ FCM             │  → notificaciones push
              │ Storage         │  → comprobantes (futuro)
              └─────────────────┘
```

Frontend: **HTML5 + CSS3 + JavaScript (ES Modules)**, sin build. Se elige sobre
React/Vite porque GitHub Pages no ejecuta build y este alcance no lo justifica.

---

## Estructura del proyecto

```
unefibras/
├── index.html                 # Landing (FASE 2)
├── manifest.json · sw.js      # PWA (FASE 2)
├── sitemap.xml                # SEO — enviar a Google Search Console
├── assets/
│   ├── css/                   # styles.css (landing) · admin.css (panel) · agente.css
│   ├── js/                    # config.js, main.js · admin/ (core, shell, stub)
│   ├── fonts/                 # Inter + Sora (woff2 autoalojadas, subset latin)
│   ├── img/  icons/
├── admin/                     # Panel privado (login + dashboard + módulos)
│   ├── index.html  login.js   #   autenticación
│   ├── dashboard.html  dashboard.js
│   ├── clientes · servicios · pagos · planes · notificaciones · configuracion · usuarios
├── firebase/
│   ├── firebase-config.js     # Config pública (placeholder)
│   ├── firestore.rules        # Security Rules
│   ├── firestore.indexes.json # Índices compuestos
│   └── firebase.json
├── functions/
│   ├── src/index.js           # Cloud Functions
│   └── package.json
├── docs/                      # MODELO_DATOS.md · PLAN_PRUEBAS.md · DESPLEGUE.md
├── .github/workflows/deploy.yml
└── README.md
```

---

## Puesta en marcha

### 1. Firebase (consola)

1. Crea un proyecto en <https://console.firebase.google.com>.
2. Activa **Authentication** (método Email/Password) y **Cloud Firestore**.
3. Añade una **App Web**: *Project settings → Your apps → Web*.
4. Copia las credenciales públicas y pégalas en:
   - `firebase/firebase-config.js`
   - `assets/js/config.js` → `firebase.config` (y pon `habilitado: true`)

### 2. Datos empresariales: qué está confirmado y qué falta

Todo vive en `assets/js/config.js` (sección `empresa`) y en el texto visible de
`index.html`. Los pendientes están marcados con `// TODO: Reemplazar con dato real`.

| Dato | Estado | Dónde |
|---|---|---|
| Email (`unefibra81@gmail.com`) | ✅ Confirmado | `config.js → empresa.email` + JSON-LD + footer |
| Teléfonos · WhatsApp | ✅ Confirmado | `config.js → empresa` / `whatsapp` |
| Cobertura (22 sectores del occidente de Medellín) | ✅ Confirmado | `config.js → cobertura.zonas` + copia estática en `index.html` |
| Nombre legal (`UneFibra SAS`) | ✅ Indicado por el cliente | `config.js → empresa.nombreLegal` + footer + JSON-LD |
| Dirección (`Calle 100 # 15-20, Medellín`) | ⚠️ Provisional | `config.js → empresa.direccion` + JSON-LD de `index.html` |
| NIT (`9020925655`) | ⚠️ Provisional | `config.js → empresa.nit` + footer |
| Facebook / Instagram / TikTok | ❌ La cuenta no existe aún | `config.js → empresa.redes` |
| Velocidades y precios | ✅ Confirmado | `config.js → planes[]` |
| App Check (reCAPTCHA v3) | ❌ Desactivado | `config.js → appCheck` |

**Marca**: siempre `UneFibra` (pegado, U y F mayúsculas) y `UneFibra SAS` como
nombre legal. No usar "UNE FIBRA", "UNEFIBRAS", "Une fibra" ni "UNEFIBRAS SAS".
Ojo: los identificadores técnicos `window.UNEFIBRAS_CONFIG`, `unefibras-functions`
y la caché `unefibras-v3` **no** son marca y no se renombran.

**Cobertura**: `cobertura.zonas` es la fuente de verdad y `main.js` pinta los chips
desde ahí; la misma lista está escrita de forma estática en `index.html`
(`#cobertura`) para que se vea sin JavaScript y la indexen los buscadores. Al
cambiar la cobertura, mantén ambas en sincronía. El mapa apunta al sector
El Cucaracho (barrio Robledo) mediante `cobertura.zonaMapa`.

Sobre las redes sociales: `empresa.redes.confirmadas` está en `false`, así que la
landing **no** pinta ningún enlace a redes (evita enlaces muertos o cuentas de
terceros). Cuando existan las cuentas reales: pega las URLs, pon
`confirmadas: true` y añádelas también en `sameAs` del JSON-LD.

Los testimonios de la sección `#testimonios` y las garantías de `#garantias` son
texto estático en `index.html` (para que se lean sin JavaScript y los indexen los
buscadores). Los testimonios actuales son **placeholders plausibles** y deben
reemplazarse por casos reales antes de darlos por definitivos; por eso **no** se
declaran como `review`/`aggregateRating` en el JSON-LD.

**No se inventa** información legal ni de cobertura: lo que falta queda
identificado con su `TODO` hasta disponer del dato real.

### 3. Firebase CLI (funciones + reglas + índices)

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # selecciona el proyecto creado
firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && cd ..
firebase deploy --only functions
```

Opciones equivalentes con `firebase init` (si prefieres inicializar desde cero):

```bash
firebase init firestore    # reglas + índices
firebase init functions    # JavaScript, sin ESLint si prefieres
```

### 4. Crear el usuario SUPERADMIN inicial

El rol se valida en `usuarios/{uid}`. Para crear el primer administrador:

1. En la consola, *Authentication → Users → Add user* (crea el usuario).
2. Crea el documento `usuarios/{uid}` con:

```json
{ "nombre": "Admin", "email": "…", "rol": "SUPERADMIN", "activo": true }
```

(La app incluirá un flujo asistido en el panel; por ahora se hace manualmente
o mediante una Cloud Function de arranque.)

### 5. GitHub Pages

1. Sube el contenido de `unefibras/` a un repositorio GitHub (rama `main`).
2. *Settings → Pages → Source: GitHub Actions*.
3. El workflow `.github/workflows/deploy.yml` publica la carpeta raíz.

### 6. Probar localmente

La landing abre directo con `index.html`; el panel administrativo usa módulos ES
y Firebase Auth, por lo que **debe servirse por HTTP(S)**:

```bash
npx serve unefibras        # o: python -m http.server 8000
```

Luego abre `http://localhost:8000/admin/` para iniciar sesión.

---

## Seguridad (resumen)

- Los datos administrativos requieren sesión (`request.auth != null`).
- El rol se lee de `usuarios/{uid}.rol` y lo imponen las **Security Rules**.
- Solo es público: lectura de `planes` y `metodos_pago`, y alta de
  `solicitudes_contacto` (validada por campos).
- Operaciones privilegiadas en **Cloud Functions** (Admin SDK no está limitado
  por las reglas; por eso nunca se expone en el frontend). Las callables
  revalidan el rol del llamador con `verificarRol`.
- **App Check** (opcional): preparado con `appCheck` en `config.js`; activarlo
  requiere configurar reCAPTCHA v3 en la consola y añadir
  `request.app_check.token` a las reglas de escritura.
- **Prohibido** subir al repositorio: service accounts, claves privadas,
  secretos o credenciales del Admin SDK (`.gitignore` ya los excluye).

---

## Plan de fases

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Fundación: estructura, Firebase, reglas, índices, funciones, CI | ✅ Completada |
| 2 | Sitio público (landing, planes, contacto, WhatsApp, solicitudes, PWA) | ✅ Completada |
| 3 | Panel administrativo (login, dashboard, navegación) | ✅ Completada |
| 4 | Clientes y servicios (CRUD, estados, historial) | ✅ Completada |
| 5 | Pagos (registro, confirmación, renovación) | ✅ Completada |
| 6 | Vencimientos (motor programado) | ✅ Completada |
| 7 | Notificaciones (recordatorios, push FCM, WhatsApp) | ✅ Completada |
| 8 | Seguridad (roles, reglas, App Check, auditoría) | ✅ Completada |
| 9 | Pruebas | ✅ Completada |
| 10 | Despliegue y documentación final | ✅ Completada |

> El proyecto no se declara terminado mientras existan módulos simulados.
