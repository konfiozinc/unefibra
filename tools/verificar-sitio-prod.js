'use strict';
// Verificación de contenido del sitio productivo (solo lectura, sin datos).
(async () => {
  const BASE = 'https://konfiozinc.github.io/unefibra/';
  const checks = [];
  const chk = (n, c, d) => { checks.push([n, !!c, d || '']); console.log((c ? '  PASA   ' : '  **FALLA** ') + n + (d ? ' — ' + d : '')); };

  const r = await fetch(BASE);
  const html = await r.text();
  chk('index HTTP 200', r.status === 200, 'HTTP ' + r.status);
  chk('FAQ instalación gratis', /La instalaci.n es <strong>gratis<\/strong> \(\$0\)/i.test(html));
  chk('comparador instalación GRATIS', /instalaci.n GRATIS \(\$0\)/i.test(html));

  const t = await fetch(BASE + 'terminos-y-condiciones.html');
  const th = await t.text();
  const thN = th.replace(/\s+/g, ' ');
  chk('términos HTTP 200', t.status === 200, 'HTTP ' + t.status);
  chk('suspensión 3 días de mora', /3 d.as de mora/i.test(thN));
  chk('instalación gratuita $0', /gratuita \(\$0 COP\)/i.test(thN));
  chk('medios de pago (3)', /Nequi, transferencia Bancolombia y efectivo/i.test(thN));

  const p = await fetch(BASE + 'politica-de-privacidad.html');
  chk('privacidad HTTP 200', p.status === 200, 'HTTP ' + p.status);

  const fail = checks.filter(([, c]) => !c).length;
  console.log(`\n  VERIFICACIÓN SITIO: ${checks.length - fail}/${checks.length} PASA`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
