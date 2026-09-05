/* ============================================================
 * UNEFIBRAS SAS — Landing page
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
    const numero = (CFG.whatsapp && CFG.whatsapp.numero) || "573028589954";
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

  // ---------------- Datos de empresa ----------------
  function initEmpresa() {
    const emp = CFG.empresa || {};
    const set = (sel, val) => { const el = $(sel); if (el && val != null) el.textContent = val; };
    set(".js-emp-telefono", emp.telefono);
    set(".js-emp-email", emp.email);
    set(".js-emp-direccion", emp.direccion);
    set(".js-emp-legal", emp.nombreLegal);
    set(".js-emp-nit", emp.nit ? `NIT: ${emp.nit}` : "NIT: [NIT]");
    document.title = `${emp.nombre} — ${emp.slogan} en ${emp.ciudad}`;
  }

  // ---------------- Planes ----------------
  function renderPlan(plan) {
    const precio = formatoPrecio(plan.precio);
    const duracion = plan.duracion || 30;
    const beneficios = (CFG.planBeneficios || plan.beneficios || []).map((b) => `<li>${b}</li>`).join("");

    return `
      <article class="plan-card">
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

    // Repoblar barrios sugeridos
    const dl = $("#barrios");
    if (dl) {
      (CFG.barriosSugeridos || []).forEach((b) => {
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

  // ---------------- Formulario "Quiero Internet" ----------------
  function initForm() {
    const form = $("#form-solicitud");
    if (!form) return;
    const status = $("#form-status");
    const btn = $("#form-submit");

    const firebaseActivo = CFG.firebase && CFG.firebase.habilitado;
    let db = null;

    if (firebaseActivo && window.firebase) {
      try {
        if (!firebase.apps.length) firebase.initializeApp(CFG.firebase.config);
        db = firebase.firestore();
      } catch (e) {
        console.warn("Firebase no se pudo inicializar; se usará WhatsApp como respaldo.", e);
      }
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.className = "form__note";
      status.textContent = "";

      const data = Object.fromEntries(new FormData(form).entries());
      const nombre = (data.nombre || "").trim();
      const telefono = (data.telefono || "").trim();

      // Validación básica
      if (!nombre || !telefono) {
        status.textContent = "Por favor completa al menos tu nombre y teléfono.";
        status.className = "form__note err";
        return;
      }

      btn.disabled = true;
      btn.textContent = "Enviando…";

      try {
        if (db) {
          // Firestore: colección solicitudes_contacto con estado NUEVA
          await db.collection("solicitudes_contacto").add({
            nombre,
            telefono,
            whatsapp: (data.whatsapp || "").trim() || telefono,
            direccion: (data.direccion || "").trim() || null,
            barrio: (data.barrio || "").trim() || null,
            ciudad: (data.ciudad || "").trim() || "Medellín",
            planInteres: data.planInteres || null,
            observaciones: (data.observaciones || "").trim() || null,
            estado: "NUEVA",
            createdAt: new Date().toISOString()
          });
          status.textContent = "¡Solicitud enviada! Te contactaremos pronto.";
          status.className = "form__note ok";
          form.reset();
        } else {
          // Respaldo real (sin backend): abrir WhatsApp con los datos.
          const mensaje = [
            "Hola, quiero solicitar Internet por fibra óptica de UneFibra.",
            `Nombre: ${nombre}`,
            `Teléfono: ${telefono}`,
            data.whatsapp ? `WhatsApp: ${data.whatsapp}` : "",
            data.direccion ? `Dirección: ${data.direccion}` : "",
            data.barrio ? `Barrio: ${data.barrio}` : "",
            data.ciudad ? `Ciudad: ${data.ciudad}` : "",
            data.planInteres ? `Plan: ${data.planInteres}` : "",
            data.observaciones ? `Observaciones: ${data.observaciones}` : ""
          ].filter(Boolean).join("\n");

          status.textContent = "Se abrirá WhatsApp para completar tu solicitud.";
          status.className = "form__note ok";
          window.open(urlWhatsApp(mensaje), "_blank", "noopener");
        }
      } catch (err) {
        console.error("Error al enviar la solicitud:", err);
        status.textContent = "No fue posible enviar la solicitud. Intenta nuevamente.";
        status.className = "form__note err";
      } finally {
        btn.disabled = false;
        btn.textContent = "Enviar solicitud";
      }
    });
  }

  // ---------------- PWA ----------------
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
    initEmpresa();
    initPlanes();
    initCobertura();
    initForm();
    initYear();
    initPWA();
  });
})();
