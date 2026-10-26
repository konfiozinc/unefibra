'use strict';
/* ============================================================
 * UneFibra SAS — Reglas de la migración de servicios (KZ-UNEF-006)
 * ------------------------------------------------------------
 * Este módulo NO escribe nada: decide. El script de migración le pregunta
 * caso por caso y solo escribe cuando aquí se dice que sí.
 *
 * Principios que implementa:
 *   · No inventar valores: si falta el plan, el precio o el vencimiento, el
 *     candidato NO se migra (queda para revisión humana).
 *   · No tocar lo que ya existe: si el cliente ya tiene servicio, se omite.
 *   · No duplicar: el id del documento es determinista (`svc-<clienteId>`).
 *   · No confiar: cada documento se valida ANTES de escribirse.
 *   · No dejar el servicio suelto: nace en conciliación pendiente, así que
 *     ninguna automatización lo toca hasta que una persona lo valide.
 *   · No revertir a ciegas: un servicio que tuvo actividad posterior no se borra.
 * ============================================================ */

const { bloqueConciliacion, ESTADO_CONCILIACION } = require("./conciliacion");
const { servicioEsperadoParaCliente, esEstadoClienteValido } = require("./estados");

const REFERENCIA = "kz-unef-006";

const esFechaISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* ------------------------------------------------------------
 * KZ-UNEF-018 · Direcciones IP
 * ------------------------------------------------------------
 * En la cartera real el campo `ip` está mayormente corrupto: de 358 clientes
 * solo 35 tienen una IPv4 utilizable; 299 quedaron truncadas a dos octetos
 * (por ejemplo "101.11", que podía ser .11, .110 o .118) porque Excel las
 * convirtió en número, 6 son numéricas mal formadas, 4 son texto y 14 no
 * existen.
 *
 * Copiar ese valor a `servicios.ip` sería peor que dejarlo vacío: crearía una
 * dirección operativa FALSA en un documento nuevo, y cualquier automatización
 * futura (MikroTik) la tomaría como buena. Y borrarlo sin más sería perder el
 * único dato original que hay.
 *
 * Decisión: `ip` guarda SOLO una IPv4 válida. Cuando el valor no sirve, `ip`
 * queda en null y el texto original se conserva intacto en `ipOriginal`, con
 * `ipEstado = NO_UTILIZABLE` para que el panel y la conciliación lo vean.
 * No se inventa ni se corrige ningún octeto.
 * ---------------------------------------------------------- */

/** ¿Es una IPv4 utilizable como dirección operativa? (sin adivinar octetos) */
function esIPv4Utilizable(valor) {
  if (typeof valor !== "string") return false;
  const s = valor.trim();
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return false;
  const octetos = s.split(".").map(Number);
  if (octetos.some((o) => o > 255)) return false;
  /* 0.x, 127.x y 224+ no son direcciones de abonado. */
  if (octetos[0] === 0 || octetos[0] === 127 || octetos[0] >= 224) return false;
  return true;
}

/**
 * Prepara el campo ip de un servicio nuevo: utilizable o conservado aparte.
 * @returns {{ ip: string|null, ipOriginal: string|null, ipEstado: string }}
 */
function prepararIp(valor) {
  if (valor === null || valor === undefined) return { ip: null, ipOriginal: null, ipEstado: "AUSENTE" };
  const texto = String(valor).trim();
  if (texto === "") return { ip: null, ipOriginal: null, ipEstado: "AUSENTE" };
  if (esIPv4Utilizable(texto)) return { ip: texto, ipOriginal: null, ipEstado: "UTILIZABLE" };
  return { ip: null, ipOriginal: texto, ipEstado: "NO_UTILIZABLE" };
}


/** Id determinista: reejecutar no duplica. */
function idServicioPara(clienteId) {
  if (!clienteId || !String(clienteId).trim()) throw new Error("clienteId obligatorio");
  return `svc-${String(clienteId).trim()}`;
}

/**
 * ¿Se puede crear el servicio de este cliente?
 * @param {object} cliente   datos del cliente (planId, precioMensual, fechaVencimiento, estadoCliente)
 * @param {object} contexto  { serviciosExistentes: number, fechaInicioServicio?: string }
 * @returns {{ apto: boolean, motivos: string[], clase: string }}
 */
