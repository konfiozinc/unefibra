# KZ-UNEF-005 · Respaldos de Firestore y auditoría funcional del panel

---

## PARTE 1 · Respaldos (corrección P1)

### 1.1 El defecto real

El respaldo diario del **25-oct a las 08:00 UTC falló**:

```
Error: Exportación Firestore falló (503): "Deadline expired before operation could complete."
Function execution took 60977 ms, finished with status: 'error'
```

El código anterior hacía `POST …:exportDocuments`, veía un `200` y daba la
tarea por buena. Un `200` en esa llamada solo significa **encolada**: la
operación puede fallar minutos después. Además no había reintentos, ni
comprobación de que los archivos existieran, ni alerta que llegara.

### 1.2 Qué se implementó (`functions/src/backup.js`, reescrito)

| Requisito | Cómo se cumple |
|---|---|
| Reintentos con espera progresiva | `esperaProgresiva()`: 2 s, 4 s, 8 s… con techo y jitter |
| Límite máximo de intentos | `intentosMax` (por defecto 4) |
| Prevención de ejecuciones simultáneas | cerrojo en `configuracion/backupEnCurso` con caducidad (30 min) |
| Registro de inicio y fin | `console.log` estructurado + `intentos[]` en el resultado |
| Confirmación `done=true` | sondea la operación hasta `done`, con plazo propio |
| Comprobación de existencia | lista el bucket y exige metadato global **y** archivos de datos |
| Detección de incompletos | `evaluarObjetos()` distingue «empezó» de «terminó» |
| Alerta si falla definitivamente | el cron alerta cuando `requiereAlerta`; si el correo falla, el fallo no se enmascara |
| Permisos sin exponer credenciales | solo usa el token de la cuenta de servicio en memoria |
| Retención documentada | `daily/` lo poda la regla de ciclo de vida a 30 días; `pre-<misión>/` queda fuera de esa poda |

Distinción clave ahora explícita en la API: los estados son `COMPLETADO`,
`OMITIDO` (otra corrida en curso), `FALLIDO`, `FALLIDO_DEFINITIVO`. Una
exportación **iniciada** nunca se reporta como **completada**.

### 1.3 Pruebas (8 escenarios exigidos + 3 de unidad)

`functions/test/backup.test.js` — **17 comprobaciones, todas en verde**, sin
red, sin Firestore y sin generar ninguna exportación real:

| # | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| 1 | Respaldo exitoso | `COMPLETADO` con objetos verificados | ✅ |
| 2 | Primer intento falla, segundo funciona | reintenta y completa | ✅ |
| 3 | 503 persistente | agota intentos, `FALLIDO`, pide alerta | ✅ |
| 4 | Falta de permisos | `FALLIDO_DEFINITIVO` sin reintentar | ✅ |
| 5 | Bucket inaccesible | no da por bueno el respaldo | ✅ |
| 6 | Exportación incompleta | metadatos sin datos ⇒ error | ✅ |
| 7 | Dos ejecuciones simultáneas | la segunda `OMITIDO` | ✅ |
| 8 | Error al enviar la alerta | el fallo del respaldo no se pierde | ✅ |

Extra: clasificación transitorio/definitivo, `evaluarObjetos` y crecimiento de
la espera con techo.

### 1.4 Lo que sigue pendiente

- **Comprobar que la alerta por correo llega de verdad.** El 25-oct no hay
  rastro de `enviarAlertaError` en los logs de esa ventana: la función falló y
  el correo no aparece. Hay que probar el camino de alerta con un fallo
  provocado (requiere autorización).
- La corrida real del cron nuevo no se ha ejecutado (no se despliega en esta
  misión); su primera ejecución será la de las 03:00 del día siguiente al
  despliegue.

---

## PARTE 2 · Modelo de datos: el caso `POR_VENCER`

### 2.1 Qué se encontró

Cliente `kELI0y5UyRI5QF5Xe7bQ` con `estadoCliente: "POR_VENCER"`.

Los catálogos son distintos:

