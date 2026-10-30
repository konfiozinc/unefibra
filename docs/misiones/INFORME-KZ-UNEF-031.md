# INFORME EJECUTIVO KZ-UNEF-031 — Panel administrativo y preparación de entrega

**Cliente:** UneFibra SAS · **Dirección del panel:** https://konfiozinc.github.io/unefibra/admin/
**Rama:** `feat/kz-unef-021-pagos-historicos` · **Fecha:** 30-oct-2026
**Estado:** versión candidata preparada. **No publicada.** Ambas programaciones de respaldo siguen pausadas.

---

## A. Funcionalidades terminadas — qué podrá usar el propietario

**Nuevo: «Revisión de clientes»** (`admin/revision-clientes.html`, menú › Más opciones, y botón desde Inicio).

Para cada servicio importado sin evidencia, en lenguaje comercial y sin términos técnicos:

1. Lista de registros que necesitan revisión (327 hoy).
2. Búsqueda por nombre, documento, teléfono o IP.
3. Plan contratado (nombre del plan).
4. Valor mensual registrado.
5. Fecha de corte guardada (día 15 o 30).
6. **Qué dato falta y por qué**, en texto claro («La fecha guardada no cae en el día de corte del cliente»).
7. Tres controles sencillos: valor mensual, día de corte y fecha de cobro (con la fecha del próximo corte ya propuesta, nunca inventada).
8. Contador permanente: cuántos quedan por revisar y cuántos confirmados.
9. Cada confirmación queda guardada **con responsable y fecha** (`revisionComercial`), y se registra en auditoría.

Salvaguardas verificadas en el emulador: confirmar un dato **no cambia** el estado de conciliación, **no habilita el cobro**, **no toca pagos** ni notificaciones, es **idempotente** (repetir no duplica) y, si el cliente ya tiene pagos, **mover la fecha exige motivo escrito**.

**Ya existían y siguen igual:** Inicio (indicadores), Clientes, Vencimientos, Pagos, Recordatorios, Planes, y «Más opciones» (solicitudes, listas de cobro 15/30, servicios, pagos del Excel, blog, configuración, usuarios, auditoría).

**Añadido en Inicio:** panel «Datos comerciales por revisar» con el número de servicios pendientes y acceso directo a la revisión.

---

## B. Correcciones realizadas y archivos principales

| # | Corrección | Archivo |
|---|---|---|
| 1 | El manifiesto `backups` deja de exportarse: es autorreferente y ocupa un turno de una cola que es el cuello de botella real | `functions/src/backup-lotes.js` |
| 2 | Referencia temporal común (`snapshotTime`) para que todos los lotes sean la misma foto de la base (preparado, **apagado** por defecto) | `functions/src/backup-lotes.js` |
| 3 | Reglas de revisión comercial (lógica pura, sin Firestore) | `functions/src/revision-comercial.js` (nuevo) |
| 4 | Callable `confirmarRevisionComercial` con todas las salvaguardas | `functions/src/index.js` |
| 5 | Mismas reglas en el navegador + prueba de paridad obligatoria | `assets/js/admin/revision-reglas.js` (nuevo) |
| 6 | Pantalla de revisión | `admin/revision-clientes.html`, `admin/revision-clientes.js` (nuevos) |
| 7 | Entrada de menú y panel en Inicio | `assets/js/admin/shell.js`, `admin/dashboard.js` |

Sin desplegar: **nada** de esto está en producción. `backupFirestore` sigue en **v11** y `continuarBackup` en **v4**.

---

## C. Pruebas — resultados reales

| Prueba | Resultado |
|---|---|
| Suite completa de Functions | **27 suites, 0 fallos** |
| `backup-lotes` | **24/24** (antes 17; +7 sobre manifiesto y referencia temporal) |
| `revision-comercial` (reglas puras) | **21/21** |
| Paridad navegador ↔ servidor | **8/8** (576 comparaciones de fechas/ciclos + 40 combinaciones de motivos) |
| `revision-comercial-emulador` (escritura real, datos ficticios) | **21/21** |
| `revision-ciclo` / `recordatorios` / `conciliacion-fechas` | 11/11 · 22/22 y 19/19 · 19/19 |
| Páginas servidas en local | 7/7 HTTP 200 + reglas y JS nuevos |

**Total aproximado: 652 comprobaciones previas + 57 nuevas = 709.**

**Lo que NO se ejecutó (no se presenta como aprobado):**
- Recorrido visual con capturas en computador y celular del flujo completo (**pendiente**; las páginas se sirven, pero no hay evidencia gráfica de esta versión).
- Restauración real desde el bucket (solo emulador, 10/10 de KZ-028).
- Envío real de notificaciones a clientes (no se hizo, por diseño).

---

## D. Datos comerciales

Verificado hoy contra producción (solo lectura):

