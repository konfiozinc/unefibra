# UNEFIBRA-043 — Preparación de publicación controlada

Fecha: 10 de noviembre de 2026. Proyecto: UneFibra SAS. Agencia: KONFÍO ZINC. Director: Darwin Montalvo.

**Dictamen: GO CON RESERVAS para preparar la publicación. No se autoriza ni se ejecuta publicación, merge o push.** El paquete funcional está comprometido y validado localmente; antes de publicar deben resolverse las condiciones de caché y alcance del flujo de Pages descritas abajo.

## Identificación y commits locales

- Rama conservada: `fix/unefibra-041-consistencia-comercial`.
- Base de la misión y referencia local `main`: `9ccbb85459189b9097e49daa05aade55b9f81d35`.
- Commit del paquete UNEFIBRA-041/042: **`7e7e28a93285587e6700ee29412e9894ea5a08fd`**.
- Asunto: `fix(admin): aclara indicadores comerciales y lectura movil (UNEFIBRA-041/042)`.
- Contenido: 34 archivos, 623 inserciones y 201 eliminaciones de líneas; el commit contiene 22 capturas ficticias.
- El cierre documental de UNEFIBRA-043 se registra en un segundo commit exclusivamente local, hijo del anterior, con este informe y el manifiesto. Su hash se entrega en el cierre y puede consultarse con `git log -1 --format=%H -- docs/misiones/INFORME-UNEFIBRA-043.md`. Se separó para poder registrar aquí el hash estable del paquete funcional, sin autorreferencia circular.

No se creó otra rama. Se utilizó una lista cerrada con rutas exactas, sin `git add .` ni `git add -A`. Se comprobó que el índice y el commit coincidieran con esa lista.

## Lista exacta incorporada al paquete funcional

Código de interfaz (6):

1. `admin/dashboard.js`
2. `admin/pagos.js`
3. `admin/planes.js`
4. `admin/vencimientos.js`
5. `assets/css/admin.css`
6. `assets/js/admin/consistencia-comercial.js`

Pruebas (2):

7. `functions/test/consistencia-comercial.test.js`
8. `functions/test/pagos-concurrencia.test.js`

Herramientas locales (2):

9. `tools/qa-unefibra-041.cjs`
10. `tools/unefibra-041-network-guard.cjs`

Documentación histórica de las misiones (2):

11. `docs/misiones/INFORME-UNEFIBRA-041.md`
12. `docs/misiones/INFORME-UNEFIBRA-042.md`

Evidencia ficticia de UNEFIBRA-041 (8):

13. `docs/evidencias/unefibra-041/escritorio-dashboard.png`
14. `docs/evidencias/unefibra-041/escritorio-pagos.png`
15. `docs/evidencias/unefibra-041/escritorio-planes.png`
16. `docs/evidencias/unefibra-041/escritorio-vencimientos.png`
17. `docs/evidencias/unefibra-041/movil-dashboard.png`
18. `docs/evidencias/unefibra-041/movil-pagos.png`
19. `docs/evidencias/unefibra-041/movil-planes.png`
20. `docs/evidencias/unefibra-041/movil-vencimientos.png`

Evidencia ficticia de UNEFIBRA-042 (14):

21. `docs/evidencias/unefibra-042/escritorio-dashboard.png`
22. `docs/evidencias/unefibra-042/escritorio-pagos.png`
23. `docs/evidencias/unefibra-042/escritorio-planes.png`
24. `docs/evidencias/unefibra-042/escritorio-vencimientos.png`
25. `docs/evidencias/unefibra-042/movil-320-dashboard.png`
26. `docs/evidencias/unefibra-042/movil-320-pagos.png`
27. `docs/evidencias/unefibra-042/movil-320-planes-columnas-finales.png`
28. `docs/evidencias/unefibra-042/movil-320-planes.png`
29. `docs/evidencias/unefibra-042/movil-320-vencimientos.png`
30. `docs/evidencias/unefibra-042/movil-dashboard.png`
31. `docs/evidencias/unefibra-042/movil-pagos.png`
32. `docs/evidencias/unefibra-042/movil-planes-columnas-finales.png`
33. `docs/evidencias/unefibra-042/movil-planes.png`
34. `docs/evidencias/unefibra-042/movil-vencimientos.png`

El commit documental agrega únicamente:

- `docs/misiones/INFORME-UNEFIBRA-043.md`
- `docs/evidencias/unefibra-043/VERIFICACION-PAQUETE.json`

