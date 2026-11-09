# AGENTS.md — guía para IAs sobre `jeancode`

Cliente gráfico de los modelos Jean. La API vive en otro repo (`Jean-API-Generator`); este solo es el cliente.

## Reglas duras
1. **Ninguna URL ni clave en archivos.** Cada usuario trae su propia `Jean-API-Generator` (splash o AJUSTES).
2. **Una sola interfaz:** `web/` es la UI; `desktop/` la copia a `desktop/app/` con `npm run copy-web`. No dupliques código de UI en `desktop/`.
3. **El escritorio solo expone lo que está en `preload.js`.** Toda herramienta nueva: handler en `main.js`, implementación en `lib/`, entrada en `preload.js` y documentación en `web/js/agent.js` (TOOL_DOCS).
4. **Rutas siempre con `tools.inside()`**: nada fuera del espacio de trabajo.
5. **Escrituras y comandos pasan por `confirm`** según el modo de permisos; no los saltes.
6. Estilo: negro `#000`, blanco `#fff`, IBM Plex (Sans Condensed para títulos, Mono para etiquetas, Sans para texto), bordes de 3 px y sombras sólidas desplazadas.

## Comandos
- Web local: `python -m http.server 8000 --directory web`
- Escritorio: `cd desktop && npm install && npm start` · sintaxis: `npm run check`
- Publicar instaladores: etiqueta `vX.Y.Z` (workflow `desktop.yml`).
