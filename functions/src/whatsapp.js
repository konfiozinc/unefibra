/* ============================================================
 * UneFibra SAS — Envío de WhatsApp (Meta Cloud API)
 * ------------------------------------------------------------
 * Envía recordatorios de pago a los clientes vía la Cloud API
 * de WhatsApp (endpoint /messages con templates aprobados).
 *
 * Credenciales en Firebase Secrets:
 *   META_WHATSAPP_TOKEN    → token permanente de Meta
 *   META_PHONE_NUMBER_ID   → ID del número de WhatsApp Business
 *
 * Requisito de Meta: los mensajes iniciados por el negocio deben
 * usar un TEMPLATE pre-aprobado (categoría "utility").
 * ============================================================ */

const VERSION = "v20.0";

/**
 * Normaliza un número local colombiano a formato internacional (E.164)
 * sin el "+" (así lo espera la Cloud API). Ej: "321 749 0310" → "573217490310".
 * Devuelve null si el número no es válido.
 */
function normalizarTelefono(numero) {
  const n = String(numero || "").replace(/[^\d]/g, "");
  if (!n) return null;
  if (n.length === 10) return "57" + n;         // celular local (3XX…)
  if (n.length === 12 && n.startsWith("57")) return n; // ya internacional
  if (n.length === 13 && n.startsWith("57")) return n.slice(0, 12); // defensivo
  return null; // formato desconocido: no se envía
}

/**
 * Envía un mensaje de template a un cliente.
 * @param {object} opts
 * @param {string} opts.telefono   número en formato local (se normaliza)
 * @param {string} opts.template   nombre del template aprobado en Meta
 * @param {string[]} [opts.variables] variables del body del template
 * @returns {Promise<boolean>} true si se envió
 */
async function enviarWhatsApp({ telefono, template, variables = [] }) {
  const PHONE_ID = process.env.META_PHONE_NUMBER_ID;
  const TOKEN = process.env.META_WHATSAPP_TOKEN;
  if (!PHONE_ID || !TOKEN) {
    throw new Error("Faltan secretos de WhatsApp (META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID)");
  }

  const destino = normalizarTelefono(telefono);
  if (!destino) return false; // número inválido: no se envía

  const url = `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: destino,
    type: "template",
    template: {
      name: template,
      language: { code: "es" }
    }
  };

  if (variables && variables.length) {
    body.template.components = [{
      type: "body",
      parameters: variables.map((v) => ({ type: "text", text: String(v) }))
    }];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`WhatsApp falló (${res.status}): ${texto}`);
  }
  return true;
}

module.exports = { enviarWhatsApp, normalizarTelefono };
