# INFORME KZ-UNEF-032 — Cierre técnico, validación comercial y versión candidata

**Cliente:** UneFibra SAS · **Panel:** https://konfiozinc.github.io/unefibra/admin/ (sin publicar)
**Rama:** `feat/kz-unef-021-pagos-historicos` · **Fecha:** 30-oct-2026
**Dictamen:** **NO GO** para publicar todavía (motivos en §12). La versión candidata está lista y probada.

---

## 1-3. Versión candidata

| Dato | Valor |
|---|---|
| Rama | `feat/kz-unef-021-pagos-historicos` |
| Commit de cierre | el de este informe (ver `git log -1`) |
| Árbol de trabajo | limpio (solo `_respaldos/` sin versionar, por diseño) |
| Respaldo del código | `_respaldos/unefibra/2026-10-30-kz-032/*.bundle` (`git bundle verify` OK) |
| Sin fusionar, sin push, sin desplegar, sin publicar | ✅ |

## 4. Correcciones realizadas en esta misión

| # | Corrección | Archivo |
|---|---|---|
| 1 | **Campo «Motivo del cambio»** en la tarjeta de revisión: cuando el cliente ya tiene pagos, el servidor exige un motivo escrito y **no había dónde escribirlo**. Ahora la pantalla lo pide y lo envía. | `admin/revision-clientes.js` |
| 2 | El manifiesto `backups` fuera del plan de exportación y referencia temporal común (`snapshotTime`, apagada por defecto) — de KZ-031, verificado aquí | `functions/src/backup-lotes.js` |
| 3 | Reglas de revisión comercial y su callable — de KZ-031, verificados aquí con el recorrido real | `functions/src/revision-comercial.js`, `functions/src/index.js` |

**Sin defectos nuevos del producto**: los fallos del recorrido fueron de mi propio guion de prueba (selectores), no del panel. Un caso merece mención: el mensaje «Este cliente ya tiene 1 pago(s) registrados. Escribe el motivo del cambio de fecha…» apareció correctamente, lo que confirmó que **la salvaguarda funciona** y destapó la falta del campo de motivo (corrección 1).

## 5. Resultados de pruebas

| Prueba | Resultado |
|---|---|
| Suite completa de Functions | **28 suites, 0 fallos** |
| Recorrido integral del panel en navegador real (escritorio 1440×900) | **15/15 pasos** |
| Recorrido en móvil (375×667) | **9/9 comprobaciones** |
| Capturas generadas | **34** (`docs/evidencias/kz-unef-032/capturas/`) |
| Errores de consola del navegador | **0** |
| Desborde horizontal en móvil (6 pantallas) | **0** |

Recorrido ejecutado, paso por paso: iniciar sesión como SUPERADMIN · registrar cliente (con plan y corte 30) · consultar vencimiento · registrar pago · confirmar pago · verificar renovación (vencimiento pasó a 2026-12-29) · consultar historial · revisar recordatorios · abrir Revisión de clientes · corregir valor ficticio 60.000 → 62.000 con motivo · comprobar el sello y el registro en auditoría · verificar que un OPERADOR no entra a la sección restringida · cerrar sesión · y las nueve comprobaciones de móvil.

> **Límite declarado:** las capturas se generaron y guardaron, pero **no fueron revisadas visualmente por mí**: el modelo de esta sesión no acepta imágenes. La verificación fue estructural (DOM, textos, medidas, ausencia de errores). La revisión visual humana queda pendiente y así se declara.

## 6. Estado de los servicios en conciliación (verificado hoy, solo lectura)

| Dato | Valor |
|---|---|
| Clientes | 358 · Servicios: 332 (5 fuera del motor + **327** en conciliación) |
| Pendientes de revisión | **327** |
| Con la fecha en su día de corte | **14** |
| Con fecha fuera del corte | **313** |
| Con plan sin precio | **121** |
| Confirmados por el propietario | **0** |
| Modificados en esta misión | **0** (todo el recorrido usó datos ficticios del emulador) |

La pantalla diferencia: **confirmado** (sello con responsable y fecha), **pendiente** (motivos explicados), **incorrecto** (fecha que no cae en el corte, fecha anterior al alta, precio 0) y **requiere decisión del propietario** (14 casos que solo necesitan confirmación). Confirmar no cobra, no renueva y no suspende.

## 7. Estado del mecanismo de respaldo

