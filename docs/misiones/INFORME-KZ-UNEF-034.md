# INFORME KZ-UNEF-034 — Recuperación y preparación definitiva

**Rama:** `feat/kz-unef-021-pagos-historicos` · **Referencia:** `ae7eaf2` · **27 commits por delante de `origin/main` (`38b5cf9`)**
**Fecha:** 30-oct-2026 · **Dictamen:** **NO GO** para publicar el panel; **GO parcial en respaldos** (la restauración quedó probada; falta exportar 4 colecciones).

---

## 1. Estado real de los respaldos y de cada colección

| Elemento | Estado medido hoy |
|---|---|
| `backupFirestore` | **PAUSED** (sin próxima ejecución) |
| `continuarBackup` | **PAUSED** (sin próxima ejecución) |
| Cerrojo `configuracion/backupEnCurso` | **LIBRE** (`PARCIAL`, expiración vencida) |
| Manifiesto `backups/2026-10-29` | **0 de 10 lotes `COMPLETADO`** · última escritura 2026-10-29T09:14:42Z |
| Operaciones de Firestore | **36 históricas · 0 activas** ✅ (condición para cualquier operación nueva) |
| `daily/2026-10-29/` en el bucket | **6 objetos**: `auditoria` (3) + `backups` (3) |
| `pre-kz-030/` (copias del 29) | `planes`, `configuracion`, `metodos_pago`, `usuarios`, `auditoria` (3 objetos cada una) |
| `daily/2026-10-28T08-00-20-935Z/` | **12 objetos** — exportación de **base completa** a las 08:00Z del 28-oct |
| `daily/` anteriores | 25 ejecuciones completas (8→28 oct) |

**Cobertura por colección:**

| Colección | Exportación de hoy | Última copia válida |
|---|---|---|
| `auditoria` | ✅ `daily/2026-10-29/auditoria` | hoy 09:08 |
| `planes`, `configuracion`, `metodos_pago`, `usuarios` | ✅ en `pre-kz-030/` | hoy 08:08-08:25 |
| `backups` | ✅ (manifiesto) | hoy |
| **`clientes`** (358) | ❌ | 28-oct 08:00Z |
| **`servicios`** (332) | ❌ | 28-oct 08:00Z |
| **`historial_estados`** (10) | ❌ | 28-oct 08:00Z |
| **`clientes_hoja3_4_backup`** (60) | ❌ | 28-oct 08:00Z |

**Plan antiguo (10 lotes) vs nuevo (9):** el código de la rama excluye `backups` del plan (`incluirEstado: false` en `backup-lotes.js`), porque es el manifiesto del propio respaldo: cambia mientras se copia y ocupa un turno de una cola que es el cuello de botella real. El manifiesto del 29-oct sigue con el plan viejo (10 lotes), y por eso su cierre exige un lote que ya no se exportaría.

### 1.1 Lógica de continuación, adopción y referencia temporal (revisada y probada)

`functions/test/backup-lotes.test.js` — **24/24**: adopción de lotes ya exportados, no solapar exportaciones en curso, congestión ≠ fallo (503, 400 «otra exportación en curso», plazo agotado dejan PENDIENTE), referencia temporal común (`snapshotTime`, apagada por defecto) que se conserva al reanudar, y exclusión del manifiesto.

---

## 2. Restauraciones aisladas: ejecutadas y con conteos reales

**Procedimiento ejecutado (aislado, sin tocar producción):**

1. Bajé del bucket los **12 objetos** de `daily/2026-10-28T08-00-20-935Z/` (**654 KB**, solo lectura).
2. Levanté un **emulador Firestore independiente** en el puerto **8090**, proyecto `demo-restauracion`, `--import` de la carpeta descargada.
3. Comparé documento por documento por colección contra el conteo de producción actual.

**Resultado:**

| Colección | Restaurado | Producción | ¿Igual? |
|---|---|---|---|
| `clientes` | **358** | 358 | ✅ |
| `servicios` | **332** | 332 | ✅ |
| `auditoria` | **16** | 16 | ✅ |
| `planes` | **10** | 10 | ✅ |
| `metodos_pago` | **5** | 5 | ✅ |
| `usuarios` | **2** | 2 | ✅ |
| `clientes_hoja3_4_backup` | **60** | 60 | ✅ |
| `configuracion` | **4** | 4 | ✅ |
| `historial_estados` | 9 | 10 | ❌ **explicado**: el registro 10 se creó el 28-oct a las 15:00:34Z, **después** del export |
| `backups` | 0 | 1 | ❌ **explicado**: el manifiesto `2026-10-29` se creó el 29-oct, después del export |

