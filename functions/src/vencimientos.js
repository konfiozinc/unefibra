'use strict';
/* ============================================================
 * KZ-UNEF-021 · Cálculo de vencimientos por ciclo de corte
 * ------------------------------------------------------------
 * Módulo independiente y sin dependencias: no toca Firestore y no conoce
 * clientes. Solo fechas y ciclos. Así se puede probar hasta el agujero.
 *
 * Reglas que implementa (y que NO implementa):
 *   · El ciclo es 15 o 30. Nada más se acepta.
 *   · Un pago de un período cubre ESE período: [día de corte del mes, día
 *     anterior al corte del mes siguiente).
 *   · Pagar en un mes NO cubre el siguiente solo: el próximo vencimiento es el
 *     corte del mes siguiente al ÚLTIMO PERÍODO PAGADO, no a la fecha de cobro.
 *   · La fecha efectiva de cobro y el período cubierto son datos distintos y se
 *     manejan por separado.
 *   · Ciclo 30 en meses cortos usa el último día real del mes (28, 29, 30).
 *   · Nunca inventa: si falta el período o el ciclo, devuelve null y un motivo.
 *
 * El defecto que esto corrige: el panel calculaba «fecha de ingreso + 30 días»
 * sin mirar el ciclo (356 de 356 clientes), por eso los vencimientos no cuadran
 * con el día de corte real.
 * ============================================================ */

const CICLOS_VALIDOS = Object.freeze([15, 30]);

const esFechaISO = (f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f);
const esPeriodo = (p) => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** Normaliza el ciclo: devuelve 15 o 30, o null si no es válido. */
function normalizarCiclo(valor) {
  const n = Number(valor);
  return CICLOS_VALIDOS.includes(n) ? n : null;
}

/** Último día real del mes (1..12). */
function ultimoDiaDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Fecha de corte de un mes concreto.
 * Ciclo 30 en un mes de 28 días → día 28 (el último real), no el 30.
 */
