/* ============================================================
 * UneFibra SAS — Cloud Functions
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

// firebase-functions 7 expone la API v2 en el export raíz. El frontend usa el SDK
// de Firebase 10.12.2, que solo invoca callables v1 (https://...cloudfunctions.net).
// Por eso se usa la API v1 explícita (`firebase-functions/v1`), que produce funciones
// v1 compatibles con el panel y con el despliegue productivo existente.
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
// firebase-admin 14 quita los namespaces legacy (admin.firestore/admin.messaging/
// admin.auth): se usan los submódulos oficiales.
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");

admin.initializeApp();

const db = getFirestore();
const messaging = getMessaging();

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
 * ----------------------------------------------------------------
 * Viven en ./renovacion.js para poder probarlas sin emulador y para que
 * el cálculo del periodo de facturación tenga UNA sola definición. Aquí
 * solo se importan.
 * ------------------------------------------------------------------ */
const {
  fechaISO,
  hoyISO,
  normalizarFecha,
  sumarDias,
  calcularPeriodo
} = require("./renovacion");

/** Diferencia en días (entero) entre una fecha y hoy (zona Colombia). */
function diasHasta(fecha) {
  const a = normalizarFecha(fecha).getTime();
  const b = normalizarFecha(hoyISO()).getTime();
  return Math.round((a - b) / 86400000);
}

/* ------------------------------------------------------------------
 * Ciclos de corte (día 15 y día 30)
 * ----------------------------------------------------------------
 * El negocio cobra en dos tandas: los clientes con corte el 15 y los
 * del corte el 30. `clientes.cicloCorte` guarda a cuál pertenece cada
 * uno ("15" o "30") y de ahí se deriva `proximoCorte`, que es la fecha
 * que manda en los avisos de cobro.
 *
 * DECISIÓN DOCUMENTADA — febrero: el ciclo "30" usa el día 30, pero si
 * el mes no llega a 30 el corte cae el último día del mes (28, o 29 en
 * año bisiesto). Nunca se salta el corte de un mes.
 *
 * La regla de negocio vive en ./cortes.js, compartida con las herramientas
 * de línea de comandos (tools/): así el motor, la migración y cualquier
 * script no pueden calcular distinto. El panel del navegador mantiene su
 * propia copia en assets/js/admin/ui.js, porque no puede importar CommonJS.
 * ------------------------------------------------------------------ */
const { proximoCorteDe, cicloValido } = require("./cortes");
/* KZ-UNEF-028 · Regla definitiva de recordatorios (dos avisos por vencimiento:
 * 3 días antes del corte y el día del corte, a las 10:00 de Colombia). El módulo
 * es puro y está probado en test/recordatorios.test.js; aquí solo se ejecuta. */
const { decidirRecordatorios, palabraEstado } = require("./recordatorios");
const {
  SOPORTE_POR_DEFECTO,
  construirMensajePrevioCorte,
  construirMensajePostCorte
} = require("./mensajes");
/* Guardas financieras: eran un módulo con pruebas que NADIE usaba (lógica
   duplicada dentro de este archivo). Ahora son la única definición y estas
   callables las usan, así que sus pruebas cubren el código real. */
const { validarMonto, puedeAnular } = require("./pagos-guardas");
/* Integración MikroTik: SOLO LECTURA desde aquí. La escritura existe en el
   módulo pero está cerrada por configuración y no la llama nadie. */
const { leerConfiguracion, informeEstado } = require("./mikrotik");
/* KZ-UNEF-006 · Guardia de conciliación: bloquea suspensión, avisos, renovación,
   reconexión, MikroTik y cambios de estado mientras los datos heredados de la
   importación no estén validados por una persona. */
const {
  enConciliacionPendiente,
  guardias,
  bloqueValidado,
  bloqueHabilitado,
  bloqueRechazado
} = require("./conciliacion");
const { construirServicio, puedeRevertirse } = require("./migracion");
/* KZ-UNEF-008 · Riesgo de habilitar un servicio (vencidos). Se evalúa SIEMPRE
   en el servidor y con la zona horaria de Colombia; el navegador solo informa. */
const { evaluarServicio, autorizarHabilitacion, resumirTanda } = require("./habilitacion");

/** Reúne servicio + cliente + pagos de un servicio y los evalúa. */
async function evaluarServicioPorId(servicioId) {
  const snap = await db.collection("servicios").doc(servicioId).get();
  if (!snap.exists) return { servicioId, existe: false };
  const servicio = { id: snap.id, ...snap.data() };
  const clienteSnap = servicio.clienteId
    ? await db.collection("clientes").doc(servicio.clienteId).get()
    : null;
  const cliente = clienteSnap && clienteSnap.exists ? { id: clienteSnap.id, ...clienteSnap.data() } : null;
  const pagosSnap = await db.collection("pagos").where("clienteId", "==", servicio.clienteId || "-").get();
  const pagos = pagosSnap.docs.map((d) => d.data());
  return {
    servicioId,
    existe: true,
    clienteId: servicio.clienteId || null,
    evaluacion: evaluarServicio({ servicio, cliente, pagos })
  };
}

const { enviarAlertaError } = require("./alertas");
const {
  exportarConDetalle,
  BUCKET: BUCKET_BACKUP,
  PROJECT_ID: PROJECT_ID_BACKUP
} = require("./backup");

/* ------------------------------------------------------------------
 * Contexto de los mensajes de cobro
 * ----------------------------------------------------------------
 * Reúne lo que necesitan las plantillas: cuentas bancarias (colección
 * `metodos_pago`), plantillas editables y WhatsApp de soporte
 * (documentos de `configuracion`).
 *
 * NINGÚN dato bancario vive en el código: si no hay cuenta configurada
 * o marcada como principal, el mensaje sale sin el bloque del banco, en
 * lugar de mandar al cliente a una cuenta equivocada.
 * ------------------------------------------------------------------ */
async function cargarContextoMensajes() {
  const [cuentasSnap, cfgSnap] = await Promise.all([
    db.collection("metodos_pago").get(),
    db.collection("configuracion").get()
  ]);

  const cfg = {};
  cfgSnap.forEach((d) => (cfg[d.id] = d.data().valor));

  const plantillas = cfg.plantillasMensaje || {};
  const soporte = cfg.soporte || {};

  return {
    cuentas: cuentasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    plantillaAntes: plantillas.antesCorte || null,
    plantillaDespues: plantillas.despuesCorte || null,
    soporte: {
      whatsapp1: soporte.whatsapp1 || SOPORTE_POR_DEFECTO.whatsapp1,
      whatsapp2: soporte.whatsapp2 || SOPORTE_POR_DEFECTO.whatsapp2
    }
  };
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
  let fallidos = 0;

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
      } else {
        /* KZ-UNEF-001 · Antes este caso se descartaba en silencio: ni log, ni
           estado. Un fallo de cuota o un payload demasiado grande parecía un
           envío correcto. */
        console.error("Envío push falló", {
          clienteId,
          codigo: error && error.code ? error.code : "desconocido",
          mensaje: error && error.message ? String(error.message).slice(0, 200) : null
        });
        fallidos++;
      }
    }
  }
  return { enviados, fallidos, total: tokens.length };
}

/**
 * KZ-UNEF-001 · Cierra el documento de la notificación con el resultado REAL
 * del envío. Antes nadie lo actualizaba: todos los avisos automáticos se
 * quedaban en PENDIENTE para siempre y, al confirmar un pago, se marcaban como
 * CANCELADA aunque sí se hubieran enviado. El panel mostraba "pendiente" o
 * "cancelada" donde debía decir "enviada" o "error".
 */
async function marcarEntregaPush(notifRef, resultado) {
  if (!notifRef || typeof notifRef.update !== "function") return;
  const enviados = (resultado && resultado.enviados) || 0;
  const total = (resultado && resultado.total) || 0;
  try {
    if (enviados > 0) {
      await notifRef.update({
        estado: ESTADO_NOTIFICACION.ENVIADA,
        fechaEnvio: FieldValue.serverTimestamp(),
        error: null
      });
    } else {
      const motivo = (resultado && resultado.motivo) || `Sin entrega (${enviados} de ${total} tokens)`;
      await notifRef.update({
        estado: ESTADO_NOTIFICACION.ERROR,
        fechaEnvio: null,
        error: String(motivo).slice(0, 300)
      });
    }
  } catch (e) {
    // No se rompe el motor por no poder anotar el resultado del aviso.
    console.error("No se pudo registrar el estado de la notificación", e && e.message);
  }
}

/**
 * KZ-UNEF-028 · ¿El cliente ya pagó el período que termina en este corte?
 * Devuelve true si existe UN pago CONFIRMADO cuyo período llega hasta el corte o
 * más allá. Es la comprobación que impide mandar recordatorios de cobro (o de
 * mora) a quien ya pagó, que es una de las tres condiciones del propietario.
 */
async function pagoConfirmadoCubreCorte(clienteId, corteISO) {
  if (!clienteId || !corteISO) return false;
  const snap = await db.collection("pagos")
    .where("clienteId", "==", clienteId)
    .where("estado", "==", ESTADO_PAGO.CONFIRMADO)
    .where("periodoFin", ">=", String(corteISO))
    .limit(1)
    .get();
  return !snap.empty;
}

