# Control del equipo

JeanCode puede operar la PC donde se ejecuta: ver la pantalla o leer los controles de las ventanas, mover el ratón, hacer clic, escribir, pulsar atajos, abrir aplicaciones, usar la terminal y manejar archivos. Funciona en el **modo AGENTE de la app de escritorio**, solo si lo activas en **Ajustes → Equipo**.

No es escritorio remoto: controla únicamente el equipo donde corre JeanCode.

## Arquitectura

```
Modelo (Jean, OpenRouter, Ollama…)
  → agente (web/js/agent.js, el mismo bucle de siempre)
      → catálogo y permisos (web/js/computer.js)
          → puente seguro (desktop/preload.js: window.jeancodeDesktop.computer)
              → capa de control (desktop/lib/computer/control.js)
                  → driver del sistema (desktop/lib/computer/driver.js + win-driver.ps1)
                      → Windows (SendInput, SetCursorPos, UI Automation)
```

| Pieza | Qué hace |
|---|---|
| `web/js/computer.js` | Catálogo único de acciones (esquema, nivel de riesgo y texto del permiso), la política de permisos y las instrucciones para el modelo. |
| `web/js/agent.js` | Añade las herramientas al bucle del agente cuando el control está activo. Cada acción pasa por `permit()` antes de `act()`. Las capturas viajan como imagen solo a modelos con visión, y solo la última. |
| `web/js/app.js` | Abre y cierra la sesión por turno, pide los permisos (trae JeanCode al frente para ello) y muestra la línea de estado, la pestaña de Ajustes y el registro. |
| `desktop/lib/computer/control.js` | Una tarea a la vez y acciones en serie. Gestiona la pausa, la parada (mata el driver: deja de teclear al instante), el cambio de coordenadas, la protección de la propia ventana, la redacción de secretos y el registro en disco. |
| `desktop/lib/computer/win-driver.ps1` | Proceso persistente de PowerShell con C# nativo: ratón y teclado (`SendInput`), captura (`CopyFromScreen`) y lectura de controles (UI Automation, con soporte para controles Win32 clásicos). |
| `desktop/main.js` | IPC, barra flotante, atajo de emergencia y exclusión de JeanCode de las capturas. |

### Acciones

| Acción | Riesgo | Qué hace |
|---|---|---|
| `screenshot` | bajo | Captura la pantalla principal (JPEG de 1366 px de ancho). Solo para modelos con visión. |
| `inspect_screen` | bajo | Lista los controles de la ventana activa: id, tipo, nombre, valor y posición. Funciona con modelos **sin visión**, como Jean. |
| `list_windows`, `focus_window` | bajo | Ventanas abiertas; traer una al frente. |
| `mouse_move`, `mouse_click`, `mouse_drag`, `scroll` | bajo | Ratón real. Las coordenadas son las de la captura y JeanCode las pasa a píxeles reales. |
| `click_element`, `set_text` | bajo | Clic o texto en un control **por su nombre** (`{"name": "Guardar"}`, sin importar tildes ni mayúsculas) o por su id. Los campos sin nombre se encuentran por la etiqueta que tienen al lado («Correo:» [____]). Si no existe, el error sugiere los controles que sí hay. |
| `read_text` | bajo | Lee el texto visible de la ventana activa (o de la pantalla) con el **OCR de Windows**: sirve en apps que no exponen sus controles (lienzos, PDFs, juegos, webs) y con modelos sin visión. |
| `click_text` | bajo | Clic sobre un texto visible leído por OCR (`nth` si aparece varias veces). |
| `wait_for` | bajo | Espera (máx. 30 s) a que aparezca un texto, en los controles o en pantalla. |
| `type_text` | bajo | Teclado real (Unicode). Se niega en campos de contraseña. |
| `key_press` | medio / **alto** | Teclas y atajos. Los que llevan Win o F4 son de riesgo alto. |
| `open_application` | medio / **alto** | Abre un programa, archivo o carpeta. Un shell o intérprete (cmd, PowerShell, Python, mshta…), o abrir algo con argumentos, es riesgo alto. |
| `wait` | bajo | Espera a que la interfaz cambie. |

**Verificación automática.** Si el agente inspeccionó la ventana antes, cada clic, tecla o texto devuelve `changes`: los controles que aparecieron y los que ya no están (p. ej. `aparece: Text «Clics: 2» | ya no está: Text «Clics: 1»`), o «la ventana no cambió». Así un modelo pequeño ve el efecto de su acción y no repite a ciegas.

El agente también tiene, sin depender del control de pantalla:
- `run_command` (la terminal de siempre).
- `start_process`, `process_output` y `stop_process` para servidores de desarrollo.
- `move_file` y `delete_file`. Borrar manda a la papelera, que es recuperable, y pide confirmación siempre.

### Cómo trabaja el agente

