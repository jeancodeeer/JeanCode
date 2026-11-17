# Automatizaciones

JeanCode replica las automatizaciones de Claude con el **mismo formato y la misma semántica**: **hooks** (los de
Claude Code, que funcionan tal cual), **tareas programadas** (cron, una sola vez o manuales, con historial) y la
**autoprogramación del agente** (`schedule_task`, `send_later`, `/loop` con `schedule_wakeup`). Todo es local: corre
en tu PC mientras JeanCode está abierto.

## Hooks

Comandos (o comprobaciones con un modelo) que se ejecutan solos en momentos concretos del agente. Sirven para imponer
reglas («nunca toques `.env`»), formatear, avisar o dar contexto sin depender de que el modelo se acuerde.

### Dónde se configuran

| ÁMBITO | ARCHIVO | CONFIANZA |
|---|---|---|
| Usuario | Ajustes → Comportamiento → Hooks del usuario (`<datos de JeanCode>/settings.json`, como `~/.claude/settings.json`) | no la pide: los escribes tú |
| Proyecto | `.claude/settings.json`, `.claude/settings.local.json`, `.jeancode/settings.json`, `.jeancode/settings.local.json` | se pide la primera vez y cada vez que cambian |
| Proyecto (antiguo) | `.jeancode/hooks.json` con el formato de JeanCode ≤ 1.2 (`pre_tool`, `post_edit`…) | igual; se convierte solo |

Se suman todos (el mismo comando en dos archivos corre una vez). `"disableAllHooks": true` en cualquiera los apaga.
`/hooks` en el agente muestra los activos y de dónde vienen. Los **plugins** no aportan hooks: nunca se ejecutan.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/hooks/revisa-comando.js", "timeout": 30 }] },
      { "matcher": "Read|Write|Edit", "hooks": [{ "type": "command", "command": "node .claude/hooks/no-env.js" }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "node .claude/hooks/formatea.js" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "prompt", "prompt": "¿El agente ejecutó las pruebas y pasaron? $ARGUMENTS" }] }
    ]
  }
}
```

### Eventos

| EVENTO | CUÁNDO | MATCHER SOBRE | PUEDE |
|---|---|---|---|
| `PreToolUse` | antes de cada herramienta | `tool_name` | permitir (sin diálogo), denegar, pedir confirmación, reescribir los argumentos |
| `PermissionRequest` | cuando se iba a mostrar un diálogo de permiso | `tool_name` | permitir o denegar en tu nombre |
| `PostToolUse` | tras una herramienta que funcionó | `tool_name` | dar contexto al modelo o hacerle saber un problema |
| `PostToolUseFailure` | tras una herramienta que falló | `tool_name` | ídem |
| `UserPromptSubmit` | antes de enviar tu mensaje | — | rechazarlo o añadirle contexto |
| `Notification` | JeanCode te pide permiso, o espera tu respuesta con la ventana en segundo plano | `notification_type` (`permission_prompt`, `idle_prompt`) | avisarte por otro canal |
| `Stop` / `SubagentStop` | el agente / un subagente va a terminar | — / `agent_type` | obligarlo a seguir |
| `SubagentStart` | se lanza un subagente | `agent_type` | darle contexto |
| `PreCompact` | antes de compactar | `trigger` (`manual`, `auto`) | impedirlo |
| `SessionStart` | empieza una sesión del agente | `source` (`startup`, `resume`, `clear`, `compact`) | dar contexto para toda la sesión |
| `SessionEnd` | cambias de conversación, `/clear` o cierras la app | `reason` (`other`, `clear`, `prompt_input_exit`) | limpiar, registrar |

El `matcher` es una expresión regular que debe coincidir entera (`Bash`, `Write|Edit`, `mcp__github__.*`); vacío o
`*` = todas. Las herramientas se llaman como en Claude Code y también vale su nombre de JeanCode:

| CLAUDE CODE | JEANCODE |
|---|---|
| `Bash` | `run_command`, `start_process` |
| `Read` · `Write` · `Edit` | `read_file` · `write_file` · `edit_file` |
| `Glob` · `Grep` · `LS` | `glob` · `search` · `list_dir` |
| `WebFetch` · `Task` · `TodoWrite` · `Skill` · `ScheduleWakeup` | `webfetch` · `spawn_subagent` · `todo_write` · `load_skill` · `schedule_wakeup` |
| `mcp__<app>__<herramienta>` | igual |

### Entrada

JSON por la entrada estándar, con los campos de Claude Code: `session_id`, `transcript_path` (la conversación en
JSONL), `cwd`, `permission_mode` (`default`, `acceptEdits`, `plan`), `hook_event_name` y los del evento:
`tool_name`, `tool_input` (con los campos de Claude: `command`, `file_path`, `content`, `old_string`, `new_string`…,
rutas absolutas), `tool_response`, `error`, `prompt`, `stop_hook_active`, `last_assistant_message`, `source`,
`reason`, `trigger`, `custom_instructions`, `notification_type`, `message`, `agent_id`, `agent_type`. Además van
`jeancode_tool` y `jeancode_args` con el nombre y los argumentos originales. Variables de entorno:
`CLAUDE_PROJECT_DIR` y `JEANCODE_PROJECT_DIR` (la carpeta del proyecto).

### Salida

- **Código 0**: bien. La salida estándar puede ser texto (en `UserPromptSubmit` y `SessionStart` se convierte en
  contexto para el modelo; en el resto se muestra en el chat) o un JSON:
  `continue` (false = el agente para; `stopReason` te dice por qué), `systemMessage` (aviso para ti),
  `suppressOutput`, `decision: "block"` + `reason`, y `hookSpecificOutput` con `permissionDecision`
  (`allow` · `deny` · `ask`), `permissionDecisionReason`, `updatedInput`, `additionalContext` o, en
  `PermissionRequest`, `decision: { "behavior": "allow" | "deny", "message", "updatedInput" }`.
- **Código 2**: bloquea. El error estándar es el motivo: en `PreToolUse` la herramienta no se ejecuta y el motivo va al
  modelo; en `PermissionRequest` se deniega; en `Stop` el agente sigue con el motivo como instrucción; en
  `UserPromptSubmit` el mensaje no se envía.
- **Otro código**: error que no bloquea; se te avisa.

Varios hooks del mismo evento corren **en paralelo**; si discrepan, gana `deny`, luego `ask`, luego `allow`.

**Hooks de tipo `prompt`** (`PreToolUse`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SubagentStop`): en vez de un
comando, una pregunta que evalúa el modelo de la conversación. `$ARGUMENTS` se sustituye por la entrada del hook;
`{"ok": false, "reason": "…"}` bloquea.

