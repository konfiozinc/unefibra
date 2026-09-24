/* ============================================================
 * UneFibra SAS — Generador del código QR de WhatsApp
 * ------------------------------------------------------------
 * Crea `assets/img/qr-whatsapp.png`: un QR de 250×250 con el logo
 * de la empresa en el centro, que abre el WhatsApp oficial.
 *
 * Uso:
 *   npm install qrcode sharp jsqr
 *   node tools/generar-qr.js
 *
 * Verificación incluida: al final DECODIFICA el PNG generado y
 * comprueba que el contenido coincide con el enlace esperado.
 * (El nivel de corrección H permite tapar el centro con el logo.)
 * ============================================================ */

const sharp = require("sharp");
const QRCode = require("qrcode");
const jsQR = require("jsqr");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const LOGO = path.join(RAIZ, "assets", "img", "logo.png");
const SALIDA = path.join(RAIZ, "assets", "img", "qr-whatsapp.png");

// Enlace de destino y estilo (deben coincidir con assets/js/config.js)
const NUMERO = "573044654987"; // WhatsApp oficial: 304 465 4987
const URL = `https://wa.me/${NUMERO}?text=${encodeURIComponent("Hola, quiero saber más sobre UneFibra")}`;
const TAM = 250;       // 250×250 px
const MARGEN = 2;      // módulos de silencio
const LOGO_PCT = 0.28; // 28 % del ancho (el nivel H tolera hasta ~30 %)

(async () => {
  // 1) QR con la paleta de la marca
  const qr = await QRCode.toBuffer(URL, {
    type: "png",
    width: TAM,
    margin: MARGEN,
    errorCorrectionLevel: "H", // alta tolerancia: permite el logo en el centro
    color: { dark: "#081a3aff", light: "#ffffffff" }
  });

  // 2) Logo con placa blanca redondeada detrás (para que se lea y no rompa el escaneo)
  const ladoLogo = Math.round(TAM * LOGO_PCT);
  const pad = Math.round(ladoLogo * 0.16);
  const placa = Math.round(ladoLogo + pad * 2);
  const fondoPlaca = Buffer.from(
    `<svg width="${placa}" height="${placa}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${placa}" height="${placa}" rx="${Math.round(placa * 0.18)}" fill="#ffffff"/>
     </svg>`
  );
  const placaPng = await sharp(fondoPlaca).png().toBuffer();
  const logoPng = await sharp(LOGO)
    .resize(ladoLogo, ladoLogo, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const centro = Math.round((TAM - placa) / 2);

  const salida = await sharp(qr)
    .composite([
      { input: placaPng, top: centro, left: centro },
      { input: logoPng, top: Math.round((TAM - ladoLogo) / 2), left: Math.round((TAM - ladoLogo) / 2) }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(SALIDA, salida);

  // 3) Verificación: decodificar el PNG resultante
  const { data, info } = await sharp(SALIDA).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const leido = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  const meta = await sharp(SALIDA).metadata();

  console.log(`QR generado: ${meta.width}x${meta.height} | ${(fs.statSync(SALIDA).size / 1024).toFixed(1)} KB`);
  console.log("Decodificado:", leido ? leido.data : "(no se pudo leer)");
  if (!leido || leido.data !== URL) {
    console.error("FALLO: el QR generado no se decodifica o no coincide con la URL esperada.");
    process.exit(1);
  }
  console.log("OK: el QR se decodifica y apunta al WhatsApp oficial.");
})().catch((e) => { console.error("ERROR:", e.message); process.exit(2); });