Observa (`inspect_screen` o `screenshot`), decide, hace **una** acción y verifica: cada acción devuelve la ventana activa resultante. Si algo no salió como esperaba, vuelve a observar y corrige, en lugar de seguir a ciegas. Un error de una acción vuelve al modelo como texto y la tarea continúa. El historial del agente se conserva, así que tras detenerla puedes escribir «continúa».

## Permisos

| Nivel | Por defecto | Configurable |
|---|---|---|
| Bajo: mirar, mover, clic, escribir | se permite | puede pasar a «preguntar cada vez» |
| Medio: atajos, abrir aplicaciones, texto con saltos de línea | pregunta una vez por tarea y por **acción exacta** (la misma herramienta con los mismos argumentos) | puede pasar a «cada vez» |
| Alto: atajos con Win/Alt+F4, abrir shells o con argumentos, **teclear en una terminal**, borrar archivos, comandos destructivos | pregunta **siempre** | no |

- Los comandos de terminal y la escritura de archivos siguen el modo de permisos del agente. Un comando destructivo (`rm -rf`, `git reset --hard`, `reg delete`, `shutdown`…) pregunta aunque esté en tu lista de permitidos.
- Enviar una captura a un proveedor externo pide permiso, salvo que lo permitas en Ajustes. Con modelos locales o con tu Codespace, la captura no sale de tus equipos.
- En modo PLAN el agente solo puede observar.

## Protecciones

- **Desactivado por defecto.** Activarlo pide confirmación y explica qué permite.
- **Se ve siempre:** una barra flotante muestra cada acción, y la línea de estado del agente también.
- **Parada inmediata:** DETENER (en JeanCode o en la barra), Esc o `Ctrl+Alt+Q` desde cualquier app. Cortan la acción en curso (aunque esté tecleando), descartan la cola, matan los comandos en curso con todos sus subprocesos y, con el atajo de emergencia, también los procesos en segundo plano.
- **Pausa y reanudación** desde la barra o la línea de estado.
- **No se opera a sí mismo.** Antes de cada clic se pregunta al sistema de quién es la ventana que hay bajo ese punto, y antes de teclear de quién es la ventana activa. Si es JeanCode, se rechaza: el agente no puede aprobar sus propios permisos ni cambiar los ajustes.
- **Teclear en una terminal es ejecutar comandos.** Si la ventana activa es una terminal (se reconoce por la clase de la ventana: consola clásica, Windows Terminal, ConEmu, mintty…), escribir o pulsar teclas es riesgo alto. Además, el proceso principal se niega salvo que la interfaz haya registrado tu aprobación, que vale para una sola acción y no viaja en los argumentos del modelo, así que el modelo no puede falsificarla. Para ejecutar comandos, `run_command` sigue siendo el camino con su propio permiso.
- **Nunca escribe contraseñas.** Si el campo con el foco es de contraseña (UI Automation o el estilo `ES_PASSWORD` de Win32), `type_text` y `set_text` se niegan.
- **Secretos:** todo lo que se observa (títulos de ventana, nombres y valores de controles) pasa por el redactor antes de llegar al modelo o al registro. Además, JeanCode y la barra flotante se excluyen de las capturas (`setContentProtection`).
- **Registro:** cada acción queda en `computer-actions.jsonl` (carpeta de datos de la app) con su resultado y duración, **sin el texto tecleado**. Puedes verlo y copiarlo en Ajustes → Equipo.

## Plataformas

| | Windows 10/11 | macOS | Linux |
|---|---|---|---|
| Ratón, teclado, capturas, UI Automation | sí | no disponible | no disponible |
| Terminal, procesos, archivos | sí | sí | sí |

En macOS y Linux, Ajustes → Equipo explica que el control de pantalla no está disponible; el resto del agente funciona igual. Para añadir un sistema hay que escribir un driver con el mismo protocolo (una orden JSON por línea: `screenshot`, `inspect`, `click`, `type`, `keys`, `owner_at`…) y elegirlo en `driver.js`.

### Límites reales

- Las ventanas que se ejecutan **como administrador** no aceptan entrada de un proceso sin privilegios (UIPI de Windows). El driver lo informa como error.
- La pantalla de bloqueo, el Ctrl+Alt+Supr y el escritorio seguro de UAC no se pueden operar, por diseño de Windows.
- Solo se usa la **pantalla principal**.
- Algunas apps (juegos, aplicaciones con dibujo propio) no exponen controles a UI Automation: ahí solo sirven la captura y las coordenadas, lo que exige un modelo con visión.

## Pruebas

```bash
node --test tests/unit.test.mjs                                   # riesgos, permisos y bucle del agente
node --test --test-concurrency=1 tests/computer/control.test.mjs  # Windows real: ratón, teclado, capturas, parada…
```

`tests/computer/control.test.mjs` usa el ratón y el teclado reales contra una ventana de prueba propia (`tests/computer/test-form.ps1`) y comprueba cada resultado leyendo el estado real de sus controles. Necesita una sesión de escritorio desbloqueada y no toca ninguna otra aplicación.
