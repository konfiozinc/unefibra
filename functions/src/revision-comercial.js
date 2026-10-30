/* ============================================================
 * UneFibra SAS — Revisión comercial (KZ-UNIF-031)
 * ------------------------------------------------------------
 * LO QUE RESUELVE
 * De los 327 servicios migrados, buena parte tiene fechas y valores que el
 * sistema heredó sin evidencia (fecha = alta + 30 días, planes con precio 0).
 * El propietario tiene que poder confirmarlos o corregirlos sin tocar hojas de
 * cálculo. Este módulo concentra las REGLAS de esa revisión, sin Firestore, para
 * poder probarlas sin escribir nada.
 *
 * PRINCIPIOS
 *   · No se inventa nada: si un dato no está, el motivo lo dice y se pide.
 *   · Una fecha de cobro tiene que caer en el día de corte del cliente (15 o 30;
 *     si el mes no tiene día 30, el último día real, febrero incluido).
 *   · Un valor mensual nunca es 0 ni negativo: 0 significaría "no se cobra".
 *   · Cada corrección deja quién y cuándo; el historial no se reescribe.
 * ============================================================ */

"use strict";

const { normalizarCiclo, ultimoDiaDelMes, fechaDeCorte } = require("./vencimientos");

const CAMPOS = Object.freeze(["fechaVencimiento", "precioMensual", "cicloCorte", "planId"]);

const MOTIVOS = Object.freeze({
  SIN_PRECIO: "SIN_PRECIO",
  SIN_CORTE: "SIN_CORTE",
  FECHA_FUERA_DE_CORTE: "FECHA_FUERA_DE_CORTE",
  FECHA_ANTES_DEL_ALTA: "FECHA_ANTES_DEL_ALTA",
  SIN_FECHA: "SIN_FECHA",
  SIN_PLAN: "SIN_PLAN",
  PLAN_SIN_PRECIO: "PLAN_SIN_PRECIO",
  CONFIRMAR_FECHA: "CONFIRMAR_FECHA"
});

const TEXTO = Object.freeze({
  [MOTIVOS.SIN_PRECIO]: "Falta el valor mensual que paga este cliente.",
  [MOTIVOS.SIN_CORTE]: "Falta el día de corte (15 o 30).",
  [MOTIVOS.FECHA_FUERA_DE_CORTE]: "La fecha guardada no cae en el día de corte del cliente.",
  [MOTIVOS.FECHA_ANTES_DEL_ALTA]: "La fecha guardada es anterior a la fecha de alta del cliente.",
  [MOTIVOS.SIN_FECHA]: "Falta la fecha de cobro.",
  [MOTIVOS.SIN_PLAN]: "El cliente no tiene plan asignado.",
  [MOTIVOS.PLAN_SIN_PRECIO]: "El plan asignado no tiene precio registrado.",
  [MOTIVOS.CONFIRMAR_FECHA]: "Confirma la fecha de cobro real de este cliente."
});

const esFechaISO = (f) => typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f);
const esPrecioValido = (v) => Number.isSafeInteger(v) && v > 0;

/** Último día del mes de una fecha ISO (AAAA-MM-DD) → número. */
function ultimoDiaDe(fechaISO) {
  const [a, m] = String(fechaISO).split("-").map(Number);
  return ultimoDiaDelMes(a, m);
}

/** ¿La fecha cae en el día de corte del ciclo? (15 o 30; meses cortos → último día real). */
function esDiaDeCorteDe(fechaISO, ciclo) {
  if (!esFechaISO(fechaISO)) return false;
  const c = normalizarCiclo(ciclo);
  const [a, m, d] = String(fechaISO).split("-").map(Number);
  return d === Math.min(c, ultimoDiaDelMes(a, m));
}

/**
 * Próximo corte a partir de una fecha: el 15 o el 30 (último día real si el mes
 * es más corto) siguiendo el ciclo. Nunca "dentro de 30 días": eso desplazaría el
 * corte y es justo el defecto que arrastraron los 327 servicios migrados.
 */
function proximoCorteDe(ciclo, desdeISO) {
  const c = normalizarCiclo(ciclo);
  const [a, m, d] = String(desdeISO).split("-").map(Number);
  const corteEsteMes = Math.min(c, ultimoDiaDelMes(a, m));
  if (d <= corteEsteMes) return fechaDeCorte(a, m, c);
  const siguiente = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 };
  return fechaDeCorte(siguiente.a, siguiente.m, c);
}