El manifiesto registra SHA-256 de los 34 archivos de trabajo originales, de los elementos excluidos y del ejecutable portable. Git puede normalizar finales de línea al almacenar texto; los hashes del manifiesto corresponden a los archivos preservados en disco.

## Alcance comercial comprobado

| Requisito | Resultado del contraste con el código |
|---|---|
| Corte, vencimiento y pago separados | PASS: ambos indicadores usan el módulo compartido; vencimiento almacenado y calendario son campos diferentes. |
| Atraso conservado sin deuda automática | PASS: se compara la fecha registrada con la consulta, no el siguiente corte; ausencia de pagos no determina mora. |
| Precios desconocidos | PASS: cero/ausente/inválido muestra «Precio por confirmar», sin asignar tarifas. |
| Pagos operativos e históricos | PASS: listado rotulado y propuestas separadas; acceso visible al histórico para ADMIN/SUPERADMIN. |
| Planes y encabezado móvil | PASS: orientación y acceso por teclado a tabla; encabezado completo y capturas con DATOS FICTICIOS. |
| Protecciones existentes | PASS: no cambian backend, reglas, índices, permisos ni lógica de activación. |

Las diferencias con la base local se limitan a los archivos enumerados. No hay cambios en `functions/src`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `firebase.test.json`, `assets/js/admin/core.js`, `assets/js/admin/shell.js`, `sw.js` ni `.github/workflows/deploy.yml`. Los formularios de Planes y Pagos conservan acciones manuales existentes; esta misión no las ejecutó ni añadió escrituras automáticas. Las pruebas de Functions solo forman parte del repositorio, no de la publicación estática.

## Verificaciones y evidencia

Se revisaron el informe UNEFIBRA-042, los registros locales de Node 22 y la procedencia ficticia de las capturas. Sus **511 PASS / 0 FAIL en 18 suites** corresponden a la ejecución anterior de UNEFIBRA-042; no se presentan como una nueva batería completa de UNEFIBRA-043.

Por no existir cambios de código desde esa validación, esta misión repitió únicamente:

| Comprobación en UNEFIBRA-043 | Resultado |
|---|---|
| consistencia-comercial | 12 PASS / 0 FAIL |
| revision-reglas-paridad | 8 PASS / 0 FAIL |
| pagos-guardas | 20 PASS / 0 FAIL |
| Sintaxis de los nueve archivos JS/CJS del paquete | PASS |
| `git diff --cached --check` del paquete final | PASS |
| Lista del índice y del commit frente al manifiesto | PASS: 34 archivos exactos |
| SHA-256 antes/después de archivos originales y elementos excluidos | PASS |

Runtime ejecutado: `node_modules/.unefibra-042-node22/node-v22.23.4-win-x64/node.exe`, versión `22.23.4`. Las suites usaron `--require ./tools/unefibra-041-network-guard.cjs`; no se iniciaron emuladores ni se consultó producción en UNEFIBRA-043. No se regeneraron las capturas.

La revisión del paquete no detectó firmas de claves privadas, API keys de Google, JWT, tokens de GitHub o SendGrid. Se revisaron también los registros en su codificación efectiva, incluido UTF-16. Los fixtures usan clientes ficticios y dominios de prueba; no se incorporaron archivos Excel, credenciales ni información de clientes reales. Esta revisión está limitada al paquete nuevo, no constituye una auditoría del historial completo del repositorio.

## Preservación y exclusiones

Los siguientes elementos permanecen intactos y fuera de ambos commits:

| Elemento | Tamaño / comprobación |
|---|---|
| `_respaldos/unefibra/2026-10-30-kz-037/feat-kz-unef-021-pagos-historicos.bundle` | 69.581.963 bytes; SHA-256 `119dbf0217e9a5a701e93668ce3882490ff760897489b88f05c2d6bfecf6ef82` |
| `UNEFIBRA-041-EVIDENCIAS.zip` | 845.708 bytes; SHA-256 `0d3155be63386cc1cafb017f1b7cea8e0a64a4143975d2aab0b9360893e294c7` |
| `docs/evidencias/unefibra-042/emuladores-node22-intento1.txt` | Registro original conservado; hash en manifiesto. |
| `docs/evidencias/unefibra-042/emuladores-node22.txt` | Registro original conservado; hash en manifiesto. |
| `docs/evidencias/unefibra-042/pruebas-node22.txt` | Registro original conservado; hash en manifiesto. |
| Node portable, ZIP y manifiesto oficial dentro de `node_modules/.unefibra-042-node22/` | Ignorados por Git; ejecutable comprobado sin cambios. |

