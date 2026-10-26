# KZ-UNEF-006 · Migración de servicios y protección operativa

**Estado: preparada y certificada. NO ejecutada.**

Los 333 servicios no se han creado. Este documento describe el mecanismo que
hace que crearlos sea seguro y reversible, y lo que hay que decidir antes.

---

## 1. El riesgo que resuelve

La cartera tiene 358 clientes con datos heredados de una importación de Excel:
plan, precio, ciclo y vencimiento **que nadie ha validado**. Si esos datos
entraran al motor de vencimientos sin más, el sistema empezaría a avisar y a
suspender clientes reales a partir de una fecha importada. Algunos de esos
clientes llevan meses con vencimiento en el pasado.

## 2. Estado de conciliación (el mecanismo)

Cada servicio creado por la migración nace con:

```json
"conciliacion": {
  "estado": "PENDIENTE_VALIDACION",
  "desde": "2026-10-26T00:00:00.000Z",
  "referencia": "kz-unef-006",
  "motivo": "Datos heredados de la importación: pendientes de validación administrativa."
}
```

Mientras esté en ese estado, **seis acciones quedan bloqueadas**:

| Acción | Dónde se bloquea |
|---|---|
| Suspender automáticamente | el motor omite el servicio antes de leer o escribir |
| Emitir avisos o cobros | el motor no llega a la rama de notificaciones |
| Renovar (confirmar un pago) | `confirmarPago` lanza `failed-precondition` y la transacción se revierte |
| Reconectar / reactivar | `cambiarEstadoCliente` rechaza el cambio |
| Cambiar el estado administrativo | igual que el anterior (suspender/activar/desactivar/reactivar) |
| Tocar MikroTik | la escritura ya estaba cerrada; además el servicio no es "accionable" |

**No depende de MikroTik.** El guardia se evalúa sobre el dato guardado, en las
rutas que escriben. Aunque mañana se configuren los secretos `MIKROTIK_*`, sigue
vigente: hay una prueba que pone `MIKROTIK_PERMITIR_ESCRITURA=true` y verifica
que el bloqueo continúa.

**Es explícito, comprobable y reversible**: `servicios/{id}.conciliacion` se lee
con un `get`, y dos callables nuevas lo cambian:

- `validarServicioConciliado` (ADMIN/SUPERADMIN) → `VALIDADA`, con quién y cuándo.
- `rechazarServicioConciliado` (ADMIN/SUPERADMIN) → `RECHAZADA`, con motivo obligatorio.

## 3. Qué crearía la migración (simulación ya ejecutada)

| Concepto | Cantidad |
|---|---|
| Clientes | 358 |
| Servicios actuales | 5 |
| **Migrables** | **333** |
| Omitidos (ya tienen servicio) | 5 |
| Requieren revisión humana | **20** |
| Errores de construcción | 0 |

Cada servicio se construye **copiando** del cliente: `planId`, `precioMensual`,
`estado` derivado del estado del cliente, `fechaInicio` (o `null` si no existe),
`fechaVencimiento`, `cicloCorte` e `ip`. **No se inventa ningún valor**: los 20
clientes a los que les falta plan o precio **no se migran**.

## 4. Idempotencia y reanudación

- El id del documento es determinista: `svc-<clienteId>`.
- Volver a ejecutar no duplica: el segundo intento recibe `409` y se omite.
- Si se interrumpe, se reanuda volviendo a lanzar el mismo comando.
- Nunca se hace `update` sobre un documento existente: la migración **solo crea**,
  así que no puede pisar cambios que un administrador haya hecho después.

## 5. Recuperación (sin borrados a ciegas)

`--revertir` borra **solo** documentos con `origen: "kz-unef-006"` y únicamente
si además:

1. siguen en `PENDIENTE_VALIDACION` (nadie los revisó), y
2. no tienen pagos asociados, y
3. no fueron modificados más de 5 minutos después de crearse.

Cualquier otra cosa se marca **para revisión humana** y no se toca. Un servicio
migrado que ya recibió un pago o una corrección es un servicio con historia: no
se borra.

## 6. Comandos

```
node tools/migrar-servicios.js --json manifiesto.json      # simulacion (por defecto)
node tools/migrar-servicios.js --verificar                 # comprueba asociaciones
node tools/migrar-servicios.js --aplicar --confirmo-clientes-revisados [--limite N]
node tools/migrar-servicios.js --revertir                  # simula la vuelta atrás
node tools/migrar-servicios.js --revertir --confirmo-revertir
```

`--aplicar` sin `--confirmo-clientes-revisados` **se niega** (exit 2).

## 7. Certificación (FASE 5)

`functions/test/migracion-emulador.test.js` — **32 comprobaciones**, con los 11
perfiles sintéticos exigidos. Lo más importante es el **control positivo**: un
cliente vencido con servicio *normal* (sin conciliación) **sí** se suspende; si
todo quedara bloqueado, el guardia estaría roto en la otra dirección.

Cubierto: creación correcta, duplicación rechazada (409), fecha y precio
conservados, ausencia de suspensiones, ausencia de notificaciones, ausencia de
operaciones MikroTik, validación que devuelve el servicio a la operación, rechazo
con motivo, accesos no autorizados (anónimo 401, OPERADOR 403) y reversión
detenida ante actividad posterior.

## 8. Lo que falta para poder migrar

1. Autorización expresa para crear los 333 documentos.
2. Un respaldo verificado inmediatamente antes (procedimiento de KZ-UNEF-004).
3. Decidir qué hacer con los 20 clientes sin plan o sin precio (revisión
   administrativa, uno por uno).