| Dato | Valor |
|---|---|
| Clientes | **358** |
| Servicios | **332** (5 fuera del motor + **327** `PENDIENTE_VALIDACION`) |
| Pendientes de revisión | **327** |
| … con la fecha **en su día de corte** | **14** |
| … con fecha **fuera del corte** | **313** |
| … con **plan sin precio** | **121** |
| Confirmados por el propietario | **0** (la pantalla está lista; aún no se ha confirmado ninguno) |
| Pagos registrados | **0** · Notificaciones | **0** |

Ningún registro real fue modificado en esta misión.

---

## E. Respaldos

- Programaciones: **`backupFirestore` PAUSED** y **`continuarBackup` PAUSED** (por autorización limitada). **Hoy no hay respaldo automático.**
- Exportación que estaba pendiente el 29-oct: **terminó**. En `daily/2026-10-29/` hay **6 objetos** (`auditoria` y `backups`), **0 exportaciones activas**.
- Estado del respaldo del 29-oct: **PARCIAL** — 2 de 10 colecciones con objetos completos. Manifiesto sin actualizar desde el 29-oct 09:14Z.
- Copia íntegra más reciente: **28-oct 08:00Z**, anterior al cambio del motor de vencimientos de las 15:00Z (CLAUDIA VERGARA ACTIVO → POR_VENCER).
- Estrategia y procedimiento de recuperación: `docs/RESPALDO-OPERATIVO.md`. Condiciones para reactivar: cero exportaciones activas, cerrojo libre, manifiesto estable y ningún prefijo verificado reescrito.

---

## F. Integraciones — estado real

| Canal / sistema | Estado |
|---|---|
| **Push (FCM)** | Implementado, **sin tokens registrados**: un envío responde `enviados: 0` («Sin tokens registrados»). No llega a ningún cliente. |
| **Correo (SendGrid)** | Funciona, pero **solo para alertas internas** del sistema (fallos del motor, respaldo). No es canal de clientes. |
| **WhatsApp Cloud API** | **No integrado**: sin token, sin webhook, sin plantillas aprobadas, sin consentimiento. No se puede activar sin eso. |
| **Registro de avisos** | Cada aviso previsto se guarda en `notificaciones` con estado (`PENDIENTE`/`ENVIADO`/`FALLIDO`). Hoy refleja la realidad: no se envía nada. |
| **MikroTik** | Se conserva lo existente (`mikrotik.js`, pruebas verdes). **No se activó ni suspendió ninguna conexión real.** El estado administrativo del cliente y el estado técnico de su conexión siguen separados; no hay conexiones certificadas. |

---

## G. Publicación — dictamen

# NO GO

Motivos concretos:

1. **El respaldo no está certificado** (PARCIAL, 2 de 10 colecciones) y las programaciones están pausadas: publicar el panel sin respaldo automático deja a la empresa sin red de seguridad.
2. **La acción de guardar de «Revisión de clientes» requiere desplegar `confirmarRevisionComercial`.** Publicar el panel sin desplegarla dejaría un botón que no guarda.
3. **Falta la evidencia visual** del recorrido completo en computador y celular de esta versión.
4. La diaria del 30-oct no correrá mientras siga pausada.

Lo que **sí** está listo: código probado (27 suites), árbol limpio, rama y commits identificados, procedimiento de despliegue y de reversión documentados, y respaldos existentes intactos.

---

## H. Pendientes que requieren aprobación

| # | Decisión | Por qué no la puedo tomar yo |
|---|---|---|
| 1 | **Pausar/desplegar** `backupFirestore` + `continuarBackup` con las mejoras de KZ-031 | Toca producción y facturación de la plataforma |
| 2 | **Reanudar** `continuarBackup` (`:resume`) para cerrar el respaldo del día | Autorización de producción |
| 3 | **Desplegar** `confirmarRevisionComercial` (una función, sin tocar datos) | Despliegue en producción |
| 4 | Confirmar la **regla de febrero**: corte 30 = último día real (28/29) | Decisión comercial |
| 5 | Activar `renovarPorCiclo` (renovar por corte, no por «hoy + 30») | Cambia periodos de facturación |
| 6 | Qué hacer con los **313 servicios con fecha fuera de corte**: confirmarlos uno a uno desde el panel | Nadie puede decidir las fechas reales por el propietario |
| 7 | **Fusionar y publicar** el panel (merge a `main` + Pages) | No autorizado |
| 8 | Integración **WhatsApp**: token, plantillas y consentimiento | Requiere cuenta y aprobación de Meta |

---

## Anexo: qué se entregó

- Código: `functions/src/revision-comercial.js`, `functions/src/backup-lotes.js`, `functions/src/index.js`, `assets/js/admin/revision-reglas.js`, `admin/revision-clientes.html`, `admin/revision-clientes.js`, `assets/js/admin/shell.js`, `admin/dashboard.js`.
- Pruebas: `functions/test/revision-comercial.test.js`, `revision-reglas-paridad.test.js`, `revision-comercial-emulador.test.js`, `backup-lotes.test.js` (ampliado).
- Documentación: `docs/RESPALDO-OPERATIVO.md`, `docs/REGLAS-DE-COBRO.md`, este informe, e `docs/misiones/INFORME-KZ-UNEF-030.md` (respaldos).
