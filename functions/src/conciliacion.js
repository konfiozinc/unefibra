'use strict';
/* ============================================================
 * UneFibra SAS — Estado de CONCILIACIÓN de un servicio (KZ-UNEF-006)
 * ------------------------------------------------------------
 * Problema que resuelve:
 *   La cartera tiene 358 clientes y solo 5 servicios. Al crear los servicios
 *   que faltan, cada uno nace con datos heredados (plan, precio, fechas, IP)
 *   que NO han sido validados por una persona. Si el motor de vencimientos los
 *   viera como normales, empezaría a avisar y a suspender clientes reales a
 *   partir de un vencimiento importado de un Excel.
 *
 * Solución: un estado explícito, guardado en el propio servicio.
 *
 *   servicios/{id}.conciliacion = {
 *     estado: "PENDIENTE_VALIDACION" | "VALIDADA" | "RECHAZADA",
 *     desde:  ISO-8601,
 *     referencia: "kz-unef-006",
 *     motivo?: string
 *   }
 *
 * Mientras el estado sea PENDIENTE_VALIDACION, TODA automatización que pueda
 * afectar al cliente queda bloqueada: suspender, notificar, renovar, reconectar,
 * tocar MikroTik o cambiar el estado administrativo.
 *
 * POR QUÉ NO DEPENDE DE MIKROTIK: la comprobación vive en las rutas de código
 * que escriben (motor, pagos, cambios de estado), no en que falten credenciales
 * del router. Aunque mañana se configuren los secretos MIKROTIK_*, el guardia
 * sigue vigente porque se evalúa antes de cualquier efecto.
 *
 * Es reversible: pasar a VALIDADA devuelve el servicio a la operación normal,
 * y el histórico queda con quién lo validó y cuándo.
 * ============================================================ */

const ESTADO_CONCILIACION = Object.freeze({
  PENDIENTE: "PENDIENTE_VALIDACION",
  /* Revisado por una persona, pero TODAVÍA NO sujeto al motor de cobros ni de
     cortes. KZ-UNEF-007 exige separar «validar» de «habilitar». */
  VALIDADA: "VALIDADA",
  /* Habilitado: el servicio vuelve a la operación normal. */
  HABILITADA: "HABILITADA",
  RECHAZADA: "RECHAZADA"
});

/* Estados que bloquean las automatizaciones. Solo la ausencia del bloque o el
   estado HABILITADA dejan pasar el servicio al motor. */
const ESTADOS_BLOQUEANTES = Object.freeze([
  ESTADO_CONCILIACION.PENDIENTE,
  ESTADO_CONCILIACION.VALIDADA,
  ESTADO_CONCILIACION.RECHAZADA
]);

const REFERENCIA_POR_DEFECTO = "kz-unef-006";

/* Acciones que el estado de conciliación puede bloquear. */
const ACCIONES = Object.freeze({
  SUSPENDER: "SUSPENDER",
  NOTIFICAR: "NOTIFICAR",
  RENOVAR: "RENOVAR",
  RECONECTAR: "RECONECTAR",
  MIKROTIK: "MIKROTIK",
  CAMBIAR_ESTADO: "CAMBIAR_ESTADO"
});

/** ¿El documento está bajo algún estado bloqueante? */
function enConciliacionPendiente(doc) {
  if (!doc || typeof doc !== "object") return false;
  const c = doc.conciliacion;
  if (!c || typeof c !== "object") return false;
  return ESTADOS_BLOQUEANTES.includes(c.estado);
}

/** ¿Está habilitado para la operación normal? (sin bloque o HABILITADA) */
function estaHabilitado(doc) {
  if (!doc || typeof doc !== "object") return true;
  const c = doc.conciliacion;
  if (!c || typeof c !== "object") return true;
  return c.estado === ESTADO_CONCILIACION.HABILITADA;
}

/**
 * ¿Puede ejecutarse esta acción sobre este servicio?
 * Devuelve { permitido, motivo }.
 * Un servicio SIN bloque de conciliación se comporta como siempre (permitido).
 */
