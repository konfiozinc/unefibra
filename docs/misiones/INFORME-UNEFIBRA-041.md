# UNEFIBRA-041 — Consistencia comercial del panel

Fecha: 10 de noviembre de 2026 · Agencia: KONFÍO ZINC · Director: Darwin Montalvo.

**Dictamen: GO para revisión local de Darwin. Publicación y cambios de datos no autorizados ni ejecutados.**

## Base y protección

- Rama: `fix/unefibra-041-consistencia-comercial`, ya existente al iniciar la continuidad autorizada; no se creó otra rama.
- Commit base y HEAD: `9ccbb85459189b9097e49daa05aade55b9f81d35`.
- Antecedente consignado por el informe anterior: inicio en `main`, sin cambios versionados y con el bundle KZ-037 pendiente. Esa situación inicial no pudo comprobarse retrospectivamente. En esta continuidad se encontraron seis archivos versionados modificados y los archivos nuevos de la misión; se inspeccionaron antes de continuar y se preservaron.
- No se hicieron commits, merge, push ni despliegues. La referencia `main` conserva el commit base.
- Respaldo preservado: `_respaldos/unefibra/2026-10-30-kz-037/feat-kz-unef-021-pagos-historicos.bundle`, 69.581.963 bytes, fecha de modificación 30-oct-2026.
- SHA-256 del bundle al cierre: `119DBF0217E9A5A701E93668CE3882490FF760897489B88F05C2D6BFECF6EF82`. No se calculó hash previo; su fecha y tamaño permanecen concordantes con el archivo anterior.
- Las pruebas generaron registros locales ignorados del emulador; no se incluyen como entregable ni se ejecutaron limpiezas de archivos ignorados.

## Cambios implementados

1. `assets/js/admin/consistencia-comercial.js` (nuevo): módulo puro, utilizable por navegador y Node, sin SDK ni escrituras. Define fechas válidas, próximo corte 15/30, precio confirmado, clasificación de vencimientos, evidencia de cobertura y conteos comunes.
2. `admin/dashboard.js`: usa la clasificación compartida para los mismos cinco indicadores que Vencimientos. Los estados administrativos se identifican como estados guardados; no certifican pagos. El calendario de avisos deja de prometer entrega efectiva.
3. `admin/vencimientos.js`: separa vencimiento registrado, próximo corte, situación de pago y validación. Conserva fechas atrasadas. Retira el cálculo de deuda a partir del calendario y las sumas de supuesto dinero por cobrar. Ofrece consulta de ficha, sin botones de cobro en esta pantalla.
4. `assets/css/admin.css`: presentación móvil específica de las filas comerciales; todos los campos se muestran dentro del ancho disponible.
5. `admin/planes.js`: precios cero, ausentes o inválidos se presentan como **Precio por confirmar**, sin cambiar valores almacenados ni el formulario de edición existente.
6. `admin/pagos.js`: identifica el listado como **Pagos operativos**, explica la separación de las propuestas del Excel y añade enlace visible al módulo histórico para ADMIN/SUPERADMIN. No cambia consultas, permisos o decisiones históricas.
7. `functions/test/pagos-concurrencia.test.js`: reemplaza fechas fijas vencidas por un vencimiento relativo futuro; mantiene el escenario aprobado sin ciclo, renovado por duración. Sigue exigiendo una sola confirmación y una sola renovación.
8. `functions/test/consistencia-comercial.test.js` (nuevo): escenarios ficticios de interpretación comercial y conservación de las protecciones.
9. `tools/qa-unefibra-041.cjs` (nuevo): pantallas reales con fixtures, SDK sustituido y todas las solicitudes interceptadas. Produce ocho capturas. No sirve el repositorio ni accede a datos reales.
10. `tools/unefibra-041-network-guard.cjs` (nuevo): preload de QA que restringe las conexiones TCP de Node al loopback; se utilizó en CLI, procesos heredados y pruebas de emulador.
11. Este informe y las capturas de `docs/evidencias/unefibra-041/`.

## Definiciones de lectura

- **Próximo corte:** siguiente fecha de calendario del ciclo explícitamente guardado. Un ciclo ausente no se inventa ni se infiere silenciosamente.
- **Vencimiento registrado:** fecha guardada en cliente; si falta, se utiliza la del servicio único. Una discrepancia entre ambas exige revisión. La interfaz no escribe ninguna fecha.
- **Pendiente de validación:** falta de servicio, varios servicios, conciliación diferente de HABILITADA, fecha/ciclo/precio inválidos o discrepancia de fechas/ciclos. Esta clasificación es informativa y conservadora; no modifica ni reemplaza las guardas del servidor.
- **Grupos equivalentes:** pendientes, atrasados, hoy, próximos siete días y posteriores. Son excluyentes y proceden de la misma función. Un pendiente conserva su fecha visible, aunque esté atrasada, dentro del grupo de validación.
- **Situación de pago:** solo se informa cobertura de la fecha de consulta cuando existe un pago operativo CONFIRMADO del mismo cliente, de importe positivo, fecha de pago válida no futura y período válido que cubre esa fecha. No afirma que todas las obligaciones estén al día.
- Sin esa evidencia se muestra **Sin evidencia suficiente para determinar deuda**; nunca se deduce morosidad por ausencia de pagos. Si hay validación pendiente, esa advertencia prevalece incluso si existe un pago.
- El estado administrativo se conserva y se muestra aparte; no se activa ni suspende un servicio por esta clasificación.
- Las propuestas APROBADA/PROPUESTA no se cuentan como pagos confirmados. No existe conversión automática añadida por esta misión.

