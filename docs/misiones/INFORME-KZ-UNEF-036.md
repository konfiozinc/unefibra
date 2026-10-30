# INFORME KZ-UNEF-036 — Actualización controlada del sistema de respaldos

**Autorización:** Darwin Montalvo, 30-oct-2026 · **Rama:** `feat/kz-unef-021-pagos-historicos` · **Base:** `d451bbb`
**Dictamen:** **GO** — las dos funciones de respaldo quedaron actualizadas y verificadas, **listas para solicitar la autorización de reanudación**. El respaldo automático **no está funcionando** (programaciones pausadas).

---

## 1. Verificación previa (antes de desplegar)

| Comprobación | Resultado |
|---|---|
| Versiones desplegadas antes | `backupFirestore` **v11**, `continuarBackup` **v4** (hash `729e4a90e09b`, = commit `4396d74`) |
| Código local | `incluirEstado` por defecto **false** → excluye `backups`; `usarSnapshot` por defecto **false** y **no se pasa** desde `index.js`; adopción sobre `daily/<corrida>/<lote>/` |
| Cerrojo `configuracion/backupEnCurso` | `PARCIAL`, expiración vencida → **LIBRE** |
| Operaciones activas | **0 de 40** |
| Manifiesto 29-oct | 10 lotes, actualizado 2026-10-29T09:14:42Z (intacto) |
| Manifiesto 30-oct | **no existe** → ninguna mezcla posible |
| Programadores | ambos **PAUSED** |
| Funciones del proyecto | 28 |

**Punto 4 de la misión (adopción con destino y fecha, no solo nombre):** el código usa `prefijo = ${prefijoCorrida}/${lote.id}/`, es decir fecha + colección. Se añadió una prueba que lo fija: objetos en `daily/2026-10-29/clientes/` **no** se adoptan en una corrida del `2026-10-30` → `backup-lotes` pasa a **25/25**.

**Punto 6 (`snapshotTime`):** la referencia temporal común está implementada pero **apagada**. No se activó porque su coste en este proyecto no está medido; activarla es `usarSnapshot: true` en `backupPorLotes()` y requiere una medición aparte.

## 2. Despliegue limitado

```
firebase deploy --only functions:backupFirestore,functions:continuarBackup --project une-fibra
```

| Función | Antes | Después | Hash | Estado |
|---|---|---|---|---|
| `backupFirestore` | v11 | **v12** | `9b14e4da3705` | ACTIVE · 2026-10-30T08:51:49.854Z |
| `continuarBackup` | v4 | **v5** | `9b14e4da3705` | ACTIVE · 2026-10-30T08:51:52.629Z |

**Sin efectos colaterales:** de las **28** funciones del proyecto, **2** se actualizaron; la siguiente más reciente sigue siendo `habilitarServiciosLote` del **26-oct**. No se modificaron permisos, no hubo migración a gen 2, no se cambió la infraestructura ni la facturación.

## 3. Certificación

### 3.1 Plan de nueve colecciones y exclusión de `backups`

Colecciones raíz reales en producción (10): `auditoria, backups, clientes, clientes_hoja3_4_backup, configuracion, historial_estados, metodos_pago, planes, servicios, usuarios`.

**Plan del código desplegado (9):** `auditoria, clientes, clientes_hoja3_4_backup, configuracion, historial_estados, metodos_pago, planes, servicios, usuarios` → **no incluye `backups`** ✓

### 3.2 Adopción segura de exportaciones anteriores (verificada contra el bucket real)

| Colección | Estado en `daily/2026-10-30/` | Efecto en la próxima corrida |
|---|---|---|
| `clientes` | 3 objetos, metadato global + datos | **ADOPTABLE** (no se reexporta) |
| `servicios` | 3 objetos | **ADOPTABLE** |
| `historial_estados` | 3 objetos | **ADOPTABLE** |
| `clientes_hoja3_4_backup` | 3 objetos | **ADOPTABLE** |
| `auditoria`, `configuracion`, `metodos_pago`, `planes`, `usuarios` | 0 objetos | por exportar |

