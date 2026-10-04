/* ============================================================
 * UneFibra SAS — Alertas por email (SendGrid)
 * ------------------------------------------------------------
 * Envía un correo de alerta cuando una función crítica falla
 * (p. ej. el motor de vencimientos o el backup). Usa SendGrid
 * con una API Key guardada como secret de Cloud Functions
 * (SENDGRID_API_KEY), que se lee solo del entorno del runtime
 * (nunca está en el código).
 * ============================================================ */

const sgMail = require("@sendgrid/mail");

const CORREO_ALERTAS = "unefibrasas@gmail.com";

/**
 * Envía una alerta por email. Lanza si el envío falla; el llamador
 * decide si registrar el fallo o seguir. La API Key se lee de
 * `process.env.SENDGRID_API_KEY` (inyectada por el secret).
 */
async function enviarAlertaError(contexto, error) {
  const detalle = (error && error.stack) || (error && error.message) || String(error);

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const msg = {
    to: CORREO_ALERTAS,
    from: {
      email: CORREO_ALERTAS,
      name: "UneFibra Alertas"
    },
    subject: `[UneFibra] FALLO: ${contexto}`,
    text: [
      "Una función crítica de UneFibra falló.",
      "",
      `Contexto: ${contexto}`,
      `Fecha (UTC): ${new Date().toISOString()}`,
      "",
      "Detalle del error:",
      detalle
    ].join("\n")
  };

  await sgMail.send(msg);
}

module.exports = { enviarAlertaError };