/** Registra una notificación y devuelve su referencia (o false si ya existía). */
async function registrarNotificacion(clienteId, tipo, titulo, mensaje, periodoServicio) {
  // Clave anti-duplicados: clienteId + periodo + tipo
  const claveDedup = `${clienteId}_${periodoServicio || "sin-periodo"}_${tipo}`;

  const existente = await db.collection("notificaciones")
    .where("claveDedup", "==", claveDedup)
    .limit(1)
    .get();

  if (!existente.empty) return false; // ya fue enviada

  const ref = await db.collection("notificaciones").add({
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
  // Se devuelve la referencia (no `true`) para que quien envía pueda anotar
  // después el resultado real de la entrega.
  return ref;
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
// NOTA (lanzamiento): la integración con WhatsApp Cloud API quedó CANCELADA de
// forma definitiva. Los recordatorios se preparan como avisos en el panel
// (`notificaciones` + push) y el empleado los envía por WhatsApp Business de forma
// manual con el mensaje prellenado (botón "Cobrar" de las listas de corte). No hay
// llamadas a la Cloud API ni dependencia de plantillas de Meta.
/* Motor de vencimientos. Lógica en una función propia para poder dispararla:
   - desde el cron diario (processDueDates) y
   - manualmente desde un callable (ejecutarMotor, solo SUPERADMIN) para operación
     y para pruebas controladas sin esperar el cron. Es idempotente y audita.

   KZ-UNEF-028 · `opciones.hoy` existe ÚNICAMENTE para simular la fecha de los
   recordatorios en el emulador (la expone `ejecutarMotor` con guardián de
   entorno). Sin él se usa la fecha real de Colombia. No afecta a estados,
   suspensiones ni fechas del servicio: solo a la decisión de qué aviso toca. */
async function ejecutarMotorVencimientos(opciones = {}) {
    try {
    const hoyRecordatorio = opciones.hoy || hoyISO();
    const resumen = { revisados: 0, notificaciones: 0, porVencer: 0, pendientes: 0, suspendidos: 0, ciclos: 0, avisosCorte: 0, ciclosNotificacion: 0 };

    // 1) Configuración de intervalos (días antes/después) y suspensión.
    const cfgSnap = await db.collection("configuracion").get();
    const cfg = {};
    cfgSnap.forEach((d) => (cfg[d.id] = d.data().valor));

    // Recordatorios (regla definitiva del propietario, KZ-UNEF-028).
    //   · Exactamente DOS avisos por vencimiento: 3 días antes del corte y el día
    //     del corte, a las 10:00 de Colombia. Las fechas las decide
    //     src/recordatorios.js; ya no se configura desde `configuracion`.
    //   · Se siguen leyendo `diasDespues` (solo para servicios sin ciclo, hoy
    //     inexistentes) y `diasSuspension` (3 días naturales de mora).
    //   · Las claves históricas `diasAntes` / `diasDespues` de la colección
    //     `configuracion` quedan retiradas: si existen en Firestore, se ignoran.
    const diasDespues = cfg.diasDespues || [0];
    const diasSuspension = cfg.diasSuspension || 3;

    // 1.bis) Ciclos de corte. Rellena el ciclo de los clientes que no lo tengan
    // (así se migran solos los que ya existían) y refresca el próximo corte,
    // que cambia de mes en mes. Respeta el ciclo asignado a mano: solo lo deduce
    // cuando falta o es inválido. Es idempotente: solo escribe si algo cambió.
    const clientesSnap = await db.collection("clientes").get();
    for (const docCli of clientesSnap.docs) {
      const cli = docCli.data();
      const ciclo = cicloValido(cli.cicloCorte, cli.fechaVencimiento);
      if (!ciclo) continue;
      const proximo = proximoCorteDe(ciclo);
      if (cli.cicloCorte !== ciclo || cli.proximoCorte !== proximo) {
        await docCli.ref.update({
          cicloCorte: ciclo,
          proximoCorte: proximo,
          updatedAt: FieldValue.serverTimestamp()
        });
        resumen.ciclos++;
      }
    }

    // Contexto de los mensajes: cuentas bancarias, plantillas editables y
    // WhatsApp de soporte. Se lee una vez por corrida, no por cliente.
    const ctxMensajes = await cargarContextoMensajes();

    // 2) Servicios con estado ACTIVO o POR_VENCER
    const servicios = await db.collection("servicios")
      .where("estado", "in", [ESTADO_SERVICIO.ACTIVO, ESTADO_SERVICIO.POR_VENCER])
      .get();

    for (const doc of servicios.docs) {
      const servicio = { id: doc.id, ...doc.data() };
      /* KZ-UNEF-006 · Un servicio en conciliación NO entra al motor: sus datos
         (fechas, precio, plan) vienen de una importación que nadie ha validado.
         Se omite ANTES de cualquier lectura o escritura, así que no genera
         avisos, ni cambios de estado, ni suspensiones, ni toca el vencimiento.
         No depende de MikroTik: el guardia vive aquí. */
      if (enConciliacionPendiente(servicio)) {
        resumen.enConciliacion = (resumen.enConciliacion || 0) + 1;
        continue;
      }
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

      // 4) Recordatorios del corte. KZ-UNEF-028 · REGLA DEFINITIVA DEL PROPIETARIO:
      //    por cada vencimiento se envían EXACTAMENTE DOS avisos, a las 10:00 de
      //    Colombia: 3 días antes del corte y el mismo día del corte.
      //      corte 15 -> aviso el 12 y el 15 · corte 30 -> aviso el 27 y el 30
      //    La decisión (fechas, ventana de recuperación, deduplicación y omisión
      //    cuando ya hay pago confirmado) vive en src/recordatorios.js, que es
      //    puro y está probado aparte. Aquí solo se ejecuta.
      const cicloCliente = cicloValido(cliente.cicloCorte, servicio.fechaVencimiento);
      const proximoCorte = cicloCliente
        ? (cliente.proximoCorte || proximoCorteDe(cicloCliente))
        : null;
      /* KZ-UNEF-028 · «Ya está cubierto» significa que el servicio está pagado
         MÁS ALLÁ del corte. Con `>=` un cliente que vence justo el día del corte
         se consideraba cubierto y no recibía ninguno de sus dos avisos, que es
         exactamente a quien hay que avisar. */
      const cubiertoHastaCorte = !!proximoCorte && !!cliente.fechaVencimiento &&
        String(cliente.fechaVencimiento) > proximoCorte;

      /* Trazabilidad por corte: `recordatoriosCiclo` guarda, para ESTE corte, qué
         avisos ya salieron. Al cambiar de corte se reinicia solo, porque la clave
         lleva la fecha; así el mes siguiente vuelven a salir los dos. */
      const memoCiclo = cliente.recordatoriosCiclo && String(cliente.recordatoriosCiclo.corte) === String(proximoCorte)
        ? cliente.recordatoriosCiclo
        : { corte: proximoCorte, enviados: [] };
      const enviadosEsteCorte = Array.isArray(memoCiclo.enviados) ? memoCiclo.enviados : [];

      /* Si el cliente ya pagó el período que viene, no se le molesta: se mira el
         estado real de los pagos, no solo la fecha del servicio. */
      const pagoCubreCorte = proximoCorte ? await pagoConfirmadoCubreCorte(cliente.id, proximoCorte) : false;

      const decision = proximoCorte
        ? decidirRecordatorios({
            corteISO: proximoCorte,
            ciclo: cicloCliente,
            hoy: hoyRecordatorio,
            yaEnviados: enviadosEsteCorte,
            pagoConfirmado: cubiertoHastaCorte || pagoCubreCorte
          })
        : [];
      resumen.omitidosPorPago = (resumen.omitidosPorPago || 0) + decision.filter((d) => d.motivo === "pago confirmado del período").length;

      const opcionesMensaje = {
        cuentas: ctxMensajes.cuentas,
        soporte: ctxMensajes.soporte,
        valor: cliente.precioMensual,
        fechaLimite: proximoCorte
      };

      /* 4.a) Ejecuta la decisión de recordatorios.js. Cada aviso que toca hoy se
         registra con su clave anti-duplicados, se intenta entregar y se anota el
         resultado real (Estado ENVIADA si llegó, ERROR → «Fallido» si no). Los dos
         avisos comparten el período del corte, así que la clave de la colección
         `notificaciones` no puede repetirse aunque el motor corra dos veces. */
      for (const paso of decision) {
        if (paso.accion !== "enviar") continue;
        const { recordatorio } = paso;
        const esDiaDelCorte = recordatorio.clave === "corte";
        const periodoAviso = `corte-${cicloCliente}-${proximoCorte}`;
        const titulo = esDiaDelCorte ? "Tu factura está vencida" : "Tu factura está disponible";
        const cuerpo = esDiaDelCorte
          ? construirMensajePostCorte(cliente, { ...opcionesMensaje, plantilla: ctxMensajes.plantillaDespues })
          : construirMensajePrevioCorte(cliente, { ...opcionesMensaje, plantilla: ctxMensajes.plantillaAntes });

        const nueva = await registrarNotificacion(cliente.id, recordatorio.tipo, titulo, cuerpo, periodoAviso);
        if (!nueva) continue; // ya existía (otra corrida la creó): no se duplica

        const entrega = await enviarPush(
          cliente.id, titulo,
          esDiaDelCorte ? "Tu servicio será suspendido." : `Tu factura vence el ${proximoCorte}.`
        );
        await marcarEntregaPush(nueva, entrega);
        resumen.notificaciones++;
        resumen.avisosCorte++;

        const enviados = [...new Set([...enviadosEsteCorte, recordatorio.clave])];
        await clienteRef.update({
          recordatoriosCiclo: { corte: proximoCorte, enviados, actualizadoEn: FieldValue.serverTimestamp() },
          fechaUltimaNotificacion: FieldValue.serverTimestamp(),
          tipoUltimaNotificacion: esDiaDelCorte ? "despuesCorte" : "antesCorte",
          cicloActualNotificacion: String(proximoCorte).slice(0, 7)
        });
        enviadosEsteCorte.length = 0;
        enviadosEsteCorte.push(...enviados);
      }

      /* 5) Fila heredada de días después del vencimiento. KZ-UNEF-028: para los
         clientes con ciclo de corte NO se usa, porque la regla del propietario
         fija exactamente dos avisos por vencimiento y este bloque añadiría un
         tercero. Se conserva solo para servicios sin ciclo (no los hay hoy:
         `cicloValido` siempre deduce uno), de modo que el comportamiento queda
         explícito y no una rama muerta silenciosa. */
      for (const n of (cicloCliente ? [] : diasDespues)) {
        if (dias !== n) continue;

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
          const entrega = await enviarPush(cliente.id, "Aviso UneFibra", n === 0 ? "Hoy vence tu servicio." : "Tienes un pago pendiente.");
          await marcarEntregaPush(nueva, entrega);
          resumen.notificaciones++;
        }
      }

      // 6) Si venció: busca si hay un pago CONFIRMADO que cubra el periodo. Así no
      //    se marca como moroso (y, más abajo, tampoco se suspende) a quien ya
      //    pagó o renovó por adelantado.
      let pagoCubre = { empty: true };
      if (dias < 0) {
        pagoCubre = await db.collection("pagos")
          .where("clienteId", "==", cliente.id)
          .where("estado", "==", ESTADO_PAGO.CONFIRMADO)
          .where("periodoFin", ">=", hoyISO())
          .limit(1)
          .get();
      }

      // Si venció y NO hay pago que cubra el periodo → PENDIENTE_PAGO
      if (dias < 0 && pagoCubre.empty && cliente.estadoCliente !== ESTADO_CLIENTE.PENDIENTE_PAGO && cliente.estadoCliente !== ESTADO_CLIENTE.SUSPENDIDO) {
        await clienteRef.update({
          estadoCliente: ESTADO_CLIENTE.PENDIENTE_PAGO,
          updatedAt: FieldValue.serverTimestamp()
        });
        await registrarHistorial(cliente.id, cliente.estadoCliente, ESTADO_CLIENTE.PENDIENTE_PAGO, "Vencimiento del periodo", "sistema", "Motor de vencimientos");
        await auditar("sistema", "Motor de vencimientos", "VENCER_SERVICIO", "clientes", cliente.id, { estadoCliente: cliente.estadoCliente }, { estadoCliente: ESTADO_CLIENTE.PENDIENTE_PAGO });
        resumen.pendientes++;
      }

      // 7) Suspensión por mora prolongada (3 días naturales). NUNCA se suspende a
      //    quien tiene un pago CONFIRMADO que cubre el periodo.
      if (dias <= -diasSuspension && pagoCubre.empty && cliente.estadoCliente !== ESTADO_CLIENTE.SUSPENDIDO && cliente.estadoCliente !== ESTADO_CLIENTE.INACTIVO) {
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
    } catch (err) {
      console.error("Motor de vencimientos falló:", err);
      try {
        await enviarAlertaError("motor de vencimientos (processDueDates/ejecutarMotor)", err);
      } catch (emailErr) {
        console.error("No se pudo enviar la alerta por email:", emailErr);
      }
      throw err;
    }
}

/* Cron diario (10:00 Bogotá). v1: pubsub.schedule + timeZone. */
exports.processDueDates = functions
  .runWith({ secrets: ["SENDGRID_API_KEY"], timeoutSeconds: 540, memory: "512MB" })
  .pubsub
  .schedule("0 10 * * *") // 10:00 diario, hora de Bogotá (antes 08:00)
  .timeZone("America/Bogota")
  .onRun(() => ejecutarMotorVencimientos());

/* Disparo manual (solo SUPERADMIN) para operación y pruebas controladas.
   KZ-UNEF-028 · `data.hoy` permite simular la fecha de los recordatorios, pero
   SOLO en el emulador: en producción se ignora con un error explícito, para que
   nadie pueda forzar avisos con una fecha inventada. */
exports.ejecutarMotor = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["SUPERADMIN"]);
  let hoySimulado = null;
  if (data && data.hoy) {
    const proyectoActual = (functions.app || {}).options && functions.app.options.projectId;
    const esEmulador = !!process.env.FIRESTORE_EMULATOR_HOST
      || String(proyectoActual || "").startsWith("demo-")
      || process.env.FUNCTIONS_EMULATOR === "true";
    if (!esEmulador) {
      throw new functions.https.HttpsError("failed-precondition",
        "La simulación de fecha solo está disponible en el emulador. En producción se usa la fecha real de Colombia.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.hoy))) {
      throw new functions.https.HttpsError("invalid-argument", "Fecha de simulación inválida (usa YYYY-MM-DD).");
    }
    hoySimulado = String(data.hoy);
  }
  return ejecutarMotorVencimientos(hoySimulado ? { hoy: hoySimulado } : {});
});

/* ============================================================
 * MÓDULO: BACKUP DIARIO (función programada) — KZ-UNEF-028
 * ------------------------------------------------------------
 * HISTORIA DEL FALLO: la exportación pedía la base ENTERA en una operación. Con
 * 332 servicios tardaba 536,8 s y la función gen 1 (máximo 540 s) moría sin poder
 * verificar el respaldo ni liberar el cerrojo. Subir `timeoutSeconds` no es
 * posible: 540 s es el techo de gen 1.
 *
 * SOLUCIÓN: exportar POR COLECCIONES con presupuesto de tiempo y reanudación
 * (src/backup-lotes.js). Cada invocación hace lo que cabe en ~7 de los 9 minutos,
 * guarda el progreso y, si no termina, la corrida sigue en la siguiente
 * invocación. El respaldo solo se declara COMPLETADO cuando TODAS las colecciones
 * raíz están verificadas en el bucket.
 *
 * Se añade `continuarBackup` (cada 30 min): si la corrida del día quedó a medias,
 * la termina. Si ya está completa no hace nada y no cuesta lecturas.
 * ============================================================ */
function backupPorLotes(deps = {}) {
  const { listarObjetosDelBucket, lockPorDefecto } = require("./backup");
  const { crearBackupPorLotes } = require("./backup-lotes");
  const db = getFirestore();
  return crearBackupPorLotes({
    proyectoId: PROJECT_ID_BACKUP,
    bucket: BUCKET_BACKUP,
    listarColecciones: async () => (await db.listCollections()).map((c) => c.id),
    listarObjetos: (prefijo) => listarObjetosDelBucket(prefijo),
    estado: {
      leer: async (corrida) => {
        const snap = await db.collection("backups").doc(corrida).get();
        return snap.exists ? snap.data() : null;
      },
      guardar: async (corrida, datos) => {
        await db.collection("backups").doc(corrida).set(datos, { merge: false });
      }
    },
    lock: deps.lock || lockPorDefecto,
    ...deps
  });
}

/* Presupuesto por invocación: 7 min de los 9 que permite gen 1 (540 s), para que
   siempre quede margen para verificar y cerrar la corrida. */
const PRESUPUESTO_BACKUP_MS = 420000;

async function correrBackup({ motivo }) {
  const inicio = Date.now();
  const resultado = await backupPorLotes().ejecutar({ presupuestoMs: PRESUPUESTO_BACKUP_MS });
  const ms = Date.now() - inicio;
  console.log("Backup de Firestore (" + motivo + "):", {
    estado: resultado.estado,
    corrida: resultado.corrida,
    colecciones: resultado.completadas + "/" + resultado.total,
    objetos: resultado.objetos || 0,
    pendientes: resultado.pendientes || 0,
    loteMasLento: resultado.masLento ? resultado.masLento.ms + " ms" : null,
    motivo: resultado.motivo || null,
    ms
  });

  /* Se avisa SOLO de lo que dejó el respaldo sin hacer: un fallo definitivo o una
     corrida que sigue incompleta al final del día. Una corrida PARCIAL dentro del
     día es normal y no merece alarma. */
  if (resultado.requiereAlerta) {
    const err = new Error("Respaldo no completado (" + resultado.estado + "): " + (resultado.motivo || JSON.stringify(resultado.fallidos || [])));
    err.resultado = resultado;
    try {
      await enviarAlertaError("backupFirestore (" + motivo + ")", err);
      console.log("Alerta de respaldo enviada.");
    } catch (emailErr) {
      console.error("No se pudo enviar la alerta por email:", emailErr);
    }
    throw err;
  }
  return resultado;
}

exports.backupFirestore = functions
  .runWith({ secrets: ["SENDGRID_API_KEY"], timeoutSeconds: 540 })
  .pubsub
  .schedule("0 3 * * *") // 03:00 diario, hora de Bogotá
  .timeZone("America/Bogota")
  .onRun(() => correrBackup({ motivo: "corrida diaria" }));

/* Continúa una corrida incompleta. Cada 30 minutos; si no hay nada pendiente
   termina en milisegundos. */
exports.continuarBackup = functions
  .runWith({ secrets: ["SENDGRID_API_KEY"], timeoutSeconds: 540 })
  .pubsub
  .schedule("*/30 * * * *")
  .timeZone("America/Bogota")
  .onRun(async () => {
    const db = getFirestore();
    const hoy = hoyISO();
    const snap = await db.collection("backups").doc(hoy).get();
    const datos = snap.exists ? snap.data() : null;
    const lotes = datos && datos.lotes ? Object.values(datos.lotes) : [];
    const pendientes = lotes.filter((l) => l.estado !== "COMPLETADO").length;
    if (!lotes.length || pendientes === 0) {
      console.log("Continuación de respaldo: nada pendiente para " + hoy + ".");
      return { estado: "NADA_PENDIENTE", corrida: hoy };
    }
    console.log("Continuación de respaldo: " + pendientes + " lote(s) pendientes de " + lotes.length + ".");
    return correrBackup({ motivo: "continuación " + hoy });
  });

/* ============================================================
 * MÓDULO: CLIENTES (callable)
 * ============================================================ */
exports.crearCliente = functions.https.onCall(async (data, context) => {
  const usuarioAlta = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { nombreCompleto, documento, telefono, planId, precioMensual } = data || {};
  if (!nombreCompleto || !telefono) {
    throw new functions.https.HttpsError("invalid-argument", "Nombre y teléfono son obligatorios.");
  }

  // Datos de dirección (tarea 3). La obligatoriedad se lee de `configuracion`,
  // para poder relajarla desde el panel sin desplegar. Se valida aquí y no solo
  // en el formulario porque el servidor es quien manda: el frontend se puede
  // saltar, esta comprobación no.
  const cfgDireccion = await db.collection("configuracion").doc("camposDireccionObligatorios").get();
  const exigirDireccion = cfgDireccion.exists ? cfgDireccion.data().valor === true : false;

  if (exigirDireccion) {
    const tipo = String(data.tipoVivienda || "");
    const faltantes = [];
    if (!data.direccion) faltantes.push("dirección");
    if (!data.barrio) faltantes.push("sector o barrio");
    if (!tipo) faltantes.push("tipo de vivienda");
    // Torre y apartamento solo existen en edificios o unidades residenciales.
    if (tipo === "edificio" || tipo === "unidad") {
      if (!data.edificioUnidad) faltantes.push("edificio o unidad residencial");
      if (!data.torre) faltantes.push("torre");
      if (!data.apartamento) faltantes.push("apartamento");
    }
    if (faltantes.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Faltan datos de dirección obligatorios: " + faltantes.join(", ") + "."
      );
    }
  }

  // Evitar duplicados por documento (si se proporciona)
  if (documento) {
    const dup = await db.collection("clientes").where("documento", "==", documento).limit(1).get();
    if (!dup.empty) throw new functions.https.HttpsError("already-exists", "Ya existe un cliente con ese documento.");
  }

  const plan = await obtenerPlan(planId);
  const fechaInicio = data.fechaInicioServicio || hoyISO();
  const fechaVencimiento = sumarDias(fechaInicio, plan.duracion);

  // Ciclo de corte (día 15 o día 30): manda el que envíe el panel; si no llega,
  // se deduce del vencimiento. `proximoCorte` es la fecha de cobro vigente.
  const cicloCorte = cicloValido(data.cicloCorte, fechaVencimiento);
  const proximoCorte = cicloCorte ? proximoCorteDe(cicloCorte) : null;

  const cliente = {
    nombreCompleto,
    documento: documento || null,
    telefono,
    whatsapp: data.whatsapp || telefono,
    whatsappOptIn: true, // el cliente dio su número: opt-in implícito para recordatorios
    email: data.email || null,
    direccion: data.direccion || null,
    barrio: data.barrio || null,
    ciudad: data.ciudad || "Medellín",
    // Datos de dirección (tarea 3). En casa, edificio/torre/apartamento quedan
    // en null: no se inventan valores.
    tipoVivienda: data.tipoVivienda || null,
    edificioUnidad: data.edificioUnidad || null,
    torre: data.torre || null,
    apartamento: data.apartamento || null,
    planId: plan.id,
    planNombre: plan.nombre,
    precioMensual: precioMensual || plan.precio,
    fechaInstalacion: data.fechaInstalacion || null,
    fechaInicioServicio: fechaInicio,
    fechaVencimiento,
    cicloCorte,
    proximoCorte,
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

  const nombreActorAlta = usuarioAlta.nombre || context.auth.uid;
  await registrarHistorial(clienteRef.id, null, ESTADO_CLIENTE.ACTIVO, "Alta de cliente", context.auth.uid, nombreActorAlta);
  await auditar(context.auth.uid, nombreActorAlta, "CREAR_CLIENTE", "clientes", clienteRef.id, null, cliente);

  return { id: clienteRef.id, fechaVencimiento, cicloCorte, proximoCorte };
});

/**
 * Migración de ciclos de corte (solo SUPERADMIN).
 * Asigna `cicloCorte` a los clientes que no lo tengan, deduciéndolo de su
 * fecha de vencimiento, y calcula el próximo corte. Respeta el ciclo que ya
 * esté asignado. Es idempotente: se puede ejecutar cuantas veces haga falta.
 *
 * No es obligatorio ejecutarla, porque el motor diario hace el mismo trabajo;
 * sirve para no tener que esperar a la madrugada justo después de desplegar.
 */
exports.migrarCiclosCorte = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["SUPERADMIN"]);

  const snap = await db.collection("clientes").get();
  let actualizados = 0;
  const detalle = [];

  for (const doc of snap.docs) {
    const c = doc.data();
    const ciclo = cicloValido(c.cicloCorte, c.fechaVencimiento);
    if (!ciclo) continue;
    const proximo = proximoCorteDe(ciclo);

    if (c.cicloCorte === ciclo && c.proximoCorte === proximo) continue;

    await doc.ref.update({
      cicloCorte: ciclo,
      proximoCorte: proximo,
      updatedAt: FieldValue.serverTimestamp()
    });
    actualizados++;
    detalle.push({ clienteId: doc.id, antes: c.cicloCorte || null, ahora: ciclo });
  }

  await auditar(
    context.auth.uid, data && data.usuarioNombre,
    "MIGRAR_CICLOS_CORTE", "clientes", null,
    null, { revisados: snap.size, actualizados }
  );

  return { revisados: snap.size, actualizados, detalle };
});

