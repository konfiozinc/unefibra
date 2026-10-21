# Setup de WhatsApp (Meta Cloud API) — Recordatorios UneFibra

## Contexto
El código de `functions/src/whatsapp.js` envía recordatorios de pago vía la
Cloud API de WhatsApp. Para que funcione, hay que hacer este setup UNA sola vez
en Meta y luego setear 2 secrets en Firebase.

**Recordatorio implementado en código (1):**
1. **Día del vencimiento (0)** → template `recordatorio_pago_hoy`

**Pendiente de template en Meta:** el recordatorio de **3 días antes** del
vencimiento (decisión comercial confirmada 3/0). Hasta crear y aprobar ese template,
el aviso previo sale por notificación (push / dentro del panel), no por WhatsApp.

---

## Parte 1 — Setup en Meta (manual, ~1-2h)

1. Entrar a **https://business.facebook.com** con la cuenta dueña del
   WhatsApp Business de UneFibra.
2. En **Configuración del negocio → Información de la empresa**, completar la
   **verificación del negocio** (subir documento de UneFibra). Meta revisa y
   aprueba (puede tardar).
3. Ir a **Cuentas de WhatsApp** (WhatsApp Accounts):
   - Anotar el **WhatsApp Business Account ID** (WABA ID).
   - Entrar al número de UneFibra y anotar el **Phone Number ID**.
4. Generar el **token permanente**:
   - Sistema de usuarios → Usuarios del sistema → Crear usuario de sistema.
   - Asignar permisos de WhatsApp (`whatsapp_business_messaging` +
     `whatsapp_business_management`).
   - Generar token y **copiarlo** (se muestra una sola vez).

> Los 3 valores (WABA ID no lo usa el código, pero Phone Number ID y token sí):
> - `META_PHONE_NUMBER_ID` → Phone Number ID
> - `META_WHATSAPP_TOKEN` → token permanente

---

## Parte 2 — Registrar el template (Meta lo aprueba en 24-48h)

En **WhatsApp Manager → Plantillas de mensaje → Crear plantilla**,
categoría **Utilidad** (utility), idioma **Español**:

### Template — `recordatorio_pago_hoy`
```
Hola {{1}}, hoy vence tu pago. Realízalo para evitar la suspensión de tu servicio.
```
- Variables: `{{1}}` = nombre

### Pendiente (3 días antes)
Cuando el cliente quiera el recordatorio por WhatsApp también **3 días antes**, crear un
template más (p. ej. `recordatorio_pago_3_dias`) y volver a conectar el envío en
`functions/src/index.js`. Hoy el motor envía ese aviso por notificación
(push / dentro del panel), no por WhatsApp.

> ⚠️ El nombre del template debe quedar **exactamente** igual al que usa el código
> (`recordatorio_pago_hoy`).

---

## Parte 3 — Setear los secrets en Firebase (lo hace Harness)

Cuando Meta apruebe los templates y tengas los 2 valores, avisar para ejecutar:
```
firebase functions:secrets:set META_WHATSAPP_TOKEN
firebase functions:secrets:set META_PHONE_NUMBER_ID
firebase deploy --only functions
```

---

## Notas técnicas

- **Formato del teléfono:** el código normaliza números locales colombianos
  (`321 749 0310` → `573217490310`). Si un número no es válido, se omite (no falla).
- **Opt-in:** el código solo envía a clientes con `whatsapp` cargado y sin
  `whatsappOptIn === false`. Los clientes nuevos se crean con `whatsappOptIn: true`.
- **Respaldo:** si WhatsApp falla, el push (FCM) sigue igual y el email (SendGrid)
  avisa al admin. Nada se rompe.
