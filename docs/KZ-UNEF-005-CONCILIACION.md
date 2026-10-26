# KZ-UNEF-005 · Conciliación de clientes y servicios

**Fecha:** 25-oct-2026 · **Ejecutado sobre producción en modo SOLO LECTURA**
Proyecto `une-fibra` · base `(default)` · `main` de partida `03ed601`

> Nada de este documento implica escrituras: la herramienta dejó el sistema
> intacto. Las cifras salen de ejecutar `tools/conciliar-clientes-servicios.js`
> (simulación) contra los datos reales.

---

## 1. Inventario verificado

| Concepto | Cantidad |
|---|---|
| Clientes | **358** |
| Servicios | **5** |
| Pagos | **0** |
| Clientes con algún servicio | 5 |
| Clientes **sin** servicio | **353** |

## 2. Qué representa cada registro (la pregunta que había que responder antes de migrar)

Evidencia de código, no suposición:

- El importador (`import/clientes-import.js`) escribe **solo** `clientes`, y en
  cada cliente guarda ya los datos del servicio: `planId`, `precioMensual`,
  `fechaInicioServicio`, `fechaVencimiento`, `cicloCorte`, `proximoCorte`,
  `estadoServicio` e `ip`.
- El único código que crea documentos en `servicios` es `crearCliente`
  (panel/callable) y `seedDemo`. Es decir: **solo los clientes dados de alta
  desde el panel tienen servicio**.

Conclusión: conviven **dos modelos**. El cliente es la fuente de identidad y,
en la cartera importada, también del dato de servicio (desnormalizado). La
colección `servicios` es el registro operativo que leen el motor de
vencimientos, la pantalla de Servicios y el cruce con MikroTik — pero solo
existe para 5 clientes.

**Por eso el motor solo alcanza a 5 de 358 clientes.** No es un fallo de la
publicación de KZ-UNEF-004: es el estado de la cartera.

## 3. Estado de los datos de cada cliente

| Situación | Cantidad |
|---|---|
| Plan + precio + vencimiento completos | **338** |
| Datos parciales (falta plan **o** precio) | **20** |
| Sin ningún dato de servicio | 0 |
| Con IP válida (IPv4 de 4 octetos) | **35** |
| Sin IP utilizable | **323** |

### 3.1 El campo `ip` está destruido por Excel — hallazgo crítico para MikroTik

| Patrón del valor | Clientes | Ejemplo |
|---|---|---|
| Truncada a 2 octetos (residuo) | **301** | `101.11` |
| IPv4 válida (4 octetos) | **35** | `192.168.200.10` |
| Campo ausente | 14 | — |
| Texto no numérico | 8 | `50,2` |

De las 35 válidas, **34 son de rango privado** (las que usa RouterOS en sus
colas). Traducción: **hoy solo 35 de 358 clientes se pueden emparejar con una
cola del router usando Firestore**. Los otros 323 exigen recuperar el inventario
de red desde el propio router, que es la fuente real.

## 4. Clasificación para la regularización

| Clase | Cantidad | Qué significa |
|---|---|---|
| `CON_SERVICIO_OK` | 5 | Ya tienen servicio y es coherente |
| `CANDIDATO_AUTOMATICO` | **333** | Sin servicio, con datos completos: se puede crear el servicio sin decidir nada |
| `REQUIERE_REVISION` | **20** | Falta plan o precio: crear el servicio sería inventar condiciones |
| `INCOMPLETO` | 0 | Nada que hacer |
| `HISTORICO` | 0 | Ningún cliente está retirado hoy |
| `AMBIGUO` | 0 | Nadie tiene más de un servicio |

### 4.1 Los 20 que requieren revisión administrativa

| Qué falta | Casos |
|---|---|
| `planId` (tienen precio) | 11 |
| `precioMensual` (tienen plan) | 8 |
| ambos | 1 |

Son clientes **reales y activos** a los que les falta un dato comercial. Crear
su servicio tomando el precio del plan o el plan del precio sería inventar la
condición del contrato: **eso lo decide una persona**.

### 4.2 El caso `kELI0y5UyRI5QF5Xe7bQ`