## Validación ejecutada en esta misión

Todas las pruebas de esta tabla se ejecutaron el 10-nov-2026. No son resultados heredados de UNEFIBRA-038/039.

| Suite | PASS | FAIL | Entorno |
|---|---:|---:|---|
| consistencia-comercial | 12 | 0 | Puro, sin red |
| revision-comercial | 21 | 0 | Puro |
| revision-reglas-paridad | 8 | 0 | Puro |
| pagos-guardas | 20 | 0 | Puro |
| renovacion | 20 | 0 | Puro |
| renovacion-ciclo | 11 | 0 | Puro |
| renovacion-corte | 13 | 0 | Puro |
| recordatorios | 22 | 0 | Puro |
| conciliacion | 48 | 0 | Puro |
| conciliacion-fechas | 19 | 0 | Puro |
| pagos-historicos | 68 | 0 | Puro |
| cableado-kz-unef-001 | 33 | 0 | Inspección estática de código |
| pagos-concurrencia | 6 | 0 | Auth/Firestore/Functions emulados |
| reglas-firestore | 24 | 0 | Auth/Firestore emulados |
| revision-comercial-emulador | 21 | 0 | Auth/Firestore/Functions emulados |
| pagos-historicos-emulador | 32 | 0 | Firestore emulado |
| recordatorios-emulador | 19 | 0 | Auth/Firestore/Functions emulados |
| QA visual y navegación | 40 | 0 | Chromium, fixtures interceptados |
| **Total** | **457** | **0** | **18 suites** |

Comprobaciones adicionales: `node --check` de los cuatro módulos de pantalla y de la prueba de concurrencia; `git diff --check`, sin errores. La clasificación y la QA visual se repitieron después del ajuste móvil; los totales cuentan únicamente una pasada de cada suite.

Los escenarios nuevos incluyen cortes 15/30, cambio de año, febrero normal y bisiesto, límites de hoy/+7, fechas atrasadas, pagos anticipados/atrasados, rechazos de evidencias insuficientes, precios ausentes/cero, datos inconsistentes, propuestas sin conversión y ausencia de mutación. Las pruebas existentes de conciliación, revisión y reglas certifican además las protecciones del servidor.

### Entorno y aislamiento

- Node ejecutado: `C:/Program Files/nodejs/node.exe`, v24.20.0. El proyecto declara Node 22; no se instaló otro runtime.
- Firebase CLI existente: 15.29.0.
- Java existente: `C:/Program Files/Android/Android Studio/jbr/bin/java.exe`, OpenJDK 21.0.10.
- Firestore Emulator existente en caché: 1.22.0.
- Proyecto de pruebas: **demo-unefibra**. Auth 127.0.0.1:9199, Firestore 127.0.0.1:8080 y Functions 127.0.0.1:5001. No se reutilizó una sesión de emulador ajena.
- Configuración CLI aislada en carpeta temporal, sin copiar credenciales. Se retiraron de los procesos de prueba las variables conocidas de credenciales y SendGrid. Las solicitudes externas de Node quedaron bloqueadas por el preload. No se instalaron dependencias.
- Motor visual: Chromium 153.0.8010.12, Playwright ya disponible en el proyecto hermano Konfio-Zinc-Web/herramientas. La prueba visual requiere esa instalación existente.
- La prueba visual sustituye core y SDK para aislar datos; conserva módulos de pantallas, shell, utilidades y CSS reales. No es una certificación de Firebase productivo ni una sesión real de Darwin.
- Al cierre se detuvieron los emuladores propios y se comprobó que los puertos 8080, 9199 y 5001 ya no tenían procesos escuchando.

## Evidencia visual

Ocho PNG, exclusivamente con datos ficticios: escritorio a 1440×1000 y móvil a 390×844, para Dashboard, Vencimientos, Planes y Pagos. Capturas completas; las dimensiones finales pueden superar la altura del viewport.

- [Vencimientos escritorio](../evidencias/unefibra-041/escritorio-vencimientos.png)
- [Vencimientos móvil](../evidencias/unefibra-041/movil-vencimientos.png)
- [Planes escritorio](../evidencias/unefibra-041/escritorio-planes.png)
- [Pagos móvil](../evidencias/unefibra-041/movil-pagos.png)

Se revisaron legibilidad, mensajes, estados, menú móvil, enlace al Excel, coherencia de los cinco indicadores y ausencia de errores JS. Se corrigió la tabla móvil tras inspeccionar la primera captura.

## Riesgos y límites pendientes

