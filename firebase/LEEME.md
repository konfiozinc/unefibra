# Carpeta `firebase/` — no desplegar desde aquí

El 25-oct-2026 (KZ-UNEF-001) se **eliminó `firebase/firestore.rules`** de esta
carpeta porque era una copia antigua y **más débil** que la real, y desplegarla
abría dos agujeros que la regla vigente ya cierra:

| Colección | Copia eliminada (débil) | Regla vigente (raíz) |
|---|---|---|
| `pagos` | `allow create, update: if esAdmin()` | `allow create, update, delete: if false` (solo servidor) |
| `auditoria` | `allow create: if esOperador()` | `allow create: if false` (solo servidor) |
| `historial_estados` | `allow create: if esAdmin()` | `allow create: if false` |

Con la copia débil, un ADMIN podía fabricar desde el navegador un pago
`CONFIRMADO` con `periodoFin` futuro — el motor de vencimientos lo tomaría como
prueba de pago y dejaría de suspender al moroso — y un OPERADOR podía insertar
entradas falsas de auditoría, que son inmutables.

## Dónde está lo que sí se despliega

`firebase.json` de la raíz del repositorio apunta a:

```
"firestore": { "rules": "firestore.rules" }
```

Es decir: **`firestore.rules` de la raíz del repositorio es la única fuente de
verdad**. Para desplegar reglas, desde la raíz:

```
firebase deploy --only firestore:rules
```

`firebase/firebase.json` quedó como configuración histórica y no debe usarse:
apunta a archivos de esta carpeta e intenta desplegar `functions/` desde una
ruta que no existe aquí.
