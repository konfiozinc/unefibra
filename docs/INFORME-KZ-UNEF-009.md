# KZ-UNEF-009 — Auditoría visual independiente del panel de conciliación

Fecha de ejecución: 2026-10-26  
Repositorio: `konfiozinc/unefibra`  
PR auditado: #4, `fix/kz-unef-005-conciliacion`  
SHA auditado: `5c7df90591f46e683cb325a4ee71482c5a6b5075`  
Rama local de corrección: `codex/kz-unef-009-visual`

## Alcance y procedencia

El archivo original `KZ-UNEF-008-capturas.zip` no estaba disponible en este entorno. Para no atribuir cobertura a imágenes ausentes, se reconstruyó la evidencia desde el SHA autorizado usando el HTML, JavaScript y CSS reales del panel, Firebase sustituido en el navegador por módulos locales con identidades y datos exclusivamente ficticios y las conexiones externas bloqueadas. No se accedió a Firebase, MikroTik, contratos, pagos ni clientes reales.

Se inspeccionaron visualmente nueve capturas representativas y se ejecutaron comprobaciones interactivas adicionales. La selección cubre el panel general en 320×700, 360×740, 375×812, 390×844, 768×1024, 1024×768 y 1440×900; además, el modal pendiente en 390×844 y el modal de servicio vencido en 1440×900. Se generaron evidencias auxiliares para cliente suspendido, filtros, estado vacío y error de conexión.

## Resultado por resolución

| Resolución | Resultado después de corregir | Observaciones |
| --- | --- | --- |
| 320×700 | Aprobada | Sin overflow de página; tabla desplazable y aviso de desplazamiento; menú abre y cierra. |
| 360×740 | Aprobada | Controles apilados, objetivos táctiles utilizables y sin superposición. |
| 375×812 | Aprobada | Estados diferenciados, paginación y acciones visibles; tabla conserva scroll horizontal deliberado. |
| 390×844 | Aprobada | Modal largo dispone de cierre superior visible, botón inferior y cierre con Escape. |
| 768×1024 | Aprobada con limitación | La barra lateral permanece y la tabla requiere scroll horizontal, pero no desborda la página ni bloquea controles. |
| 1024×768 | Aprobada | Tabla utilizable y modal de suspendido comunica el bloqueo. |
| 1440×900 | Aprobada | Tabla completa; modal vencido muestra advertencia y acción diferenciada. |

## Defectos comprobados en el SHA auditado

| ID | Severidad | Evidencia | Causa | Estado en rama local |
| --- | --- | --- | --- | --- |
| KZ-UNEF-009-01 | P1 | Modal pendiente, 390×844: no había control de cierre visible sin desplazar; Escape no cerraba. | El único botón estaba al final del contenido largo y no existía manejador de teclado. | Corregido: cierre superior de 44×44, cierre inferior, Escape y clic en fondo. |
| KZ-UNEF-009-02 | P1 | Modal validado y vencido, 1440×900: antes de actuar no indicaba el riesgo de suspensión y `Habilitar` se veía igual que una acción ordinaria. | La advertencia solo aparecía después del clic, en la confirmación del servidor. | Corregido: aviso previo ámbar, texto explícito y botón `Habilitar vencido`; se conserva la confirmación del servidor. |
| KZ-UNEF-009-03 | P1 | Cliente suspendido validado podía presentar la acción de habilitación sin un bloqueo visual previo. | El modal no representaba el estado administrativo al decidir la acción visible. | Corregido: aviso rojo, acción deshabilitada y ninguna llamada de habilitación. |
| KZ-UNEF-009-04 | P2 | Los estados `CANDIDATO` y `VALIDADO` usaban una clase sin estilo específico; `PENDIENTE_VALIDACION` tenía contraste insuficiente. | Faltaban estilos para `tone-blue` y separación cromática de estados. | Corregido: candidato cian, validado azul y pendiente violeta de alto contraste. |
| KZ-UNEF-009-05 | P2 | En móvil la tabla requería desplazamiento horizontal sin comunicarlo. | El contenedor permitía scroll, pero no tenía nombre accesible, foco ni instrucción. | Corregido: pista visible, región enfocable y etiqueta accesible. |
| KZ-UNEF-009-06 | P2 | El fallo de carga solo mostraba un mensaje terminal. | No existía una acción recuperable. | Corregido: botón `Reintentar`. |
| KZ-UNEF-009-07 | P2 | No era posible filtrar explícitamente los registros rechazados. | El selector omitía el estado ya soportado por la clasificación. | Corregido: filtro `Rechazados`. |