/* ============================================================
 * MÓDULO: EDICIÓN Y ELIMINACIÓN DE CLIENTES (callables)
 * ------------------------------------------------------------
 * El panel NO escribe directo a Firestore: editar o borrar un cliente pasa
 * por aquí. Motivos:
 *  - queda auditoría (quién, qué cambió, antes y después);
 *  - no se pueden tocar desde el navegador los campos que calcula el sistema
 *    (saldos, estados, fechas de vencimiento, historial);
 *  - borrar arrastra los documentos relacionados de forma controlada.
 *
 * El nombre del usuario SIEMPRE se toma de `usuarios/{uid}` (lo devuelve
 * verificarRol), nunca del payload: si el panel lo manda, se ignora, porque
 * un cliente HTTP podría falsificarlo y ensuciar la auditoría.
 * ============================================================ */

/** Únicos campos que el panel puede editar. Cualquier otro se ignora. */
const CAMPOS_EDITABLES_CLIENTE = [
  "nombreCompleto", "documento", "telefono", "whatsapp", "whatsappOptIn", "email",
  "direccion", "barrio", "ciudad", "tipoVivienda", "edificioUnidad", "torre", "apartamento",
  "planId", "planNombre", "precioMensual", "cicloCorte", "metodoPagoPreferido", "observaciones"
];