| Ámbito | Estados válidos |
|---|---|
| Cliente | `ACTIVO` · `PENDIENTE_PAGO` · `SUSPENDIDO` · `INACTIVO` |
| Servicio | `ACTIVO` · `POR_VENCER` · `SUSPENDIDO` · `INACTIVO` |
| Pago | `PENDIENTE` · `CONFIRMADO` · `ANULADO` |

`POR_VENCER` describe que **al servicio** le quedan ≤7 días. En el cliente no
significa nada.

### 2.2 Dónde se mezclan

- `functions/src/index.js` escribe `estadoServicio` en el cliente **y** `estado`
  en el servicio: es la fuente de la duplicidad.
- El motor marca `POR_VENCER` al servicio cuando faltan ≤7 días, y un import o
  una corrección manual pudieron copiarlo al cliente.
- El panel (`assets/js/admin/ui.js`) solo conoce el catálogo de cliente, así que
  pinta ese valor sin etiqueta.

### 2.3 Consecuencias medidas

- **Filtros**: un cliente con estado fuera del modelo desaparece de los filtros
  por estado y solo se ve en «Todos».
- **Cobros**: el motor no lo trata como mora (`PENDIENTE_PAGO`), así que no le
  aplica el circuito de aviso ni de suspensión.
- **Automatizaciones**: cualquier condición que compare con `PENDIENTE_PAGO` lo
  ignora.

### 2.4 Corrección preparada

Nuevo módulo `functions/src/estados.js`, única definición de los tres catálogos,
con:

- `diagnosticarEstado(valor, ámbito)` → valida y dice a qué ámbito pertenece.
- Equivalencia explícita `POR_VENCER → PENDIENTE_PAGO` en el cliente
  (`NORMALIZAR_A_CLIENTE`) y `PENDIENTE_PAGO → POR_VENCER` en el servicio.
- `verificarCoherencia(estadoCliente, estadoServicio)` para detectar pares
  imposibles (`ACTIVO` con servicio `SUSPENDIDO`).

**No se modificó el documento real.** La normalización de datos es una escritura
en producción y requiere autorización aparte; el diagnóstico ya está probado
(`functions/test/modelo-datos.test.js`).

---

## PARTE 3 · Auditoría funcional del panel (15 pantallas)

Método: lectura del código de cada pantalla + carga en navegador real de las 15
(sesión no disponible: la validación con credenciales reales queda **pendiente**).

| Criterio exigido | Resultado |
|---|---|
| 1. Diferencia cliente y servicio | **Parcial.** Clientes y Servicios son pantallas distintas, pero el cliente guarda `estadoServicio` y no se muestra su servicio asociado salvo en la ficha (`cliente.js`) |
| 2. No presenta datos incompletos como confirmados | **Aceptable.** Los campos vacíos se pintan `—`; no hay valores por defecto inventados |
| 3. No muestra pagos ficticios | **Bien.** `pagos` solo se lee; no hay datos de ejemplo en producción (0 pagos) |
| 4. Permite identificar clientes sin servicio | **Corregido en esta misión**: la pantalla Servicios ahora avisa cuántos clientes no tienen servicio asociado |
| 5. Muestra advertencias ante información inconsistente | **Parcial.** Se añadió el aviso de cartera sin servicio; un estado fuera del modelo sigue sin destacarse |
| 6. No permite acciones peligrosas sobre asociaciones ambiguas | **Bien.** Las acciones de estado van por callables con validación de rol; no hay alta masiva |
| 7. Mantiene las restricciones de seguridad de KZ-UNEF-004 | **Bien.** Sin cambios en reglas; verificado en producción con 10 comprobaciones |

### Cambio aplicado en el panel

`admin/servicios.js`: al cargar la lista compara clientes con servicios y, si
hay clientes sin servicio, muestra un aviso con el número real explicando que no
aparecen en la lista y que el motor no los alcanza. Antes la pantalla mostraba
5 filas como si fuera toda la cartera.

### Pendiente de validación (declarado, no aprobado)

- Inicio de sesión con cuenta real y permisos por rol en las 15 pantallas.
- Ejecución de una renovación y una anulación desde la interfaz con datos
  reales: **no se hizo** y no debe hacerse sin autorización.
