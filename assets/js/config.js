/* ============================================================
 * UNEFIBRAS SAS — Configuración centralizada
 * ------------------------------------------------------------
 * Toda la información pública editable vive aquí (sección 41
 * del Expediente Técnico Maestro). No dupliques estos datos en
 * los archivos HTML: renderízalos desde este objeto.
 *
 * IMPORTANTE (sección 36): no inventar datos empresariales.
 * Los valores marcados con // TODO: Reemplazar con dato real
 * están pendientes de confirmación por parte de la empresa.
 *
 * Estado de los datos (revisado):
 *   ✔ NIT, teléfonos, WhatsApp  → confirmados
 *   ⚠ dirección, email          → provisionales (proporcionados por el cliente)
 *   ⚠ redes sociales            → las cuentas todavía no existen
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
    nit: "9020925655",

    // TODO: Reemplazar con dato real (provisional, confirmado por el cliente).
    // Si la dirección cambia, actualízala también en el JSON-LD de index.html.
    direccion: "Calle 100 # 15-20, Medellín",

    telefono: "302 858 9954",
    telefonos: ["302 858 9954", "321 749 0310"],

    // TODO: Reemplazar con dato real cuando exista la cuenta corporativa.
    // (El dominio unefibra.co ya está en uso por el panel administrativo.)
    email: "info@unefibra.co",

    // Horario de atención (se muestra en el footer y en el JSON-LD).
    horario: "Lunes a sábado, 8:00 a.m. – 6:00 p.m.",
    horarioSchema: "Mo-Sa 08:00-18:00",

    // TODO: Reemplazar con dato real — las cuentas AÚN NO EXISTEN.
    // Mientras `confirmadas` sea false, la landing NO enlaza a redes
    // sociales: así se evitan enlaces muertos o cuentas de terceros.
    // Cuando las cuentas existan: pega las URLs reales y pon
    // `confirmadas: true` (aparecerán en el footer y en `sameAs` del JSON-LD).
    redes: {
      confirmadas: false,
      facebook: "https://facebook.com/unefibra",
      instagram: "https://instagram.com/unefibra",
      tiktok: "https://tiktok.com/@unefibra"
    }
  },

  /* ------------------------------------------------------------
   * SEO — fuente de verdad para <title>, meta descripción y OG.
   * El <title> y la meta descripción también están escritos de
   * forma estática en index.html (para que los vean los bots sin
   * ejecutar JavaScript). Si cambias algo aquí, replica el cambio
   * en index.html y en el JSON-LD.
   * ---------------------------------------------------------- */
  seo: {
    titulo: "Internet Fibra Óptica en Medellín | UneFibra SAS — Planes desde $50.000",
    descripcion:
      "Internet 100% fibra óptica en Medellín. Planes desde $50.000, sin contratos, instalación rápida. ¡Consulta cobertura en tu barrio!",
    url: "https://konfiozinc.github.io/unefibra/",
    imagen: "https://konfiozinc.github.io/unefibra/assets/img/og-image.png"
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
   * colección `solicitudes_contacto` con estado "NUEVA"
   * (además de abrir WhatsApp con los datos).
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
    // TODO: Reemplazar con dato real (site key de reCAPTCHA v3) si se activa.
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
   * Barrios sugeridos (autocompletado del formulario).
   * Son barrios reales de Medellín usados como sugerencia; no
   * implican cobertura confirmada (esa se valida al contactar).
   * ---------------------------------------------------------- */
  barriosSugeridos: [
    "Belén",
    "Laureles",
    "La América",
    "Robledo",
    "Castilla",
    "Doce de Octubre",
    "Aranjuez",
    "Manrique",
    "Buenos Aires",
    "El Poblado",
    "Guayabal",
    "San Javier",
    "La Candelaria",
    "Villa Hermosa"
  ]
};

/* ------------------------------------------------------------
 * NOTA sobre secciones estáticas de index.html
 * ------------------------------------------------------------
 * Las secciones "Garantías" y "Testimonios" viven directamente en
 * index.html (no se renderizan desde este archivo) para que su
 * contenido sea visible sin ejecutar JavaScript y para que los
 * buscadores lo indexen. Para editarlas, abre index.html.
 *
 * Los testimonios actuales son PLACEHOLDERS plausibles
 * (// TODO: Reemplazar con testimonios reales) y NO se declaran
 * como `review`/`aggregateRating` en el JSON-LD.
 * ---------------------------------------------------------- */
