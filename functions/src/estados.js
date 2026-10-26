'use strict';
/* ============================================================
 * UneFibra SAS — Estados del modelo de datos (KZ-UNEF-005)
 * ------------------------------------------------------------
 * Origen: en producción apareció un cliente con
 *      estadoCliente: "POR_VENCER"
 * y ese valor pertenece al modelo del SERVICIO, no al del CLIENTE.
 *
 * El sistema venía manejando dos vocabularios mezclados:
 *
 *   Cliente  : ACTIVO · PENDIENTE_PAGO · SUSPENDIDO · INACTIVO
 *   Servicio : ACTIVO · POR_VENCER   · SUSPENDIDO · INACTIVO
 *
 * "POR_VENCER" es una condición del SERVICIO (le faltan ≤7 días) y NUNCA
 * debería escribirse en el cliente. Consecuencias de la mezcla:
 *   · el panel pinta ese estado sin etiqueta (no está en su catálogo),
 *   · los filtros por estado del cliente lo esconden,
 *   · el motor no lo reconoce como estado de mora y no lo trata.
 *
 * Este módulo es la única definición de ambos catálogos y la que decide si un
 * valor es válido, a qué ámbito pertenece y qué hacer con él. No escribe nada:
 * la normalización de datos reales requiere autorización aparte.
 * ============================================================ */

const ESTADOS_CLIENTE = Object.freeze(["ACTIVO", "PENDIENTE_PAGO", "SUSPENDIDO", "INACTIVO"]);
const ESTADOS_SERVICIO = Object.freeze(["ACTIVO", "POR_VENCER", "SUSPENDIDO", "INACTIVO"]);
const ESTADOS_PAGO = Object.freeze(["PENDIENTE", "CONFIRMADO", "ANULADO"]);

/* Valores que existen SOLO en el ámbito de servicio y su equivalente del
   cliente. La equivalencia no es cosmética: POR_VENCER significa «está por
   vencer», y para el cliente eso es «pendiente de pago». */
const EQUIVALENTE_CLIENTE = Object.freeze({
  POR_VENCER: "PENDIENTE_PAGO"
});

/* Estados de cliente y cómo se reflejan en el servicio. Sirve para detectar
   incoherencias entre `clientes.estadoServicio` y `servicios.estado`. */
const SERVICIO_ESPERADO = Object.freeze({
  ACTIVO: "ACTIVO",
  PENDIENTE_PAGO: "POR_VENCER",
  SUSPENDIDO: "SUSPENDIDO",
  INACTIVO: "INACTIVO"
});

function esEstadoClienteValido(valor) {
  return ESTADOS_CLIENTE.includes(valor);
}

function esEstadoServicioValido(valor) {
  return ESTADOS_SERVICIO.includes(valor);
}

function esEstadoPagoValido(valor) {
  return ESTADOS_PAGO.includes(valor);
}

/**
 * Diagnostica un valor de estado sin modificarlo.
 * Devuelve: valido, ambito ("cliente" | "servicio" | "pago" | "desconocido"),
 * equivalenteCliente (si es un valor de servicio aplicable a un cliente) y
 * accion propuesta.
 */
function diagnosticarEstado(valor, ambito) {
  const v = typeof valor === "string" ? valor.trim() : valor;
  if (v === null || v === undefined || v === "") {
    return { valor: v, valido: false, ambito: "desconocido", motivo: "estado ausente", accion: "REQUIERE_REVISION" };
  }
  if (ambito === "cliente") {
    if (esEstadoClienteValido(v)) return { valor: v, valido: true, ambito: "cliente", accion: "NINGUNA" };
    if (esEstadoServicioValido(v)) {
      const eq = EQUIVALENTE_CLIENTE[v];
      return {
        valor: v,
        valido: false,
        ambito: "servicio",
        motivo: `"${v}" es un estado de SERVICIO aplicado al cliente`,
        equivalenteCliente: eq || null,
        accion: eq ? "NORMALIZAR_A_CLIENTE" : "REQUIERE_REVISION"
      };
    }
    return { valor: v, valido: false, ambito: "desconocido", motivo: "estado no reconocido", accion: "REQUIERE_REVISION" };
  }
  if (ambito === "servicio") {
    if (esEstadoServicioValido(v)) return { valor: v, valido: true, ambito: "servicio", accion: "NINGUNA" };
    if (esEstadoClienteValido(v) && v === "PENDIENTE_PAGO") {
      return { valor: v, valido: false, ambito: "cliente", motivo: "PENDIENTE_PAGO es estado de cliente", equivalenteServicio: "POR_VENCER", accion: "NORMALIZAR_A_SERVICIO" };
    }
    return { valor: v, valido: false, ambito: "desconocido", motivo: "estado no reconocido", accion: "REQUIERE_REVISION" };
  }
  if (ambito === "pago") {
    return esEstadoPagoValido(v)
      ? { valor: v, valido: true, ambito: "pago", accion: "NINGUNA" }
      : { valor: v, valido: false, ambito: "desconocido", motivo: "estado de pago no reconocido", accion: "REQUIERE_REVISION" };
  }
  return { valor: v, valido: false, ambito: "desconocido", motivo: "ámbito no indicado", accion: "REQUIERE_REVISION" };
}

/**
 * Qué estado de servicio corresponde a un estado de cliente.
 * Devuelve null si el estado de cliente no es válido.
 */
function servicioEsperadoParaCliente(estadoCliente) {
  return esEstadoClienteValido(estadoCliente) ? SERVICIO_ESPERADO[estadoCliente] : null;
}

/**
 * ¿El par cliente/servicio es coherente? Devuelve un diagnóstico, no corrige.
 */
function verificarCoherencia(estadoCliente, estadoServicio) {
  const dc = diagnosticarEstado(estadoCliente, "cliente");
  const ds = diagnosticarEstado(estadoServicio, "servicio");
  if (!dc.valido) return { coherente: false, motivo: "estado de cliente inválido: " + dc.motivo, cliente: dc, servicio: ds };
  if (!ds.valido) return { coherente: false, motivo: "estado de servicio inválido: " + ds.motivo, cliente: dc, servicio: ds };
  const esperado = SERVICIO_ESPERADO[estadoCliente];
  const coherente = estadoServicio === esperado;
  return {
    coherente,
    motivo: coherente ? null : `un cliente ${estadoCliente} debería tener el servicio en ${esperado}, no en ${estadoServicio}`,
    esperado,
    cliente: dc,
    servicio: ds
  };
}

module.exports = {
  ESTADOS_CLIENTE,
  ESTADOS_SERVICIO,
  ESTADOS_PAGO,
  EQUIVALENTE_CLIENTE,
  SERVICIO_ESPERADO,
  esEstadoClienteValido,
  esEstadoServicioValido,
  esEstadoPagoValido,
  diagnosticarEstado,
  servicioEsperadoParaCliente,
  verificarCoherencia
};