/** Campos que el formulario manda como texto pero se guardan como número. */
const CAMPOS_NUMERICOS_CLIENTE = ["precioMensual"];

/** Campos que se guardan como booleano. */
const CAMPOS_BOOLEANOS_CLIENTE = ["whatsappOptIn"];

/**
 * Actualiza los datos editables de un cliente (ADMIN o SUPERADMIN).
 *
 * Decisiones:
 *  - NO se exige `camposDireccionObligatorios` como sí hace crearCliente: este
 *    panel existe justamente para COMPLETAR datos que faltan (los 353 clientes
 *    importados llegaron sin barrio). Si se exigiera, editar cualquier cosa
 *    obligaría a rellenar el barrio primero, y no se podrían corregir errores.
 *  - Si cambia el ciclo de corte, se recalcula `proximoCorte` con la regla
 *    vigente (ciclo 15 -> corte el día 15; ciclo 30 -> corte el día 30, y el
 *    último día real del mes cuando no llega a 30).
 */
exports.actualizarCliente = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const clienteId = data && data.clienteId;
  if (!clienteId) throw new functions.https.HttpsError("invalid-argument", "Se requiere clienteId.");

  const ref = db.collection("clientes").doc(clienteId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "El cliente no existe.");
  const antes = snap.data();

  const cambios = {};
  const ignorados = [];
  for (const [k, v] of Object.entries((data && data.campos) || {})) {
    if (!CAMPOS_EDITABLES_CLIENTE.includes(k)) { ignorados.push(k); continue; }

    let valor = v;
    if (CAMPOS_NUMERICOS_CLIENTE.includes(k)) {
      if (valor === null || valor === undefined || String(valor).trim() === "") {
        valor = null;
      } else {
        /* KZ-UNEF-001 · Se valida el TEXTO, no lo que queda después de
           limpiarlo. Antes "abc" se convertía en "" y `Number("")` es 0 —
           pasaba la comprobación y guardaba precioMensual: 0 en silencio, así
           que los cobros salían sin importe. Tampoco se aceptan negativos. */
        const texto = String(valor).trim().replace(/,/g, "");
        if (!/^\d+$/.test(texto)) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "El campo " + k + " debe ser un número entero de pesos (sin letras ni símbolos)."
          );
        }
        valor = Number(texto);
        if (!Number.isSafeInteger(valor) || valor <= 0) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "El campo " + k + " debe ser mayor que cero."
          );
        }
      }
    } else if (CAMPOS_BOOLEANOS_CLIENTE.includes(k)) {
      valor = valor === true || valor === "true";
    } else if (typeof valor === "string") {
      valor = valor.trim();
      if (valor === "") valor = null;
    }
    if (valor === undefined) valor = null;

    const actual = antes[k] === undefined ? null : antes[k];
    if (actual !== valor) cambios[k] = valor;
  }

  if ("cicloCorte" in cambios && cambios.cicloCorte !== null && !cicloValido(cambios.cicloCorte, null)) {
    throw new functions.https.HttpsError("invalid-argument", "El ciclo de corte solo puede ser \"15\" o \"30\".");
  }

  if (!Object.keys(cambios).length) {
    return { clienteId, cambios: [], ignorados, mensaje: "No hay cambios que guardar." };
  }

  // Si movieron al cliente de tanda, su próximo corte cambia con la regla nueva.
  if (cambios.cicloCorte !== undefined && cambios.cicloCorte !== null) {
    const proximo = proximoCorteDe(cambios.cicloCorte);
    if (antes.proximoCorte !== proximo) cambios.proximoCorte = proximo;
  }

  cambios.updatedAt = FieldValue.serverTimestamp();
  await ref.update(cambios);

  const antesMap = {}, despuesMap = {};
  for (const k of Object.keys(cambios)) {
    if (k === "updatedAt") continue;
    antesMap[k] = antes[k] === undefined ? null : antes[k];
    despuesMap[k] = cambios[k];
  }
  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "ACTUALIZAR_CLIENTE", "clientes", clienteId, antesMap, despuesMap);

  return { clienteId, cambios: Object.keys(despuesMap), ignorados };
});

