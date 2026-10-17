# Activar Firebase App Check para UneFibra

Esta guía prepara App Check para proteger la escritura del formulario público en Firestore. El sitio ya sabe cargar e inicializar App Check cuando se configura una clave válida. El formulario conserva WhatsApp como respaldo.

## 1. Crear las claves reCAPTCHA v3

1. Entra a [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin/create) con la cuenta propietaria de UneFibra.
2. Crea una clave **reCAPTCHA v3** para el dominio `konfiozinc.github.io`. Agrega `unefibra.co` solo si ese dominio ya está en uso.
3. Conserva la **site key** y la **secret key**. La site key es pública; la secret key es privada.

## 2. Registrar el proveedor en Firebase

1. Abre [Firebase Console](https://console.firebase.google.com/) y selecciona el proyecto **une-fibra**.
2. En el menú, abre **Seguridad → App Check**.
3. En **Apps**, selecciona la aplicación web de UneFibra (`une-fibra-web`) y elige **reCAPTCHA v3**.
4. Pega la **secret key** de reCAPTCHA en Firebase y registra el proveedor.

**No pegues ni publiques la secret key en el repositorio.** Solo la site key va en la configuración web.

## 3. Conectar la landing

En `assets/js/config.js`, dentro de `appCheck`, reemplaza la clave de ejemplo y activa la opción:

```js
appCheck: {
  habilitado: true,
  siteKey: "6L...site-key-publica..."
},
```

Publica la landing después de guardar el cambio. Al iniciar Firebase, `main.js` carga el SDK de App Check antes de Firestore. Si App Check no inicia, el formulario no se bloquea y mantiene el respaldo de WhatsApp.

## 4. Revisar antes de exigir App Check

1. En Firebase Console, abre **Seguridad → App Check → APIs**.
2. Revisa las métricas de **Cloud Firestore** durante al menos 24 horas y confirma que las solicitudes legítimas aparecen como verificadas.
3. **No actives todavía la aplicación obligatoria para Firestore:** el panel de administración también usa Firestore y aún debe integrar App Check. Si se exige antes, puede bloquear el panel.
4. Cuando el panel también esté integrado y las métricas sean correctas, el responsable del proyecto puede activar la aplicación obligatoria para Cloud Firestore.

## Alcance del control anti-spam actual

La landing incorpora honeypot, una espera mínima de 2,5 segundos y un intervalo de un minuto entre registros exitosos desde el mismo navegador. Estos controles básicos reducen automatizaciones simples, pero un bot que escriba directamente a Firestore puede omitirlos. La protección efectiva contra clientes falsos requiere App Check configurado y, después de validar todos los clientes del proyecto, exigido desde Firebase.

Referencia oficial: [App Check con reCAPTCHA v3 en aplicaciones web](https://firebase.google.com/docs/app-check/web/recaptcha-provider) · [Métricas de solicitudes de App Check](https://firebase.google.com/docs/app-check/monitor-metrics).
