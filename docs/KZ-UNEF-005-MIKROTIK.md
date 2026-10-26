# KZ-UNEF-005 · Preparación técnica de MikroTik

**Estado: diagnóstico únicamente.** No se ha abierto ninguna conexión a un
router, no se han declarado secretos `MIKROTIK_*` y las funciones de escritura
siguen cerradas por configuración.

---

## 1. Qué se revisó del módulo de KZ-UNEF-001

| Punto exigido | Estado |
|---|---|
| Normalización de direcciones IP | `normalizarIp()` acepta solo IPv4 de 4 octetos y rechaza `/32`, texto y octetos fuera de rango |
| Detección de IP duplicadas | **nuevo** en KZ-UNEF-005: entre clientes y entre colas |
| Coincidencia cliente ↔ cola | por IP (target) y, si no, por nombre de cola |
| Detección de registros ambiguos | dos colas para la misma IP ⇒ `CONFLICTO` |
| Clientes sin información de red | `DATOS_INCOMPLETOS` |
| Separación consulta / escritura | la escritura exige `MIKROTIK_PERMITIR_ESCRITURA=true` **y** `confirmado: true`, y ninguna callable la expone |
| Protección contra suspensiones incorrectas | `accionPermitida` solo es `true` en `COINCIDENCIA_EXACTA` |

## 2. Clasificación que produce el diagnóstico

`functions/src/mikrotik.js` → `diagnosticarCorrespondencias(clientes, colas)`

| Resultado | Significado | ¿Permite actuar? |
|---|---|---|
| `COINCIDENCIA_EXACTA` | una sola cola apunta a la IP del cliente | **sí** |
| `COINCIDENCIA_PROBABLE` | la IP no coincide, pero el nombre de la cola sí | **no** |
| `SIN_COINCIDENCIA` | hay IP válida y ninguna cola la usa | no |
| `IP_DUPLICADA` | la misma IP aparece en más de un cliente | no |
| `DATOS_INCOMPLETOS` | sin IP o con un valor que no es una IPv4 | no |
| `CONFLICTO` | varias colas apuntan a la misma IP | no |

Regla implementada y probada: **«probable» nunca se trata como exacta**.

## 3. La realidad de los datos (lo que cambia el plan)

Del análisis de producción (ver `docs/KZ-UNEF-005-CONCILIACION.md` §3.1):

- **35 de 358 clientes** tienen una IPv4 utilizable; 34 de ellas de rango
  privado (las que usan las colas de RouterOS).
- **301** tienen el campo truncado a dos octetos (`101.11`), **8** son texto
  (`50,2`) y **14** no tienen campo.
- Dos clientes ya comparten IP válida (detectado por el diagnóstico).

Consecuencia directa: **el emparejamiento por Firestore solo puede cubrir el
10 % de la cartera.** El inventario de red real está en el router, no en la
base. Por eso el orden correcto para la fase de integración es:

1. Leer las colas del router (solo lectura) con el script que ya existe
   (`import/test-mikrotik.js`).
2. Cruzar el **nombre** de la cola con el nombre del cliente (el script ya
   prevé enmascarar los nombres al volcar).
3. Reconstruir el campo `ip` de cada cliente **desde esa lectura**, no desde
   Excel.
4. Volver a ejecutar el diagnóstico: la meta es que `COINCIDENCIA_EXACTA` suba
   y `DATOS_INCOMPLETOS` baje.

## 4. Qué NO se hizo (y por qué)

- No se conectó a `186.97.86.26` ni a ningún otro equipo.
- No se declararon secretos: sin ellos, `estadoMikrotik` responde
  `configurado:false` y no intenta conectar (verificado en producción).
- No se activó ninguna suspensión, reconexión ni cambio de cola.
- No se tocó la regla de firewall ni el certificado autofirmado del router.

## 5. Riesgos antes de activar la integración real

| Riesgo | Mitigación propuesta |
|---|---|
| El puerto de API del router está en una IP pública con certificado autofirmado | Restringir por firewall al rango de Cloud Functions o usar un túnel; no abrirlo a Internet abierto |
| 323 clientes sin IP fiable | Reconstruir desde el router antes de cualquier automatización |
| Dos colas con el mismo target | El diagnóstico lo marca como `CONFLICTO`; exige revisión manual en WinBox |
| Suspender a quien pagó | La escritura sigue cerrada y, cuando se abra, debe exigir `COINCIDENCIA_EXACTA` + confirmación + auditoría |
| Credenciales del router | Van por secretos de Secret Manager, nunca en el repositorio (y hoy no existen) |

## 6. Pruebas

`functions/test/modelo-datos.test.js` — 12 comprobaciones del diagnóstico con
colas sintéticas: coincidencia exacta, probable, sin coincidencia, IP duplicada
entre clientes, dos colas para una IP (`CONFLICTO`), residuo tipo `101.11`,
cliente sin IP, colas dinámicas excluidas y la regla «solo la exacta permite
actuar».

`functions/test/mikrotik.test.js` — las 33 comprobaciones de KZ-UNEF-001 siguen
pasando (normalización, emparejamiento, informe, cerrojo de escritura).
