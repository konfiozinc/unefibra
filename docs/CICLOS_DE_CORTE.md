# Ciclos de corte (día 15 y día 30)

Sistema de dos listas de clientes según la fecha de corte del negocio, más el alta
del administrador corporativo. Documenta el flujo completo: qué se guarda, cómo se
calcula, dónde se ve y cómo se migra.

## 1. El modelo

El negocio cobra en dos tandas: los clientes con **corte el día 15** y los del
**corte el día 30**. Cada cliente pertenece a una.

En `clientes` (Firestore) se añadieron dos campos:

| Campo | Tipo | Qué es |
|---|---|---|
| `cicloCorte` | string `"15"` \| `"30"` | A qué tanda pertenece el cliente |
| `proximoCorte` | string `"YYYY-MM-DD"` | Fecha del próximo corte de su tanda |

> **Fechas como texto.** El proyecto usa `"YYYY-MM-DD"` en zona de Colombia para
> todas las fechas de negocio (`fechaVencimiento`, `fechaInicioServicio`,
> `fechaPago`, periodos). `proximoCorte` sigue la misma convención en lugar de
> guardarse como timestamp: así se puede comparar y ordenar directamente con
> `fechaVencimiento` sin conversiones. `createdAt`/`updatedAt` sí son timestamp.

### Cómo se asigna el ciclo

- Vencimiento entre el **día 1 y el 15** → `cicloCorte = "15"`.
- Vencimiento del **16 en adelante** → `cicloCorte = "30"`.

Al crear un cliente, el panel sugiere el ciclo a partir del vencimiento estimado
(inicio + duración del plan), pero **manda lo que elija el usuario**: hay clientes
que se cambian de tanda a propósito. El sistema nunca "corrige" un ciclo ya
asignado.

### La regla de febrero (decisión documentada)

El ciclo `"30"` usa el día 30, pero **si el mes no llega a 30 el corte cae el
último día del mes**: el 28, o el 29 en año bisiesto. Nunca se salta el corte de
un mes.

Ejemplos: el 27 de febrero de 2026 el próximo corte es el **28 de febrero**; el 1
de marzo vuelve a ser el **30 de marzo**. Verificado con 800 días simulados.

## 2. Dónde se ve

| Dónde | Qué muestra |
|---|---|
| **Lista Corte 15** (`admin/lista-corte-15.html`) | Solo los clientes del ciclo 15, con contador, filtros, búsqueda y botón de WhatsApp para cobrar |
| **Lista Corte 30** (`admin/lista-corte-30.html`) | Igual, para el ciclo 30 |
| **Dashboard** | Dos tarjetas con el total de cada ciclo y un panel "Próximos cortes" con la fecha y la cantidad |

Las dos listas comparten el módulo `assets/js/admin/cortes.js`: una sola
implementación, para que no se desincronicen.

**Sobre el orden:** en este modelo todos los clientes de un ciclo comparten la
misma fecha de próximo corte, así que ordenar por esa fecha no ordena nada. Se
ordena por **fecha de vencimiento ascendente**: primero quien más debe, que es lo
útil para cobrar.

## 3. Avisos automáticos

El motor diario (`processDueDates`, 08:00 hora de Bogotá) ahora calcula los avisos
a partir de `proximoCorte`:

- Si el cliente **tiene ciclo**, el aviso que manda es el del **corte** (la fecha
  real de cobro): «Tu corte está programado», en los días configurados en
  `configuracion.diasAntes` (por defecto 7, 5, 3 y 1).
- Si **ya pagó por adelantado** hasta ese corte, **no se le avisa**: la condición
  es `fechaVencimiento >= proximoCorte`. Sin esta guarda el sistema molestaría
  todos los meses a clientes que están al día.
- Si el cliente **no tiene ciclo** asignado, se usan los recordatorios de siempre
  basados en `fechaVencimiento`.

Los avisos de mora (después del vencimiento) siguen basados en `fechaVencimiento`:
son sobre la deuda real, no sobre la fecha de corte.

