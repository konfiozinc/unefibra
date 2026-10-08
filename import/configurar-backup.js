/* ============================================================
 * UneFibra SAS — Configuracion del backup diario de Firestore
 * ------------------------------------------------------------
 * Deja listo lo que `backupFirestore` (functions/src/backup.js) necesita:
 *   1. El bucket GCS `unefibra-firestore-backups` (region us-central1).
 *   2. La regla de ciclo de vida: borrar lo que tenga mas de 30 dias.
 *   3. El rol `roles/datastore.importExportAdmin` a la cuenta de servicio
 *      `une-fibra@appspot.gserviceaccount.com`, que es quien invoca la
 *      exportacion con su propio token.
 *
 * NO usa gcloud (no esta instalado en esta maquina): habla con las APIs de
 * Google con el token de la sesion de `firebase login`, igual que el resto de
 * las herramientas de import/.
 *
 *   node import/configurar-backup.js            -> solo diagnostico
 *   node import/configurar-backup.js --real     -> crea/ajusta lo que falte
 *   node import/configurar-backup.js --probar   -> ademas lanza una exportacion
 *                                                  de prueba y espera el resultado
 * ============================================================ */
"use strict";

const { tokenAcceso } = require("../tools/lib/google-auth");

const PROYECTO = "une-fibra";
const BUCKET = "unefibra-firestore-backups";
const REGION = "us-central1";
const SA = "une-fibra@appspot.gserviceaccount.com";
const ROL = "roles/datastore.importExportAdmin";
const DIAS_RETENCION = 30;

const REAL = process.argv.includes("--real");
const PROBAR = process.argv.includes("--probar");

