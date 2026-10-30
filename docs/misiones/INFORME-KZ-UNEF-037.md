# INFORME KZ-UNEF-037 — Cierre y reactivación controlada de respaldos

**Autorización:** Darwin Montalvo, 30-oct-2026 · **Rama:** `feat/kz-unef-021-pagos-historicos` · **Base:** `c69bb52`
**Dictamen:** **GO** — respaldo del 30-oct **certificado 9/9** y **ambas programaciones reactivadas**. El respaldo automático queda **encendido**, con la primera corrida diaria **pendiente de comprobación efectiva**.

---

## 1. Estado de las nueve colecciones

`backups/2026-10-30` · **9 de 9 lotes `COMPLETADO`** · actualizado 2026-10-30T09:16:03Z · **27 objetos** en `daily/2026-10-30/`.

| Colección | Origen de la copia | Hora |
|---|---|---|
| `clientes` (358) | **adoptada** (exportada en KZ-035) | 08:16Z |
| `servicios` (332) | **adoptada** | 08:17Z |
| `historial_estados` (11) | **adoptada** | 08:18Z |
| `clientes_hoja3_4_backup` (60) | **adoptada** | 08:19Z |
| `auditoria` (16) | nueva exportación de la corrida | ~09:12Z |
| `configuracion` (4) | nueva | ~09:13Z |
| `metodos_pago` (5) | nueva | ~09:14Z |
| `planes` (10) | nueva | ~09:15Z |
| `usuarios` (2) | nueva | ~09:16Z |

Cada lote tiene **metadato global + metadato de colección + archivo de datos**: 9/9 verificado con `evaluarObjetos`. **`backups` no está en el plan** (plan de 9).

## 2. Manifiesto final y verificaciones

| Criterio | Resultado |
|---|---|
| `backups/2026-10-30` en 9/9 `COMPLETADO` | ✅ |
| Nueve colecciones correctas, sin `backups` | ✅ |
| Metadatos y datos presentes en las 9 | ✅ (27 objetos) |
| Exportaciones activas al cierre | **0** |
| Lotes duplicados | **ninguno** |
| Respaldos anteriores sobrescritos | **0** (`daily/2026-10-29` 6 objetos, `pre-kz-030` 18, `daily/2026-10-28…` 12 — **0 escritos hoy**) |
| Cerrojo | `COMPLETADO` → **LIBRE** |
| Manifiesto del 29-oct | **intacto** (10 lotes, 2026-10-29T09:14:42Z) |
| Evidencia de restauración | `clientes` **358 = 358** en base aislada (KZ-035) + contenido 3/3 ids y 12/12 valores en las 4 colecciones |

## 3. Adopción de los cuatro lotes

La corrida **adoptó los cuatro lotes** exportados en KZ-035 **sin reexportarlos**: el manifiesto los marca `COMPLETADO` con `adoptado: true`, y el bucket no recibió objetos nuevos en esos prefijos (siguen con los 3 objetos del 08:16-08:19). Verificado en el propio manifiesto durante la ejecución (`adoptados=4`).

## 4. Exportaciones nuevas realizadas

Cinco, todas dentro de la corrida de la función (no manuales): `auditoria`, `configuracion`, `metodos_pago`, `planes`, `usuarios`. **Duración total de la corrida: 275 s** (09:11:37→09:16:03Z). Sin reintentos, sin cancelaciones, sin cola ocupada.

## 5. Operaciones activas al cierre

**0** de 40 históricas. El servicio quedó libre.

## 6. Estado final de los dos programadores

| Programador | Estado | Cron | Próxima |
|---|---|---|---|
| `firebase-schedule-backupFirestore-us-central1` | **ENABLED** | `0 3 * * *` · America/Bogota | **2026-10-31T08:00:00Z** |
| `firebase-schedule-continuarBackup-us-central1` | **ENABLED** | `*/30 * * * *` · America/Bogota | 2026-10-30T09:30:00Z |

