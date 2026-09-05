/* ============================================================
 * UNEFIBRAS SAS — Cloud Functions
 * ------------------------------------------------------------
 * Operaciones privilegiadas + motor de vencimientos + push.
 *
 * Por qué viven aquí (y no en el frontend):
 *  · Las Security Rules NO cubren al Admin SDK, así que aquí se
 *    ejecuta lógica que el frontend no debe poder forzar.
 *  · La renovación de pago usa transacciones para evitar cobros
 *    o extensiones duplicadas.
 *  · El motor de vencimientos se ejecuta programado (sin UI).
 *
 * Convención de fechas de negocio (vencimiento, inicio, pago,
 * periodos): string "YYYY-MM-DD" en zona local de Colombia.
 * `createdAt`/`updatedAt` usan serverTimestamp().
 *
 * Antes de desplegar:
 *   1. firebase login
 *   2. cd functions && npm install
 *   3. firebase deploy --only functions
 * ============================================================ */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const FieldValue = admin.firestore.FieldValue;

/* ------------------------------------------------------------------
 * Constantes de estados (coinciden con el modelo de datos)
 * ------------------------------------------------------------------ */
const ESTADO_CLIENTE = {
  ACTIVO: "ACTIVO",
  POR_VENCER: "POR_VENCER",
  PENDIENTE_PAGO: "PENDIENTE_PAGO",
  SUSPENDIDO: "SUSPENDIDO",
  INACTIVO: "INACTIVO"
};

const ESTADO_SERVICIO = {
  ACTIVO: "ACTIVO",
  POR_VENCER: "POR_VENCER",
  SUSPENDIDO: "SUSPENDIDO",
  INACTIVO: "INACTIVO"
};

const ESTADO_PAGO = {
  PENDIENTE: "PENDIENTE",
  CONFIRMADO: "CONFIRMADO",
  RECHAZADO: "RECHAZADO",
  ANULADO: "ANULADO"
};

const ESTADO_NOTIFICACION = {
  PENDIENTE: "PENDIENTE",
  ENVIADA: "ENVIADA",
  ERROR: "ERROR",
  CANCELADA: "CANCELADA"
};

/* ------------------------------------------------------------------
 * Utilidades de fecha (consistentes con "YYYY-MM-DD")
 * ------------------------------------------------------------------ */

/** Formatea un Date como "YYYY-MM-DD" usando componentes UTC. */
function fechaISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/** Desfase de Colombia (UTC-5, sin horario de verano). */
const COLOMBIA_UTC_OFFSET_MS = -5 * 3600000;

/** Hoy como "YYYY-MM-DD" en zona de Colombia. */
function hoyISO() {
  return fechaISO(new Date(Date.now() + COLOMBIA_UTC_OFFSET_MS));
}

/** Normaliza una fecha (string "YYYY-MM-DD" o Date) a Date en UTC a medianoche. */
function normalizarFecha(fecha) {
  if (!fecha) return new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [y, m, d] = fecha.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const d = new Date(fecha);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Suma días a una fecha y devuelve "YYYY-MM-DD". */
function sumarDias(fechaInicio, dias) {
  const base = normalizarFecha(fechaInicio);
  return fechaISO(new Date(base.getTime() + dias * 86400000));
}

/** Diferencia en días (entero) entre una fecha y hoy (zona Colombia). */
function diasHasta(fecha) {
  const a = normalizarFecha(fecha).getTime();
  const b = normalizarFecha(hoyISO()).getTime();
  return Math.round((a - b) / 86400000);
}

/* ------------------------------------------------------------------
 * Utilidades de persistencia
 * ------------------------------------------------------------------ */

/** Escribe una entrada inmutable de auditoría. */
async function auditar(usuarioId, usuarioNombre, accion, entidad, entidadId, datosAnteriores, datosNuevos) {
  await db.collection("auditoria").add({
    usuarioId: usuarioId || "sistema",
    usuarioNombre: usuarioNombre || "Sistema (motor de vencimientos)",
    accion,
    entidad,
    entidadId,
    datosAnteriores: datosAnteriores || null,
    datosNuevos: datosNuevos || null,
    fecha: FieldValue.serverTimestamp()
  });
}

/** Escribe una entrada de historial de estados del cliente. */
async function registrarHistorial(clienteId, estadoAnterior, estadoNuevo, motivo, usuarioId, usuarioNombre) {
  await db.collection("historial_estados").add({
    clienteId,
    estadoAnterior,
    estadoNuevo,
    motivo,
    fecha: FieldValue.serverTimestamp(),
    usuarioId: usuarioId || "sistema",
    usuarioNombre: usuarioNombre || "Sistema (motor de vencimientos)"
  });
}

/** Obtiene el plan desde Firestore; si no existe, lanza error. */
async function obtenerPlan(planId) {
  if (!planId) throw new functions.https.HttpsError("invalid-argument", "Se requiere planId.");
  const snap = await db.collection("planes").doc(planId).get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "El plan no existe.");
  return { id: snap.id, ...snap.data() };
}

