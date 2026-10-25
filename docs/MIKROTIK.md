# MikroTik en UneFibra — estado real y procedimiento seguro

Documento de la misión **KZ-UNEF-001** (25-oct-2026). Describe qué existe hoy,
qué falta y cómo activarlo sin dejar a un cliente sin Internet.

---

## 1. Qué había antes de esta misión

Un **único script de diagnóstico**, fuera del producto:

- `import/test-mikrotik.js` — se conecta por API, ejecuta `/queue/simple/print`
  y vuelca las colas a un JSON local (gitignoreado). **Solo lectura.**
- `import/analizar-ips.js` y `import/arreglar-ips.js` — análisis de las IP de
  los clientes para ver cuáles sirven para enlazar con una cola.
- `node-routeros@^1.6.8` figuraba en `functions/package.json` **sin usarse en
  ninguna función**.

No existía integración con el panel, ni consulta de estado, ni suspensión
automática en el router: la suspensión solo cambiaba `estadoCliente` en
Firestore. El router se toca a mano en WinBox.

## 2. Qué hay ahora (preparado, sin activar)

| Pieza | Archivo | Estado |
|---|---|---|
| Módulo de integración | `functions/src/mikrotik.js` | Implementado |
| Pruebas sin router | `functions/test/mikrotik.test.js` | 33 comprobaciones, todas en verde |
| Consulta desde el panel | callable `estadoMikrotik` en `functions/src/index.js` | Implementada, **solo lectura** |
| Escritura (suspender/activar) | `cambiarEstadoQueue()` en el módulo | Implementada y **cerrada** |

### Qué hace el módulo

- `normalizarIp()` — el dato de origen venía sucio (IP incompletas tipo
  `192.168.50`); solo se acepta IPv4 completa.
- `nombreQueueParaCliente()` — nombre de cola estable, sin acentos ni espacios.
- `normalizarQueue()` / `estadoDesdeQueue()` — traduce la cola de RouterOS
  (`disabled: "true"`, `target: "192.168.50.2/32"`) a un estado del sistema.
- `emparejar()` — cruza clientes con colas por IP y, si no, por nombre. **No
  elige a ciegas**: si dos colas comparten target, lo marca como ambiguo.
- `listarQueues()` — un solo comando (`/queue/simple/print`) y cierra la conexión.
- `informeEstado()` — resumen: emparejados, sin cola, ambiguos, colas huérfanas,
  y el estado de cada cliente.
- `cambiarEstadoQueue()` — **cerrada**: exige `MIKROTIK_PERMITIR_ESCRITURA=true`
  y `confirmado: true` en la llamada. Ninguna callable la expone.

### Qué NO hace

- No escribe en el router desde el panel.
- No suspende ni reactiva a nadie automáticamente.
- No sincroniza el estado del router hacia Firestore.

## 3. Cómo probarlo sin tocar el router

```
node functions/test/mikrotik.test.js
```

Usa un doble de `RouterOSAPI`; no abre ninguna conexión.

## 4. Cómo activar la consulta real (cuando el dueño lo autorice)

1. Crear en el router el usuario de API (`api-panel`) con permisos **de solo
   lectura** sobre `/queue/simple` (grupo `read`, política mínima).
2. Cargar los secretos en Cloud Functions:
   ```
   firebase functions:secrets:set MIKROTIK_HOST
   firebase functions:secrets:set MIKROTIK_USER
   firebase functions:secrets:set MIKROTIK_PASSWORD
   firebase functions:secrets:set MIKROTIK_PORT      # 8729 = api-ssl
   ```
3. Declararlos en `runWith({ secrets: [...] })` de la función `estadoMikrotik`
   (hoy lee `process.env`, así que **sin declararlos no llegan**).
4. Desplegar y llamar desde el panel con un usuario ADMIN.

> **Riesgo de red:** el router de UneFibra está en una IP pública
> (`186.97.86.26` en el script de diagnóstico) y su certificado `api-ssl` suele
> ser autofirmado. Abrir el puerto de API a Internet es un riesgo inherente: si
> se automatiza, conviene un túnel o restringir el origen por firewall.

## 5. Cómo activar la escritura (segunda fase, no incluida)

Requisitos mínimos antes de escribir en el router:

1. Que la consulta lleve **una semana** funcionando sin diferencias raras entre
   Firestore y el router.
2. Que exista una **auditoría** de cada cambio en el router (`auditar()`), con
   quién, cuándo y qué cola.
3. Que la suspensión sea **reversible con un clic** y con verificación posterior
   (volver a leer la cola y confirmar el cambio).
4. Que el corte automático por mora **no** escriba en el router: el motor cambia
   el estado en Firestore y una persona decide el corte, hasta que el punto 1 se
   cumpla con datos.

## 6. Riesgos conocidos

| Riesgo | Estado |
|---|---|
| El estado del router y el de Firestore pueden diferir | **Real hoy.** La consulta existe para medirlo; nadie lo ha medido todavía |
| El cliente tiene `ip` incompleta o vacía en Firestore | **Real.** El emparejamiento lo reporta como "sin cola" |
| Dos colas con el mismo target | Se reporta como ambiguo, no se elige |
| Credenciales del router | No están en el repo; van por secretos |
| Puerto de API expuesto a Internet | Sigue siendo decisión del dueño; no se tocó nada |
