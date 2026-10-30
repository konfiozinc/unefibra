/* ============================================================
 * UneFibra SAS — Conciliación de FECHAS de los servicios migrados
 * ------------------------------------------------------------
 * KZ-UNEF-028 · Para qué sirve
 * Los 327 servicios importados en KZ-UNEF-018 tienen una `fechaVencimiento` que
 * se calculó como «fecha de ingreso + 30 días», ignorando el ciclo de corte. Por
 * eso no se pueden usar para cobrar ni para avisar: el motor los deja fuera de
 * su alcance mientras estén en `conciliacion.estado = PENDIENTE_VALIDACION`.
 *
 * Esta función NO escribe nada y NO inventa fechas. Solo responde, registro por
 * registro, a una pregunta: ¿esta fecha está respaldada por algo comprobable?
 *
 * Tres salidas posibles, y ninguna otra:
 *
 *   CONFIABLE            La fecha guardada coincide con la evidencia:
 *                        · el ciclo es válido, cae en un día de corte real, es
 *                          posterior al inicio del servicio y el precio existe; o
 *                        · coincide con la que se deduce de un pago CONFIRMADO.
 *
 *   PROPUESTA_CON_EVIDENCIA
 *                        La fecha guardada NO cuadra, pero hay pagos CONFIRMADOS
 *                        que determinan cuál es el próximo vencimiento. La
 *                        propuesta se deriva del dinero realmente recibido, no de
 *                        una suposición. Sigue necesitando el visto bueno del
 *                        propietario antes de aplicarse.
 *
 *   REQUIERE_CONFIRMACION
 *                        No hay evidencia suficiente. `fechaPropuesta` queda en
 *                        null y se devuelve la PREGUNTA concreta que hay que
 *                        hacerle al propietario. Nunca se rellena con una fecha
 *                        inventada.
 *
 * Función pura: no lee Firestore ni escribe nada. Se prueba en
 * functions/test/conciliacion-fechas.test.js.
 * ============================================================ */

"use strict";

const { fechaDeCorte, ultimoDiaDelMes, normalizarCiclo, vencimientoTrasPeriodo, periodoDePago, desplazarPeriodo } = require("./vencimientos");

const CLASES = Object.freeze({
  CONFIABLE: "CONFIABLE",
  PROPUESTA_CON_EVIDENCIA: "PROPUESTA_CON_EVIDENCIA",
  REQUIERE_CONFIRMACION: "REQUIERE_CONFIRMACION"
});

const esFechaISO = (f) => typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f);
const esPeriodo = (p) => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** Período "YYYY-MM" al que pertenece una fecha ISO. */
const periodoDe = (fechaISO) => String(fechaISO).slice(0, 7);

/**
 * ¿La fecha es exactamente un día de corte del ciclo en su propio mes?
 * Ciclo 30 en febrero → el último día real del mes (28 o 29), que es la regla
 * documentada del negocio.
 */
function esDiaDeCorte(fechaISO, ciclo) {
  if (!esFechaISO(fechaISO)) return false;
  const c = normalizarCiclo(ciclo);
  if (c === null) return false;
  const [anio, mes] = fechaISO.split("-").map(Number);
  return fechaDeCorte(anio, mes, c) === fechaISO;
}

/**
 * Período ("YYYY-MM") que cubre un pago concreto.
 * Un pago del ciclo 30 que empieza el 30-nov cubre el período "2026-11"; uno que
 * termina el 29-dic también. Se prefiere `periodoInicio` (fecha efectiva) y, si
 * falta, se deduce de `periodoFin` comparándolo con el corte de su mes.
 */