/**
 * Verifica que el llamador esté autenticado, activo y tenga un rol
 * permitido. Devuelve el documento `usuarios/{uid}` del llamador.
 * (Defensa en profundidad: las Security Rules protegen el acceso
 * directo, pero las callables usan Admin SDK y DEBEN validar el rol.)
 */
async function verificarRol(context, rolesPermitidos) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Debes iniciar sesión.");
  const snap = await db.collection("usuarios").doc(context.auth.uid).get();
  const data = snap.exists ? snap.data() : null;
  if (!data || data.activo !== true) {
    throw new functions.https.HttpsError("permission-denied", "Usuario no autorizado.");
  }
  if (rolesPermitidos && !rolesPermitidos.includes(data.rol)) {
    throw new functions.https.HttpsError("permission-denied", "No tienes permisos para esta operación.");
  }
  return data;
}

/**
 * Envía push a todos los tokens activos de un cliente.
 * Maneja tokens inválidos/expirados desactivándolos.
 */
async function enviarPush(clienteId, titulo, cuerpo) {
  const tokensSnap = await db.collection("tokens_notificacion")
    .where("clienteId", "==", clienteId)
    .where("activo", "==", true)
    .get();

  if (tokensSnap.empty) return { enviados: 0, motivo: "Sin tokens registrados" };

  const tokens = tokensSnap.docs.map((d) => d.data().token);
  let enviados = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      await messaging.send({ token, notification: { title: titulo, body: cuerpo } });
      enviados++;
    } catch (error) {
      // Token inválido o expirado: se desactiva para no reintentarlo.
      if (error.code === "messaging/registration-token-not-registered" ||
          error.code === "messaging/invalid-registration-token") {
        const doc = tokensSnap.docs[i];
        await doc.ref.update({ activo: false, ultimaActividad: FieldValue.serverTimestamp() });
      }
    }
  }
  return { enviados, total: tokens.length };
}

/** Registra una notificación y devuelve true si era la primera vez. */
async function registrarNotificacion(clienteId, tipo, titulo, mensaje, periodoServicio) {
  // Clave anti-duplicados: clienteId + periodo + tipo
  const claveDedup = `${clienteId}_${periodoServicio || "sin-periodo"}_${tipo}`;

  const existente = await db.collection("notificaciones")
    .where("claveDedup", "==", claveDedup)
    .limit(1)
    .get();

  if (!existente.empty) return false; // ya fue enviada

  await db.collection("notificaciones").add({
    clienteId,
    tipo,
    titulo,
    mensaje,
    fechaProgramada: FieldValue.serverTimestamp(),
    fechaEnvio: null,
    estado: ESTADO_NOTIFICACION.PENDIENTE,
    periodoServicio: periodoServicio || null,
    canal: "PUSH",
    error: null,
    claveDedup,
    createdAt: FieldValue.serverTimestamp()
  });
  return true;
}

/* ============================================================
 * MÓDULO: MOTOR DE VENCIMIENTOS (función programada diaria)
 * ------------------------------------------------------------
 * Flujo:
 *   1. Servicios activos/por vencer.
 *   2. Días restantes.
 *   3. Estado POR_VENCER (≤7 días) y notificaciones según config.
 *   4. Anti-duplicados (claveDedup).
 *   5. Envío push + registro.
 *   6. Si venció sin pago → PENDIENTE_PAGO.
 *   7. Si corresponde → SUSPENDIDO.
 *   8. Auditoría.
 * ============================================================ */
