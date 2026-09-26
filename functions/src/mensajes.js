/* ============================================================
 * UneFibra SAS — Plantillas de los mensajes de cobro
 * ------------------------------------------------------------
 * Dos mensajes: el de ANTES del corte (factura disponible) y el de
 * DESPUÉS del corte (factura vencida, servicio por suspender).
 *
 * NINGÚN dato de negocio está escrito aquí: los bancos, los WhatsApp
 * de soporte y los textos de las plantillas se leen de Firestore
 * (`metodos_pago` y `configuracion`). Lo que hay en este archivo son
 * solo los VALORES POR DEFECTO, que se usan cuando el panel todavía
 * no tiene configurado nada.
 *
 * Este módulo lo usan las Cloud Functions. El panel del navegador
 * tiene su copia en assets/js/admin/mensajes.js, porque no puede
 * importar CommonJS; hay una prueba que compara las dos.
 * ============================================================ */

"use strict";

const PLANTILLA_ANTES_CORTE = `¡Hola {nombre}! Tu factura de UneFibra del mes de {mes} ya está disponible.

💰 Valor a pagar: {valor}
📅 Fecha límite de pago: {fechaLimite}

🏦 {banco} {tipoCuenta}: {numeroCuenta}
👤 Titular: {titular}

📲 Envía tu comprobante de pago al WhatsApp de UneFibra SAS:
{whatsappSoporte1} o {whatsappSoporte2}

Gracias por preferirnos.
— UneFibra SAS`;

const PLANTILLA_DESPUES_CORTE = `¡Hola {nombre}! Tu factura de UneFibra del mes de {mes} ya está vencida. El servicio será suspendido en las próximas horas.

💰 Valor a pagar: {valor}
📅 Fecha límite: inmediata

🏦 {banco} {tipoCuenta}: {numeroCuenta}
👤 Titular: {titular}

📲 Envía tu comprobante de pago al WhatsApp de UneFibra SAS:
{whatsappSoporte1} o {whatsappSoporte2}

Si ya realizaste el pago, envía el soporte para registrarlo en contabilidad.
— UneFibra SAS`;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * WhatsApp de soporte por defecto. Lo que manda es el documento
 * `configuracion/soporte`, editable desde el panel; esto solo evita que un
 * mensaje de cobro salga sin ninguna vía de contacto si ese documento falta.
 * (Ambas líneas fueron confirmadas como activas por el cliente.)
 */
const SOPORTE_POR_DEFECTO = { whatsapp1: "3044654987", whatsapp2: "3028589954" };

/**
 * 70000 → "$70.000" (pesos colombianos con separador de miles).
 * OJO: si el valor falta se devuelve cadena vacía, NO "$0". Un mensaje que diga
 * "Valor a pagar: $0" haría creer al cliente que el servicio es gratis; antes
 * que una cifra falsa, se omite la línea.
 */
