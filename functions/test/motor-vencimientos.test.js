'use strict';
/* Motor de vencimientos (trigger controlado, emulador): verifica las decisiones
   comerciales CONFIRMADAS — recordatorios 7/3/0, suspensión a los 3 días de mora,
   instalación gratis y medios de pago (solo nombres). Usa el callable
   `ejecutarMotor` (SUPERADMIN) para no esperar el cron. */
const FS='http://127.0.0.1:8080', FN='http://127.0.0.1:5001', AUTH='http://127.0.0.1:9199', P='demo-unefibra', K='clave-ficticia';
const u=r=>`${FS}/v1/projects/${P}/databases/(default)/documents/${r}`;
const s=v=>({stringValue:v}), n=v=>({integerValue:String(v)}), b=v=>({booleanValue:v});
const pedir=async(m,url,c,t)=>{const h={'Content-Type':'application/json'};if(t)h.Authorization='Bearer '+t;const r=await fetch(url,{method:m,headers:h,body:c===undefined?undefined:JSON.stringify(c)});const txt=await r.text();let j=null;try{j=JSON.parse(txt);}catch(e){}return {st:r.status,j,txt};};
const crear=(c,id,f,t='owner')=>pedir('POST',`${u(c)}?documentId=${id}`,{fields:f},t);
const leer=(r,t='owner')=>pedir('GET',u(r),undefined,t);
const callable=(nombre,datos,tok)=>pedir('POST',`${FN}/${P}/us-central1/${nombre}`,{data:datos},tok);
const listar=async(c)=>{const r=await pedir('POST',`${FS}/v1/projects/${P}/databases/(default)/documents:runQuery`,{structuredQuery:{from:[{collectionId:c}]}},'owner');return (Array.isArray(r.j)?r.j:[]).filter(x=>x.document).map(x=>x.document);};
const alta=async(e)=>{await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Ficticia#1',returnSecureToken:true})});const j=await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Ficticia#1',returnSecureToken:true})})).json();return {uid:j.localId,tok:j.idToken};};
// Fechas en zona Colombia (misma convención "YYYY-MM-DD" del motor).
const OFFSET=-5*3600000;
const fecha=(ms)=>{const d=new Date(ms+OFFSET);return d.toISOString().slice(0,10);};
const hoy=()=>fecha(Date.now());
const masDias=(x)=>fecha(Date.now()+x*86400000);
let ok=0,fail=0;const chk=(nm,c,d)=>{if(c){ok++;console.log('  PASA   '+nm.padEnd(54)+(d||''));}else{fail++;console.log('  **FALLA** '+nm.padEnd(52)+(d||''));}};
(async()=>{
  await fetch(FS + '/emulator/v1/projects/' + P + '/databases/(default)/documents', { method: 'DELETE' });
  const ad=await alta('motor@i.test');
  await crear('usuarios',ad.uid,{email:s('motor@i.test'),rol:s('SUPERADMIN'),activo:b(true),nombre:s('Admin Motor')});
  await crear('planes','p1',{nombre:s('Plan'),precio:n(50000),duracion:n(30),estado:s('ACTIVO')});

  // Configuración comercial CONFIRMADA (recordatorios 7/3/0, suspensión 3, instalación gratis).
  const arrInt=(xs)=>({arrayValue:{values:xs.map(x=>({integerValue:String(x)}))}});
  await crear('configuracion','diasAntes',{clave:s('diasAntes'),valor:arrInt([7,3]),descripcion:s('Recordatorios 7 y 3 días antes')});
  await crear('configuracion','diasDespues',{clave:s('diasDespues'),valor:arrInt([0]),descripcion:s('El mismo día (0)')});
  await crear('configuracion','diasSuspension',{clave:s('diasSuspension'),valor:n(3),descripcion:s('Suspensión a los 3 días de mora')});
  await crear('configuracion','instalacionGratis',{clave:s('instalacionGratis'),valor:b(true),descripcion:s('Instalación $0 COP')});
  // Medios de pago: SOLO nombres (sin cuentas ni teléfonos inventados).
  await crear('metodos_pago','nequi',{nombre:s('Nequi'),tipo:s('nequi'),activo:b(true),orden:n(1)});
  await crear('metodos_pago','bancolombia',{nombre:s('Transferencia Bancolombia'),tipo:s('transferencia'),activo:b(true),orden:n(2)});
  await crear('metodos_pago','efectivo',{nombre:s('Efectivo'),tipo:s('efectivo'),activo:b(true),orden:n(3)});

  // Clientes con servicios en distintas situaciones de mora.
  const casos = [
    ['c_mora4', masDias(-4)],
    ['c_mora2', masDias(-2)],
    ['c_pagado', masDias(-4)],
    ['c_dia0', hoy()]
  ];
  for (const [id, vence] of casos) {
    await crear('clientes', id, {nombreCompleto:s('Cliente '+id),telefono:s('3001112233'),estadoCliente:s('ACTIVO'),planId:s('p1'),precioMensual:n(50000),fechaVencimiento:s(vence)});
    await crear('servicios', 'svc_'+id, {clienteId:s(id),estado:s('ACTIVO'),fechaVencimiento:s(vence),planId:s('p1')});
  }
  // c_pagado tiene un pago CONFIRMADO que cubre el periodo (ya renovó).
  await crear('pagos','pg_pagado',{clienteId:s('c_pagado'),estado:s('CONFIRMADO'),monto:n(50000),periodoInicio:s(hoy()),periodoFin:s(masDias(30))});

  // Trigger controlado (sin esperar el cron).
  const r = await callable('ejecutarMotor',{},ad.tok);
  chk('ejecutarMotor responde 200 con resumen', r.st===200 && r.j && r.j.result && typeof r.j.result.revisados==='number', 'HTTP '+r.st);
  const resumen = (r.j && r.j.result) || {};

  let cli = (await leer('clientes/c_mora4')).j.fields;
  chk('mora 4 días → SUSPENDIDO (3 días, no 5)', cli.estadoCliente.stringValue==='SUSPENDIDO', cli.estadoCliente.stringValue);
  cli = (await leer('clientes/c_mora2')).j.fields;
  chk('mora 2 días → PENDIENTE_PAGO (aún no suspendido)', cli.estadoCliente.stringValue==='PENDIENTE_PAGO', cli.estadoCliente.stringValue);
  cli = (await leer('clientes/c_pagado')).j.fields;
  chk('mora 4 días CON pago que cubre → NO suspendido', cli.estadoCliente.stringValue==='ACTIVO', cli.estadoCliente.stringValue);
  cli = (await leer('clientes/c_dia0')).j.fields;
  chk('vence hoy → POR_VENCER', cli.estadoCliente.stringValue==='POR_VENCER', cli.estadoCliente.stringValue);

  chk('resumen.suspendidos === 1', resumen.suspendidos===1, 'suspendidos='+resumen.suspendidos);
  chk('resumen.revisados === 4 (4 servicios)', resumen.revisados===4, 'revisados='+resumen.revisados);

  const aud = await listar('auditoria');
  chk('se auditó la suspensión (SUSPENDER_SERVICIO)', aud.some(x=>x.fields.accion.stringValue==='SUSPENDER_SERVICIO'), 'auditoria='+aud.length);

  // Configuración sembrada correctamente.
  chk('config diasSuspension = 3', (await leer('configuracion/diasSuspension')).j.fields.valor.integerValue==='3');
  chk('config instalacionGratis = true', (await leer('configuracion/instalacionGratis')).j.fields.valor.booleanValue===true);
  const mp = await listar('metodos_pago');
  const nombres = mp.map(x=>x.fields.nombre.stringValue).sort();
  const esperados = ['Efectivo','Nequi','Transferencia Bancolombia'].sort();
  chk('3 métodos de pago (solo nombres)', mp.length===3 && JSON.stringify(nombres)===JSON.stringify(esperados), nombres.join(', '));

  console.log(`\n  TOTAL ${ok+fail} · PASA ${ok} · FALLA ${fail}`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2);});