Los tres registros crudos son de pruebas ficticias, pero se excluyeron para conservar íntegramente su formato original; uno usa UTF-16 y otro incluye espacios de alineación que `git diff --check` advierte. No se recortaron ni convirtieron. Los informes 041/042 mantienen sus referencias como rutas locales; esos tres archivos no estarán presentes en un checkout limpio. Los resultados y hashes quedan documentados y las 22 imágenes sí están versionadas.

No se descartaron, restauraron ni sobrescribieron cambios de trabajo existentes. La única retirada del índice fue la de esos tres registros, preparados por esta misma misión antes de decidir su exclusión. No se tocaron archivos de otros proyectos. No se eliminó ningún respaldo. Los informes 041/042 conservan su estado histórico «sin commit» de su fecha de cierre; este informe registra la transición posterior a commits locales.

Estado de cierre esperado y comprobable: ningún cambio versionado pendiente ni entrada preparada; cinco archivos sin seguimiento (ZIP, bundle y tres registros), que Git puede agrupar por carpeta. Node portable y cachés siguen ignorados. No se modifica `.gitignore` para ocultar pendientes.

`main` local permanece en la base. No se hizo fetch, consulta de datos productivos ni operación remota; por tanto, no se afirma haber verificado el HEAD remoto o el estado actual del servicio. Producción no recibió ninguna acción de esta misión.

## Condiciones previas a una publicación futura

1. **Caché:** `sw.js` conserva `unefibras-v8` y sirve JS/CSS con stale-while-revalidate. En una sesión existente puede devolver primero código anterior y luego mezclar versiones. Antes de publicar debe aprobarse y prepararse un cambio mínimo de versión de caché, repetir la prueba con una sesión que ya tenga Service Worker y validar también reversión. No se incluyó ese cambio porque no pertenece al paquete 041/042 autorizado para este commit.
2. **Alcance de Pages:** `.github/workflows/deploy.yml` se ejecuta con push a `main`, manualmente y a diario. Genera el blog desde artículos públicos de Firestore antes de copiar el sitio. Por tanto, un despliegue del flujo existente no se limita al panel y no reproduce necesariamente los mismos HTML del blog en cada ejecución. Darwin debe aceptar expresamente ese efecto o autorizar un flujo separado que publique el sitio estático sin regenerar el blog. No se modificó ni ejecutó el workflow.
3. **Runtime de CI:** el workflow existente usa Node 20 para el generador del blog, mientras las pruebas de esta misión usan Node 22 y Functions declara 22. El panel es estático y no se despliega Functions; aun así, una actualización de CI sería una decisión separada. No se alteró el runtime del flujo.
4. **Base remota y revisión humana:** confirmar antes de integrar que `origin/main` no avanzó, aceptar textos/comportamiento y autorizar de forma expresa merge, push y despliegue. Una divergencia exige revisar únicamente los archivos en conflicto; no resolverla descartando trabajo.

## Plan de integración y publicación — NO EJECUTADO

La siguiente secuencia es un procedimiento futuro sujeto a autorización de Darwin, no instrucciones para ejecutar en esta misión.

1. Resolver las condiciones anteriores, especialmente la caché; registrar el hash final de la candidata. Conservar este paquete como referencia. Cualquier cambio adicional se valida y se documenta antes de integrar.
2. Comprobar nuevamente rama, HEAD, `git status --short`, lista candidata, firmas sensibles y pruebas pertinentes con Node 22. Copiar y verificar los cinco elementos locales excluidos si se va a manipular el árbol; conservar los hashes del manifiesto. No usar `git clean` ni `reset --hard`.
3. Con autorización de acceso remoto, ejecutar `git fetch origin` y comparar `origin/main` con la base registrada. Si difiere, detener la integración automática y revisar la divergencia. Anotar el commit realmente desplegado y su artefacto de Pages; será el punto de recuperación, no se presume que coincida con el último informe histórico.
4. Crear un worktree de integración en una carpeta temporal nueva y verificada, para preservar este árbol con sus archivos no rastreados. Ejemplo PowerShell, una vez confirmado que `main` local coincide con `origin/main`:

```powershell
$integracion = Join-Path $env:TEMP ('unefibra-publicacion-' + [guid]::NewGuid().ToString('N'))
git worktree add $integracion main
git -C $integracion merge --no-ff --no-commit fix/unefibra-041-consistencia-comercial
git -C $integracion diff --cached --check
git -C $integracion diff --cached --name-only
```

