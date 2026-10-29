# INFORME KZ-UNEF-030 — Certificación del respaldo de producción

**Cliente:** UneFibra SAS · **Proyecto Firebase:** `une-fibra`
**Repositorio:** `konfiozinc/unefibra` · **Rama:** `feat/kz-unef-021-pagos-historicos`
**Fecha:** 29-oct-2026 · **Estado del informe:** CIERRE PROVISIONAL, por pausa ordenada de la misión.

> **Veredicto: NO GO para publicar el panel administrativo.**
> El respaldo **no quedó certificado**: el manifiesto del día está en **PARCIAL**, y de las 10 colecciones raíz solo **una** (`auditoria`) tiene exportación completa y verificable en el bucket. Las tres colecciones que llevan los datos comerciales que más pesan —`clientes` (358), `servicios` (332) e `historial_estados` (10)— **no tienen respaldo de hoy**.

---

## 1. Estado real de producción

**Nada comercial cambió.** Medido por REST (solo lectura) contra Firestore:

| Colección | Documentos | Último cambio |
|---|---|---|
| `clientes` | 358 | 2026-10-28T15:00:34Z |
| `servicios` | 332 | 2026-10-28T15:00:34Z |
| `historial_estados` | 10 | 2026-10-28T15:00:34Z |
| `auditoria` | 16 | 2026-10-11T04:12:20Z |
| `planes` | 10 | 2026-10-06T04:09:47Z |
| `metodos_pago` | 5 | 2026-09-27T20:01:13Z |
| `usuarios` | 2 | 2026-09-26T13:26:23Z |
| `clientes_hoja3_4_backup` | 60 | 2026-10-06T15:50:26Z |
| `configuracion` | 4 | **2026-10-29T09:14:42Z** (solo `backupEnCurso`, el cerrojo del respaldo) |
| `backups` | 1 | **2026-10-29** (manifiesto del respaldo; colección creada por la propia función) |

- **Documentos comerciales modificados desde el primer cerrojo de la corrida (07:53:25Z): 0.**
- **Pagos: 0** (la colección `pagos` no existe). **Notificaciones: 0** (la colección `notificaciones` no existe); no se envió ningún mensaje a ningún cliente.
- **Servicios por conciliación: 327 `PENDIENTE_VALIDACION` + 5 fuera del motor = 332**, idéntico a la medición previa.
- **Permisos:** sin cambios en reglas de Firestore, IAM del bucket ni roles. Sin cambios de red ni del sitio publicado.
- Las únicas escrituras fueron las propias del respaldo: el documento de manifiesto `backups/<fecha>`, el cerrojo `configuracion/backupEnCurso` y objetos en el bucket.

---

## 2. Funciones y versiones desplegadas

Despliegue **limitado**: autorizado y ejecutado solo para las dos funciones del respaldo.

| Función | Versión | Estado | Runtime | Timeout | Última actualización |
|---|---|---|---|---|---|
| `backupFirestore` | **v11** | ACTIVE | nodejs22 | 540 s | 2026-10-29T09:15:18Z |
| `continuarBackup` | **v4** | ACTIVE | nodejs22 | 540 s | 2026-10-29T09:15:19Z |

**Prueba de que no se tocó nada más:** el proyecto tiene **28 funciones**; **solo esas dos** tienen `updateTime` del 29-oct-2026. La siguiente más reciente es `habilitarServiciosLote` v1 del 26-oct-2026. No hubo cambios de plan ni de facturación (Blaze ya estaba activo) y no se habilitó ninguna API nueva.

Commits de esta misión sobre la rama `feat/kz-unef-021-pagos-historicos` (base `4ac2871`):
`f54da48` (espera larga al reintentar) · `dd59b16` (adoptar lo exportado, no solapar) · `4396d74` (rechazo por «exportación ya en curso» = congestión; plazo en la lista de operaciones).

---

## 3. Exportaciones: terminadas y pendientes

### 3.1 Terminadas hoy (10 operaciones, todas de solo lectura sobre la base)

| Destino | Inicio | Fin | Duración | Resultado |
|---|---|---|---|---|
| `pre-kz-030/…/configuracion` | 08:03:35 | 08:08:19 | 4 m 44 s | Completa (3 objetos) |
| `pre-kz-030/…/planes` | 08:03:34 | 08:14:19 | 10 m 45 s | Completa (3 objetos) |
| `pre-kz-030/…/metodos_pago` | 08:03:35 | 08:14:19 | 10 m 44 s | Completa (3 objetos) |
| `pre-kz-030/…/auditoria` | 08:04:02 | 08:14:20 | 10 m 18 s | Completa (3 objetos) |
| `pre-kz-030/…/usuarios` | 08:03:36 | 08:15:48 | 12 m 12 s | Completa (3 objetos) |
| `pre-kz-030/…/auditoria` (2.ª) | 08:05:20 | 08:25:11 | 19 m 51 s | Completa (3 objetos) |
| `daily/2026-10-29/auditoria` | 08:23:05 | 08:38:38 | 15 m 33 s | Completa, pero **solapada** con la siguiente |
| `daily/2026-10-29/auditoria` | 08:31:42 | 08:37:23 | 5 m 41 s | Completa, **solapada** (dos manifiestos en un mismo prefijo) |
| `daily/2026-10-29/auditoria` | 08:59:57 | 09:08:40 | 8 m 43 s | **Completa y limpia** (la que queda) |
| `daily/2026-10-29/backups` | 09:08:45 | **en curso** | — | Pendiente (no se interrumpió) |

