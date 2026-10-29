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

## 8. Cómo detener los intentos automáticos (autorizado y ejecutado)

**Ejecutado con autorización expresa del propietario a las 09:23Z:** pausa del programador de reanudación.

```
POST https://cloudscheduler.googleapis.com/v1/projects/une-fibra/locations/us-central1/jobs/firebase-schedule-continuarBackup-us-central1:pause  ->  HTTP 200
```

| Trabajo | Estado tras la pausa | Cron | Próxima ejecución |
|---|---|---|---|
| `firebase-schedule-continuarBackup-us-central1` | **PAUSED** | `*/30 * * * *` | ninguna |
| `firebase-schedule-backupFirestore-us-central1` | ENABLED (sin tocar) | `0 3 * * *` (America/Bogota) | 2026-10-30T08:00Z |

Efecto: **no se inicia ninguna exportación nueva**; la única que estaba en curso (`daily/2026-10-29/backups`, desde 09:08:45Z) se deja terminar sin interrumpirla. Es un cambio **reversible**: `…:resume` sobre el mismo trabajo, sin redeploy y sin tocar código.

Pendiente de decisión (no ejecutado): pausar también la diaria si se quiere que no haya ninguna exportación hasta resolver la certificación.

**Alternativa sin ninguna escritura:** no hacer nada. Las ejecuciones automáticas adoptan lo terminado y no solapan, pero seguirían arrancando exportaciones de los lotes pendientes.

---

## 9. Control final y propuesta única de recuperación

### 9.1 La exportación de las 09:08:45Z (`daily/2026-10-29/backups`)

**No terminó.** El listado de operaciones (`GET /operations`) **no respondió en 4 intentos** (45 s y 70 s de plazo) durante la ventana 09:23-09:30Z, así que su estado no puede confirmarse por esa vía. La evidencia del bucket es concluyente: **0 objetos** bajo `daily/2026-10-29/backups/` tras 22 minutos. Es una colección de **1 documento**: su lentitud no es de tamaño, es la cola del servicio. No se interrumpió.

### 9.2 La corrida diaria del 30-oct (`backupFirestore`, 03:00 Bogotá = 08:00Z)

Qué haría: abrir una **corrida nueva** (`backups/2026-10-30`) y exportar todo a `daily/2026-10-30/…`. **No sobrescribe** nada de hoy (prefijo distinto, documento de manifiesto distinto), pero compite por la misma cola de exportación y abriría un **segundo ciclo a medias** mientras el de hoy no está cerrado.

**Propuesta:** pausarlo con el mismo mecanismo reversible ya usado (`…backupFirestore-us-central1:pause`), hasta que el día de hoy quede `COMPLETADO`. **Requiere autorización** (no ejecutado).

### 9.3 ¿Debe exportarse la colección `backups`?

Es el **manifiesto del propio respaldo** (1 documento: estado y tiempos de cada lote). No es dato comercial.
- **Para hoy:** no se toca. Ya es un lote del plan y, si su exportación termina, se adopta como cualquier otro. Excluirlo exigiría cambiar el plan y desplegar (no autorizado).
- **Recomendación para un cambio futuro (no ejecutado):** excluir `backups` del plan de exportación. Es autorreferente (cambia mientras se copia), nunca será idéntico a sí mismo y ocupa un turno de la cola que retrasa una colección real. Quedarían 9 lotes.

### 9.4 Colecciones con datos comerciales que hay que proteger

| Colección | Docs | Qué es | Prioridad |
|---|---|---|---|
| `clientes` | 358 | Registro de clientes: nombre, documento, teléfono, dirección, plan, precio, fechas de corte | **Máxima** |
| `servicios` | 332 | Servicio por cliente: vencimiento, estado, conciliación (327 pendientes), IP y plan | **Máxima** |
| `historial_estados` | 10 | Historial de cambios de estado (quién, cuándo, por qué); el motor de vencimientos escribe aquí a diario | **Alta** |
| `planes` | 10 | Catálogo comercial: planes y precios | Alta |
| `metodos_pago` | 5 | Métodos de pago | Alta |
| `usuarios` | 2 | Cuentas y roles del panel | Alta |
| `configuracion` | 4 | Plantillas de mensaje, soporte, campos obligatorios | Media |
| `auditoria` | 16 | Rastro de auditoría de acciones | Media |
| `clientes_hoja3_4_backup` | 60 | Clientes archivados de la operación excluida (hojas 3-4): se preservan, no se usan | Media |
| `backups` | 1 | Contabilidad interna del respaldo | No comercial |

