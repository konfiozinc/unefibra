'use strict';
/* ============================================================
 * KZ-UNEF-006 · Guardia de conciliación y reglas de la migración
 * ------------------------------------------------------------
 * Sin emulador: son decisiones puras. Cubre lo que la misión exige proteger:
 * un servicio migrado no puede suspenderse, avisarse, renovarse, reconectarse,
 * tocarse en MikroTik ni cambiar de estado hasta que alguien lo valide.
 *
 *   node test/conciliacion.test.js
 * ============================================================ */
const assert = require('assert');
const c = require('../src/conciliacion.js');
const m = require('../src/migracion.js');

let ok = 0, fail = 0; const fallos = [];
const t = (n, fn) => {
  try { fn(); ok++; console.log('  PASA  ' + n); }
  catch (e) { fail++; fallos.push(n); console.log('  FALLA ' + n + ' · ' + e.message); }
};

const PENDIENTE = { conciliacion: { estado: 'PENDIENTE_VALIDACION', referencia: 'kz-unef-006' } };
const VALIDADO = { conciliacion: { estado: 'VALIDADA', referencia: 'kz-unef-006' } };
const SIN_BLOQUE = { estado: 'ACTIVO' };

console.log('=== 1. Servicio en conciliación: TODO bloqueado ===');

const ACCIONES_A_PROBAR = [
  ['puedeSuspender', 'SUSPENDER'],
  ['puedeNotificar', 'NOTIFICAR'],
  ['puedeRenovar', 'RENOVAR'],
  ['puedeReconectar', 'RECONECTAR'],
  ['puedeTocarMikrotik', 'MIKROTIK'],
  ['puedeCambiarEstado', 'CAMBIAR_ESTADO']
];

for (const [fn, accion] of ACCIONES_A_PROBAR) {
  t(`${accion} bloqueada mientras está pendiente`, () => {
    const r = c.guardias[fn](PENDIENTE);
    assert.strictEqual(r.permitido, false);
    assert.match(r.motivo, /conciliación|conciliacion/i);
  });

  t(`${accion} permitida si el servicio está validado`, () => {
    assert.strictEqual(c.guardias[fn](VALIDADO).permitido, true);
  });

  t(`${accion} permitida si el servicio no tiene bloque de conciliación`, () => {
    assert.strictEqual(c.guardias[fn](SIN_BLOQUE).permitido, true);
  });
}

t('un servicio sin bloque se comporta como siempre (no rompe lo existente)', () => {
  assert.strictEqual(c.enConciliacionPendiente(SIN_BLOQUE), false);
  assert.strictEqual(c.enConciliacionPendiente(null), false);
  assert.strictEqual(c.enConciliacionPendiente({ conciliacion: { estado: 'VALIDADA' } }), false);
});

t('el guardia NO depende de credenciales de MikroTik', () => {
  // Se evalúa sobre el dato guardado, sin consultar configuración ni entorno.
  const antes = JSON.stringify(process.env.MIKROTIK_PERMITIR_ESCRITURA);
  process.env.MIKROTIK_PERMITIR_ESCRITURA = 'true';
  try {
    assert.strictEqual(c.guardias.puedeTocarMikrotik(PENDIENTE).permitido, false);
    assert.strictEqual(c.guardias.puedeSuspender(PENDIENTE).permitido, false);
  } finally {
    if (antes === undefined) delete process.env.MIKROTIK_PERMITIR_ESCRITURA;
    else process.env.MIKROTIK_PERMITIR_ESCRITURA = JSON.parse(antes);
  }
});

console.log('\n=== 2. Bloques de estado ===');

t('el bloque de conciliación nace pendiente y con referencia', () => {
  const b = c.bloqueConciliacion({ referencia: 'kz-unef-006', ahora: new Date('2026-10-26T00:00:00Z') });
  assert.strictEqual(b.estado, 'PENDIENTE_VALIDACION');
  assert.strictEqual(b.referencia, 'kz-unef-006');
  assert.strictEqual(b.desde, '2026-10-26T00:00:00.000Z');
  assert.ok(b.motivo.length > 10);
});

t('validar deja constancia de quién y cuándo', () => {
  const b = c.bloqueValidado({ por: 'Admin Ficticio', ahora: new Date('2026-10-27T10:00:00Z') });
  assert.strictEqual(b.estado, 'VALIDADA');
  assert.strictEqual(b.validadoPor, 'Admin Ficticio');
  assert.strictEqual(b.desde, '2026-10-27T10:00:00.000Z');
});

t('rechazar exige motivo', () => {
  assert.throws(() => c.bloqueRechazado({ motivo: 'no' }), /motivo/);
  const b = c.bloqueRechazado({ por: 'Admin', motivo: 'el precio no coincide con el contrato' });
  assert.strictEqual(b.estado, 'RECHAZADA');
  assert.match(b.motivo, /precio/);
});

t('separarPorConciliacion divide sin perder elementos', () => {
  const r = c.separarPorConciliacion([PENDIENTE, VALIDADO, SIN_BLOQUE]);
  assert.strictEqual(r.enConciliacion.length, 1);
  assert.strictEqual(r.normales.length, 2);
});

console.log('\n=== 3. Reglas de la migración ===');

const COMPLETO = {
  id: 'cli-1', planId: 'plan1', precioMensual: 50000, fechaVencimiento: '2026-11-30',
  estadoCliente: 'ACTIVO', fechaInicioServicio: '2026-10-31', cicloCorte: '30', ip: '10.0.0.5'
};

