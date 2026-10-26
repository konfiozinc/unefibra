'use strict';
/* ============================================================
 * UneFibra SAS — Evaluación de un servicio antes de habilitarlo (KZ-UNEF-008)
 * ------------------------------------------------------------
 * Regla que este módulo hace cumplir:
 *   «Habilitar» expone el servicio al motor de cobros y cortes. Si el servicio
 *   está VENCIDO, habilitarlo puede suspender a un cliente en la siguiente
 *   corrida. Por eso un vencido NUNCA puede habilitarse con una confirmación
 *   genérica: exige una autorización explícita que nombre el riesgo.
 *
 * Se evalúa en el SERVIDOR y con la zona horaria de Colombia. El navegador
 * puede mostrar el resumen, pero no decide: la callable vuelve a evaluar justo
 * antes de escribir.
 * ============================================================ */

const { hoyISO, normalizarFecha } = require("./renovacion");
const { ESTADO_CONCILIACION } = require("./conciliacion");
const { ESTADOS_CLIENTE } = require("./estados");

const SITUACION = Object.freeze({
  AL_DIA: "AL_DIA",
  VENCE_HOY: "VENCE_HOY",
  VENCIDO: "VENCIDO",
  SUSPENDIDO: "SUSPENDIDO",
  FECHA_INVALIDA: "FECHA_INVALIDA",
  CONTRADICTORIO: "CONTRADICTORIO",
  BLOQUEADO_EN_FLUJO: "BLOQUEADO_EN_FLUJO"
});

const ETIQUETA = Object.freeze({
  AL_DIA: "Al día",
  VENCE_HOY: "Vence hoy",
  VENCIDO: "Vencido",
  SUSPENDIDO: "Cliente suspendido",
  FECHA_INVALIDA: "Fecha inválida",
  CONTRADICTORIO: "Información contradictoria",
  BLOQUEADO_EN_FLUJO: "No está validado todavía"
});

/* Situaciones en las que NO se puede habilitar aunque el administrador insista. */
const NO_HABILITABLES = Object.freeze([
  SITUACION.FECHA_INVALIDA,
  SITUACION.CONTRADICTORIO,
  SITUACION.BLOQUEADO_EN_FLUJO,
  /* Un cliente suspendido exige revisión administrativa: habilitar su servicio
     expondría a un cliente ya cortado al motor sin que nadie lo decidiera. */
  SITUACION.SUSPENDIDO
]);

const esFechaISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Días desde hoy (Colombia) hasta la fecha. Negativo = vencido. */
function diasHasta(fecha, hoy) {
  const a = normalizarFecha(fecha).getTime();
  const b = normalizarFecha(hoy || hoyISO()).getTime();
  return Math.round((a - b) / 86400000);
}

/**
 * Evalúa si un servicio puede habilitarse y con qué advertencias.
 * @param {object} args  { servicio, cliente, pagos: [{estado, periodoFin}] }
 */
