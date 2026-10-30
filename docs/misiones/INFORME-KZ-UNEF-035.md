# INFORME KZ-UNEF-035 — Recuperación autorizada de respaldos

**Autorización:** expresa de Darwin Montalvo · **Rama:** `feat/kz-unef-021-pagos-historicos` · **Base:** `6a38c14`
**Fecha:** 30-oct-2026 · **Dictamen de recuperabilidad:** **RECUPERABLE Y CERTIFICADO** para las cuatro colecciones comerciales.

---

## 1. Colecciones protegidas y fecha de cada copia

| Colección | Documentos | Copia | Instante de referencia |
|---|---|---|---|
| `clientes` | 358 | **`daily/2026-10-30/clientes/`** (nueva) | 30-oct 08:16Z |
| `servicios` | 332 | **`daily/2026-10-30/servicios/`** (nueva) | 30-oct 08:17Z |
| `historial_estados` | 10 | **`daily/2026-10-30/historial_estados/`** (nueva) | 30-oct 08:18Z |
| `clientes_hoja3_4_backup` | 60 | **`daily/2026-10-30/clientes_hoja3_4_backup/`** (nueva) | 30-oct 08:19Z |
| `auditoria` | 16 | `daily/2026-10-29/auditoria/` | 29-oct 09:08Z |
| `planes` | 10 | `pre-kz-030/...08-03-33-728Z/planes` | 29-oct 08:14Z |
| `configuracion` | 4 | `pre-kz-030/...08-03-34-895Z/configuracion` | 29-oct 08:08Z |
| `metodos_pago` | 5 | `pre-kz-030/...08-03-35-601Z/metodos_pago` | 29-oct 08:14Z |
| `usuarios` | 2 | `pre-kz-030/...08-03-36-256Z/usuarios` | 29-oct 08:15Z |
| `backups` | 1 | `daily/2026-10-29/backups/` | 29-oct (manifiesto, no es dato comercial) |

**Las nueve colecciones de datos tienen copia verificable.** Cuatro son de hoy; cinco son del 29-oct y tres de ellas no han cambiado desde principios de mes (`planes` 06-oct, `metodos_pago` 27-sep, `usuarios` 26-sep).

## 2. Operaciones realizadas y duración

| # | Operación | Inicio | Duración | Resultado |
|---|---|---|---|---|
| 1 | export `clientes` → `daily/2026-10-30/clientes` | 08:15:29Z | **43 s** | 3 objetos · 332 KB |
| 2 | export `servicios` → `daily/2026-10-30/servicios` | 08:16:14Z | **54 s** | 3 objetos · 232 KB |
| 3 | export `historial_estados` → `daily/2026-10-30/historial_estados` | 08:17:10Z | **54 s** | 3 objetos · 4 KB |
| 4 | export `clientes_hoja3_4_backup` → `daily/2026-10-30/clientes_hoja3_4_backup` | 08:18:07Z | **64 s** | 3 objetos · 68 KB |

- Ejecutadas **en secuencia**, esperando antes de cada una a que **no hubiera ninguna exportación activa** (0 de 36 al empezar).
- **Ninguna** necesitó reintento: las cuatro se aceptaron al primer intento (cola limpia).
- No se canceló ninguna operación ni se borró ningún archivo.
- Prefijos nuevos; **ningún objeto anterior fue sobrescrito** (verificado: `daily/2026-10-29` 6 objetos, `pre-kz-030` 18, `daily/2026-10-28…` 12, todos con **0 objetos escritos hoy**).

## 3. Resultado de la restauración aislada

| Prueba | Resultado |
|---|---|
| Emulador Firestore independiente (puerto 8091, `demo-restauracion-30`) importando `daily/2026-10-30/clientes` | **358 documentos restaurados = 358 de producción** ✅ |
| Contenido de los otros tres exports | ids reales **3/3** y valores de campo **12/12** presentes dentro del archivo de datos |
| Estructura de cada export | 3 objetos: metadato global + metadato de la colección + `output-0` |
| Restauración de la base completa del 28-oct (KZ-034, mismo HEAD) | **8 de 10** colecciones con conteo idéntico |

**Limitación declarada:** el emulador de esta versión solo carga **el primer** `.overall_export_metadata` de un directorio de importación, así que la restauración simultánea de las cuatro colecciones no se pudo hacer en un solo arranque. Se certificó `clientes` por restauración completa y las otras tres por contenido del binario exportado. La restauración completa de las cuatro queda al alcance de un comando (`gcloud firestore import`, con Cloud SDK) que no está instalado en este equipo.