**8 de 10 colecciones con conteo idéntico**, y las dos diferencias confirman que la copia es una **foto fiel del instante exportado**.

**Verificación de contenido (no solo conteos):** el documento restaurado `clientes/0HSIE29hDb3PMUL53UP6` trae `NORFA MOSQUERA RAMIREZ`, teléfono, plan, `precioMensual 50000`, `cicloCorte 30`, `fechaVencimiento 2026-03-26`, `estadoCliente ACTIVO`; un servicio restaurado trae `clienteId`, `fechaVencimiento 2026-11-01`. Los campos llegan, no solo los ids.

**Lo que todavía NO se puede certificar:** `clientes`, `servicios`, `historial_estados` y `clientes_hoja3_4_backup` **con el contenido de hoy** — solo existe copia íntegra con el estado del 28-oct 08:00Z. Los cambios posteriores (motor de vencimientos del 28-oct 15:00Z) no están en ninguna copia.

**Conclusión de recuperabilidad:** el **procedimiento de restauración está certificado** (se ejecutó y reprodujo conteos y contenido) y la **copia del 28-oct es recuperable y verificada**. Lo que falta es una **copia actual** de 4 colecciones, no la capacidad de restaurar.

---

## 3. Estado de las dos programaciones

Ambas **PAUSED**, sin próxima ejecución, por autorización limitada de KZ-030/031. No se han reactivado ni se han lanzado exportaciones reales en esta misión.

---

## 4. Resultados de las pruebas

| Batería | Resultado |
|---|---|
| Suites puras (sin emulador) | **18 en verde** |
| Suites con emulador | **11 no ejecutables hoy**: el emulador de Functions no cargó su backend (fallo de entorno local, `HTTP 404` en las callables), no una regresión de código |
| Última corrida completa conocida | **29 suites, 0 fallos** en `ae7eaf2` (mismo HEAD, KZ-033) |
| Recorrido integral de KZ-033 sobre este mismo HEAD | **15/15 escritorio** + **M1–M5 móvil** + **5/5** tarjeta nueva |
| `backup-lotes` | **24/24** (hoy, suite pura) |
| `revision-comercial` + paridad | 21/21 y 8/8 (hoy, suites puras) |

**No afirmo haber re-ejecutado las 29 suites hoy.** El emulador de Functions no arrancó correctamente en esta sesión; el código no cambió desde la última corrida verde (`ae7eaf2` es HEAD y no hubo modificaciones en esta misión).

---

## 5. Defectos detectados y corregidos

**Ninguno nuevo en esta misión: no se modificó código.** El único defecto funcional conocido (renovación que se salía del corte, corregido en KZ-032 con `renovarAlCorte`) sigue verificado: en el recorrido de KZ-033 el cliente del corte 30 quedó con **vencimiento 2026-11-30**, no el 29.

---

## 6. Evidencia de escritorio y móvil

**38 capturas** en `docs/evidencias/kz-unef-032/capturas/` con galería `index.html` (abrible con doble clic, sin servidor). Incluye Inicio, Clientes, Vencimientos, Pagos, Recordatorios, Planes, Revisión de clientes plegada y desplegada, formularios y móvil 375×667.

> **Limitación declarada:** este agente **no dispone de visión**. Las capturas se generaron y se midieron por código (dimensiones, textos, desbordes, tamaños táctiles), pero **no han sido revisadas visualmente**. La galería existe para que Darwin las revise.

---

## 7. Componentes pendientes de despliegue

**Función (1):** `confirmarRevisionComercial` — única función nueva; sin ella, «Guardar y confirmar» no guarda.

**Archivos del panel que hoy NO están en producción** (publicado = `main` en `38b5cf9`):

| Archivo | En Pages hoy |
|---|---|
| `admin/dashboard.html` | **200** (existe) |
| `admin/revision-clientes.html` | **404** (nuevo) |
| `admin/revision-clientes.js` | no publicado |
| `assets/js/admin/revision-reglas.js` | no publicado |
| `assets/js/admin/shell.js` (con la entrada de menú) | versión vieja |
| `admin/dashboard.js` (con el panel de revisión) | versión vieja |

---

## 8. Riesgos si se publicara ahora