function evaluarCandidato(cliente, contexto = {}) {
  const motivos = [];
  const c = cliente || {};

  if (!c.planId || String(c.planId).trim() === "") motivos.push("sin planId");
  if (!(typeof c.precioMensual === "number" && c.precioMensual > 0)) motivos.push("sin precioMensual válido");
  if (!esFechaISO(c.fechaVencimiento)) motivos.push("sin fechaVencimiento válida");
  if (!esEstadoClienteValido(c.estadoCliente)) motivos.push("estadoCliente fuera del modelo");

  const existentes = Number(contexto.serviciosExistentes || 0);
  if (existentes > 1) motivos.push(`cliente con ${existentes} servicios (ambiguo)`);
  if (existentes === 1) motivos.push("ya tiene servicio");

  let clase = "CANDIDATO_MIGRABLE";
  if (existentes >= 1) clase = "OMITIDO_YA_TIENE_SERVICIO";
  else if (motivos.length) clase = "REQUIERE_REVISION";

  return { apto: motivos.length === 0, motivos, clase };
}

/**
 * Construye el documento de servicio a partir del cliente, SIN inventar nada:
 * copia plan, precio y vencimiento; si no hay fecha de instalación se deja null.
 */
function construirServicio(cliente, opciones = {}) {
  const c = cliente || {};
  const id = c.id;
  if (!id) throw new Error("El cliente necesita id.");

  const evaluacion = evaluarCandidato(c, { serviciosExistentes: opciones.serviciosExistentes || 0 });
  if (!evaluacion.apto) {
    const e = new Error(`Candidato no migrable (${id}): ${evaluacion.motivos.join(", ")}`);
    e.motivos = evaluacion.motivos;
    throw e;
  }

  const ahora = opciones.ahora instanceof Date ? opciones.ahora : new Date();
  const ipPreparada = prepararIp(c.ip);
  return {
    id: idServicioPara(id),
    datos: {
      clienteId: id,
      planId: c.planId,
      precioMensual: c.precioMensual,
      estado: servicioEsperadoParaCliente(c.estadoCliente),
      fechaInicio: esFechaISO(c.fechaInicioServicio) ? c.fechaInicioServicio : null,
      fechaVencimiento: c.fechaVencimiento,
      cicloCorte: c.cicloCorte || null,
      /* Solo una IPv4 válida es dirección operativa; el resto se conserva aparte. */
      ip: ipPreparada.ip,
      ipEstado: ipPreparada.ipEstado,
      ...(ipPreparada.ipOriginal !== null ? { ipOriginal: ipPreparada.ipOriginal } : {}),
      origen: REFERENCIA,
      origenTipo: "migracion-cartera",
      creadoEn: ahora.toISOString(),
      /* Nace protegido: ninguna automatización lo toca hasta que se valide. */
      conciliacion: bloqueConciliacion({ referencia: REFERENCIA, ahora })
    }
  };
}

/**
 * ¿Se puede revertir (borrar) un servicio creado por la migración?
 * Solo si sigue siendo de la migración, sigue pendiente de validación y no
 * muestra actividad posterior. Cualquier duda → no se borra.
 */
function puedeRevertirse(servicio, contexto = {}) {
  const s = servicio || {};
  if (s.origen !== REFERENCIA) {
    return { permitido: false, motivo: "no lo creó esta migración" };
  }
  if (!s.conciliacion || s.conciliacion.estado !== ESTADO_CONCILIACION.PENDIENTE) {
    return { permitido: false, motivo: `estado de conciliación ${s.conciliacion ? s.conciliacion.estado : "ausente"}: alguien ya lo revisó` };
  }
  if (contexto.pagosAsociados > 0) {
    return { permitido: false, motivo: `tiene ${contexto.pagosAsociados} pago(s) asociados` };
  }
  if (contexto.modificadoPorAdministrador === true) {
    return { permitido: false, motivo: "tiene modificaciones posteriores a la migración" };
  }
  if (contexto.fechaModificacion && s.creadoEn) {
    const creado = Date.parse(s.creadoEn);
    const modificado = Date.parse(contexto.fechaModificacion);
    if (Number.isFinite(creado) && Number.isFinite(modificado) && modificado - creado > 5 * 60 * 1000) {
      return { permitido: false, motivo: "fue modificado después de crearse" };
    }
  }
  return { permitido: true, motivo: null };
}

module.exports = {
  REFERENCIA,
  idServicioPara,
  esIPv4Utilizable,
  prepararIp,
  evaluarCandidato,
  construirServicio,
  puedeRevertirse
};
