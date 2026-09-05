# Modelo de datos — UNEFIBRAS SAS (Cloud Firestore)

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

### `notificaciones`
| Campo | Tipo | Notas |
|---|---|---|
| clienteId | ref → clientes | |
| tipo | string | `RECORDATORIO_7_DIAS`, `MORA_1_DIAS`, `MANUAL`, … |
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
| clave | string | `diasAntes`, `diasDespues`, `diasSuspension` |
| valor | any | `[7,5,3,1]`, `[0,-1,-3]`, `5` |
| descripcion | string | |

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
