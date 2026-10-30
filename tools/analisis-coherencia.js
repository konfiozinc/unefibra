'use strict';
/* KZ-UNEF-029 · Análisis de coherencia ciclos / vencimientos / renovaciones.
   SOLO LECTURA sobre producción. Solo agregados: no imprime ni guarda nombres,
   teléfonos, direcciones ni ids de cliente en claro. */
const fs = require("fs");
const { tokenAcceso } = require("../tools/lib/google-auth");
const { fechaDeCorte, normalizarCiclo } = require("../functions/src/vencimientos");

const P = "une-fibra";
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;

const val = (campo) => {
  if (!campo) return null;
  if (campo.stringValue !== undefined) return campo.stringValue;
  if (campo.integerValue !== undefined) return Number(campo.integerValue);
  if (campo.doubleValue !== undefined) return Number(campo.doubleValue);
  if (campo.booleanValue !== undefined) return campo.booleanValue;
  if (campo.timestampValue !== undefined) return campo.timestampValue;
  if (campo.nullValue !== undefined) return null;
  if (campo.arrayValue) return (campo.arrayValue.values || []).map(val);
  if (campo.mapValue) return Object.fromEntries(Object.entries(campo.mapValue.fields || {}).map(([k, v]) => [k, val(v)]));
  return null;
};
const desDoc = (doc) => ({ __id: doc.name.split("/").pop(), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)])) });

async function leerTodo(t, coleccion, filtros = {}) {
  const donde = Object.entries(filtros).map(([campo, valor]) => ({
    fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: { stringValue: String(valor) } }
  }));
  const consulta = { from: [{ collectionId: coleccion }], limit: 5000 };
  if (donde.length === 1) consulta.where = donde[0];
  const r = await fetch(`${BASE}:runQuery`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
    body: JSON.stringify({ structuredQuery: consulta })
  });
  if (!r.ok) throw new Error("runQuery " + coleccion + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  return arr.filter((x) => x && x.document).map((x) => desDoc(x.document));
}

const cuenta = {};
const sumar = (clave) => { cuenta[clave] = (cuenta[clave] || 0) + 1; };