- `backupFirestore`: **PAUSED**. `continuarBackup`: **PAUSED**. Sin exportaciones nuevas ejecutadas.
- Exportación del 29-oct: **completada en el bucket** (6 objetos: `auditoria` + `backups`), manifiesto en **PARCIAL (2 de 10)**.
- Arquitectura revisada y probada en local: **24/24** comprobaciones (`adopción`, no solape, congestión ≠ fallo, referencia temporal común, exclusión del manifiesto).
- **Prueba de restauración integral en entorno aislado: preparada y NO ejecutada.** El procedimiento (exportar del bucket → importar en emulador → verificar conteos) está escrito en `docs/RESPALDO-OPERATIVO.md`, con el resultado previo de KZ-028 (10/10 en emulador).
- Reactivación: documentada paso a paso con condiciones comprobables; **no ejecutada**.

## 8. WhatsApp y MikroTik

| Integración | Estado real |
|---|---|
| WhatsApp Cloud API | **No integrado** (sin token, webhook, plantillas ni consentimiento). No se envió nada. |
| Push FCM | Implementado; **sin tokens registrados** → 0 envíos reales. |
| Correo SendGrid | Solo alertas internas del sistema. |
| Recordatorios | Regla de **dos avisos** (3 días antes y el mismo día, 10:00 America/Bogota) verificada en las suites **22/22 y 19/19**; se **registran** en `notificaciones`, no se envían a clientes. |
| MikroTik | Conservado sin cambios; **ninguna conexión real activada ni suspendida**; estado administrativo y técnico separados. |

## 9. Procedimiento de publicación (no ejecutado)

1. Fusionar `feat/kz-unef-021-pagos-historicos` en `main` (requiere autorización).
2. Desplegar **solo** las funciones nuevas: `confirmarRevisionComercial` (`firebase deploy --only functions:confirmarRevisionComercial`).
3. Verificar `https://konfiozinc.github.io/unefibra/admin/` tras el despliegue de Pages (el flujo `.github/workflows/deploy.yml` publica desde `main`).
4. Revisar de nuevo en el teléfono real con los datos de producción, en modo consulta.
5. Recién entonces, decidir sobre los respaldos (§E del informe KZ-031).

## 10. Procedimiento de reversión

- **Código:** `git revert <commit>` o `git checkout <sha-anterior> -- admin assets functions`; el panel publicado se sirve desde `main`, así que revertir `main` revierte el sitio.
- **Función:** volver a desplegar la versión anterior (`firebase deploy --only functions:confirmarRevisionComercial` con el commit previo) o dejar de usarla: si la función no existe, la pantalla muestra «función no publicada» y queda en modo consulta.
- **Respaldos:** los prefijos del bucket no se tocan; revertir código no afecta a las copias.

## 11. Categorías de entrega

**Verificado en producción (solo lectura):** conteos de clientes/servicios/conciliación; estado de programadores; estado del bucket y del manifiesto; permisos de las funciones desplegadas.

**Verificado solo en local (emulador + navegador real):** alta de cliente, pago, confirmación, renovación, historial, recordatorios, revisión y corrección de datos comerciales, permiso denegado a OPERADOR, cierre de sesión, navegación y medidas en móvil.

**Terminado y listo:** sección «Revisión de clientes», campo de motivo, panel de Inicio con contador, exclusión del manifiesto del respaldo, referencia temporal común (apagada), documentos operativos.

**Requiere autorización:** fusionar, publicar en Pages, desplegar Functions, reanudar respaldos, ejecutar exportaciones.

**Decisiones del propietario:** confirmar los 313 registros con fecha fuera de corte; validar la regla de febrero (corte 30 = último día real); decidir si se activa la renovación por corte; qué hacer con los 121 planes sin precio; integrar WhatsApp.

## 12. Dictamen: NO GO (publicar)

1. **El respaldo no está certificado** (PARCIAL) y las programaciones siguen pausadas: publicar sin red de seguridad no es aceptable.
2. **`confirmarRevisionComercial` no está desplegada**: publicar así dejaría el botón «Guardar y confirmar» sin efecto (hoy responde con un aviso honesto).
3. **Falta la revisión visual humana** de las 34 capturas (limitación de esta sesión, no del producto).
4. Los **313 registros** siguen sin confirmar: es trabajo comercial del propietario, no técnico.

Lo que sí queda listo: código probado (28 suites), recorrido de 24 comprobaciones en verde contra datos ficticios, árbol limpio, bundle verificado y procedimientos escritos.
