# Auditoría profunda de UneFibra

**Fecha:** 16 de octubre de 2026  
**Alcance:** sitio público, panel, reglas de Firestore, Cloud Functions, SEO, rendimiento, dependencias y costos.  
**Estado general:** 🟡 **Operativo con pendientes de seguridad y mantenimiento.**

## Resumen ejecutivo

- Los cuatro sitios clave comprobados responden **HTTP 200**: Postres Snoopy, UneFibra, PlatoScan y Card.
- Las reglas de Firestore no permiten lecturas anónimas de colecciones administrativas. Las escrituras de auditoría e historial están bloqueadas desde el cliente.
- Se encontró y corrigió una vía de XSS almacenado/reflejado en la landing: datos editables de planes y cobertura se insertaban como HTML sin escape.
- `npm audit` reportó **37 vulnerabilidades** en el árbol de dependencias de Cloud Functions: **1 crítica, 4 altas y 32 moderadas**. Son mayoritariamente transitivas; el informe de npm propone cambios mayores en Firebase Admin y `firebase-functions-test`, por lo que requieren actualización controlada.

## Hallazgos

| Severidad | Hallazgo | Evidencia e impacto | Acción / solución |
|---|---|---|---|
| **Alto** | Datos dinámicos de planes y cobertura se insertaban sin escapar en `innerHTML`. | `assets/js/main.js`: nombres, velocidad, descripción, beneficios y zonas alimentan tarjetas, recomendador y calculadora. Un valor malicioso podía ejecutar HTML/JavaScript en visitantes. | **Corregido** con `escHtml()` en las inserciones afectadas. Revisar antes de añadir nuevos datos dinámicos a HTML. |
| **Crítico** | Dependencias transitivas con avisos de seguridad. | `npm audit` sobre `functions/package-lock.json`: 37 total (1 crítica, 4 altas, 32 moderadas). Varias rutas llegan por Firebase Admin, `@grpc/grpc-js` y dependencias de pruebas. | Actualizar con rama de mantenimiento, revisar breaking changes, ejecutar pruebas/emuladores y desplegar Functions después de aprobación operativa. Evitar `npm audit fix --force`: npm propone saltos mayores de versión. |
| **Medio** | Escrituras públicas de solicitudes y tokens pueden generar consumo abusivo. | `firestore.rules` valida forma y longitudes, pero no puede imponer cuota por IP/usuario anónimo. Un tercero puede automatizar escrituras válidas y elevar costos/ruido operativo. | Activar Firebase App Check y añadir rate limiting del lado servidor o CAPTCHA/endpoint controlado; vigilar alertas de cuota y presupuesto en GCP. |
| **Medio** | Procesos programados recorren colecciones completas. | `functions/src/index.js`: el motor diario consulta todos los clientes y servicios activos y realiza lecturas de cliente por servicio. El costo y la duración crecen con el volumen. | Medir volumen actual y métricas de ejecución. Añadir filtros por vencimiento/estado, paginación por lotes y límites de concurrencia cuando el volumen lo justifique. |
| **Medio** | Validación y lint no están reproducibles en el estado local. | `npm run lint` falla: no encuentra configuración `google` desde `.eslintrc.js`. El `npm audit` sí pudo leer el lockfile al ejecutarse desde `functions`, pero el entorno tuvo fallos posteriores de red. | Instalar/declarar `eslint-config-google` en dependencias de desarrollo y asegurar acceso al registry en CI; volver a ejecutar auditoría. |
| **Bajo** | Sin revisión visual móvil en dispositivo real. | La inspección de código no confirma medidas ni comportamiento táctil real. | Validar landing y panel en celular real antes de cambios de publicación. |

## Sitio público y SEO

- `index.html` incluye título, descripción, canonical, Open Graph, Twitter Cards y JSON-LD `LocalBusiness`.
- Los metadatos y el JSON-LD son coherentes con UneFibra SAS y el sitio de producción. El JSON-LD declara área de cobertura, horario y canales de contacto.
- `robots.txt` y `sitemap.xml` están presentes. Los cuatro sitios clave respondieron HTTP 200 en la comprobación.
- Las redes no se muestran mientras no estén confirmadas en `assets/js/config.js`; evita enlaces inventados o rotos.
- CSS y fuentes se sirven localmente. El video de carrusel está en WebM/MP4 optimizado; el recurso individual más pesado localizado fue `assets/img/carrusel/video-equipo.mp4` (~363 KB). No se encontró una imagen individual superior a 300 KB en `assets/`.
- Nota: no se hizo una prueba de rendimiento de laboratorio ni se midieron Core Web Vitals.

## Panel y Firebase

