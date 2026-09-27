# TV por aplicación — regla de negocio

> Documento de referencia para el equipo y para los agentes de IA. Registra una
> decisión del negocio; si cambia, hay que actualizar también la landing, el prompt
> del agente y los términos y condiciones.

## La regla

| Caso | Qué pasa | Quién paga |
|---|---|---|
| El televisor es **Android TV** o **Google TV** | Se instala la app de UneFibra | **Nada**: la TV por aplicación está incluida sin costo |
| El televisor **no** es Android/Google TV, o no permite descargar apps | Se necesita un **convertidor** que convierta el TV en Android para poder instalar la app | El **cliente**: el convertidor corre por su cuenta |

- La TV por aplicación **no tiene cobro mensual adicional**: es un valor agregado del servicio de Internet.
- **No** se promete que el convertidor esté incluido ni se informa un precio: ese dato no está
  confirmado. Si el cliente pregunta cuánto cuesta, se le deriva al equipo por WhatsApp
  (**304 465 4987**) para asesorarlo según su televisor.

## Dónde está publicado

| Lugar | Qué dice |
|---|---|
| Landing, sección `#tv` (`index.html`) | El texto para el cliente, con botón de WhatsApp para preguntar por su TV |
| Agente IA de la web (`agente-ia/worker.js`) | Sección «TV POR APLICACIÓN» en el prompt y respuesta en el respaldo local |
| Chat de la landing (`assets/js/agente.js`) | Respuesta de respaldo cuando el agente no está disponible |
| Conocimiento de WhatsApp Business (`docs/AGENTE_WHATSAPP_BUSINESS.md`) | Sección «TV por aplicación (incluida sin costo)» + pregunta frecuente |
| Términos y condiciones (`terminos-y-condiciones.html`) | Cláusula 11: la TV no tiene costo y el convertidor lo asume el cliente |

## Pendientes de confirmar con el cliente

1. **Precio del convertidor** (si se quiere informar; hoy solo se deriva al equipo).
2. **Si hay marcas o modelos recomendados** de convertidor, y si UneFibra los consigue o los vende.
3. **Qué app se instala** exactamente (nombre del servicio de TV) y si requiere una cuenta o
   suscripción aparte.
4. **Si la TV por aplicación aplica a todos los planes** por igual o solo a algunos.