function fechaDeCorte(anio, mes, ciclo) {
  const c = normalizarCiclo(ciclo);
  if (c === null) return null;
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  const dia = Math.min(c, ultimoDiaDelMes(anio, mes));
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Desplaza un período "YYYY-MM" n meses (n puede ser negativo). */
function desplazarPeriodo(periodo, n) {
  if (!esPeriodo(periodo)) return null;
  const [a, m] = periodo.split('-').map(Number);
  const total = (a * 12 + (m - 1)) + n;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

/** Ventana que cubre un período pagado. */
function cubiertoPor(periodo, ciclo) {
  if (!esPeriodo(periodo)) return null;
  const c = normalizarCiclo(ciclo);
  if (c === null) return null;
  const [a, m] = periodo.split('-').map(Number);
  const desde = fechaDeCorte(a, m, c);
  const siguiente = desplazarPeriodo(periodo, 1);
  const [a2, m2] = siguiente.split('-').map(Number);
  const corteSiguiente = fechaDeCorte(a2, m2, c);
  if (!desde || !corteSiguiente) return null;
  const hasta = new Date(Date.parse(corteSiguiente + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  return { desde, hasta };
}

/**
 * Próximo vencimiento a partir del ÚLTIMO PERÍODO PAGADO.
 * Pagar abril (corte 30) → vence el 30 de mayo. No el 30 de abril.
 */
function vencimientoTrasPeriodo(periodoPagado, ciclo) {
  if (!esPeriodo(periodoPagado)) return null;
  const c = normalizarCiclo(ciclo);
  if (c === null) return null;
  const siguiente = desplazarPeriodo(periodoPagado, 1);
  const [a, m] = siguiente.split('-').map(Number);
  return fechaDeCorte(a, m, c);
}

/**
 * Primer corte ESTRICTAMENTE posterior al alta del servicio.
 * Es el vencimiento de un cliente sin ningún pago registrado.
 */
function vencimientoDesdeAlta(fechaAlta, ciclo) {
  if (!esFechaISO(fechaAlta)) return null;
  const c = normalizarCiclo(ciclo);
  if (c === null) return null;
  const alta = Date.parse(fechaAlta + 'T00:00:00Z');
  const [anio, mes] = fechaAlta.split('-').map(Number);
  /* Se prueban el mes del alta y el siguiente: basta para encontrar el primer corte. */
  for (const n of [0, 1]) {
    const periodo = desplazarPeriodo(`${anio}-${String(mes).padStart(2, '0')}`, n);
    const [a, m] = periodo.split('-').map(Number);
    const corte = fechaDeCorte(a, m, c);
    if (corte && Date.parse(corte + 'T00:00:00Z') > alta) return corte;
  }
  return null;
}

/**
 * Período que cubre un pago hecho en `fechaPago` (fecha efectiva de cobro).
 * Es el período cuyo corte es el primero igual o posterior a la fecha de pago.
 * Se usa cuando SÍ hay fecha de cobro. Con el Excel histórico no la hay.
 */
function periodoDePago(fechaPago, ciclo) {
  if (!esFechaISO(fechaPago)) return null;
  const c = normalizarCiclo(ciclo);
  if (c === null) return null;
  const [anio, mes] = fechaPago.split('-').map(Number);
  const corteEsteMes = fechaDeCorte(anio, mes, c);
  if (fechaPago <= corteEsteMes) return `${anio}-${String(mes).padStart(2, '0')}`;
  return desplazarPeriodo(`${anio}-${String(mes).padStart(2, '0')}`, 1);
}

/**
 * Propuesta de vencimiento para un cliente, con su trazabilidad.
 * @param {object} opciones
 *   ultimoPeriodoPagado  "YYYY-MM" | null
 *   fechaAlta            "YYYY-MM-DD" | null   (solo si no hay pagos)
 *   ciclo                15 | 30
 *   periodosConMarcaNoPago  array de "YYYY-MM" (informativas; NO son deuda)
 * @returns {{ vencimiento: string|null, origen: string, motivo: string, advertencias: string[] }}
 */
function proponerVencimiento(opciones = {}) {
  const ciclo = normalizarCiclo(opciones.ciclo);
  const advertencias = [];
  if (ciclo === null) {
    return { vencimiento: null, origen: 'SIN_CALCULO', motivo: 'ciclo de corte inválido (solo 15 o 30)', advertencias };
  }
  if (opciones.ultimoPeriodoPagado) {
    const v = vencimientoTrasPeriodo(opciones.ultimoPeriodoPagado, ciclo);
    if (!v) {
      return { vencimiento: null, origen: 'SIN_CALCULO', motivo: 'período pagado inválido', advertencias };
    }
    const cubierto = cubiertoPor(opciones.ultimoPeriodoPagado, ciclo);
    if (cubierto) advertencias.push(`el último período pagado (${opciones.ultimoPeriodoPagado}) cubre hasta el ${cubierto.hasta}`);
    const marcados = Array.isArray(opciones.periodosConMarcaNoPago) ? opciones.periodosConMarcaNoPago : [];
    const posteriores = marcados.filter((p) => esPeriodo(p) && p > opciones.ultimoPeriodoPagado);
    if (posteriores.length) {
      advertencias.push(`hay ${posteriores.length} mes(es) marcados como no pagados después (marca del dueño, no deuda confirmada)`);
    }
    return { vencimiento: v, origen: 'ULTIMO_PERIODO_PAGADO', motivo: null, advertencias };
  }
  if (opciones.fechaAlta) {
    const v = vencimientoDesdeAlta(opciones.fechaAlta, ciclo);
    return v
      ? { vencimiento: v, origen: 'FECHA_DE_ALTA', motivo: 'sin pagos registrados; primer corte posterior al alta', advertencias }
      : { vencimiento: null, origen: 'SIN_CALCULO', motivo: 'no se pudo ubicar el primer corte tras el alta', advertencias };
  }
  return { vencimiento: null, origen: 'SIN_CALCULO', motivo: 'sin período pagado ni fecha de alta', advertencias };
}

module.exports = {
  CICLOS_VALIDOS,
  normalizarCiclo,
  ultimoDiaDelMes,
  fechaDeCorte,
  desplazarPeriodo,
  cubiertoPor,
  vencimientoTrasPeriodo,
  vencimientoDesdeAlta,
  periodoDePago,
  proponerVencimiento
};