exports.processDueDates = functions.pubsub
  .schedule("0 8 * * *") // 08:00 diario, hora de Bogotá
  .timeZone("America/Bogota")
  .onRun(async () => {
    const resumen = { revisados: 0, notificaciones: 0, porVencer: 0, pendientes: 0, suspendidos: 0 };

    // 1) Configuración de intervalos (días antes/después) y suspensión.
    const cfgSnap = await db.collection("configuracion").get();
    const cfg = {};
    cfgSnap.forEach((d) => (cfg[d.id] = d.data().valor));

    const diasAntes = cfg.diasAntes || [7, 5, 3, 1];
    const diasDespues = cfg.diasDespues || [0, -1, -3];
    const diasSuspension = cfg.diasSuspension || 5;

    // 2) Servicios con estado ACTIVO o POR_VENCER
    const servicios = await db.collection("servicios")
      .where("estado", "in", [ESTADO_SERVICIO.ACTIVO, ESTADO_SERVICIO.POR_VENCER])
      .get();

    for (const doc of servicios.docs) {
      const servicio = { id: doc.id, ...doc.data() };
      const clienteRef = db.collection("clientes").doc(servicio.clienteId);
      const clienteSnap = await clienteRef.get();

      if (!clienteSnap.exists) continue;

      const cliente = { id: clienteSnap.id, ...clienteSnap.data() };
      const dias = diasHasta(servicio.fechaVencimiento);
      resumen.revisados++;

      const periodo = servicio.fechaVencimiento ? String(servicio.fechaVencimiento) : servicio.id;

      // 3) Estado POR_VENCER cuando faltan 7 días o menos
      if (dias >= 0 && dias <= 7 && cliente.estadoCliente === ESTADO_CLIENTE.ACTIVO) {
        await clienteRef.update({
          estadoCliente: ESTADO_CLIENTE.POR_VENCER,
          estadoServicio: ESTADO_SERVICIO.POR_VENCER,
          updatedAt: FieldValue.serverTimestamp()
        });
        await doc.ref.update({ estado: ESTADO_SERVICIO.POR_VENCER });
        await registrarHistorial(cliente.id, ESTADO_CLIENTE.ACTIVO, ESTADO_CLIENTE.POR_VENCER, "Próximo a vencer", "sistema", "Motor de vencimientos");
        resumen.porVencer++;
      }

      // 4) Recordatorios antes del vencimiento
      for (const n of diasAntes) {
        if (dias === n) {
          const tipo = `RECORDATORIO_${n}_DIAS`;
          const nueva = await registrarNotificacion(
            cliente.id, tipo,
            "Tu servicio está por vencer",
            `UneFibra: tu servicio de Internet vence en ${n} día(s) (${servicio.fechaVencimiento}). Realiza tu pago para mantenerlo activo.`,
            periodo
          );
          if (nueva) {
            await enviarPush(cliente.id, "Tu servicio está por vencer", `Vence en ${n} día(s).`);
            resumen.notificaciones++;
          }
        }
      }

      // 5) Día del vencimiento y días posteriores (mora)
      for (const n of diasDespues) {
        if (dias === n) {
          const tipo = n === 0 ? "VENCIMIENTO_HOY" : `MORA_${Math.abs(n)}_DIAS`;
          const nueva = await registrarNotificacion(
            cliente.id, tipo,
            n === 0 ? "Hoy vence tu servicio" : "Pago pendiente",
            n === 0
              ? "Hoy vence tu servicio de Internet. Realiza tu pago para continuar disfrutando del servicio."
              : `Tu servicio presenta un pago pendiente (${Math.abs(n)} día(s)). Ponte al día para evitar la suspensión.`,
            periodo
          );
          if (nueva) {
            await enviarPush(cliente.id, "Aviso UneFibra", n === 0 ? "Hoy vence tu servicio." : "Tienes un pago pendiente.");
            resumen.notificaciones++;
          }
        }
      }

      // 6) Si venció y no hay pago que cubra el periodo → PENDIENTE_PAGO
      if (dias < 0 && cliente.estadoCliente !== ESTADO_CLIENTE.PENDIENTE_PAGO && cliente.estadoCliente !== ESTADO_CLIENTE.SUSPENDIDO) {
        const pagoCubre = await db.collection("pagos")
          .where("clienteId", "==", cliente.id)
          .where("estado", "==", ESTADO_PAGO.CONFIRMADO)
          .where("periodoFin", ">=", hoyISO())
          .limit(1)
          .get();

        if (pagoCubre.empty) {
          await clienteRef.update({
            estadoCliente: ESTADO_CLIENTE.PENDIENTE_PAGO,
            updatedAt: FieldValue.serverTimestamp()
          });
          await registrarHistorial(cliente.id, cliente.estadoCliente, ESTADO_CLIENTE.PENDIENTE_PAGO, "Vencimiento del periodo", "sistema", "Motor de vencimientos");
          await auditar("sistema", "Motor de vencimientos", "VENCER_SERVICIO", "clientes", cliente.id, { estadoCliente: cliente.estadoCliente }, { estadoCliente: ESTADO_CLIENTE.PENDIENTE_PAGO });
          resumen.pendientes++;
        }
      }

      // 7) Suspensión por mora prolongada
      if (dias <= -diasSuspension && cliente.estadoCliente !== ESTADO_CLIENTE.SUSPENDIDO && cliente.estadoCliente !== ESTADO_CLIENTE.INACTIVO) {
        await clienteRef.update({
          estadoCliente: ESTADO_CLIENTE.SUSPENDIDO,
          estadoServicio: ESTADO_SERVICIO.SUSPENDIDO,
          updatedAt: FieldValue.serverTimestamp()
        });
        await doc.ref.update({
          estado: ESTADO_SERVICIO.SUSPENDIDO,
          fechaSuspension: FieldValue.serverTimestamp(),
          motivoSuspension: "Falta de pago"
        });
        await registrarHistorial(cliente.id, cliente.estadoCliente, ESTADO_CLIENTE.SUSPENDIDO, "Suspensión por falta de pago", "sistema", "Motor de vencimientos");
        await auditar("sistema", "Motor de vencimientos", "SUSPENDER_SERVICIO", "clientes", cliente.id, { estadoCliente: cliente.estadoCliente }, { estadoCliente: ESTADO_CLIENTE.SUSPENDIDO });
        resumen.suspendidos++;
      }
    }

    return resumen;
  });