5. Revisar el resultado, el cambio de caché autorizado y el artefacto local público. Ejecutar las regresiones con Node 22 y fixtures; comprobar que `assets/js/admin/consistencia-comercial.js` esté presente y las cuatro pantallas funcionen. Ante conflicto, usar `git merge --abort` solo en ese worktree y conservar la rama original.
6. Con el resultado aprobado, crear el commit de integración. Registrar `main` anterior, commit de integración y hash de caché en la orden de publicación. Un push a `main` dispara Pages: **no hacerlo hasta que la autorización incluya también el despliegue**.
7. Publicar una sola vez mediante `git -C $integracion push origin main`. El flujo actual ejecuta checkout, Node 20, generador del blog, copia a `_sitio`, configuración de Pages, carga del artefacto y despliegue. No disparar adicionalmente `workflow_dispatch` para evitar duplicación. No ejecutar `firebase deploy`.
8. Verificar el SHA del workflow y su resultado; revisar el inventario del artefacto. El flujo copia únicamente las páginas raíz enumeradas y las carpetas `assets`, `admin`, `blog`. No copia `docs`, `tools`, `functions`, respaldos ni Node portable. Conservar el artefacto anterior para recuperación.

## Verificación inmediatamente posterior — NO EJECUTADA

- Verificar HTTP 200 y contenido esperado de las cuatro páginas, los cuatro módulos de pantalla, CSS, módulo compartido y Service Worker en `https://konfiozinc.github.io/unefibra/`.
- Comprobar que el Service Worker adopte la nueva versión tanto en una sesión anterior como en una sesión nueva; confirmar que no queden combinaciones de archivos anteriores y nuevos.
- Verificar redirección al acceso sin sesión, navegación, consola y presentación móvil de Planes/encabezados. No realizar acciones de pago, cambios de planes, estados o revisión histórica.
- La comparación con datos productivos o el recorrido autenticado queda a cargo de Darwin o requiere autorización específica; no producir capturas con datos personales. Mantener para QA automatizada los fixtures ficticios, cuyo distintivo no forma parte del código productivo del encabezado.
- Confirmar en el artefacto que no existan rutas `docs`, `tools`, `functions`, `_respaldos`, `node_modules` o ZIP. Si el workflow falla o el contenido no coincide, detener y aplicar la recuperación autorizada.

## Recuperación — NO EJECUTADA

**Local:** el commit base y el paquete funcional son puntos recuperables. Para consultar la versión previa sin tocar este árbol, usar un worktree temporal separado y `git worktree add --detach <carpeta-nueva> 9ccbb85459189b9097e49daa05aade55b9f81d35`. No borrar archivos no rastreados ni restaurar indiscriminadamente sobre trabajo posterior. El bundle KZ-037 está disponible como respaldo histórico, pero no sustituye estos commits nuevos.

**Publicación futura:** detener nuevas publicaciones y registrar el fallo. Con autorización, recuperar los cinco archivos públicos existentes (`admin/dashboard.js`, `admin/pagos.js`, `admin/planes.js`, `admin/vencimientos.js`, `assets/css/admin.css`) desde el commit productivo inmediatamente anterior, en el worktree de recuperación. Revisar cualquier cambio posterior antes de aplicar `git restore --source=<punto-recuperacion> -- <cinco-rutas>`. El módulo compartido nuevo puede permanecer sin uso, sin borrar documentación ni evidencias. Crear una nueva versión de caché para la recuperación; no reutilizar el identificador fallido. Validar, crear commit de reversión y publicar una sola vez con autorización. Si se usa el flujo actual, recordar que el blog se regenera; para una restauración idéntica de todo el sitio debe haberse conservado un artefacto y un procedimiento de redespliegue aprobado. No reescribir el historial con force push.

No hay reversión de base de datos, reglas o Functions: la publicación propuesta es estática y estas misiones no las modifican.

## Exclusiones productivas y cierre

Quedan excluidos Firebase deploy, reglas, índices, Functions, credenciales/permisos, importaciones Excel, conversión de históricos, cambios de precios, pagos reales, activaciones, suspensiones, habilitaciones, conexiones o escrituras MikroTik, WhatsApp/Meta y notificaciones. No se activan por crear estos commits.

**GO CON RESERVAS:** paquete local exacto y preservado; regresión pertinente aprobada. Pendientes antes de publicar: decisión sobre caché, aceptación del alcance real del workflow, verificación de base remota y autorización expresa de Darwin. Se detiene el trabajo después del cierre documental y la comprobación de los commits locales.
