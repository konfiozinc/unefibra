#!/usr/bin/env node
/* ============================================================
 * UneFibra SAS — Migración de los ciclos de corte
 * ------------------------------------------------------------
 * Asigna `cicloCorte` ("15" o "30") y `proximoCorte` a los clientes
 * que todavía no los tienen. El ciclo se deduce de la fecha de
 * vencimiento: días 1 a 15 → corte 15; del 16 en adelante → corte 30.
 *
 * RESPETA el ciclo ya asignado a mano: solo rellena lo que falta y
 * refresca `proximoCorte` cuando cambió de mes. Nunca borra clientes.
 *
 * CÓMO SE EJECUTA
 *   node tools/migrar-ciclos.js             → simulación (no escribe nada)
 *   node tools/migrar-ciclos.js --aplicar   → aplica los cambios
 *
 * No es obligatorio ejecutarla: el motor diario (`processDueDates`) hace el
 * mismo trabajo y el panel tiene la función `migrarCiclosCorte`. Sirve para no
 * tener que esperar a la madrugada justo después de desplegar.
 *
 * Usa la sesión local de firebase-tools (ver tools/lib/google-auth.js), así
 * que no hay que descargar ninguna clave de servicio.
 * ============================================================ */

"use strict";

const { tokenAcceso } = require("./lib/google-auth");
// Regla de negocio compartida con las Cloud Functions: una sola verdad.
const { proximoCorteDe, cicloValido } = require("../functions/src/cortes");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const APLICAR = process.argv.includes("--aplicar");

/** Texto de un campo string de Firestore REST, o null. */
function texto(campos, clave) {
  const v = campos && campos[clave];
  if (!v) return null;
  if (typeof v.stringValue === "string") return v.stringValue;
  return null;
}

async function listarClientes(token) {
  const docs = [];
  let pageToken = "";
  do {
    const url = `${BASE}/clientes?pageSize=300` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      throw new Error(`Firestore respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    (data.documents || []).forEach((d) => docs.push(d));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function actualizarCliente(token, id, campos) {
  const mascara = Object.keys(campos).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const cuerpo = {
    fields: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, { stringValue: v }]))
  };
  const res = await fetch(`${BASE}/clientes/${id}?${mascara}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });
  if (!res.ok) {
    throw new Error(`No se pudo actualizar ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

(async function main() {
  console.log("Migración de ciclos de corte — proyecto " + PROYECTO);
  console.log(APLICAR ? "Modo: APLICAR (se escriben los cambios)\n" : "Modo: SIMULACIÓN (no se escribe nada)\n");

  const token = await tokenAcceso();
  const docs = await listarClientes(token);
  console.log(`Clientes revisados: ${docs.length}\n`);

  const resumen = { yaEstaban: 0, asignados: 0, refrescados: 0, sinFecha: 0, errores: 0 };
  const detalle = [];

  for (const d of docs) {
    const id = String(d.name || "").split("/").pop();
    const campos = d.fields || {};
    const vencimiento = texto(campos, "fechaVencimiento");
    const cicloActual = texto(campos, "cicloCorte");
    const proximoActual = texto(campos, "proximoCorte");

    const ciclo = cicloValido(cicloActual, vencimiento);
    if (!ciclo) {
      resumen.sinFecha++;
      detalle.push(`  ? ${id} — sin fecha de vencimiento: no se puede deducir el ciclo (se deja igual)`);
      continue;
    }

    const proximo = proximoCorteDe(ciclo);
    if (cicloActual === ciclo && proximoActual === proximo) {
      resumen.yaEstaban++;
      continue;
    }

    const esNuevo = cicloActual !== ciclo;
    if (esNuevo) resumen.asignados++; else resumen.refrescados++;

    detalle.push(`  ${esNuevo ? "+" : "~"} ${id} — vence ${vencimiento || "—"} → ` +
      `ciclo ${cicloActual || "(sin asignar)"} → ${ciclo}, corte ${proximoActual || "—"} → ${proximo}`);

    if (APLICAR) {
      try {
        await actualizarCliente(token, id, { cicloCorte: ciclo, proximoCorte: proximo });
      } catch (err) {
        resumen.errores++;
        detalle.push(`    ERROR: ${err.message}`);
      }
    }
  }

  detalle.forEach((l) => console.log(l));

  console.log("\nResumen");
  console.log(`  Sin cambios necesarios : ${resumen.yaEstaban}`);
  console.log(`  Ciclo asignado         : ${resumen.asignados}`);
  console.log(`  Próximo corte refrescado: ${resumen.refrescados}`);
  console.log(`  Sin fecha de vencimiento: ${resumen.sinFecha}`);
  console.log(`  Errores                : ${resumen.errores}`);

  if (!APLICAR && (resumen.asignados || resumen.refrescados)) {
    console.log("\nEsto fue una simulación. Para aplicarlo: node tools/migrar-ciclos.js --aplicar");
  }
})().catch((err) => {
  console.error("\nLa migración no se pudo completar: " + err.message);
  process.exitCode = 1;
});