/* ============================================================
 * MÓDULO: CLIENTES (callable)
 * ============================================================ */
exports.crearCliente = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { nombreCompleto, documento, telefono, planId, precioMensual } = data || {};
  if (!nombreCompleto || !telefono) {
    throw new functions.https.HttpsError("invalid-argument", "Nombre y teléfono son obligatorios.");
  }

  // Evitar duplicados por documento (si se proporciona)
  if (documento) {
    const dup = await db.collection("clientes").where("documento", "==", documento).limit(1).get();
    if (!dup.empty) throw new functions.https.HttpsError("already-exists", "Ya existe un cliente con ese documento.");
  }

  const plan = await obtenerPlan(planId);
  const fechaInicio = data.fechaInicioServicio || hoyISO();
  const fechaVencimiento = sumarDias(fechaInicio, plan.duracion);

  const cliente = {
    nombreCompleto,
    documento: documento || null,
    telefono,
    whatsapp: data.whatsapp || telefono,
    email: data.email || null,
    direccion: data.direccion || null,
    barrio: data.barrio || null,
    ciudad: data.ciudad || "Medellín",
    planId: plan.id,
    planNombre: plan.nombre,
    precioMensual: precioMensual || plan.precio,
    fechaInstalacion: data.fechaInstalacion || null,
    fechaInicioServicio: fechaInicio,
    fechaVencimiento,
    estadoCliente: ESTADO_CLIENTE.ACTIVO,
    estadoServicio: ESTADO_SERVICIO.ACTIVO,
    metodoPagoPreferido: data.metodoPagoPreferido || null,
    observaciones: data.observaciones || null,
    activo: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const clienteRef = await db.collection("clientes").add(cliente);

  await db.collection("servicios").add({
    clienteId: clienteRef.id,
    planId: plan.id,
    fechaInicio,
    fechaVencimiento,
    precio: plan.precio,
    estado: ESTADO_SERVICIO.ACTIVO,
    fechaSuspension: null,
    fechaActivacion: null,
    motivoSuspension: null,
    createdAt: FieldValue.serverTimestamp()
  });

  await registrarHistorial(clienteRef.id, null, ESTADO_CLIENTE.ACTIVO, "Alta de cliente", context.auth.uid, data.usuarioNombre || context.auth.uid);
  await auditar(context.auth.uid, data.usuarioNombre || context.auth.uid, "CREAR_CLIENTE", "clientes", clienteRef.id, null, cliente);

  return { id: clienteRef.id, fechaVencimiento };
});