1. Darwin debe revisar y aceptar los textos y criterios conservadores en local. Los 126 observados en noviembre no se convierten automáticamente en una cifra de deuda.
2. No se verificó producción ni se corrigieron fechas, tarifas o históricos reales. Los precios deben ser aportados y aprobados por Darwin.
3. Las pantallas leen clientes, servicios y pagos completos para obtener una interpretación común. Esto aumenta las lecturas del Dashboard respecto a sus agregaciones anteriores; paginación/agregados deberán evaluarse si crece el volumen. No se midió costo productivo.
4. Dos pantallas abiertas en instantes distintos pueden diferir si alguien modifica datos entre consultas. La coherencia comprobada presupone los mismos datos y fecha.
5. Datos con varios servicios o discrepancias se mantienen en revisión, sin escoger un servicio a ciegas. Una condición administrativa ACTIVO no reemplaza la validación comercial.
6. No se ejecutó la batería completa de todas las funciones del repositorio; sí las 18 suites relacionadas indicadas. La suite administrativa de históricos con su interruptor encendido no se ejecutó; esta misión no cambia esas funciones.
7. Falta repetir la certificación en Node 22 antes de considerar una publicación. No se cambió el backend productivo ni su runtime.

## Recuperación local

Los cambios se entregan **sin commit**. Cambiar de rama no guarda ni aísla automáticamente estos archivos de trabajo.

1. Antes de descartar cualquier cambio, copiar a una carpeta de recuperación todos los archivos de esta misión enumerados arriba, incluidas las capturas, este informe y los archivos nuevos. Verificar la copia.
2. Revisar nuevamente `git status` y `git diff` para identificar cambios posteriores de otras sesiones; no sobrescribirlos.
3. Solo si se decide abandonar esta misión, restaurar exclusivamente los seis archivos versionados desde la base:

```powershell
git restore --source=9ccbb85459189b9097e49daa05aade55b9f81d35 -- admin/dashboard.js admin/vencimientos.js admin/planes.js admin/pagos.js assets/css/admin.css functions/test/pagos-concurrencia.test.js
```

4. Conservar los archivos nuevos y las evidencias: no se requiere borrarlos para recuperar las pantallas originales. Preservar íntegramente el bundle KZ-037.
5. No usar `git clean`, `reset --hard` ni limpiezas de respaldos. No hay reversión de Firebase porque esta misión no modificó producción.

## Dictamen

**GO para revisión local de Darwin**, con 457 comprobaciones aprobadas, evidencia ficticia en escritorio/móvil y protecciones comerciales conservadas. **No constituye autorización para publicar, modificar datos o habilitar servicios.**

## Continuidad autorizada y contraste del trabajo existente

El 10-nov-2026 se retomó la rama existente por autorización expresa de Darwin. Se revisaron `git status`, el diff completo de los seis archivos versionados y el contenido de los módulos, pruebas, herramientas e informe nuevos. Las correcciones funcionales descritas arriba ya estaban implementadas y resultaron compatibles con el alcance; no fue necesario editar nuevamente el código ni duplicarlo. La autoría y secuencia exacta de la sesión anterior no se pueden establecer a partir de archivos sin commit.

Se repitieron las 18 suites de la tabla: **315 comprobaciones puras/estáticas + 102 de emulador + 40 visuales = 457 PASS, 0 FAIL**. Se corrigió el total anterior de 437, que era un error de suma. El runner de emuladores ejecutó secuencialmente las cinco suites y terminó con código 0. Se verificó sintaxis con `node --check` de las cuatro pantallas, el módulo compartido, la prueba de concurrencia y las dos herramientas; `git diff --check` también pasó.

La ejecución utilizó las herramientas ya instaladas indicadas en el apartado de entorno, configuración temporal de CLI sin credenciales copiadas, proyecto `demo-unefibra` y preload de red local heredado por los procesos Node. No se instaló software. El CLI mostró una consulta de metadatos bloqueada y un timeout al consultar la versión del SDK en NPM; ambos fueron avisos de arranque, y no impidieron las pruebas locales. No se accedió a Firebase productivo.

Se volvieron a generar las ocho capturas con los mismos fixtures ficticios y se inspeccionaron visualmente el Dashboard y Planes en escritorio, y Vencimientos y Pagos en móvil. La automatización comprobó las cuatro pantallas en ambos tamaños, navegación al histórico, menú móvil y coherencia de indicadores. No se ejecutaron acciones de registro o confirmación desde esas pantallas.

El bundle mantiene el SHA-256 consignado arriba. `main` y HEAD siguen en el commit base. Estado de entrega: seis archivos versionados modificados y siete entradas sin seguimiento en `git status --short` (incluyen las carpetas de respaldo y evidencia). No hay cambios preparados para commit; se conserva todo para revisión. La única edición adicional de fuente documental en esta continuidad fue este informe, además de la regeneración de las capturas.

No se localizaron documentos identificados como UNEFIBRA-039/040 en los archivos de `docs` de este checkout; no se atribuyen a esos documentos detalles no comprobados. La evaluación se contrastó con la orden de ejecución proporcionada, el código y los resultados locales. Los riesgos y el procedimiento de recuperación anteriores permanecen aplicables.
