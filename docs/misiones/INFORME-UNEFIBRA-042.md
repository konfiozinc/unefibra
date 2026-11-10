# UNEFIBRA-042 — Validación final local

Fecha: 10-nov-2026. Agencia: KONFÍO ZINC. Revisión: Darwin Montalvo.

**Estado: validación final local aprobada con Node 22.23.4. GO para revisión de Darwin y preparación de publicación; publicar requiere autorización expresa posterior.** No se publicó nada.

## Base preservada

Rama existente: `fix/unefibra-041-consistencia-comercial`. HEAD/base: `9ccbb85459189b9097e49daa05aade55b9f81d35`. No se creó otra rama, ni se hicieron commits, merge, push o despliegues. Se inspeccionó el estado de trabajo antes de editar; los seis archivos versionados con cambios de UNEFIBRA-041 y todos los archivos nuevos siguen presentes. Se conservaron el ZIP UNEFIBRA-041, las ocho imágenes anteriores y el bundle KZ-037.

## Defectos reproducidos y corrección limitada

1. A 390 px, Planes tiene 760 px de contenido en una región de 360 px. El desplazamiento horizontal ya funcionaba, pero no tenía indicación visible ni acceso explícito por teclado. Se añadió texto que indica cómo consultar Duración, Estado y Acciones, y una región enfocable con nombre y descripción accesibles. Se confirmó desplazamiento mediante flecha derecha y acceso a cada una de las tres columnas finales a 390 y 320 px. No se exige que las tres aparezcan simultáneamente en 320 px.
2. El encabezado mostraba 188 px de texto dentro de 148 px, recortando «DATOS FICTICIOS». En móvil ahora permite una segunda fila y ajuste de líneas. El título, menú y distintivo permanecen visibles sin desbordar la página.

Los ajustes conservan las correcciones comerciales y formularios previos. No se alteró la lógica de edición o activación de planes, autenticación o permisos.

## Relación exacta de archivos de esta misión

Archivos existentes editados, conservando el trabajo anterior:

- `admin/planes.js`: indicación de desplazamiento y atributos de accesibilidad de la tabla.
- `assets/css/admin.css`: bloque aditivo UNEFIBRA-042 para la indicación, foco y encabezado móvil.
- `tools/qa-unefibra-041.cjs`: extensión reutilizable con argumento `--unefibra-042`; conserva las comprobaciones anteriores y añade ancho 320 px, verificación del encabezado, desplazamiento, columnas y ausencia de escrituras automáticas. La ejecución 042 guarda sus imágenes en otra carpeta y no sobrescribe la evidencia 041.

Archivos nuevos:

- Este informe: `docs/misiones/INFORME-UNEFIBRA-042.md`.
- `docs/evidencias/unefibra-042/pruebas-node22.txt`: registro de suites puras/estáticas y QA visual con Node 22.
- `docs/evidencias/unefibra-042/emuladores-node22.txt`: registro final de las cinco suites de emulador con Node 22.
- `docs/evidencias/unefibra-042/emuladores-node22-intento1.txt`: primer intento conservado, afectado por timeout de carga del emulador.
- `docs/evidencias/unefibra-042/escritorio-dashboard.png`
- `docs/evidencias/unefibra-042/escritorio-vencimientos.png`
- `docs/evidencias/unefibra-042/escritorio-planes.png`
- `docs/evidencias/unefibra-042/escritorio-pagos.png`
- `docs/evidencias/unefibra-042/movil-dashboard.png`
- `docs/evidencias/unefibra-042/movil-vencimientos.png`
- `docs/evidencias/unefibra-042/movil-planes.png`
- `docs/evidencias/unefibra-042/movil-planes-columnas-finales.png`
- `docs/evidencias/unefibra-042/movil-pagos.png`
- `docs/evidencias/unefibra-042/movil-320-dashboard.png`
- `docs/evidencias/unefibra-042/movil-320-vencimientos.png`
- `docs/evidencias/unefibra-042/movil-320-planes.png`
- `docs/evidencias/unefibra-042/movil-320-planes-columnas-finales.png`
- `docs/evidencias/unefibra-042/movil-320-pagos.png`

No se editaron otros archivos de código, configuración o documentación en UNEFIBRA-042. Se añadió el runtime portable autorizado y su ZIP/manifiesto bajo `node_modules/.unefibra-042-node22/`, ignorado por Git; no es un entregable para publicación.

## Pruebas ejecutadas y límites

Runtime final efectivo: `node_modules/.unefibra-042-node22/node-v22.23.4-win-x64/node.exe`, Node 22.23.4. CLI, runner y workers de Functions registraron Node 22.23.4. Chromium 153.0.8010.12 mediante Playwright existente. La pasada previa usó `C:/Program Files/nodejs/node.exe`, Node 24.20.0; no se cambió esa instalación global.

| Validación | PASS | FAIL |
|---|---:|---:|
| Visual: cuatro pantallas, escritorio 1440 px y móviles 390/320 px | 94 | 0 |
| consistencia-comercial | 12 | 0 |
| revision-comercial | 21 | 0 |
| revision-reglas-paridad | 8 | 0 |
| pagos-guardas | 20 | 0 |
| renovacion | 20 | 0 |
| renovacion-ciclo | 11 | 0 |
| renovacion-corte | 13 | 0 |
| recordatorios | 22 | 0 |
| conciliacion | 48 | 0 |
| conciliacion-fechas | 19 | 0 |
| pagos-historicos | 68 | 0 |
| cableado-kz-unef-001 | 33 | 0 |
| pagos-concurrencia (emulador) | 6 | 0 |
| reglas-firestore (emulador) | 24 | 0 |
| revision-comercial-emulador | 21 | 0 |
| pagos-historicos-emulador | 32 | 0 |
| recordatorios-emulador | 19 | 0 |
| **Total final ejecutado con Node 22: 18 suites** | **511** | **0** |

