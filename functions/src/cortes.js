/* ============================================================
 * UneFibra SAS — Reglas de los ciclos de corte
 * ------------------------------------------------------------
 * Módulo compartido por las Cloud Functions (functions/src/index.js)
 * y por las herramientas de línea de comandos (tools/). Una sola
 * implementación de la regla de negocio.
 *
 * REGLA VIGENTE (decisión del propietario, 29-oct-2026):
 *
 *     Los días de corte comerciales son el 15 y el 30 de cada mes.
 *     cicloCorte "15"  ->  corte el día 15
 *     cicloCorte "30"  ->  corte el día 30
 *
 *     Cada corte genera EXACTAMENTE DOS recordatorios de pago, a las
 *     10:00 de Colombia (America/Bogota):
 *         corte 15  ->  aviso el 12  y  aviso el 15
 *         corte 30  ->  aviso el 27  y  aviso el 30
 *
 *     Ver src/recordatorios.js, que es quien decide los días de aviso.
 *
 * CAMBIO RESPECTO A LA REGLA ANTERIOR (octubre 2026): antes el negocio tenía
 * dos fechas por tanda con 5 días de gracia (el "15" avisaba el 15 y cortaba el
 * 20; el "30" avisaba el 30 y cortaba el 5 del mes siguiente). Esa regla se
 * retiró: el propietario fijó el corte en el mismo día del ciclo. Además
 * convivía con una segunda implementación (src/vencimientos.js) que ya usaba
 * día 15 / día 30, así que el sistema tenía DOS definiciones distintas de la
 * misma fecha. Ahora las dos coinciden y esta es la única fuente.
 *
 * IMPORTANTE: `clientes.cicloCorte` guarda el identificador del ciclo ("15" o
 * "30"), que es el vocabulario del cliente (sus hojas de cálculo se llaman "los
 * 15" y "los 30"). Ahora ese identificador coincide además con el día del
 * corte. NO se renombra: cambiarlo obligaría a migrar los 353 clientes sin
 * ningún beneficio.
 *
 * FEBRERO: no tiene día 30. Para el ciclo "30" el corte cae el ÚLTIMO día real
 * del mes (28 en año común, 29 en bisiesto) y, por tanto, su aviso previo cae 3
 * días antes (25 o 26). Se eligió así porque el servicio es mensual: saltarse
 * febrero dejaría al cliente sin período facturable y sin corte durante un mes.
 * Ver recordatorios.js, que aplica la misma regla a los avisos.
 *
 * NOTA sobre la copia del navegador: el panel no puede importar CommonJS, así
 * que assets/js/admin/ui.js mantiene una copia de estas funciones. Si cambias
 * una regla aquí, cámbiala también allí: import/test-cortes.js compara las dos y
 * falla si se separan.
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

/** Ciclos válidos = día del corte, en orden. */
const CICLOS_CORTE = ["15", "30"];

/** Días que tiene un mes (mes: 1-12). */
function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Día del CORTE que corresponde a un ciclo: el "15" corta el 15 y el "30" corta
 * el 30. Si se pasan año y mes, se recorta al último día real del mes, que es lo
 * que resuelve febrero (28 o 29) sin un caso especial aparte.
 */
function diaCorteDeMes(ciclo, anio, mes) {
  const dia = String(ciclo) === "15" ? 15 : 30;
  if (Number.isInteger(anio) && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
    return Math.min(dia, diasDelMes(anio, mes));
  }
  return dia;
}

/** Fecha de corte "YYYY-MM-DD" de un año y mes concretos. */
function fechaDeCorte(anio, mes, ciclo) {
  const dia = diaCorteDeMes(ciclo, anio, mes);
  return fechaISO(new Date(Date.UTC(anio, mes - 1, dia)));
}

/**
 * Próximo corte del ciclo como "YYYY-MM-DD", contando el de hoy como próximo
 * (el día del corte el corte ES hoy, no el del mes siguiente).
 */
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
  fechaDeCorte,
  proximoCorteDe,
  cicloSegunFecha,
  cicloValido
};
