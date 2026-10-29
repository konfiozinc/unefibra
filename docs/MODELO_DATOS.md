# Modelo de datos — UneFibra SAS (Cloud Firestore)

> Documento de referencia del esquema. La fuente de autoridad en ejecución son
> `firebase/firestore.rules` (seguridad) y `functions/src/index.js` (lógica).

## Convenciones

- Los IDs son autogenerados por Firestore (`add()`) salvo `usuarios` y `configuracion`,
  que usan un ID determinista (el `uid` de Auth y una `clave` respectivamente).
- Fechas: se recomienda ISO-8601 string (`YYYY-MM-DD`) para las fechas de negocio
  (vencimiento, inicio, pago) y `serverTimestamp()` para `createdAt/updatedAt`.
- **Los clientes nunca se eliminan**: `estadoCliente = INACTIVO` conserva todo el historial.

---

## Colecciones

### `usuarios` (administradores)
| Campo | Tipo | Notas |
|---|---|---|
| uid | string | ID del documento = UID de Firebase Auth |
| nombre | string | |
| email | string | |
| rol | string | `SUPERADMIN` \| `ADMIN` \| `OPERADOR` |
| activo | boolean | |
| createdAt | timestamp | |

### `clientes`
| Campo | Tipo | Notas |
|---|---|---|
| nombreCompleto | string | obligatorio |
| documento | string | criterio anti-duplicado |
| telefono | string | obligatorio |
| whatsapp | string | |
| email | string | |
| direccion | string | |
| barrio | string | |
| ciudad | string | |
| planId | ref → planes | |
| planNombre | string | denormalizado para lecturas rápidas |
| precioMensual | number | |
| fechaInstalacion | string/date | |
| fechaInicioServicio | string/date | |
| fechaVencimiento | string/date | calculada |
| estadoCliente | string | `ACTIVO`\|`POR_VENCER`\|`PENDIENTE_PAGO`\|`SUSPENDIDO`\|`INACTIVO` |
| estadoServicio | string | `ACTIVO`\|`POR_VENCER`\|`SUSPENDIDO`\|`INACTIVO` |
| metodoPagoPreferido | string | |
| observaciones | string | |
| activo | boolean | |
| createdAt / updatedAt | timestamp | |

### `planes`
| Campo | Tipo |
|---|---|
| nombre | string |
| descripcion | string |
| velocidad | string |
| precio | number |
| duracion | number |
| unidadDuracion | string (`dias`) |
| estado | string (`ACTIVO`/`INACTIVO`) |
| createdAt / updatedAt | timestamp |

### `servicios`
| Campo | Tipo | Notas |
|---|---|---|
| clienteId | ref → clientes | |
| planId | ref → planes | |
| fechaInicio | string/date | |
| fechaVencimiento | string/date | |
| precio | number | |
| estado | string | `ACTIVO`\|`POR_VENCER`\|`SUSPENDIDO`\|`INACTIVO` |
| fechaSuspension | date \| null | |
| fechaActivacion | date \| null | |
| motivoSuspension | string \| null | |

### `pagos`
| Campo | Tipo | Notas |
|---|---|---|
| clienteId | ref → clientes | |
| servicioId | ref → servicios \| null | |
| monto | number | |
| metodoPago | string | de `metodos_pago` |
| fechaPago | string/date | |
| periodoInicio / periodoFin | string/date | lo define `confirmarPago` |
| referencia | string \| null | |
| comprobanteUrl | string \| null | |
| estado | string | `PENDIENTE`\|`CONFIRMADO`\|`RECHAZADO`\|`ANULADO` |
| registradoPor | string | uid |
| createdAt | timestamp | |

### `metodos_pago`
| Campo | Tipo |
|---|---|
| nombre | string |
| tipo | string |
| numeroCuenta | string \| null |
| titular | string \| null |
| descripcion | string \| null |
| activo | boolean |
| orden | number |

