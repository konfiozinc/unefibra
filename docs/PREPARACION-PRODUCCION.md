# UNEFibra SAS — Preparación de producción (Fase 11)

> Estado al cierre técnico de la Fase 11. Rama `harness/unef-010-validacion`.
> No desplegar sin autorización del propietario.

## 1. Datos comerciales — clasificación estricta

| Categoría | Elemento | Estado | Fuente |
|---|---|---|---|
| **Confirmado** | 5 planes (Básico 100 $50.000 · Familiar 150 $60.000 · Plus 200 $70.000 · Premium 250 $85.000 · Ultra 300 $100.000) | Cargables en Firestore | Cliente (DATOS_PENDIENTES_CLIENTE.md parte 4) |
| **Confirmado** | Razón social, NIT, teléfonos, WhatsApp, horario, cobertura (22 sectores), sin permanencia | En `assets/js/config.js` | Cliente |
| **Confirmado (Fase 11)** | `metodos_pago`: Nequi, Transferencia Bancolombia, Efectivo (solo nombres, sin cuentas/teléfonos inventados) | `tools/configurar-cobro.js`, `tools/sembrar-e2e.js` | Cliente |
| **Confirmado (Fase 11)** | Recordatorios `diasAntes=[3]`, `diasDespues=[0]`; suspensión `diasSuspension=3` | `functions/src/index.js`, panel → Configuración | Cliente |
| **Confirmado (Fase 11)** | Instalación GRATIS ($0 COP), sin cobros automáticos | `assets/js/config.js`, FAQ/JSON-LD de `index.html`, términos | Cliente |
| **Solo prueba** | `admin@unefibra.test`, clientes/pagos ficticios de los tests | Solo emulador, nunca producción | `tools/sembrar-e2e.js`, suites |

**Carga reproducible:** `node tools/sembrar-e2e.js` (emulador). En producción, los 5
planes se crean desde el panel (Planes → Nuevo) o con un script de Admin SDK.

## 2. Entornos separados

- **Desarrollo/pruebas:** `?emulador=1` en la URL del panel → conecta Auth/Firestore/
  Functions a los emuladores (proyecto `demo-unefibra`). El flag se guarda en
  `sessionStorage` para sobrevivir a las redirecciones. Sin el flag, el panel usa
  producción (`une-fibra`).
- **Producción:** `firebase/firebase-config.js` + `assets/js/config.js` (sin el flag).

## 3. Motor diario (processDueDates)

- Programado: `0 10 * * *` (10:00 Bogotá). Recorre clientes/servicios activos y
  transiciona POR_VENCER → PENDIENTE_PAGO → SUSPENDIDO; envía recordatorios (dedup
  por `clienteId_periodo_tipo`) y cancela pendientes al confirmar pago.
- **Valores comerciales confirmados:** recordatorio 3 días antes + el mismo día
  (`diasAntes=[3]`, `diasDespues=[0]`); suspensión a los 3 días de mora
  (`diasSuspension=3`).
- **Disparo manual:** callable `ejecutarMotor` (solo SUPERADMIN) corre la misma lógica
  bajo demanda, para operación y pruebas controladas sin esperar el cron.
- **Costo:** lineal con el volumen (1 lectura por servicio activo). Despreciable para
  volúmenes actuales; medir métricas antes de escalar (auditoría).
- **Alerta de fallo:** `enviarAlertaError` (SendGrid, secret `SENDGRID_API_KEY`).

## 4. Requisitos para activar producción (Blaze)

| Funcionalidad | Requiere Blaze | Notas |
|---|---|---|
| Cloud Functions (callables financieras) | **Sí** | El motor diario, callables y backup no corren en Spark |
| Backup diario (`backupFirestore`) | Sí (Storage/GCS) | Pendiente: crear bucket + rol IAM + lifecycle 7 días |
| Notificaciones push/email | Sí (SendGrid) | Secret ya configurado en Functions |
| Firestore/Auth en Spark | Parcial | Suficiente para arranque, limitado a ~10k lecturas/día |
| Sitio estático (GitHub Pages) | No | Sin costo |

**Controles de costo recomendados:** App Check + rate-limit en `solicitudes_contacto`
y `tokens_notificacion` (escrituras públicas); alertas de cuota/presupuesto en GCP.

## 5. Respaldo, recuperación y reversión

- **Respaldo:** `backupFirestore` (programado 03:00) exporta a GCS. Historial Git +
  tag de referencia. Rama `main` sin cambios hasta autorización.
- **Recuperación:** restaurar desde el último export de GCS (consola GCP → Firestore
  → Import).
- **Reversión de despliegue:** `firebase deploy --only functions` publica una sola
  versión; para revertir, `git checkout <commit-anterior>` + redeploy. El código de
  funciones es versión por commit (sin migraciones destructivas).
- **Regla:** nunca `firebase deploy --force` sobre datos; los índices se declaran en
  `firestore.indexes.json`.

## 6. Checklist de despliegue (cuando se autorice)

1. [x] Confirmar `metodos_pago` y `configuracion` con el cliente (Nequi / Transferencia Bancolombia / Efectivo; recordatorios 3/0; suspensión 3 días; instalación gratis).
2. [x] Migrar `firebase-admin` a v14 + re-probar las suites (96 aserciones en verde).
3. [ ] Activar Blaze y desplegar Functions (`firebase deploy --only functions`).
4. [ ] Crear bucket GCS + rol IAM para `backupFirestore`.
5. [ ] Activar App Check (conectar panel primero) y rate-limit.
6. [ ] Sembrar los 5 planes + SUPERADMIN real (nunca credenciales de prueba).
7. [ ] Probar el flujo completo en el navegador con el usuario real.
8. [ ] Publicar el sitio y verificar los 4 sitios clave (HTTP 200).

## 7. Vulnerabilidades remanentes (verificable)

`npm audit` (functions): **30 pendientes (2 altas + 28 moderadas)**, todas transitivas
de `firebase-admin@12` (`@google-cloud/firestore`, `google-gax`, `uuid`, `teeny-request`).
La única vía es `firebase-admin` 12→14 (breaking). Estado: migración en curso en esta
fase; si la red impide completarla, queda como paso 2 del checklist (no bloquea el
código funcional, pero debe cerrarse antes de desplegar).