function puedeAutomatizar(servicio, accion) {
  if (!enConciliacionPendiente(servicio)) return { permitido: true, motivo: null };
  const c = servicio.conciliacion || {};
  const detalle = c.referencia ? ` (${c.referencia})` : "";
  const pista = c.estado === ESTADO_CONCILIACION.VALIDADA
    ? "está revisado pero NO habilitado: falta la habilitación explícita"
    : `está en conciliación ${c.estado}`;
  return {
    permitido: false,
    motivo: `Servicio ${pista}${detalle}: ${accion} bloqueada hasta que un administrador lo habilite.`
  };
}

/** Guardias con nombre, para que el código que llama se lea solo. */
const guardias = {
  puedeSuspender: (s) => puedeAutomatizar(s, ACCIONES.SUSPENDER),
  puedeNotificar: (s) => puedeAutomatizar(s, ACCIONES.NOTIFICAR),
  puedeRenovar: (s) => puedeAutomatizar(s, ACCIONES.RENOVAR),
  puedeReconectar: (s) => puedeAutomatizar(s, ACCIONES.RECONECTAR),
  puedeTocarMikrotik: (s) => puedeAutomatizar(s, ACCIONES.MIKROTIK),
  puedeCambiarEstado: (s) => puedeAutomatizar(s, ACCIONES.CAMBIAR_ESTADO)
};

/**
 * Bloque de conciliación para un servicio recién creado por la migración.
 * Se guarda tal cual en el documento.
 */
function bloqueConciliacion({ referencia, motivo, ahora } = {}) {
  return {
    estado: ESTADO_CONCILIACION.PENDIENTE,
    desde: (ahora instanceof Date ? ahora : new Date()).toISOString(),
    referencia: referencia || REFERENCIA_POR_DEFECTO,
    motivo: motivo || "Datos heredados de la importación: pendientes de validación administrativa."
  };
}

/** Bloque al validar (reversible: se puede volver a PENDIENTE). */
function bloqueValidado({ por, ahora } = {}) {
  return {
    estado: ESTADO_CONCILIACION.VALIDADA,
    desde: (ahora instanceof Date ? ahora : new Date()).toISOString(),
    referencia: REFERENCIA_POR_DEFECTO,
    validadoPor: por || null
  };
}

/** Bloque al habilitar: es la acción que devuelve el servicio al motor. */
function bloqueHabilitado({ por, ahora } = {}) {
  return {
    estado: ESTADO_CONCILIACION.HABILITADA,
    desde: (ahora instanceof Date ? ahora : new Date()).toISOString(),
    referencia: REFERENCIA_POR_DEFECTO,
    habilitadoPor: por || null
  };
}

/** Bloque al rechazar (exige motivo: queda como evidencia). */
function bloqueRechazado({ por, motivo, ahora } = {}) {
  if (!motivo || String(motivo).trim().length < 5) {
    throw new Error("Rechazar un servicio en conciliación exige un motivo (mínimo 5 caracteres).");
  }
  return {
    estado: ESTADO_CONCILIACION.RECHAZADA,
    desde: (ahora instanceof Date ? ahora : new Date()).toISOString(),
    referencia: REFERENCIA_POR_DEFECTO,
    rechazadoPor: por || null,
    motivo: String(motivo).trim()
  };
}

/**
 * Filtra una lista de servicios separando los que están en conciliación.
 * Útil para el motor y para los informes.
 */
function separarPorConciliacion(servicios) {
  const normales = [];
  const enConciliacion = [];
  for (const s of (Array.isArray(servicios) ? servicios : [])) {
    if (enConciliacionPendiente(s)) enConciliacion.push(s);
    else normales.push(s);
  }
  return { normales, enConciliacion };
}

module.exports = {
  ESTADO_CONCILIACION,
  ACCIONES,
  REFERENCIA_POR_DEFECTO,
  ESTADOS_BLOQUEANTES,
  enConciliacionPendiente,
  estaHabilitado,
  bloqueHabilitado,
  puedeAutomatizar,
  guardias,
  bloqueConciliacion,
  bloqueValidado,
  bloqueRechazado,
  separarPorConciliacion
};
