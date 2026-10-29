# Revisar el panel desde el teléfono (sin publicar nada)

> **KZ-UNEF-028.** Procedimiento para que el propietario vea el panel en su
> celular **sin** desplegar, **sin** exponer el entorno de pruebas y **sin** tocar
> los datos reales.

## 1. Qué se necesita

- El computador de la agencia (o el que tenga el proyecto) encendido.
- El teléfono **en la misma red WiFi** que ese computador.
- Nada más: no hay que instalar nada en el teléfono.

## 2. Puesta en marcha (dos comandos)

**Paso 1 — datos ficticios (emuladores).** En una ventana:

```powershell
cd C:\Users\usuario29\Documents\KONFIO_ZINC\6-LANDING-PAGES\UneFibra-SAS
$env:JAVA_HOME="C:\KZ-HERRAMIENTAS\jre21"; $env:PATH="$env:JAVA_HOME\bin;$env:PATH"
firebase emulators:start --config firebase.test.json --project demo-unefibra --only auth,firestore,functions
```

Esperar a que diga que los tres emuladores están listos.

**Paso 2 — servir el panel en la red local.** En otra ventana:

```powershell
cd C:\Users\usuario29\Documents\KONFIO_ZINC\6-LANDING-PAGES\UneFibra-SAS
node tools/servir-panel-local.js
```

La ventana muestra algo así:

```
 Desde el teléfono (misma red WiFi):
   http://192.168.1.42:8099/admin/   (Wi-Fi)
 Cuentas de prueba (datos ficticios):
   SUPERADMIN : super.duena@panel.test
   ADMIN      : admin@panel.test
   OPERADOR   : operador@panel.test
   contraseña : Ficticia#1
```

**Paso 3 — abrir esa dirección en el teléfono** y entrar con la cuenta de prueba.

## 3. Las tres protecciones del servidor

| Protección | Qué evita |
|---|---|
| **Solo sirve `/admin/` y `/assets/`**; todo lo demás responde 403 | Que queden accesibles por la red el código de las funciones, las herramientas y los datos de clientes (`import/clientes-parseados.json`, `Clientes.xlsx`) |
| **Fuerza `?emulador=1`** en cada página (incluso si se pide `?emulador=0`) | Que por un descuido se acabe viendo —o escribiendo en— **producción** desde el teléfono |
| **No arranca si el emulador no responde** | Que el panel aparezca con errores y el propietario crea que está roto |

`--solo-local` sirve únicamente en el propio computador (el teléfono no entra);
`--produccion` desactiva la segunda protección y **no debe usarse** salvo
indicación expresa: en ese caso el panel apunta a los datos reales.

## 4. Qué pedirle al propietario que mire (5 minutos)

1. Entra y ve **Inicio**. ¿Se entiende qué significan las tarjetas?
2. **Clientes** → abre una ficha. ¿Encuentra cómo cambiar el teléfono o el plan?
3. **Vencimientos** → ¿distingue quién está al día, quién está por vencer y quién
   debe? ¿Le sirve leer «Vence mañana» en vez de una fecha suelta?
4. **Pagos** → «+ Registrar pago» → elige un cliente y guarda. ¿Le resultó claro?
5. **Recordatorios** → ¿entiende Pendiente / Enviado / Fallido?
6. «Más opciones» → ¿le estorba o le sobra algo del menú principal?

Anotar sus palabras exactas: la experiencia del propietario es el criterio de
aceptación. Si algo le obliga a preguntar «¿y esto qué es?», hay que cambiarlo.

## 5. Al terminar

- **Ctrl + C** en la ventana del servidor y en la de los emuladores.
- Si el teléfono queda con la sesión abierta, no importa: al apagar el servidor la
  dirección deja de responder y sólo había datos ficticios.

## 6. Por qué no se publica nada

El panel publicado de GitHub Pages se genera desde `main` y mostraría los datos
reales. Publicarlo antes de que el propietario lo revise y antes de resolver el
respaldo (`docs/RESPALDO.md`) sería irreversible para los clientes: por eso la
revisión se hace así, en local y con datos de prueba.