**4 adoptables · 5 a exportar.** Se comprobó con `evaluarObjetos` del propio código (metadato global + al menos un archivo de datos), no con una suposición.

### 3.3 Prevención de duplicados

- **Adopción:** si el prefijo del día ya tiene el lote verificado, no se vuelve a exportar.
- **Exportación en curso:** si hay una operación viva hacia ese destino, no se pide otra (se adopta al terminar).
- **Congestión ≠ fallo:** 503, 400 «otra exportación en curso» y plazo agotado → lote `PENDIENTE`, sin alerta, sin reintento a ciegas.
- **Pruebas:** `backup-lotes` **25/25** (adopción, no solape, congestión, plazo, referencia temporal, exclusión del manifiesto y adopción por fecha).

### 3.4 Compatibilidad de manifiestos

| Documento | Estado |
|---|---|
| `backups/2026-10-29` | 10 lotes, sin cambios (histórico de la corrida fallida) |
| `backups/2026-10-30` | **no existe**: la corrida nueva lo creará con **9 lotes** |

No hay mezcla: la clave del manifiesto y el prefijo del bucket son la **fecha de la corrida**.

## 4. Estado de los programadores

| Programador | Estado | Próxima ejecución |
|---|---|---|
| `firebase-schedule-backupFirestore-us-central1` | **PAUSED** | ninguna |
| `firebase-schedule-continuarBackup-us-central1` | **PAUSED** | ninguna |

Se mantuvieron pausados **durante y después** del despliegue. **El respaldo automático no está funcionando**: desplegar una función no autoriza su ejecución programada.

## 5. Reversión (limitada a las funciones de respaldo)

```
git checkout 4396d74 -- functions/src functions/package.json
firebase deploy --only functions:backupFirestore,functions:continuarBackup --project une-fibra
git checkout HEAD -- functions/src functions/package.json
```

- No toca datos comerciales, respaldos, manifiestos, el panel publicado ni las otras 26 funciones.
- Verificado que `4396d74` existe en el historial y que el comando de despliegue es el mismo que ya se ejecutó con éxito.
- **No se ha ejecutado**: es el procedimiento preparado, no una prueba corrida. Se declara como tal.

## 6. Riesgos que quedan al terminar

1. **Respaldo automático detenido** mientras los programadores estén en `PAUSED`.
2. **Cinco colecciones sin copia del día** (`auditoria`, `configuracion`, `metodos_pago`, `planes`, `usuarios`); las de `planes`, `metodos_pago` y `usuarios` del 29-oct no han cambiado desde septiembre.
3. **`snapshotTime` sigue apagado**: el respaldo no es todavía una foto consistente entre colecciones.
4. **Sin `gcloud`** en el equipo: la restauración completa a una base real requiere Cloud SDK.
5. La **reversión no se ha probado** (procedimiento escrito, no ejecutado), por no alterar producción.

## 7. Dictamen

# GO

Las funciones de respaldo están **actualizadas, desplegadas y verificadas**:

- **v12** y **v5**, ACTIVE, hash `9b14e4da3705`, **solo** esas dos de 28 funciones.
- Plan de **9 colecciones comerciales**, `backups` **excluido** (comprobado con los datos reales).
- Adopción por **fecha + colección**, con prueba que impide mezclar días.
- **4 lotes adoptables** y **5 por exportar** en la próxima corrida, comprobado contra el bucket.
- Programadores **PAUSED**; sistema seguro y sin ejecución automática.

**Para que el respaldo vuelva a funcionar hace falta la autorización de reanudación** (siguiente y único paso): `:resume` de `continuarBackup` → adoptará los 4 lotes y exportará los 5 restantes (~1 min por colección medido el 30-oct → **10-25 min**), dejando `backups/2026-10-30` en 9/9 `COMPLETADO`; después `:resume` de `backupFirestore` para la corrida diaria de las 03:00 Bogotá.

**No se declara el respaldo automático en funcionamiento.** No se reanudó nada, no se ejecutaron exportaciones, no se publicó el panel, no hubo merge ni push, no se desplegó `confirmarRevisionComercial` y no se tocaron datos comerciales, MikroTik ni notificaciones.