function periodoDelPago(pago, ciclo) {
  if (!pago) return null;
  if (esFechaISO(pago.periodoInicio)) {
    const p = periodoDePago(pago.periodoInicio, ciclo);
    if (p) return p;
  }
  if (esPeriodo(pago.periodoFin)) return pago.periodoFin;
  if (esFechaISO(pago.periodoFin)) {
    const periodo = periodoDe(pago.periodoFin);
    const [a, m] = periodo.split("-").map(Number);
    const corte = fechaDeCorte(a, m, ciclo);
    return corte && pago.periodoFin >= corte ? periodo : desplazarPeriodo(periodo, -1);
  }
  return null;
}

/** Último período "YYYY-MM" con pago CONFIRMADO. */
function ultimoPeriodoConfirmado(pagos, ciclo) {
  const c = normalizarCiclo(ciclo);
  if (c === null) return null;
  const periodos = (Array.isArray(pagos) ? pagos : [])
    .filter((p) => p && p.estado === "CONFIRMADO")
    .map((p) => periodoDelPago(p, c))
    .filter(Boolean)
    .sort();
  return periodos.length ? periodos[periodos.length - 1] : null;
}

/**
 * Clasifica un servicio migrado.
 *
 * @param {object} entrada
 *   fechaVencimiento     "YYYY-MM-DD" | null
 *   ciclo                "15" | "30" | 15 | 30 | null
 *   fechaInicioServicio  "YYYY-MM-DD" | null   (alta del servicio)
 *   precioMensual        number | null
 *   pagos                [{ estado, periodoInicio, periodoFin }]
 *   hoy                  "YYYY-MM-DD" (por defecto, se calcula fuera)
 * @returns {{
 *   clase: string, motivos: string[], fechaPropuesta: string|null,
 *   fuente: string|null, pregunta: string|null, detalle: object
 * }}
 */
function clasificarServicio(entrada = {}) {
  const fecha = entrada.fechaVencimiento || null;
  const ciclo = normalizarCiclo(entrada.ciclo);
  const inicio = entrada.fechaInicioServicio || null;
  const precio = Number(entrada.precioMensual);
  const motivos = [];
  const detalle = {
    fechaActual: fecha,
    ciclo: ciclo === null ? null : String(ciclo),
    fechaInicioServicio: inicio,
    precioMensual: Number.isFinite(precio) ? precio : null,
    pagosConfirmados: (Array.isArray(entrada.pagos) ? entrada.pagos : []).filter((p) => p && p.estado === "CONFIRMADO").length
  };

  /* --- 1. La evidencia más fuerte: pagos confirmados --- */
  const ultimoPeriodo = ultimoPeriodoConfirmado(entrada.pagos, ciclo);
  if (ultimoPeriodo && ciclo !== null) {
    const esperado = vencimientoTrasPeriodo(ultimoPeriodo, ciclo);
    detalle.ultimoPeriodoPagado = ultimoPeriodo;
    detalle.fechaSegunPagos = esperado;
    if (esperado) {
      if (fecha === esperado) {
        return {
          clase: CLASES.CONFIABLE,
          motivos: ["la fecha coincide con el último pago confirmado"],
          fechaPropuesta: null,
          fuente: "PAGOS_CONFIRMADOS",
          pregunta: null,
          detalle
        };
      }
      return {
        clase: CLASES.PROPUESTA_CON_EVIDENCIA,
        motivos: [`la fecha guardada (${fecha || "sin fecha"}) no coincide con la que resulta del último pago confirmado (${esperado})`],
        fechaPropuesta: esperado,
        fuente: "PAGOS_CONFIRMADOS",
        pregunta: "¿El cliente pagó solo hasta " + ultimoPeriodo + " y el próximo cobro es el " + esperado + "?",
        detalle
      };
    }
  }

  /* --- 2. Sin ciclo no hay forma de saber cuándo se cobra --- */
  if (ciclo === null) {
    motivos.push("el ciclo de corte falta o no es 15/30");
  }

  /* --- 3. Sin fecha no hay nada que conciliar --- */
  if (!fecha) {
    motivos.push("el servicio no tiene fecha de vencimiento");
  } else if (!esFechaISO(fecha)) {
    motivos.push("la fecha de vencimiento no tiene formato AAAA-MM-DD");
  } else {
    if (ciclo !== null && !esDiaDeCorte(fecha, ciclo)) {
      motivos.push(`la fecha ${fecha} no cae en un día de corte del ciclo ${ciclo}`);
    }
    if (inicio && esFechaISO(inicio) && fecha <= inicio) {
      motivos.push(`la fecha ${fecha} es anterior o igual al inicio del servicio (${inicio})`);
    }
    if (!inicio) {
      motivos.push("no hay fecha de inicio del servicio para comparar");
    }
  }

  if (!(Number.isFinite(precio) && precio > 0)) {
    motivos.push("el precio mensual falta o es cero");
  }

  /* --- 4. Decisión --- */
  if (!motivos.length) {
    return {
      clase: CLASES.CONFIABLE,
      motivos: ["la fecha cae en su día de corte, es posterior al alta y tiene precio"],
      fechaPropuesta: null,
      fuente: "REGLA_DE_CORTE",
      pregunta: null,
      detalle
    };
  }

  /* Si lo único que falta es el precio, la FECHA sigue siendo fiable: se avisa
     aparte para no confundir un problema de facturación con uno de calendario. */
  const soloPrecio = motivos.length === 1 && /precio/.test(motivos[0]);
  if (soloPrecio) {
    return {
      clase: CLASES.CONFIABLE,
      motivos: ["la fecha es válida; lo que falta es el precio mensual"],
      fechaPropuesta: null,
      fuente: "REGLA_DE_CORTE",
      pregunta: null,
      detalle
    };
  }

  return {
    clase: CLASES.REQUIERE_CONFIRMACION,
    motivos,
    fechaPropuesta: null,
    fuente: null,
    pregunta: preguntaParaElPropietario({ fecha, ciclo, inicio, ultimoPeriodo }),
    detalle
  };
}

