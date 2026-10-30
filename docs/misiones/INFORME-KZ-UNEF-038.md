# INFORME KZ-UNEF-038 — Publicación oficial del panel administrativo

**Autorización:** Darwin Montalvo, 30-oct-2026 · **Rama candidata:** `feat/kz-unef-021-pagos-historicos` @ `d76433c`
**Publicado en `main`:** merge **`ccce3a9`** · **Panel:** https://konfiozinc.github.io/unefibra/admin/dashboard.html
**Dictamen:** **GO** — panel publicado, verificado y con la revisión comercial disponible.

---

## 1. Commit publicado

| Dato | Valor |
|---|---|
| `main` antes | `38b5cf9` (KZ-018) |
| Rama candidata | `feat/kz-unef-021-pagos-historicos` @ `d76433c` |
| **Commit de merge publicado** | **`ccce3a9`** (`--no-ff`, historial conservado y reversible) |
| Contenido | **32 commits · 123 archivos · ~10.000 líneas** |
| Push | `38b5cf9..ccce3a9 main -> main` (SSH) |

## 2. Función desplegada

| Dato | Valor |
|---|---|
| Función | **`confirmarRevisionComercial` v1 ACTIVE** · creada 2026-10-30T09:30:32Z |
| Alcance | **1 de 29 funciones** del proyecto; las demás intactas |
| Autorización por roles | llamada anónima → **HTTP 401** `UNAUTHENTICATED` «Debes iniciar sesión» ✔ |
| No modifica | pagos, `conciliacion.estado`, suspensiones ni notificaciones (probado 21/21 en emulador, KZ-033) |

## 3. Resultado de las pruebas

| Batería | Resultado |
|---|---|
| Suites puras ejecutadas hoy | **16 en verde** (`backup-lotes` 25/25, `revision-comercial` 21/21, paridad 8/8, `renovacion-corte` 13/13, `renovacion-ciclo` 11/11, `recordatorios` 22/22, `conciliacion-fechas` 19/19, `pagos-guardas`, `renovacion`, `modelo-datos`, `mikrotik`, `cableado-*`, `conciliacion`) |
| Suite que no pudo ejecutarse | `pagos-historicos-emulador`: requiere el emulador, que no estaba activo en esta sesión |
| Última corrida completa sobre este código | **29 suites / 0 fallos** + recorrido **15/15 escritorio** y **M1-M5 móvil** (KZ-033) |
| Protección de los 327 pendientes | **327 `PENDIENTE_VALIDACION`** intactos; el motor los ignora |
| Confirmar revisión ≠ habilitar cobro | probado: no cambia `conciliacion.estado` |
| Pagos automáticos / notificaciones / MikroTik | no se ejecutó ninguno |
| Precios faltantes | no se inventaron (121 planes sin precio siguen sin precio) |
| Datos del emulador en producción | el panel solo usa el emulador con `?emulador=1`; en producción va a `une-fibra` |
| Regla de febrero | corte 30 = último día real (28 o 29), sin cambios |

## 4. Evidencia de publicación en GitHub Pages

Verificado **después** del push (no se dio por hecho):

| Comprobación | Resultado |
|---|---|
| `admin/revision-clientes.html` | **HTTP 200** (antes daba 404) ✔ |
| `admin/dashboard.html` | HTTP 200 ✔ |
| `admin/revision-clientes.js` | HTTP 200 · contiene «Revisar cliente» y «Motivo del cambio» ✔ |
| `assets/js/admin/revision-reglas.js` | HTTP 200 ✔ |
| `assets/js/admin/shell.js` | contiene la entrada de menú `revision-clientes.html` ✔ |
| `node tools/verificar-publicacion.js --despues` | **«LISTO PARA PUBLICAR — todas las funciones necesarias están desplegadas»** (exit 0) ✔ |

## 5. Verificación en navegador real (sitio publicado)

| Comprobación | Resultado |
|---|---|
| `index.html` del panel | **renderiza el formulario de acceso** · título «Acceso — UneFibra» ✔ |
| `revision-clientes.html` sin sesión | **redirige al login** ✔ (control de acceso efectivo) |
| Errores de consola | **ninguno** ✔ |

**Límite declarado:** no dispongo de credenciales de producción, así que **no pude iniciar sesión como SUPERADMIN en el sitio publicado**. Las comprobaciones autenticadas (navegar las seis pantallas con datos reales, abrir el formulario de revisión, verificar roles y cerrar sesión) quedan para Darwin — el mismo flujo está verificado en el emulador con el recorrido de 15 pasos y en el sitio solo falta la sesión real.

