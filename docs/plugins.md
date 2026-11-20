# Plugins

Un plugin agrupa **skills, subagentes y comandos** con el formato de los plugins de Claude Code, así que los
plugins que ya existen para Claude Code funcionan en JeanCode tal cual. Solo en el escritorio (menú del agente →
**Plugins**, o la paleta de comandos).

## Catálogo

| Plugin | Repositorio | Licencia | Aporta |
| --- | --- | --- | --- |
| ECC · Everything Claude Code | `affaan-m/ECC` | MIT | 327 skills, 72 subagentes, 98 comandos (`/ecc:plan`, `/ecc:tdd`…) |
| EGM · Elephant-Goldfish Model | `google/elephant-goldfish-model` | Apache-2.0 | 7 skills (`egm-brainstorm`, `egm-draft`, `egm-review`…) y 10 subagentes revisores |

El catálogo vive en `web/js/plugins-catalog.js`. Cualquier otro plugin se instala con su URL https de git o
desde una carpeta.

## Cómo se carga

- Se instala en `<userData>/plugins/<nombre>/`. Del repositorio solo se copia el texto que usa el agente:
  `.claude-plugin/`, `plugin.json`, `skills/`, `agents/`, `commands/`, `docs/`, `resources/`, la licencia y el README.
  Nada de `node_modules`, pruebas, CI ni enlaces simbólicos; hay límites de archivos y tamaño.
- El manifiesto es `.claude-plugin/plugin.json` (o `plugin.json`). Sus claves `skills`, `agents` y `commands`
  indican las carpetas o archivos; si faltan se usan `skills/`, `agents/` y `commands/`.
- **Skills**: aparecen junto a las propias y se cargan con `load_skill`. Si un plugin trae más de 25, el prompt
  solo lo anuncia y el agente pide el índice con `load_skill {"name": "<plugin>"}` (así ECC no llena el contexto).
- **Subagentes**: `spawn_subagent {"agent": "<nombre>"}`. `tools` con `Write`, `Edit` o `Bash` (o sin `tools`, como
  en Claude Code) = puede escribir; si no, solo lectura. Los permisos de siempre siguen aplicando.
- **Comandos**: `/<plugin>:<comando>` (p. ej. `/ecc:plan añadir login`); `$ARGUMENTS` se sustituye.
- `${CLAUDE_PLUGIN_ROOT}/archivo.md` en un prompt se **incluye** en el texto (el subagente no puede leer fuera de la
  carpeta de trabajo). Otros archivos: `load_skill {"name": "<skill o plugin>", "file": "ruta"}`, sin salir de la
  carpeta del plugin.
- Si un nombre coincide, gana lo del proyecto o del usuario sobre lo del plugin.

## Lo que NO hace

Los **hooks**, **servidores MCP** y **scripts** de un plugin no se ejecutan nunca: instalar un plugin no puede correr
código en el equipo. Si una skill pide ejecutar un script suyo, el agente tendría que hacerlo con `run_command`,
que pide permiso como cualquier otro comando.

## Código

- `desktop/lib/plugins.js`: instalar, índice en memoria, lectura segura, activar/desactivar, quitar.
- `desktop/main.js`: canales `plugins:*`; `skills:list`, `skills:read`, `project:agents` y `project:commands`
  mezclan lo de los plugins activos.
- `web/js/agent.js`: `catalogLines` (agrupado por plugin) y `load_skill` con `file`.
- Pruebas: `node --test tests/unit.test.mjs` (bloque «plugins»).
