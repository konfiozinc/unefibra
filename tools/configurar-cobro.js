#!/usr/bin/env node
/* ============================================================
 * UneFibra SAS — Configuración del cobro
 * ------------------------------------------------------------
 * Deja en Firestore los datos que usan los mensajes de cobro, para
 * que NO vivan en el código y se puedan editar desde el panel:
 *
 *   metodos_pago/nequi                     → Nequi (solo nombre, sin teléfono: pendiente del cliente)
 *   metodos_pago/bancolombia-91280742282   → Transferencia Bancolombia (cuenta PRINCIPAL confirmada)
 *   metodos_pago/efectivo                  → Efectivo (solo nombre)
 *   configuracion/soporte                  → WhatsApp que van en el mensaje
 *   configuracion/plantillasMensaje        → textos editables de los mensajes
 *   configuracion/camposDireccionObligatorios → exigir los datos de dirección
 *   configuracion/diasAntes/diasDespues/diasSuspension → recordatorios 3/0 (3 días antes + el mismo día) y suspensión 3 días
 *   configuracion/instalacionGratis        → instalación gratuita ($0 COP)
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

  // ---------------- Métodos de pago (colección metodos_pago) ----------------
  // Decisión comercial CONFIRMADA: Nequi, Transferencia Bancolombia y Efectivo.
  // Solo se guardan los NOMBRES (sin números de cuenta ni teléfonos inventados).
  // La única cuenta con datos reales es la Bancolombia ya confirmada por el cliente;
  // el número de teléfono de Nequi queda pendiente hasta que el cliente lo entregue.
  const metodos = [
    {
      id: "nequi",
      datos: {
        nombre: "Nequi",
        tipo: "nequi",
        descripcion: "Pago por Nequi (número de teléfono pendiente de confirmar por el cliente)",
        activo: true,
        principal: false,
        orden: 1
      }
    },
    {
      id: "bancolombia-91280742282",
      datos: {
        nombre: "Transferencia Bancolombia",
        banco: "Bancolombia",
        tipo: "transferencia",
        tipoCuenta: "Ahorros",
        numeroCuenta: CUENTA_PRINCIPAL,
        titular: TITULAR,
        descripcion: "Cuenta principal para el cobro (confirmada por el cliente)",
        activo: true,
        principal: true,
        confirmada: true,
        orden: 2
      }
    },
    {
      id: "efectivo",
      datos: {
        nombre: "Efectivo",
        tipo: "efectivo",
        descripcion: "Pago en efectivo (punto de recaudo que indique la empresa)",
        activo: true,
        principal: false,
        orden: 3
      }
    }
  ];

  for (const metodo of metodos) {
    const ruta = `metodos_pago/${metodo.id}`;
    const existente = await obtener(token, ruta);
    cambios.push({
      ruta,
      que: (existente ? "actualizar " : "crear ") + "método " + metodo.datos.nombre +
        (metodo.datos.principal ? " (PRINCIPAL)" : ""),
      campos: { ...metodo.datos, createdAt: existente ? undefined : ahora, updatedAt: ahora }
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

  // ---------------- Recordatorios y suspensión (decisión comercial confirmada) ----------------
  cambios.push({
    ruta: "configuracion/diasAntes",
    que: "Recordatorio: 3 días antes del vencimiento",
    campos: {
      clave: "diasAntes",
      valor: [3],
      descripcion: "Días antes del vencimiento para recordatorios",
      updatedAt: ahora
    }
  });

  cambios.push({
    ruta: "configuracion/diasDespues",
    que: "Recordatorio el mismo día del vencimiento (0)",
    campos: {
      clave: "diasDespues",
      valor: [0],
      descripcion: "Día del vencimiento (0)",
      updatedAt: ahora
    }
  });

  cambios.push({
    ruta: "configuracion/diasSuspension",
    que: "Suspensión a los 3 días naturales de mora",
    campos: {
      clave: "diasSuspension",
      valor: 3,
      descripcion: "Días naturales de mora antes de suspender el servicio",
      updatedAt: ahora
    }
  });

  cambios.push({
    ruta: "configuracion/instalacionGratis",
    que: "Instalación gratuita ($0 COP)",
    campos: {
      clave: "instalacionGratis",
      valor: true,
      descripcion: "La instalación es gratuita ($0 COP); no se genera ningún concepto de cobro automático",
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
