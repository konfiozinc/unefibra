/* ============================================================
 * UneFibra SAS — Recordatorios de pago (regla definitiva)
 * ------------------------------------------------------------
 * Decisión del propietario (29-oct-2026), que sustituye a la programación
 * anterior de avisos a 7, 5, 3 y 0 días:
 *
 *   Por cada vencimiento (corte) el cliente recibe EXACTAMENTE DOS avisos,
 *   los dos a las 10:00 de Colombia (America/Bogota):
 *
 *       corte día 15  ->  aviso 1: día 12   ·  aviso 2: día 15
 *       corte día 30  ->  aviso 1: día 27   ·  aviso 2: día 30
 *
 *   · Febrero no tiene día 30: el corte del ciclo "30" cae el último día real
 *     del mes (28 o 29) y su primer aviso 3 días antes (25 o 26).
 *   · Nunca más de dos por vencimiento: cada aviso lleva una clave de
 *     deduplicación estable (cliente + período + tipo).
 *   · Si el cliente ya tiene un pago CONFIRMADO que cubre el período, no se le
 *     envía ningún aviso.
 *
 * Este módulo es PURO: no conoce Firestore ni envía nada. Decide fechas y
 * acciones; el motor (functions/src/index.js) es quien escribe y envía. Así la
 * regla se puede probar hasta el último caso sin emulador ni red.
 * ============================================================ */

"use strict";

const { proximoCorteDe, fechaISO, diasDelMes } = require("./cortes");

/** Zona horaria obligatoria de los avisos. */
const ZONA = "America/Bogota";
/** Hora local del envío (la fija el cron de processDueDates). */
const HORA_ENVIO = 10;
/** Días de antelación del primer aviso. */
const DIAS_ANTES = 3;

/* Ventanas de recuperación.
   El cron corre una vez al día a las 10:00. Si una corrida falla (timeout,
   despliegue, error de Firestore), sin ventana ese aviso se perdería para
   siempre. La ventana permite recuperarlo en los días siguientes SIN que los dos
   avisos se solapen nunca ni se conviertan en tres:
     · aviso previo: desde 3 días antes hasta el día anterior al corte
     · aviso del corte: el día del corte y los 2 días siguientes
   Un período cerrado recibe como máximo estos dos, porque después de su ventana
   el corte ya es pasado y `proximoCorteDe` apunta al mes siguiente. */
const VENTANA_PREVIO = { desdeDias: -DIAS_ANTES, hastaDias: -1 };
const VENTANA_CORTE = { desdeDias: 0, hastaDias: 2 };

/** Tipos internos (se conservan los nombres que ya usa `notificaciones`). */
const TIPO_PREVIO = (ciclo) => `CORTE_${ciclo}_${DIAS_ANTES}_DIAS`;
const TIPO_CORTE = (ciclo) => `CORTE_${ciclo}_VENCIDO`;

/** Estados tal como los guarda el sistema. */
const ESTADOS = Object.freeze({
  PENDIENTE: "PENDIENTE",
  ENVIADA: "ENVIADA",
  ERROR: "ERROR",
  CANCELADA: "CANCELADA"
});

/* Palabras que ve el propietario. El estado interno nunca se muestra. */
const PALABRAS = Object.freeze({
  PENDIENTE: "Pendiente",
  ENVIADA: "Enviado",
  ERROR: "Fallido",
  CANCELADA: "Cancelado"
});

/** Convierte un estado interno en la palabra que entiende el propietario. */
function palabraEstado(estado) {
  return PALABRAS[String(estado || "").toUpperCase()] || "Sin estado";
}

/** "YYYY-MM-DD" ± n días. */
function sumarDias(fechaISOStr, dias) {
  const [y, m, d] = String(fechaISOStr).split("-").map(Number);
  return fechaISO(new Date(Date.UTC(y, m - 1, d) + dias * 86400000));
}