/** Pregunta concreta (en lenguaje del negocio) para resolver el caso. */
function preguntaParaElPropietario({ fecha, ciclo, inicio, ultimoPeriodo }) {
  if (ultimoPeriodo) {
    return "¿Hasta qué mes pagó el cliente? El último pago confirmado es de " + ultimoPeriodo + ".";
  }
  if (!ciclo) {
    return "¿Este cliente paga los 15 o los 30?";
  }
  if (fecha && inicio && fecha <= inicio) {
    return "¿Desde cuándo paga este cliente? La fecha guardada (" + fecha + ") es anterior al inicio del servicio (" + inicio + ").";
  }
  return "¿Cuál es la fecha de cobro real de este cliente?";
}

/** Resumen agregado de una lista de clasificaciones (sin datos personales). */
function resumirClasificaciones(items) {
  const lista = Array.isArray(items) ? items : [];
  const porClase = {};
  const motivos = {};
  for (const it of lista) {
    porClase[it.clase] = (porClase[it.clase] || 0) + 1;
    for (const m of it.motivos || []) {
      const clave = m.replace(/\d{4}-\d{2}-\d{2}/g, "<fecha>").replace(/\b\d+\b/g, "<n>");
      motivos[clave] = (motivos[clave] || 0) + 1;
    }
  }
  return {
    total: lista.length,
    confiables: porClase[CLASES.CONFIABLE] || 0,
    propuestas: porClase[CLASES.PROPUESTA_CON_EVIDENCIA] || 0,
    requierenConfirmacion: porClase[CLASES.REQUIERE_CONFIRMACION] || 0,
    porClase,
    motivosFrecuentes: Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 10)
  };
}

module.exports = {
  CLASES,
  esDiaDeCorte,
  esFechaISO,
  periodoDe,
  ultimoPeriodoConfirmado,
  clasificarServicio,
  preguntaParaElPropietario,
  resumirClasificaciones,
  ultimoDiaDelMes
};
