/* ============================================================
 * UneFibra SAS — Reglas de revisión comercial (versión navegador)
 * ------------------------------------------------------------
 * Espejo exacto de functions/src/revision-comercial.js. El panel necesita decir
 * "qué falta confirmar" SIN llamar al servidor (la mitad de los datos son solo de
 * lectura), y el servidor necesita validar lo mismo antes de escribir.
 *
 * Se publica como script clásico (`window.RevisionReglas`) y no como módulo ES
 * para que `test/revision-reglas-paridad.test.js` pueda cargarlo en Node y
 * comprobar que ambas copias responden IGUAL. Si alguien cambia una regla en un
 * solo lado, esa prueba falla.
 * ============================================================ */
(function (raiz) {
  "use strict";

  var MOTIVOS = {
    SIN_PRECIO: "SIN_PRECIO",
    SIN_CORTE: "SIN_CORTE",
    FECHA_FUERA_DE_CORTE: "FECHA_FUERA_DE_CORTE",
    FECHA_ANTES_DEL_ALTA: "FECHA_ANTES_DEL_ALTA",
    SIN_FECHA: "SIN_FECHA",
    SIN_PLAN: "SIN_PLAN",
    PLAN_SIN_PRECIO: "PLAN_SIN_PRECIO",
    CONFIRMAR_FECHA: "CONFIRMAR_FECHA"
  };

  var TEXTO = {};
  TEXTO[MOTIVOS.SIN_PRECIO] = "Falta el valor mensual que paga este cliente.";
  TEXTO[MOTIVOS.SIN_CORTE] = "Falta el día de corte (15 o 30).";
  TEXTO[MOTIVOS.FECHA_FUERA_DE_CORTE] = "La fecha guardada no cae en el día de corte del cliente.";
  TEXTO[MOTIVOS.FECHA_ANTES_DEL_ALTA] = "La fecha guardada es anterior a la fecha de alta del cliente.";
  TEXTO[MOTIVOS.SIN_FECHA] = "Falta la fecha de cobro.";
  TEXTO[MOTIVOS.SIN_PLAN] = "El cliente no tiene plan asignado.";
  TEXTO[MOTIVOS.PLAN_SIN_PRECIO] = "El plan asignado no tiene precio registrado.";
  TEXTO[MOTIVOS.CONFIRMAR_FECHA] = "Confirma la fecha de cobro real de este cliente.";

  function esFechaISO(f) { return typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f); }
  function esPrecioValido(v) { return Number.isSafeInteger(v) && v > 0; }

  function ultimoDiaDelMes(anio, mes) {
    return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  }

  function normalizarCiclo(valor) {
    var n = Number(valor);
    return (n === 15 || n === 30) ? n : null;
  }

  function fechaDeCorte(anio, mes, ciclo) {
    var c = normalizarCiclo(ciclo);
    if (!c) return null;
    var dia = Math.min(c, ultimoDiaDelMes(anio, mes));
    return anio + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
  }

  function ultimoDiaDe(fechaISO) {
    var p = String(fechaISO).split("-").map(Number);
    return ultimoDiaDelMes(p[0], p[1]);
  }

  function esDiaDeCorteDe(fechaISO, ciclo) {
    if (!esFechaISO(fechaISO)) return false;
    var c = normalizarCiclo(ciclo);
    if (!c) return false;
    var p = String(fechaISO).split("-").map(Number);
    return p[2] === Math.min(c, ultimoDiaDelMes(p[0], p[1]));
  }

  function proximoCorteDe(ciclo, desdeISO) {
    var c = normalizarCiclo(ciclo);
    if (!c) return null;
    var p = String(desdeISO).split("-").map(Number);
    var corteEsteMes = Math.min(c, ultimoDiaDelMes(p[0], p[1]));
    if (p[2] <= corteEsteMes) return fechaDeCorte(p[0], p[1], c);
    var a = p[0], m = p[1] + 1;
    if (m === 13) { a = a + 1; m = 1; }
    return fechaDeCorte(a, m, c);
  }

  function motivosDeRevision(entrada) {
    var e = entrada || {};
    var servicio = e.servicio || {};
    var cliente = e.cliente || {};
    var plan = e.plan || null;
    var motivos = [];

    var ciclo = servicio.cicloCorte || cliente.cicloCorte || null;
    var precio = typeof servicio.precioMensual === "number" ? servicio.precioMensual
      : (typeof cliente.precioMensual === "number" ? cliente.precioMensual : null);
    var fecha = servicio.fechaVencimiento || cliente.fechaVencimiento || null;

    if (!servicio.planId && !cliente.planId) motivos.push(MOTIVOS.SIN_PLAN);
    if (plan && !esPrecioValido(plan.precio)) motivos.push(MOTIVOS.PLAN_SIN_PRECIO);
    if (!esPrecioValido(precio)) motivos.push(MOTIVOS.SIN_PRECIO);
    if (!normalizarCiclo(ciclo)) motivos.push(MOTIVOS.SIN_CORTE);
    if (!esFechaISO(fecha)) motivos.push(MOTIVOS.SIN_FECHA);

    if (esFechaISO(fecha) && normalizarCiclo(ciclo)) {
      if (!esDiaDeCorteDe(fecha, ciclo)) motivos.push(MOTIVOS.FECHA_FUERA_DE_CORTE);
      var alta = servicio.fechaAlta || cliente.fechaAlta || null;
      if (esFechaISO(alta) && fecha < alta) motivos.push(MOTIVOS.FECHA_ANTES_DEL_ALTA);
      if (!motivos.some(function (m) {
        return m === MOTIVOS.FECHA_FUERA_DE_CORTE || m === MOTIVOS.FECHA_ANTES_DEL_ALTA;
      })) {
        motivos.push(MOTIVOS.CONFIRMAR_FECHA);
      }
    }
    return motivos;
  }

  function necesitaRevision(entrada) { return motivosDeRevision(entrada).length > 0; }

  var api = {
    MOTIVOS: MOTIVOS,
    TEXTO: TEXTO,
    esFechaISO: esFechaISO,
    esPrecioValido: esPrecioValido,
    normalizarCiclo: normalizarCiclo,
    ultimoDiaDelMes: ultimoDiaDelMes,
    ultimoDiaDe: ultimoDiaDe,
    fechaDeCorte: fechaDeCorte,
    esDiaDeCorteDe: esDiaDeCorteDe,
    proximoCorteDe: proximoCorteDe,
    motivosDeRevision: motivosDeRevision,
    necesitaRevision: necesitaRevision
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  raiz.RevisionReglas = api;
})(typeof window !== "undefined" ? window : globalThis);
