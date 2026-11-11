# Automatizaciones

JeanCode replica las tres formas de automatizar de Claude Code: **hooks**, **tareas programadas** y **`/loop`**.

## Hooks

Comandos que se ejecutan solos en momentos concretos del agente. Sirven para imponer reglas («nunca toques `.env`»), formatear, avisar o dar contexto, sin depender de que el modelo se acuerde.

- **Del proyecto:** `.jeancode/hooks.json` en la carpeta de trabajo. JeanCode te pide confianza la primera vez y cada vez que el archivo cambia.
- **Globales:** Ajustes → Comportamiento → Hooks globales. Se aplican en todas tus carpetas.

| EVENTO | CUÁNDO | QUÉ PUEDE HACER |
|---|---|---|
| `session_start` | al empezar una conversación del agente | su salida queda como contexto de la sesión |
| `user_prompt` | antes de enviar tu mensaje | salir con **2** = no se envía · su salida se añade como contexto |
| `pre_tool` | antes de cada herramienta | salir con **2** = la bloquea (el motivo llega al modelo) · `{"decision":"allow"}` = la aprueba sin preguntar (salvo lo destructivo) |
| `post_tool` | después de cada herramienta | su salida se añade al resultado |
| `post_edit` | tras escribir o editar un archivo | admite `{path}` en el comando (p. ej. un formateador) |
| `stop` | cuando el agente va a terminar | salir con **2** = sigue trabajando con tu motivo como instrucción (máx. 3 veces) |
| `post_turn` | al final del turno | su salida se muestra en el chat |

Cada hook es un comando o `{ "matcher": "regex", "command": "…", "timeout": 60 }`. El `matcher` filtra por nombre de herramienta en `pre_tool` y `post_tool` (`run_command`, `write_file|edit_file`, `mcp__github__.*`…). El hook recibe por la **entrada estándar** un JSON: `{ "event", "tool", "args", "result", "prompt", "workspace" }`.

**Respuestas:** salir con **0** = todo bien; la salida estándar es texto o un JSON `{ "decision": "block" | "allow", "reason": "…", "context": "…" }`. Salir con **2** bloquea; el error estándar es el motivo. Cualquier otro código es un aviso y no bloquea.

```json
{
  "pre_tool": [
    { "matcher": "read_file|write_file|edit_file", "command": "node .jeancode/no-env.js" }
  ],
  "post_edit": ["npx prettier --write {path}"],
  "stop": [{ "command": "node .jeancode/exigir-pruebas.js" }]
}
```

`.jeancode/no-env.js`, que impide leer o tocar `.env`:

```js
let s = '';
process.stdin.on('data', (c) => (s += c)).on('end', () => {
  const { args } = JSON.parse(s);
  if (/(^|[\\/])\.env/.test(String(args?.path || ''))) {
    console.error('Los archivos .env no se tocan.');
    process.exit(2);
  }
});
```

## Tareas programadas

**Más → Automatizaciones.** Una tarea es un mensaje para el agente, una carpeta y una frecuencia: cada 15 min a 12 h, cada día, de lunes a viernes o cada lunes a una hora.

- Corren mientras JeanCode está abierto. Si una se perdió con la app cerrada, se ejecuta una vez al abrirla.
- **Nadie puede aprobar nada durante una ejecución.** Lo que pediría permiso se deniega y se anota en el resultado («Quedó pendiente de tu permiso»).
- Solo corren los comandos que ya marcaste como «permitir siempre» en esa carpeta y las herramientas de apps que permitiste siempre.
- Hay dos modos: *Solo lectura* (investigar, revisar, informar) y *Puede editar archivos*. Cada ejecución dura como mucho 30 minutos.
- El resultado queda en una conversación propia (⏱ nombre) y recibes una notificación del sistema.

Ideas: «revisa los issues nuevos de GitHub y resume los urgentes» (con la app de GitHub conectada), «ejecuta las pruebas y dime si algo se rompió», «lee mi calendario de mañana y prepara un resumen».

## `/loop`

`/loop 10m <mensaje>` envía el mensaje ahora y luego cada 10 minutos en la conversación actual, mientras la app siga abierta (como máximo 7 días). `/loop stop` lo para. Intervalos: `90s`, `10m`, `2h` (entre 1 minuto y 24 horas).