function formatearPesos(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return "";
  return "$" + n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

/** "2026-10-15" → "15-10-2026". */
function formatearFechaDMY(fecha) {
  const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** Mes en palabras a partir de una fecha "YYYY-MM-DD". */
function nombreMes(fecha) {
  const m = String(fecha || "").match(/^\d{4}-(\d{2})/);
  if (!m) return "";
  return MESES[Number(m[1]) - 1] || "";
}

/** Solo el primer nombre: "María Gómez" → "María". */
function primerNombre(nombreCompleto) {
  return String(nombreCompleto || "").trim().split(/\s+/)[0] || "";
}

/**
 * Elige la cuenta bancaria principal de la lista de métodos de pago
 * (colección `metodos_pago`). Gana la marcada con principal:true; si ninguna
 * lo está, la primera activa.
 */
function cuentaPrincipal(cuentas) {
  const activas = (Array.isArray(cuentas) ? cuentas : []).filter((c) => c && c.activo !== false);
  return activas.find((c) => c.principal === true) || activas[0] || null;
}

/**
 * Quita del mensaje las líneas que quedaron sin datos: si todavía no hay
 * cuenta bancaria configurada no queremos enviar "🏦  : " a un cliente.
 */
function quitarLineasSinDatos(texto) {
  return String(texto)
    .split("\n")
    .filter((linea) => {
      const t = linea.trim();
      if (!t) return true;
      if (t.includes("{")) return false; // quedó un campo sin resolver
      const sinEmojis = t.replace(/[^\p{L}\p{N}]/gu, "");
      if (!sinEmojis) return false; // la línea era solo emojis o signos
      // "👤 Titular:" sin nada después de los dos puntos
      const partes = t.split(/[:：]/);
      if (partes.length > 1) {
        const despues = partes.slice(1).join(":").replace(/[^\p{L}\p{N}]/gu, "");
        const etiqueta = partes[0].replace(/[^\p{L}\p{N}]/gu, "");
        if (!despues && /titular|cuenta|valor|fecha/i.test(etiqueta)) return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\s+o\s*$/gm, "") // "{a} o {b}" cuando b no existe
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reemplaza los marcadores {campo} por sus valores. */
function interpolar(plantilla, datos) {
  return String(plantilla || "").replace(/\{(\w+)\}/g, (todo, campo) => {
    const v = datos[campo];
    return v === undefined || v === null ? todo : String(v);
  });
}

/**
 * Datos que rellenan la plantilla.
 * @param {object} cliente   documento de `clientes`
 * @param {object} opciones  { cuentas, soporte, valor, fechaLimite }
 */
function datosDeMensaje(cliente, opciones) {
  const o = opciones || {};
  const cuenta = cuentaPrincipal(o.cuentas);
  const soporte = o.soporte || {};
  const fechaLimite = o.fechaLimite || (cliente && cliente.proximoCorte) || "";

  return {
    nombre: primerNombre(cliente && cliente.nombreCompleto),
    mes: o.mes || nombreMes(fechaLimite),
    valor: formatearPesos(o.valor !== undefined ? o.valor : (cliente && cliente.precioMensual)),
    fechaLimite: formatearFechaDMY(fechaLimite),
    banco: cuenta ? String(cuenta.banco || cuenta.nombre || "") : "",
    tipoCuenta: cuenta ? String(cuenta.tipoCuenta || cuenta.tipo || "") : "",
    numeroCuenta: cuenta ? String(cuenta.numeroCuenta || "") : "",
    titular: cuenta ? String(cuenta.titular || "") : "",
    whatsappSoporte1: String(soporte.whatsapp1 || soporte.whatsappSoporte1 || ""),
    whatsappSoporte2: String(soporte.whatsapp2 || soporte.whatsappSoporte2 || "")
  };
}

/** Mensaje de factura disponible (antes del corte). */
function construirMensajePrevioCorte(cliente, opciones) {
  const o = opciones || {};
  const plantilla = o.plantilla || PLANTILLA_ANTES_CORTE;
  return quitarLineasSinDatos(interpolar(plantilla, datosDeMensaje(cliente, o)));
}

/** Mensaje de factura vencida (después del corte). */
function construirMensajePostCorte(cliente, opciones) {
  const o = opciones || {};
  const plantilla = o.plantilla || PLANTILLA_DESPUES_CORTE;
  return quitarLineasSinDatos(interpolar(plantilla, datosDeMensaje(cliente, o)));
}

module.exports = {
  PLANTILLA_ANTES_CORTE,
  PLANTILLA_DESPUES_CORTE,
  SOPORTE_POR_DEFECTO,
  formatearPesos,
  formatearFechaDMY,
  nombreMes,
  primerNombre,
  cuentaPrincipal,
  datosDeMensaje,
  interpolar,
  quitarLineasSinDatos,
  construirMensajePrevioCorte,
  construirMensajePostCorte
};