/**
 * Elimina un cliente (ADMIN o SUPERADMIN).
 *
 * Qué borra y qué NO:
 *  - Borra el documento de `clientes` y sus `servicios` asociados (si no, el
 *    panel mostraría servicios huérfanos de un cliente que ya no existe).
 *  - NO borra `pagos` ni `notificaciones`: son registros financieros y de
 *    comunicaciones, y deben sobrevivir al cliente. Se cuentan y se dejan
 *    constancia de ellos en la auditoría.
 *  - Guarda el documento COMPLETO del cliente en la entrada de auditoría
 *    (`datosAnteriores`) para poder restaurarlo.
 *
 * Si se quiere archivar en vez de borrar de verdad, usar
 * `clientes_hoja3_4_backup` como referencia del patrón.
 */
exports.eliminarCliente = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const clienteId = data && data.clienteId;
  if (!clienteId) throw new functions.https.HttpsError("invalid-argument", "Se requiere clienteId.");

  const ref = db.collection("clientes").doc(clienteId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "El cliente no existe.");
  const cliente = snap.data();

  const servicios = await db.collection("servicios").where("clienteId", "==", clienteId).get();
  const pagos = await db.collection("pagos").where("clienteId", "==", clienteId).get();

  for (const s of servicios.docs) await s.ref.delete();
  await ref.delete();

  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "ELIMINAR_CLIENTE", "clientes", clienteId, cliente,
    { serviciosEliminados: servicios.size, pagosConservados: pagos.size, motivo: (data && data.motivo) || null });

  return { clienteId, eliminado: true, serviciosEliminados: servicios.size, pagosConservados: pagos.size };
});

/**
 * Devuelve el mensaje de cobro de un cliente, ya rellenado con los datos de la
 * empresa (cuenta bancaria principal, WhatsApp de soporte y montos).
 *
 * Lo usa el botón "Cobrar por WhatsApp" de las listas de corte. Se construye
 * aquí y no en el panel a propósito: así el mensaje que envía el operador es
 * EXACTAMENTE el mismo que manda el motor automático, y la plantilla se escribe
 * una sola vez. Además el panel no necesita tener la cuenta bancaria en memoria.
 *
 * @param {string} clienteId
 * @param {"antesCorte"|"despuesCorte"} tipo  por defecto "antesCorte"
 */
exports.mensajeCobro = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["OPERADOR", "ADMIN", "SUPERADMIN"]);

  const { clienteId, tipo } = data || {};
  if (!clienteId) {
    throw new functions.https.HttpsError("invalid-argument", "clienteId es obligatorio.");
  }

  const clienteSnap = await db.collection("clientes").doc(clienteId).get();
  if (!clienteSnap.exists) {
    throw new functions.https.HttpsError("not-found", "El cliente no existe.");
  }

  const cliente = { id: clienteSnap.id, ...clienteSnap.data() };
  const ctx = await cargarContextoMensajes();

  const proximoCorte = cliente.proximoCorte ||
    (cliente.cicloCorte ? proximoCorteDe(cliente.cicloCorte) : null);

  // Si el panel no dice qué plantilla usar, se elige sola: el día del corte (y
  // después, mientras el corte siga vigente) corresponde el mensaje de factura
  // vencida; antes, el de factura disponible.
  const esVencida = tipo
    ? tipo === "despuesCorte"
    : (!!proximoCorte && diasHasta(proximoCorte) <= 0);

  const opciones = {
    cuentas: ctx.cuentas,
    soporte: ctx.soporte,
    plantilla: esVencida ? ctx.plantillaDespues : ctx.plantillaAntes,
    valor: cliente.precioMensual,
    fechaLimite: proximoCorte
  };

  return {
    texto: esVencida
      ? construirMensajePostCorte(cliente, opciones)
      : construirMensajePrevioCorte(cliente, opciones),
    tipo: esVencida ? "despuesCorte" : "antesCorte",
    cicloCorte: cliente.cicloCorte || null,
    proximoCorte,
    cuentaUsada: (function () {
      const principal = ctx.cuentas.filter((c) => c && c.activo !== false)
        .find((c) => c.principal === true);
      if (!principal) return null;
      return {
        banco: principal.banco || principal.nombre || null,
        numeroCuenta: principal.numeroCuenta || null,
        titular: principal.titular || null,
        confirmada: principal.confirmada !== false
      };
    })()
  };
});

/* ============================================================
 * MÓDULO: PAGOS (callable)
 * ------------------------------------------------------------
 * registrarPago  → crea el pago en estado PENDIENTE.
 * confirmarPago  → confirma y renueva el servicio en transacción
 *                  (evita extensiones/cobros duplicados).
 * ============================================================ */
exports.registrarPago = functions.https.onCall(async (data, context) => {
  const usuarioPago = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { clienteId, servicioId, monto, metodoPago, referencia, comprobanteUrl } = data || {};
  // ── Validación del importe y del cliente (harness/unef-010) ──────────
    // Antes: `if (!clienteId || !monto)` aceptaba negativos, textos e
    // Infinity. Ahora el monto tiene que ser un número finito y positivo, en
    // pesos enteros (el esquema guarda COP sin decimales), y el cliente tiene
    // que existir de verdad antes de crear el pago.
    if (typeof clienteId !== "string" || clienteId.trim() === "") {
      throw new functions.https.HttpsError("invalid-argument", "clienteId es obligatorio.");
    }
    /* KZ-UNEF-001 · El monto tiene que ser un NÚMERO de verdad.
       Antes solo se rechazaba el texto: `Number(true)` es 1 y `Number([99900])`
       es 99900, así que un booleano o un array pasaban la validación y se
       guardaban TAL CUAL en el libro de pagos. Ahora la comprobación está en
       ./pagos-guardas.js y se persiste el número validado, no el original. */
    if (typeof monto !== "number") {
      throw new functions.https.HttpsError("invalid-argument", "El monto debe ser un número (no texto, ni booleano, ni lista).");
    }
    const guardaMonto = validarMonto(monto);
    if (!guardaMonto.ok) {
      throw new functions.https.HttpsError(guardaMonto.codigo, guardaMonto.motivo);
    }
    const montoNum = guardaMonto.valor;
    const referenciaLimpia = typeof referencia === "string" && referencia.trim() !== "" ? referencia.trim() : null;
    const fechaPagoPedida = (data || {}).fechaPago;
    if (fechaPagoPedida != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(fechaPagoPedida))) {
      throw new functions.https.HttpsError("invalid-argument", "fechaPago debe tener formato AAAA-MM-DD.");
    }
    const clienteSnap = await db.collection("clientes").doc(clienteId).get();
    if (!clienteSnap.exists) {
      throw new functions.https.HttpsError("not-found", "El cliente no existe.");
    }
    /* KZ-UNEF-001 · Un mismo comprobante no puede registrarse dos veces.
       Sin esta guarda, un reintento del panel (o dos operadores a la vez)
       creaba dos pagos del MISMO dinero y al confirmar los dos el servicio se
       extendía dos veces. Se comprueba la referencia contra los pagos que
       siguen vigentes (un anulado no bloquea volver a registrarlo). */
    if (referenciaLimpia) {
      const repetido = await db.collection("pagos")
        .where("clienteId", "==", clienteId)
        .where("referencia", "==", referenciaLimpia)
        .where("estado", "in", [ESTADO_PAGO.PENDIENTE, ESTADO_PAGO.CONFIRMADO])
        .limit(1)
        .get();
      if (!repetido.empty) {
        throw new functions.https.HttpsError(
          "already-exists",
          "Ya existe un pago con esa referencia para este cliente. Revisa el registro antes de crearlo otra vez."
        );
      }
    }

  const pago = {
    clienteId,
    servicioId: servicioId || null,
    monto: montoNum,
    metodoPago: metodoPago || "Otro",
    fechaPago: fechaPagoPedida || hoyISO(),
    periodoInicio: null,
    periodoFin: null,
    referencia: referenciaLimpia,
    comprobanteUrl: comprobanteUrl || null,
    estado: ESTADO_PAGO.PENDIENTE,
    registradoPor: context.auth.uid,
    createdAt: FieldValue.serverTimestamp()
  };

  const ref = await db.collection("pagos").add(pago);
  await auditar(context.auth.uid, usuarioPago.nombre || context.auth.uid, "REGISTRAR_PAGO", "pagos", ref.id, null, pago);
  return { id: ref.id, estado: ESTADO_PAGO.PENDIENTE };
});

