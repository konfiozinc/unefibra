const { tokenAcceso } = require("./tools/lib/google-auth");
(async () => {
  const t = await tokenAcceso();
  for (const url of [
    "https://firestore.googleapis.com/v1/projects/une-fibra/databases/(default)/operations",
    "https://firestore.googleapis.com/v1/projects/une-fibra/databases/(default)/operations?filter=done=false"
  ]) {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + t } });
    const txt = await r.text();
    console.log("GET " + url.replace("https://firestore.googleapis.com/v1/projects/une-fibra/databases/(default)", "") + " -> HTTP " + r.status);
    if (r.ok) {
      const j = JSON.parse(txt);
      const ops = j.operations || [];
      console.log("  operaciones: " + ops.length);
      for (const o of ops.slice(0, 10)) console.log("   · " + (o.name || "").split("/").pop() + " done=" + !!o.done + (o.metadata ? " meta=" + JSON.stringify(o.metadata).slice(0, 160) : ""));
    } else {
      console.log("  " + txt.slice(0, 300));
    }
  }
})().catch((e) => console.error("ERROR: " + e.message));
