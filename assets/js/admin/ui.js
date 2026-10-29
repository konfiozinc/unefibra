/* ============================================================
 * UneFibra SAS — Admin: utilidades compartidas (módulo ES)
 * ------------------------------------------------------------
 * Fechas en zona Colombia (UTC-5), formato de moneda y badges
 * de estado. Usado por las páginas del panel.
 * ============================================================ */

export const COLOMBIA_UTC_OFFSET_MS = -5 * 3600000;

/** Escapa HTML para interpolar datos de forma segura (previene XSS). */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fechaISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function hoyColombia() {
  return fechaISO(new Date(Date.now() + COLOMBIA_UTC_OFFSET_MS));
}

export function sumarDias(fechaStr, dias) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  return fechaISO(new Date(Date.UTC(y, m - 1, d) + dias * 86400000));
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" */
export function fmtFecha(fechaStr) {
  if (!fechaStr) return "—";
  if (typeof fechaStr !== "string" || !fechaStr.includes("-")) return fechaStr;
  const [y, m, d] = fechaStr.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtMoney(v) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0);
}

/** Días hasta el vencimiento (negativo = vencido/atrasado). */
export function diasRestantes(fechaVencimiento) {
  if (!fechaVencimiento) return null;
  const [y, m, d] = String(fechaVencimiento).split("-").map(Number);
  const a = new Date(Date.UTC(y, m - 1, d)).getTime();
  const [hy, hm, hd] = hoyColombia().split("-").map(Number);
  const b = new Date(Date.UTC(hy, hm - 1, hd)).getTime();
  return Math.round((a - b) / 86400000);
}

export const ESTADOS_CLIENTE = ["ACTIVO", "POR_VENCER", "PENDIENTE_PAGO", "SUSPENDIDO", "INACTIVO"];

export function badgeEstado(estado) {
  const map = {
    ACTIVO: ["Activo", "tone-green"],
    POR_VENCER: ["Por vencer", "tone-amber"],
    PENDIENTE_PAGO: ["Pendiente", "tone-red"],
    SUSPENDIDO: ["Suspendido", "tone-red"],
    INACTIVO: ["Inactivo", "tone-violet"]
  };
  // OJO: el valor de respaldo va ESCAPADO. Si `estado` no es uno de los 5
  // válidos (dato viejo, edición a mano en la consola de Firebase, una
  // importación), se estaría interpolando texto de Firestore dentro de
  // innerHTML y eso es un XSS. Los 5 válidos son constantes de este archivo,
  // así que solo hay que escapar el caso desconocido.
  const conocido = map[estado];
  const label = conocido ? conocido[0] : (estado ? esc(estado) : "—");
  const tone = conocido ? conocido[1] : "";
  return `<span class="badge-estado ${tone}">${label}</span>`;
}

/** Texto legible de días para el vencimiento/atraso. */
export function textoDias(fechaVencimiento) {
  const d = diasRestantes(fechaVencimiento);
  if (d === null) return "—";
  if (d < 0) return `${Math.abs(d)} día(s) de atraso`;
  if (d === 0) return "Vence hoy";
  return `En ${d} día(s)`;
}

