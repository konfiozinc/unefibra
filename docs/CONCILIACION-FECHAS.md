# Conciliación de fechas de los servicios migrados

> **KZ-UNEF-028.** Herramienta **de solo lectura** para separar los servicios
> cuya fecha de vencimiento está respaldada por evidencia de los que necesitan que
> el propietario la confirme. **No aplica nada, no cobra y no suspende.**

## 1. El problema

Los 327 servicios importados en KZ-UNEF-018 traen una `fechaVencimiento` calculada
como «fecha de ingreso + 30 días», sin mirar el ciclo de corte. Por eso no sirven
ni para cobrar ni para avisar, y el motor los ignora mientras estén en
`conciliacion.estado = "PENDIENTE_VALIDACION"`.

## 2. Las tres respuestas posibles

| Clase | Significado | ¿Se puede usar la fecha? |
|---|---|---|
| **CONFIABLE** | La fecha cae en el día de corte de su ciclo, es posterior al inicio del servicio y hay precio. O coincide con la que resulta del último pago confirmado | Sí |
| **PROPUESTA_CON_EVIDENCIA** | La fecha guardada no cuadra, pero hay **pagos CONFIRMADOS** que determinan cuál es el próximo vencimiento. La propuesta sale del dinero realmente recibido | Todavía no: necesita el visto bueno del propietario |
| **REQUIERE_CONFIRMACION** | No hay evidencia suficiente. **No se propone ninguna fecha**; se devuelve la pregunta concreta que hay que hacerle al propietario | No |

Nunca se rellena una fecha «a ojo». Si no hay evidencia, `fechaPropuesta` queda en
blanco y el campo `preguntaParaElPropietario` dice exactamente qué falta.

## 3. Cómo se usa

```powershell
cd C:\Users\usuario29\Documents\KONFIO_ZINC\6-LANDING-PAGES\UneFibra-SAS

# Pruebas (emulador local, datos ficticios)
node tools/conciliar-fechas.js --emulador

# Producción — SOLO LECTURA (requiere `firebase login`)
node tools/conciliar-fechas.js --salida C:\ruta\conciliacion --limite 500 --muestra 20
```

Deja dos archivos en la carpeta de salida:

- `conciliacion-fechas-<fecha>.json` — informe completo con el resumen y una fila
  por servicio.
- `conciliacion-fechas-<fecha>.csv` — el mismo contenido en formato de Excel
  (separador `;`, listo para abrir en Excel en español).

Columnas: `servicioId`, `clienteId`, `clase`, `fechaActual`, `fechaPropuesta`,
`fuente`, `ciclo`, `inicioServicio`, `precioMensual`, `pagosConfirmados`,
`motivos`, `preguntaParaElPropietario`. Sin nombres, teléfonos ni direcciones.

## 4. Resultado sobre una simulación de los 327

Con datos ficticios que reproducen los mismos defectos que los reales:

| Clase | Servicios |
|---|---|
| CONFIABLE | 100 |
| PROPUESTA_CON_EVIDENCIA | 20 |
| REQUIERE_CONFIRMACION | 207 |
| **Total** | **327** |

Motivos más frecuentes:

```
 100  la fecha es anterior o igual al inicio del servicio (el defecto de la migración)
 100  la fecha no cae en un día de corte del ciclo
  20  la fecha guardada no coincide con la que resulta del último pago confirmado
   7  el ciclo de corte falta o no es 15/30
```

Y una pregunta concreta para el propietario en cada caso dudoso, por ejemplo:
«¿Desde cuándo paga este cliente? La fecha guardada (2026-05-15) es anterior al
inicio del servicio (2026-09-01).»

## 5. Cómo se aplica una corrección (fuera de esta herramienta)

La herramienta **no escribe**. Aplicar una fecha corregida es un acto manual,
autorizado y auditado, mediante la callable `corregirVencimientoContractual`, que
exige:

- el interruptor `PAGOS_HISTORICOS_HABILITADO=true` (apagado por defecto),
- un período pagado de referencia y una justificación escrita,
- rol ADMIN o SUPERADMIN,
- y deja entrada en `auditoria`.

Ninguna corrección habilita el servicio, cambia la conciliación ni suspende a
nadie. Hasta que el propietario confirme, los 327 siguen fuera del motor: no
generan avisos, ni cobros, ni suspensiones.

## 6. Pruebas

`functions/test/conciliacion-fechas.test.js` — **19/19**: febrero (28 y 29), ciclo
como número o texto, fecha que coincide con los pagos, pagos anulados que no
cuentan como evidencia, último período confirmado, fecha anterior al alta, fecha
fuera de día de corte, ciclo ausente, fecha inválida, servicio vacío y resumen sin
datos personales.
