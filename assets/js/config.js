/* ============================================================
 * UneFibra SAS — Configuración centralizada
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
 *   ✔ nombre legal, NIT, email, teléfonos, WhatsApp y cobertura → confirmados
 *   ⚠ dirección               → provisional (pendiente de confirmar)
 *   ⚠ redes sociales          → las cuentas todavía no existen
 *
 * Marca: SIEMPRE "UneFibra" (pegado, con U y F mayúsculas) y
 * "UneFibra SAS" como nombre legal. Nunca la escribas en mayúsculas
 * sostenidas, en plural ni separada con espacio (revisa index.html,
 * metadatos y JSON-LD antes de publicar). Ver README.md.
 * ============================================================ */

window.UNEFIBRAS_CONFIG = {
  /* ------------------------------------------------------------
   * Datos de la empresa
   * ---------------------------------------------------------- */
  empresa: {
    nombre: "UneFibra",
    // Nombre legal confirmado por el cliente.
    nombreLegal: "UneFibra SAS",
    slogan: "Conectamos lo que más importa",
    ciudad: "Medellín",
    departamento: "Antioquia",
    pais: "Colombia",

    // NIT confirmado por el cliente.
    nit: "9020925655",

    // TODO: Reemplazar con dato real (provisional, indicado por el cliente).
    // Si la dirección cambia, actualízala también en el JSON-LD de index.html.
    direccion: "Calle 100 # 15-20, Medellín",

    // Teléfono para LLAMADAS (lo usa el botón "Llamar").
    // Los datos de contacto NO se muestran como texto en la página:
    // viven aquí y los botones construyen el enlace al hacer clic.
    // OJO: "321 749 0310" (voz) y "304 465 4987" (WhatsApp) son DOS líneas
    // reales y distintas — confirmado por el cliente. No unificar.
    // El JSON-LD de index.html declara ambas: `telephone` lleva la de voz y
    // el segundo `contactPoint` la de WhatsApp (con su enlace wa.me).
    telefono: "321 749 0310",
    telefonos: ["321 749 0310"],

    // Número anterior: se conserva documentado, ya no se publica.
    telefonoAnterior: "302 858 9954",

    // Correo corporativo oficial.
    email: "unefibrasas@gmail.com",

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
    },

    // TODO: Reemplazar con datos reales — perfil de Google Business.
    // Mientras `urlPerfil` y `urlResena` estén vacíos, la landing NO muestra
    // botones de reseñas: así no se enlaza a un perfil que todavía no existe.
    // `puntaje` y `cantidad` se pintan SOLO si son números reales; nunca se
    // inventa una calificación promedio ni una cantidad de reseñas.
    googleResenas: {
      urlPerfil: "",   // ej: "https://maps.app.goo.gl/XXXX" (perfil del negocio)
      urlResena: "",   // ej: "https://g.page/r/XXXX/review" (escribir reseña)
      placeId: "",     // Place ID de Google (para traer reseñas reales por API)
      puntaje: null,   // promedio real, ej: 4.8
      cantidad: null   // total real de reseñas, ej: 37
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
   * Analytics (tarea 3.1) — PENDIENTE DEL CLIENTE.
   * Mientras los IDs estén vacíos NO se carga ningún script externo:
   * así no hay peticiones fallidas ni rastreo sin autorización.
   * Cuando el cliente los entregue, basta pegar los IDs aquí.
   * ---------------------------------------------------------- */
  analytics: {
    // TODO: Reemplazar con el ID real de Google Analytics 4 (formato "G-XXXXXXXXXX").
    ga4Id: "",
    // TODO: Reemplazar con el ID real del píxel de Meta (solo números).
    metaPixelId: ""
  },

  /* ------------------------------------------------------------
   * WhatsApp
   * Número en formato internacional SIN "+" ni espacios.
   * Ejemplo real: "573001234567"
   * ---------------------------------------------------------- */
  whatsapp: {
    // WhatsApp principal de la empresa: 304 465 4987 → +57 304 465 4987
    numero: "573044654987",
    // Número anterior (302 858 9954): se conserva documentado, ya no se usa.
    numeroAnterior: "573028589954",
    // Mensaje preconstruido que se usa para el botón flotante
    mensajeDefault: "Hola, quiero información sobre los planes de Internet por fibra óptica de UneFibra."
  },

  /* ------------------------------------------------------------
   * Planes públicos — nombres y precios confirmados por el cliente.
   * (Básico 100 · Familiar 150 · Plus 200 · Premium 250 · Ultra 300)
   * `destacado: true` marca el plan recomendado en la landing.
   * ---------------------------------------------------------- */
  planBeneficios: [
    "100% fibra óptica hasta tu hogar",
    "Máxima velocidad y estabilidad",
    "Soporte cercano y confiable",
    "Sin contratos ni cláusulas ocultas"
    // Se retiró "Instalación también para reportados": nunca se confirmó con el
    // cliente (el comentario de arriba solo respalda nombres y precios) y
    // aparecía 6 veces en la landing. Para volver a publicarla hace falta que el
    // cliente confirme por escrito si aplica siempre o solo en algunos casos.
  ],
  planes: [
    { nombre: "Básico 100 Mbps",   velocidad: "100 Mbps", precio: 50000,  descripcion: "Ideal para navegar, redes sociales y streaming en HD." },
    { nombre: "Familiar 150 Mbps", velocidad: "150 Mbps", precio: 60000,  descripcion: "Para hogares con varios dispositivos conectados.", destacado: true },
    { nombre: "Plus 200 Mbps",     velocidad: "200 Mbps", precio: 70000,  descripcion: "Teletrabajo, estudio y streaming 4K sin interrupciones." },
    { nombre: "Premium 250 Mbps",  velocidad: "250 Mbps", precio: 85000,  descripcion: "Más velocidad para jugar y descargar sin límites." },
    { nombre: "Ultra 300 Mbps",    velocidad: "300 Mbps", precio: 100000, descripcion: "Máxima velocidad para hogares exigentes." }
  ],

  /* ------------------------------------------------------------
   * Testimonios REALES (Fase 1).
   * Debe quedarse vacío hasta que el cliente entregue testimonios
   * verificables (nombre, sector y autorización para publicarlos).
   * Antes había tres testimonios de ejemplo: se retiraron porque
   * publicar reseñas inventadas es publicidad engañosa.
   * Formato: { nombre, iniciales, sector, frase }
   * ---------------------------------------------------------- */
  testimonios: [],

  /* ------------------------------------------------------------
   * Cobertura — occidente de Medellín (lista oficial del cliente).
   * OJO: la landing también lleva esta lista escrita de forma
   * estática en index.html (#cobertura) para que se vea sin
   * JavaScript y la indexen los buscadores. Este arreglo manda:
   * main.js vuelve a renderizar los chips a partir de aquí, así
   * que al cambiar la cobertura basta con editar este archivo
   * (y, opcionalmente, la copia estática del HTML).
   * La lista original repetía "Sector Las Fresitas": se dejó una
   * sola vez.
   * ---------------------------------------------------------- */
  cobertura: {
    zonas: [
      "Ciudadela Nuevo Occidente",
      "La Aurora",
      "La Libertad",
      "Sector Las Fresitas",
      "Nazaret",
      "El Tirol",
      "Robledo La Campiña",
      "El Cucaracho",
      "Mirador del Valle",
      "Los Cantares",
      "Ventó 1",
      "Mirador de la Cascada",
      "Portón Nuevo Occidente",
      "Pedregal Bajo",
      "La Montaña",
      "La Cascada",
      "Las Flores",
      "Las Violetas",
      "Sector La Campiña",
      "Sector El Cucaracho",
      "Sector Los Loquitos",
      "Sector Lusitania"
    ],
    // Zona de referencia para el mapa de la landing (barrio Robledo).
    zonaMapa: "El Cucaracho, Robledo, Medellín, Antioquia, Colombia",
    nota: "Cobertura en el occidente de Medellín y sectores aledaños. Verifica disponibilidad en tu sector al contactarnos."
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
    "Familiar 150 Mbps",
    "Plus 200 Mbps",
    "Premium 250 Mbps",
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
   * Barrios/sectores sugeridos (autocompletado del formulario).
   * Se deja vacío a propósito: main.js usa la lista de cobertura
   * (`cobertura.zonas`) para no sugerir sectores donde no hay
   * servicio. Si algún día quieres sugerencias distintas de la
   * cobertura, llena este arreglo y tendrá prioridad.
   * ---------------------------------------------------------- */
  barriosSugeridos: []
};

/* ------------------------------------------------------------
 * NOTA sobre secciones estáticas de index.html
 * ------------------------------------------------------------
 * Las secciones "Garantías", "Testimonios" y la lista de sectores
 * de "Cobertura" viven directamente en index.html (no se
 * renderizan desde este archivo) para que su contenido sea visible
 * sin ejecutar JavaScript y para que los buscadores lo indexen.
 * Para editarlas, abre index.html.
 *
 * La cobertura es la excepción parcial: `cobertura.zonas` de este
 * archivo es la fuente de verdad y main.js vuelve a pintar los
 * chips en el HTML. Mantén ambas listas en sincronía al cambiarlas.
 *
 * Los testimonios actuales son PLACEHOLDERS plausibles
 * (// TODO: Reemplazar con testimonios reales) y NO se declaran
 * como `review`/`aggregateRating` en el JSON-LD.
 * ---------------------------------------------------------- */