## 4. Notificaciones previas al corte

Cada cliente guarda en su documento el rastro de **cuándo** se le avisó, para no
repetir avisos y poder auditarlo:

| Campo | Qué guarda |
|---|---|
| `fechaUltimaNotificacion` | Timestamp del último aviso enviado |
| `tipoUltimaNotificacion` | `"antesCorte"` o `"despuesCorte"` |
| `diasAntesNotificados` | Array con los avisos ya enviados en el ciclo (ej. `[7, 5]`) |
| `cicloActualNotificacion` | Mes del corte vigente, `"YYYY-MM"` |

Comportamiento del motor diario:

1. Antes de enviar un aviso de «faltan N días», mira si ese `N` ya está en
   `diasAntesNotificados`: si está, no lo repite.
2. Al enviarlo, añade el número al array y actualiza los campos de fecha y tipo.
3. Cuando cambia el ciclo (mes nuevo de corte), **reinicia** `diasAntesNotificados`
   y actualiza `cicloActualNotificacion`, para que el mes siguiente vuelvan a salir.
4. Los días de aviso se leen de `configuracion.diasAntes` (por defecto 7, 5, 3 y 1);
   no están escritos en el código.

Esto se suma al anti-duplicados que ya existía en la colección `notificaciones`
(clave `clienteId + periodo + tipo`), que evita reenviar el mismo aviso si el motor
corre dos veces el mismo día.

## 5. Los mensajes de cobro

Los dos textos viven en `configuracion/plantillasMensaje` y se editan desde
**Configuración** en el panel. Los datos que rellenan los marcadores **no están en
el código**:

| Marcador | De dónde sale |
|---|---|
| `{nombre}`, `{valor}` | Del documento del cliente |
| `{mes}`, `{fechaLimite}` | Del próximo corte del cliente |
| `{banco}`, `{tipoCuenta}`, `{numeroCuenta}`, `{titular}` | De la cuenta marcada como **principal** en `metodos_pago` |
| `{whatsappSoporte1}`, `{whatsappSoporte2}` | De `configuracion/soporte` |

Reglas de seguridad de los mensajes:

- **Si no hay cuenta principal configurada, el bloque del banco desaparece.** Antes
  que mandar a un cliente a una cuenta equivocada, se omite la línea.
- Si falta el monto, se omite la línea del valor: nunca sale «Valor a pagar: $0».
- Si solo hay un WhatsApp configurado, la frase se adapta («…al WhatsApp 304…») en
  lugar de dejar un «o» colgando.

El botón **Cobrar** de las listas de corte no arma el texto en el navegador: llama a
la Cloud Function `mensajeCobro`, que lo construye con la misma plantilla y los
mismos datos. Así el mensaje del operador es idéntico al automático y el panel no
necesita tener la cuenta bancaria en memoria. La función elige la plantilla sola: la
de factura vencida el día del corte, y la de factura disponible antes.

Para dejar estos datos cargados: `node tools/configurar-cobro.js --aplicar`
(sin `--aplicar` solo simula, y es idempotente).

## 6. Datos de dirección requeridos

| Dato | ¿Obligatorio? |
|---|---|
| Dirección completa | Siempre |
| Sector o barrio | Siempre |
| Tipo de vivienda (casa / edificio / unidad residencial) | Siempre |
| Nombre del edificio o unidad | Solo si es edificio o unidad |
| Torre | Solo si es edificio o unidad |
| Apartamento | Solo si es edificio o unidad |

**Por qué no son cinco campos obligatorios siempre:** en una casa no hay torre ni
apartamento. Exigirlos obligaría a escribir «N/A» (ensuciando la base) o a perder el
contacto de un cliente real. El tipo de vivienda es el que decide.

Se valida en tres capas:

1. **Formulario de la landing:** al elegir el tipo de vivienda se muestran u ocultan
   los campos de edificio, y se les pone o quita `required`.
2. **Panel (Nuevo cliente):** la misma lógica, con aviso antes de enviar.
3. **Servidor (`crearCliente`):** vuelve a validar y rechaza el alta si falta algo.
   Es la capa que manda: el frontend se puede saltar, esta no.