/* ============================================================
 * MÓDULO: PAGOS (callable)
 * ------------------------------------------------------------
 * registrarPago  → crea el pago en estado PENDIENTE.
 * confirmarPago  → confirma y renueva el servicio en transacción
 *                  (evita extensiones/cobros duplicados).
 * ============================================================ */
exports.registrarPago = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { clienteId, servicioId, monto, metodoPago, referencia, comprobanteUrl } = data || {};
  if (!clienteId || !monto) throw new functions.https.HttpsError("invalid-argument", "clienteId y monto son obligatorios.");

  const pago = {
    clienteId,
    servicioId: servicioId || null,
    monto,
    metodoPago: metodoPago || "Otro",
    fechaPago: data.fechaPago || hoyISO(),
    periodoInicio: null,
    periodoFin: null,
    referencia: referencia || null,
    comprobanteUrl: comprobanteUrl || null,
    estado: ESTADO_PAGO.PENDIENTE,
    registradoPor: context.auth.uid,
    createdAt: FieldValue.serverTimestamp()
  };

  const ref = await db.collection("pagos").add(pago);
  await auditar(context.auth.uid, data.usuarioNombre || context.auth.uid, "REGISTRAR_PAGO", "pagos", ref.id, null, pago);
  return { id: ref.id, estado: ESTADO_PAGO.PENDIENTE };
});

exports.confirmarPago = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { pagoId } = data || {};
  if (!pagoId) throw new functions.https.HttpsError("invalid-argument", "Se requiere pagoId.");

  const pagoRef = db.collection("pagos").doc(pagoId);

  // Transacción: renovación atómica sin duplicados.
  await db.runTransaction(async (t) => {
    const pagoSnap = await t.get(pagoRef);
    if (!pagoSnap.exists) throw new functions.https.HttpsError("not-found", "El pago no existe.");
    const pago = pagoSnap.data();
    if (pago.estado === ESTADO_PAGO.CONFIRMADO) {
      throw new functions.https.HttpsError("already-exists", "El pago ya fue confirmado.");
    }

    const clienteRef = db.collection("clientes").doc(pago.clienteId);
    const clienteSnap = await t.get(clienteRef);
    if (!clienteSnap.exists) throw new functions.https.HttpsError("not-found", "El cliente no existe.");
    const cliente = clienteSnap.data();

    const plan = await obtenerPlan(cliente.planId);
    const fechaInicio = cliente.fechaVencimiento || hoyISO();
    const periodoInicio = fechaInicio;
    const periodoFin = sumarDias(fechaInicio, plan.duracion);

    // Actualizar pago
    t.update(pagoRef, {
      estado: ESTADO_PAGO.CONFIRMADO,
      periodoInicio,
      periodoFin,
      fechaPago: hoyISO()
    });

    // Renovar servicio del cliente
    const servicios = await db.collection("servicios")
      .where("clienteId", "==", pago.clienteId)
      .where("estado", "in", [ESTADO_SERVICIO.ACTIVO, ESTADO_SERVICIO.POR_VENCER, ESTADO_SERVICIO.SUSPENDIDO])
      .limit(1)
      .get();

    if (!servicios.empty) {
      t.update(servicios.docs[0].ref, {
        fechaInicio: periodoInicio,
        fechaVencimiento: periodoFin,
        estado: ESTADO_SERVICIO.ACTIVO,
        fechaActivacion: hoyISO(),
        fechaSuspension: null,
        motivoSuspension: null
      });
    }

    // Cliente de nuevo ACTIVO
    t.update(clienteRef, {
      fechaInicioServicio: periodoInicio,
      fechaVencimiento: periodoFin,
      estadoCliente: ESTADO_CLIENTE.ACTIVO,
      estadoServicio: ESTADO_SERVICIO.ACTIVO,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Cancelar recordatorios pendientes del periodo anterior
    const pendientes = await db.collection("notificaciones")
      .where("clienteId", "==", pago.clienteId)
      .where("estado", "==", ESTADO_NOTIFICACION.PENDIENTE)
      .get();
    for (const n of pendientes.docs) {
      t.update(n.ref, { estado: ESTADO_NOTIFICACION.CANCELADA });
    }
  });

  const pagoFinal = (await pagoRef.get()).data();
  await registrarHistorial(pagoFinal.clienteId, pagoFinal.estado, ESTADO_CLIENTE.ACTIVO, "Pago recibido", context.auth.uid, data.usuarioNombre || context.auth.uid);
  await auditar(context.auth.uid, data.usuarioNombre || context.auth.uid, "CONFIRMAR_PAGO", "pagos", pagoId, { estado: ESTADO_PAGO.PENDIENTE }, { estado: ESTADO_PAGO.CONFIRMADO });

  return { id: pagoId, estado: ESTADO_PAGO.CONFIRMADO };
});

