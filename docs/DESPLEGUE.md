# Guía de despliegue — UNEFIBRAS SAS

Checklist ordenado para pasar de código a producción.

## 1. Firebase (consola)

1. Crear proyecto en <https://console.firebase.google.com>.
2. **Authentication → Sign-in method → Email/Password** (habilitar).
3. **Firestore Database → Crear** (modo producción; las reglas se suben en el paso 4).
4. **Project settings → Your apps → Web**: copiar credenciales.
5. (Opcional) **App Check → reCAPTCHA v3** si se desea reforzar.

## 2. Configurar el frontend

Pegar las credenciales en **dos** archivos (ver `README.md`):

- `firebase/firebase-config.js`
- `assets/js/config.js` → `firebase.config` + `habilitado: true`

Reemplazar los `[PLACEHOLDER]` de `assets/js/config.js` (NIT, teléfono, email,
dirección, WhatsApp, velocidad real).

## 3. Desplegar reglas, índices y funciones

```bash
npm install -g firebase-tools
firebase login
firebase use --add              # selecciona el proyecto
firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && cd ..
firebase deploy --only functions
```

El motor de vencimientos (`processDueDates`) queda programado automáticamente
(08:00 America/Bogota). En el plan Blaze de Firebase las funciones programadas
están disponibles; en Spark no se ejecutan.

## 4. Crear el SUPERADMIN inicial

Primera vez hay un "huevo y gallina": para entrar al panel necesitas un
SUPERADMIN, y para crearlo desde el panel necesitas entrar. Se resuelve una vez
manualmente:

1. **Authentication → Users → Add user** (email + contraseña).
2. Crear el documento `usuarios/{uid}` (usa el UID del usuario creado):

```json
{ "uid": "UID", "nombre": "Admin", "email": "correo@…", "rol": "SUPERADMIN", "activo": true, "createdAt": "…" }
```

Luego, desde **Usuarios** del panel ya puedes crear los demás.

## 5. Datos iniciales (desde el panel)

1. **Planes → + Nuevo plan**: crea los 5 planes del volante — 100/150/200/250/300 Mbps ($50.000/$60.000/$70.000/$95.000/$100.000, 30 días).
2. **Configuración → Métodos de pago**: agregar Nequi, Daviplata, etc.
3. **Configuración → Recordatorios**: revisar `7,5,3,1` / `0,-1,-3` / `5`.

## 6. GitHub Pages

1. Subir `unefibras/` a un repositorio (rama `main`).
2. **Settings → Pages → Source: GitHub Actions**.
3. El workflow `.github/workflows/deploy.yml` publica la carpeta raíz.

> El panel (`/admin`) usa módulos ES y Firebase Auth; funciona sobre HTTPS de
> GitHub Pages sin servidor propio.

## 7. App Check (opcional)

1. Consola → App Check → Registrar app (reCAPTCHA v3) → copiar site key.
2. `assets/js/config.js` → `appCheck.habilitado: true` + `siteKey`.
3. Importar `firebase-appcheck` en el cliente y, en `firestore.rules`, añadir
   `&& request.app_check.token != null` a las escrituras sensibles.

## 8. Respaldos (sección 43)

Firestore no debe ser la única copia:

- Exportación puntual: `gcloud firestore export gs://BUCKET/ruta`
- Importación/restauración: `gcloud firestore import gs://BUCKET/ruta`
- Programar una exportación periódica (Cloud Scheduler) según la política interna.

## 9. Verificación final

Ejecutar `docs/PLAN_PRUEBAS.md` sobre el entorno de producción antes de abrir
el servicio al público.
