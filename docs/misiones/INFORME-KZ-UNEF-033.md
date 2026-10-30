# INFORME KZ-UNEF-033 — Optimización final del panel y preparación de entrega

**Cliente:** UneFibra SAS · **Panel:** https://konfiozinc.github.io/unefibra/admin/ (sin publicar)
**Rama:** `feat/kz-unef-021-pagos-historicos` · **Fecha:** 30-oct-2026
**Dictamen:** **NO GO para publicar** (bloqueos en §7). La versión candidata está lista y verificada.

---

## 1. Revisión de clientes simplificada

**Antes:** cada tarjeta mostraba el resumen **y** los cuatro controles del formulario a la vez (una lista de 327 registros era un muro de campos).
**Ahora:** la tarjeta muestra solo lo que el propietario necesita para decidir, y el formulario aparece al pulsar **«Revisar cliente»**.

Resumen visible de cada cliente:

| Dato | Cómo se ve |
|---|---|
| Nombre | Encabezado de la tarjeta |
| Plan contratado | «Plan: **Hogar 60 Mbps**» (o «sin plan») |
| Valor mensual | «Valor mensual: **$ 60.000**» (o «sin valor») |
| Día de corte | «Corte: **día 30**» |
| Fecha de cobro | «Fecha de cobro: **30/11/2026**» |
| Estado de revisión | Insignia **Por revisar** (ámbar) / **Confirmado** (verde) |
| Motivo pendiente | Bloque «Qué falta confirmar» con el texto en lenguaje comercial |

Al pulsar **Revisar cliente** se despliega el formulario (valor, día de corte, fecha, y el motivo cuando corresponde) con **Guardar y confirmar** y **Cancelar**. El botón cambia a «Ocultar formulario» y se anuncia con `aria-expanded`; al abrir, el foco va al primer campo.

**Se conserva todo lo certificado:** validaciones (fecha debe caer en el día de corte, precios > 0, corte 15/30), registro de responsable y fecha (`revisionComercial`), motivo obligatorio si el cliente ya tiene pagos, historial en `auditoria`, y la garantía de que **confirmar no habilita el cobro** (`conciliacion.estado` no cambia). **No se tocó la API ni ninguna regla comercial.**

Además, tras guardar, esa tarjeta vuelve a aparecer **abierta con su mensaje**, en vez de perder el aviso al repintar la lista.

**Evidencia de que la renovación respeta el corte** (recorrido real de hoy): el cliente ficticio del corte 30 quedó con **vencimiento 2026-11-30** al confirmar el pago, no el 29.

---

## 2. Experiencia móvil

Medido en navegador real a 375×667:

| Comprobación | Resultado |
|---|---|
| Resumen plegado por defecto (0 formularios abiertos sin pulsar) | ✅ |
| Botón principal «Revisar cliente» | **305×48 px** (ancho completo de la tarjeta, alto táctil ≥44) |
| Campos del formulario al abrirlo | 4 controles visibles, primero de **49 px** de alto |
| Menú lateral: seis entradas + «Más opciones» | ✅ |
| Desborde horizontal en 6 pantallas | **0 casos** |
| Cierre de sesión desde el menú móvil | ✅ |
| Errores de consola en todo el recorrido | **0** |

Añadido CSS específico para móvil: botones de ancho completo con 48 px de alto, campos de 44 px mínimo, tipografía de tarjeta legible y formulario en una columna.

---

## 3. Lógica comercial conservada

Sin cambios en: cortes 15/30 y febrero (último día real), renovación al día de corte, registro de pagos, historial y auditoría, prevención de duplicados, y los **dos recordatorios** a las 10:00 (3 días antes y el día del vencimiento). Los **327 servicios sin confirmar siguen fuera de cobros y suspensiones automáticas**.

**Suite completa: 29 suites, 0 fallos.**

---

## 4. Pantallas revisadas

Escritorio (1440×900) y móvil (375×667): **Inicio, Clientes, Vencimientos, Pagos, Recordatorios, Planes, Revisión de clientes, Más opciones, formularios (alta de cliente, pago, aviso) y cierre de sesión**. Recorrido de 15 pasos: **15/15 en escritorio** y **M1-M5 en móvil**, más **5/5** comprobaciones específicas de la tarjeta nueva.

