<div align="center">

<img src="assets/social-preview.svg" alt="JEANCODE — graphical client for the Jean models: chat, downloadable code projects and a desktop coding agent" width="100%">

<br>

[![OPEN](https://img.shields.io/badge/OPEN-JEANCODE_WEB-000000?style=for-the-badge&labelColor=ffffff)](https://jeancodeeer.github.io/JeanCode/)
[![DOWNLOAD](https://img.shields.io/badge/DOWNLOAD-WIN_%7C_MAC_%7C_LINUX-ffffff?style=for-the-badge&labelColor=000000)](https://github.com/jeancodeeer/JeanCode/releases/latest)
[![API](https://img.shields.io/badge/BRING_YOUR-JEAN--API--GENERATOR-ffffff?style=for-the-badge&labelColor=000000)](https://github.com/jeancodeeer/Jean-API-Generator)
[![MODELS](https://img.shields.io/badge/MODELS-HUGGING_FACE-ffffff?style=for-the-badge&labelColor=000000)](https://huggingface.co/JeanCoder/jean-models)

**`ENGLISH`** · [`ESPAÑOL`](README.es.md)

</div>

```
N° 001 — JEANCODE                                                    REF. V0.2
A graphical client for the Jean models. Chat, generate whole projects, run an agent.
No server, no account, no tracking: bring your own Jean-API-Generator.
```

<br>

## 01 — WHAT IS THIS

**JeanCode** is the interface for developers and vibecoders who would rather click than type into a terminal. It talks to **your own** [`Jean-API-Generator`](https://github.com/jeancodeeer/Jean-API-Generator) — the Jean v0.7 models (Grey, Marvel, Fénix) served as an OpenAI-compatible API from a GitHub Codespace.

| MODE | WHERE | WHAT IT DOES |
|---|---|---|
| **CHAT** | web + desktop | Streaming conversation with rendered Markdown, code blocks with copy, collapsible reasoning. |
| **CODE** | web + desktop | Describe a project; Jean writes every file. Browse the file tree, edit, preview web pages live and download everything as a `.zip`. Nothing runs on your machine. |
| **AGENT** | desktop only | A coding agent in the style of Claude Code: inspects a folder you choose, reads, searches and edits files, runs terminal commands with your permission, launches **subagents** in parallel and loads **skills**. |

<br>

## 02 — HOW IT CONNECTS

```
┌──────────────┐   your URL + your key   ┌──────────────────────────┐
│  JEANCODE    │ ──────────────────────▶ │  YOUR JEAN-API-GENERATOR │
│  web / app   │ ◀────── streaming ───── │  llama-server · Jean v0.7│
└──────────────┘                          └──────────────────────────┘
```

1. Create your API from **[Jean-API-Generator](https://github.com/jeancodeeer/Jean-API-Generator)** (free GitHub Codespace).
2. Open **[JeanCode](https://jeancodeeer.github.io/JeanCode/)**. If this device has no API registered, a splash screen asks for your **base URL** (ending in `/v1`) and your **API key**. It can also generate a strong random key for you to use as `JEAN_API_KEY`.
3. Add both ports (Grey `:8888`, Marvel `:8889`) under **SETTINGS** to see every model in the selector.

The repository contains **no URLs and no keys**: every user brings their own. In the browser they stay in local storage; in the desktop app the key is encrypted with the OS keychain (`safeStorage`).

<br>

## 03 — DESKTOP AGENT

| | |
|---|---|
| **Workspace sandbox** | Every file path is resolved inside the folder you pick; `..` and symlinks that escape it are rejected. |
| **Permission modes** | `ASK EVERYTHING` (default) · `EDIT WITHOUT ASKING` (commands still ask) · `READ ONLY`. |
| **Tools** | `list_dir` · `glob` · `read_file` · `search` · `webfetch` · `write_file` · `edit_file` · `run_command` · `system_info` · `todo_write` · `spawn_subagent` · `load_skill` |
| **Subagents** | Several `spawn_subagent` calls in one turn run in parallel, each with its own context; their reports come back to the main agent. Read-only unless the agent asks for write access. |
| **Skills** | Folders with a `SKILL.md` (`name` + `description` frontmatter). Install from a local folder, a git repository or a raw `SKILL.md` URL. The agent sees the list and loads the one it needs. See [`skills/`](skills/). |
| **BUILD / PLAN agents** | Like OpenCode: `BUILD` implements, `PLAN` only investigates and proposes. Press `Tab` to switch. |
| **Project memory** | `AGENTS.md`, `JEANCODE.md` or `CLAUDE.md` in the workspace are loaded into every session. `/init` writes one for you. |
| **Diff before approval** | Every file change shows a line diff (`+` / `−`) in the confirmation dialog. `/undo` restores the last file the agent touched. |
| **Task list** | For multi-step work the agent keeps a visible checklist (`todo_write`), like Claude Code. |
| **`@` mentions** | Type `@` to pick a file from the workspace; its content is attached to your message. |
| **Project commands** | Every `.jeancode/commands/<name>.md` becomes `/<name>` (`$ARGUMENTS` = what you type after it). |
| **Model-agnostic tools** | Tool calls use a plain-text protocol, so they work even when the server has no native function calling. |

Installers are built by GitHub Actions for **Windows (.exe)**, **macOS (.dmg, Intel + Apple Silicon)** and **Linux (.AppImage)**, together with the **web version as a .zip** for self-hosting, and attached to each [release](https://github.com/jeancodeeer/JeanCode/releases). The macOS build is not signed: open it the first time with right-click → Open.

<br>

### Commands and shortcuts (web + desktop)

`/new` · `/clear` · `/compact` (summarise to free context) · `/model <id>` · `/export` (Markdown) · `/help` · `/zip` (CODE) · `/init` · `/plan` · `/build` · `/undo` · `/review` (AGENT). A context meter in the top bar estimates how much of the 131072-token window is used. `Esc` stops a reply, `Ctrl+K` starts a new conversation, `Ctrl+1/2/3` switches mode.

<br>

## 04 — REPOSITORY

```
JeanCode/
├── web/                     # the web client (GitHub Pages) — plain HTML/CSS/ES modules, no build step
│   ├── index.html
│   ├── css/jeancode.css     # neubrutalism · black & white · IBM Plex
│   └── js/                  # app, api (OpenAI streaming), code (file blocks), agent, md, zip, store
├── desktop/                 # Electron app — reuses web/ as its UI
│   ├── main.js              # window, encrypted config, network without CORS, IPC
│   ├── preload.js           # the only bridge the UI can see (contextIsolation + sandbox)
│   └── lib/                 # tools.js (files, terminal, system) · skills.js
├── skills/                  # example skills
└── .github/workflows/       # pages · desktop installers · syntax check
```

### Run it locally

```bash
# web: any static server
python -m http.server 8000 --directory web

# desktop
cd desktop && npm install && npm start
```

### Release the desktop app

```bash
git tag v0.1.0 && git push origin v0.1.0   # the desktop workflow builds and publishes the installers
```

<br>

## 05 — PRIVACY

JeanCode is a static page: no backend, no database, no analytics. Messages go straight from your browser to your own API. URL, key and history live in this browser's storage and can be wiped from **SETTINGS**.

<br>

## 06 — LICENSE

No license file has been published yet, so by default all rights are reserved.

<div align="center">

<br>

```
JEANCODER © 2026 — CHAT ■ CODE ■ AGENT
```

</div>