`backupFirestore` se comprobó antes de reanudar: cron `0 3 * * *` y zona `America/Bogota` (03:00 Bogotá). Se reanudó después de certificar la etapa 3 y su `lastAttempt` quedó **vacío**: la reanudación **no lanzó una segunda exportación**. `continuarBackup` se mantiene **habilitada** porque es la que termina las corridas que se cortan por presupuesto; su ejecución cada 30 min es barata (sale en milisegundos cuando no hay nada pendiente).

## 7. Próxima ejecución diaria

**2026-10-31T08:00:00Z (03:00 America/Bogota)** — **PENDIENTE DE COMPROBACIÓN EFECTIVA**. No se declara en funcionamiento hasta que ocurra y se verifique su resultado (manifiesto `backups/2026-10-31` en 9/9).

## 8. Problemas encontrados y acciones correctivas

| # | Problema | Acción |
|---|---|---|
| 1 | **`continuarBackup` no inicia corridas.** Se reanudó y su primera ejecución (09:01:37Z) terminó en 4,8 s con el registro *«Continuación de respaldo: nada pendiente para 2026-10-30»* porque **solo continúa manifiestos existentes** y el del día no existía. **Corrige lo afirmado en el informe KZ-036** (decía que reanudarla bastaría). | Se ejecutó **una corrida supervisada de `backupFirestore`** (la misma función autorizada, por el mismo camino que su cron) para crear el manifiesto. Su **programación permaneció PAUSED** hasta superar la etapa 3. Está documentado aquí como desviación justificada. |
| 2 | La copia del día **no es una foto de un solo instante**: 4 lotes son de 08:16-08:19Z (KZ-035) y 5 de 09:11-09:16Z. | Se declara. Para una foto consistente hace falta activar `snapshotTime` (implementado, apagado, sin medir su coste). |
| 3 | El emulador solo importa un `.overall_export_metadata` por directorio. | Restauración certificada por colección; la completa requiere `gcloud firestore import`. |

## 9. Documentos comerciales

**Ninguno fue alterado por esta misión.** Recuentos idénticos: `clientes` 358 · `servicios` 332 (327 `PENDIENTE_VALIDACION` + 5 fuera del motor) · `auditoria` 16 · `planes` 10 · `metodos_pago` 5 · `usuarios` 2 · `clientes_hoja3_4_backup` 60 · `configuracion` 4. Los únicos documentos escritos hoy son el **manifiesto** `backups/2026-10-30` y el **cerrojo** `configuracion/backupEnCurso`.

Los tres documentos que aparecen modificados desde el 29-oct (`clientes/hIfmrk7f…`, `servicios/ut8ZBdxu…`, `historial_estados/9eDeBqcne…`, todos a las **2026-10-29T15:00:10Z**) son del **motor de vencimientos**, no de este trabajo. `historial_estados` pasó de 10 a 11 documentos por esa misma ejecución, y esa entrada **sí está** en las copias de hoy.

## 10. Dictamen final de seguridad y continuidad

# GO

- Respaldo del **30-oct certificado**: 9/9 lotes, 27 objetos, metadatos y datos verificados, sin duplicados, sin sobrescrituras, cerrojo libre y cero operaciones activas.
- **Cuatro lotes adoptados** sin reexportar; **cinco exportados** dentro de la corrida (275 s en total).
- **Ambas programaciones reactivadas** con configuración comprobada; la diaria quedó ENABLED con próxima ejecución el **31-oct 03:00 Bogotá** y sin ejecución inmediata que pudiera solaparse.
- Sin cambios en datos comerciales, panel, MikroTik, permisos ni infraestructura. Sin merge, sin push, sin despliegues.

**Riesgos que quedan:** la copia del día mezcla dos instantes (08:16-08:19Z y 09:11-09:16Z); `snapshotTime` sigue apagado; la primera corrida diaria está **pendiente de comprobación efectiva**; sin `gcloud` para restauración completa a una base real; la reversión de funciones (KZ-036) sigue sin probarse.

**Siguiente comprobación obligatoria:** el **2026-10-31 a las 03:00 Bogotá**, verificar que `backups/2026-10-31` llega a **9/9 `COMPLETADO`** y que no hay lotes fallidos. Ese es el único paso que falta para declarar el respaldo automático en funcionamiento.
