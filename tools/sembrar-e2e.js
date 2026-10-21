'use strict';
/* Siembra datos ficticios para E2E del panel (solo emuladores, nunca producción).
   Crea: admin SUPERADMIN, un plan Básico (confirmado), y configuración mínima. */
const FS='http://127.0.0.1:8080', AUTH='http://127.0.0.1:9199', P='demo-unefibra', K='clave-ficticia';
const u=r=>`${FS}/v1/projects/${P}/databases/(default)/documents/${r}`;
const s=v=>({stringValue:v}), n=v=>({integerValue:String(v)}), b=v=>({booleanValue:v});
const pedir=async(m,url,c,t)=>{const h={'Content-Type':'application/json'};if(t)h.Authorization='Bearer '+t;const r=await fetch(url,{method:m,headers:h,body:c===undefined?undefined:JSON.stringify(c)});const txt=await r.text();let j=null;try{j=JSON.parse(txt);}catch(e){}return {st:r.status,j,txt};};
const crear=(c,id,f,t='owner')=>pedir('POST',`${u(c)}?documentId=${id}`,{fields:f},t);
(async()=>{
  // limpiar
  await fetch(FS + '/emulator/v1/projects/' + P + '/databases/(default)/documents', { method: 'DELETE' });
  // admin SUPERADMIN (signUp idempotente: si ya existe, signIn devuelve el mismo uid)
  const email='admin@unefibra.test', password='AdminFicticio#1';
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const si = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${K}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})).json();
  const uid = si.localId;
  await crear('usuarios',uid,{email:s(email),nombre:s('Admin Ficticio'),rol:s('SUPERADMIN'),activo:b(true)});
  // plan Básico 100 (CONFIRMADO por el cliente: $50.000)
  await crear('planes','basico100',{nombre:s('Básico 100'),velocidad:s('100 Mbps'),precio:n(50000),duracion:n(30),estado:s('ACTIVO')});
  await crear('planes','familiar150',{nombre:s('Familiar 150'),velocidad:s('150 Mbps'),precio:n(60000),duracion:n(30),estado:s('ACTIVO')});
  await crear('planes','plus200',{nombre:s('Plus 200'),velocidad:s('200 Mbps'),precio:n(70000),duracion:n(30),estado:s('ACTIVO')});
  await crear('planes','premium250',{nombre:s('Premium 250'),velocidad:s('250 Mbps'),precio:n(85000),duracion:n(30),estado:s('ACTIVO')});
  await crear('planes','ultra300',{nombre:s('Ultra 300'),velocidad:s('300 Mbps'),precio:n(100000),duracion:n(30),estado:s('ACTIVO')});
  // configuración comercial CONFIRMADA por el cliente (decisiones aprobadas):
  // recordatorios 7/3/0, suspensión a los 3 días de mora e instalación GRATIS.
  const arrInt = (xs) => ({ arrayValue: { values: xs.map((x) => ({ integerValue: String(x) })) } });
  await crear('configuracion','diasAntes',{clave:s('diasAntes'),valor:arrInt([7,3]),descripcion:s('Días antes del vencimiento para recordatorios')});
  await crear('configuracion','diasDespues',{clave:s('diasDespues'),valor:arrInt([0]),descripcion:s('Día del vencimiento (0)')});
  await crear('configuracion','diasSuspension',{clave:s('diasSuspension'),valor:n(3),descripcion:s('Días naturales de mora antes de suspender')});
  await crear('configuracion','instalacionGratis',{clave:s('instalacionGratis'),valor:b(true),descripcion:s('La instalación es gratuita ($0 COP), sin conceptos de cobro automáticos')});
  // medios de pago (SOLO nombres, confirmados por el cliente; sin números de cuenta
  // ni teléfonos inventados). Los datos de cuenta/teléfono se cargan aparte cuando
  // el cliente los entregue.
  await crear('metodos_pago','nequi',{nombre:s('Nequi'),tipo:s('nequi'),activo:b(true),orden:n(1)});
  await crear('metodos_pago','bancolombia',{nombre:s('Transferencia Bancolombia'),tipo:s('transferencia'),activo:b(true),orden:n(2)});
  await crear('metodos_pago','efectivo',{nombre:s('Efectivo'),tipo:s('efectivo'),activo:b(true),orden:n(3)});
  console.log('✓ sembrado: admin + 5 planes + configuracion (7/3/0, suspensión 3, instalación gratis) + 3 métodos de pago (emulador)');
  console.log('  login: ' + email + ' / ' + password);
})().catch(e=>{console.error('ERROR',e);process.exit(2);});
