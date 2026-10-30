# CIERRE DE ACEPTACIÓN KZ-UNEF-032 — Dictamen final

**Versión candidata:** rama `feat/kz-unef-021-pagos-historicos` · commit de este cierre (ver `git log -1`)
**Panel:** https://konfiozinc.github.io/unefibra/admin/ (sin publicar) · **Fecha:** 30-oct-2026
**Dictamen: NO GO para publicar.** Bloqueos concretos al final; la corrección comercial queda hecha y certificada.

---

## 1. Coherencia comercial — por qué el cliente del corte 30 vencía el 29-dic

**Explicación.** Al confirmar un pago, `confirmarPago` construía el periodo sumando la **duración del plan (30 días fijos)** a la fecha de vencimiento. El cliente de prueba se había creado el 30-oct (vencimiento 29-nov por el alta) y, al confirmar el pago, el sistema volvió a sumar 30 días: **29-nov + 30 = 29-dic**. Un cliente del corte 30 debe vencer el **30**. Ese es el mismo defecto que KZ-029 había detectado y dejado desactivado por ser decisión comercial.

**Corrección aplicada (local, sin desplegar):**

- `functions/src/vencimientos.js` → nueva función pura **`renovarAlCorte({ ciclo, base })`**: el vencimiento nuevo es **siempre el siguiente día de corte** (15 o 30; en febrero y meses de 30 días, el último día real del mes). Si la fecha venía desviada, la **devuelve a su corte**.
- `functions/src/index.js` → `confirmarPago` usa `renovarAlCorte` cuando el cliente tiene `cicloCorte`. **Sin ciclo se conserva el cálculo anterior**, para no alterar a quien todavía no tiene corte asignado.

**Certificación local (`functions/test/renovacion-corte.test.js`, 13/13):**

| Caso | Resultado |
|---|---|
| Corte 30 pagando el 30-nov | **2026-12-30** (antes: 29-dic) |
| Corte 15 pagando el 15-nov | 2026-12-15 |
| Fecha desviada (29-nov, ciclo 30) | vuelve a 2026-11-30 |
| 12 renovaciones seguidas (corte 30 y corte 15) | todas caen en día de corte |
| Febrero 2026 (28) y 2028 bisiesto (29) | 2026-02-28 · 2028-02-29 |
| Abril (mes de 30 días) | 2026-04-30 |
| Cambio de año (30-dic, 15-dic) | 2027-01-30 · 2027-01-15 |
| Sin ciclo / fecha inválida | no inventa periodo |

**Suite completa: 29 suites, 0 fallos.** Ningún cliente real fue modificado: todo se probó en el emulador con datos ficticios.

> **Efecto en producción:** ninguno. El cambio está en el código de la rama y **no se ha desplegado**; producción sigue con el comportamiento anterior hasta que se autorice el despliegue.

---

## 2. Revisión visual

- **34 capturas** en `docs/evidencias/kz-unef-032/capturas/` (3,3 MB).
- **Galería para revisión humana:** `docs/evidencias/kz-unef-032/capturas/index.html` (abrir en el navegador). Incluye las pantallas principales con su tamaño real:

| Captura | Pantalla | Medidas |
|---|---|---|
| `01-inicio.png` | Inicio con indicadores, cortes, avisos y panel de revisión | 1440×900 |
| `03-cliente-con-plan-y-corte.png` | Clientes: alta con plan y ciclo | 1440×900 |
| `05-formulario-pago.png` | Pagos: formulario de registro | 1440×900 |
| `06-pago-confirmado.png` | Pagos: pago confirmado | 1440×900 |
| `04-vencimientos.png` | Vencimientos: al día / por vencer / vencidos | 1440×900 |
| `09-revision-clientes.png` | Revisión de clientes: qué falta, valor, corte, fecha | 1440×900 |
| `10-revision-corregida.png` | Revisión: corrección guardada | 1440×900 |
| `m1-inicio.png` · `m3-revision.png` · `m2-menu.png` | Mismas pantallas en móvil 375×667 | 375×667 |

**Lo que sí verifiqué programáticamente:** textos visibles de cada pantalla, presencia de los seis accesos del menú, ausencia de desborde horizontal en seis pantallas a 375 px (0 casos), ausencia de errores de consola (0), y las dimensiones reales de cada archivo.

**Límite que declaro:** **no he inspeccionado las imágenes visualmente** (el modelo de esta sesión no acepta imágenes). Esa revisión queda en la galería `index.html` para el propietario o para un agente con visión.

