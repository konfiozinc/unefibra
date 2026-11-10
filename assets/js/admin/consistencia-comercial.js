/* UNEFIBRA-041: interpretación de lectura compartida. Sin Firebase ni escrituras. */
(function (raiz) {
  "use strict";
  const fechaValida = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && !Number.isNaN(Date.parse(v)) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
  const precioValido = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  const diasEntre = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  function proximoCorte(ciclo, hoy) {
    if (!["15", "30"].includes(String(ciclo)) || !fechaValida(hoy)) return null;
    let [a, m, d] = hoy.split("-").map(Number);
    const fecha = () => `${a}-${String(m).padStart(2, "0")}-${String(Math.min(Number(ciclo), new Date(Date.UTC(a, m, 0)).getUTCDate())).padStart(2, "0")}`;
    if (d > Number(fecha().slice(8))) { m++; if (m === 13) { m = 1; a++; } }
    return fecha();
  }
  function preparar(cliente, servicios, pagos, hoy) {
    if (!fechaValida(hoy)) throw new Error("Fecha de referencia inválida");
    const propios = servicios.filter((s) => s.clienteId === cliente.id);
    const servicio = propios.length === 1 ? propios[0] : null;
    const ciclo = String((servicio && servicio.cicloCorte) || cliente.cicloCorte || "");
    const fecha = cliente.fechaVencimiento || (servicio && servicio.fechaVencimiento) || null;
    const precio = (servicio && servicio.precioMensual) ?? cliente.precioMensual;
    const motivos = [];
    if (propios.length !== 1) motivos.push(propios.length ? "Varios servicios: requiere revisión" : "Sin servicio registrado");
    if (propios.some((s) => s.conciliacion && s.conciliacion.estado !== "HABILITADA")) motivos.push("Servicio pendiente de validación o habilitación");
    if (!fechaValida(fecha)) motivos.push("Vencimiento sin confirmar");
    if (!["15", "30"].includes(ciclo)) motivos.push("Corte sin confirmar");
    if (!precioValido(precio)) motivos.push("Precio por confirmar");
    if (servicio && cliente.fechaVencimiento && servicio.fechaVencimiento && cliente.fechaVencimiento !== servicio.fechaVencimiento) motivos.push("Fechas de cliente y servicio diferentes");
    if (servicio && cliente.cicloCorte && servicio.cicloCorte && String(cliente.cicloCorte) !== String(servicio.cicloCorte)) motivos.push("Cortes de cliente y servicio diferentes");
    const dias = fechaValida(fecha) ? diasEntre(fecha, hoy) : null;
    const cobertura = pagos.some((p) => p.clienteId === cliente.id && p.estado === "CONFIRMADO"
      && precioValido(p.monto) && fechaValida(p.fechaPago) && p.fechaPago <= hoy
      && fechaValida(p.periodoInicio) && fechaValida(p.periodoFin)
      && p.periodoInicio <= hoy && p.periodoFin >= hoy);
    return { id: cliente.id, ciclo, corte: proximoCorte(ciclo, hoy), fecha, precio, dias, motivos,
      grupo: motivos.length ? "pendientes" : dias < 0 ? "atrasados" : dias === 0 ? "hoy" : dias <= 7 ? "proximos" : "posteriores",
      situacion: motivos.length ? "Pendiente de validación" : cobertura ? "Pago confirmado cubre la fecha de consulta" : "Sin evidencia suficiente para determinar deuda",
      sinServicio: propios.length === 0 };
  }
  const GRUPOS = [
    { key: "pendientes", titulo: "Pendientes de validación", ayuda: "Información comercial por confirmar; no autoriza cobros ni suspensiones." },
    { key: "atrasados", titulo: "Vencimientos registrados atrasados", ayuda: "La fecha registrada ya pasó. Esto no confirma deuda." },
    { key: "hoy", titulo: "Vencimiento registrado hoy", ayuda: "Fecha registrada para hoy; consultar evidencia de pago." },
    { key: "proximos", titulo: "Vencimientos registrados próximos 7 días", ayuda: "Desde mañana hasta siete días después de la fecha de consulta." },
    { key: "posteriores", titulo: "Vencimientos registrados posteriores", ayuda: "Fecha registrada a más de siete días; no equivale a estar al día en pagos." }
  ];
  const resumen = (fichas) => Object.fromEntries(GRUPOS.map((g) => [g.key, fichas.filter((f) => f.grupo === g.key).length]));
  function prepararTodos(clientes, servicios, pagos, hoy) { return clientes.map((c) => preparar(c, servicios, pagos, hoy)); }
  function precioTexto(v) { return precioValido(v) ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v) : "Precio por confirmar"; }
  const api = { preparar, prepararTodos, resumen, proximoCorte, precioTexto, GRUPOS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.ConsistenciaComercial = api;
})(globalThis);
