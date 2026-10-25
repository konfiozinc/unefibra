'use strict';
/* ============================================================
 * UneFibra SAS — Cálculo de períodos de facturación
 * ------------------------------------------------------------
 * Vive aparte de index.js para poder probarlo SIN emulador y sin
 * credenciales: es aritmética de fechas, no acceso a datos.
 *
 * REGLA DE NEGOCIO (la que faltaba y causaba el defecto crítico):
 * al confirmar un pago, el periodo nuevo empieza en la fecha de
 * vencimiento SOLO si esa fecha todavía no pasó. Si el cliente ya
 * estaba vencido, el periodo empieza HOY.
 *
 * El error anterior (`cliente.fechaVencimiento || hoyISO()`) renovaba
 * desde el vencimiento viejo: un cliente con vencimiento en mayo que
 * pagaba en octubre recibía un periodo que terminaba en junio, volvía
 * a quedar moroso el mismo día y el motor lo suspendía de madrugada
 * (tres días después), justo después de haber cobrado.
 *
 * Colombia es UTC-5 fijo (sin horario de verano), y las fechas se
 * suman en DÍAS, no en meses: no existen los desfases de día 29/30/31
 * ni de febrero.
 * ============================================================ */

/** Desfase de Colombia (UTC-5, sin horario de verano). */
const COLOMBIA_UTC_OFFSET_MS = -5 * 3600000;

/** Formatea un Date como "YYYY-MM-DD" usando componentes UTC. */
function fechaISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/** Hoy como "YYYY-MM-DD" en zona de Colombia. */
function hoyISO(ahora) {
  const base = ahora instanceof Date ? ahora.getTime() : Date.now();
  return fechaISO(new Date(base + COLOMBIA_UTC_OFFSET_MS));
}

/**
 * Normaliza una fecha (string "YYYY-MM-DD" o Date) a Date en UTC a medianoche.
 * Sin fecha devuelve el día de HOY en Colombia, no el día del contenedor:
 * las funciones corren en UTC y entre las 19:00 y las 24:00 de Bogotá el
 * día UTC ya es el siguiente (era un desfase de un día latente).
 */
function normalizarFecha(fecha) {
  if (!fecha) return normalizarFecha(hoyISO());
  if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [y, m, d] = fecha.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const d = new Date(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Suma días a una fecha y devuelve "YYYY-MM-DD". */
function sumarDias(fechaInicio, dias) {
  const base = normalizarFecha(fechaInicio);
  return fechaISO(new Date(base.getTime() + dias * 86400000));
}

/**
 * Fecha desde la que arranca el periodo que se está pagando.
 * - Si el vencimiento es hoy o futuro: ese vencimiento (se encadenan periodos
 *   sin regalar ni cobrar días de más).
 * - Si el vencimiento ya pasó (o no hay): hoy, porque el cliente estuvo
 *   cortado o sin servicio y el periodo pagado debe cubrir desde ahora.
 */
function baseRenovacion(vencimiento, hoy) {
  const referencia = hoy || hoyISO();
  if (!vencimiento) return referencia;
  const v = normalizarFecha(vencimiento);
  const h = normalizarFecha(referencia);
  return v.getTime() >= h.getTime() ? fechaISO(v) : fechaISO(h);
}

/**
 * Periodo que renueva un pago confirmado.
 * Devuelve { periodoInicio, periodoFin, base } con la base usada, que es lo
 * que se audita para poder explicar después por qué un cliente quedó con
 * una fecha y no otra.
 */
function calcularPeriodo({ vencimiento, duracion, hoy } = {}) {
  const dias = Number(duracion);
  if (!Number.isFinite(dias) || dias <= 0) {
    throw new Error("La duración del plan debe ser un número de días mayor que cero.");
  }
  const base = baseRenovacion(vencimiento, hoy);
  return { base, periodoInicio: base, periodoFin: sumarDias(base, dias) };
}

module.exports = {
  COLOMBIA_UTC_OFFSET_MS,
  fechaISO,
  hoyISO,
  normalizarFecha,
  sumarDias,
  baseRenovacion,
  calcularPeriodo
};