La detección de vencimiento usa ahora la fecha de operación de `America/Bogota`; evita que la medianoche UTC adelante un día la advertencia en Colombia.

## Correcciones y límites

Las correcciones solo modifican `admin/conciliacion.html` y `admin/conciliacion.js`. No cambian Functions, reglas Firestore, permisos, pagos, estados persistidos, suspensiones, MikroTik ni el contrato de las callables. `Validar` continúa llamando exclusivamente a `validarServicioConciliado`; `Habilitar` sigue siendo una operación separada. La tanda continúa evaluándose primero y se invoca con `simular: true` durante la prueba.

La rama del PR #4 no fue alterada. Por ello, los defectos enumerados siguen presentes en el SHA autorizado hasta que este parche se revise e incorpore expresamente.

## Pruebas ejecutadas

| Prueba | Resultado |
| --- | --- |
| Auditoría Chromium, siete resoluciones y estados interactivos | 45 aprobadas, 0 fallidas |
| Guardia pura de conciliación y migración | 48 aprobadas, 0 fallidas |
| Sintaxis de `admin/conciliacion.js` | Aprobada |
| Integridad del diff (`git diff --check`) | Aprobada |
| Suite `conciliacion-panel.test.js` con Emulator Suite | No ejecutable: Auth, Firestore y Functions Emulator no estaban activos y el JAR oficial disponible no era ejecutable. No se utilizó Firebase real. |

Las 45 comprobaciones cubren overflow de página, scroll utilizable, errores JavaScript, menú móvil, cierre de modal, separación validar/habilitar, riesgo vencido, bloqueo suspendido, búsqueda, filtros, orden, paginación, selección múltiple, simulación por tanda, estado vacío, recuperación de error y tratamientos visuales.

## Evidencias

- `KZ-EVIDENCIA/kz-unef-009-seleccion-9/antes/`: nueve imágenes del SHA auditado.
- `KZ-EVIDENCIA/kz-unef-009-seleccion-9/despues/`: las mismas vistas después del parche.
- `KZ-EVIDENCIA/kz-unef-009-seleccion-9/comparativas/`: comparativas a igual ancho y estado.
- `KZ-EVIDENCIA/kz-unef-009-5c7df905-despues/resultado-auditoria.json`: detalle reproducible de las 45 comprobaciones.

## Riesgos residuales

1. La tabla conserva desplazamiento horizontal deliberado en móvil y tableta. Es utilizable y está anunciado, pero no equivale a una vista en tarjetas.
2. La prueba de navegador usó módulos Firebase ficticios. Falta ejecutar `conciliacion-panel.test.js` contra Auth, Firestore y Functions Emulator oficiales antes de producción.
3. No se verificó entrega real de notificaciones, MikroTik, pagos, creación de servicios ni datos reales; esas operaciones quedaron expresamente fuera del alcance.
4. La aprobación visual final pertenece a Darwin.

## Estado y dictamen

El SHA original `5c7df90591f46e683cb325a4ee71482c5a6b5075` queda en **HOLD** porque conserva tres defectos P1 que pueden confundir o bloquear operaciones administrativas. La rama local corregida queda en **GO CON RESERVAS para revisión**, condicionada a incorporar el parche al PR y ejecutar la suite oficial de emuladores. No está certificada para producción.

No se hizo push, merge, despliegue ni modificación de producción.
