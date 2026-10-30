# Respaldo operativo — estrategia y recuperación (KZ-UNEF-031)

Estado al 30-oct-2026. Ambas programaciones siguen **PAUSADAS** por autorización limitada.

## 1. Qué se midió (producción, 29-oct-2026)

| Dato | Valor medido |
|---|---|
| Duración de una exportación por colección | **285 s a 1190 s** (4 m 45 s a 19 m 50 s) |
| Techo de una invocación (gen 1) | 540 s |
| Exportaciones históricas de base completa | 25-40 s (8-21 oct), 3 m (28 oct), **1 h** (23 y 27 oct) |
| Cuello de botella | el servicio de exportación atiende **una operación a la vez** y rechaza con 503/400 cuando la cola está ocupada |
| `GET /operations` | se ha colgado **más de 300 s**; con plazo de 15 s la corrida sigue |

**Conclusión:** un respaldo completo **no cabe en una invocación**. El diseño por lotes es correcto; lo que faltaba era que **no perdiera trabajo** entre invocaciones.

## 2. Lo que ya está corregido en el código (desplegado: `backupFirestore` v11, `continuarBackup` v4)

1. **Adopción:** si el bucket ya tiene el lote verificado, no se vuelve a exportar.
2. **Sin solapes:** si el lote tiene una exportación en curso, no se pide otra (se adopta al terminar).
3. **Congestión ≠ fallo:** 503, 400 «otra exportación en curso» y plazo agotado dejan el lote **PENDIENTE**, sin alerta.
4. **Plazos:** `GET /operations` con AbortController de 15 s; el detalle del rechazo se guarda en el manifiesto.
5. **Cerrojo** con expiración: una invocación muerta no bloquea la siguiente más de 15 min.

## 3. Lo que añade KZ-031 (preparado, **sin desplegar**)

| Cambio | Efecto | Cómo se activa |
|---|---|---|
| **`backups` fuera del plan** | El manifiesto del propio respaldo deja de exportarse: es autorreferente, cambia mientras se copia y ocupa un turno de la cola | Ya es el comportamiento por defecto (`incluirEstado: false`) |
| **`snapshotTime` común** | Todos los lotes usan **la misma referencia temporal** guardada en el manifiesto: el respaldo pasa a ser una foto consistente entre colecciones | `usarSnapshot: true` en `backupPorLotes()` (una línea, tras medir su coste) |

Pruebas: `functions/test/backup-lotes.test.js` → **24 comprobaciones** (incluye que `backups` no se exporte y que la referencia temporal se conserve al reanudar).

> **Limitación que hay que declarar:** sin `snapshotTime`, cada colección se copia en un instante distinto. Hoy el respaldo de un día **no es una sola foto**: es una secuencia. Con `snapshotTime` sí lo sería.

## 4. Estrategia para recuperar el respaldo automático con seguridad

**Paso 0 — condiciones previas (comprobables en solo lectura)**
1. Cero exportaciones activas hacia el prefijo del día (`GET /operations`: ninguna con `done=false`).
2. Cerrojo `configuracion/backupEnCurso` **LIBRE**.
3. Manifest del día con `actualizadoEn` estable desde la última escritura conocida.
4. Ningún objeto de un prefijo ya verificado con `updated` posterior al inicio de la nueva corrida.

**Paso 1 — desplegar la mejora de KZ-031** (requiere autorización): `backupFirestore` + `continuarBackup`. Sin esto, `backups` se sigue exportando y la consistencia entre colecciones no está garantizada.

**Paso 2 — reanudar una sola programación:** `continuarBackup` (`:resume`). Dejar `backupFirestore` pausada hasta que el día esté `COMPLETADO`.

**Paso 3 — verificar el cierre:** manifiesto del día con **todos los lotes en `COMPLETADO`** y, por colección, un `*.overall_export_metadata` + sus archivos de datos en el bucket.

**Paso 4 — reactivar la diaria** solo cuando el día anterior esté `COMPLETADO`.

**Cifras para planificar:** 5-20 min por colección ⇒ un día completo son **1,5 a 3 h** con la cadencia de 30 min. Es el comportamiento de la plataforma, no un defecto del código.

## 5. Recuperación ante fallos

### 5.1 Restaurar una colección o toda la base

`gcloud` **no está instalado** en el equipo. Dos caminos:

**A. Con `firestore import` (cuando haya Cloud SDK o desde la consola):**
```
gcloud firestore import gs://unefibra-firestore-backups/daily/<fecha>/<coleccion>
gcloud firestore import gs://unefibra-firestore-backups/daily/<fecha>   # todas
```
La restauración de una colección existente **sobrescribe** los documentos con el mismo ID: hacerla sobre un proyecto nuevo o con `--collection-ids` acotado.

**B. Sin Cloud SDK (equipo actual):** procedimiento probado en el emulador (**10/10**, KZ-028) e idéntico en pasos:
1. Descargar los objetos del prefijo del lote (`storage.objects.list` + `objects.get`).
2. Cargarlos en el emulador de Firestore apuntando a un proyecto `demo-*`.
3. `firebase emulators:start --import <carpeta>` y verificar documentos y conteos.
4. Exportar desde el emulador a un proyecto real solo si el propietario lo autoriza.

### 5.2 Qué respaldo usar según lo que se haya perdido

| Situación | Copia a usar |
|---|---|
| Un documento puntual | `auditoria` (guarda `datosAnteriores`) o `clientes_hoja3_4_backup` |
| Una colección | el lote de esa colección en `daily/<fecha>/` |
| Toda la base | último `daily/…` completo (todos los lotes en `COMPLETADO`) |

### 5.3 Antes de restaurar

- Anotar el estado actual (conteos por colección) para poder comparar después.
- No restaurar sobre producción sin autorización escrita del propietario.
- El bucket **no tiene versionado**: lo que se borra, se pierde. Por eso KZ-031 no borra nada.

## 6. Riesgos abiertos

1. La diaria y la reanudación están **pausadas**: hoy **no hay respaldo automático**.
2. El respaldo del 29-oct quedó **PARCIAL** (2 de 10 colecciones con objetos completos: `auditoria` y `backups`).
3. La copia íntegra más reciente es del **28-oct 08:00Z**, anterior al cambio del motor de vencimientos de las 15:00Z (CLAUDIA VERGARA: ACTIVO → POR_VENCER).
4. Sin `snapshotTime`, el respaldo no es consistente entre colecciones.