/**
 * Qué le falta a un servicio para poder declararlo en orden.
 * Devuelve motivos ordenados: los que impiden cobrar primero.
 */
function motivosDeRevision({ servicio = {}, cliente = {}, plan = null } = {}) {
  const motivos = [];
  const ciclo = servicio.cicloCorte || cliente.cicloCorte || null;
  const precio = typeof servicio.precioMensual === "number" ? servicio.precioMensual
    : (typeof cliente.precioMensual === "number" ? cliente.precioMensual : null);
  const fecha = servicio.fechaVencimiento || cliente.fechaVencimiento || null;

  if (!servicio.planId && !cliente.planId) motivos.push(MOTIVOS.SIN_PLAN);
  if (plan && !esPrecioValido(plan.precio)) motivos.push(MOTIVOS.PLAN_SIN_PRECIO);
  if (!esPrecioValido(precio)) motivos.push(MOTIVOS.SIN_PRECIO);
  if (!ciclo) motivos.push(MOTIVOS.SIN_CORTE);
  if (!esFechaISO(fecha)) motivos.push(MOTIVOS.SIN_FECHA);

  if (esFechaISO(fecha) && ciclo) {
    if (!esDiaDeCorteDe(fecha, ciclo)) motivos.push(MOTIVOS.FECHA_FUERA_DE_CORTE);
    const alta = servicio.fechaAlta || cliente.fechaAlta || null;
    if (esFechaISO(alta) && fecha < alta) motivos.push(MOTIVOS.FECHA_ANTES_DEL_ALTA);
    if (!motivos.some((m) => m === MOTIVOS.FECHA_FUERA_DE_CORTE || m === MOTIVOS.FECHA_ANTES_DEL_ALTA)) {
      motivos.push(MOTIVOS.CONFIRMAR_FECHA);
    }
  }
  return motivos;
}

/** ¿El servicio sigue pendiente de revisión? */
function necesitaRevision(entrada) {
  return motivosDeRevision(entrada).length > 0;
}

/**
 * Valida UNA corrección propuesta por el propietario.
 * Devuelve { ok, valor, error }. No escribe nada.
 */
function validarCorreccion({ campo, valor, ciclo, planConocido = true } = {}) {
  if (!CAMPOS.includes(campo)) return { ok: false, error: "El campo " + campo + " no se puede corregir desde la revisión." };

  if (campo === "fechaVencimiento") {
    if (!esFechaISO(valor)) return { ok: false, error: "La fecha debe tener formato AAAA-MM-DD." };
    const c = normalizarCiclo(ciclo);
    if (!c) return { ok: false, error: "Primero hay que definir el día de corte (15 o 30)." };
    if (!esDiaDeCorteDe(valor, c)) {
      const ultimo = ultimoDiaDe(valor);
      return {
        ok: false,
        error: "La fecha debe ser el día " + Math.min(c, ultimo) + " (día de corte " + c +
          (ultimo < c ? "; " + valor.slice(5, 7) + " solo tiene " + ultimo + " días" : "") + ")."
      };
    }
    return { ok: true, valor };
  }

  if (campo === "precioMensual") {
    const texto = String(valor === null || valor === undefined ? "" : valor).replace(/[.\s]/g, "").replace(/,/g, "");
    if (!/^\d+$/.test(texto)) return { ok: false, error: "El valor mensual debe ser un número entero de pesos." };
    const n = Number(texto);
    if (!esPrecioValido(n)) return { ok: false, error: "El valor mensual debe ser mayor que cero." };
    return { ok: true, valor: n };
  }

  if (campo === "cicloCorte") {
    const c = normalizarCiclo(valor);
    if (!c) return { ok: false, error: "El día de corte solo puede ser 15 o 30." };
    return { ok: true, valor: String(c) };
  }

  // planId
  const id = String(valor === null || valor === undefined ? "" : valor).trim();
  if (!id) return { ok: false, error: "Selecciona un plan." };
  if (!planConocido) return { ok: false, error: "El plan seleccionado no existe." };
  return { ok: true, valor: id };
}

/**
 * Aplica correcciones a una copia del servicio + cliente, calculando la fecha de
 * vencimiento cuando cambia el corte o no hay fecha. No escribe en Firestore.
 */
