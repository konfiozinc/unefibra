'use strict';
/* ============================================================
 * KZ-UNEF-023 · Módulo administrativo de pagos históricos
 * ------------------------------------------------------------
 * Tres callables. Todas las comprobaciones se hacen EN EL SERVIDOR:
 *
 *   listarPropuestasPagos        (ADMIN/SUPERADMIN, solo lectura)
 *   decidirPropuestasPagos       (ADMIN/SUPERADMIN, máx. 50 por llamada)
 *   corregirVencimientoContractual (ADMIN/SUPERADMIN, con confirmación)
 *
 * Blindajes comunes:
 *   · Interruptor `PAGOS_HISTORICOS_HABILITADO`: si no vale "true", las
 *     acciones de escritura lanzan failed-precondition. Las de lectura siguen
 *     disponibles para revisar sin poder decidir. En producción está apagado
 *     porque la variable no existe.
 *   · Nada de esto toca `servicios`, ni la conciliación, ni suspensiones.
 *   · Toda decisión escribe `auditoria` con anterior, nuevo, quién y por qué.
 *   · Una propuesta APROBADA no se puede volver a decidir (409 lógico).
 *
 * Este módulo NO crea pagos: solo cambia el estado de una propuesta. Convertir
 * propuestas aprobadas en pagos será un proceso aparte y autorizado aparte.
 * ============================================================ */

const MAX_POR_LLAMADA = 50;
const ESTADOS_DECIDIBLES = ['PROPUESTA', 'RECHAZADA'];
const CLASES_VALIDAS = [
  'COINCIDENCIA_INEQUIVOCA', 'POSIBLE_ABONO', 'PAGO_EXTRAORDINARIO',
  'CELDA_AMBIGUA', 'SIN_CLIENTE_UNICO', 'DUPLICADO', 'CLIENTE_CON_VARIAS_LINEAS'
];
/* Las ambiguas y las que no tienen cliente único NO pueden aprobarse nunca
   desde la interfaz: exigen corrección manual del origen. */
const NO_APROBABLES = ['CELDA_AMBIGUA', 'SIN_CLIENTE_UNICO'];

function interruptor(env) {
  return String((env || process.env).PAGOS_HISTORICOS_HABILITADO || '').toLowerCase() === 'true';
}

/**
 * Fábrica: recibe las dependencias de index.js para no duplicar inicialización.
 */
