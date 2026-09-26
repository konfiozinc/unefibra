/* ============================================================
 * UneFibra SAS — Landing page
 * Toda la información editable proviene de assets/js/config.js
 * (window.UNEFIBRAS_CONFIG). Nada se hardcodea aquí.
 * ============================================================ */

(function () {
  "use strict";

  const CFG = window.UNEFIBRAS_CONFIG;

  // ---------------- Utilidades ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function formatoPrecio(valor) {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0
    }).format(valor);
  }

  // ---------------- Nav (móvil) ----------------
  function initNav() {
    const toggle = $("#nav-toggle");
    const nav = $("#nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    });
    // Cerrar al tocar un enlace
    $$("a", nav).forEach((a) => a.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }

  // ---------------- WhatsApp ----------------
  function urlWhatsApp(mensaje) {
    const numero = (CFG.whatsapp && CFG.whatsapp.numero) || "573044654987";
    return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
  }

  function initWhatsApp() {
    $$(".js-whatsapp").forEach((el) => {
      const mensaje = el.dataset.mensaje || CFG.whatsapp.mensajeDefault;
      el.href = urlWhatsApp(mensaje);
      el.target = "_blank";
      el.rel = "noopener";
    });
  }

  // ---------------- Contacto protegido ----------------
  // Los teléfonos, el correo y la dirección NO viven en el HTML: se leen de
  // config.js y se inyectan aquí, así no quedan expuestos como texto plano.
  function initContacto() {
    const emp = CFG.empresa || {};

    // Botón "Llamar" → tel: (número principal de llamadas)
    const tel = telHref(emp.telefono || (emp.telefonos && emp.telefonos[0]));
    if (tel) $$(".js-tel").forEach((el) => { el.href = tel; });

    // Botón "Correo" → mailto:
    if (emp.email) {
      const asunto = encodeURIComponent("Solicitud de información — UneFibra");
      const cuerpo = encodeURIComponent("Hola, me interesa conocer más sobre los planes de Internet por fibra óptica de UneFibra.");
      $$(".js-mail").forEach((el) => { el.href = `mailto:${emp.email}?subject=${asunto}&body=${cuerpo}`; });
    }

    // Botón "Ver ubicación" → Google Maps
    if (emp.direccion) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(emp.direccion)}`;
      $$(".js-mapa").forEach((el) => { el.href = url; el.target = "_blank"; el.rel = "noopener"; });
    }
  }

  // ---------------- Datos de empresa ----------------
  // Convierte "321 749 0310" en un enlace tel: internacional (+57).
  function telHref(numero) {
    const limpio = String(numero || "").replace(/[^\d+]/g, "");
    if (!limpio) return null;
    return limpio.startsWith("+") ? `tel:${limpio}` : `tel:+57${limpio}`;
  }

  function initEmpresa() {
    const emp = CFG.empresa || {};
    const set = (sel, val) => { const el = $(sel); if (el && val != null) el.textContent = val; };

    set(".js-emp-email", emp.email);
    set(".js-emp-direccion", emp.direccion);
    set(".js-emp-horario", emp.horario);
    set(".js-emp-legal", emp.nombreLegal);
    set(".js-emp-nit", emp.nit ? `NIT: ${emp.nit}` : "NIT: [NIT]");

    // Teléfonos: texto + enlace tel: (los dos primeros de config.js)
    const tels = (emp.telefonos && emp.telefonos.length) ? emp.telefonos : [emp.telefono];
    [".js-emp-telefono", ".js-emp-telefono-2"].forEach((sel, i) => {
      const el = $(sel);
      if (!el || !tels[i]) return;
      el.textContent = tels[i];
      const href = telHref(tels[i]);
      if (href) el.href = href;
    });

    // Email: texto + enlace mailto:
    const mail = $(".js-emp-email");
    if (mail && emp.email) mail.href = `mailto:${emp.email}`;

    // El título SEO manda: no se sobrescribe con el nombre/slogan.
    if (CFG.seo && CFG.seo.titulo) {
      document.title = CFG.seo.titulo;
    } else if (emp.nombre) {
      document.title = `${emp.nombre} — ${emp.slogan} en ${emp.ciudad}`;
    }
  }

  // ---------------- Redes sociales ----------------
  // Solo se pintan cuando `empresa.redes.confirmadas` es true: así la
  // landing nunca enlaza a cuentas inexistentes o de terceros.
  const ICONOS_REDES = {
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.6V3.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10H7.5v3h2.7v8h3.3z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.9" r="1.1" fill="currentColor" stroke="none"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.6 3h-2.8v11.3a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .7.1V8.9a5.5 5.5 0 0 0-.7 0 5.5 5.5 0 1 0 5.5 5.5V8.6c1 .8 2.2 1.3 3.6 1.3V7.1a3.9 3.9 0 0 1-3.7-4.1z"/></svg>'
  };
  const NOMBRES_REDES = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };

  function initRedes() {
    const cont = $("#footer-redes");
    const redes = CFG.empresa && CFG.empresa.redes;
    if (!cont || !redes || !redes.confirmadas) return;

    const html = Object.keys(NOMBRES_REDES)
      .filter((k) => typeof redes[k] === "string" && /^https?:\/\//i.test(redes[k]) && !/TODO/i.test(redes[k]))
      .map((k) => `<li><a href="${redes[k]}" target="_blank" rel="noopener noreferrer me" aria-label="UneFibra en ${NOMBRES_REDES[k]} (se abre en una pestaña nueva)">${ICONOS_REDES[k]}</a></li>`)
      .join("");

    if (!html) return;
    cont.innerHTML = html;
    cont.hidden = false;
  }

  // ---------------- Planes ----------------
  function renderPlan(plan) {
    const precio = formatoPrecio(plan.precio);
    const duracion = plan.duracion || 30;
    const beneficios = (CFG.planBeneficios || plan.beneficios || []).map((b) => `<li>${b}</li>`).join("");

    return `
      <article class="plan-card${plan.destacado ? " plan-card--featured" : ""}">
        <h3 class="plan-card__name">${plan.nombre}</h3>
        <span class="plan-card__tech">${plan.tecnologia || "Fibra óptica"}</span>
        <p class="plan-card__price">${precio} <span>COP / ${duracion} ${plan.unidadDuracion || "días"}</span></p>
        <p class="plan-card__desc">${plan.descripcion || ""}</p>
        <ul class="plan-card__list">${beneficios}</ul>
        <a class="btn btn--primary btn--block js-whatsapp" href="#"
           data-mensaje="Hola, me interesa el plan de ${plan.nombre} de UneFibra (${precio} por ${duracion} días).">
          Quiero este plan
        </a>
      </article>`;
  }

  function initPlanes() {
    const cont = $("#planes-container");
    if (!cont) return;
    const planes = (CFG.planes && CFG.planes.length) ? CFG.planes : [];
    cont.innerHTML = planes.map((p) => renderPlan(p)).join("");

    // Los botones "Quiero este plan" se acaban de crear: sin esta llamada
    // se quedaban con href="#" (enlace muerto) porque initWhatsApp() ya
    // había corrido antes de que existieran en el DOM.
    initWhatsApp();

    // Velocidad máxima mostrada en el hero (señal visual)
    const vel = $(".js-velocidad");
    if (vel && planes.length) vel.textContent = planes[planes.length - 1].velocidad || "—";

    // Repoblar select de plan de interés
    const select = $("#plan-interes");
    if (select) {
      (CFG.planesInteres || planes.map((p) => p.nombre)).forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
      });
    }

    // Repoblar barrios sugeridos.
    // Si no hay lista propia, se usan los sectores con cobertura real:
    // así el formulario nunca sugiere zonas donde no hay servicio.
    const dl = $("#barrios");
    if (dl) {
      const sugeridos = (CFG.barriosSugeridos && CFG.barriosSugeridos.length)
        ? CFG.barriosSugeridos
        : ((CFG.cobertura && CFG.cobertura.zonas) || []);
      dl.innerHTML = ""; // evita duplicar si el HTML ya trae opciones
      sugeridos.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b;
        dl.appendChild(opt);
      });
    }
  }

  // ---------------- Cobertura ----------------
  function initCobertura() {
    const nota = $(".js-cobertura-nota");
    if (nota && CFG.cobertura) nota.textContent = CFG.cobertura.nota;

    const zonas = $(".js-cobertura-zonas");
    if (zonas && CFG.cobertura && CFG.cobertura.zonas) {
      zonas.innerHTML = CFG.cobertura.zonas.map((z) => `<li>${z}</li>`).join("");
    }
  }

  // ---------------- Firebase (carga diferida) ----------------
  // Antes se inyectaba con document.write, lo que bloqueaba el parser:
  // si gstatic.com tardaba en responder, la página se quedaba sin
  // JavaScript (sin planes, sin enlaces de WhatsApp y sin formulario).
  // Ahora se carga cuando la página ya está visible o al interactuar
  // con el formulario, y el sitio funciona igual si nunca llega.
  const FIREBASE_SCRIPTS = [
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"
  ];

  function cargarFirebase() {
    if (cargarFirebase.promesa) return cargarFirebase.promesa;

    const cfg = CFG.firebase || {};
    if (!cfg.habilitado) {
      cargarFirebase.promesa = Promise.resolve(null);
      return cargarFirebase.promesa;
    }

    cargarFirebase.promesa = FIREBASE_SCRIPTS
      .reduce((cadena, url) => cadena.then(() => new Promise((res) => {
        const s = document.createElement("script");
        s.src = url;
        s.async = false;
        s.onload = () => res(true);
        s.onerror = () => res(false); // sin Firebase el formulario sigue por WhatsApp
        document.head.appendChild(s);
      })), Promise.resolve())
      .then(() => {
        if (!window.firebase) return null;
        try {
          if (!firebase.apps.length) firebase.initializeApp(cfg.config);
          return firebase.firestore();
        } catch (e) {
          console.warn("Firebase no se pudo inicializar; se usará WhatsApp como respaldo.", e);
          return null;
        }
      });

    return cargarFirebase.promesa;
  }

  function programarCargaFirebase() {
    const cfg = CFG.firebase || {};
    if (!cfg.habilitado) return;
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => cargarFirebase(), { timeout: 3000 });
    } else {
      window.addEventListener("load", () => setTimeout(() => cargarFirebase(), 1200), { once: true });
    }
  }

  // ---------------- Formulario "Quiero Internet" ----------------
  function initForm() {
    const form = $("#form-solicitud");
    if (!form) return;
    const status = $("#form-status");
    const btn = $("#form-submit");
    const fallback = $("#form-wa-fallback");

    // Campos obligatorios (el barrio se usa para verificar cobertura).
    const OBLIGATORIOS = [
      { campo: "nombre", etiqueta: "tu nombre" },
      { campo: "telefono", etiqueta: "tu teléfono" },
      { campo: "barrio", etiqueta: "tu barrio" }
    ];

    const firebaseActivo = CFG.firebase && CFG.firebase.habilitado;
    let db = null;

    // Firebase puede llegar después del primer render (carga diferida).
    // Se espera con un límite: si no está listo, la solicitud ya se envió
    // por WhatsApp y no se hace esperar al usuario.
    async function obtenerDb(limiteMs = 7000) {
      if (db) return db;
      db = await Promise.race([
        cargarFirebase(),
        new Promise((res) => setTimeout(() => res(null), limiteMs))
      ]);
      return db;
    }

    // Al primer contacto con el formulario, adelantamos la carga de Firebase.
    if (firebaseActivo) {
      form.addEventListener("focusin", () => cargarFirebase(), { once: true });
      form.addEventListener("pointerdown", () => cargarFirebase(), { once: true });
    }

    // Mensaje de WhatsApp construido con los datos del formulario.
    function mensajeSolicitud(datos) {
      return [
        "Hola, quiero solicitar Internet por fibra óptica de UneFibra.",
        datos.nombre ? `Nombre: ${datos.nombre}` : "",
        datos.telefono ? `Teléfono: ${datos.telefono}` : "",
        datos.whatsapp ? `WhatsApp: ${datos.whatsapp}` : "",
        datos.barrio ? `Barrio: ${datos.barrio}` : "",
        datos.ciudad ? `Ciudad: ${datos.ciudad}` : "",
        datos.direccion ? `Dirección: ${datos.direccion}` : "",
        datos.planInteres ? `Plan: ${datos.planInteres}` : "",
        datos.observaciones ? `Observaciones: ${datos.observaciones}` : ""
      ].filter(Boolean).join("\n");
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.className = "form__note";
      status.textContent = "";
      if (fallback) {
        fallback.hidden = true;
        fallback.removeAttribute("href");
      }

      const data = Object.fromEntries(new FormData(form).entries());

      // Honeypot anti-spam (tarea 3.6): un humano nunca rellena el campo
      // oculto. Si trae datos, se descarta en silencio (sin avisar al bot)
      // y no se envía nada a WhatsApp ni a Firestore.
      if ((data.website || "").trim()) {
        status.textContent = "Solicitud recibida. Te contactaremos pronto.";
        status.className = "form__note ok";
        form.reset();
        return;
      }

      // Medición de conversión (inerte si no hay analytics configurado).
      window.ufTrack && window.ufTrack("form_submit", {});

      const limpio = (k) => (data[k] || "").trim();
      const nombre = limpio("nombre");
      const telefono = limpio("telefono");
      const barrio = limpio("barrio");
      data.nombre = nombre;
      data.telefono = telefono;
      data.barrio = barrio;

      // Validación básica: que los campos clave no estén vacíos.
      const faltan = OBLIGATORIOS.filter((f) => !data[f.campo]);
      if (faltan.length) {
        status.textContent = `Por favor completa ${faltan.map((f) => f.etiqueta).join(", ")}.`;
        status.className = "form__note err";
        const primerCampo = form.querySelector(`[name="${faltan[0].campo}"]`);
        if (primerCampo) primerCampo.focus();
        return;
      }

      // 1) WhatsApp: se abre con los datos ya cargados.
      //    Se hace dentro del gesto del usuario para que el navegador no lo bloquee.
      const url = urlWhatsApp(mensajeSolicitud(data));
      const ventana = window.open(url, "_blank");
      if (ventana) {
        try { ventana.opener = null; } catch (e) { /* sin acceso: no es crítico */ }
        status.textContent = "Abrimos WhatsApp con tus datos para completar la solicitud.";
        status.className = "form__note ok";
      } else {
        // Ventana bloqueada: se ofrece el enlace directo.
        if (fallback) {
          fallback.href = url;
          fallback.hidden = false;
        }
        status.textContent = "Tu navegador bloqueó la ventana de WhatsApp.";
        status.className = "form__note err";
      }

      // 2) Si hay backend, la solicitud también queda registrada en Firestore.
      btn.disabled = true;
      btn.textContent = "Enviando…";

      try {
        const baseDatos = await obtenerDb();
        if (baseDatos) {
          // Firestore: colección solicitudes_contacto con estado NUEVA
          await baseDatos.collection("solicitudes_contacto").add({
            nombre,
            telefono,
            whatsapp: limpio("whatsapp") || telefono,
            direccion: limpio("direccion") || null,
            barrio,
            ciudad: limpio("ciudad") || "Medellín",
            planInteres: data.planInteres || null,
            observaciones: limpio("observaciones") || null,
            estado: "NUEVA",
            createdAt: new Date().toISOString()
          });
          status.textContent = ventana
            ? "¡Solicitud registrada! Completa el envío en la pestaña de WhatsApp."
            : "¡Solicitud registrada! Te contactaremos pronto.";
          status.className = "form__note ok";
          form.reset();
        } else if (!ventana) {
          console.warn("Sin Firebase y con WhatsApp bloqueado: la solicitud no se pudo enviar.");
        }
      } catch (err) {
        console.error("Error al enviar la solicitud:", err);
        if (!ventana) {
          status.textContent = "No fue posible enviar la solicitud. Intenta nuevamente.";
          status.className = "form__note err";
        } else {
          console.warn("Falló el registro en Firestore, pero WhatsApp sí se abrió.");
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "Solicitar información";
      }
    });
  }

  // ---------------- PWA ----------------
  // ---------------- Verificador de cobertura (modal) ----------------
  // Compara lo que escribe el visitante con cobertura.zonas (config.js).
  // Es un ORIENTADOR comercial, no un diagnóstico técnico: si no hay
  // coincidencia, se ofrece verificar con el equipo (no se niega el servicio).
  function normalizar(texto) {
    return (texto || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function initCoberturaModal() {
    const modal = $("#modal-cobertura");
    const btnAbrir = $("#btn-cobertura");
    if (!modal || !btnAbrir) return;

    const input = $("#cob-sector");
    const lista = $("#cob-lista");
    const resultado = $("#cob-resultado");
    const cta = $("#cob-cta");
    const btnVerificar = $("#cob-verificar");
    const btnCerrar = $("#cob-cerrar");
    const zonas = (CFG.cobertura && CFG.cobertura.zonas) || [];

    if (lista) {
      zonas.forEach((z) => {
        const opt = document.createElement("option");
        opt.value = z;
        lista.appendChild(opt);
      });
    }

    function abrirModal() {
      modal.hidden = false;
      document.body.classList.add("modal-open");
      resultado.textContent = "";
      resultado.className = "modal__msg";
      cta.hidden = true;
      if (input) { input.value = ""; input.focus(); }
    }

    function cerrarModal() {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      btnAbrir.focus();
    }

    function verificar() {
      const valor = normalizar(input && input.value);
      if (!valor) {
        resultado.textContent = "Escribe tu barrio o sector para verificar.";
        resultado.className = "modal__msg warn";
        cta.hidden = true;
        return;
      }

      const encontrado = zonas.find((z) => {
        const nz = normalizar(z);
        return nz === valor || nz.indexOf(valor) !== -1 || valor.indexOf(nz) !== -1;
      });

      if (encontrado) {
        resultado.textContent = "🟢 ¡Sí! Tenemos cobertura registrada en " + encontrado + ". Solicita tu instalación.";
        resultado.className = "modal__msg ok";
        cta.hidden = false;
        cta.textContent = "Solicitar instalación por WhatsApp";
        cta.dataset.mensaje = "Hola, quiero contratar Internet UneFibra. Vivo en " + encontrado + " y quiero confirmar cobertura e instalación.";
      } else {
        resultado.textContent = "🟡 Aún no tenemos cobertura registrada en ese sector. Escríbenos y lo verificamos con el equipo técnico.";
        resultado.className = "modal__msg warn";
        cta.hidden = false;
        cta.textContent = "Consultar por WhatsApp";
        cta.dataset.mensaje = "Hola, quiero saber si UneFibra tiene cobertura en " + ((input && input.value) || "mi sector") + ".";
      }
      initWhatsApp(); // reconstruye el href del CTA con el mensaje contextual
    }

    btnAbrir.addEventListener("click", abrirModal);
    if (btnCerrar) btnCerrar.addEventListener("click", cerrarModal);
    if (btnVerificar) btnVerificar.addEventListener("click", verificar);
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); verificar(); }
      });
    }
    modal.addEventListener("click", (e) => { if (e.target === modal) cerrarModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) cerrarModal();
    });
  }

  // ---------------- Analytics (tarea 3.1 — inerte sin IDs) ----------------
  // Carga GA4 y Meta Pixel SOLO si config.js trae los IDs. Mientras estén
  // vacíos no se inyecta ningún script externo: sin peticiones fallidas y
  // sin rastrear al visitante sin autorización.
  function initAnalytics() {
    const cfg = CFG.analytics || {};
    const ga4 = (cfg.ga4Id || "").trim();
    const pixel = (cfg.metaPixelId || "").trim();

    if (ga4) {
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga4);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", ga4);
    }

    if (pixel) {
      /* Snippet oficial del píxel de Meta */
      !(function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", pixel);
      window.fbq("track", "PageView");
    }

    // Medidor unificado: no hace nada si no hay destino cargado.
    window.ufTrack = function (evento, params) {
      try {
        if (window.gtag) window.gtag("event", evento, params || {});
        if (window.fbq) window.fbq("trackCustom", evento, params || {});
      } catch (e) { /* sin analytics: silencio */ }
    };

    // Eventos pedidos: clic en CTA (cta_click), formulario (form_submit,
    // disparado en initForm) y visualización del QR (qr_view).
    document.addEventListener("click", (e) => {
      const el = e.target.closest(".btn, .js-whatsapp, .js-tel, .js-mail");
      if (!el) return;
      window.ufTrack("cta_click", {
        texto: (el.textContent || "").trim().slice(0, 40),
        destino: el.getAttribute("href") || ""
      });
    }, { passive: true });

    const qr = document.querySelector("img[alt*='QR' i], .qr img, .qr__img");
    if (qr && "IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { window.ufTrack("qr_view", {}); io.disconnect(); }
        });
      });
      io.observe(qr);
    }
  }

  // ---------------- Recomendador de velocidad ----------------
  // Orientador COMERCIAL por reglas — NO es un diagnóstico técnico.
  // Suma 3 respuestas (3 a 9 puntos) y sugiere uno de los planes reales.
  function initRecomendador() {
    const btn = $("#reco-ver");
    if (!btn) return;

    const selPersonas = $("#reco-personas");
    const selEquipos = $("#reco-equipos");
    const selUso = $("#reco-uso");
    const salida = $("#reco-resultado");
    const cta = $("#reco-cta");
    const planes = (CFG.planes || []).slice().sort((a, b) => a.precio - b.precio);

    btn.addEventListener("click", () => {
      if (!planes.length) return;

      const puntaje = Number((selPersonas && selPersonas.value) || 1)
        + Number((selEquipos && selEquipos.value) || 1)
        + Number((selUso && selUso.value) || 0);

      let indice;
      if (puntaje <= 4) indice = 0;
      else if (puntaje <= 6) indice = 1;
      else if (puntaje <= 8) indice = 2;
      else indice = 3;

      const plan = planes[Math.min(indice, planes.length - 1)];
      salida.innerHTML = "Según tus respuestas te sugerimos <strong>" + plan.nombre + "</strong> (" +
        plan.velocidad + "). Es una orientación comercial: si tienes dudas, escríbenos y lo revisamos contigo.";

      if (cta) {
        cta.hidden = false;
        cta.dataset.mensaje = "Hola, según el recomendador de la web me interesa el plan " + plan.nombre +
          " de UneFibra. ¿Me confirman cobertura e instalación?";
        initWhatsApp();
      }
      window.ufTrack && window.ufTrack("plan_select", { plan: plan.nombre });
    });
  }

  // ---------------- Calculadora de ahorro ----------------
  // Honestidad de datos: NO se inventan precios de la competencia. Se compara el
  // valor que el visitante escribe contra los precios publicados en
  // config.js → planes. Si el plan elegido sale MÁS CARO, se dice con claridad:
  // la calculadora no está para engañar a nadie.
  function initCalculadora() {
    const form = $("#form-ahorro");
    const sel = $("#ahorro-plan");
    const input = $("#ahorro-pago");
    const btn = $("#ahorro-ver");
    const salida = $("#ahorro-resultado");
    const cta = $("#ahorro-cta");
    const planes = Array.isArray(CFG.planes) ? CFG.planes : [];
    if (!form || !sel || !input || !salida || !planes.length) return;

    // El <select> se repinta desde config.js: una sola fuente para los precios.
    sel.innerHTML = planes
      .map((p, i) => `<option value="${i}">${p.nombre} — ${formatoPrecio(p.precio)}/mes</option>`)
      .join("");
    const iDestacado = planes.findIndex((p) => p.destacado);
    if (iDestacado >= 0) sel.value = String(iDestacado);

    function calcular() {
      const plan = planes[Number(sel.value)] || planes[0];
      const pago = Number(String(input.value).replace(/[^\d]/g, ""));

      // Sin dato válido no se muestra resultado: nada de cifras inventadas.
      if (!pago || pago <= 0) {
        salida.className = "ahorro__result";
        salida.textContent = "Escribe cuánto pagas hoy para ver la diferencia.";
        if (cta) cta.hidden = true;
        return;
      }

      const diferencia = pago - plan.precio;
      const alAnio = Math.abs(diferencia) * 12;

      if (diferencia > 0) {
        salida.className = "ahorro__result ahorro__result--ok";
        salida.innerHTML =
          `<strong>Ahorrarías ${formatoPrecio(diferencia)} al mes</strong> con ${plan.nombre}. ` +
          `Son <strong>${formatoPrecio(alAnio)} al año</strong> frente a lo que pagas hoy.`;
      } else if (diferencia === 0) {
        salida.className = "ahorro__result";
        salida.innerHTML =
          `Con ${plan.nombre} pagarías prácticamente lo mismo que hoy, ` +
          `pero con fibra óptica de ${plan.velocidad}.`;
      } else {
        salida.className = "ahorro__result ahorro__result--warn";
        salida.innerHTML =
          `${plan.nombre} cuesta ${formatoPrecio(-diferencia)} más al mes que lo que pagas hoy. ` +
          `Compara con un plan menor de la lista o escríbenos y lo revisamos contigo.`;
      }

      if (cta) {
        cta.hidden = false;
        cta.dataset.mensaje = "Hola, usé la calculadora de la web: hoy pago " +
          formatoPrecio(pago) + " y me interesa el plan " + plan.nombre +
          " de UneFibra. ¿Me confirman cobertura e instalación?";
        initWhatsApp();
      }

      window.ufTrack && window.ufTrack("calculo_ahorro", {
        plan: plan.nombre,
        ahorro_mes: diferencia
      });
    }

    btn.addEventListener("click", calcular);
    form.addEventListener("submit", (e) => { e.preventDefault(); calcular(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); calcular(); }
    });
  }

  // ---------------- Reseñas y testimonios reales ----------------
  // Integridad de datos: aquí solo entra contenido verificable. Si el cliente
  // todavía no tiene perfil de Google ni testimonios entregados, la sección
  // queda OCULTA en vez de mostrar prueba social inventada.
  function initResenas() {
    const seccion = $("#testimonios");
    if (!seccion) return;

    const gr = (CFG.empresa && CFG.empresa.googleResenas) || {};
    const bloque = $("#resenas");
    let hay = false;

    // 1) Reseñas de Google: solo si hay enlaces reales configurados.
    if (bloque && (gr.urlPerfil || gr.urlResena)) {
      bloque.hidden = false;
      hay = true;

      const perfil = $("#resenas-perfil");
      if (perfil) {
        if (gr.urlPerfil) { perfil.href = gr.urlPerfil; perfil.hidden = false; }
        else perfil.remove();
      }

      const escribir = $("#resenas-escribir");
      if (escribir) {
        if (gr.urlResena) { escribir.href = gr.urlResena; escribir.hidden = false; }
        else escribir.remove();
      }

      // Puntaje y cantidad SOLO si el cliente los confirmó como números reales.
      const score = $("#resenas-score");
      if (score) {
        const partes = [];
        if (typeof gr.puntaje === "number") partes.push(gr.puntaje.toFixed(1) + " / 5 en Google");
        if (typeof gr.cantidad === "number") {
          partes.push(gr.cantidad + (gr.cantidad === 1 ? " reseña" : " reseñas"));
        }
        if (partes.length) {
          score.textContent = partes.join(" · ");
          score.hidden = false;
        } else {
          score.remove();
        }
      }
    }

    // 2) Testimonios reales entregados por el cliente (config.js → testimonios).
    const grid = $("#testimonios-grid");
    const lista = Array.isArray(CFG.testimonios) ? CFG.testimonios : [];
    if (grid && lista.length) {
      grid.hidden = false;
      hay = true;
      grid.innerHTML = lista.map((t) => {
        const iniciales = t.iniciales || String(t.nombre || "")
          .split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase();
        return '<figure class="testimonial">' +
          '<blockquote class="testimonial__quote"><p>“' + (t.frase || "") + '”</p></blockquote>' +
          '<figcaption class="testimonial__author">' +
            '<span class="testimonial__avatar" aria-hidden="true">' + iniciales + '</span>' +
            '<span class="testimonial__data"><strong>' + (t.nombre || "") + '</strong>' +
            '<span class="testimonial__place">' + (t.sector || "") + '</span></span>' +
          '</figcaption></figure>';
      }).join("");
    }

    // 3) Sin contenido verificable no se muestra ninguna sección vacía.
    seccion.hidden = !hay;

    // Los enlaces del nav/footer a #testimonios no deben quedar apuntando a una
    // sección oculta: si no hay nada que mostrar, también se ocultan.
    if (!hay) {
      $$('a[href="#testimonios"]').forEach((a) => { a.hidden = true; });
    }
  }

  function initPWA() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch((err) => {
          console.warn("Service worker no registrado:", err);
        });
      });
    }
  }

  // ---------------- Año del footer ----------------
  function initYear() {
    const el = $("#year");
    if (el) el.textContent = new Date().getFullYear();
  }

  // ---------------- Arranque ----------------
  document.addEventListener("DOMContentLoaded", () => {
    initNav();
    initWhatsApp();
    initContacto();
    initEmpresa();
    initRedes();
    initResenas();
    initPlanes();
    initCobertura();
    initCoberturaModal();
    initForm();
    initAnalytics();
    initRecomendador();
    initCalculadora();
    initYear();
    initPWA();
    programarCargaFirebase();
  });
})();
