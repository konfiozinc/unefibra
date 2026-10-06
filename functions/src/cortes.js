/* ============================================================
 * UneFibra SAS — Reglas de los ciclos de corte
 * ------------------------------------------------------------
 * Módulo compartido por las Cloud Functions (functions/src/index.js)
 * y por las herramientas de línea de comandos (tools/). Una sola
 * implementación de la regla de negocio.
 *
 * CÓMO FUNCIONA (decisión de negocio, octubre 2026): el negocio cobra en
 * dos tandas y cada tanda tiene DOS fechas — la del aviso de cobro y la del
 * corte, con 5 días de gracia entre ambas:
 *
 *     cicloCorte "15"  ->  aviso el día 15  ->  corte el día 20
 *     cicloCorte "30"  ->  aviso el día 30  ->  corte el día 5 del mes SIGUIENTE
 *
 * OJO: `clientes.cicloCorte` guarda el identificador del ciclo ("15" o "30"),
 * que corresponde al día del AVISO, no al día del corte. Es el vocabulario
 * del cliente (sus hojas de cálculo se llaman "los 15" y "los 30") y NO se
 * debe renombrar: cambiarlo obligaría a migrar los 353 clientes.
 * `proximoCorteDe()` es la que traduce ciclo -> fecha de corte, y esa fecha
 * es la que manda en los avisos de cobro.
 *
 * Los avisos NO están en días fijos: processDueDates los deriva de
 * `proximoCorte` (avisa 5 días antes, o sea el día del aviso, y el mismo día
 * del corte). Por eso mover el corte mueve los avisos solo.
 *
 * IMPORTANTE: el panel del navegador usa su propia copia de estas
 * funciones en assets/js/admin/ui.js, porque no puede importar CommonJS.
 * Si cambias una regla aquí, cámbiala también allí.
 * ============================================================ */

"use strict";

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
function hoyISO() {
  return fechaISO(new Date(Date.now() + COLOMBIA_UTC_OFFSET_MS));
}

/** Ciclos válidos = día del AVISO de cobro, en orden. */
const CICLOS_CORTE = ["15", "30"];

/** Días que tiene un mes (mes: 1-12). */
function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Día del CORTE que corresponde a un ciclo: el "15" corta el día 20 y el
 * "30" corta el día 5. Los dos existen en todos los meses, así que ya no
 * hace falta el ajuste de febrero que sí necesitaba el día 30.
 *
 * Se mantienen los parámetros anio/mes por compatibilidad con las llamadas
 * existentes, pero ya no se usan.
 */
function diaCorteDeMes(ciclo) {
  return String(ciclo) === "15" ? 20 : 5;
}

/** Próximo corte del ciclo como "YYYY-MM-DD" a partir de una fecha. */
function proximoCorteDe(ciclo, desdeISO) {
  const base = desdeISO || hoyISO();
  const [anio, mes, dia] = String(base).split("-").map(Number);
  const deEsteMes = diaCorteDeMes(ciclo, anio, mes);
  if (dia <= deEsteMes) return fechaISO(new Date(Date.UTC(anio, mes - 1, deEsteMes)));

  const sigAnio = mes === 12 ? anio + 1 : anio;
  const sigMes = mes === 12 ? 1 : mes + 1;
  return fechaISO(new Date(Date.UTC(sigAnio, sigMes - 1, diaCorteDeMes(ciclo, sigAnio, sigMes))));
}

/** Ciclo que corresponde a una fecha: días 1-15 → "15"; 16 o más → "30". */
function cicloSegunFecha(fechaISOStr) {
  const dia = Number(String(fechaISOStr || "").slice(8, 10));
  if (!dia) return null;
  return dia <= 15 ? "15" : "30";
}

/**
 * Normaliza el ciclo recibido. Si viene vacío o inválido lo deduce del
 * vencimiento; si el cliente ya tenía uno asignado, ese manda (hay clientes
 * que se cambian de tanda a propósito y no hay que "corregirlos").
 */
function cicloValido(ciclo, fechaVencimiento) {
  const c = String(ciclo == null ? "" : ciclo);
  if (CICLOS_CORTE.includes(c)) return c;
  return cicloSegunFecha(fechaVencimiento);
}

module.exports = {
  CICLOS_CORTE,
  fechaISO,
  hoyISO,
  diasDelMes,
  diaCorteDeMes,
  proximoCorteDe,
  cicloSegunFecha,
  cicloValido
};
