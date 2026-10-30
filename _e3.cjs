const { tokenAcceso } = require("./tools/lib/google-auth");
const DB = "https://firestore.googleapis.com/v1/projects/une-fibra/databases/(default)";
(async () => {
  const t = await tokenAcceso(); const h = { Authorization: "Bearer " + t };
  const pub = await fetch("https://pubsub.googleapis.com/v1/projects/une-fibra/topics/firebase-schedule-continuarBackup-us-central1:publish", {
    method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ data: Buffer.from("corrida supervisada KZ-037").toString("base64") }] })
  });
  console.log("disparo de la corrida (misma función del programador): HTTP " + pub.status);
  const inicio = Date.now();
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 45000));
    const r = await fetch(DB + "/documents/backups/2026-10-30", { headers: h });
    if (r.status === 404) { console.log(`  [${Math.round((Date.now()-inicio)/1000)}s] sin manifiesto todavía`); continue; }
    const f = (await r.json()).fields || {};
    const lotes = (f.lotes && f.lotes.mapValue && f.lotes.mapValue.fields) || {};
    const ids = Object.keys(lotes).sort();
    const estados = ids.map((k) => k + ":" + lotes[k].mapValue.fields.estado.stringValue);
    const listos = ids.filter((k) => lotes[k].mapValue.fields.estado.stringValue === "COMPLETADO").length;
    console.log(`  [${Math.round((Date.now()-inicio)/1000)}s] ${listos}/${ids.length} COMPLETADO · ${estados.join(" ")}`);
    if (ids.length >= 9 && listos === ids.length) { console.log("  => MANIFIESTO COMPLETO"); break; }
  }
})().catch((e) => console.error("ERROR: " + e.message));
