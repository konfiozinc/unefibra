# Publicación del panel y reversión

> **KZ-UNEF-029.** Procedimiento exacto para actualizar el panel oficial
> `https://konfiozinc.github.io/unefibra/admin/` **cuando exista autorización**.
> Hoy **no se ha ejecutado nada** de este documento.

## 0. Qué se va a publicar y qué no

| Pieza | ¿Se publica? | Cómo |
|---|---|---|
| Panel administrativo (rama → `main`) | Sí | GitHub Pages lo regenera solo al hacer push a `main` |
| Cloud Functions (recordatorios + respaldo) | Sí | `firebase deploy --only functions` |
| Reglas de Firestore v3 | **No** | Ya están desplegadas; no se tocan en esta publicación |
| Datos de clientes | **No** | No se migra ni se corrige nada en esta publicación |
| Envío de notificaciones reales | **No** | No hay canal: los avisos quedan registrados |

La URL no cambia: `https://konfiozinc.github.io/unefibra/admin/`.

## 1. Antes de tocar nada (comprobaciones)

```powershell
cd C:\Users\usuario29\Documents\KONFIO_ZINC\6-LANDING-PAGES\UneFibra-SAS

# 1.1 El árbol está limpio y en la rama correcta
git status --short          # debe estar vacío
git log --oneline -1

# 1.2 Las 25 baterías en verde (sin emulador las puras; con emulador las de integración)
node functions/test/recordatorios.test.js
node functions/test/conciliacion-fechas.test.js
node functions/test/renovacion-ciclo.test.js

# 1.3 El respaldo tiene todo lo que necesita (solo lectura, no exporta)
node tools/comprobar-respaldo.js
```

Si `comprobar-respaldo.js` falla, **no seguir**: ver §5.

## 2. Respaldo antes de publicar (obligatorio)

```powershell
# Exportación completa, FUERA de daily/ para que la regla de 30 días no la borre
gcloud firestore export gs://unefibra-firestore-backups/pre-publicacion/2026-XX-XX --project=une-fibra
```

Tarda varios minutos (la exportación completa tarda ~9 min). Sin límite de función,
termina. Comprobar que existen objetos:

```powershell
gcloud storage ls --recursive gs://unefibra-firestore-backups/pre-publicacion/2026-XX-XX/ | Measure-Object -Line
```

Ese prefijo es el punto de restauración del día de la publicación.

## 3. Desplegar Functions

```powershell
cd functions
npm install --production   # si hace falta; las dependencias ya están
cd ..
firebase deploy --only functions --project une-fibra
```

Qué cambia en producción con este despliegue:

1. **Recordatorios**: pasa a la regla de dos avisos (3 días antes y el día del corte,
   10:00 Bogotá). Los 327 servicios en conciliación **siguen fuera del motor**.
2. **Respaldo**: `backupFirestore` exporta por colecciones con presupuesto y
   reanudación; se añade `continuarBackup` (cada 30 min).
3. **Nada más**: no se toca MikroTik, ni el envío de mensajes, ni las reglas.

**Riesgo real de este paso:** el motor puede crear registros en `notificaciones`
para los **5 servicios** que hoy están fuera de conciliación. No envía nada a nadie:
no hay tokens FCM ni integración de WhatsApp, así que quedarían en estado **Fallido**
con su motivo. Es registro, no comunicación.

## 4. Publicar el panel (GitHub Pages)

```powershell
git checkout main
git merge --no-ff feat/kz-unef-021-pagos-historicos -m "merge: panel administrativo KZ-029"
git push origin main
```

El flujo `.github/workflows/deploy.yml` publica solo desde `main`: al hacer push
regenera el blog, copia `admin/`, `assets/`, las páginas públicas y despliega en
Pages (1–3 minutos). La URL no cambia.

## 5. Verificación después de publicar

| # | Comprobación | Cómo |
|---|---|---|
| 1 | El panel carga | abrir `https://konfiozinc.github.io/unefibra/admin/` |
| 2 | El login real funciona | entrar con la cuenta del propietario (no con las de prueba) |
| 3 | Se ven los seis módulos | Inicio · Clientes · Vencimientos · Pagos · Recordatorios · Planes |
| 4 | Los datos son los reales | el tablero debe mostrar 332 servicios / 358 clientes, no ceros ni datos de prueba |
| 5 | No se cuela el modo de pruebas | la página **no** debe mostrar el aviso «Running in emulator mode» |
| 6 | El respaldo del día se certifica | al día siguiente, revisar `backups/<fecha>` en Firestore: `estado` y colecciones `N/M` |
| 7 | El motor no avisa a quien no debe | `notificaciones` solo para los servicios fuera de conciliación |

Si algo falla: **§7, reversión**.

## 6. Cerrar el día

Anotar en `docs/RESPALDO.md` §6 la fecha del **primer respaldo COMPLETADO y
verificado** en producción. Antes de eso el respaldo es «código desplegado», no
«hecho comprobado».

## 7. Reversión (orden inverso, cada paso en menos de 5 minutos)

### 7.1 El panel salió mal

```powershell
git checkout main
git revert -m 1 <sha-del-merge>   # o: git reset --hard <main-anterior> y force-push autorizado
git push origin main
```

Pages republica automáticamente la versión anterior (1–3 min). No hay que tocar nada más.

### 7.2 Las Functions salieron mal

```powershell
git checkout <sha-anterior-a-la-publicacion> -- functions
firebase deploy --only functions --project une-fibra
```

Alternativa con historial de despliegues:

```powershell
firebase functions:list           # ver versiones
firebase deploy --only functions --project une-fibra   # desde el commit anterior
```

### 7.3 Los datos se dañaron

```powershell
gcloud firestore import gs://unefibra-firestore-backups/pre-publicacion/2026-XX-XX --project=une-fibra
```

La importación **reescribe documentos**: ejecutarla solo con autorización expresa y
después de exportar el estado actual.

### 7.4 Qué NO se puede revertir

- Los avisos ya registrados en `notificaciones` (se pueden marcar `CANCELADA`).
- Un correo de alerta ya enviado a la empresa.

## 8. Orden obligatorio y qué no hacer

1. Respaldo → 2. Functions → 3. verificar Functions → 4. panel → 5. verificar panel.

- **No** desplegar reglas de Firestore en esta publicación.
- **No** fusionar las tres ramas viejas (`fix/kz-unef-001-*`, `codex/kz-unef-013-modal`,
  `harness/unef-010-validacion`) sin revisarlas una por una.
- **No** activar tokens FCM ni WhatsApp en el mismo paso.
- **No** corregir vencimientos ni cobrar el mismo día de la publicación: si algo
  falla, no se sabría qué lo causó.
- El panel publicado queda **accesible por URL** (con `noindex` y login obligatorio);
  es la dirección oficial de siempre, no una nueva.
