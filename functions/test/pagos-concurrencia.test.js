'use strict';
/* Concurrencia e idempotencia financiera: dos confirmaciones simultáneas del MISMO pago.
   Esperado: exactamente UNA confirma (200); la otra es rechazada; el servicio se renueva
   UNA sola vez (fechaVencimiento = inicio + duración) y no se duplica.
   Contra Functions+Firestore+Auth Emulator (mismos puertos que pagos-integracion). */
const FS='http://127.0.0.1:8080', FN='http://127.0.0.1:5001', AUTH='http://127.0.0.1:9199', P='demo-unefibra', K='clave-ficticia';
const u=r=>`${FS}/v1/projects/${P}/databases/(default)/documents/${r}`;
const s=v=>({stringValue:v}), n=v=>({integerValue:String(v)}), b=v=>({booleanValue:v});
const pedir=async(m,url,c,t)=>{const h={'Content-Type':'application/json'};if(t)h.Authorization='Bearer '+t;const r=await fetch(url,{method:m,headers:h,body:c===undefined?undefined:JSON.stringify(c)});const txt=await r.text();let j=null;try{j=JSON.parse(txt);}catch(e){}return {st:r.status,j,txt};};
const crear=(c,id,f,t='owner')=>pedir('POST',`${u(c)}?documentId=${id}`,{fields:f},t);
const leer=(r,t='owner')=>pedir('GET',u(r),undefined,t);
const callable=(nombre,datos,tok)=>pedir('POST',`${FN}/${P}/us-central1/${nombre}`,{data:datos},tok);
const alta=async(e)=>{await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Ficticia#1',returnSecureToken:true})});const j=await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Ficticia#1',returnSecureToken:true})})).json();return {uid:j.localId,tok:j.idToken};};
const listar=async(c)=>{const r=await pedir('POST',`${FS}/v1/projects/${P}/databases/(default)/documents:runQuery`,{structuredQuery:{from:[{collectionId:c}]}},'owner');return (Array.isArray(r.j)?r.j:[]).filter(x=>x.document).map(x=>x.document);};
let ok=0,fail=0;const chk=(nm,c,d)=>{if(c){ok++;console.log('  PASA   '+nm.padEnd(52)+(d||''));}else{fail++;console.log('  **FALLA** '+nm.padEnd(50)+(d||''));}};
(async()=>{
  await fetch(FS + '/emulator/v1/projects/' + P + '/databases/(default)/documents', { method: 'DELETE' });
  const ad=await alta('con@i.test');
  await crear('usuarios',ad.uid,{email:s('con@i.test'),rol:s('ADMIN'),activo:b(true)});
  await crear('planes','p1',{nombre:s('Plan Ficticio'),precio:n(99900),duracion:n(30),estado:s('ACTIVO')});
  // Cliente CON servicio activo (simula la salida de crearCliente): vence 2026-11-01.
  await crear('clientes','c1',{nombre:s('Cliente Ficticio'),telefono:s('3001112233'),estadoCliente:s('ACTIVO'),planId:s('p1'),fechaVencimiento:s('2026-11-01')});
  await crear('servicios','s1',{clienteId:s('c1'),planId:s('p1'),fechaInicio:s('2026-10-01'),fechaVencimiento:s('2026-11-01'),estado:s('ACTIVO')});

  const r=await callable('registrarPago',{clienteId:'c1',monto:99900,metodoPago:'Nequi'},ad.tok);
  const pagoId=r.j&&r.j.result&&r.j.result.id;
  chk('Pago PENDIENTE creado',r.st===200&&!!pagoId,'id='+(pagoId||'-'));

  // Dos confirmaciones SIMULTÁNEAS sobre el mismo pago.
  const [r1, r2] = await Promise.all([
    callable('confirmarPago',{pagoId},ad.tok),
    callable('confirmarPago',{pagoId},ad.tok)
  ]);
  const confirmados=[r1.st,r2.st].filter(x=>x===200).length;
  const rechazados=[r1.st,r2.st].filter(x=>x>=400).length;
  chk('Exactamente UNA confirmación simultánea tiene éxito', confirmados===1, `200=${confirmados} 4xx=${rechazados}`);
  chk('La otra confirmación simultánea es rechazada', rechazados===1, `4xx=${rechazados}`);

  // El servicio debe renovarse UNA sola vez: fechaVencimiento = 2026-11-01 + 30 = 2026-12-01.
  const sv = await leer('servicios/s1');
  const venc = sv.j && sv.j.fields && sv.j.fields.fechaVencimiento && sv.j.fields.fechaVencimiento.stringValue;
  chk('Servicio renovado UNA vez (vencimiento 2026-12-01)', venc==='2026-12-01', `vence=${venc}`);

  // No se duplicó el servicio.
  const servicios = await listar('servicios');
  chk('No se duplicó el servicio (exactamente 1)', servicios.length===1, `servicios=${servicios.length}`);

  // El pago quedó CONFIRMADO una sola vez.
  const pg = await leer('pagos/'+pagoId);
  const pgEstado = pg.j && pg.j.fields && pg.j.fields.estado && pg.j.fields.estado.stringValue;
  chk('El pago quedó CONFIRMADO (una sola vez)', pgEstado==='CONFIRMADO', `estado=${pgEstado}`);

  console.log(`\n  TOTAL ${ok+fail} · PASA ${ok} · FALLA ${fail}`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERROR',e);process.exit(2);});