La tabla presenta la pasada final en Node 22; no suma nuevamente las 409 comprobaciones previas en Node 24. El primer intento de emulador terminó con 1 comprobación aprobada y 5 fallidas en concurrencia porque las funciones no llegaron a cargarse en los 10 segundos de descubrimiento. Se conservó ese registro. Se ajustó únicamente `FUNCTIONS_DISCOVERY_TIMEOUT=60` en el proceso de prueba, sin modificar código ni reglas, y se repitieron las cinco suites: 102 PASS / 0 FAIL; CLI terminó con código 0.

También pasan `node --check admin/planes.js`, `node --check tools/qa-unefibra-041.cjs` y `git diff --check`. Una primera aserción de QA a 320 px exigía incorrectamente ver simultáneamente las tres columnas finales; se corrigió para comprobar acceso individual mediante desplazamiento y se repitió la suite completa, con el resultado de 94/0 indicado arriba.

Comando visual reproducible:

```powershell
& './node_modules/.unefibra-042-node22/node-v22.23.4-win-x64/node.exe' --require ./tools/unefibra-041-network-guard.cjs tools/qa-unefibra-041.cjs --unefibra-042
```

La QA reutiliza fixtures ficticios y SDK sustituidos de UNEFIBRA-041, intercepta toda solicitud y bloquea servicios externos. Las escrituras del SDK y callables diferentes de la lectura histórica incrementan un contador y lanzan error. Cada pantalla se comprueba con cero intentos de escritura automática. No se hizo clic en Guardar, Activar, Registrar pago ni otras acciones comerciales. Las protecciones de cobro, suspensión, renovación y router pasan las pruebas puras existentes; el backend y las reglas no se modificaron. Las cinco suites de emulador se ejecutaron nuevamente en esta misión contra `demo-unefibra`: Auth 127.0.0.1:9199, Firestore 127.0.0.1:8080 y Functions 127.0.0.1:5001. Usaron configuración temporal de CLI sin credenciales copiadas, variables de credenciales retiradas y preload de red local heredado. Los pagos y cambios ejercitados por esas suites fueron exclusivamente ficticios. Al cierre no quedaron listeners en esos tres puertos.

Se inspeccionaron visualmente las capturas finales de Planes móvil antes y después de desplazar, y Pagos a 320 px; la automatización cubrió las doce combinaciones pantalla/tamaño. La prueba confirma desplazamiento y acceso por teclado; no equivale a una sesión manual en un teléfono físico.

## Node 22 portable autorizado

Se consultaron los comandos disponibles y se buscaron ejecutables existentes en Program Files, AppData Local/Roaming, cachés, carpetas de gestores habituales, Downloads y el workspace. Solo se localizaron Node 24.20.0 global y Node 24.5.0 dentro de Cursor. No se encontró Node 22 en las rutas inspeccionadas; esto no demuestra su ausencia en ubicaciones no examinadas.

Darwin autorizó descargar Node 22 portable. Se obtuvo `node-v22.23.4-win-x64.zip` desde `https://nodejs.org/dist/latest-v22.x/` y se verificó contra su manifiesto oficial `SHASUMS256.txt`. SHA-256 del ZIP: `CBC74B5E0982C9DBB41525FD8FB5DCD32FBEE237863F7829072F4639A1CE5F20`.

Ejecutable: `node_modules/.unefibra-042-node22/node-v22.23.4-win-x64/node.exe`, versión comprobada `v22.23.4`. La carpeta está ignorada por las reglas existentes de Git. Se extrajo el paquete sin ejecutar instaladores ni modificar PATH persistente. El comando global `node --version` conserva `v24.20.0`.

Las doce suites puras/estáticas y la QA visual se repitieron con el ejecutable portable: **409 PASS / 0 FAIL en Node 22**, además de la pasada previa en Node 24. Registro completo: `docs/evidencias/unefibra-042/pruebas-node22.txt`. Se regeneraron las 14 capturas de 042 bajo Node 22; las ocho de 041 permanecen separadas. La descarga requirió acceso de red fuera del sandbox y se limitó al dominio oficial; las pruebas se ejecutaron con el preload que restringe TCP a loopback.

## Git, recuperación y dictamen

Se mantienen los seis archivos versionados modificados de 041; las modificaciones adicionales de esta misión se limitan a Planes, CSS y la herramienta QA descritos arriba. Los demás cambios anteriores permanecen en el árbol de trabajo. No se preparó ningún archivo para commit y HEAD/main continúan en la base.

Para recuperar solo 042 se deben respaldar primero los archivos actuales y revertir únicamente los bloques identificados arriba: indicación/atributos de tabla en Planes, bloque CSS UNEFIBRA-042 y extensiones del runner. No ejecutar `git restore` contra la base para esos archivos: eliminaría también avances de UNEFIBRA-041. Conservar evidencias y respaldos. No existe reversión productiva porque no se modificó producción.

**GO para revisión de Darwin y preparación de publicación, con 511 PASS / 0 FAIL en Node 22.23.4.** No quedan pendientes técnicos dentro de esta validación local. Se requiere aceptación de Darwin y autorización expresa antes de publicar. No se habilitaron cobros, suspensiones, servicios ni escrituras automáticas. Los límites comerciales y de escalabilidad documentados en UNEFIBRA-041 siguen vigentes; esta validación local no certifica datos ni infraestructura productiva.