function evaluarServicio({ servicio, cliente, pagos } = {}) {
  const s = servicio || {};
  const c = cliente || {};
  const listaPagos = Array.isArray(pagos) ? pagos : [];
  const hoy = hoyISO();

  const motivos = [];
  const consecuencias = [];
  let situacion;

  /* 1 · Estado de conciliación: solo se habilita lo VALIDADO. */
  const estadoConciliacion = (s.conciliacion || {}).estado || null;
  if (estadoConciliacion !== ESTADO_CONCILIACION.VALIDADA) {
    motivos.push(`estado de conciliación "${estadoConciliacion || "ausente"}" (se requiere VALIDADA)`);
    return {
      situacion: SITUACION.BLOQUEADO_EN_FLUJO,
      etiqueta: ETIQUETA[SITUACION.BLOQUEADO_EN_FLUJO],
      puedeHabilitar: false,
      requiereAutorizacionVencido: false,
      requiereAdvertenciaVenceHoy: false,
      motivos, consecuencias, dias: null, hoy,
      estadoConciliacion
    };
  }

  /* 2 · Fecha de vencimiento. */
  if (!esFechaISO(s.fechaVencimiento)) {
    motivos.push(s.fechaVencimiento ? `fecha de vencimiento con formato inválido ("${String(s.fechaVencimiento).slice(0, 20)}")` : "sin fecha de vencimiento");
    situacion = SITUACION.FECHA_INVALIDA;
  }

  /* 3 · Contradicciones entre cliente y servicio. */
  const contradicciones = [];
  if (c.fechaVencimiento && esFechaISO(c.fechaVencimiento) && esFechaISO(s.fechaVencimiento)
      && c.fechaVencimiento !== s.fechaVencimiento) {
    contradicciones.push(`el cliente vence el ${c.fechaVencimiento} y el servicio el ${s.fechaVencimiento}`);
  }
  if (c.estadoCliente && !ESTADOS_CLIENTE.includes(c.estadoCliente)) {
    contradicciones.push(`el cliente tiene un estado fuera del modelo ("${c.estadoCliente}")`);
  }
  if (s.clienteId && c.id && s.clienteId !== c.id) {
    contradicciones.push("el servicio apunta a otro cliente");
  }
  if (contradicciones.length) {
    motivos.push(...contradicciones);
    situacion = SITUACION.CONTRADICTORIO;
  }

  /* 4 · Cliente suspendido: puede habilitarse el registro, pero es revisión
        administrativa y el motor lo tratará según su estado. */
  if (!situacion && c.estadoCliente === "SUSPENDIDO") {
    situacion = SITUACION.SUSPENDIDO;
    motivos.push("el cliente figura SUSPENDIDO: exige revisión administrativa antes de habilitar");
    consecuencias.push("si se reactivara al cliente primero, su servicio podría habilitarse después");
  }

  /* 5 · Días de mora. */
  let dias = null;
  if (!situacion) {
    dias = diasHasta(s.fechaVencimiento, hoy);
    if (dias < 0) {
      situacion = SITUACION.VENCIDO;
      consecuencias.push(`venció hace ${Math.abs(dias)} día(s) (${s.fechaVencimiento})`);
      consecuencias.push("el motor lo marcará PENDIENTE_PAGO y, si no hay un pago que cubra el periodo, lo suspenderá a los 3 días de mora");
    } else if (dias === 0) {
      situacion = SITUACION.VENCE_HOY;
      consecuencias.push("vence hoy: a partir de mañana la mora empieza a contar");
    } else {
      situacion = SITUACION.AL_DIA;
    }
  }

  /* 6 · Pagos que cubren el periodo: cambian el riesgo real de un vencido. */
  const pagosVigentes = listaPagos.filter((p) => p && p.estado === "CONFIRMADO"
    && esFechaISO(p.periodoFin) && p.periodoFin >= hoy);
  if (situacion === SITUACION.VENCIDO && pagosVigentes.length) {
    consecuencias.push(`tiene ${pagosVigentes.length} pago(s) confirmado(s) que cubren hasta ${pagosVigentes.map((p) => p.periodoFin).sort().pop()}: el motor no lo suspendería`);
  } else if (situacion === SITUACION.VENCIDO) {
    consecuencias.push("no hay ningún pago confirmado que cubra el periodo actual");
  }

  const puedeHabilitar = !NO_HABILITABLES.includes(situacion);
  return {
    situacion,
    etiqueta: ETIQUETA[situacion],
    puedeHabilitar,
    /* Solo un VENCIDO exige autorización explícita e informada. */
    requiereAutorizacionVencido: situacion === SITUACION.VENCIDO,
    requiereAdvertenciaVenceHoy: situacion === SITUACION.VENCE_HOY,
    motivos,
    consecuencias,
    dias,
    hoy,
    estadoConciliacion,
    pagosVigentes: pagosVigentes.length,
    vencimiento: s.fechaVencimiento || null
  };
}

/**
 * Decide si una petición concreta queda autorizada para habilitar.
 * `autorizacion` es lo que llega del panel; el servidor NUNCA se fía de ella
 * sin volver a evaluar el estado.
 */
function autorizarHabilitacion(evaluacion, autorizacion = {}) {
  const a = autorizacion || {};
  if (!evaluacion.puedeHabilitar) {
    return { permitido: false, motivo: `No se puede habilitar: ${evaluacion.motivos.join("; ") || evaluacion.etiqueta}.` };
  }
  if (evaluacion.requiereAutorizacionVencido) {
    const declara = a.autorizarVencido === true;
    const texto = typeof a.justificacion === "string" ? a.justificacion.trim() : "";
    if (!declara || texto.length < 10) {
      return {
        permitido: false,
        motivo: "El servicio está VENCIDO y habilitarlo lo expone al motor de cortes. "
          + "Se requiere autorización explícita (autorizarVencido: true) y una justificación de al menos 10 caracteres.",
        requiereAutorizacionVencido: true
      };
    }
  }
  if (evaluacion.requiereAdvertenciaVenceHoy && a.advertenciaAceptada !== true) {
    return {
      permitido: false,
      motivo: "El servicio vence HOY: hay que aceptar la advertencia antes de habilitarlo.",
      requiereAdvertenciaVenceHoy: true
    };
  }
  return { permitido: true, motivo: null };
}

/** Resumen de una tanda: cuántos de cada situación y quiénes quedan fuera. */
function resumirTanda(evaluaciones) {
  const lista = Array.isArray(evaluaciones) ? evaluaciones : [];
  const conteo = {};
  for (const k of Object.values(SITUACION)) conteo[k] = 0;
  for (const e of lista) conteo[e.situacion] = (conteo[e.situacion] || 0) + 1;
  return {
    total: lista.length,
    conteo,
    habilitables: lista.filter((e) => e.puedeHabilitar && !e.requiereAutorizacionVencido).length,
    requierenAutorizacion: lista.filter((e) => e.puedeHabilitar && e.requiereAutorizacionVencido).length,
    bloqueados: lista.filter((e) => !e.puedeHabilitar).length
  };
}

module.exports = {
  SITUACION,
  ETIQUETA,
  NO_HABILITABLES,
  diasHasta,
  evaluarServicio,
  autorizarHabilitacion,
  resumirTanda
};