## 6. Estado de clientes y servicios (solo lectura, hoy)

**358 clientes · 332 servicios** (327 `PENDIENTE_VALIDACION` + 5 fuera del motor) · `auditoria` 16 · `planes` 10 · `metodos_pago` 5 · `usuarios` 2 · `clientes_hoja3_4_backup` 60 · `configuracion` 4.

**Ningún documento comercial fue modificado.** Los únicos escritos de la jornada son el manifiesto de respaldo y el cerrojo.

## 7. Estado de los respaldos

| Elemento | Estado |
|---|---|
| `backups/2026-10-30` | **9/9 `COMPLETADO`** (2026-10-30T09:16:03Z) |
| `backupFirestore` | **ENABLED** · próxima **2026-10-31T08:00Z** (03:00 Bogotá) |
| `continuarBackup` | **ENABLED** |
| Exportaciones activas | **0** |
| Respaldos históricos | intactos (0 objetos escritos hoy en los prefijos del 28 y 29-oct) |

## 8. Restricciones comerciales confirmadas

- Los **327 servicios pendientes** siguen fuera de cobros y suspensiones automáticas.
- Confirmar una revisión **no** habilita el cobro ni cambia la conciliación.
- **No** se crean pagos automáticamente, **no** se envían notificaciones y **no** se ejecutan órdenes de MikroTik.
- **No** se inventaron precios: los 121 planes sin valor siguen sin valor.
- WhatsApp Cloud API y notificaciones reales permanecen **sin activar**.
- MikroTik: estado administrativo y técnico siguen separados.

## 9. Problemas detectados y acciones

| # | Problema | Acción |
|---|---|---|
| 1 | El commit de KZ-036 incluyó **bundles de respaldo del código** (`_respaldos/…/kz-036/*.bundle`, 56,94 MB): GitHub avisó de que supera su recomendación de 50 MB. | Se documenta. **Recomendación:** añadir `_respaldos/` a `.gitignore` y, si se quiere aligerar el repo, sacar esos archivos en un commit posterior con `git rm --cached` (no destructivo para los archivos locales). **No se hizo** en esta misión para no alterar la publicación recién hecha. |
| 2 | No pude ejecutar la suite `pagos-historicos-emulador` (emulador inactivo). | Se declara; el resto de la batería y el recorrido de KZ-033 cubren ese flujo. |
| 3 | Sin credenciales de producción no hay verificación autenticada en el sitio publicado. | Se entrega la lista exacta de comprobaciones para Darwin (§5). |

## 10. Procedimiento de reversión

**Commit y versión previa registrados:** `main` estaba en `38b5cf9`; la función `confirmarRevisionComercial` **no existía** antes de esta misión (v1 es la primera).

**Si algo falla:**

```bash
git revert -m 1 ccce3a9      # deshace el merge conservando todo el historial
git push origin main         # GitHub Pages vuelve a publicar el panel anterior
```

- **Panel:** Pages sirve de nuevo `38b5cf9` (el panel de KZ-018). El enlace oficial no cambia.
- **Función:** sin `confirmarRevisionComercial` el panel sigue funcionando; «Guardar y confirmar» muestra el aviso honesto de función no publicada (comportamiento ya probado). Si se prefiere, se puede borrar la función: `firebase functions:delete confirmarRevisionComercial`.
- **Datos y respaldos:** no se tocan. El código se revierte; los datos no.
- **No usar** `push --force` ni borrar ramas para revertir.

---

## Dictamen final

# GO

- **Panel publicado** en el enlace oficial: `admin/dashboard.html` y `admin/revision-clientes.html` responden **200**; el contenido servido es la versión nueva («Revisar cliente», «Motivo del cambio», entrada de menú).
- **Función desplegada**: `confirmarRevisionComercial` v1, con autorización por roles (401 en anónimo) y sin tocar pagos, conciliación ni suspensiones.
- **Verificación real, no declarativa**: la puerta de publicación pasó a «LISTO», y el sitio se comprobó en navegador (login renderiza, control de acceso redirige, cero errores de consola).
- **Datos y respaldos intactos**: 358 clientes, 332 servicios, 327 pendientes protegidos; respaldo del 30-oct 9/9; ambos programadores ENABLED.

**Pendiente de Darwin (no técnico):** entrar con su cuenta al panel publicado y recorrer las seis pantallas para dar el visto bueno visual; a partir de ahí, ir confirmando los 327 registros desde «Revisión de clientes», uno a uno, con su criterio comercial.
