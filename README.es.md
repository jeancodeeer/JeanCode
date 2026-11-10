<div align="center">

<img src="assets/social-preview.svg" alt="JeanCode — agente de programación con IA, de código abierto, para tu escritorio. Usa cualquier modelo: Ollama, llama.cpp, OpenRouter, NVIDIA NIM o tu propia API Jean gratis" width="100%">

<br>

# JeanCode — el agente de programación con IA, abierto, que trae su propio modelo

**Chatea · genera proyectos completos · usa un agente que edita código, ejecuta comandos, revisa sus propios errores y puede manejar tu PC.**<br>
Cualquier modelo compatible con OpenAI: **Ollama, llama.cpp, LM Studio, OpenRouter, NVIDIA NIM, Groq, DeepSeek** y 28 proveedores en la nube — o tu propia API Jean **gratis** en GitHub Codespaces.

[![ABRIR](https://img.shields.io/badge/ABRIR-JEANCODE_WEB-000000?style=for-the-badge&labelColor=ffffff)](https://jeancodeeer.github.io/JeanCode/)
[![DESCARGAR](https://img.shields.io/badge/DESCARGAR-WIN_%7C_MAC_%7C_LINUX-ffffff?style=for-the-badge&labelColor=000000)](https://github.com/jeancodeeer/JeanCode/releases/latest)
[![API GRATIS](https://img.shields.io/badge/API_GRATIS-JEAN--API--GENERATOR-ffffff?style=for-the-badge&labelColor=000000)](https://github.com/jeancodeeer/Jean-API-Generator)
[![MODELOS](https://img.shields.io/badge/MODELOS-HUGGING_FACE-ffffff?style=for-the-badge&labelColor=000000)](https://huggingface.co/JeanCoder/jean-models)

[`ENGLISH`](README.md) · **`ESPAÑOL`**

</div>

```
N° 001 — JEANCODE                                                     REF. 1.x
Sin servidor, sin cuenta, sin telemetría. Tu modelo, tus claves, tu máquina.
```

<p align="center">
  <img src="docs/screenshots/chat.png" alt="JeanCode chat with Jean Grey on Ollama" width="100%">
  <br><sub>Modo chat — respuesta real de Jean Grey ejecutándose en local con Ollama (CPU, sin nube).</sub>
</p>

<br>

## 01 — POR QUÉ JEANCODE

- **Usa el modelo que quieras.** 28 proveedores en la nube ya configurados (OpenAI, Anthropic, Gemini, OpenRouter, Groq, NVIDIA NIM, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, SambaNova, DeepInfra, Moonshot/Kimi, Z.ai/GLM, Qwen, MiniMax, Cohere y más) y además **Ollama, LM Studio, LiteLLM, llama.cpp, vLLM, Jan y KoboldCpp** en tu propia PC. Cambia de modelo a mitad de conversación.
- **Un camino gratis que funciona.** Conéctalo a [Jean-API-Generator](https://github.com/jeancodeeer/Jean-API-Generator) y tienes tu propia API compatible con OpenAI en un Codespace gratuito de GitHub: sin tarjeta y sin cuotas nuestras.
- **Un agente de verdad, no una caja de chat.** Lee, busca y edita tus archivos, ejecuta comandos con tu permiso, lanza subagentes en paralelo, carga skills, mantiene una lista de tareas y **vuelve atrás** archivos y conversación a cualquier mensaje.
- **Revisa su propio trabajo.** Tras cada edición recibe los errores de sintaxis del archivo (JS, JSON, Python, PowerShell, Bash, Go) y los corrige antes de seguir, como un LSP, sin ejecutar nada de tu repositorio.
- **Puede usar tu computadora** (Windows). Ve la pantalla, lee los controles de las ventanas, hace clic, escribe y pulsa atajos, con permisos por nivel de riesgo, una barra flotante para DETENER y parada de emergencia con `Ctrl+Alt+Q`.
- **Nada oculto.** `/context` muestra el prompt exacto que recibe el modelo y cuántos tokens ocupa cada parte. `/doctor` revisa toda tu configuración de una vez.

<br>

## 02 — EMPIEZA EN UN MINUTO

| TIENES | HAZ ESTO |
|---|---|
| **Ollama / LM Studio** en tu PC | Instala la [app de escritorio](https://github.com/jeancodeeer/JeanCode/releases/latest) → **Usar los modelos de esta PC**. Un clic, sin claves. |
| **Una clave de API** (OpenRouter, Groq, NVIDIA…) | Abre [JeanCode web](https://jeancodeeer.github.io/JeanCode/) → elige el proveedor → pega la clave. La URL se completa sola. |
| **Nada todavía** | Crea tu API gratis con [Jean-API-Generator](https://github.com/jeancodeeer/Jean-API-Generator) (un Codespace, ~5 min) y pega su URL `…-8899.app.github.dev/v1`. |

La versión web es una PWA instalable que funciona sin conexión. El modo **AGENT** y el control del equipo necesitan la app de escritorio (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`).

<br>

## 03 — TRES MODOS

<table>
<tr>
<td width="33%" valign="top"><b>CHAT</b> · web + escritorio<br>Markdown en streaming, bloques de código, razonamiento plegable y consumo de tokens por respuesta.</td>
<td width="33%" valign="top"><b>CODE</b> · web + escritorio<br>Describes un proyecto y se escriben todos los archivos. Árbol, vista previa en vivo y descarga en <code>.zip</code>. Nada se ejecuta en tu PC.</td>
<td width="33%" valign="top"><b>AGENT</b> · escritorio<br>Un agente al estilo de Claude Code y OpenCode, dentro de la carpeta que elijas.</td>
</tr>
</table>

<br>

## 04 — EL AGENTE

| | |
|---|---|
| **Herramientas** | `list_dir` · `glob` · `read_file` · `search` · `diagnostics` · `webfetch` · `write_file` · `edit_file` · `move_file` · `delete_file` (a la papelera) · `run_command` · `start_process` / `process_output` / `stop_process` (servidores de desarrollo) · `todo_write` · `spawn_subagent` · `load_skill` |
| **BUILD / PLAN** | `BUILD` implementa; `PLAN` solo investiga y propone. `Tab` alterna. Tras un plan: **Aprobar y ejecutar en BUILD**. |
| **Permisos** | `PREGUNTAR TODO` · `EDITAR SIN PREGUNTAR` · `SOLO LECTURA`. Cada edición muestra antes el diff. **Permitir siempre aquí** por carpeta y comando exacto; los comandos destructivos preguntan siempre igualmente. |
| **Volver atrás** | **Volver aquí** en cada mensaje. En carpetas git el punto de control cubre todo el árbol, así que también vuelven los archivos que cambió un comando. |
| **Autorrevisión** | Diagnóstico de sintaxis tras cada escritura. `diagnostics` con `deep` añade TypeScript, ESLint y `tsc` del propio proyecto, con tu permiso, porque eso ejecuta código del repositorio. |
| **Subagentes** | Varios `spawn_subagent` corren en paralelo con su propio contexto; cada uno informa pasos, herramientas, errores, tokens y tiempo. Subagentes del proyecto en `.jeancode/agents/*.md`. |
| **Skills** | Carpetas con un `SKILL.md`. Se instalan desde una carpeta, un repo git o una URL. Ver [`skills/`](skills/). |
| **Memoria del proyecto** | `AGENTS.md`, `JEANCODE.md` o `CLAUDE.md` se cargan en cada sesión; `/init` crea uno. Las **reglas fijadas** sobreviven a la compactación. |
| **Hooks** | `.jeancode/hooks.json` (`post_edit`, `post_turn`), con confianza pedida una vez por cada cambio. |
| **Contexto** | El medidor usa la ventana **real** del modelo (la informa el proveedor, el router o llama-server). Al 85 % pregunta antes de compactar y muestra el resumen. |

**Comandos:** `/new` `/clear` `/compact` `/context` `/doctor` `/model <id>` `/export` `/help` · CODE: `/zip` · AGENT: `/init` `/plan` `/build` `/undo` `/review` · y los tuyos en `.jeancode/commands/<nombre>.md`.
**Teclas:** `Esc` detener · `Ctrl+K` nueva · `Ctrl+1/2/3` modo · `Tab` BUILD↔PLAN · `@` adjuntar archivo.

<br>

## 05 — CONTROL DEL EQUIPO (WINDOWS)

Actívalo en **Ajustes → Equipo** y el agente podrá manejar tu escritorio: captura de pantalla, lectura de los controles de cualquier ventana (UI Automation, así funciona incluso con modelos sin visión), mover y hacer clic, arrastrar, desplazar, escribir, pulsar atajos, cambiar de ventana y abrir aplicaciones, en un ciclo observar → actuar → verificar.

| RIESGO | EJEMPLOS | POR DEFECTO |
|---|---|---|
| **Bajo** | leer la pantalla, clic, escribir en una app normal | permitido |
| **Medio** | atajos, abrir aplicaciones, texto con Enter | se pregunta una vez por acción exacta |
| **Alto** | cualquier cosa en una terminal, abrir shells, `Win` / `Alt+F4` | **se pregunta siempre** |

Nunca escribe en campos de contraseña ni actúa sobre la ventana de JeanCode, registra cada acción sin el texto tecleado y se detiene al instante desde la barra flotante o con `Ctrl+Alt+Q`. Detalles y límites reales (ventanas de administrador, UAC, solo el monitor principal) en [docs/computer-control.md](docs/computer-control.md). macOS y Linux: todavía no.

<br>

## 06 — QUÉ HACE DISTINTO

Construido a partir de las quejas más comunes sobre Claude Code y OpenCode (issues, foros y reseñas):

| PROBLEMA EN OTROS | JEANCODE |
|---|---|
| Atado a los modelos de un solo proveedor | 28 proveedores en la nube + servidores locales + tu propia API gratis; cambias a mitad de sesión. |
| La compactación es opaca y pierde instrucciones | Nunca en silencio: pregunta al 85 % y muestra el resumen; reglas fijadas y memoria del proyecto van en cada turno. |
| El medidor supone una sola ventana | Usa la ventana real de cada modelo; `/compact` ajusta el resumen a ella. |
| Coste impredecible | Tokens bajo cada respuesta, total de la sesión y coste cuando el proveedor publica precios. |
| «¿Qué le está enviando de verdad?» | `/context` imprime el prompt exacto y el peso de cada parte. |
| Errores de configuración sin causa clara | `/doctor` revisa conexiones, modelo, ventana, carpeta, memoria, hooks y skills, con el arreglo de cada fallo. |
| Puntos de control que no cubren la terminal, o ninguno | **Volver aquí** restaura archivos *y* conversación; en git, todo el árbol de trabajo. |
| Fatiga de permisos | Permitir siempre por carpeta y comando exacto, editable; los destructivos siguen preguntando. |
| Sin respuesta de un LSP | Diagnóstico de sintaxis tras cada edición y revisión profunda a demanda. |
| Subagentes opacos | Traza por subagente: pasos, herramientas, errores, tokens y tiempo. |
| Interfaz cargada de un CDN, telemetría | Todo viene con la app. Sin analítica, sin backend, sin peticiones a Google. |

<br>

## 07 — CÓMO SE CONECTA

```
┌──────────────┐   tu URL + tu clave    ┌──────────────────────────────────────┐
│  JEANCODE    │ ─────────────────────▶ │ Ollama · LM Studio · llama.cpp       │
│  web / app   │ ◀───── streaming ───── │ OpenRouter · NVIDIA NIM · Groq · …   │
└──────────────┘                         │ o TU Jean-API-Generator (gratis)     │
                                         └──────────────────────────────────────┘
```

Cada conexión se valida antes de usarla (URL mal escrita, http desde una página https, clave en la URL, duplicados, proveedor que no corresponde a ese host: se corrige solo). **AUTO** elige un modelo por modo y salta las conexiones caídas; tú decides qué pasa cuando un modelo falla (mostrar el error, el mismo modelo por otra conexión o cualquier otro modelo). Cada respuesta lleva su ruta, sin claves. **Hugging Face**, en el menú lateral, carga cualquier GGUF del Hub en tu Codespace con barra de progreso.

El repositorio **no contiene URLs ni claves**. En el navegador se guardan en el almacenamiento local; en el escritorio la clave se cifra con el llavero del sistema.

<br>

## 08 — DESDE EL CÓDIGO

```bash
python -m http.server 8000 --directory web        # web: cualquier servidor estático
cd desktop && npm install && npm start            # escritorio (Electron)
node --test tests/unit.test.mjs                   # pruebas unitarias
node --test --test-concurrency=1 tests/computer/control.test.mjs   # pruebas reales de control del equipo (Windows)
```

```
web/        HTML/CSS/módulos ES sin paso de build (GitHub Pages + PWA)
desktop/    Electron; usa web/ como interfaz · lib/ = archivos, terminal, diagnósticos, control del equipo
skills/     skills de ejemplo     docs/     control del equipo, capturas
```

Publicar: `node scripts/version.mjs X.Y.Z` y la etiqueta `vX.Y.Z`. GitHub Actions compila los instaladores de Windows, macOS (Intel + Apple Silicon) y Linux y el `.zip` de la web. Historial: [CHANGELOG.md](CHANGELOG.md).

<br>

## 09 — PRIVACIDAD · SEGURIDAD

Sin backend, sin base de datos, sin analítica. Los mensajes van directo de tu equipo a la API que elegiste. El agente trabaja solo dentro de la carpeta que elijas (`..` y los enlaces que escapan se rechazan), el texto que lee de la pantalla se limpia de claves y tokens antes de llegar a un modelo, y nunca ejecuta las herramientas de tu repositorio sin preguntar. Reporta problemas: [SECURITY.md](SECURITY.md).

<br>

## 10 — LICENCIA

[GNU AGPL-3.0](LICENSE). Puedes usarlo, estudiarlo, modificarlo y compartirlo. Si distribuyes una versión modificada, o la ofreces como servicio en red, debes publicar su código con la misma licencia.

<div align="center">

<br>

Si JeanCode te ahorra una suscripción, una ⭐ ayuda a que otros lo encuentren.

```
JEANCODER © 2026 — CHAT ■ CODE ■ AGENT
```

</div>