- Autenticación usa Firebase Auth; no se halló contraseña codificada en texto plano en el código auditado. El alta de usuarios usa `admin.auth().createUser()` desde callable protegida por rol SUPERADMIN.
- Las reglas restringen clientes, pagos, servicios, usuarios, auditoría y configuración a usuarios autenticados con rol activo. Los roles se leen de `usuarios/{uid}`; no se confía en el rol enviado por el navegador.
- `solicitudes_contacto` limita longitud y tipo de nombre/teléfono. `tokens_notificacion` limita tipo y longitud.
- `posts` permite leer públicamente solo documentos `PUBLICADO`; borradores requieren rol operativo.
- El frontend usa una utilidad `esc()` compartida en los módulos del panel. La revisión por búsqueda no encontró una ruta inequívoca adicional de XSS en dichos módulos; esto no equivale a una prueba dinámica completa.
- No se detectaron `eval()` ni `new Function()` en los directorios revisados.

## Costos y arquitectura

- Los procesos programados tienen consultas repetibles y lecturas por elemento. El patrón actual es razonable para volúmenes pequeños, pero puede crecer linealmente con el número de servicios/clientes.
- Las consultas de detalle usan filtros y algunas emplean `limit(1)`. Los índices compuestos están declarados en `firestore.indexes.json`.
- No se modificaron índices, reglas o funciones porque requieren validación contra el proyecto Firebase y el volumen real del cliente.
- El repositorio contiene archivos locales identificados como credenciales y exportaciones de datos; no se abrieron ni se incluyeron en este informe. `.gitignore` excluye esos nombres y archivos de clientes. Confirmar con `git check-ignore` antes de añadir nuevos archivos sensibles.

## Cambios y validación

- Cambio aplicado: escape HTML en `assets/js/main.js` para contenido dinámico mostrado en tarjetas de planes, beneficios, cobertura, recomendador y calculadora.
- `node --check assets/js/main.js`: **correcto**.
- `git diff --check`: **correcto**.
- `npm run lint`: **no ejecutable**, falta `eslint-config-google`.
- `npm audit`: completado una vez con conectividad; reportó 37 vulnerabilidades. No se ejecutó una actualización automática.
- No se desplegó ningún cambio a Firebase ni a GitHub Pages.

## Pendientes para aprobación/operación

1. Plan de actualización de dependencias y pruebas de Functions, especialmente Firebase Admin y dependencias transitivas con severidad alta/crítica.
2. Completar App Check y controles antiabuso de solicitudes públicas.
3. Revisar las 4 vulnerabilidades altas y 32 moderadas pendientes.
4. Verificar costos y tiempos reales de los procesos diarios en Firebase/GCP.



## Adenda - 17 de octubre de 2026

- La proteccion anti-spam ya existia antes de esta sesion: el formulario publico incluye un honeypot visualmente oculto y descarta el envio antes de WhatsApp y Firestore cuando esta lleno. No se duplico el control.
- Se agrego `eslint-config-google` y se ajusto ESLint para mantener reglas de calidad y desactivar reglas de estilo/documentacion que generaban mas de 700 cambios mecanicos en el codigo existente. Se corrigieron los cuatro errores restantes que reportaba lint.
- Se actualizo `proxy-addr` de 2.0.7 a 2.0.8, compatible dentro de Express 4. Npm ya no reporta la vulnerabilidad critica GHSA-jqcg-44mw-7w3h. Permanecen las 4 altas y 32 moderadas.
- Verificacion final: `npm audit` reporta 0 criticas, 4 altas y 32 moderadas; los cuatro sitios publicos responden HTTP 200; `npm run lint` termina sin errores. El cambio de dependencias afecta Cloud Functions, no el contenido estatico de GitHub Pages.

## Adenda - 17 de octubre de 2026 (actualizacion compatible de dependencias)

- Se aplicaron actualizaciones de dependencias dentro de los rangos semver existentes, sin `--force` ni cambios de version mayor. El cambio queda registrado en `functions/package-lock.json`.
- `npm audit` actualizado: **0 criticas, 2 altas y 28 moderadas** (30 total). Bajaron las altas de 4 a 2 y las moderadas de 32 a 28.
- Las altas restantes llegan por `firebase-admin` y `node-forge`. npm ofrece resolverlas con `firebase-admin` 14.5.0, salto mayor frente a la rama 12 instalada; requiere validar compatibilidad de Cloud Functions antes de adoptar o desplegar.
- `npm run lint`: correcto. El entorno usa Node 24 aunque `functions/package.json` requiere Node 22, por lo que npm avisa de esa diferencia; no se desplego nada.
- No se modificaron reglas de Firebase ni se desplegaron Cloud Functions.