exports.anularPago = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { pagoId } = data || {};
  if (!pagoId) throw new functions.https.HttpsError("invalid-argument", "Se requiere pagoId.");

  const pagoRef = db.collection("pagos").doc(pagoId);
  const snap = await pagoRef.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "El pago no existe.");

  const anterior = snap.data().estado;
  if (anterior === ESTADO_PAGO.ANULADO) {
    throw new functions.https.HttpsError("already-exists", "El pago ya fue anulado.");
  }

  await pagoRef.update({ estado: ESTADO_PAGO.ANULADO, updatedAt: FieldValue.serverTimestamp() });
  await auditar(context.auth.uid, usuario.nombre || context.auth.uid, "ANULAR_PAGO", "pagos", pagoId, { estado: anterior }, { estado: ESTADO_PAGO.ANULADO });

  return { id: pagoId, estado: ESTADO_PAGO.ANULADO };
});

/* ============================================================
 * MÓDULO: ESTADOS DE SERVICIO (callable)
 * ============================================================ */
async function cambiarEstadoCliente(clienteId, estadoNuevo, estadoServicioNuevo, motivo, context, accion) {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  if (!clienteId) throw new functions.https.HttpsError("invalid-argument", "Se requiere clienteId.");

  const clienteRef = db.collection("clientes").doc(clienteId);
  const clienteSnap = await clienteRef.get();
  if (!clienteSnap.exists) throw new functions.https.HttpsError("not-found", "El cliente no existe.");
  const anterior = clienteSnap.data().estadoCliente;

  await clienteRef.update({
    estadoCliente: estadoNuevo,
    estadoServicio: estadoServicioNuevo,
    activo: estadoNuevo !== ESTADO_CLIENTE.INACTIVO,
    updatedAt: FieldValue.serverTimestamp()
  });

  // Actualizar el servicio asociado
  const servicios = await db.collection("servicios")
    .where("clienteId", "==", clienteId)
    .limit(1)
    .get();
  if (!servicios.empty) {
    await servicios.docs[0].ref.update({ estado: estadoServicioNuevo });
  }

  await registrarHistorial(clienteId, anterior, estadoNuevo, motivo, context.auth.uid, context.auth.uid);
  await auditar(context.auth.uid, context.auth.uid, accion, "clientes", clienteId, { estadoCliente: anterior }, { estadoCliente: estadoNuevo });
  return { clienteId, estado: estadoNuevo };
}

exports.activarServicio = functions.https.onCall((data, context) =>
  cambiarEstadoCliente(data.clienteId, ESTADO_CLIENTE.ACTIVO, ESTADO_SERVICIO.ACTIVO, "Activación de servicio", context, "ACTIVAR_SERVICIO"));

exports.suspenderServicio = functions.https.onCall((data, context) =>
  cambiarEstadoCliente(data.clienteId, ESTADO_CLIENTE.SUSPENDIDO, ESTADO_SERVICIO.SUSPENDIDO, data.motivo || "Suspensión administrativa", context, "SUSPENDER_SERVICIO"));

exports.desactivarServicio = functions.https.onCall((data, context) =>
  cambiarEstadoCliente(data.clienteId, ESTADO_CLIENTE.INACTIVO, ESTADO_SERVICIO.INACTIVO, data.motivo || "Cliente retirado", context, "DESACTIVAR_SERVICIO"));

exports.reactivarServicio = functions.https.onCall((data, context) =>
  cambiarEstadoCliente(data.clienteId, ESTADO_CLIENTE.ACTIVO, ESTADO_SERVICIO.ACTIVO, "Reactivación de cliente", context, "REACTIVAR_SERVICIO"));