exports.confirmarPago = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { pagoId } = data || {};
  if (!pagoId) throw new functions.https.HttpsError("invalid-argument", "Se requiere pagoId.");

  const pagoRef = db.collection("pagos").doc(pagoId);
  let estadoPrevioCliente = null;

  // Transacción: renovación atómica sin duplicados.
  await db.runTransaction(async (t) => {
    const pagoSnap = await t.get(pagoRef);
      // ── Estado previo verificado DENTRO de la transacción (harness/unef-010)
      // Sin esto, dos confirmaciones simultáneas (o un reintento del cliente)
      // renovaban dos veces al mismo cliente, y un pago anulado podía
      // confirmarse y reactivar un servicio dado de baja.
      if (!pagoSnap.exists) {
        throw new functions.https.HttpsError("not-found", "El pago no existe.");
      }
      const estadoPrevio = pagoSnap.data().estado;
      if (estadoPrevio === "ANULADO") {
        throw new functions.https.HttpsError("failed-precondition", "El pago está anulado: no se puede confirmar.");
      }
      if (estadoPrevio === "CONFIRMADO") {
        throw new functions.https.HttpsError("failed-precondition", "El pago ya está confirmado: no se renueva dos veces.");
      }
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
    /* KZ-UNEF-001 · El periodo arranca en el vencimiento SOLO si no ha pasado.
       Antes se usaba `cliente.fechaVencimiento || hoyISO()`: un cliente vencido
       desde mayo que pagaba en octubre recibía un periodo que terminaba en
       junio, se le marcaba ACTIVO y el motor lo volvía a suspender tres días
       después. El cálculo vive en ./renovacion.js y tiene pruebas propias. */
    const { periodoInicio, periodoFin } = calcularPeriodo({
      vencimiento: cliente.fechaVencimiento,
      duracion: plan.duracion
    });

    /* KZ-UNEF-029 · HALLAZGO REPORTADO, NO APLICADO.
       Renovar sumando 30 días fijos saca la fecha de su día de corte en los meses
       de 31 días (15-dic + 30 = 14-ene) y de ahí ya no vuelve sola: tras 6
       renovaciones la simulación acababa en 2027-05-14 y 2027-05-29, fuera del
       ciclo. La corrección está escrita y probada (vencimientos.renovarPorCiclo,
       test/renovacion-ciclo.test.js 11/11) pero NO se activa aquí: cambiar el
       período que se le cobra a un cliente es una decisión comercial del
       propietario, y la certificación KZ-UNEF-002 fija hoy «hoy + 30 días».
       Para activarla: sustituir las tres asignaciones `periodoFin` por
       `periodoCobrado.*` (el período pasa a terminar el día anterior al corte y el
       vencimiento vuelve a caer en el día del ciclo). */
    const periodoCobrado = { inicio: periodoInicio, fin: periodoFin, vencimiento: periodoFin };

    // Actualizar pago. `fechaPago` NO se reescribe: es la fecha en que el
    // cliente pagó, no la fecha en que un operador hizo clic en confirmar.
    t.update(pagoRef, {
      estado: ESTADO_PAGO.CONFIRMADO,
      periodoInicio: periodoCobrado.inicio,
      periodoFin: periodoCobrado.fin
    });

    // Renovar servicio del cliente
    const servicios = await db.collection("servicios")
      .where("clienteId", "==", pago.clienteId)
      .where("estado", "in", [ESTADO_SERVICIO.ACTIVO, ESTADO_SERVICIO.POR_VENCER, ESTADO_SERVICIO.SUSPENDIDO])
      .limit(1)
      .get();

    if (!servicios.empty) {
      /* KZ-UNEF-006 · Si el servicio está en conciliación, un pago NO renueva:
         no se toca la fecha de vencimiento heredada ni se reactiva el servicio
         hasta que un administrador valide los datos. El lanzamiento revierte la
         transacción completa (pago incluido), así que no queda estado a medias. */
      const guardaRenovacion = guardias.puedeRenovar({
        conciliacion: servicios.docs[0].data().conciliacion
      });
      if (!guardaRenovacion.permitido) {
        throw new functions.https.HttpsError("failed-precondition", guardaRenovacion.motivo);
      }
      t.update(servicios.docs[0].ref, {
        fechaInicio: periodoCobrado.inicio,
        fechaVencimiento: periodoCobrado.vencimiento,
        estado: ESTADO_SERVICIO.ACTIVO,
        fechaActivacion: hoyISO(),
        fechaSuspension: null,
        motivoSuspension: null
      });
    }

    // Cliente de nuevo ACTIVO
    /* KZ-UNEF-001 · `fechaInicioServicio` es la fecha de ALTA del cliente y
       ordena la numeración "#" del listado (el #1 es el más antiguo). Antes se
       reescribía en cada pago, así que el cliente cambiaba de número y la
       columna "Fecha de ingreso" mostraba el último ciclo facturado. Solo se
       rellena si venía vacía. */
    const cambiosCliente = {
      fechaVencimiento: periodoCobrado.vencimiento,
      estadoCliente: ESTADO_CLIENTE.ACTIVO,
      estadoServicio: ESTADO_SERVICIO.ACTIVO,
      updatedAt: FieldValue.serverTimestamp()
    };
    if (!cliente.fechaInicioServicio) cambiosCliente.fechaInicioServicio = periodoCobrado.inicio;
    estadoPrevioCliente = cliente.estadoCliente || null;
    t.update(clienteRef, cambiosCliente);

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
  const usuarioConfirmo = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const nombreActor = usuarioConfirmo.nombre || context.auth.uid;
  // El estado ANTERIOR que se registra es el del CLIENTE, no el del pago:
  // antes se guardaba "CONFIRMADO → ACTIVO", un estado que no existe en el
  // modelo del cliente y que ensuciaba su historial.
  await registrarHistorial(pagoFinal.clienteId, estadoPrevioCliente, ESTADO_CLIENTE.ACTIVO, "Pago recibido", context.auth.uid, nombreActor);
  await auditar(context.auth.uid, nombreActor, "CONFIRMAR_PAGO", "pagos", pagoId, { estado: ESTADO_PAGO.PENDIENTE }, { estado: ESTADO_PAGO.CONFIRMADO });

  return { id: pagoId, estado: ESTADO_PAGO.CONFIRMADO };
});

exports.anularPago = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { pagoId, motivo } = data || {};
  if (!pagoId) throw new functions.https.HttpsError("invalid-argument", "Se requiere pagoId.");

  const pagoRef = db.collection("pagos").doc(pagoId);

  /* KZ-UNEF-001 · La anulación va en TRANSACCIÓN.
     Antes se leía el estado con `pagoRef.get()` y se escribía después con
     `update()` a ciegas: entre la lectura y la escritura, `confirmarPago`
     podía confirmar y renovar en su propia transacción, y este `update`
     pisaba el CONFIRMADO sin error. Resultado: dinero cobrado y servicio
     extendido aparecían como "pago anulado".
     Las guardas viven en ./pagos-guardas.js (probadas sin emulador) para que
     la decisión sea la misma aquí y en las pruebas. */
  let anterior = null;
  await db.runTransaction(async (t) => {
    const snap = await t.get(pagoRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "El pago no existe.");

    anterior = snap.data().estado;
    const guarda = puedeAnular(anterior, motivo);
    if (!guarda.ok) {
      const mensajes = {
        "already-exists": "El pago ya fue anulado.",
        "failed-precondition": "Un pago confirmado ya renovó el servicio: no se anula desde aquí. Requiere un ajuste administrativo.",
        "invalid-argument": "Se requiere un motivo de anulación (mínimo 3 caracteres)."
      };
      throw new functions.https.HttpsError(guarda.codigo, mensajes[guarda.codigo] || "No se puede anular el pago.");
    }

    t.update(pagoRef, {
      estado: ESTADO_PAGO.ANULADO,
      motivoAnulacion: motivo.trim(),
      anuladoPor: context.auth.uid,
      anuladoEn: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "ANULAR_PAGO", "pagos", pagoId, { estado: anterior },
    { estado: ESTADO_PAGO.ANULADO, motivo: motivo.trim() });

  return { id: pagoId, estado: ESTADO_PAGO.ANULADO };
});

/* ============================================================
 * MÓDULO: ESTADOS DE SERVICIO (callable)
 * ============================================================ */
async function cambiarEstadoCliente(clienteId, estadoNuevo, estadoServicioNuevo, motivo, context, accion) {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  if (!clienteId) throw new functions.https.HttpsError("invalid-argument", "Se requiere clienteId.");

  const clienteRef = db.collection("clientes").doc(clienteId);
  const clienteSnap = await clienteRef.get();
  if (!clienteSnap.exists) throw new functions.https.HttpsError("not-found", "El cliente no existe.");
  const anterior = clienteSnap.data().estadoCliente;

  /* KZ-UNEF-001 · Idempotencia: si ya está en ese estado no se reescribe nada.
     Antes, pulsar "Suspender" dos veces metía dos filas idénticas en el
     historial y dos entradas de auditoría del mismo cambio. */
  if (anterior === estadoNuevo && (clienteSnap.data().estadoServicio || null) === estadoServicioNuevo) {
    return { clienteId, estado: estadoNuevo, sinCambios: true };
  }

  /* KZ-UNEF-001 · Cliente y servicio se escriben en el MISMO lote.
     Antes eran dos escrituras sueltas: si la segunda fallaba, el cliente
     quedaba SUSPENDIDO y el servicio ACTIVO, y el motor nunca lo corregía
     porque su guarda mira justamente `estadoCliente === SUSPENDIDO`.
     El historial y la auditoría van después y a propósito: si el lote falla,
     no debe quedar constancia de un cambio que no ocurrió. */
  const servicios = await db.collection("servicios")
    .where("clienteId", "==", clienteId)
    .get();

  /* KZ-UNEF-006 · Un servicio en conciliación no cambia de estado administrativo
     (ni se suspende ni se reactiva) hasta que se valide. Se comprueba sobre el
     dato guardado, así que funciona igual aunque existan credenciales MikroTik. */
  for (const s of servicios.docs) {
    const guarda = guardias.puedeCambiarEstado(s.data());
    if (!guarda.permitido) {
      throw new functions.https.HttpsError("failed-precondition", guarda.motivo);
    }
  }

  const lote = db.batch();
  lote.update(clienteRef, {
    estadoCliente: estadoNuevo,
    estadoServicio: estadoServicioNuevo,
    activo: estadoNuevo !== ESTADO_CLIENTE.INACTIVO,
    updatedAt: FieldValue.serverTimestamp()
  });
  // Se actualizan TODOS los servicios del cliente, no solo el primero: tener
  // dos dejaba uno de ellos desincronizado para siempre.
  for (const doc of servicios.docs) {
    lote.update(doc.ref, { estado: estadoServicioNuevo });
  }
  await lote.commit();

  const nombreActor = usuario.nombre || context.auth.uid;
  await registrarHistorial(clienteId, anterior, estadoNuevo, motivo, context.auth.uid, nombreActor);
  await auditar(context.auth.uid, nombreActor, accion, "clientes", clienteId, { estadoCliente: anterior }, { estadoCliente: estadoNuevo });
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
 * MÓDULO: CONCILIACIÓN DE SERVICIOS (KZ-UNEF-006)
 * ------------------------------------------------------------
 * Los servicios creados por la migración nacen en PENDIENTE_VALIDACION y quedan
 * fuera de toda automatización. Estas dos callables son la única forma de
 * sacarlos de ese estado, y lo hacen una persona con rol administrativo.
 *
 * Validar devuelve el servicio a la operación normal (reversible: se puede
 * volver a marcar como pendiente). Rechazar exige motivo y deja constancia.
 * ============================================================ */
exports.validarServicioConciliado = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const { servicioId, motivo } = data || {};
  if (!servicioId) throw new functions.https.HttpsError("invalid-argument", "Se requiere servicioId.");

  const ref = db.collection("servicios").doc(servicioId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "El servicio no existe.");
  /* Solo se valida (o se rechaza) lo que está EXACTAMENTE pendiente: repetir la
     acción sobre algo ya validado duplicaría auditoría e historial. */
  const estadoActual = (snap.data().conciliacion || {}).estado;
  if (estadoActual !== "PENDIENTE_VALIDACION") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `El servicio está en "${estadoActual}": solo se valida o rechaza lo que está PENDIENTE_VALIDACION.`
    );
  }

  const bloque = bloqueValidado({ por: usuario.nombre || context.auth.uid });
  await ref.update({ conciliacion: bloque, updatedAt: FieldValue.serverTimestamp() });
  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "VALIDAR_CONCILIACION", "servicios", servicioId, { estado: "PENDIENTE_VALIDACION" },
    { estado: "VALIDADA", motivo: motivo ? String(motivo).slice(0, 200) : null });
  return { servicioId, conciliacion: bloque.estado };
});

