/* ============================================================
 * UneFibra SAS — Reglas de los ciclos de corte (día 15 y día 30)
 * ------------------------------------------------------------
 * Módulo compartido por las Cloud Functions (functions/src/index.js)
 * y por las herramientas de línea de comandos (tools/). Una sola
 * implementación de la regla de negocio.
 *
 * El negocio cobra en dos tandas: los clientes con corte el día 15 y
 * los del corte el día 30. `clientes.cicloCorte` guarda a cuál
 * pertenece cada uno y de ahí se deriva `proximoCorte`, que es la
 * fecha que manda en los avisos de cobro.
 *
 * DECISIÓN DOCUMENTADA — febrero: el ciclo "30" usa el día 30, pero si
 * el mes no llega a 30 el corte cae el último día del mes (28, o 29 en
 * año bisiesto). Nunca se salta el corte de un mes.
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

/** Ciclos válidos, en orden. */
const CICLOS_CORTE = ["15", "30"];

/** Días que tiene un mes (mes: 1-12). */
function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Día real del corte en un mes concreto, contemplando febrero. */
function diaCorteDeMes(ciclo, anio, mes) {
  const deseado = String(ciclo) === "15" ? 15 : 30;
  return Math.min(deseado, diasDelMes(anio, mes));
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