Métodos CONFIRMADOS por el cliente: **Nequi**, **Transferencia Bancolombia** y **Efectivo**
(solo nombres; sin números de cuenta ni teléfonos inventados). El número de cuenta
bancaria y el teléfono de Nequi se cargan aparte cuando el cliente los entregue.

### `notificaciones`
| Campo | Tipo | Notas |
|---|---|---|
| clienteId | ref → clientes | |
| tipo | string | `RECORDATORIO_3_DIAS`, `VENCIMIENTO_HOY`, `MANUAL`, … |
| titulo / mensaje | string | |
| fechaProgramada / fechaEnvio | timestamp | |
| estado | string | `PENDIENTE`\|`ENVIADA`\|`ERROR`\|`CANCELADA` |
| periodoServicio | string \| null | |
| canal | string | `PUSH`\|`WHATSAPP`\|`EMAIL` |
| error | string \| null | |
| claveDedup | string | `clienteId_periodo_tipo` (anti-duplicados) |

### `tokens_notificacion`
| Campo | Tipo |
|---|---|
| clienteId | ref → clientes |
| token | string |
| plataforma | string |
| navegador | string |
| activo | boolean |
| fechaRegistro / ultimaActividad | timestamp |

### `historial_estados`
| Campo | Tipo |
|---|---|
| clienteId | ref → clientes |
| estadoAnterior / estadoNuevo | string |
| motivo | string |
| fecha | timestamp |
| usuarioId / usuarioNombre | string |

### `auditoria`
| Campo | Tipo |
|---|---|
| usuarioId / usuarioNombre | string |
| accion | string (`CREAR_CLIENTE`, `REGISTRAR_PAGO`, …) |
| entidad / entidadId | string |
| datosAnteriores / datosNuevos | map \| null |
| fecha | timestamp |
| ip | string \| null (solo si está disponible) |

### `configuracion`
| Campo | Tipo | Ejemplo |
|---|---|---|
| clave | string | `diasAntes`, `diasDespues`, `diasSuspension`, `instalacionGratis` |
| valor | any | `[3]`, `[0]`, `3`, `true` |
| descripcion | string | |

Valores comerciales CONFIRMADOS: `diasAntes=[3]` (recordatorio 3 días antes),
`diasDespues=[0]` (el mismo día), `diasSuspension=3` (suspensión a los 3 días de mora),
`instalacionGratis=true` (instalación $0 COP, sin cobros automáticos).

### `solicitudes_contacto`
| Campo | Tipo | Notas |
|---|---|---|
| nombre / telefono | string | obligatorios |
| whatsapp | string | |
| direccion / barrio / ciudad | string | |
| planInteres | string | |
| observaciones | string | |
| estado | string | `NUEVA`\|`CONTACTADA`\|`EN_PROCESO`\|`INSTALADA`\|`RECHAZADA`\|`CERRADA` |
| createdAt | timestamp | |

---

## Relaciones

```
usuarios (auth.uid) ──(audita)──▶ auditoria
planes ──▶ clientes (planId)
        └─▶ servicios (planId)
clientes ──▶ servicios (clienteId)
         ├─▶ pagos (clienteId)
         ├─▶ notificaciones (clienteId)
         ├─▶ tokens_notificacion (clienteId)
         └─▶ historial_estados (clienteId)
pagos ──▶ servicios (servicioId, opcional)
solicitudes_contacto ──(convertir)──▶ clientes
```

## NOTA KZ-UNEF-028 (29-oct-2026) — recordatorios de pago

La regla de avisos cambió y este documento hablaba de la anterior. Vigente hoy:

- El corte cae el **día del ciclo**: 15 o 30 (en febrero, el último día del mes).
- **Dos avisos por corte**, a las 10:00 de Colombia: **3 días antes** y **el día del corte**.
  Corte 15 -> días 12 y 15 · Corte 30 -> días 27 y 30.
- Quedan **retirados** `configuracion.diasAntes` y `configuracion.diasDespues`: si existen se ignoran.
  Sigue vigente `configuracion.diasSuspension`.
- La implementación está en `functions/src/recordatorios.js`; el detalle completo, en `docs/CICLOS_DE_CORTE.md`.

