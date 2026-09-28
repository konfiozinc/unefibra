# TV por aplicación — regla de negocio

> Documento de referencia para el equipo y para los agentes de IA. Registra una
> decisión del negocio; si cambia, hay que actualizar también la landing, el prompt
> del agente y los términos y condiciones.

## La regla

| Caso | Qué pasa | Quién paga |
|---|---|---|
| El televisor es **Android TV** o **Google TV** | Se instala la app | **Nada**: la TV por aplicación está incluida sin costo |
| El televisor **no** es Android/Google TV, o no permite descargar apps | Se necesita un **convertidor** que convierta el TV en Android para poder instalar la app | El **cliente**: el convertidor corre por su cuenta |

- La TV por aplicación **no tiene cobro mensual adicional**: es un valor agregado del servicio de Internet.
- La **instalación de 1 app es gratis**. Es **una app concreta** (la que define la empresa), **no
  cualquier app que elija el cliente**.
- **La app NO es propiedad de UneFibra.** Es una **aplicación de terceros** que se descarga desde
  una plataforma externa y se instala sin costo. Por eso:
  - **Nunca** se escribe «nuestra app», «nuestra aplicación» ni «la app de UneFibra».
  - UneFibra **no responde** por el funcionamiento, la disponibilidad ni el contenido de la app, ni
    por las condiciones que imponga la plataforma externa (cláusula 11 de los términos).
- **No** se promete que el convertidor esté incluido ni se informa un precio: ese dato no está
  confirmado. Si el cliente pregunta cuánto cuesta, se le deriva al equipo por WhatsApp
  (**304 465 4987**) para asesorarlo según su televisor.

## Cómo decirlo (texto aprobado)

- ✅ «El servicio de TV por aplicación es gratis y la instalación de 1 app también es gratis.»
- ✅ «La app **no es de UneFibra**: es una aplicación de terceros.»
- ✅ «Solo pagas el convertidor, y solo si tu TV no es Android ni Google TV.»
- ❌ «Instala **nuestra** app.»  ❌ «La **app de UneFibra**.»

## Dónde está publicado

| Lugar | Qué dice |
|---|---|
| Landing, sección `#tv` (`index.html`) | El texto para el cliente, con botón de WhatsApp para preguntar por su TV |
| Agente IA de la web (`agente-ia/worker.js`) | Sección «TV por aplicación» en el prompt (incluye que la app es de terceros) y respuesta en el respaldo local |
| Chat de la landing (`assets/js/agente.js`) | Respuesta de respaldo cuando el agente no está disponible |
| Conocimiento de WhatsApp Business (`docs/AGENTE_WHATSAPP_BUSINESS.md`) | Sección «TV por aplicación (incluida sin costo)» + pregunta frecuente |
| Términos y condiciones (`terminos-y-condiciones.html`) | Cláusula 11: sin costo, convertidor a cargo del cliente, app de terceros y exención de responsabilidad |

## Pendientes de confirmar con el cliente

1. **Nombre de la app.** Se sabe que es **una app concreta definida por la empresa**, pero el
   **nombre no se publica** y no está confirmado. Por eso todo el texto va genérico («la app»).
   Si el cliente lo autoriza, hay que ponerlo en la landing, los términos, los dos agentes y este
   documento.
2. **Precio del convertidor** (si se quiere informar; hoy solo se deriva al equipo).
3. **Si hay marcas o modelos recomendados** de convertidor, y si UneFibra los consigue o los vende.
4. **Si la app requiere una cuenta o suscripción aparte** de la plataforma de terceros.
5. **Si la TV por aplicación aplica a todos los planes** por igual o solo a algunos.
6. **Si «1 app» es un límite estricto**: hoy el texto dice «la instalación de 1 app es gratis», pero
   no está confirmado qué pasa si el cliente quiere instalar más de una.
