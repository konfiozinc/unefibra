'use strict';
/* ============================================================
 * KZ-UNEF-021 · Lógica pura del importador de pagos históricos
 * ------------------------------------------------------------
 * Convierte las celdas del Excel (ya extraídas a JSON) en «propuestas» de pago.
 * No escribe nada, no conoce Firestore y no inventa datos.
 *
 * Decisiones que implementa:
 *   · Solo hojas 1 y 2. Cualquier registro de otra hoja lanza error: no se
 *     «ignora en silencio», se rechaza para que nadie lo procese de rebote.
 *   · ID determinista por (hoja, fila, período): reejecutar no duplica.
 *   · Un importe NO se convierte en pago confirmado. Toda propuesta nace en
 *     estado PROPUESTA y las dudosas van a revisión humana.
 *   · «XXXX» no es deuda: es una marca histórica del dueño, guardada aparte y
 *     con una advertencia explícita de que no autoriza suspender.
 *   · No se transporta usuario, contraseña, MAC ni IP: el importador ni los lee.
 * ============================================================ */

const HOJAS_AUTORIZADAS = Object.freeze([1, 2]);
const REFERENCIA = 'excel-historico-kz-unef-021';

const CLASES = Object.freeze({
  INEQUIVOCA: 'COINCIDENCIA_INEQUIVOCA',
  POSIBLE_ABONO: 'POSIBLE_ABONO',
  EXTRAORDINARIO: 'PAGO_EXTRAORDINARIO',
  AMBIGUA: 'CELDA_AMBIGUA',
  SIN_CLIENTE: 'SIN_CLIENTE_UNICO',
  DUPLICADO: 'DUPLICADO',
  DUPLICADO_LINEA: 'CLIENTE_CON_VARIAS_LINEAS'
});

/** ID determinista e idempotente: hoja + fila + período. */
function idPropuesta(hoja, fila, periodo) {
  if (!HOJAS_AUTORIZADAS.includes(Number(hoja))) throw new Error(`hoja no autorizada: ${hoja}`);
  if (!Number.isInteger(Number(fila)) || Number(fila) <= 0) throw new Error('fila inválida');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodo))) throw new Error(`período inválido: ${periodo}`);
  return `hist-h${Number(hoja)}-f${String(Number(fila)).padStart(4, '0')}-${periodo}`;
}

/** ID determinista de una marca de no pago. */
function idMarca(hoja, fila, periodo) {
  return `marca-h${Number(hoja)}-f${String(Number(fila)).padStart(4, '0')}-${periodo}`;
}

/**
 * Clasifica el importe de una celda frente al valor de la factura del cliente.
 * No decide si es pago confirmado: eso siempre es del administrador.
 */
function clasificarImporte(monto, valorFactura) {
  const m = Number(monto);
  const f = Number(valorFactura);
  if (!Number.isFinite(m) || m <= 0) return { clase: CLASES.AMBIGUA, motivo: 'importe no legible' };
  if (!Number.isFinite(f) || f <= 0) return { clase: CLASES.INEQUIVOCA, motivo: 'sin valor de factura de referencia' };
  if (m === f) return { clase: CLASES.INEQUIVOCA, motivo: null };
  if (m < f) return { clase: CLASES.POSIBLE_ABONO, motivo: `importe menor que la factura (${m} < ${f})` };
  return { clase: CLASES.EXTRAORDINARIO, motivo: `importe mayor que la factura (${m} > ${f})` };
}

/**
 * Construye las propuestas y las marcas a partir de las filas del Excel y del
 * emparejamiento con clientes.
 *
 * @param {Array} filas       registros de excel-datos.local.json
 * @param {Map}   emparejados Map fila→{clienteId, metodo, duplicadoDeLinea}
 * @returns {{ propuestas: Array, marcas: Array, resumen: object, rechazadas: Array }}
 */