/* ============================================================
 * MÓDULO: ENVÍO MANUAL DE NOTIFICACIÓN (callable)
 * ============================================================ */
exports.enviarNotificacion = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { clienteId, titulo, mensaje } = data || {};
  if (!clienteId || !mensaje) throw new functions.https.HttpsError("invalid-argument", "clienteId y mensaje son obligatorios.");

  const resultado = await enviarPush(clienteId, titulo || "UneFibra", mensaje);

  await db.collection("notificaciones").add({
    clienteId,
    tipo: "MANUAL",
    titulo: titulo || "UneFibra",
    mensaje,
    fechaProgramada: FieldValue.serverTimestamp(),
    fechaEnvio: FieldValue.serverTimestamp(),
    estado: ESTADO_NOTIFICACION.ENVIADA,
    periodoServicio: null,
    canal: "PUSH",
    error: null,
    claveDedup: `${clienteId}_manual_${Date.now()}`,
    createdAt: FieldValue.serverTimestamp()
  });

  await auditar(context.auth.uid, context.auth.uid, "ENVIAR_NOTIFICACION", "clientes", clienteId, null, { mensaje });
  return resultado;
});

/* ============================================================
 * MÓDULO: USUARIOS (callable, solo SUPERADMIN)
 * ============================================================ */
exports.crearUsuario = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["SUPERADMIN"]);

  const { nombre, email, password, rol } = data || {};
  if (!nombre || !email || !password || !rol) {
    throw new functions.https.HttpsError("invalid-argument", "Nombre, email, contraseña y rol son obligatorios.");
  }
  if (!["SUPERADMIN", "ADMIN", "OPERADOR"].includes(rol)) {
    throw new functions.https.HttpsError("invalid-argument", "Rol inválido.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: nombre });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new functions.https.HttpsError("already-exists", "Ya existe un usuario con ese correo.");
    }
    throw new functions.https.HttpsError("internal", "No fue posible crear el usuario.");
  }

  await db.collection("usuarios").doc(userRecord.uid).set({
    uid: userRecord.uid,
    nombre,
    email,
    rol,
    activo: true,
    createdAt: FieldValue.serverTimestamp()
  });

  await auditar(context.auth.uid, context.auth.uid, "CREAR_USUARIO", "usuarios", userRecord.uid, null, { nombre, email, rol });
  return { uid: userRecord.uid };
});

exports.actualizarUsuario = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["SUPERADMIN"]);

  const { uid, rol, activo, nombre } = data || {};
  if (!uid) throw new functions.https.HttpsError("invalid-argument", "Se requiere uid.");
  if (rol && !["SUPERADMIN", "ADMIN", "OPERADOR"].includes(rol)) {
    throw new functions.https.HttpsError("invalid-argument", "Rol inválido.");
  }
  // Evitar que un SUPERADMIN se auto-bloquee o degrade su propio rol.
  if (uid === context.auth.uid && (activo === false || (rol && rol !== "SUPERADMIN"))) {
    throw new functions.https.HttpsError("failed-precondition", "No puedes desactivarte ni degradar tu propio rol.");
  }

  const update = { updatedAt: FieldValue.serverTimestamp() };
  if (nombre !== undefined) update.nombre = nombre;
  if (rol !== undefined) update.rol = rol;
  if (activo !== undefined) update.activo = activo;

  await db.collection("usuarios").doc(uid).update(update);

  // Reflejar la des/activación también en Firebase Auth.
  if (activo === false) { try { await admin.auth().updateUser(uid, { disabled: true }); } catch (e) {} }
  if (activo === true) { try { await admin.auth().updateUser(uid, { disabled: false }); } catch (e) {} }

  await auditar(context.auth.uid, context.auth.uid, "GESTIONAR_USUARIO", "usuarios", uid, null, update);
  return { uid };
});

/* ============================================================
 * MÓDULO: DATOS DE DEMOSTRACIÓN (callable, solo SUPERADMIN)
 * ------------------------------------------------------------
 * Crea/borra datos DEMO claramente identificados (campo
 * `demo: true` + prefijo "DEMO -"). Nunca mezclar con datos reales.
 * ============================================================ */