---

## 3. Respaldo — recuperabilidad de lo exportado

**Verificación de contenido (aislada, sin tocar producción):**

| Paso | Resultado |
|---|---|
| Descarga de `daily/2026-10-29/auditoria/` desde el bucket (solo lectura) | **3 objetos** (metadato global, metadato de colección, `output-0` de 10.997 bytes) |
| Contraste del binario exportado con los documentos reales | **3 de 3** documentos de producción localizados dentro del archivo (ids y valores de campos presentes) |
| Estructura del export | Manifiesto global + metadato de la colección + datos: la estructura que exige una restauración |

**Restauración completa a una base: preparada y NO ejecutada.** El emulador de Firestore de esta versión **no expone `:import` por REST** (responde 404); la restauración se hace por CLI:

```
firebase emulators:start --only firestore --project demo-restauracion --import "C:\KZ-EVIDENCIA\kz-unef-032\restauracion\auditoria"
```

…y en producción, con Cloud SDK: `gcloud firestore import gs://unefibra-firestore-backups/daily/<fecha>/<coleccion>`.

Programaciones de respaldo: **PAUSED** (`backupFirestore` y `continuarBackup`). **No se ejecutó ninguna exportación real nueva.**

---

## 4. Publicación coordinada

**Herramienta nueva:** `tools/verificar-publicacion.js` — puerta de publicación, solo lectura. Ejecutada hoy contra producción:

```
BLOQUEO función confirmarRevisionComercial   NO DESPLEGADA
OK      función backupFirestore              ACTIVE v11
OK      función continuarBackup              ACTIVE v4
OK      archivos del panel (4)               presentes
BLOQUEO página del panel responde            HTTP 404
RESULTADO: NO PUBLICAR todavía — 2 requisito(s) sin cumplir
```

**Procedimiento exacto (nada ejecutado):**

1. `node tools/verificar-publicacion.js --antes` → deja constancia de los bloqueos.
2. Desplegar **solo** la función nueva: `firebase deploy --only functions:confirmarRevisionComercial --project une-fibra`.
3. `node tools/verificar-publicacion.js --despues` → debe salir **LISTO PARA PUBLICAR** (exit 0).
4. Fusionar la rama en `main` (dispara el flujo de Pages).
5. Comprobaciones posteriores: abrir `https://konfiozinc.github.io/unefibra/admin/`, iniciar sesión, abrir **Revisión de clientes**, guardar **un solo** registro ficticio o el primero real acordado, y confirmar que aparece en **Historial de cambios** con responsable y fecha.
6. **Reversión:** `git revert <merge>` en `main` (el panel se sirve desde `main`) y, si hace falta, redesplegar la versión anterior de la función. Los respaldos del bucket no se tocan.

**Regla que evita el fallo de KZ-031:** el panel publicado sin su función deja botones sin efecto. El paso 3 impide publicar en ese estado, y el paso 5 lo detecta después.

---

## 5. Seguridad comercial

- Los **327 servicios en conciliación** siguen `conciliacion.estado = PENDIENTE_VALIDACION` (medido hoy): el motor **no los cobra ni los suspende**.
- `puedeRenovar` bloquea la renovación por pago de un servicio en conciliación (probado en `pagos-*`).
- `confirmarRevisionComercial` **no toca** `conciliacion.estado`, ni `pagos`, ni `notificaciones` (probado en `revision-comercial-emulador`, 21/21): confirmar un dato no habilita el cobro.
- Con la corrección de §1, la renovación ahora respeta el corte, pero **solo se aplicará cuando la función se despliegue** con autorización.

---

## Dictamen y bloqueos restantes

| # | Bloqueo | Quién lo desbloquea |
|---|---|---|
| 1 | `confirmarRevisionComercial` sin desplegar (la puerta lo detecta) | Autorización de despliegue |
| 2 | Panel no publicado (HTTP 404 en la dirección oficial) | Autorización de merge/publicación |
| 3 | Respaldo en **PARCIAL** y programaciones **PAUSED** | Autorización para reanudar |
| 4 | Revisión **visual humana** de las 34 capturas | Propietario / agente con visión |
| 5 | 313 registros con fecha fuera de corte y 121 planes sin precio | Decisión comercial del propietario |

**Lo que queda listo y probado:** corrección comercial certificada (13/13 + 29 suites), recorrido de 24 comprobaciones en navegador real con 34 capturas, verificación de que lo exportado contiene los datos reales, puerta de publicación automatizada y procedimientos de publicación y reversión escritos.
