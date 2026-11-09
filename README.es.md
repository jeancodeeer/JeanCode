<div align="center">

<img src="assets/social-preview.svg" alt="JEANCODE — cliente gráfico de los modelos Jean: chat, proyectos de código descargables y agente de escritorio" width="100%">

<br>

[![ABRIR](https://img.shields.io/badge/ABRIR-JEANCODE_WEB-000000?style=for-the-badge&labelColor=ffffff)](https://jeancodeeer.github.io/JeanCode/)
[![DESCARGAR](https://img.shields.io/badge/DESCARGAR-WIN_%7C_MAC_%7C_LINUX-ffffff?style=for-the-badge&labelColor=000000)](https://github.com/jeancodeeer/JeanCode/releases/latest)
[![API](https://img.shields.io/badge/TRAE_TU-JEAN--API--GENERATOR-ffffff?style=for-the-badge&labelColor=000000)](https://github.com/jeancodeeer/Jean-API-Generator)

[`ENGLISH`](README.md) · **`ESPAÑOL`**

</div>

```
N° 001 — JEANCODE                                                    REF. V0.3
Cliente gráfico de los modelos Jean. Chatea, genera proyectos completos, usa un agente.
Sin servidor, sin cuenta, sin rastreo: trae tu propia Jean-API-Generator.
```

<br>

## 01 — QUÉ ES

**JeanCode** es la interfaz para programadores y vibecoders que prefieren hacer clic antes que escribir en una terminal. Se conecta a **tu propia** [`Jean-API-Generator`](https://github.com/jeancodeeer/Jean-API-Generator): los modelos Jean v0.7 servidos como API compatible con OpenAI desde un Codespace de GitHub.

| MODO | DÓNDE | QUÉ HACE |
|---|---|---|
| **CHAT** | web + escritorio | Conversación en streaming con Markdown, bloques de código con copiar y razonamiento plegable. |
| **CODE** | web + escritorio | Describes un proyecto y Jean escribe todos los archivos. Árbol de archivos, edición, vista previa de páginas web y descarga en `.zip`. No ejecuta nada en tu PC. |
| **AGENT** | solo escritorio | Agente de programación estilo Claude Code: inspecciona la carpeta que elijas, lee, busca y edita archivos, ejecuta comandos con tu permiso, lanza **subagentes** en paralelo y carga **skills**. |

<br>

## 02 — CÓMO SE CONECTA

1. Crea tu API con **[Jean-API-Generator](https://github.com/jeancodeeer/Jean-API-Generator)** (Codespace gratuito).
2. Abre **[JeanCode](https://jeancodeeer.github.io/JeanCode/)**. Si este equipo no tiene una API registrada, aparece un splash que pide tu **URL base** (terminada en `/v1`) y tu **API key**. También puede generarte una clave aleatoria segura para usarla como `JEAN_API_KEY`.
3. Agrega los dos puertos (Grey `:8888`, Marvel `:8889`) en **AJUSTES** para ver todos los modelos.

El repositorio **no contiene URLs ni claves**: cada usuario trae las suyas. En el navegador quedan en el almacenamiento local; en el escritorio la clave se cifra con el llavero del sistema (`safeStorage`).

<br>

### Otras APIs

Además de tu Jean-API-Generator, JeanCode se conecta a los proveedores que usa OpenCode, todos por su API compatible con OpenAI: **OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Hugging Face Inference Providers, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio** o cualquier servidor compatible con OpenAI. Eliges el proveedor en el splash o en AJUSTES; la URL se rellena sola y el selector agrupa los modelos por proveedor. Algunos proveedores bloquean las llamadas desde páginas web (CORS); la app de escritorio no tiene ese límite.

### Hugging Face → tu Codespace

**MODELOS DE HUGGING FACE**, en el menú lateral, busca modelos GGUF en el Hub, muestra cada archivo con su peso y si cabe en la RAM libre de tu Codespace, y lo carga en el puerto 8888, 8889 u 8890 con barra de progreso. Usa el servidor de control de Jean-API-Generator (`:8899`, misma `JEAN_API_KEY`). El token de HF es opcional (solo para modelos privados o restringidos), se queda en tu equipo y solo viaja a tu Codespace para esa descarga. **Restaurar** vuelve al modelo Jean.

### Fénix

Fénix (27B) corre solo en el puerto 8890: activa `fenix-mode` en Jean-API-Generator y JeanCode lo encuentra solo, o usa **Buscar Fénix** en AJUSTES.

<br>

## 03 — AGENTE DE ESCRITORIO

| | |
|---|---|
| **Carpeta aislada** | Toda ruta se resuelve dentro de la carpeta elegida; se rechazan `..` y enlaces que salgan de ella. |
| **Permisos** | `PREGUNTAR TODO` (por defecto) · `EDITAR SIN PREGUNTAR` (los comandos siguen preguntando) · `SOLO LECTURA`. |
| **Herramientas** | `list_dir` · `glob` · `read_file` · `search` · `webfetch` · `write_file` · `edit_file` · `run_command` · `system_info` · `todo_write` · `spawn_subagent` · `load_skill` |
| **Subagentes** | Varios `spawn_subagent` en un mismo turno corren en paralelo, cada uno con su contexto, y devuelven un informe. Solo lectura salvo que el agente pida escritura. |
| **Agentes BUILD / PLAN** | Como OpenCode: `BUILD` implementa y `PLAN` solo investiga y propone. `Tab` alterna. |
| **Memoria del proyecto** | `AGENTS.md`, `JEANCODE.md` o `CLAUDE.md` de la carpeta se cargan en cada sesión. `/init` lo crea. |
| **Diff antes de aprobar** | Cada cambio de archivo muestra el diff de líneas en la confirmación. `/undo` restaura el último archivo tocado. |
| **Lista de tareas** | En trabajos de varios pasos el agente mantiene una lista visible (`todo_write`), como Claude Code. |
| **Menciones `@`** | Escribe `@` para elegir un archivo de la carpeta; su contenido se adjunta al mensaje. |
| **Comandos del proyecto** | Cada `.jeancode/commands/<nombre>.md` se vuelve `/<nombre>` (`$ARGUMENTS` = lo que escribas después). |
| **Herramientas nativas** | Usa function calling de OpenAI (verificado en llama-server con Jean Grey) y, si el servidor no lo admite, un protocolo de texto. |
| **Interruptor RAZONAR** | Apagado por defecto: Jean responde sin su fase de razonamiento, unas 8 veces más rápido en un Codespace con CPU (1,3 s frente a 10,1 s medidos). Enciéndelo para tareas difíciles. |
| **Skills** | Carpetas con `SKILL.md` (`name` + `description`). Se instalan desde una carpeta, un repo git o la URL de un `SKILL.md`. Ver [`skills/`](skills/). |

Los instaladores para **Windows (.exe)**, **macOS (.dmg)** y **Linux (.AppImage)**, junto con la **versión web en .zip**, los compila GitHub Actions en cada [release](https://github.com/jeancodeeer/JeanCode/releases). La versión de macOS no está firmada: ábrela la primera vez con clic derecho → Abrir.

<br>

### Comandos y atajos (web + escritorio)

`/new` · `/clear` · `/compact` (resume para liberar contexto) · `/model <id>` · `/export` (Markdown) · `/help` · `/zip` (CODE) · `/init` · `/plan` · `/build` · `/undo` · `/review` (AGENT). Un medidor en la barra superior estima cuánto de la ventana de 131072 tokens se usa. `Esc` detiene la respuesta, `Ctrl+K` abre una conversación nueva y `Ctrl+1/2/3` cambia de modo.

<br>

## 04 — DESARROLLO

```bash
python -m http.server 8000 --directory web      # web
cd desktop && npm install && npm start          # escritorio
git tag v0.1.0 && git push origin v0.1.0        # publicar instaladores
```

<br>

## 05 — PRIVACIDAD Y LICENCIA

Página estática: sin backend, sin base de datos, sin analítica. Los mensajes van directo de tu navegador a tu API. Todavía no hay archivo de licencia publicado; por defecto, todos los derechos reservados.

<div align="center">

<br>

```
JEANCODER © 2026 — CHAT ■ CODE ■ AGENT
```

</div>
