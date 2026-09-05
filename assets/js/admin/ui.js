/* ============================================================
 * UNEFIBRAS SAS — Admin: utilidades compartidas (módulo ES)
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
  const numero = (CFG && CFG.whatsapp && CFG.whatsapp.numero) || "573028589954";
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
