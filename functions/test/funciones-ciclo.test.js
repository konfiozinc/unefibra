'use strict';
/* Ciclo de vida de cliente y servicio (callables, emulador):
   crearCliente → suspender → reactivar → desactivar. Verifica estados, servicio,
   historial y auditoría. Cubre "administración de clientes morosos y suspensiones". */
const FS='http://127.0.0.1:8080', FN='http://127.0.0.1:5001', AUTH='http://127.0.0.1:9199', P='demo-unefibra', K='clave-ficticia';
const u=r=>`${FS}/v1/projects/${P}/databases/(default)/documents/${r}`;
const s=v=>({stringValue:v}), n=v=>({integerValue:String(v)}), b=v=>({booleanValue:v});
const pedir=async(m,url,c,t)=>{const h={'Content-Type':'application/json'};if(t)h.Authorization='Bearer '+t;const r=await fetch(url,{method:m,headers:h,body:c===undefined?undefined:JSON.stringify(c)});const txt=await r.text();let j=null;try{j=JSON.parse(txt);}catch(e){}return {st:r.status,j,txt};};
const crear=(c,id,f,t='owner')=>pedir('POST',`${u(c)}?documentId=${id}`,{fields:f},t);
const leer=(r,t='owner')=>pedir('GET',u(r),undefined,t);
const callable=(nombre,datos,tok)=>pedir('POST',`${FN}/${P}/us-central1/${nombre}`,{data:datos},tok);
const listar=async(c)=>{const r=await pedir('POST',`${FS}/v1/projects/${P}/databases/(default)/documents:runQuery`,{structuredQuery:{from:[{collectionId:c}]}},'owner');return (Array.isArray(r.j)?r.j:[]).filter(x=>x.document).map(x=>x.document);};
const alta=async(e)=>{await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Ficticia#1',returnSecureToken:true})});const j=await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Ficticia#1',returnSecureToken:true})})).json();return {uid:j.localId,tok:j.idToken};};
let ok=0,fail=0;const chk=(nm,c,d)=>{if(c){ok++;console.log('  PASA   '+nm.padEnd(52)+(d||''));}else{fail++;console.log('  **FALLA** '+nm.padEnd(50)+(d||''));}};
(async()=>{
  await fetch(FS + '/emulator/v1/projects/' + P + '/databases/(default)/documents', { method: 'DELETE' });
  const ad=await alta('ciclo@i.test');
  await crear('usuarios',ad.uid,{email:s('ciclo@i.test'),rol:s('ADMIN'),activo:b(true)});
  await crear('planes','p1',{nombre:s('Plan'),precio:n(99900),duracion:n(30),estado:s('ACTIVO')});

  // crearCliente (sin exigir dirección: no existe configuracion/camposDireccionObligatorios)
  let r=await callable('crearCliente',{nombreCompleto:'Cliente Ciclo',telefono:'3001112233',planId:'p1',precioMensual:99900},ad.tok);
  const clienteId=r.j&&r.j.result&&r.j.result.id;
  chk('crearCliente crea cliente + servicio',r.st===200&&!!clienteId,'id='+(clienteId||'-'));
  const svc=await listar('servicios');
  chk('el cliente tiene un servicio',svc.length===1,'servicios='+svc.length);

  // suspender (moroso)
  r=await callable('suspenderServicio',{clienteId,motivo:'Mora'},ad.tok);
  chk('suspenderServicio aceptado',r.st===200,'HTTP '+r.st);
  let cli=(await leer('clientes/'+clienteId)).j.fields;
  chk('cliente queda SUSPENDIDO',cli.estadoCliente.stringValue==='SUSPENDIDO',cli.estadoCliente.stringValue);

  // reactivar
  r=await callable('reactivarServicio',{clienteId},ad.tok);
  cli=(await leer('clientes/'+clienteId)).j.fields;
  chk('reactivarServicio devuelve ACTIVO',r.st===200&&cli.estadoCliente.stringValue==='ACTIVO',cli.estadoCliente.stringValue);

  // desactivar (retiro)
  r=await callable('desactivarServicio',{clienteId,motivo:'Retiro'},ad.tok);
  cli=(await leer('clientes/'+clienteId)).j.fields;
  chk('desactivarServicio deja INACTIVO',cli.estadoCliente.stringValue==='INACTIVO',cli.estadoCliente.stringValue);

  // historial y auditoría registrados
  const hist=await listar('historial_estados');
  const aud=await listar('auditoria');
  chk('se registró historial de cambios',hist.length>=3,'historial='+hist.length);
  chk('se registró auditoría',aud.length>=4,'auditoria='+aud.length);

  console.log(`\n  TOTAL ${ok+fail} · PASA ${ok} · FALLA ${fail}`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2);});