**Dato central medido en producción:** en este proyecto una exportación por colecciones tarda **de 5 a 20 minutos** (y hay días históricos con exportaciones de **una hora**: 23-oct y 27-oct). La función gen 1 tiene **540 s** de techo. Ese es el motivo real de todos los fallos desde el 25-oct, y la razón de que el respaldo no quede certificado hoy.

### 3.2 Lo que hay en el bucket de hoy

- `daily/2026-10-29/auditoria/` → **3 objetos** (manifiesto global, metadato de la colección y un archivo de datos de 11 KB), escritos 09:08:39-09:08:40.
- `daily/2026-10-29/backups/` → **0 objetos** (su exportación sigue corriendo).
- Resto de colecciones → **sin objetos**: no llegaron a exportarse.
- `pre-kz-030/` → **18 objetos** en 6 exportaciones (planes, configuracion, metodos_pago, usuarios y auditoria ×2), todas completas.

### 3.3 Estado del manifiesto del respaldo (`backups/2026-10-29`)

**PARCIAL · 0 de 10 lotes COMPLETADO** (última escritura 09:14:42Z). El detalle es el registro fiel de los intentos, no un estado final:

`auditoria` FALLIDO (49 s, rechazo 400 por exportación concurrente — ya corregido en el código desplegado) · `backups` PENDIENTE (la operación no respondió a tiempo) · `clientes` FALLIDO (186 s, 503) · otras 7 PENDIENTE.

> Matiz importante: el **objeto** de `auditoria` en el bucket sí está completo y es correcto; el manifiesto lo muestra FALLIDO porque su última escritura es anterior a que la exportación terminara. La próxima invocación lo **adoptaría** como COMPLETADO, pero esa invocación no se lanzó (pausa ordenada).

---

## 4. Archivos eliminados y posibilidad de recuperación

**Se eliminaron 5 objetos del bucket**, todos hoy y todos del prefijo `daily/2026-10-29/auditoria/`, a las ~09:00Z:

```
all_namespaces/kind_auditoria/all_namespaces_kind_auditoria.export_metadata
all_namespaces/kind_auditoria/output-0
all_namespaces/kind_auditoria/output_1-0
auditoria.overall_export_metadata
auditoria_1.overall_export_metadata
```

**Motivo:** eran el resultado de dos exportaciones solapadas al mismo prefijo (fallo diagnosticado y corregido), que dejaron **dos manifiestos** en un mismo lote. Se borraron para que la certificación se hiciera sobre una exportación única.

**Recuperación:** el contenido **no se perdió**.
- Fueron reemplazados por una exportación **limpia y equivalente** del mismo lote: `daily/2026-10-29/auditoria/` (3 objetos, 09:08:39-09:08:40).
- Existen además **dos exportaciones completas de `auditoria`** del mismo día en `pre-kz-030/2026-10-29T08-04-01-695Z/auditoria/` y `pre-kz-030/2026-10-29T08-05-20-151Z/auditoria/`.
- Y la de ayer: `daily/2026-10-28T08-00-20-935Z/` incluye `auditoria`.
- El bucket **no tiene versionado activado** (no hay copias de versiones anteriores de objetos), así que la recuperación depende de esas tres alternativas, no de una restauración de versión.

**No se borró ningún otro archivo**: ni respaldos de días anteriores, ni datos, ni código.

---

## 5. Estado del respaldo: PARCIAL

| Criterio | Estado |
|---|---|
| Manifiesto del día en `COMPLETADO` | ❌ 0 de 10 lotes |
| Exportación completa y verificable de cada colección raíz | ❌ 1 de 10 (`auditoria`) |
| Objetos verificados en el bucket con metadato global + datos | ✅ para `auditoria`; ⏳ `backups` en curso; ❌ las otras 8 |
| Reanudación probada sin duplicar | ✅ en pruebas (21/21) y en producción (adopción/no solape desplegados) |
| Producción intacta | ✅ 0 documentos comerciales modificados |
| **Certificación** | ❌ **NO alcanzada** |

### 5.1 Cobertura real de recuperación hoy

| Necesidad | Qué hay disponible | Fecha del contenido |
|---|---|---|
| Base completa | `daily/2026-10-28T08-00-20-935Z/` (12 objetos) | **2026-10-28 08:00Z** |
| `clientes`, `servicios`, `historial_estados`, `clientes_hoja3_4_backup` actualizados | **nada de hoy** | — |
| `auditoria` | `daily/2026-10-29/auditoria/` + 2 en `pre-kz-030/` | hoy 09:08 |
| `planes`, `metodos_pago`, `usuarios`, `configuracion` | `pre-kz-030/…` (3 objetos cada uno) | hoy 08:08-08:25 |