exports.seedDemo = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["SUPERADMIN"]);

  const existentes = await db.collection("clientes").where("demo", "==", true).limit(1).get();
  if (!existentes.empty) {
    throw new functions.https.HttpsError("already-exists", "Ya existen datos DEMO. Bórralos antes de volver a crearlos.");
  }

  // Plan DEMO
  const planRef = await db.collection("planes").add({
    nombre: "DEMO - Plan Básico",
    descripcion: "Plan de demostración (no es real)",
    velocidad: "100 Mbps (DEMO)",
    precio: 50000,
    duracion: 30,
    unidadDuracion: "días",
    estado: "ACTIVO",
    demo: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  const hoy = hoyISO();
  const demoClientes = [
    { nombre: "DEMO - Cliente 001", estado: "ACTIVO", dias: 20, doc: "1000000001", barrio: "Laureles" },
    { nombre: "DEMO - Cliente 002", estado: "POR_VENCER", dias: 3, doc: "1000000002", barrio: "Belén" },
    { nombre: "DEMO - Cliente 003", estado: "PENDIENTE_PAGO", dias: -3, doc: "1000000003", barrio: "El Poblado" },
    { nombre: "DEMO - Cliente 004", estado: "SUSPENDIDO", dias: -12, doc: "1000000004", barrio: "Robledo" },
    { nombre: "DEMO - Cliente 005", estado: "INACTIVO", dias: -90, doc: "1000000005", barrio: "Centro" }
  ];

  let primerClienteId = null;
  for (const c of demoClientes) {
    const fechaVencimiento = sumarDias(hoy, c.dias);
    const fechaInicio = sumarDias(hoy, c.dias - 30);
    const estadoServicio = c.estado === "INACTIVO" ? "INACTIVO" : (c.estado === "SUSPENDIDO" ? "SUSPENDIDO" : "ACTIVO");

    const clienteRef = await db.collection("clientes").add({
      nombreCompleto: c.nombre,
      documento: c.doc,
      telefono: "3000000000",
      whatsapp: "3000000000",
      email: "demo@unefibras.co",
      direccion: "Calle DEMO 123",
      barrio: c.barrio,
      ciudad: "Medellín",
      planId: planRef.id,
      planNombre: "DEMO - Plan Básico",
      precioMensual: 50000,
      fechaInstalacion: fechaInicio,
      fechaInicioServicio: fechaInicio,
      fechaVencimiento,
      estadoCliente: c.estado,
      estadoServicio,
      metodoPagoPreferido: "Nequi",
      observaciones: "Cliente de demostración — NO es real",
      activo: c.estado !== "INACTIVO",
      demo: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    if (!primerClienteId) primerClienteId = clienteRef.id;

    await db.collection("servicios").add({
      clienteId: clienteRef.id,
      planId: planRef.id,
      fechaInicio,
      fechaVencimiento,
      precio: 50000,
      estado: estadoServicio,
      fechaSuspension: c.estado === "SUSPENDIDO" ? FieldValue.serverTimestamp() : null,
      fechaActivacion: null,
      motivoSuspension: c.estado === "SUSPENDIDO" ? "DEMO" : null,
      demo: true,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  // Un pago DEMO confirmado para el primer cliente
  if (primerClienteId) {
    await db.collection("pagos").add({
      clienteId: primerClienteId,
      monto: 50000,
      metodoPago: "Nequi",
      fechaPago: sumarDias(hoy, -10),
      periodoInicio: sumarDias(hoy, -40),
      periodoFin: sumarDias(hoy, -10),
      estado: "CONFIRMADO",
      registradoPor: context.auth.uid,
      demo: true,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  await auditar(context.auth.uid, context.auth.uid, "SEMBRAR_DEMO", "sistema", "demo", null, { cantidad: demoClientes.length });
  return { creados: demoClientes.length };
});

exports.borrarDemo = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["SUPERADMIN"]);

  let eliminados = 0;
  for (const coleccion of ["clientes", "servicios", "pagos", "planes", "notificaciones", "historial_estados"]) {
    const snap = await db.collection(coleccion).where("demo", "==", true).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    eliminados += snap.docs.length;
  }

  await auditar(context.auth.uid, context.auth.uid, "BORRAR_DEMO", "sistema", "demo", null, { eliminados });
  return { eliminados };
});