function crearCallables({ functions, db, verificarRol, auditar, FieldValue, env }) {
  const HttpsError = functions.https.HttpsError;
  const entorno = env || process.env;

  function exigirInterruptor(accion) {
    if (!interruptor(entorno)) {
      throw new HttpsError('failed-precondition',
        `Las acciones de ${accion} están deshabilitadas en este entorno (PAGOS_HISTORICOS_HABILITADO).`);
    }
  }

  /* ── 1 · LISTAR (solo lectura) ─────────────────────────────────────── */
  async function listarPropuestasPagos(data, context) {
    await verificarRol(context, ['ADMIN', 'SUPERADMIN']);
    const { clase, estado, texto, limite } = data || {};
    const tope = Math.min(Number(limite) || 100, 200);

    if (clase && !CLASES_VALIDAS.includes(clase)) throw new HttpsError('invalid-argument', 'Clase desconocida.');

    let q = db.collection('propuestas_pagos');
    if (clase) q = q.where('clase', '==', clase);
    if (estado) q = q.where('estado', '==', estado);
    const snap = await q.limit(tope * 3).get();

    const buscado = String(texto || '').trim().toLowerCase();
    const filas = [];
    for (const doc of snap.docs) {
      const p = { id: doc.id, ...doc.data() };
      if (buscado) {
        const heno = [p.clienteId, p.periodo, p.clase, p.referenciaPrivada, p.motivo].join(' ').toLowerCase();
        if (!heno.includes(buscado)) continue;
      }
      filas.push({
        id: p.id, clienteId: p.clienteId || null, periodo: p.periodo, monto: p.monto ?? null,
        clase: p.clase, estado: p.estado, motivo: p.motivo || null,
        requiereRevision: p.requiereRevision === true,
        aprobable: !NO_APROBABLES.includes(p.clase) && p.estado === 'PROPUESTA',
        hoja: p.hoja, fila: p.fila, referenciaPrivada: p.referenciaPrivada,
        decididoPor: p.decididoPor || null, decididoEn: p.decididoEn || null, motivoDecision: p.motivoDecision || null
      });
      if (filas.length >= tope) break;
    }
    return { total: filas.length, limite: tope, propuestas: filas, interruptorActivo: interruptor(entorno) };
  }

  /* ── 2 · DECIDIR (máx. 50, con auditoría) ──────────────────────────── */
  async function decidirPropuestasPagos(data, context) {
    const usuario = await verificarRol(context, ['ADMIN', 'SUPERADMIN']);
    exigirInterruptor('decisión');
    const { decisiones } = data || {};
    if (!Array.isArray(decisiones) || decisiones.length === 0) {
      throw new HttpsError('invalid-argument', 'Se requiere una lista de decisiones.');
    }
    if (decisiones.length > MAX_POR_LLAMADA) {
      throw new HttpsError('invalid-argument', `Máximo ${MAX_POR_LLAMADA} propuestas por solicitud.`);
    }
    const resultados = [];
    for (const d of decisiones) {
      const { id, accion, motivo } = d || {};
      if (!id || typeof id !== 'string') { resultados.push({ id: String(id), resultado: 'ID_INVALIDO' }); continue; }
      if (!['APROBAR', 'RECHAZAR'].includes(accion)) { resultados.push({ id, resultado: 'ACCION_INVALIDA' }); continue; }
      const justificacion = typeof motivo === 'string' ? motivo.trim() : '';
      if (justificacion.length < 10) { resultados.push({ id, resultado: 'MOTIVO_INSUFICIENTE' }); continue; }

      const ref = db.collection('propuestas_pagos').doc(id);
      try {
        const r = await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          if (!snap.exists) return { resultado: 'NO_EXISTE' };
          const p = snap.data();
          if (p.estado === 'APROBADA') return { resultado: 'YA_APROBADA' };
          if (!ESTADOS_DECIDIBLES.includes(p.estado)) return { resultado: 'ESTADO_NO_DECIDIBLE' };
          if (accion === 'APROBAR' && NO_APROBABLES.includes(p.clase)) {
            /* Los ambiguos y los que no tienen cliente único nunca se aprueban solos. */
            return { resultado: 'REQUIERE_CORRECCION_PREVIA' };
          }
          t.update(ref, {
            estado: accion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA',
            decididoPor: usuario.nombre || context.auth.uid,
            decididoPorId: context.auth.uid,
            decididoEn: FieldValue.serverTimestamp(),
            motivoDecision: justificacion.slice(0, 300),
            estadoAnterior: p.estado
          });
          return { resultado: accion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA', clase: p.clase, periodo: p.periodo };
        });
        if (r.resultado === 'APROBADA' || r.resultado === 'RECHAZADA') {
          await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
            accion === 'APROBAR' ? 'APROBAR_PAGO_HISTORICO' : 'RECHAZAR_PAGO_HISTORICO',
            'propuestas_pagos', id, { estado: 'PROPUESTA' }, { estado: r.resultado, motivo: justificacion.slice(0, 300) });
        }
        resultados.push({ id, ...r });
      } catch (e) {
        resultados.push({ id, resultado: 'ERROR', motivo: e.message });
      }
    }
    const resumen = resultados.reduce((a, r) => { a[r.resultado] = (a[r.resultado] || 0) + 1; return a; }, {});
    await auditar(context.auth.uid, usuario.nombre || context.auth.uid, 'DECIDIR_PAGOS_HISTORICOS',
      'propuestas_pagos', '-', null, { total: decisiones.length, resumen });
    return { total: decisiones.length, resumen, resultados };
  }

  /* ── 3 · CORREGIR VENCIMIENTO CONTRACTUAL ──────────────────────────── */
  async function corregirVencimientoContractual(data, context) {
    const usuario = await verificarRol(context, ['ADMIN', 'SUPERADMIN']);
    exigirInterruptor('corrección de vencimientos');
    const { clienteId, fechaPropuesta, periodoUtilizado, justificacion, confirmado, fechaAnteriorEsperada } = data || {};

    if (!clienteId || typeof clienteId !== 'string') throw new HttpsError('invalid-argument', 'Se requiere clienteId.');
    if (confirmado !== true) throw new HttpsError('failed-precondition', 'La corrección exige confirmación expresa (confirmado: true).');
    const motivo = typeof justificacion === 'string' ? justificacion.trim() : '';
    if (motivo.length < 15) throw new HttpsError('invalid-argument', 'La justificación debe tener al menos 15 caracteres.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaPropuesta || ''))) throw new HttpsError('invalid-argument', 'fechaPropuesta debe ser YYYY-MM-DD.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(periodoUtilizado || ''))) throw new HttpsError('invalid-argument', 'periodoUtilizado debe ser YYYY-MM.');

    const { proponerVencimiento, normalizarCiclo } = require('./vencimientos');
    const ref = db.collection('clientes').doc(clienteId);
    const servicioSnap = await db.collection('servicios').where('clienteId', '==', clienteId).limit(1).get();

    const resultado = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return { resultado: 'CLIENTE_NO_EXISTE' };
      const c = snap.data();

      /* Ciclo: solo 15 o 30. Si no es válido, no se toca nada. */
      const ciclo = normalizarCiclo(c.cicloCorte);
      if (ciclo === null) return { resultado: 'CICLO_INVALIDO', detalle: String(c.cicloCorte) };

      /* Concurrencia: si la fecha cambió desde que el panel la leyó, se rechaza. */
      if (fechaAnteriorEsperada && c.fechaVencimiento !== fechaAnteriorEsperada) {
        return { resultado: 'MODIFICADO_POR_OTRO', actual: c.fechaVencimiento || null };
      }

      /* Comprobación del período pagado: la fecha propuesta debe ser el corte
         siguiente al período indicado. No se acepta una fecha «a ojo». */
      const calculada = proponerVencimiento({ ultimoPeriodoPagado: periodoUtilizado, ciclo });
      if (!calculada.vencimiento) return { resultado: 'DATOS_INSUFICIENTES', detalle: calculada.motivo };
      if (calculada.vencimiento !== fechaPropuesta) {
        return { resultado: 'FECHA_NO_CORRESPONDE_AL_PERIODO', esperada: calculada.vencimiento };
      }

      t.update(ref, {
        fechaVencimiento: fechaPropuesta,
        vencimientoOrigen: 'correccion-contractual',
        vencimientoPeriodo: periodoUtilizado,
        vencimientoJustificacion: motivo.slice(0, 300),
        vencimientoCorregidoPor: usuario.nombre || context.auth.uid,
        updatedAt: FieldValue.serverTimestamp()
      });
      return { resultado: 'CORREGIDO', anterior: c.fechaVencimiento || null, nuevo: fechaPropuesta };
    });

    /* Auditoría completa, también cuando se rechaza. */
    await auditar(context.auth.uid, usuario.nombre || context.auth.uid, 'CORREGIR_VENCIMIENTO_CONTRACTUAL',
      'clientes', clienteId, { fechaVencimiento: resultado.anterior || null },
      { resultado: resultado.resultado, fechaPropuesta, periodoUtilizado, justificacion: motivo.slice(0, 300) });

    if (resultado.resultado !== 'CORREGIDO') {
      throw new HttpsError('failed-precondition', 'No se corrigió: ' + resultado.resultado);
    }
    return {
      clienteId, anterior: resultado.anterior, nuevo: resultado.nuevo,
      ciclo, periodoUtilizado, serviciosTocados: 0, conciliacionModificada: false
    };
  }

  return {
    MAX_POR_LLAMADA,
    listarPropuestasPagos: functions.https.onCall(listarPropuestasPagos),
    decidirPropuestasPagos: functions.https.onCall(decidirPropuestasPagos),
    corregirVencimientoContractual: functions.https.onCall(corregirVencimientoContractual)
  };
}

module.exports = { crearCallables, MAX_POR_LLAMADA, NO_APROBABLES, interruptor };
