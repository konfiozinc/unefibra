# Plan de pruebas — UNEFIBRAS SAS

> Guía de verificación funcional. Requiere un proyecto Firebase configurado
> (`README.md → Puesta en marcha`). Puede usarse un proyecto real o los
> emuladores de Firebase (`firebase emulators:start`).

## Prerrequisitos

1. Firebase configurado en `firebase/firebase-config.js` + `assets/js/config.js`.
2. Reglas, índices y funciones desplegados (`firebase deploy`).
3. Un usuario `SUPERADMIN` inicial y al menos un plan y un método de pago.

---

## 1. Autenticación y roles

| # | Prueba | Resultado esperado |
|---|---|---|
| 1.1 | Iniciar sesión con credenciales válidas | Redirige al dashboard |
| 1.2 | Credenciales inválidas | Mensaje claro, sin detalles internos |
| 1.3 | Usuario autenticado sin documento `usuarios/{uid}` o `activo:false` | Se cierra sesión y vuelve al login |
| 1.4 | OPERADOR no ve "Nuevo cliente", "Registrar pago" ni acciones de estado | Solo lectura |
| 1.5 | ADMIN no ve "Usuarios", "Configuración" ni "Auditoría" | Enlaces ocultos |
| 1.6 | Acceso directo a una URL privada sin sesión | Redirige al login |

## 2. Clientes y servicios

| # | Prueba | Resultado esperado |
|---|---|---|
| 2.1 | Crear cliente con documento duplicado | Error "ya existe…", no se crea |
| 2.2 | Crear cliente válido | Se crea + servicio con vencimiento = inicio + duración del plan |
| 2.3 | Suspender / Activar / Desactivar / Reactivar | Cambia estado, actualiza servicio, escribe historial y auditoría |
| 2.4 | Desactivar (INACTIVO) | Conserva historial; NO se elimina de Firestore |
| 2.5 | Ver ficha | Datos, servicio, pagos recientes e historial correctos |

## 3. Planes

| # | Prueba | Resultado esperado |
|---|---|---|
| 3.1 | Crear/editar plan (precio, velocidad, duración) | Se actualiza en Firestore |
| 3.2 | Activar/desactivar plan | Cambia `estado` sin tocar código |
| 3.3 | Landing refleja el precio del plan | Proviene de configuración, no hardcodeado |

## 4. Pagos y renovación

| # | Prueba | Resultado esperado |
|---|---|---|
| 4.1 | Registrar pago | Queda en `PENDIENTE` |
| 4.2 | Confirmar pago | Pago `CONFIRMADO`; servicio renovado (nuevo `fechaVencimiento` = inicio + duración); cliente `ACTIVO`; historial + auditoría |
| 4.3 | Confirmar el mismo pago dos veces | Segundo intento falla (anti-duplicado) |
| 4.4 | Anular pago | Pasa a `ANULADO` |

## 5. Vencimientos (motor `processDueDates`)

| # | Prueba | Resultado esperado |
|---|---|---|
| 5.1 | Servicio a ≤7 días | Cliente pasa a `POR_VENCER` |
| 5.2 | Vencido sin pago que cubra el periodo | Cliente pasa a `PENDIENTE_PAGO` (NO a INACTIVO) |
| 5.3 | Mora ≥ `diasSuspension` | Cliente pasa a `SUSPENDIDO` |

## 6. Notificaciones

| # | Prueba | Resultado esperado |
|---|---|---|
| 6.1 | Ejecutar el motor dos veces el mismo día | No se duplica el recordatorio (clave `clienteId_periodo_tipo`) |
| 6.2 | Enviar notificación manual | Se registra en `notificaciones` y se intenta push a tokens |
| 6.3 | Token inválido/expirado | Se desactiva (`activo:false`) |

## 7. Seguridad

| # | Prueba | Resultado esperado |
|---|---|---|
| 7.1 | No autenticado lee `clientes`/`pagos` | Denegado por reglas |
| 7.2 | OPERADOR intenta `crearCliente` (callable) | Denegado por `verificarRol` |
| 7.3 | Lectura pública de `planes`/`metodos_pago` | Permitida |
| 7.4 | Alta de `solicitudes_contacto` sin campos obligatorios | Denegada por validación |

## 8. Responsive / PWA

| # | Prueba | Resultado esperado |
|---|---|---|
| 8.1 | Landing y panel en móvil/tablet/desktop | Correctos (mobile-first) |
| 8.2 | Service worker registrado / instalable | PWA funciona sobre HTTP(S) |

---

## Criterios de aceptación (sección 51)

| Criterio | Estado |
|---|---|
| Login, crear/activar/suspender/desactivar clientes, registrar/confirmar pagos, vencimiento calculado, por-vencer/pendientes correctos, no-duplicación de notificaciones, permisos/roles, datos en Firestore, móvil, landing pública, precio editable, métodos activables/desactivables, auditoría | ✅ Implementado — **verificar en vivo** tras conectar Firebase |

> Los casos marcados "verificar en vivo" dependen de credenciales Firebase reales;
> la lógica está implementada y lista, no simulada.