**Lo que ningún hook puede saltarse:** los comandos destructivos y mandar a la papelera siempre preguntan, aunque un
hook diga `allow`. Un `Stop` que no mire `stop_hook_active` no puede tener al agente trabajando sin fin: como mucho 10
veces seguidas.

`.claude/hooks/no-env.js`, que impide leer o tocar `.env` (sirve igual en Claude Code):

```js
let s = '';
process.stdin.on('data', (c) => (s += c)).on('end', () => {
  const { tool_input } = JSON.parse(s);
  if (/(^|[\\/])\.env/.test(String(tool_input?.file_path || ''))) {
    console.error('Los archivos .env no se tocan.');
    process.exit(2);
  }
});
```

## Tareas programadas

**Más → Automatizaciones**, o pídeselo al agente («cada lunes a las 9 revisa las dependencias»). Una tarea es:

- **Qué hacer** (un mensaje autónomo para el agente) y **dónde** (carpeta de trabajo).
- **Cuándo**: *Manual* (solo «Ejecutar ahora»), *Una sola vez* a una fecha y hora, *Cada hora* (en el minuto en que la
  creaste), *Cada día*, *Días laborables*, *Cada semana* o *Personalizada* con una expresión **cron** de 5 campos
  (`minuto hora día mes día-de-la-semana`, hora local; `CRON_TZ=Europe/Madrid 0 9 * * MON-FRI` para otra zona;
  `@daily`, `@weekly`…). El formulario muestra las próximas tres ejecuciones.
- **Modelo** (automático o uno fijo), **permisos** (*Solo lectura* o *Puede editar archivos*), **conversación**
  (*nueva cada vez* o *siempre la misma*, que recuerda lo anterior) y **notificación** al terminar.

Cada tarea guarda su **historial** (las últimas 20 ejecuciones: cuándo, cuánto duró, si fue programada, a mano o por
el agente, el resultado y un enlace a la conversación). «Historial e instrucciones extra» permite **ejecutarla ahora
con instrucciones adicionales** solo para esa vez. Se puede **editar**, **pausar** y **borrar**.

Cómo se ejecutan (igual que una sesión programada de Claude):

- Mientras JeanCode está abierto. Si una se perdió con la app cerrada, se ejecuta **una vez** al abrirla (no una por
  cada hora perdida). Las de *una sola vez* quedan en pausa tras ejecutarse.
- **Nadie puede aprobar nada.** Lo que pediría permiso se deniega y se anota («Quedó pendiente de tu permiso»).
  Solo corren los comandos que marcaste «permitir siempre» en esa carpeta y las herramientas de apps que permitiste
  siempre.
- Corren los **hooks** del usuario y los del proyecto en los que ya confiaste (`SessionStart`, `Stop`, `SessionEnd`…).
  Si el proyecto tiene hooks sin confirmar, no corren y se avisa en el resultado.
- Una ejecución dura como mucho 30 minutos. Van de una en una.

## El agente programa

| HERRAMIENTA | EQUIVALE EN CLAUDE A | QUÉ HACE |
|---|---|---|
| `schedule_task` | las herramientas de tareas programadas | `list`, `runs` (historial), `create`, `update`, `delete`, `run` (con `text` extra). Crear, cambiar, borrar y lanzar **piden tu permiso** con la tarea completa a la vista; en PLAN solo lista |
| `send_later` | `send_later` | un mensaje que vuelve a **esta** conversación dentro de X minutos o a una hora. Si la tienes abierta, se entrega como un mensaje normal cuando el agente quede libre |
| `schedule_wakeup` | `ScheduleWakeup` | en un `/loop` sin intervalo, cuándo repetir (60–3600 s) |

Las tareas creadas por el agente se marcan como tales en el panel; como mucho 20 activas.

## `/loop`

- `/loop 10m <mensaje>`: envía el mensaje ahora y luego cada 10 minutos en la conversación actual (`90s`, `10m`,
  `2h`, `1d`; entre 1 minuto y 24 horas).
- `/loop <mensaje>` (sin intervalo, solo en el agente): **el agente marca el ritmo**. Tras cada iteración llama a
  `schedule_wakeup` con el plazo que tenga sentido (esperar a un CI, a un despliegue…); si no lo llama, el bucle
  termina.
- `/loop stop` lo para. Como máximo 7 días.