function aplicarCorrecciones({ servicio = {}, cliente = {}, correcciones = {}, planes = [] } = {}) {
  const servicioNuevo = { ...servicio };
  const clienteNuevo = { ...cliente };
  const aplicadas = [];
  const errores = [];

  // El corte se resuelve primero: la fecha depende de él.
  const cicloEfectivo = correcciones.cicloCorte !== undefined
    ? correcciones.cicloCorte
    : (servicio.cicloCorte || cliente.cicloCorte || null);

  for (const [campo, valor] of Object.entries(correcciones)) {
    if (campo === "cicloCorte") {
      const r = validarCorreccion({ campo, valor });
      if (!r.ok) { errores.push({ campo, error: r.error }); continue; }
      servicioNuevo.cicloCorte = r.valor;
      clienteNuevo.cicloCorte = r.valor;
      aplicadas.push({ campo, valor: r.valor });
      continue;
    }
    if (campo === "precioMensual") {
      const r = validarCorreccion({ campo, valor });
      if (!r.ok) { errores.push({ campo, error: r.error }); continue; }
      servicioNuevo.precioMensual = r.valor;
      clienteNuevo.precioMensual = r.valor;
      aplicadas.push({ campo, valor: r.valor });
      continue;
    }
    if (campo === "planId") {
      const existe = planes.some((p) => (p && (p.id === valor || p.planId === valor)));
      const r = validarCorreccion({ campo, valor, planConocido: existe || planes.length === 0 });
      if (!r.ok) { errores.push({ campo, error: r.error }); continue; }
      servicioNuevo.planId = r.valor;
      clienteNuevo.planId = r.valor;
      aplicadas.push({ campo, valor: r.valor });
      continue;
    }
    if (campo === "fechaVencimiento") {
      const r = validarCorreccion({ campo, valor, ciclo: cicloEfectivo });
      if (!r.ok) { errores.push({ campo, error: r.error }); continue; }
      servicioNuevo.fechaVencimiento = r.valor;
      clienteNuevo.fechaVencimiento = r.valor;
      aplicadas.push({ campo, valor: r.valor });
    }
  }

  /* Si no se indicó fecha y hay corte, se propone el próximo corte (nunca
     "hoy + 30 días", que desplaza el día de cobro). */
  if (!servicioNuevo.fechaVencimiento && cicloEfectivo) {
    const base = esFechaISO(servicioNuevo.fechaAlta) ? servicioNuevo.fechaAlta : new Date().toISOString().slice(0, 10);
    servicioNuevo.fechaVencimiento = proximoCorteDe(cicloEfectivo, base);
    clienteNuevo.fechaVencimiento = servicioNuevo.fechaVencimiento;
    aplicadas.push({ campo: "fechaVencimiento", valor: servicioNuevo.fechaVencimiento, calculado: true });
  } else if (servicioNuevo.fechaVencimiento && cicloEfectivo && !esDiaDeCorteDe(servicioNuevo.fechaVencimiento, cicloEfectivo)) {
    /* Si cambió el corte, la fecha vieja deja de servir: se mueve al mismo mes,
       al día de corte nuevo. */
    const [a, m] = servicioNuevo.fechaVencimiento.split("-").map(Number);
    const nueva = fechaDeCorte(a, m, cicloEfectivo);
    servicioNuevo.fechaVencimiento = nueva;
    clienteNuevo.fechaVencimiento = nueva;
    aplicadas.push({ campo: "fechaVencimiento", valor: nueva, recalculado: true });
  }

  return { servicio: servicioNuevo, cliente: clienteNuevo, aplicadas, errores };
}

/** Resumen para el panel: cuántos servicios quedan por revisar y por qué. */
function resumirRevision(filas = []) {
  const porMotivo = {};
  let pendientes = 0;
  for (const fila of filas) {
    const motivos = motivosDeRevision(fila);
    if (!motivos.length) continue;
    pendientes++;
    for (const m of motivos) porMotivo[m] = (porMotivo[m] || 0) + 1;
  }
  return { total: filas.length, pendientes, enOrden: filas.length - pendientes, porMotivo };
}

module.exports = {
  CAMPOS,
  MOTIVOS,
  TEXTO,
  esFechaISO,
  esDiaDeCorteDe,
  ultimoDiaDe,
  proximoCorteDe,
  motivosDeRevision,
  necesitaRevision,
  validarCorreccion,
  aplicarCorrecciones,
  resumirRevision
};
