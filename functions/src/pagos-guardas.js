'use strict';
/* Guardas financieras extraídas para poder probarlas sin emulador.
   Son las MISMAS decisiones que aplica functions/src/index.js en
   registrarPago, confirmarPago y anularPago; la verificación se hace aquí y en
   el emulador cuando esté disponible. */
const ESTADOS = { PENDIENTE: 'PENDIENTE', CONFIRMADO: 'CONFIRMADO', ANULADO: 'ANULADO' };

function validarMonto(monto) {
  if (typeof monto === 'string') return { ok: false, codigo: 'invalid-argument', motivo: 'El monto debe ser numérico, no texto.' };
  const n = Number(monto);
  if (!Number.isFinite(n)) return { ok: false, codigo: 'invalid-argument', motivo: 'El monto debe ser finito.' };
  if (n <= 0) return { ok: false, codigo: 'invalid-argument', motivo: 'El monto debe ser mayor que cero.' };
  if (!Number.isSafeInteger(n)) return { ok: false, codigo: 'invalid-argument', motivo: 'El monto debe ser entero (COP sin decimales).' };
  return { ok: true, valor: n };
}

function validarFechaPago(f) {
  if (f == null) return { ok: true };
  return /^\d{4}-\d{2}-\d{2}$/.test(String(f)) ? { ok: true } : { ok: false, codigo: 'invalid-argument' };
}

function puedeConfirmar(estado) {
  if (estado === ESTADOS.ANULADO) return { ok: false, codigo: 'failed-precondition', motivo: 'anulado' };
  if (estado === ESTADOS.CONFIRMADO) return { ok: false, codigo: 'failed-precondition', motivo: 'ya confirmado' };
  return { ok: true };
}

function puedeAnular(estado, motivo) {
  if (estado === ESTADOS.ANULADO) return { ok: false, codigo: 'already-exists' };
  if (estado === ESTADOS.CONFIRMADO) return { ok: false, codigo: 'failed-precondition' };
  if (typeof motivo !== 'string' || motivo.trim().length < 3) return { ok: false, codigo: 'invalid-argument' };
  return { ok: true };
}

module.exports = { ESTADOS, validarMonto, validarFechaPago, puedeConfirmar, puedeAnular };