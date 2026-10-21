'use strict';
/* E2E de navegador del panel UneFibra contra EMULADORES (?emulador=1).
   Verifica: formulario de login, sesión establecida (Auth emulador), y que el
   dashboard renderiza el shell con el rol SUPERADMIN (permisos correctos). */
const { chromium } = require('C:/Users/usuario29/Documents/KONFIO_ZINC/6-LANDING-PAGES/Konfio-Zinc-Web/herramientas/node_modules/playwright');
const BASE = 'http://127.0.0.1:5171/';
let ok = 0, fail = 0;
const chk = (c, n, d='') => { if (c) { ok++; console.log('  PASA   ' + n + (d?' — '+d:'')); } else { fail++; console.log('  **FALLA** ' + n + (d?' — '+d:'')); } };

(async () => {
  const nav = await chromium.launch({ headless: true });
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-CO' });
  const pag = await ctx.newPage();
  const errs = [];
  pag.on('pageerror', e => errs.push(e.message));

  // 1) login
  await pag.goto(BASE + 'admin/index.html?emulador=1', { waitUntil: 'load', timeout: 60000 });
  await pag.waitForTimeout(1200);
  chk(await pag.evaluate(() => !!document.querySelector('#login-form')), 'formulario de login presente');
  await pag.fill('input[name="email"]', 'admin@unefibra.test');
  await pag.fill('input[name="password"]', 'AdminFicticio#1');
  await pag.click('#login-submit');
  await pag.waitForTimeout(3500);
  chk(pag.url().includes('dashboard.html'), 'login redirige al dashboard', pag.url());

  // 2) dashboard renderiza el shell con el rol correcto.
  if (!pag.url().includes('dashboard.html')) {
    await pag.goto(BASE + 'admin/dashboard.html?emulador=1', { waitUntil: 'load', timeout: 60000 });
    await pag.waitForTimeout(2500);
  } else {
    await pag.waitForTimeout(1500);
  }
  const shell = await pag.evaluate(() => ({
    url: location.href,
    superadmin: document.body.textContent.includes('SUPERADMIN'),
    tieneNav: !!document.querySelector('.side__nav'),
    navItems: document.querySelectorAll('.side__link').length,
    redirigioLogin: location.href.includes('index.html')
  }));
  chk(!shell.redirigioLogin, 'dashboard NO redirige al login (sesión válida)', shell.url);
  chk(shell.superadmin, 'rol SUPERADMIN renderizado en el shell');
  chk(shell.tieneNav && shell.navItems >= 8, 'sidebar con menú completo de SUPERADMIN', `items=${shell.navItems}`);

  // 3) separación por rol: OPERADOR no debería ver Usuarios/Auditoría/Configuración.
  // (cubierto por las 22 pruebas de reglas; aquí solo verificamos que el shell de
  //  SUPERADMIN sí muestra los ítems restringidos.)
  chk(shell.navItems >= 12, 'SUPERADMIN ve Configuración/Usuarios/Auditoría', `items=${shell.navItems}`);

  // 4) sin errores JS de página
  chk(errs.length === 0, 'sin errores JS de página', errs.slice(0,2).join(' | '));

  console.log(`\n  E2E: ${ok} PASA · ${fail} FALLA`);
  await nav.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