## 4. Diferencias encontradas

| Diferencia | Explicación |
|---|---|
| El manifiesto `backups/2026-10-29` sigue en **0/10** | No corresponde a esta copia: es la corrida fallida del 29. La copia de hoy (`daily/2026-10-30/`) **no tiene manifiesto** porque no la hizo la función sino una exportación directa. |
| Plan antiguo (10 lotes, incluye `backups`) vs plan nuevo (9) | La exclusión de `backups` entró en `dece80e` y **no está desplegada**; producción corre `4396d74`. Consecuencia práctica: al reanudar, la corrida intentará exportar también el manifiesto (inocuo, ocupa un turno). |
| `historial_estados` 9 vs 10 en la copia del 28-oct (KZ-034) | El registro 10 se creó el 28-oct a las 15:00:34Z, después de aquel export. La copia de hoy ya los trae todos. |

## 5. Estado final de ambos programadores

| Programador | Estado |
|---|---|
| `firebase-schedule-backupFirestore-us-central1` | **PAUSED** (sin próxima ejecución) |
| `firebase-schedule-continuarBackup-us-central1` | **PAUSED** (sin próxima ejecución) |

No se reanudó ninguna programación en esta misión, no se desplegó ninguna función y no se modificó ningún documento comercial.

## 6. Riesgos pendientes

1. **Sin respaldo automático**: mientras las dos programaciones estén pausadas, la copia no se renueva sola.
2. **La copia de hoy no está en el manifiesto**: si se reanuda `continuarBackup`, la corrida del 30-oct **adoptará** los cuatro prefijos (el `lote-id` coincide con el nombre de la colección) y solo exportará lo que falte — pero conviene verificarlo en la primera ejecución.
3. **`backups` se sigue exportando** hasta desplegar `dece80e`.
4. **Cinco colecciones sin copia del día**: `auditoria`, `planes`, `configuracion`, `metodos_pago`, `usuarios` (sus copias son del 29-oct; tres no han cambiado desde septiembre).
5. **Sin `gcloud`** en el equipo: la restauración completa a una base real requiere Cloud SDK o el emulador con `--import` por colección.
6. La **regla de febrero** sigue pendiente de firma comercial.

## 7. Recomendación sobre cuándo reactivar el respaldo diario

1. **Ahora, con autorización:** `:resume` de `continuarBackup`. Debe adoptar los cuatro lotes de hoy y exportar los cinco restantes (11 lotes incluido el manifiesto con el plan desplegado). Con la cola limpia el coste medido es **~1 min por colección**: **10-25 min**. Al terminar, el manifiesto del 30-oct quedará `COMPLETADO`.
2. **Después** de eso, `:resume` de `backupFirestore` para la corrida diaria de las 03:00 Bogotá.
3. **Antes de reanudar**, comprobar lo de siempre: 0 exportaciones activas, cerrojo `LIBRE`, y ejecutar `node tools/verificar-publicacion.js` no aplica aquí (es para el panel).
4. Si se quiere eliminar el turno del manifiesto, desplegar `dece80e` (requiere autorización aparte).

## 8. Dictamen de recuperabilidad

# RECUPERABLE Y CERTIFICADO

- **Cuatro colecciones comerciales** exportadas hoy, con estructura completa, contenido contrastado con producción (ids y valores) y una de ellas **restaurada en base aislada con conteo idéntico**.
- **Nueve colecciones de datos** tienen copia verificable; la más antigua sin cambios desde septiembre.
- **Ningún respaldo anterior fue tocado**: 0 objetos escritos hoy en los prefijos del 28 y 29 de octubre.
- **Restauración probada dos veces** (28-oct completo → 8/10 conteos idénticos; 30-oct `clientes` → 358/358).

### Lo que NO se puede declarar
- El manifiesto del día **no** está `COMPLETADO` (no hubo corrida completa: 4 de 10 lotes con el plan desplegado).
- No se declara "respaldo de producción completamente certificado" en el sentido del manifiesto: falta la corrida que lo cierre y la restauración simultánea de las nueve colecciones.

### Operaciones que requieren aprobación de Darwin
1. `:resume` de `continuarBackup` para cerrar el día (10-25 min, reversible).
2. `:resume` de `backupFirestore` después (corrida diaria).
3. Despliegue de `dece80e` si se quiere excluir `backups` del plan y usar la referencia temporal común.
4. Firma de la regla de febrero (corte 30 = último día real).
