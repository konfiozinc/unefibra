# agente-ia

**Esta carpeta ya no contiene la fuente del Worker del agente.**

El Worker `unefibra-agente` se despliega desde su fuente canónica, que vive en el
repositorio privado del workspace:

```
9-AGENTES-IA/UneFibra-Agente/worker.js   ← fuente canónica (declara las ataduras KV)
```

> **Historial (13-oct-2026).** Aquí hubo una copia de `worker.js` + `wrangler.toml`
> que quedó desactualizada (180 líneas frente a las 364 de la canónica) y **sin las
> ataduras KV** en su configuración. Desplegar desde esta carpeta habría dejado al
> agente **sin base de conocimiento y sin logs**, porque `wrangler deploy` habría
> registrado el Worker con esas ataduras vacías. Se eliminaron ambos archivos.
>
> No vuelvas a crear un `wrangler.toml` aquí apuntando al Worker `unefibra-agente`:
> usa siempre la carpeta canónica.

`BASE_CONOCIMIENTO_UNEFIBRA.md` se mantiene porque es la referencia de contenido
del agente (qué sabe y qué no puede prometer).
