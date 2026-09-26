/* ============================================================
 * UneFibra SAS — Admin: utilidades compartidas (módulo ES)
 * ------------------------------------------------------------
 * Fechas en zona Colombia (UTC-5), formato de moneda y badges
 * de estado. Usado por las páginas del panel.
 * ============================================================ */

export const COLOMBIA_UTC_OFFSET_MS = -5 * 3600000;

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
  const [label, tone] = map[estado] || [estado || "—", ""];
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

/** Traduce el error de una Cloud Function callable a un mensaje claro. */
export function msgError(err) {
  const code = (err && err.code) ? err.code : "";
  if (code.includes("already-exists")) return "La operación ya fue realizada.";
  if (code.includes("permission-denied")) return "No tienes permisos para esta operación.";
  if (code.includes("invalid-argument")) return "Datos incompletos o inválidos.";
  if (code.includes("unauthenticated")) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  return "No fue posible completar la operación. Intenta nuevamente.";
}

/* ============================================================
 * CICLOS DE CORTE (día 15 y día 30)
 * ------------------------------------------------------------
 * El negocio cobra en dos tandas: los clientes con corte el 15 y
 * los del corte el 30. El ciclo se guarda en `clientes.cicloCorte`
 * ("15" o "30") y de ahí se deriva la fecha del próximo corte.
 *
 * DECISIÓN DOCUMENTADA — febrero: el ciclo "30" usa el día 30, pero
 * si el mes no llega a 30 (febrero) el corte cae el último día del
 * mes: 28, o 29 en año bisiesto. Nunca se salta el corte del mes.
 * ============================================================ */

export const DIAS_CORTE = ["15", "30"];

/** Días que tiene un mes (m: 1-12). */
export function diasDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Día real del corte en un mes concreto, contemplando febrero. */
export function diaCorteDeMes(ciclo, anio, mes) {
  const deseado = String(ciclo) === "15" ? 15 : 30;
  return Math.min(deseado, diasDelMes(anio, mes));
}

/**
 * "YYYY-MM-DD" del próximo corte del ciclo a partir de una fecha.
 * Si el corte de este mes todavía no pasó, es el de este mes; si ya
 * pasó, el del mes siguiente.
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

/** Etiqueta corta del ciclo para la interfaz. */
export function etiquetaCorte(ciclo) {
  return String(ciclo) === "15" ? "Corte 15" : "Corte 30";
}

/** Días que faltan para el próximo corte (negativo no ocurre: se recalcula al mes siguiente). */
export function diasParaCorte(ciclo, desdeISO) {
  return diasRestantes(proximoCorteDe(ciclo, desdeISO));
}