/** Días entre dos fechas ISO (b - a). */
function diasEntre(a, b) {
  const t = (s) => { const [y, m, d] = String(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Último día real del mes de una fecha "YYYY-MM-DD". */
function ultimoDiaDelMesDe(fechaISOStr) {
  const [y, m] = String(fechaISOStr).split("-").map(Number);
  return diasDelMes(y, m);
}

/**
 * Fecha de corte "YYYY-MM-DD" de un período "YYYY-MM" y un ciclo.
 * Febrero con ciclo 30 → 28 (o 29 en bisiesto), que es la excepción verificada.
 */
function fechaCorteDelPeriodo(periodo, ciclo) {
  if (typeof periodo !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return null;
  const [y, m] = periodo.split("-").map(Number);
  const dia = Math.min(Number(ciclo) === 15 ? 15 : 30, diasDelMes(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Período "YYYY-MM" al que pertenece una fecha de corte. */
const periodoDeCorte = (corteISO) => String(corteISO).slice(0, 7);

/**
 * Los DOS recordatorios de un corte, con su ventana y su etiqueta.
 * Devuelve siempre un array de longitud 2, en orden (primero el previo).
 */
function recordatoriosDelCorte(corteISO, ciclo) {
  if (typeof corteISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(corteISO)) return [];
  const delCorte = ciclo === undefined || ciclo === null
    ? (Number(String(corteISO).slice(8, 10)) <= 15 ? "15" : "30")
    : String(ciclo);
  return [
    {
      clave: "previo",
      tipo: TIPO_PREVIO(delCorte),
      etiqueta: `${DIAS_ANTES} días antes del corte`,
      fecha: sumarDias(corteISO, -DIAS_ANTES),
      desde: sumarDias(corteISO, VENTANA_PREVIO.desdeDias),
      hasta: sumarDias(corteISO, VENTANA_PREVIO.hastaDias)
    },
    {
      clave: "corte",
      tipo: TIPO_CORTE(delCorte),
      etiqueta: "Día del corte",
      fecha: corteISO,
      desde: sumarDias(corteISO, VENTANA_CORTE.desdeDias),
      hasta: sumarDias(corteISO, VENTANA_CORTE.hastaDias)
    }
  ];
}

/** Los dos recordatorios de un período "YYYY-MM" para un ciclo. */
function recordatoriosDelPeriodo(periodo, ciclo) {
  const corte = fechaCorteDelPeriodo(periodo, ciclo);
  return corte ? recordatoriosDelCorte(corte, ciclo) : [];
}

/** ¿Hoy cae dentro de la ventana de este recordatorio? */
function enVentana(recordatorio, hoyISO) {
  if (!recordatorio || !hoyISO) return false;
  return String(hoyISO) >= recordatorio.desde && String(hoyISO) <= recordatorio.hasta;
}

/**
 * Clave de deduplicación. Es la misma que ya usa la colección `notificaciones`,
 * así que dos corridas seguidas del motor no pueden crear el mismo aviso dos
 * veces, ni siquiera si corren a la vez.
 */
function claveDedup(clienteId, periodo, tipo) {
  return `${clienteId}_${periodo || "sin-periodo"}_${tipo}`;
}

/**
 * Decide qué hacer HOY con los recordatorios de un corte. Función pura: es la
 * que garantiza las tres condiciones del propietario.
 *
 * @param {object} opciones
 *   corteISO          fecha de corte ("YYYY-MM-DD")
 *   ciclo             "15" | "30"
 *   hoy               hoy en Colombia ("YYYY-MM-DD")
 *   yaEnviados        claves ("previo" | "corte") ya registradas para este corte
 *   pagoConfirmado    true si un pago CONFIRMADO cubre el período del corte
 * @returns {Array<{recordatorio:object, accion:"enviar"|"omitir", motivo:string}>}
 */
function decidirRecordatorios(opciones = {}) {
  const hoy = opciones.hoy;
  const recordatorios = recordatoriosDelCorte(opciones.corteISO, opciones.ciclo);
  const yaEnviados = Array.isArray(opciones.yaEnviados) ? opciones.yaEnviados : [];
  return recordatorios.map((r) => {
    if (opciones.pagoConfirmado === true) return { recordatorio: r, accion: "omitir", motivo: "pago confirmado del período" };
    if (yaEnviados.includes(r.clave)) return { recordatorio: r, accion: "omitir", motivo: "ya enviado en este corte" };
    if (!enVentana(r, hoy)) {
      const dias = diasEntre(hoy, r.fecha);
      return { recordatorio: r, accion: "omitir", motivo: dias > 0 ? `faltan ${dias} día(s)` : "fuera de la ventana de recuperación" };
    }
    return { recordatorio: r, accion: "enviar", motivo: "corresponde hoy" };
  });
}

/**
 * Resumen para el propietario: qué avisos tiene un cliente y en qué estado.
 * Traduce a lenguaje comercial y calcula el próximo aviso pendiente.
 */
function resumenParaPropietario(opciones = {}) {
  const hoy = opciones.hoy;
  const recordatorios = recordatoriosDelCorte(opciones.corteISO, opciones.ciclo);
  const estados = opciones.estados || {};
  return {
    corte: opciones.corteISO || null,
    enPalabras: recordatorios.map((r) => ({
      cuando: r.etiqueta,
      fecha: r.fecha,
      estado: palabraEstado(estados[r.clave]),
      yaPaso: hoy ? String(r.fecha) < String(hoy) : false
    }))
  };
}

/** Próximo corte del ciclo a partir de una fecha (atajo para el panel). */
const proximoCorte = (ciclo, desdeISO) => proximoCorteDe(ciclo, desdeISO);

module.exports = {
  ZONA,
  HORA_ENVIO,
  DIAS_ANTES,
  ESTADOS,
  TIPO_PREVIO,
  TIPO_CORTE,
  palabraEstado,
  sumarDias,
  diasEntre,
  ultimoDiaDelMesDe,
  fechaCorteDelPeriodo,
  periodoDeCorte,
  recordatoriosDelCorte,
  recordatoriosDelPeriodo,
  enVentana,
  claveDedup,
  decidirRecordatorios,
  resumenParaPropietario,
  proximoCorte
};