function construirPropuestas(filas, emparejados) {
  const propuestas = [];
  const marcas = [];
  const rechazadas = [];
  const vistos = new Map();   // clienteId|periodo → propuesta

  for (const f of filas) {
    if (!HOJAS_AUTORIZADAS.includes(Number(f.hoja))) {
      throw new Error(`registro de hoja no autorizada (${f.hoja}): la importación se detiene`);
    }
    const emp = emparejados.get(f.fila);
    for (const m of f.meses) {
      if (m.clase === 'VACIA') continue;

      /* «XXXX»: marca histórica del dueño. No es deuda ni autoriza suspender. */
      if (m.clase === 'NO_PAGO') {
        if (!emp || !emp.clienteId) { rechazadas.push({ fila: f.fila, periodo: m.periodo, motivo: 'marca sin cliente único' }); continue; }
        marcas.push({
          id: idMarca(f.hoja, f.fila, m.periodo),
          clienteId: emp.clienteId, periodo: m.periodo, hoja: `hoja-${f.hoja}`, fila: f.fila,
          tipo: 'NO_PAGO_HISTORICO',
          advertencia: 'Marca del dueño en el Excel. NO es deuda confirmada y NO autoriza suspender.'
        });
        continue;
      }

      /* Celdas ambiguas: nunca se convierten en pago. */
      if (m.clase === 'AMBIGUO') {
        propuestas.push({
          id: idPropuesta(f.hoja, f.fila, m.periodo),
          clienteId: emp ? emp.clienteId : null,
          periodo: m.periodo, hoja: `hoja-${f.hoja}`, fila: f.fila,
          monto: m.monto ?? null,
          clase: CLASES.AMBIGUA,
          estado: 'PROPUESTA',
          requiereRevision: true,
          motivo: 'anotación ambigua en el Excel (importe con nota, error de tecleo o texto)',
          referenciaPrivada: REFERENCIA + ':' + f.hoja + ':' + f.fila + ':' + m.periodo,
          origen: REFERENCIA
        });
        continue;
      }

      /* PAGO con importe. */
      if (!emp || !emp.clienteId) {
        propuestas.push({
          id: idPropuesta(f.hoja, f.fila, m.periodo),
          clienteId: null, periodo: m.periodo, hoja: `hoja-${f.hoja}`, fila: f.fila,
          monto: m.monto, clase: CLASES.SIN_CLIENTE, estado: 'PROPUESTA',
          requiereRevision: true, motivo: 'la fila del Excel no tiene un cliente único en el sistema',
          referenciaPrivada: REFERENCIA + ':' + f.hoja + ':' + f.fila + ':' + m.periodo,
          origen: REFERENCIA
        });
        continue;
      }
      if (emp.duplicadoDeLinea) {
        propuestas.push({
          id: idPropuesta(f.hoja, f.fila, m.periodo),
          clienteId: emp.clienteId, periodo: m.periodo, hoja: `hoja-${f.hoja}`, fila: f.fila,
          monto: m.monto, clase: CLASES.DUPLICADO_LINEA, estado: 'PROPUESTA',
          requiereRevision: true, motivo: 'el cliente tiene más de una línea en el Excel',
          referenciaPrivada: REFERENCIA + ':' + f.hoja + ':' + f.fila + ':' + m.periodo,
          origen: REFERENCIA
        });
        continue;
      }
      const clave = `${emp.clienteId}|${m.periodo}`;
      if (vistos.has(clave)) {
        propuestas.push({
          id: idPropuesta(f.hoja, f.fila, m.periodo),
          clienteId: emp.clienteId, periodo: m.periodo, hoja: `hoja-${f.hoja}`, fila: f.fila,
          monto: m.monto, clase: CLASES.DUPLICADO, estado: 'PROPUESTA',
          requiereRevision: true, motivo: `el mismo cliente y período ya aparecen en ${vistos.get(clave).id}`,
          referenciaPrivada: REFERENCIA + ':' + f.hoja + ':' + f.fila + ':' + m.periodo,
          origen: REFERENCIA
        });
        continue;
      }

      const { clase, motivo } = clasificarImporte(m.monto, f.valorFactura);
      const propuesta = {
        id: idPropuesta(f.hoja, f.fila, m.periodo),
        clienteId: emp.clienteId, periodo: m.periodo, hoja: `hoja-${f.hoja}`, fila: f.fila,
        monto: m.monto,
        clase, estado: 'PROPUESTA',
        requiereRevision: clase !== CLASES.INEQUIVOCA,
        motivo,
        referenciaPrivada: REFERENCIA + ':' + f.hoja + ':' + f.fila + ':' + m.periodo,
        origen: REFERENCIA
      };
      vistos.set(clave, propuesta);
      propuestas.push(propuesta);
    }
  }

  const resumen = {
    propuestas: propuestas.length,
    inequivocas: propuestas.filter((p) => p.clase === CLASES.INEQUIVOCA).length,
    posiblesAbonos: propuestas.filter((p) => p.clase === CLASES.POSIBLE_ABONO).length,
    extraordinarios: propuestas.filter((p) => p.clase === CLASES.EXTRAORDINARIO).length,
    ambiguas: propuestas.filter((p) => p.clase === CLASES.AMBIGUA).length,
    sinCliente: propuestas.filter((p) => p.clase === CLASES.SIN_CLIENTE).length,
    duplicados: propuestas.filter((p) => p.clase === CLASES.DUPLICADO).length,
    lineasDuplicadas: propuestas.filter((p) => p.clase === CLASES.DUPLICADO_LINEA).length,
    marcasNoPago: marcas.length,
    rechazadas: rechazadas.length,
    requierenRevision: propuestas.filter((p) => p.requiereRevision).length
  };
  return { propuestas, marcas, resumen, rechazadas };
}

/** Último período pagado por cliente, a partir de las propuestas inequívocas. */
function ultimoPeriodoPorCliente(propuestas) {
  const mapa = new Map();
  for (const p of propuestas) {
    if (p.clase !== CLASES.INEQUIVOCA || !p.clienteId) continue;
    const actual = mapa.get(p.clienteId);
    if (!actual || p.periodo > actual) mapa.set(p.clienteId, p.periodo);
  }
  return mapa;
}

module.exports = {
  HOJAS_AUTORIZADAS,
  REFERENCIA,
  CLASES,
  idPropuesta,
  idMarca,
  clasificarImporte,
  construirPropuestas,
  ultimoPeriodoPorCliente
};
