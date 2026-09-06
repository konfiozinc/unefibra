/* ============================================================
 * UNEFIBRAS SAS — Configuración centralizada
 * ------------------------------------------------------------
 * Toda la información pública editable vive aquí (sección 41
 * del Expediente Técnico Maestro). No dupliques estos datos en
 * los archivos HTML: renderízalos desde este objeto.
 *
 * IMPORTANTE (sección 36): no inventar datos empresariales.
 * Los valores marcados con [PLACEHOLDER] deben reemplazarse
 * por los datos reales de la empresa antes de publicar.
 * ============================================================ */

window.UNEFIBRAS_CONFIG = {
  /* ------------------------------------------------------------
   * Datos de la empresa
   * ---------------------------------------------------------- */
  empresa: {
    nombre: "UneFibra",
    nombreLegal: "UNE FIBRA SAS",
    slogan: "Conectamos lo que más importa",
    ciudad: "Medellín",
    departamento: "Antioquia",
    pais: "Colombia",
    // --- Placeholders: reemplazar con datos reales ---
    nit: "9020925655",
    direccion: "[Dirección]",
    telefono: "302 858 9954",
    telefonos: ["302 858 9954", "321 749 0310"],
    email: "[correo@unefibras.co]",
    redes: {
      facebook: "[URL Facebook]",
      instagram: "[URL Instagram]",
      tiktok: "[URL TikTok]"
    }
  },

  /* ------------------------------------------------------------
   * WhatsApp
   * Número en formato internacional SIN "+" ni espacios.
   * Ejemplo real: "573001234567"
   * ---------------------------------------------------------- */
  whatsapp: {
    // WhatsApp de la empresa: 302 858 9954 → +57 302 858 9954
    numero: "573028589954",
    // Mensaje preconstruido que se usa para el botón flotante
    mensajeDefault: "Hola, quiero información sobre los planes de Internet por fibra óptica de UneFibra."
  },

  /* ------------------------------------------------------------
   * Planes públicos (extraídos del volante UFIBRA.jpeg)
   * Velocidad y precio SON configurables. En la plataforma estos
   * valores se leen desde Firestore (colección `planes`); aquí se
   * define el valor inicial y el fallback cuando Firebase aún no
   * está configurado.
   * ---------------------------------------------------------- */
  planBeneficios: [
    "100% fibra óptica hasta tu hogar",
    "Máxima velocidad y estabilidad",
    "Soporte cercano y confiable",
    "Sin contratos ni cláusulas ocultas",
    "Instalación también para reportados"
  ],
  planes: [
    { nombre: "Básico 100 Mbps", velocidad: "100 Mbps", precio: 50000,  descripcion: "Ideal para navegar, redes sociales y streaming en HD." },
    { nombre: "150 Mbps", velocidad: "150 Mbps", precio: 60000,  descripcion: "Para hogares con varios dispositivos conectados." },
    { nombre: "200 Mbps", velocidad: "200 Mbps", precio: 70000,  descripcion: "Teletrabajo, estudio y streaming 4K sin interrupciones." },
    { nombre: "250 Mbps", velocidad: "250 Mbps", precio: 85000,  descripcion: "Más velocidad para jugar y descargar sin límites." },
    { nombre: "Ultra 300 Mbps", velocidad: "300 Mbps", precio: 100000, descripcion: "Máxima velocidad para hogares exigentes." }
  ],

  /* ------------------------------------------------------------
   * Cobertura (zona inicial de operación)
   * ---------------------------------------------------------- */
  cobertura: {
    zonas: ["Medellín"],
    nota: "Iniciamos operación en Medellín, Antioquia. Próximamente ampliaremos la cobertura."
  },

  /* ------------------------------------------------------------
   * Firebase (sección 41)
   * La configuración pública de Firebase Web puede estar en el
   * frontend. Las credenciales administrativas JAMÁS van aquí.
   *
   * firebaseEnabled = false  →  la landing funciona sin backend
   * y, para el formulario, usa WhatsApp como canal real.
   * firebaseEnabled = true   →  el formulario escribe en la
   * colección `solicitudes_contacto` con estado "NUEVA".
   * ---------------------------------------------------------- */
  firebase: {
    habilitado: true, // ← conectado al proyecto une-fibra
    config: {
      apiKey: "AIzaSyAwQu8B6OafKszXSuL373Di4wyvotc9VWY",
      authDomain: "une-fibra.firebaseapp.com",
      projectId: "une-fibra",
      storageBucket: "une-fibra.firebasestorage.app",
      messagingSenderId: "215843872771",
      appId: "1:215843872771:web:4620cbc4a46b9b53a0ae36"
    }
  },

  /* ------------------------------------------------------------
   * Firebase App Check (opcional, sección 27)
   * Refuerza que las peticiones provengan de esta app. Requiere
   * configurar reCAPTCHA v3 en la consola y pegar aquí la site key.
   * Mientras `habilitado` sea false, no se activa (evita bloqueos
   * durante el desarrollo sin credenciales).
   * ---------------------------------------------------------- */
  appCheck: {
    habilitado: false,
    siteKey: "[RECAPTCHA_SITE_KEY]"
  },

  /* ------------------------------------------------------------
   * Planes de interés para el formulario "Quiero Internet"
   * ---------------------------------------------------------- */
  planesInteres: [
    "Básico 100 Mbps",
    "150 Mbps",
    "200 Mbps",
    "250 Mbps",
    "Ultra 300 Mbps"
  ],

  /* ------------------------------------------------------------
   * Métodos de pago iniciales. Se gestionan desde el panel en la
   * colección `metodos_pago`; esto es solo el valor por defecto
   * mientras no existan métodos configurados.
   * ---------------------------------------------------------- */
  metodosPagoPorDefecto: [
    "Nequi",
    "Daviplata",
    "Bancolombia",
    "Davivienda",
    "Transferencia",
    "Efectivo",
    "Otro"
  ],

  /* ------------------------------------------------------------
   * Barrios (placeholder) — se muestran como sugerencia
   * ---------------------------------------------------------- */
  barriosSugeridos: [
    "[Barrio 1]",
    "[Barrio 2]",
    "[Barrio 3]"
  ]
};
