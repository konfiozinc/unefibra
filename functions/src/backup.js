/* ============================================================
 * UneFibra SAS — Backup diario de Firestore
 * ------------------------------------------------------------
 * Exporta la base de datos Firestore a un bucket de Google
 * Cloud Storage usando la API de Firestore Admin.
 *
 * Requisitos (configuración manual en GCP, ver docs/DESPLEGUE.md):
 *  · Bucket GCS creado: unefibra-firestore-backups
 *  · Rol "Cloud Datastore Import Export Admin" otorgado a la
 *    cuenta de servicio de Cloud Functions
 *    (une-fibra@appspot.gserviceaccount.com).
 *  · Lifecycle rule en el bucket: borrar objetos > 7 días.
 * ============================================================ */

const admin = require("firebase-admin");

const PROJECT_ID = "une-fibra";
const BUCKET = "unefibra-firestore-backups";

/** Dispara una exportación de Firestore y devuelve la ruta de salida. */
async function exportarFirestore() {
  // Timestamp legible y único para la carpeta de salida.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputUriPrefix = `gs://${BUCKET}/daily/${stamp}`;

  // Token de la cuenta de servicio por defecto (Application Default Credentials).
  const token = await admin.app().options.credential.getAccessToken();

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ outputUriPrefix })
  });

  if (!res.ok) {
    const texto = await res.text();
    throw new Error(`Exportación Firestore falló (${res.status}): ${texto}`);
  }

  return outputUriPrefix;
}

module.exports = { exportarFirestore };