exports.rechazarServicioConciliado = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const { servicioId, motivo } = data || {};
  if (!servicioId) throw new functions.https.HttpsError("invalid-argument", "Se requiere servicioId.");

  const ref = db.collection("servicios").doc(servicioId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "El servicio no existe.");
  /* Solo se valida (o se rechaza) lo que está EXACTAMENTE pendiente: repetir la
     acción sobre algo ya validado duplicaría auditoría e historial. */
  const estadoActual = (snap.data().conciliacion || {}).estado;
  if (estadoActual !== "PENDIENTE_VALIDACION") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `El servicio está en "${estadoActual}": solo se valida o rechaza lo que está PENDIENTE_VALIDACION.`
    );
  }

  let bloque;
  try {
    bloque = bloqueRechazado({ por: usuario.nombre || context.auth.uid, motivo });
  } catch (e) {
    throw new functions.https.HttpsError("invalid-argument", e.message);
  }
  await ref.update({ conciliacion: bloque, updatedAt: FieldValue.serverTimestamp() });
  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "RECHAZAR_CONCILIACION", "servicios", servicioId, { estado: "PENDIENTE_VALIDACION" },
    { estado: "RECHAZADA", motivo: bloque.motivo });
  return { servicioId, conciliacion: bloque.estado };
});

/* ============================================================
 * MÓDULO: PANEL DE CONCILIACIÓN (KZ-UNEF-007)
 * ------------------------------------------------------------
 * Tres operaciones SEPARADAS, con permisos y auditoría propios:
 *
 *   1. PREPARAR  → crea el documento de servicio (nace PENDIENTE_VALIDACION)
 *   2. VALIDAR   → marca VALIDADA (revisado, todavía NO sujeto al motor)
 *   3. HABILITAR → marca HABILITADA (vuelve a la operación normal)
 *
 * «Validar» y «habilitar» son deliberadamente distintas: un registro puede
 * estar revisado y seguir sin estar sujeto a suspensiones automáticas.
 * ============================================================ */

/** 1 · PREPARAR: crea el servicio de UN cliente a partir de sus datos. No inventa nada. */
exports.prepararServicioConciliacion = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const { clienteId } = data || {};
  if (!clienteId) throw new functions.https.HttpsError("invalid-argument", "Se requiere clienteId.");

  const clienteSnap = await db.collection("clientes").doc(clienteId).get();
  if (!clienteSnap.exists) throw new functions.https.HttpsError("not-found", "El cliente no existe.");

  const existentes = await db.collection("servicios").where("clienteId", "==", clienteId).get();

  let doc;
  try {
    doc = construirServicio({ id: clienteSnap.id, ...clienteSnap.data() }, {
      serviciosExistentes: existentes.size
    });
  } catch (e) {
    throw new functions.https.HttpsError("failed-precondition", e.message);
  }

  const ref = db.collection("servicios").doc(doc.id);
  try {
    // `create` falla si ya existe: no se sobrescribe nada.
    await ref.create({ ...doc.datos, creadoPor: context.auth.uid, creadoPorNombre: usuario.nombre || null });
  } catch (e) {
    throw new functions.https.HttpsError("already-exists", "Ya existe un servicio para este cliente.");
  }

  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "PREPARAR_SERVICIO", "servicios", doc.id, null, {
      clienteId, planId: doc.datos.planId, estadoConciliacion: doc.datos.conciliacion.estado
    });
  return { servicioId: doc.id, conciliacion: doc.datos.conciliacion.estado };
});

/** 3 · HABILITAR: solo desde VALIDADA. Devuelve el servicio al motor. */
/**
 * Escribe la habilitación de un servicio con PRECONDICIÓN de estado (KZ-UNEF-029).
 *
 * El defecto que corrige: tanto «habilitar» como «habilitar en tanda» comprobaban
 * el estado FUERA de la escritura. Dos administradores que pulsaran a la vez leían
 * el mismo estado, y las dos escrituras y auditorías pasaban (la batería de
 * KZ-UNEF-008 lo detectaba: «solo una habilitación prospera», 200 / 200).
 * La transacción RELEE el documento y exige que siga sin habilitar: la segunda
 * llamada encuentra «HABILITADA» y se rechaza con un motivo claro.
 */
async function escribirHabilitacion(servicioId, bloque) {
  const ref = db.collection("servicios").doc(servicioId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "El servicio no existe.");
    const estadoActual = (snap.data().conciliacion || {}).estado;
    if (estadoActual === "HABILITADA") {
      throw new functions.https.HttpsError("failed-precondition", "El servicio ya está habilitado: otro usuario lo habilitó antes.");
    }
    if (estadoActual === "RECHAZADA") {
      throw new functions.https.HttpsError("failed-precondition", "El servicio está rechazado: no se puede habilitar.");
    }
    if (estadoActual !== "PENDIENTE_VALIDACION" && estadoActual !== "VALIDADA") {
      throw new functions.https.HttpsError("failed-precondition", "El servicio no está en un estado habilitable (" + String(estadoActual) + ").");
    }
    t.update(ref, { conciliacion: bloque, updatedAt: FieldValue.serverTimestamp() });
  });
}

exports.habilitarServicio = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const { servicioId, autorizarVencido, justificacion, advertenciaAceptada } = data || {};
  if (!servicioId) throw new functions.https.HttpsError("invalid-argument", "Se requiere servicioId.");

  /* Se reevalúa AHORA: el estado pudo cambiar desde que el panel pintó la ficha. */
  const info = await evaluarServicioPorId(servicioId);
  if (!info.existe) throw new functions.https.HttpsError("not-found", "El servicio no existe.");

  const permiso = autorizarHabilitacion(info.evaluacion, { autorizarVencido, justificacion, advertenciaAceptada });
  if (!permiso.permitido) {
    throw new functions.https.HttpsError("failed-precondition", permiso.motivo);
  }

  const bloque = bloqueHabilitado({ por: usuario.nombre || context.auth.uid });
  await escribirHabilitacion(servicioId, bloque);
  await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
    "HABILITAR_SERVICIO", "servicios", servicioId,
    { estado: "VALIDADA" },
    {
      estado: "HABILITADA",
      situacion: info.evaluacion.situacion,
      vencimiento: info.evaluacion.vencimiento,
      dias: info.evaluacion.dias,
      autorizoVencido: info.evaluacion.requiereAutorizacionVencido && autorizarVencido === true,
      justificacion: justificacion ? String(justificacion).slice(0, 300) : null
    });
  return {
    servicioId,
    conciliacion: bloque.estado,
    situacion: info.evaluacion.situacion,
    consecuencias: info.evaluacion.consecuencias
  };
});

/** Consulta (solo lectura) del riesgo de una lista: alimenta el resumen del panel. */
exports.evaluarServiciosConciliacion = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const { servicioIds } = data || {};
  if (!Array.isArray(servicioIds) || servicioIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Se requiere una lista de servicioIds.");
  }
  if (servicioIds.length > 50) {
    throw new functions.https.HttpsError("invalid-argument", "Máximo 50 servicios por consulta.");
  }

  const detalle = [];
  for (const id of servicioIds) {
    if (typeof id !== "string" || !id) { detalle.push({ servicioId: String(id), existe: false }); continue; }
    detalle.push(await evaluarServicioPorId(id));
  }
  const evaluaciones = detalle.filter((d) => d.existe).map((d) => d.evaluacion);
  return { total: detalle.length, resumen: resumirTanda(evaluaciones), detalle };
});