`pagos` y `notificaciones` **no existen** (0 registros). Cuando se creen pasarán a prioridad máxima.

### 9.5 ¿Bastan las exportaciones ya hechas para cerrar la certificación?

**No.** Cobertura real:

| Colección | Exportación de hoy | Copia íntegra |
|---|---|---|
| `auditoria` | ✅ `daily/2026-10-29/auditoria/` (3 objetos) + 2 copias en `pre-kz-030/` | — |
| `planes`, `configuracion`, `metodos_pago`, `usuarios` | ✅ solo en `pre-kz-030/…` (3 objetos cada una) | — |
| `clientes`, `servicios`, `historial_estados`, `clientes_hoja3_4_backup` | ❌ **ninguna** | solo hasta **2026-10-28 08:00Z** |
| `backups` | ⏳ en curso, sin objetos | — |

La última copia íntegra (`daily/2026-10-28T08-00-20-935Z/`, 12 objetos) es **anterior** al cambio del motor de vencimientos de las 15:00:34Z del 28-oct, que pasó a `CLAUDIA VERGARA` de ACTIVO a POR_VENCER y escribió cliente, servicio e historial. **Ese cambio no está en ninguna copia.** Las cuatro colecciones sin exportación de hoy son, justamente, las de prioridad máxima. No hay forma de cerrar la certificación sin exportarlas; mover objetos entre prefijos sería una escritura y además innecesaria.

> **Advertencia de diseño (para el futuro, no ejecutado):** el respaldo por lotes **no es una foto del mismo instante**: cada colección se exporta en su propio momento. La exportación de base completa sí es consistente. La exportación por colecciones admite `snapshotTime`, así que una sola marca de tiempo compartida por todos los lotes devolvería consistencia entre colecciones. Es un cambio de código, requiere autorización y despliegue.

### 9.6 PROPUESTA ÚNICA DE RECUPERACIÓN

**Qué:** reanudar `firebase-schedule-continuarBackup-us-central1` (`:resume`) y dejar que las invocaciones completen **los 5 lotes que faltan** exportando a `daily/2026-10-29/<colección>/`, en este orden natural del plan: `backups` (adoptar si terminó), `clientes`, `servicios`, `historial_estados`, `clientes_hoja3_4_backup`.
Los 5 lotes ya completos (`auditoria`, `planes`, `configuracion`, `metodos_pago`, `usuarios`) **no se vuelven a exportar**: el código desplegado los adopta.

**Sin efectos destructivos:** no se borra ni se sobrescribe ningún objeto (cada lote escribe solo su propio prefijo y `auditoria` se adopta); no se toca ningún documento comercial; no hay despliegue ni cambio de código.

**Tiempo estimado:** medido hoy, 5-20 min por exportación. Con la cadencia de 30 min del programador: **1,5 a 3 horas** para 5 lotes. Con disparos espaciados según el estado observado (sin esperar el turno de 30 min): **1 a 2 horas**. Si `backups` sigue atascado, el resto puede cerrarse igual y ese lote queda como excepción documentada.

**Riesgos:**
1. El servicio de exportación puede seguir rechazando o no respondiendo (hoy: 4 fallos de listado en 7 minutos). No se pierde trabajo — la corrida es reanudable — pero el plazo puede pasarse de 3 horas.
2. A las **15:00Z** el motor de vencimientos vuelve a escribir en `clientes`, `servicios` e `historial_estados`. Cada colección quedará capturada en su propio momento (ver advertencia de §9.5).
3. Si la diaria del 30-oct queda habilitada, abrirá un segundo ciclo incompleto y competirá por la cola.
4. Si dos invocaciones coinciden, el cerrojo hace que una termine `OMITIDO` sin exportar: no hay duplicación.

**Condiciones de éxito:**
- El manifiesto `backups/2026-10-29` llega a **10 de 10 lotes `COMPLETADO`**.
- Cada colección tiene en `daily/2026-10-29/<colección>/` al menos un `*.overall_export_metadata` y sus archivos de datos.
- **0** documentos comerciales modificados durante la ventana (salvo los del motor de vencimientos a las 15:00Z, que son suyos, no del respaldo).
- Ningún prefijo anterior a hoy queda alterado (verificable por `updated` de los objetos).
- Si al cierre falta solo `backups`, se certifica con **9 de 10** y una excepción documentada, o se reintenta ese lote.

**Requiere autorización:** (a) `:resume` de `continuarBackup`; (b) `:pause` de la diaria `backupFirestore`. Nada más.