1. **Sin respaldo actual de `clientes`, `servicios` e `historial_estados`**: se publicaría administración de datos cuya última copia es de hace dos días.
2. **Botón sin efecto**: sin desplegar `confirmarRevisionComercial`, «Guardar y confirmar» falla (hoy muestra un aviso honesto, pero es una función anunciada y no operativa).
3. **Programaciones pausadas**: sin respaldo automático hasta reanudarlas.
4. **327 registros sin confirmar** y **121 planes sin precio**: el panel los muestra, pero cada uno requiere decisión comercial; el motor los mantiene fuera de cobros y suspensiones.
5. **Regla de febrero sin aprobación escrita** del propietario (implementada como último día real).
6. Revisión visual humana pendiente.

---

## 9. Procedimiento completo de publicación y reversión

**Publicación (coordinada, requiere aprobación):**

1. `node tools/verificar-publicacion.js --antes` → constancia de bloqueos (hoy: función no desplegada + panel 404).
2. Desplegar **solo**: `firebase deploy --only functions:confirmarRevisionComercial --project une-fibra`.
3. `node tools/verificar-publicacion.js --despues` → debe imprimir **LISTO PARA PUBLICAR** (exit 0).
4. Fusionar `feat/kz-unef-021-pagos-historicos` en `main` (dispara `.github/workflows/deploy.yml` → GitHub Pages).
5. Comprobar: `/admin/dashboard.html` 200, `/admin/revision-clientes.html` 200, menú con seis entradas, **Revisión de clientes** abre y guarda **un** registro con motivo, y el cambio aparece en **Historial de cambios** con responsable y fecha.
6. Recién entonces: reanudar respaldos (§ abajo).

**Reversión (probada por procedimiento, no ejecutada):**

1. **Panel:** `git revert -m 1 <merge-commit>` en `main` y push → Pages vuelve a la versión anterior; el enlace oficial no cambia. Alternativa rápida: `git checkout 38b5cf9 -- admin assets` y commit.
2. **Función:** si molesta, redesplegar la versión previa o dejar de usarla: sin la función la pantalla pasa a modo consulta y no rompe nada.
3. **Datos:** no se revierte nada por publicar el panel; las confirmaciones comerciales son documentos con sello y quedan en auditoría.
4. Verificación: abrir el panel, comprobar que «Revisión de clientes» ya no aparece (o muestra el aviso de función no publicada) y que el resto de pantallas siguen operativas.

**Respaldos (independiente del panel):** con autorización, `:resume` de `continuarBackup` y, cuando el día cierre `COMPLETADO`, `:resume` de `backupFirestore`. Coste: la cuota del proyecto no cambia (Blaze ya activo); duración estimada **1,5 a 3 h** para cerrar el día actual (5-20 min por colección medida), y **una sola** exportación concurrente por base.

---

## 10. Dictamen final

### **NO GO** para publicar el panel

Motivos comprobables:
1. **No existe copia actual** de `clientes`, `servicios`, `historial_estados` ni `clientes_hoja3_4_backup` (última: 28-oct 08:00Z). La restauración está probada, pero lo que se restauraría es de hace dos días.
2. **`confirmarRevisionComercial` no está desplegada** y archivos del panel no existen en Pages (404 medido hoy).
3. Las **programaciones de respaldo siguen pausadas**.

### **GO en cambio para:** reanudar el respaldo (es la vía para levantar el bloqueo 1) y desplegar la función (bloqueo 2), ambas bajo aprobación.

### Operaciones que requieren aprobación de Darwin

| # | Operación | Efecto | Reversible |
|---|---|---|---|
| 1 | **`:resume` de `continuarBackup`** | Exporta las 4 colecciones que faltan al prefijo del día; 1,5-3 h; sin cambios de datos | Sí (`:pause`) |
| 2 | **`:pause` de `backupFirestore`** (ya está) o mantenerlo pausado hasta cerrar el día | Evita un segundo ciclo incompleto | Sí |
| 3 | **Desplegar `confirmarRevisionComercial`** | Habilita guardar en Revisión de clientes | Sí (v0 anterior / sin función) |
| 4 | **Merge a `main` y publicación en Pages** | Publica el panel en el enlace oficial | Sí (`git revert`) |
| 5 | **Confirmar la regla de febrero** (corte 30 = último día real) | Regla comercial escrita | — |
| 6 | **Autorizar la migración de los 327 registros** desde el panel, uno a uno | Decisión comercial, no técnica | Parcial (auditoría) |

**Nada de esto se ha ejecutado.** Sin merge, sin push, sin despliegues, sin exportaciones reales, sin reactivar programaciones, sin tocar clientes reales ni MikroTik.