`estadoCliente: "POR_VENCER"` — un valor del catálogo del **servicio** aplicado
al cliente. Ver `docs/KZ-UNEF-005-RESPALDOS-Y-PANEL.md` §2 (modelo de datos).

## 5. Problemas estructurales detectados

| Comprobación | Resultado |
|---|---|
| Servicios huérfanos (clienteId inexistente) | **0** |
| Clientes con más de un servicio | **0** |
| IP duplicada entre clientes | **0** |
| Estados fuera del modelo (cliente) | **1** |
| Estados fuera del modelo (servicio/pago) | 0 |
| Vencimiento anterior al inicio | **0** |
| `precioMensual` inválido | **0** |

Nota: existe al menos un cliente con `fechaVencimiento === fechaInicioServicio`
(periodo de cero días). El validador actual solo marca `ven < ini`; conviene
tratarlo también como incoherencia.

## 6. Matriz de correspondencias (sin datos personales)

La matriz completa, por identificador de documento, está en
`C:\KZ-EVIDENCIA\kz-unef-005\conciliacion-detalle.json`, generada por la
herramienta. Resumen por clase:

```
cliente ─┬─ CON_SERVICIO_OK ......... 5   → nada que hacer
         ├─ CANDIDATO_AUTOMATICO ... 333 → crear servicio (id svc-<clienteId>)
         ├─ REQUIERE_REVISION ....... 20  → revisión administrativa
         └─ (sin incompletos, históricos ni ambiguos)
```

## 7. Propuesta de regularización, con simulación previa

Herramienta: `tools/conciliar-clientes-servicios.js` (nueva).

```
node tools/conciliar-clientes-servicios.js                 # SIMULACIÓN (por defecto)
node tools/conciliar-clientes-servicios.js --json plan.json # + detalle técnico
node tools/conciliar-clientes-servicios.js --aplicar --confirmo-clientes-revisados
node tools/conciliar-clientes-servicios.js --revertir       # simula la vuelta atrás
node tools/conciliar-clientes-servicios.js --revertir --confirmo-revertir
```

Garantías de la escritura (si se autoriza):

1. Solo toca los `CANDIDATO_AUTOMATICO`. No toca los 20 a revisión, ni los 5
   servicios existentes.
2. Id de documento determinista `svc-<clienteId>`: volver a ejecutarla **no
   duplica** nada (si existe, responde 409 y se omite).
3. Todos los documentos llevan `origen: "backfill-kz-unef-005"`, que es lo
   único que borra la reversión.
4. El estado del servicio sale del estado del cliente con el mapeo documentado
   en `functions/src/estados.js` (`PENDIENTE_PAGO → POR_VENCER`, etc.).
5. `--aplicar` sin `--confirmo-clientes-revisados` **se niega** (exit 2).

**Estado en esta misión: NO ejecutada la escritura.** El dry-run está hecho y
los 333 documentos están identificados; crearlos requiere autorización expresa.

## 8. Procedimiento de migración (cuando se autorice)

1. Respaldo puntual verificado (§ respaldos: `pre-…/fecha`).
2. `--json` y guardar el plan; revisar los 333 identificadores.
3. `--aplicar --confirmo-clientes-revisados`.
4. Verificar con `--json` de nuevo: `CON_SERVICIO_OK` debe subir a 338 y
   `CANDIDATO_AUTOMATICO` bajar a 0 (los 20 siguen a revisión).
5. Si algo salió mal: `--revertir --confirmo-revertir` deja el sistema como
   estaba, sin tocar los 5 servicios previos.

## 9. Decisión que queda en manos del propietario

Antes de crear 333 servicios hay dos caminos y conviene elegir uno:

- **A (recomendado)**: `servicios` pasa a ser el registro operativo y se
  rellena desde los datos del cliente. Es lo que ya esperan el motor, la
  pantalla de Servicios y el cruce con MikroTik.
- **B**: se declara `clientes` como única fuente y se cambia el motor para que
  lea del cliente. Implica tocar el motor, el panel y el cruce de MikroTik.

Este trabajo prepara **A**, que es la de menor riesgo: no cambia código que hoy
funciona, solo le da los documentos que le faltan.