**Riesgo concreto:** los tres documentos comerciales que cambiaron ayer a las 15:00Z (`clientes` 358, `servicios` 332, `historial_estados` 10) **son posteriores al último respaldo completo**. Si se perdiera la base ahora, la última copia íntegra no incluiría esos cambios.

---

## 6. Riesgos existentes

1. **Riesgo alto — respaldo no certificado.** La única base completa respaldada es de 2026-10-28 08:00Z, anterior a los cambios comerciales de 2026-10-28 15:00Z.
2. **Riesgo alto — la exportación no cabe en una invocación.** Medido: 5-20 min por colección (hasta 1 h históricamente) contra un techo de 540 s por invocación. El diseño por lotes con adopción ya no pierde trabajo, pero **necesita varias invocaciones** para cerrar un día: hoy, sin la automatización, no terminó.
3. **Riesgo medio — servicio de exportación congestionado.** Acepta una operación por vez y rechaza con 503/400 cuando la cola está ocupada; `GET /operations` se ha colgado más de 300 s. Mitigado en el código desplegado (plazos y congestión ≠ fallo), no resuelto en la plataforma.
4. **Riesgo medio — el respaldo se incluye a sí mismo.** La colección `backups` (manifiesto) es ahora una colección raíz más y se exporta como un lote: cambia mientras se copia. No rompe nada, pero es un lote que nunca será idéntico a sí mismo.
5. **Riesgo bajo — bucket sin versionado.** Un borrado de objetos no tiene vuelta atrás por versión; la recuperación depende de los prefijos alternativos.
6. **Riesgo bajo — sin evidencia de restauración real en producción.** `gcloud` no está instalado en esta máquina, así que la prueba de restauración se hizo en el emulador (10/10, procedimiento idéntico), no sobre el bucket real.

---

## 7. Qué debe revertirse y qué debe conservarse

**Conservar (no revertir):**
- Las dos funciones desplegadas (`backupFirestore` v11, `continuarBackup` v4) y sus tres commits: la versión anterior **no adoptaba lo ya exportado ni evitaba solapar exportaciones**, que es justo lo que provocó la espiral de hoy. Revertir devolvería un diseño que no puede terminar un respaldo.
- Los objetos del bucket: `daily/2026-10-29/auditoria/` (3), `pre-kz-030/` (18) y todo `daily/` anterior. Son copias válidas.
- El manifiesto `backups/2026-10-29`: es el registro fiel de lo ocurrido y la base para reanudar.

**Revisar antes de continuar (no ejecutado):**
- `continuarBackup` está **ENABLED** y su próxima ejecución es **09:30:00Z** (cada 30 min, `America/Bogota`). `backupFirestore` diario a las **03:00 Bogotá** (08:00Z), próxima 2026-10-30T08:00Z.
- Con el código desplegado, una ejecución automática **no duplica** exportaciones, pero **sí puede iniciar la exportación de las colecciones pendientes** (`clientes`, `servicios`, …). Es decir: el respaldo avanzaría solo, o seguiría empezando exportaciones nuevas, según se decida.

**Nada que revertir en datos ni en el panel:** no se fusionaron ramas, no se publicó el panel y no se tocó ningún documento comercial.

---

## 8. Cómo detener los intentos automáticos (requiere autorización)

No se modificó nada de esto. Dos formas seguras, ambas reversibles y sin tocar código:

| Opción | Acción | Efecto | Reversión |
|---|---|---|---|
| **A. Pausar la reanudación** (recomendada) | `cloudscheduler.jobs.pause` sobre `projects/une-fibra/locations/us-central1/jobs/firebase-schedule-continuarBackup-us-central1` | No se inicia ninguna exportación nueva; el respaldo queda congelado en su estado actual | `jobs.resume` (mismo trabajo, sin redeploy) |
| **B. Pausar también la diaria** | idem sobre `firebase-schedule-backupFirestore-us-central1` | Tampoco corre el respaldo de las 03:00 Bogotá | `jobs.resume` |

Con la opción A queda igualmente en curso **una** exportación (`daily/2026-10-29/backups`, iniciada 09:08:45Z), que se deja terminar y no se interrumpe.

**Alternativa sin ninguna escritura:** no hacer nada. Las ejecuciones automáticas adoptan lo terminado y no solapan, pero seguirán arrancando exportaciones de los lotes pendientes.

---

## 9. Recomendación para el siguiente paso autorizado

1. Pausar `continuarBackup` (opción A) hasta decidir.
2. Reanudar la certificación con la automatización, **solo si se autoriza**, dejando que las invocaciones (cada 30 min) vayan adoptando exportaciones hasta 10/10 `COMPLETADO`. Estimación realista a los tiempos medidos hoy: **entre 1,5 y 3 horas**.
3. Si se quiere reducir ese tiempo de forma estructural (no urgente, no hecho): evaluar `backupFirestore` en **gen 2** (1800 s) — implica Cloud Run/Eventarc y revisar facturación, por lo que requiere autorización expresa.
4. Mantener el **NO GO** de publicación del panel hasta que el respaldo quede `COMPLETADO` con sus 10 colecciones verificadas.