El interruptor general es `configuracion/camposDireccionObligatorios` (hoy `true`).
Puesto en `false`, vuelven a ser obligatorios solo nombre, teléfono y barrio. En la
landing el valor por defecto vive en `config.js` →
`formulario.camposDireccionObligatorios`, porque ese archivo es la fuente de la
configuración de la página.

En el **agente IA** estos campos se piden por instrucción del prompt, no por código:
el Worker es un proxy de chat sin estado, así que **no puede bloquear** una
conversación a la que le falte un dato. La obligatoriedad real está en el formulario
y en el panel. Para que el agente no pueda avanzar sin los datos haría falta un flujo
con estado y escritura de leads en Firestore desde el Worker (pendiente).

## 7. Migración de los clientes que ya existían

Ningún cliente se borra ni se modifica a mano. El ciclo se rellena solo, por tres
vías equivalentes:

1. **Automática:** el motor diario asigna el ciclo a quien no lo tenga y refresca
   `proximoCorte` cuando cambia de mes. Es idempotente.
2. **Desde el panel:** Cloud Function `migrarCiclosCorte` (solo SUPERADMIN).
3. **Desde la terminal:**

```bash
node tools/migrar-ciclos.js             # simulación: no escribe nada
node tools/migrar-ciclos.js --aplicar   # aplica los cambios
```

La regla de negocio vive en `functions/src/cortes.js`, compartida por las Cloud
Functions y las herramientas. El panel del navegador tiene su propia copia en
`assets/js/admin/ui.js` porque no puede importar CommonJS; hay una prueba que
compara las dos en 2.200 casos para que no se separen.

## 5. Administrador corporativo

La cuenta `unefibrasas@gmail.com` quedó con rol **SUPERADMIN** en el panel de
UneFibra (proyecto `une-fibra`), igual que el administrador anterior. Como es el
panel de la propia empresa, esa cuenta **solo ve los datos de UneFibra**.

Se crea o se repara con:

```bash
node tools/crear-admin-unefibra.js
node tools/crear-admin-unefibra.js --password="NuevaClave1!"
```

Qué hace: si el correo ya existe en Authentication **reutiliza su UID** (no crea
cuentas duplicadas), marca el correo como verificado y escribe
`usuarios/{uid}` con `rol: SUPERADMIN` y `activo: true`.

La contraseña temporal se guarda **solo** en `CREDENCIALES_ADMIN.md`, que está en
`.gitignore` (el script comprueba con `git check-ignore` que efectivamente se
ignora). Ese archivo nunca debe subirse al repositorio.

### Primer ingreso

1. Abrir <https://konfiozinc.github.io/unefibra/admin/>
2. Entrar con `unefibrasas@gmail.com` y la contraseña temporal.
3. **Cambiar la contraseña de inmediato** (sección Usuarios, o "¿Olvidaste tu
   contraseña?" en el acceso).
4. Comprobar el menú: Dashboard, Solicitudes, Clientes, **Lista Corte 15**,
   **Lista Corte 30**, Servicios, Pagos, Planes, Blog, Notificaciones.

## 6. Archivos de esta función

| Archivo | Papel |
|---|---|
| `functions/src/cortes.js` | Regla de negocio de los ciclos (compartida) |
| `functions/src/index.js` | Motor diario, alta de cliente y `migrarCiclosCorte` |
| `assets/js/admin/ui.js` | Copia de la regla para el panel + utilidades |
| `assets/js/admin/cortes.js` | Módulo compartido de las dos listas |
| `admin/lista-corte-15.*`, `admin/lista-corte-30.*` | Las dos vistas |
| `admin/clientes.js` | Campo «Ciclo de corte» en el alta |
| `admin/dashboard.js` | Tarjetas y panel de próximos cortes |
| `tools/migrar-ciclos.js` | Migración desde la terminal |
| `tools/crear-admin-unefibra.js` | Alta del administrador |