async function api(tok, url, opciones) {
  const res = await fetch(url, {
    ...opciones,
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", ...((opciones || {}).headers || {}) }
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* respuesta no JSON */ }
  return { ok: res.ok, status: res.status, json, texto };
}

async function leerBucket(tok) {
  return api(tok, `https://storage.googleapis.com/storage/v1/b/${BUCKET}`);
}

(async () => {
  const tok = await tokenAcceso();
  console.log("=".repeat(72));
  console.log("BACKUP DE FIRESTORE — configuracion" + (REAL ? "   *** MODO REAL ***" : "   (solo diagnostico)"));
  console.log("=".repeat(72));

  // ── 1) El bucket ────────────────────────────────────────────────────────
  console.log("\n--- 1) Bucket gs://" + BUCKET + " ---");
  let b = await leerBucket(tok);
  const reglaEsperada = { action: { type: "Delete" }, condition: { age: DIAS_RETENCION } };

  if (b.status === 404) {
    console.log("  NO existe.");
    if (!REAL) {
      console.log("  (con --real se crearia en " + REGION + ", clase STANDARD, con la regla de " + DIAS_RETENCION + " dias)");
    } else {
      const cuerpo = {
        name: BUCKET,
        location: REGION,
        storageClass: "STANDARD",
        iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
        lifecycle: { rule: [reglaEsperada] }
      };
      const r = await api(tok, `https://storage.googleapis.com/storage/v1/b?project=${PROYECTO}`, {
        method: "POST", body: JSON.stringify(cuerpo)
      });
      if (!r.ok) {
        console.log("  *** FALLO al crear: " + r.status + " " + String(r.texto).slice(0, 400));
        process.exit(1);
      }
      console.log("  Creado OK (" + REGION + ", STANDARD, acceso uniforme, regla de " + DIAS_RETENCION + " dias).");
      b = await leerBucket(tok);
    }
  } else if (!b.ok) {
    console.log("  *** No se pudo consultar: " + b.status + " " + String(b.texto).slice(0, 300));
    process.exit(1);
  } else {
    console.log("  Ya existe. Ubicacion: " + b.json.location + " | clase: " + b.json.storageClass);
  }

  // ── 2) Ciclo de vida ───────────────────────────────────────────────────
  if (b.ok && b.json) {
    const reglas = (b.json.lifecycle && b.json.lifecycle.rule) || [];
    const tiene = reglas.some(r => r.action && r.action.type === "Delete" && r.condition && r.condition.age === DIAS_RETENCION);
    console.log("\n--- 2) Ciclo de vida (> " + DIAS_RETENCION + " dias) ---");
    console.log("  Reglas actuales: " + (reglas.length ? JSON.stringify(reglas) : "ninguna"));
    if (tiene) {
      console.log("  OK: ya tiene la regla de borrado a los " + DIAS_RETENCION + " dias.");
    } else if (!REAL) {
      console.log("  Falta la regla. (con --real se anadiria, conservando las que ya haya)");
    } else {
      const nuevas = reglas.concat([reglaEsperada]);
      const r = await api(tok, `https://storage.googleapis.com/storage/v1/b/${BUCKET}?fields=lifecycle`, {
        method: "PATCH", body: JSON.stringify({ lifecycle: { rule: nuevas } })
      });
      console.log(r.ok ? "  Regla anadida OK." : "  *** FALLO: " + r.status + " " + String(r.texto).slice(0, 300));
    }
  }

  // ── 3) Permiso de la cuenta de servicio ────────────────────────────────
  console.log("\n--- 3) Rol " + ROL + " para " + SA + " ---");
  const g = await api(tok, `https://cloudresourcemanager.googleapis.com/v1/projects/${PROYECTO}:getIamPolicy`, {
    method: "POST", body: JSON.stringify({})
  });
  if (!g.ok) {
    console.log("  *** No se pudo leer la politica IAM: " + g.status + " " + String(g.texto).slice(0, 300));
    console.log("  Hazlo a mano en la consola de GCP (IAM y administracion → IAM).");
  } else {
    const policy = g.json;
    const yaTiene = (policy.bindings || []).some(x => x.role === ROL && (x.members || []).includes("serviceAccount:" + SA));
    console.log("  Ya tiene el rol: " + (yaTiene ? "SI" : "NO"));
    if (!yaTiene) {
      if (!REAL) {
        console.log("  (con --real se anadiria el binding sin tocar los demas)");
      } else {
        const bindings = (policy.bindings || []).slice();
        const b2 = bindings.find(x => x.role === ROL);
        if (b2) b2.members = [...new Set((b2.members || []).concat(["serviceAccount:" + SA]))];
        else bindings.push({ role: ROL, members: ["serviceAccount:" + SA] });
        const r = await api(tok, `https://cloudresourcemanager.googleapis.com/v1/projects/${PROYECTO}:setIamPolicy`, {
          method: "POST", body: JSON.stringify({ policy: { ...policy, bindings } })
        });
        console.log(r.ok ? "  Binding anadido OK." : "  *** FALLO: " + r.status + " " + String(r.texto).slice(0, 400));
      }
    }
  }

  // ── 4) Exportacion de prueba (comprueba la cadena completa) ────────────
  if (PROBAR) {
    console.log("\n--- 4) Exportacion de prueba ---");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destino = `gs://${BUCKET}/daily/${stamp}`;
    console.log("  Destino: " + destino);
    const r = await api(tok, `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default):exportDocuments`, {
      method: "POST", body: JSON.stringify({ outputUriPrefix: destino })
    });
    if (!r.ok) {
      console.log("  *** FALLO al lanzar: " + r.status + " " + String(r.texto).slice(0, 400));
    } else {
      const op = r.json.name;
      console.log("  Lanzada. Operacion: " + String(op).split("/").pop());
      let listo = false;
      for (let i = 0; i < 20 && !listo; i++) {
        await new Promise(s => setTimeout(s, 4000));
        const s2 = await api(tok, `https://firestore.googleapis.com/v1/${op}`);
        if (s2.json && s2.json.done) {
          listo = true;
          console.log("  TERMINADA. " + (s2.json.error ? "*** CON ERROR: " + JSON.stringify(s2.json.error).slice(0, 300) : "Sin errores."));
        } else {
          process.stdout.write("  ... esperando (" + ((i + 1) * 4) + "s)\r");
        }
      }
      if (!listo) console.log("\n  Sigue en curso (no es un fallo: la exportacion continua en segundo plano).");
      const obj = await api(tok, `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=daily/&maxResults=5`);
      if (obj.ok) {
        const items = obj.json.items || [];
        console.log("  Objetos en el bucket: " + items.length);
        items.slice(0, 5).forEach(o => console.log("    " + o.name + "  (" + o.size + " bytes)"));
      }
    }
  }

  console.log("\n" + "=".repeat(72));
  if (!REAL) console.log("Solo diagnostico. Para aplicar: node import/configurar-backup.js --real");
})().catch(e => { console.log("ERROR: " + e.message); process.exit(1); });