/** 3-bis · HABILITAR EN TANDA: nunca habilita vencidos sin autorización explícita. */
exports.habilitarServiciosLote = functions.https.onCall(async (data, context) => {
  const usuario = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);
  const { servicioIds, simular, autorizarVencidos, justificacion } = data || {};
  if (!Array.isArray(servicioIds) || servicioIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Se requiere una lista de servicioIds.");
  }
  const LIMITE = 50;
  if (servicioIds.length > LIMITE) {
    throw new functions.https.HttpsError("invalid-argument", `La tanda no puede pasar de ${LIMITE} servicios.`);
  }
  const autorizados = Array.isArray(autorizarVencidos) ? autorizarVencidos.filter((x) => typeof x === "string") : [];
  const justificacionLote = typeof justificacion === "string" ? justificacion.trim() : "";

  const resultados = [];
  for (const id of servicioIds) {
    if (typeof id !== "string" || !id) { resultados.push({ servicioId: String(id), resultado: "ID_INVALIDO" }); continue; }

    /* Reevaluación inmediatamente antes de escribir. */
    const info = await evaluarServicioPorId(id);
    if (!info.existe) { resultados.push({ servicioId: id, resultado: "NO_EXISTE" }); continue; }
    const ev = info.evaluacion;

    if (ev.estadoConciliacion === "HABILITADA") { resultados.push({ servicioId: id, resultado: "YA_HABILITADO", situacion: ev.situacion }); continue; }
    if (ev.situacion === "BLOQUEADO_EN_FLUJO") { resultados.push({ servicioId: id, resultado: "NO_VALIDADO", situacion: ev.situacion }); continue; }
    if (!ev.puedeHabilitar) { resultados.push({ servicioId: id, resultado: "BLOQUEADO", situacion: ev.situacion, motivos: ev.motivos }); continue; }

    const autorizadoEste = autorizados.includes(id) && justificacionLote.length >= 10;
    const permiso = autorizarHabilitacion(ev, {
      autorizarVencido: autorizadoEste,
      justificacion: autorizadoEste ? justificacionLote : "",
      advertenciaAceptada: true
    });
    if (!permiso.permitido) {
      resultados.push({ servicioId: id, resultado: "REQUIERE_AUTORIZACION", situacion: ev.situacion, motivo: permiso.motivo });
      continue;
    }

    if (simular) { resultados.push({ servicioId: id, resultado: "SIMULADO_INCLUIDO", situacion: ev.situacion }); continue; }

    const ref = db.collection("servicios").doc(id);
    try {
      /* Misma precondición que la habilitación individual: si otro proceso la
         habilitó entre la comprobación y la escritura, esta se rechaza. */
      await escribirHabilitacion(id, bloqueHabilitado({ por: usuario.nombre || context.auth.uid }));
      await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
        "HABILITAR_SERVICIO_LOTE", "servicios", id, { estado: "VALIDADA" },
        { estado: "HABILITADA", situacion: ev.situacion, autorizoVencido: autorizadoEste });
      resultados.push({ servicioId: id, resultado: "HABILITADO", situacion: ev.situacion });
    } catch (e) {
      /* Fallo parcial: se identifica por registro y NO se reintenta a ciegas. */
      resultados.push({ servicioId: id, resultado: "ERROR", motivo: String(e && e.message).slice(0, 160) });
    }
  }

  const resumen = resultados.reduce((acc, r) => { acc[r.resultado] = (acc[r.resultado] || 0) + 1; return acc; }, {});
  const evaluaciones = resultados.filter((r) => r.situacion).map((r) => ({ situacion: r.situacion }));
  if (!simular) {
    await auditar(context.auth.uid, usuario.nombre || context.auth.uid,
      "HABILITAR_LOTE_RESUMEN", "servicios", "-", null,
      { total: servicioIds.length, resumen, autorizadosVencidos: autorizados.length, justificacion: justificacionLote.slice(0, 300) });
  }
  return { simulado: !!simular, total: servicioIds.length, resumen, situaciones: resumirTanda(evaluaciones), resultados };
});

/* ============================================================
 * MÓDULO: ESTADO DEL SERVICIO EN EL ROUTER (MikroTik, SOLO LECTURA)
 * ------------------------------------------------------------
 * Cruza los clientes de Firestore con las colas del router y devuelve el
 * estado REAL de cada servicio, sin modificar nada.
 *
 * Es deliberadamente de consulta: automatizar un corte sin poder leer antes
 * significa poder dejar sin Internet a un cliente que sí pagó. La escritura
 * vive en ./mikrotik.js pero está cerrada (`MIKROTIK_PERMITIR_ESCRITURA`) y
 * ninguna callable la expone.
 *
 * Si faltan las credenciales, responde `configurado: false` y NO se conecta.
 * ============================================================ */
exports.estadoMikrotik = functions.https.onCall(async (data, context) => {
  await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const config = leerConfiguracion(process.env);
  if (!config) {
    return {
      configurado: false,
      motivo: "MikroTik no está configurado: faltan MIKROTIK_HOST, MIKROTIK_USER o MIKROTIK_PASSWORD."
    };
  }

  const limite = 500;
  const snap = await db.collection("clientes").limit(limite).get();
  const clientes = snap.docs.map((d) => {
    const v = d.data() || {};
    return { id: d.id, nombreCompleto: v.nombreCompleto || null, ip: v.ip || v.ipCliente || null };
  });

  const informe = await informeEstado({ clientes, config });
  return { ...informe, clientesLeidos: clientes.length, truncado: clientes.length >= limite };
});

/* ============================================================
 * MÓDULO: ENVÍO MANUAL DE NOTIFICACIÓN (callable)
 * ============================================================ */
exports.enviarNotificacion = functions.https.onCall(async (data, context) => {
  const usuarioNotif = await verificarRol(context, ["ADMIN", "SUPERADMIN"]);

  const { clienteId, titulo, mensaje } = data || {};
  if (!clienteId || !mensaje) throw new functions.https.HttpsError("invalid-argument", "clienteId y mensaje son obligatorios.");
  /* KZ-UNEF-001 · Límites: sin tope, un mensaje enorme hace fallar el envío de
     FCM (límite ~4 KB) y el panel mostraba "procesada" sin decir nada. */
  if (String(mensaje).length > 2000) {
    throw new functions.https.HttpsError("invalid-argument", "El mensaje no puede pasar de 2000 caracteres.");
  }
  if (titulo && String(titulo).length > 120) {
    throw new functions.https.HttpsError("invalid-argument", "El título no puede pasar de 120 caracteres.");
  }

  const resultado = await enviarPush(clienteId, titulo || "UneFibra", mensaje);

  /* KZ-UNEF-001 · ENVIADA solo si de verdad salió algo.
     Antes se escribía ENVIADA siempre, incluso con 0 tokens: el registro decía
     que el cliente fue avisado cuando no se envió a nadie. */
  const enviados = (resultado && resultado.enviados) || 0;
  const refNotif = await db.collection("notificaciones").add({
    clienteId,
    tipo: "MANUAL",
    titulo: titulo || "UneFibra",
    mensaje,
    fechaProgramada: FieldValue.serverTimestamp(),
    fechaEnvio: enviados > 0 ? FieldValue.serverTimestamp() : null,
    estado: enviados > 0 ? ESTADO_NOTIFICACION.ENVIADA : ESTADO_NOTIFICACION.ERROR,
    periodoServicio: null,
    canal: "PUSH",
    error: enviados > 0 ? null : ((resultado && resultado.motivo) || "Sin tokens activos que reciban el aviso"),
    claveDedup: `${clienteId}_manual_${Date.now()}`,
    createdAt: FieldValue.serverTimestamp()
  });

  await auditar(context.auth.uid, usuarioNotif.nombre || context.auth.uid,
    "ENVIAR_NOTIFICACION", "clientes", clienteId, null,
    { mensaje, enviados, total: (resultado && resultado.total) || 0 });
  return { ...resultado, id: refNotif.id, estado: enviados > 0 ? ESTADO_NOTIFICACION.ENVIADA : ESTADO_NOTIFICACION.ERROR };
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
    userRecord = await getAuth().createUser({ email, password, displayName: nombre });
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
  if (activo === false) { try { await getAuth().updateUser(uid, { disabled: true }); } catch (e) { /* Keep Firestore status if Auth synchronization fails. */ } }
  if (activo === true) { try { await getAuth().updateUser(uid, { disabled: false }); } catch (e) { /* Keep Firestore status if Auth synchronization fails. */ } }

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
    // ── Guardián de entorno (harness/unef-010) ──────────────────────────
    // Estas funciones crean o borran datos de demostración. En producción no
    // deben poder ejecutarse: se exige el emulador o el proyecto demo.
    const proyectoActual = (functions.app || {}).options && functions.app.options.projectId;
    const esDemo = !!process.env.FIRESTORE_EMULATOR_HOST
      || String(proyectoActual || '').startsWith('demo-')
      || process.env.FUNCTIONS_EMULATOR === 'true';
    if (!esDemo) {
      throw new functions.https.HttpsError('failed-precondition', 'Las funciones de demostración solo se ejecutan en el emulador o en un proyecto demo-.');
    }
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
      email: "demo@unefibra.co",
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
    // ── Guardián de entorno (harness/unef-010) ──────────────────────────
    // Estas funciones crean o borran datos de demostración. En producción no
    // deben poder ejecutarse: se exige el emulador o el proyecto demo.
    const proyectoActual = (functions.app || {}).options && functions.app.options.projectId;
    const esDemo = !!process.env.FIRESTORE_EMULATOR_HOST
      || String(proyectoActual || '').startsWith('demo-')
      || process.env.FUNCTIONS_EMULATOR === 'true';
    if (!esDemo) {
      throw new functions.https.HttpsError('failed-precondition', 'Las funciones de demostración solo se ejecutan en el emulador o en un proyecto demo-.');
    }
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

/* ============================================================
 * KZ-UNEF-023 · Modulo administrativo de pagos historicos
 * Deshabilitado en produccion: PAGOS_HISTORICOS_HABILITADO no existe alli.
 * ============================================================ */
const pagosHistoricos = require("./pagosHistoricos").crearCallables({
  functions, db, verificarRol, auditar, FieldValue
});
exports.listarPropuestasPagos = pagosHistoricos.listarPropuestasPagos;
exports.decidirPropuestasPagos = pagosHistoricos.decidirPropuestasPagos;
exports.corregirVencimientoContractual = pagosHistoricos.corregirVencimientoContractual;