t('un cliente completo es migrable', () => {
  const r = m.evaluarCandidato(COMPLETO, { serviciosExistentes: 0 });
  assert.strictEqual(r.apto, true);
  assert.strictEqual(r.clase, 'CANDIDATO_MIGRABLE');
});

t('sin plan no se migra', () => {
  const r = m.evaluarCandidato({ ...COMPLETO, planId: null }, {});
  assert.strictEqual(r.apto, false);
  assert.ok(r.motivos.includes('sin planId'));
  assert.strictEqual(r.clase, 'REQUIERE_REVISION');
});

t('sin precio válido no se migra', () => {
  for (const p of [null, 0, -1, '50000']) {
    const r = m.evaluarCandidato({ ...COMPLETO, precioMensual: p }, {});
    assert.strictEqual(r.apto, false, 'precio ' + p + ' debió rechazarse');
  }
});

t('sin vencimiento válido no se migra', () => {
  const r = m.evaluarCandidato({ ...COMPLETO, fechaVencimiento: '30/11/2026' }, {});
  assert.strictEqual(r.apto, false);
});

t('estado de cliente fuera del modelo no se migra', () => {
  const r = m.evaluarCandidato({ ...COMPLETO, estadoCliente: 'POR_VENCER' }, {});
  assert.strictEqual(r.apto, false);
});

t('si ya tiene servicio se omite (no se duplica)', () => {
  const r = m.evaluarCandidato(COMPLETO, { serviciosExistentes: 1 });
  assert.strictEqual(r.apto, false);
  assert.strictEqual(r.clase, 'OMITIDO_YA_TIENE_SERVICIO');
});

t('con dos servicios se marca ambiguo', () => {
  const r = m.evaluarCandidato(COMPLETO, { serviciosExistentes: 2 });
  assert.strictEqual(r.apto, false);
  assert.ok(r.motivos.some((x) => /ambiguo/.test(x)));
});

t('el id del servicio es determinista', () => {
  assert.strictEqual(m.idServicioPara('abc123'), 'svc-abc123');
  assert.strictEqual(m.idServicioPara('abc123'), m.idServicioPara('abc123'));
});

t('construirServicio copia los datos sin inventar nada', () => {
  const { id, datos } = m.construirServicio(COMPLETO, { ahora: new Date('2026-10-26T00:00:00Z') });
  assert.strictEqual(id, 'svc-cli-1');
  assert.strictEqual(datos.planId, 'plan1');
  assert.strictEqual(datos.precioMensual, 50000);
  assert.strictEqual(datos.fechaVencimiento, '2026-11-30');
  assert.strictEqual(datos.fechaInicio, '2026-10-31');
  assert.strictEqual(datos.cicloCorte, '30');
  assert.strictEqual(datos.ip, '10.0.0.5');
  assert.strictEqual(datos.origen, 'kz-unef-006');
  assert.strictEqual(datos.conciliacion.estado, 'PENDIENTE_VALIDACION');
});

t('sin fecha de instalación se guarda null, no se inventa', () => {
  const { datos } = m.construirServicio({ ...COMPLETO, fechaInicioServicio: undefined }, {});
  assert.strictEqual(datos.fechaInicio, null);
});

t('el estado del servicio se deriva del cliente', () => {
  const { datos } = m.construirServicio({ ...COMPLETO, estadoCliente: 'PENDIENTE_PAGO' }, {});
  assert.strictEqual(datos.estado, 'POR_VENCER');
});

t('construir un servicio no migrable lanza y no escribe', () => {
  assert.throws(() => m.construirServicio({ ...COMPLETO, planId: null }, {}), /no migrable/);
});

console.log('\n=== 4. Reversión segura ===');

const CREADO = {
  id: 'svc-cli-1', origen: 'kz-unef-006',
  conciliacion: { estado: 'PENDIENTE_VALIDACION' },
  creadoEn: '2026-10-26T00:00:00.000Z'
};

t('se puede revertir un servicio de la migración sin actividad', () => {
  assert.strictEqual(m.puedeRevertirse(CREADO, { pagosAsociados: 0 }).permitido, true);
});

t('NO se revierte si lo creó otra cosa', () => {
  assert.strictEqual(m.puedeRevertirse({ ...CREADO, origen: 'manual' }, {}).permitido, false);
});

t('NO se revierte si ya fue validado', () => {
  assert.strictEqual(m.puedeRevertirse({ ...CREADO, conciliacion: { estado: 'VALIDADA' } }, {}).permitido, false);
});

t('NO se revierte si tiene pagos asociados', () => {
  const r = m.puedeRevertirse(CREADO, { pagosAsociados: 2 });
  assert.strictEqual(r.permitido, false);
  assert.match(r.motivo, /pago/);
});

t('NO se revierte si un administrador lo modificó después', () => {
  const r = m.puedeRevertirse(CREADO, { fechaModificacion: '2026-10-27T12:00:00.000Z' });
  assert.strictEqual(r.permitido, false);
  assert.match(r.motivo, /modificado/);
});

t('una modificación dentro de los 5 minutos no bloquea la reversión', () => {
  const r = m.puedeRevertirse(CREADO, { fechaModificacion: '2026-10-26T00:02:00.000Z' });
  assert.strictEqual(r.permitido, true);
});

console.log('\n  TOTAL ' + (ok + fail) + ' · PASA ' + ok + ' · FALLA ' + fail);
if (fail) { console.log('  Fallos: ' + fallos.join(' | ')); process.exit(1); }