**Evidencias:** `docs/evidencias/kz-unef-032/capturas/` — **38 capturas**, con `index.html` como galería. Nuevas de esta misión: `14-revision-plegada.png`, `15-revision-formulario.png`, `m5-resumen-plegado.png`, `m6-formulario-abierto.png`.

> **Límite declarado:** las capturas se generan y se miden por código, pero **no las inspecciono visualmente** (este modelo no acepta imágenes). La revisión visual humana sigue pendiente y es uno de los bloqueos del dictamen.

---

## 5. Respaldo y seguridad

- Programaciones de producción: **PAUSED** (`backupFirestore`, `continuarBackup`). **No se ejecutaron exportaciones ni despliegues.**
- Estado real del respaldo del 29-oct: **PARCIAL** (2 de 10 colecciones con objetos completos: `auditoria` y `backups`).
- Lo exportado **contiene datos reales**: se contrastó el binario de `auditoria` con producción y **3 de 3** documentos (ids y valores) aparecen dentro del archivo.

**Criterios para poder declarar el respaldo recuperable** (todos exigibles, hoy falta el punto 3):

1. Manifiesto del día con **todos los lotes en `COMPLETADO`**.
2. Por colección: `*.overall_export_metadata` + archivos de datos, sin duplicados en el prefijo.
3. **Restauración efectiva**: importar el export en una base aislada y verificar **conteos por colección iguales** a los de origen (clientes 358, servicios 332, historial 10, auditoria 16, planes 10, metodos_pago 5, usuarios 2, clientes_hoja3_4_backup 60).
4. Consulta de comprobación sobre la base restaurada (p. ej. clientes con su plan y corte) que devuelva los mismos agregados.
5. Registro firmado de la prueba (fecha, qué prefijo, qué conteos, quién).

El punto 3 requiere `gcloud firestore import` (Cloud SDK) o `firebase emulators:start --import` en una instancia aparte; **está preparado y no ejecutado**.

---

## 6. Pruebas integrales

Recorrido completo con datos ficticios, ejecutado hoy: registrar cliente → asignar plan → ciclo de corte → consultar vencimiento → registrar pago → confirmar → **renovación verificada al día de corte** → consultar historial → abrir Revisión de clientes → corregir un valor con motivo → comprobar sello y auditoría → permiso denegado a OPERADOR → cerrar sesión.

| Batería | Resultado |
|---|---|
| Suite de Functions | **29 suites, 0 fallos** |
| Recorrido escritorio | **15/15** |
| Recorrido móvil | **M1-M5 ✅** |
| Tarjeta nueva (plegado, tamaños, apertura) | **5/5** |
| Errores de consola | **0** |

---

## 7. Entrega y dictamen

| Dato | Valor |
|---|---|
| Rama | `feat/kz-unef-021-pagos-historicos` |
| Commit | el de este informe (`git log -1`) |
| Archivos modificados | `admin/revision-clientes.js`, `admin/revision-clientes.html`, evidencias e informe |
| Compilación / sintaxis | `node --check` en los archivos tocados; panel servido y ejecutado en navegador real |
| Respaldo del código | `_respaldos/unefibra/2026-10-30-kz-033/*.bundle` |
| Riesgos restantes | respaldo PARCIAL; `confirmarRevisionComercial` sin desplegar; panel sin publicar; 327 registros sin confirmar; 121 planes sin precio; revisión visual humana pendiente |

### Dictamen: **NO GO** para publicar

1. **Respaldo en PARCIAL**: falta cerrar los 8 lotes pendientes y ejecutar la restauración efectiva del punto 5.3.
2. **`confirmarRevisionComercial` no está desplegada**: `node tools/verificar-publicacion.js` sigue bloqueando por eso (y por el panel aún no publicado).
3. **Revisión visual humana** de las 38 capturas pendiente.
4. Decisiones del propietario: 327 registros por confirmar, 121 planes sin precio, regla de febrero a validar.

**GO cuando:** el respaldo esté `COMPLETADO` con restauración verificada, la función esté desplegada con autorización, la puerta de publicación diga «LISTO PARA PUBLICAR» y el propietario haya visto las pantallas.
