#!/usr/bin/env node
/* ============================================================
 * UneFibra SAS — Configuración del cobro
 * ------------------------------------------------------------
 * Deja en Firestore los datos que usan los mensajes de cobro, para
 * que NO vivan en el código y se puedan editar desde el panel:
 *
 *   metodos_pago/bancolombia-91280742282   → cuenta PRINCIPAL del cobro
 *   metodos_pago/bancolombia-23046299451   → la otra cuenta (inactiva, sin confirmar)
 *   configuracion/soporte                  → WhatsApp que van en el mensaje
 *   configuracion/plantillasMensaje        → textos editables de los mensajes
 *   configuracion/camposDireccionObligatorios → exigir los datos de dirección
 *
 * Es IDEMPOTENTE: usa identificadores fijos, así que ejecutarlo dos veces
 * deja exactamente lo mismo y nunca duplica cuentas.
 *
 * CÓMO SE EJECUTA
 *   node tools/configurar-cobro.js            → simulación (no escribe nada)
 *   node tools/configurar-cobro.js --aplicar  → aplica los cambios
 *
 * Usa la sesión local de firebase-tools (tools/lib/google-auth.js).
 * ============================================================ */

"use strict";

const path = require("path");
const { tokenAcceso } = require("./lib/google-auth");
const {
  PLANTILLA_ANTES_CORTE,
  PLANTILLA_DESPUES_CORTE,
  SOPORTE_POR_DEFECTO
} = require("../functions/src/mensajes");

const PROYECTO = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const APLICAR = process.argv.includes("--aplicar");

const TITULAR = "Elkin Nazar Pérez";
const CUENTA_PRINCIPAL = "91280742282";
const CUENTA_ALTERNATIVA = "23046299451";

/** Convierte un valor de JavaScript al formato tipado de la API REST. */
function aFirestore(valor) {
  if (valor === null || valor === undefined) return { nullValue: null };
  if (typeof valor === "string") return { stringValue: valor };
  if (typeof valor === "boolean") return { booleanValue: valor };
  if (typeof valor === "number") {
    return Number.isInteger(valor) ? { integerValue: String(valor) } : { doubleValue: valor };
  }
  if (Array.isArray(valor)) return { arrayValue: { values: valor.map(aFirestore) } };
  if (typeof valor === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(valor)) fields[k] = aFirestore(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(valor) };
}

async function obtener(token, ruta) {
  const res = await fetch(`${BASE}/${ruta}`, { headers: { Authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`No se pudo leer ${ruta}: ${res.status}`);
  return res.json();
}

async function escribir(token, ruta, campos) {
  const mascara = Object.keys(campos).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const cuerpo = {
    fields: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, aFirestore(v)]))
  };
  const res = await fetch(`${BASE}/${ruta}?${mascara}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });
  if (!res.ok) {
    throw new Error(`No se pudo escribir ${ruta}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

(async function main() {
  console.log("Configuración del cobro — proyecto " + PROYECTO);
  console.log(APLICAR ? "Modo: APLICAR\n" : "Modo: SIMULACIÓN (no se escribe nada)\n");

  const token = await tokenAcceso();
  const ahora = new Date().toISOString();
  const cambios = [];

  // ---------------- Cuentas bancarias (colección metodos_pago) ----------------
  // Los mensajes de cobro leen de aquí la cuenta principal. Se guardan las dos
  // cuentas que llegaron del cliente: la confirmada como principal y la otra
  // documentada pero inactiva, para poder cambiarla desde el panel sin tocar código.
  const cuentas = [
    {
      id: "bancolombia-91280742282",
      datos: {
        nombre: "Bancolombia",
        banco: "Bancolombia",
        tipo: "ahorros",
        tipoCuenta: "Ahorros",
        numeroCuenta: CUENTA_PRINCIPAL,
        titular: TITULAR,
        descripcion: "Cuenta principal para el cobro (confirmada por el cliente)",
        activo: true,
        principal: true,
        confirmada: true,
        orden: 1
      }
    },
    {
      id: "bancolombia-23046299451",
      datos: {
        nombre: "Bancolombia",
        banco: "Bancolombia",
        tipo: "ahorros",
        tipoCuenta: "Ahorros",
        numeroCuenta: CUENTA_ALTERNATIVA,
        titular: TITULAR,
        descripcion: "Otra cuenta que aparecía en los ejemplos. INACTIVA y SIN CONFIRMAR: " +
          "actívala y márcala como principal desde el panel si esta es la correcta.",
        activo: false,
        principal: false,
        confirmada: false,
        orden: 2
      }
    }
  ];

  for (const cuenta of cuentas) {
    const ruta = `metodos_pago/${cuenta.id}`;
    const existente = await obtener(token, ruta);
    cambios.push({
      ruta,
      que: (existente ? "actualizar " : "crear ") + `cuenta ${cuenta.datos.numeroCuenta}` +
        (cuenta.datos.principal ? " (PRINCIPAL)" : " (inactiva)"),
      campos: { ...cuenta.datos, createdAt: existente ? undefined : ahora, updatedAt: ahora }
    });
  }

  // ---------------- Documentos de configuración ----------------
  cambios.push({
    ruta: "configuracion/soporte",
    que: "WhatsApp de soporte de los mensajes",
    campos: {
      clave: "soporte",
      valor: { whatsapp1: SOPORTE_POR_DEFECTO.whatsapp1, whatsapp2: SOPORTE_POR_DEFECTO.whatsapp2 },
      descripcion: "WhatsApp que aparecen en los mensajes de cobro",
      updatedAt: ahora
    }
  });

  cambios.push({
    ruta: "configuracion/plantillasMensaje",
    que: "Plantillas de los mensajes de cobro",
    campos: {
      clave: "plantillasMensaje",
      valor: { antesCorte: PLANTILLA_ANTES_CORTE, despuesCorte: PLANTILLA_DESPUES_CORTE },
      descripcion: "Textos de los mensajes antes y después del corte (editables desde el panel)",
      updatedAt: ahora
    }
  });

  cambios.push({
    ruta: "configuracion/camposDireccionObligatorios",
    que: "Exigir los datos de dirección",
    campos: {
      clave: "camposDireccionObligatorios",
      valor: true,
      descripcion: "Si es true, dirección/sector/edificio/torre/apartamento son obligatorios " +
        "según el tipo de vivienda",
      updatedAt: ahora
    }
  });

  console.log("Cambios a realizar:");
  for (const c of cambios) console.log("  · " + c.ruta + " — " + c.que);

  if (!APLICAR) {
    console.log("\nEsto fue una simulación. Para aplicarlo: node tools/configurar-cobro.js --aplicar");
    return;
  }

  console.log("\nAplicando…");
  for (const c of cambios) {
    const campos = Object.fromEntries(Object.entries(c.campos).filter(([, v]) => v !== undefined));
    await escribir(token, c.ruta, campos);
    console.log("  ✔ " + c.ruta);
  }
  console.log("\nListo. Nada duplicado: los identificadores son fijos.");
})().catch((err) => {
  console.error("\nNo se pudo completar: " + err.message);
  process.exitCode = 1;
});