/** Enlace de WhatsApp con mensaje dinámico (número desde config). */
export function urlWhatsApp(mensaje) {
  const CFG = window.UNEFIBRAS_CONFIG;
  const numero = (CFG && CFG.whatsapp && CFG.whatsapp.numero) || "573044654987";
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

/** Traduce el error de una Cloud Function callable a un mensaje claro.
 *  KZ-UNEF-028 · Antes se descartaba SIEMPRE el mensaje del servidor y se devolvía
 *  un texto genérico. El backend explica en español por qué rechaza una operación
 *  («Un pago confirmado ya renovó el servicio: no se anula desde aquí»), y el
 *  operador se quedaba sin ese dato. Ahora se conserva el motivo real. */
export function msgError(err) {
  const code = String((err && err.code) || "");
  const detalle = typeof (err && err.message) === "string" ? err.message.trim() : "";
  if (code.includes("unauthenticated")) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  if (code.includes("permission-denied")) return detalle || "No tienes permisos para esta operación.";
  if (code.includes("already-exists")) return detalle || "La operación ya fue realizada.";
  if (code.includes("invalid-argument")) return detalle || "Datos incompletos o inválidos.";
  if (code.includes("failed-precondition")) return detalle || "La operación no está permitida en este momento.";
  if (code.includes("not-found")) return detalle || "El registro ya no existe.";
  if (code.includes("aborted") || code.includes("deadline")) return detalle || "Otro cambio ocurrió al mismo tiempo. Vuelve a intentarlo.";
  if (code.includes("resource-exhausted")) return detalle || "Demasiadas solicitudes seguidas. Espera un momento.";
  if (code.includes("unavailable") || code.includes("network")) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
  return detalle || "No fue posible completar la operación. Intenta nuevamente.";
}

/* ============================================================
 * CICLOS DE CORTE  (COPIA de functions/src/cortes.js)
 * ------------------------------------------------------------
 * REGLA VIGENTE (decisión del propietario, 29-oct-2026):
 *
 *     Los días de corte comerciales son el 15 y el 30 de cada mes.
 *     cicloCorte "15"  ->  corte el día 15
 *     cicloCorte "30"  ->  corte el día 30
 *
 *     Cada corte genera DOS recordatorios, a las 10:00 de Colombia:
 *         corte 15  ->  aviso el 12  y  aviso el 15
 *         corte 30  ->  aviso el 27  y  aviso el 30
 *
 * FEBRERO: el ciclo "30" corta el último día real del mes (28 o 29) y su primer
 * aviso cae 3 días antes (25 o 26). El servicio es mensual: saltarse febrero
 * dejaría al cliente sin período facturable.
 *
 * Este archivo es una COPIA de functions/src/cortes.js porque el navegador no
 * puede importar CommonJS. import/test-cortes.js compara las dos versiones y
 * falla si se separan.
 * ============================================================ */

export const DIAS_CORTE = ["15", "30"];

/** Días que tiene un mes (m: 1-12). */
export function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Día del CORTE que corresponde a un ciclo: el "15" corta el 15 y el "30" corta
 * el 30. Si se pasan año y mes, se recorta al último día real del mes, que es lo
 * que resuelve febrero sin un caso especial.
 */
export function diaCorteDeMes(ciclo, anio, mes) {
  const dia = String(ciclo) === "15" ? 15 : 30;
  if (Number.isInteger(anio) && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
    return Math.min(dia, diasDelMes(anio, mes));
  }
  return dia;
}

/**
 * "YYYY-MM-DD" del próximo corte del ciclo a partir de una fecha. Si hoy es el
 * día del corte, el próximo corte es hoy.
 */
export function proximoCorteDe(ciclo, desdeISO) {
  const base = desdeISO || hoyColombia();
  const [anio, mes, dia] = String(base).split("-").map(Number);
  const deEsteMes = diaCorteDeMes(ciclo, anio, mes);
  if (dia <= deEsteMes) return fechaISO(new Date(Date.UTC(anio, mes - 1, deEsteMes)));

  const sigAnio = mes === 12 ? anio + 1 : anio;
  const sigMes = mes === 12 ? 1 : mes + 1;
  return fechaISO(new Date(Date.UTC(sigAnio, sigMes - 1, diaCorteDeMes(ciclo, sigAnio, sigMes))));
}

/** Ciclo que corresponde a una fecha de vencimiento: días 1-15 → "15"; 16 o más → "30". */
export function cicloSegunFecha(fechaISOStr) {
  const dia = Number(String(fechaISOStr || "").slice(8, 10));
  if (!dia) return null;
  return dia <= 15 ? "15" : "30";
}

/** Etiqueta corta del ciclo para la interfaz. Muestra el día del CORTE (no el del aviso). */
export function etiquetaCorte(ciclo) {
  return "Corte día " + diaCorteDeMes(ciclo);
}

/** Días que faltan para el próximo corte (negativo no ocurre: se recalcula al mes siguiente). */
export function diasParaCorte(ciclo, desdeISO) {
  return diasRestantes(proximoCorteDe(ciclo, desdeISO));
}

/* ============================================================
 * RECORDATORIOS DE PAGO  (COPIA de functions/src/recordatorios.js)
 * ------------------------------------------------------------
 * Por cada corte el cliente recibe EXACTAMENTE DOS avisos a las 10:00 de
 * Colombia: 3 días antes del corte y el día del corte.
 * El panel solo los muestra; quien los genera y envía es el motor de las
 * Cloud Functions. Aquí viven las etiquetas y las palabras del propietario
 * para que la pantalla hable en comercial y no en códigos.
 * ============================================================ */

export const ZONA_RECORDATORIOS = "America/Bogota";
export const HORA_RECORDATORIOS = 10;
export const DIAS_ANTES_RECORDATORIO = 3;

/** Las dos fechas de aviso de un corte. */
export function recordatoriosDelCorte(corteISO) {
  if (typeof corteISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(corteISO)) return [];
  const [y, m, d] = corteISO.split("-").map(Number);
  const previo = fechaISO(new Date(Date.UTC(y, m - 1, d) - DIAS_ANTES_RECORDATORIO * 86400000));
  return [
    { clave: "previo", fecha: previo, etiqueta: `${DIAS_ANTES_RECORDATORIO} días antes del corte`, tipo: "previo" },
    { clave: "corte", fecha: corteISO, etiqueta: "Día del corte", tipo: "corte" }
  ];
}

/** El estado interno de un aviso, en la palabra que entiende el propietario. */
export function palabraEstadoAviso(estado) {
  const mapa = { PENDIENTE: "Pendiente", ENVIADA: "Enviado", ERROR: "Fallido", CANCELADA: "Cancelado" };
  return mapa[String(estado || "").toUpperCase()] || "Sin estado";
}

/** Qué aviso es, a partir del tipo guardado en la colección `notificaciones`. */
export function etiquetaTipoAviso(tipo) {
  const t = String(tipo || "");
  if (/^CORTE_.*_VENCIDO$/.test(t)) return "Día del corte";
  if (/^CORTE_.*_\d+_DIAS$/.test(t)) return "3 días antes del corte";
  if (t === "VENCIMIENTO_HOY") return "Hoy vence";
  if (/^MORA_/.test(t)) return "Aviso de mora";
  if (t === "MANUAL") return "Envío manual";
  return "Aviso";
}

/** Próximo aviso (fecha y etiqueta) de un corte, útil en las fichas. */
export function proximoAvisoDe(corteISO, hoy) {
  const hoyISOStr = hoy || hoyColombia();
  const pendiente = recordatoriosDelCorte(corteISO).find((r) => r.fecha >= hoyISOStr);
  return pendiente || null;
}

/** Cuánto falta para el corte, en palabras (recibe los días ya calculados). */
export function textoCuandoVence(dias) {
  if (dias === null || dias === undefined || Number.isNaN(Number(dias))) return "—";
  const d = Number(dias);
  if (d < 0) return `Vencido hace ${Math.abs(d)} día(s)`;
  if (d === 0) return "Vence hoy";
  if (d === 1) return "Vence mañana";
  return `Faltan ${d} día(s)`;
}