(async () => {
  const t = await tokenAcceso();
  const clientes = await leerTodo(t, "clientes");
  const servicios = await leerTodo(t, "servicios", { "conciliacion.estado": "PENDIENTE_VALIDACION" });

  /* --- A. Distribución del ciclo de corte --- */
  const ciclos = {};
  for (const c of clientes) {
    const ck = String(c.cicloCorte || "SIN CICLO");
    ciclos[ck] = (ciclos[ck] || 0) + 1;
  }

  /* --- B. ¿La fecha de vencimiento cae en un día de corte de su ciclo? --- */
  let conFecha = 0, enDiaDeCorte = 0, fueraDeDiaDeCorte = 0, sinCiclo = 0, sinFecha = 0;
  const diasDelMes = {};
  for (const c of clientes) {
    const ciclo = normalizarCiclo(c.cicloCorte);
    const f = c.fechaVencimiento;
    if (!ciclo) { sinCiclo++; continue; }
    if (typeof f !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f)) { sinFecha++; continue; }
    conFecha++;
    const dia = Number(f.slice(8, 10));
    diasDelMes[dia] = (diasDelMes[dia] || 0) + 1;
    const [a, m] = f.split("-").map(Number);
    if (fechaDeCorte(a, m, ciclo) === f) enDiaDeCorte++;
    else fueraDeDiaDeCorte++;
  }

  /* --- C. Servicios en conciliación: ¿coincide su fecha con la del cliente? --- */
  let iguales = 0, distintas = 0, sinFechaServicio = 0, sinCliente = 0;
  let antesDelAlta = 0;
  const cliPorId = new Map(clientes.map((c) => [c.__id, c]));
  for (const sv of servicios) {
    const cli = sv.clienteId ? cliPorId.get(sv.clienteId) : null;
    if (!cli) sinCliente++;
    if (!sv.fechaVencimiento) { sinFechaServicio++; continue; }
    if (cli && cli.fechaVencimiento) {
      if (String(sv.fechaVencimiento) === String(cli.fechaVencimiento)) iguales++;
      else distintas++;
    }
    const alta = sv.fechaInicio || sv.fechaInstalacion;
    if (alta && String(sv.fechaVencimiento) <= String(alta)) antesDelAlta++;
  }

  /* --- D. Renovación: ¿el período del pago respeta el ciclo? (modelo, no datos) --- */
  const { calcularPeriodo } = require("../functions/src/renovacion");
  const muestraRenovacion = [];
  for (const [vencimiento, ciclo] of [["2026-11-15", 15], ["2026-11-30", 30], ["2027-02-28", 30]]) {
    const p = calcularPeriodo({ vencimiento, duracion: 30, hoy: "2026-10-29" });
    const [a, m] = vencimiento.split("-").map(Number);
    muestraRenovacion.push({
      vencimiento, ciclo,
      periodoInicio: p.periodoInicio, periodoFin: p.periodoFin,
      corteDelMes: fechaDeCorte(a, m, ciclo),
      diasDelPeriodo: Math.round((Date.parse(p.periodoFin) - Date.parse(p.periodoInicio)) / 86400000)
    });
  }

  /* --- E. Deriva: ¿la fecha de vencimiento se mantiene en el día del ciclo
         después de varias renovaciones de 30 días? --- */
  const deriva = {};
  for (const ciclo of [15, 30]) {
    const [a, m] = [2026, ciclo === 15 ? 11 : 11];
    let fecha = fechaDeCorte(a, m, ciclo);
    const pasos = [];
    for (let i = 0; i < 6; i++) {
      const p = calcularPeriodo({ vencimiento: fecha, duracion: 30, hoy: "2026-10-29" });
      fecha = p.periodoFin;
      const [ya, ym] = fecha.split("-").map(Number);
      pasos.push({ fecha, esDiaDeCorte: fechaDeCorte(ya, ym, ciclo) === fecha });
    }
    deriva["ciclo_" + ciclo] = {
      inicio: fechaDeCorte(a, m, ciclo),
      pasos,
      sigueEnElCorte: pasos[pasos.length - 1].esDiaDeCorte
    };
  }

  const salida = {
    generado: new Date().toISOString(),
    proyecto: P,
    soloLectura: true,
    totales: { clientes: clientes.length, serviciosEnConciliacion: servicios.length },
    A_ciclos: ciclos,
    B_fechasDeClientes: { conFecha, enDiaDeCorte, fueraDeDiaDeCorte, sinCiclo, sinFecha },
    B_diasDelMesMasFrecuentes: Object.entries(diasDelMes).sort((a, b) => b[1] - a[1]).slice(0, 8),
    C_servicios: { igualesAlCliente: iguales, distintosAlCliente: distintas, sinFechaServicio, anterioresAlAlta: antesDelAlta, sinCliente },
    D_renovacion: muestraRenovacion,
    E_deriva: deriva
  };

  fs.mkdirSync("C:\\KZ-EVIDENCIA\\kz-unef-029", { recursive: true });
  fs.writeFileSync("C:\\KZ-EVIDENCIA\\kz-unef-029\\coherencia.json", JSON.stringify(salida, null, 1));

  console.log("=== Coherencia ciclos / vencimientos / renovaciones (producción, solo lectura) ===\n");
  console.log("Clientes: " + clientes.length + " · servicios en conciliación: " + servicios.length + "\n");
  console.log("A) Ciclo de corte asignado:");
  for (const [k, v] of Object.entries(ciclos).sort((a, b) => b[1] - a[1])) console.log("   " + String(k).padEnd(12) + v);
  console.log("\nB) Fecha de vencimiento del cliente frente a su ciclo:");
  console.log("   con fecha válida          : " + conFecha);
  console.log("   cae en su día de corte    : " + enDiaDeCorte);
  console.log("   NO cae en su día de corte : " + fueraDeDiaDeCorte);
  console.log("   sin ciclo                 : " + sinCiclo);
  console.log("   sin fecha                 : " + sinFecha);
  console.log("   días del mes más usados   : " + JSON.stringify(salida.B_diasDelMesMasFrecuentes));
  console.log("\nC) Servicios en conciliación:");
  console.log("   fecha igual a la del cliente : " + iguales);
  console.log("   fecha distinta               : " + distintas);
  console.log("   sin fecha                    : " + sinFechaServicio);
  console.log("   con fecha anterior al alta   : " + antesDelAlta);
  console.log("   sin cliente encontrado       : " + sinCliente);
  console.log("\nD) Renovación: período que produce hoy el sistema (duración fija de 30 días)");
  for (const r of muestraRenovacion) {
    console.log("   vence " + r.vencimiento + " (ciclo " + r.ciclo + ") -> período " + r.periodoInicio + " a " + r.periodoFin +
      " (" + r.diasDelPeriodo + " días) · el corte de ese mes es el " + r.corteDelMes);
  }
  console.log("\nE) Deriva de la fecha tras renovar 6 veces seguidas (30 días fijos):");
  for (const [k, v] of Object.entries(deriva)) {
    console.log("   " + k + " desde " + v.inicio + ": " + v.pasos.map((p) => p.fecha + (p.esDiaDeCorte ? "" : "!")).join(" -> "));
    console.log("        termina " + (v.sigueEnElCorte ? "EN" : "FUERA DE") + " su día de corte  (! = ya no es día de corte)");
  }
  console.log("\nInforme: C:\\KZ-EVIDENCIA\\kz-unef-029\\coherencia.json");
})().catch((e) => { console.error("ERROR: " + e.message); process.exit(1); });
