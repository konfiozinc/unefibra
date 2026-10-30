# Reglas de cobro y vencimiento — UneFibra SAS (KZ-UNEF-031)

Documento de la **regla comercial** que el sistema aplica. Todo lo que dice aquí está implementado y probado; lo que falta de aprobación del propietario está marcado.

## 1. Cortes

- Cada cliente pertenece a **un corte: día 15 o día 30** (`cicloCorte`).
- Un cliente **no cambia de corte** salvo corrección explícita (queda registrada con responsable y fecha).
- El corte **no se calcula sumando 30 días**. Se calcula por día de calendario: el 15 o el 30 del mes que toca.

## 2. Meses sin día 30 (febrero y compañía)

| Mes | Corte 15 | Corte 30 |
|---|---|---|
| Enero, marzo, mayo, julio, agosto, octubre, diciembre | 15 | 30 |
| Abril, junio, septiembre, noviembre | 15 | **30** (tienen 30 días) |
| Febrero (28 días) | **28** | **28** |
| Febrero bisiesto (29 días) | **29** | **29** |

Regla: `día de corte efectivo = mínimo(corte, último día real del mes)`. **Nunca** se corre al 1 de marzo ni al mes siguiente: el cobro del corte 30 de febrero es el **28 de febrero** (o 29). Está implementado en `functions/src/vencimientos.js` (`fechaDeCorte`, `ultimoDiaDelMes`) y en el panel (`diaCorteDeMes`, `proximoCorteDe`).

**Necesita confirmación del propietario:** que el corte de febrero se cobre el último día real (es la regla implementada) y no el 28 fijo.

## 3. Renovación de un pago

- Al confirmar un pago, el vencimiento se mueve al **siguiente corte del ciclo del cliente** — no a «fecha de pago + 30 días».
- `renovarPorCiclo()` (KZ-UNEF-029) implementa exactamente eso y tiene **11/11** comprobaciones (`test/renovacion-ciclo.test.js`).
- **Sigue DESACTIVADO**: `confirmarPago` mantiene `calcularPeriodo` (hoy + 30) porque la certificación KZ-UNEF-002 lo exige así. **Cambiar los periodos de facturación necesita autorización del propietario.**
- Desviación conocida y medida: con +30 días, un cliente de corte 15 renovado el 15-dic vence el 14-ene; tras 6 renovaciones acaba en 2027-05-14 (cinco días fuera de su corte).

## 4. Estados de un pago

| Estado | Significado | Efecto |
|---|---|---|
| `PENDIENTE` | registrado, sin confirmar | no renueva, no cuenta como ingreso |
| `CONFIRMADO` | cobrado | renueva el periodo, cuenta en ingresos |
| `ANULADO` | dado de baja | no renueva; queda el rastro |

## 5. Duplicados

- Confirmar dos veces el mismo pago está **bloqueado**: `confirmarPago` responde `failed-precondition` («El pago ya está confirmado: no se renueva dos veces»).
- Dos confirmaciones simultáneas: **exactamente una** tiene éxito (transacción + `pagos-concurrencia.test.js`).
- Una anulación no se puede confirmar después.

## 6. Suspensiones

- El motor **solo** actúa sobre servicios que no están en conciliación. Los **327 servicios `PENDIENTE_VALIDACION` quedan fuera**: no se cobran ni se suspenden.
- Regla de mora: **4 días** de mora para suspender (3 días sigue `PENDIENTE_PAGO`), verificado en `motor-vencimientos.test.js`.
- Confirmar un dato comercial **no** habilita el cobro: son actos separados (`confirmarRevisionComercial` ≠ `habilitarServicio`).

## 7. Recordatorios

- **Exactamente dos avisos** por corte, a las **10:00 a.m. hora de Colombia**:
  1. **3 días antes** del vencimiento.
  2. **El mismo día** del vencimiento.
- Ejemplo corte 30-nov: avisos el **27-nov** y el **30-nov**, ambos a las 10:00.
- No se duplican (clave única por cliente/tipo/periodo) y **no se avisa de deuda si el pago del periodo ya está confirmado**.
- Hoy los avisos se **registran** en `notificaciones`; el envío real por push no tiene tokens registrados y WhatsApp no está integrado (ver informe §F).

## 8. Lo que requiere aprobación

1. Que el corte 30 de febrero sea el último día real (implementado; falta confirmación comercial).
2. Activar `renovarPorCiclo` en lugar de `hoy + 30` para los cobros nuevos.
3. Decidir qué pasa con los clientes cuya fecha quedó fuera del corte: se corrigen desde **Revisión de clientes**, uno por uno, sin fechas inventadas.
