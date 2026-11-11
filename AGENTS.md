# AGENTS.md — guía para IAs sobre `JeanCode`

Cliente gráfico de los modelos Jean. La API vive en otro repo (`Jean-API-Generator`); este solo es el cliente.

## Reglas duras
1. **Ninguna URL ni clave en archivos.** Cada usuario trae su propia `Jean-API-Generator` (splash o AJUSTES).
2. **Una sola interfaz:** `web/` es la UI; `desktop/` la copia a `desktop/app/` con `npm run copy-web`. No dupliques código de UI en `desktop/`.
3. **El escritorio solo expone lo que está en `preload.js`.** Toda herramienta nueva: handler en `main.js`, implementación en `lib/`, entrada en `preload.js` y documentación en `web/js/agent.js` (TOOL_DOCS).
4. **Rutas siempre con `tools.inside()`**: nada fuera del espacio de trabajo.
5. **Escrituras y comandos pasan por `confirm`** según el modo de permisos; no los saltes.
6. **Control del equipo** (`docs/computer-control.md`): toda acción nueva va al catálogo de `web/js/computer.js` (esquema + riesgo + texto del permiso) y se ejecuta en `desktop/lib/computer/control.js`. Nunca saltes `permit()`; el riesgo alto pregunta siempre; nada se ejecuta sobre la ventana de JeanCode (se comprueba el dueño real de la ventana); todo lo observado pasa por `redact()`; el registro nunca guarda texto tecleado. Pruebas reales: `node --test --test-concurrency=1 tests/computer/control.test.mjs` (Windows).
7. **Apps (MCP)** (`docs/apps.md`): el cliente vive en `desktop/lib/mcp.js` y el catálogo en `web/js/connectors.js` (solo servidores comprobados en vivo). Toda herramienta `mcp__*` pasa por permiso en `agent.js`; en PLAN solo las `readOnly`. Tokens y cabeceras solo en `mcp.json` cifrado; nunca servidores desde archivos del proyecto. Pruebas: `node --test tests/mcp/mcp.test.mjs`.
8. **Automatizaciones** (`docs/automations.md`): hooks en `web/js/hooks.js` (+ `execHook` en `desktop/lib/tools.js`), tareas programadas en `web/js/automations.js` (ejecutor `runAutomation` en `app.js`: nunca muestra diálogos, deniega e informa). Skills del catálogo: `web/js/skills-catalog.js` (generado), instalación `installGithubDir` en `desktop/lib/skills.js`.
9. Estilo: sigue `DESIGN.md` ("taller de noche"): negro `#000`, tinta hueso `#f2f1ec`, líneas de 1 px, cero radios, IBM Plex (Sans Condensed títulos, Mono etiquetas/datos, Sans texto). El bloque invertido con sombra hueca es solo para la acción primaria y lo activo.

## Comandos
- Web local: `python -m http.server 8000 --directory web`
- Escritorio: `cd desktop && npm install && npm start` · sintaxis: `npm run check`
- Pruebas: `node --test tests/unit.test.mjs` · versión única: `node scripts/version.mjs` (comprueba) / `node scripts/version.mjs X.Y.Z` (cambia).
- Publicar: `node scripts/version.mjs X.Y.Z`, commit, etiqueta `vX.Y.Z` (workflow `desktop.yml`; rechaza etiquetas que no coinciden).
- Nunca dupliques una versión completa: una sola rama `main`, una sola versión en `web/js/version.js`.
