/* ============================================================
 * UneFibra · Agente IA (chat flotante)
 * Llama al backend: https://unefibra-agente.konfiozinc.workers.dev
 * Con respaldo local si el backend no responde.
 * ============================================================ */
(function () {
  "use strict";

  var BACKEND = "https://unefibra-agente.konfiozinc.workers.dev";
  var WHATSAPP = "573028589954";

  var history = [];
  var open = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildUI() {
    var wrap = el("div", "uf-agent");
    wrap.innerHTML =
      '<div class="uf-agent__chat" role="dialog" aria-label="Asesor UneFibra">' +
        '<div class="uf-agent__head">' +
          '<div class="uf-agent__avatar">UF</div>' +
          '<div class="uf-agent__meta"><div class="uf-agent__name">Asesor UneFibra</div>' +
          '<div class="uf-agent__status"><span class="uf-agent__dot"></span> En línea</div></div>' +
          '<button class="uf-agent__close" aria-label="Cerrar chat">✕</button>' +
        '</div>' +
        '<div class="uf-agent__body"></div>' +
        '<div class="uf-agent__chips"></div>' +
        '<div class="uf-agent__input">' +
          '<textarea rows="1" placeholder="Escribe tu mensaje…" aria-label="Escribe tu mensaje"></textarea>' +
          '<button aria-label="Enviar">➤</button>' +
        '</div>' +
      '</div>' +
      '<button class="uf-agent__fab" aria-label="Abrir chat">💬</button>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function addMsg(text, quien) {
    var body = document.querySelector(".uf-agent__body");
    var m = el("div", "uf-agent__msg uf-agent__msg--" + quien);
    m.textContent = text;
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }

  function typing(on) {
    var old = document.querySelector(".uf-agent__typing");
    if (on) {
      if (old) return;
      var t = el("div", "uf-agent__typing");
      t.innerHTML = "<span></span><span></span><span></span>";
      document.querySelector(".uf-agent__body").appendChild(t);
    } else if (old) { old.remove(); }
  }

  function localFallback(msg) {
    var q = String(msg || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/precio|cuesta|valor|tarifa|cuanto|plan|planes|velocidad|megas|mbps/.test(q)) {
      return "Planes de Internet por fibra (30 días):\n100 Mbps $50.000 · 150 Mbps $60.000 · 200 Mbps $70.000 · 250 Mbps $85.000 · 300 Mbps $100.000.\n\n¿Para qué usas Internet? Te recomiendo la velocidad.";
    }
    if (/cobertura|barrio|zona|llegamos|cubren|disponibilidad|sector/.test(q)) {
      return "Cubrimos el occidente de Medellín: Ciudadela Nuevo Occidente, Robledo (El Cucaracho, La Campiña), Nazaret, La Aurora, La Libertad, El Tirol y sectores aledaños. Dime tu barrio o sector y verificamos. 📍";
    }
    if (/contrato|reportado|reportados|clausula/.test(q)) {
      return "Sin contratos ni cláusulas, e instalamos también a reportados. 😊";
    }
    if (/pago|pagar|nequi|daviplata|bancolombia|davivienda|transferencia|efectivo/.test(q)) {
      return "Aceptamos Nequi, Daviplata, Bancolombia, Davivienda, transferencia y efectivo. 💳";
    }
    if (/correo|email|e-mail|escribir|contacto/.test(q)) {
      return "Puedes escribirnos a unefibra81@gmail.com o por WhatsApp al 302 858 9954. 📧";
    }
    if (/falla|no funciona|caido|lento|soporte|sin servicio/.test(q)) {
      return "Escríbenos por WhatsApp al 302 858 9954 con tu nombre y dirección; soporte te atiende. 🙏";
    }
    return "Con gusto te ayudo 😊. Cuéntame: ¿planes y precios, cobertura, instalación o pagos? También puedes escribirnos por WhatsApp al 302 858 9954.";
  }

  function send(text) {
    var input = document.querySelector(".uf-agent__input textarea");
    if (!text || !text.trim()) return;
    addMsg(text.trim(), "user");
    input.value = "";
    typing(true);
    history.push({ role: "user", content: text.trim() });
    var hist = history.slice(-8);

    fetch(BACKEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.trim(), history: hist })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("http")); })
      .then(function (d) {
        typing(false);
        var reply = (d && d.reply ? String(d.reply) : "").trim() || localFallback(text);
        addMsg(reply, "bot");
        history.push({ role: "assistant", content: reply });
        if (/whatsapp|302 858 9954/.test(reply)) addWa();
      })
      .catch(function () {
        typing(false);
        var reply = localFallback(text);
        addMsg(reply, "bot");
        history.push({ role: "assistant", content: reply });
      });
  }

  function addWa() {
    var body = document.querySelector(".uf-agent__body");
    var a = el("a", "uf-agent__wa");
    a.href = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent("Hola UneFibra, quiero información sobre Internet por fibra óptica.");
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "💬 Continuar por WhatsApp";
    body.appendChild(a);
    body.scrollTop = body.scrollHeight;
  }

  function initChips() {
    var chips = document.querySelector(".uf-agent__chips");
    var msgs = ["Ver planes y precios", "¿Tienen cobertura en mi barrio?", "¿Instalan a reportados?", "Quiero contratar Internet", "Métodos de pago"];
    msgs.forEach(function (m) {
      var b = el("button", null, m);
      b.addEventListener("click", function () { send(m); });
      chips.appendChild(b);
    });
  }

  function bind() {
    var wrap = document.querySelector(".uf-agent");
    var fab = wrap.querySelector(".uf-agent__fab");
    var close = wrap.querySelector(".uf-agent__close");
    var chat = wrap.querySelector(".uf-agent__chat");
    var input = wrap.querySelector(".uf-agent__input textarea");
    var sendBtn = wrap.querySelector(".uf-agent__input button");

    function toggle(v) {
      open = typeof v === "boolean" ? v : !open;
      chat.classList.toggle("uf-agent__chat--open", open);
      fab.classList.toggle("uf-agent__fab--hidden", open);
      if (open) input.focus();
    }
    fab.addEventListener("click", function () { toggle(); });
    close.addEventListener("click", function () { toggle(false); });
    sendBtn.addEventListener("click", function () { send(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });

    addMsg("¡Hola! 👋 Soy el asesor de UneFibra. Internet por fibra óptica 100% en Medellín, sin contratos. ¿En qué te ayudo?", "bot");
  }

  function init() {
    buildUI();
    initChips();
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
