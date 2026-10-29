# Respaldo de Firestore — diseño, verificación y restauración

> **KZ-UNEF-028 (29-oct-2026).** Este documento sustituye a lo que decían
> `PREPARACION-PRODUCCION.md` y `KZ-UNEF-005-RESPALDOS-Y-PANEL.md` sobre el
> respaldo diario.

## 1. El fallo que había

La exportación diaria pedía **la base entera en una sola operación**:

```
POST .../databases/(default):exportDocuments   { outputUriPrefix: "gs://.../daily/<fecha>" }
```

Con 332 servicios esa operación tarda **536,8 s** y la función es **gen 1**, cuyo
máximo es **540 s**. Resultado: la exportación se completaba en el bucket, pero la
función moría antes de verificarla y de liberar el cerrojo. El respaldo quedaba
**sin certificar** y, con el cerrojo sin liberar, la corrida siguiente podía
quedar bloqueada. Subir `timeoutSeconds` no es una opción: 540 s es el techo de
gen 1.

## 2. La solución: lotes con presupuesto de tiempo y reanudación

Módulo nuevo `functions/src/backup-lotes.js`. Funciones `backupFirestore` (03:00) y
`continuarBackup` (cada 30 minutos).

| Pieza | Cómo funciona |
|---|---|
| **Un lote = una colección** | Cada lote es su propia operación `exportDocuments` con `collectionIds: [colección]`, bajo `gs://unefibra-firestore-backups/daily/<AAAA-MM-DD>/<colección>/` |
| **Presupuesto por invocación** | 420 s de los 540 disponibles. Antes de empezar un lote comprueba que quede margen; si no, corta y devuelve `PARCIAL` (no es un error) |
| **Reanudación** | El progreso se guarda en `backups/<AAAA-MM-DD>` **después de cada lote**. La siguiente invocación continúa donde quedó y no repite lo ya hecho |
| **Completado de verdad** | Solo se declara `COMPLETADO` cuando **todas** las colecciones raíz están exportadas **y verificadas** en el bucket (metadato global + archivos de datos) |
| **Colección nueva** | Si alguien crea una colección después, entra al plan como pendiente: no se queda fuera del respaldo en silencio |
| **Errores** | Los transitorios (429/5xx/red) se reintentan con espera progresiva; los de permisos no se reintentan y generan alerta por correo |
| **Cerrojo** | El mismo de antes (`configuracion/backupEnCurso`) con caducidad, para que un proceso muerto no bloquee para siempre |

### Por qué no se pasó a gen 2

Gen 2 (`onSchedule`, hasta 1800 s) también resolvería el tiempo, pero exige
Cloud Run/Eventarc y **cambia el modelo de facturación** del proyecto. El loteo
consigue lo mismo dentro de gen 1 y sin coste nuevo. Si algún día una sola
colección no cupiera en el presupuesto, el manifiesto lo delataría (se guarda el
tiempo de cada lote en `backups/<fecha>`) y entonces sí habría que evaluar gen 2.

## 3. Qué deja cada corrida

Documento `backups/<AAAA-MM-DD>`:

```json
{
  "corrida": "2026-10-29",
  "lotes": {
    "clientes":    { "estado": "COMPLETADO", "uri": "gs://…/daily/2026-10-29/clientes", "objetos": 3, "ms": 41234, "cuando": "…" },
    "servicios":   { "estado": "COMPLETADO", "uri": "…", "objetos": 3, "ms": 39877, "cuando": "…" },
    "_adminRegistros": { "estado": "PENDIENTE" }
  }
}
```

Los logs de cada invocación informan `colecciones: N/M`, `objetos`, `pendientes` y
`loteMasLento`. **Ese `loteMasLento` es el dato que hay que mirar en la primera
corrida real** para confirmar que 420 s son suficientes.

## 4. Pruebas (sin tocar producción)

| Prueba | Qué demuestra | Resultado |
|---|---|---|
| `functions/test/backup-lotes.test.js` | 17 casos con una API de Firestore **simulada** y reloj inyectable: presupuesto respetado, reanudación sin repetir lotes, corrida completa idempotente, colección nueva detectada, lote sin objetos **no** cuenta como respaldo, 403 no se reintenta, cerrojo, muerte a mitad con progreso guardado | **17/17** |
| `functions/test/backup.test.js` | El módulo original (espera a `done`, reintentos, clasificación de objetos) | **17/17** |
| `tools/prueba-respaldo-recuperable.js` | **Ciclo real completo en el emulador**: sembrar → exportar → **borrar todo** → importar en una instancia limpia → verificar 11 documentos, colección por colección, con campos anidados y arreglos | **10/10** |

### La prueba de recuperación, en detalle

```
1. Sembrar            11 documentos en 10 colecciones
2. Tomar el respaldo  firebase emulators:export  → firebase-export-metadata.json + firestore_export/
3. Borrar todo        0 documentos
4. Restaurar          firebase emulators:start --import <respaldo> (instancia limpia en 8181)
5. Verificar          11 → 11 documentos, misma distribución por colección,
                      `nombreCompleto`, `precioMensual` e `ip` intactos,
                      mapa anidado `direccion.linea1` y arreglo `etiquetas` intactos
6. Cierre             el emulador de pruebas se apaga solo
```

**Límite honesto:** esto demuestra que el respaldo **se puede recuperar** y que el
procedimiento funciona, pero usa la exportación **del emulador**, no la de
Firestore en producción. La de producción no se puede ejecutar desde aquí: exige
credenciales de la cuenta de servicio y escribir en el bucket real, y esta misión
no está autorizada a tocar producción.

## 5. Cómo se restaura en producción (procedimiento)

```powershell
# 1. NUNCA restaurar sin haber exportado antes el estado actual:
gcloud firestore export gs://unefibra-firestore-backups/pre-restauracion/<fecha> --project=une-fibra

# 2. Restaurar un lote (una colección):
gcloud firestore import gs://unefibra-firestore-backups/daily/2026-10-29/clientes --project=une-fibra

# 3. Restauración completa: repetir el paso 2 con cada lote del manifiesto
#    backups/2026-10-29 (campo `lotes`).
```

La importación **no es reversible por sí sola**: reescribe documentos. Por eso el
paso 1 no es opcional.

## 6. Lo que queda pendiente de la primera corrida real

1. Desplegar `backupFirestore` y `continuarBackup` (no autorizado en esta misión).
2. Ejecutar una corrida manual y revisar el manifiesto: cuántos lotes, cuánto tardó
   el más lento y si quedó `COMPLETADO` o `PARCIAL`.
3. Si quedó `PARCIAL`, comprobar que `continuarBackup` la termina en la siguiente
   media hora.
4. Verificar en el bucket que existe una carpeta por colección con su
   `*.overall_export_metadata`.
5. Anotar la fecha del primer respaldo **completo** verificado. Antes de eso, el
   respaldo sigue siendo «código desplegado», no «hecho comprobado».
