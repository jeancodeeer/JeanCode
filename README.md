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
N° 001 — JEANCODE                                                    REF. V0.4
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
3. Paste the **router** URL (`https://<codespace>-8899.app.github.dev/v1`): one URL brings every model of your Codespace, including the GGUFs you load from Hugging Face. A model port (`:8888`) works too: JeanCode finds the router by itself.

The repository contains **no URLs and no keys**: every user brings their own. In the browser they stay in local storage; in the desktop app the key is encrypted with the OS keychain (`safeStorage`).

<br>

### Other APIs

Besides your own Jean-API-Generator, JeanCode connects to the providers OpenCode is known for, all through their OpenAI-compatible API: **OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Hugging Face Inference Providers, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio** or any other OpenAI-compatible server. Pick the provider in the splash or in SETTINGS; the URL is filled in and the selector groups models by provider. Some providers block calls from web pages (CORS): the desktop app is not affected.

**Capabilities, not guesses.** One registry (`web/js/capabilities.js`) knows what each model can do: tools, vision, structured output, context, local or remote, cost. Its sources, in order: what the endpoint reports (OpenRouter's per-model data, the real configured context of `llama-server` and of the Jean router), what was learned in use, and a conservative table per model family. Unknown stays unknown. Each provider is an adapter entry in `web/js/providers.js` that declares only how it differs from the OpenAI standard, so a new provider is one entry. The **route card** next to the model selector shows API, MODEL, STATUS and ROUTING mode, plus why that model was picked. Every answer carries its **route** (request → router → provider → model → response) without keys.

**Routing.** Every connection is checked before it is used: bad URL, http from an https page, a missing or malformed key, a key pasted in the URL, duplicates, and a URL that belongs to another provider (corrected for you). **AUTO** in the model selector picks per mode: the fast model for chat and code, Marvel for the agent, skipping connections that are down. In SETTINGS → MODELS you choose what happens when a model does not answer: show the error, try the same model through another connection, or try any other model. It switches only before the first token arrives and never on key or request errors. SETTINGS → DATA keeps a connection log without keys.

### Hugging Face → your Codespace

**HUGGING FACE MODELS** in the side menu searches GGUF models on the Hub, shows each file with its size and whether it fits in your Codespace's free RAM, and loads it into port 8888, 8889 or 8890 with a progress bar. It talks to the control server of Jean-API-Generator (`:8899`, same `JEAN_API_KEY`). Your HF token is optional (only for private or gated models), stays on your device and is sent only to your Codespace for that download. **Restore** puts the Jean model back.

### Fénix

Fénix (27B) runs alone on port 8890: enable `fenix-mode` in Jean-API-Generator and JeanCode finds it by itself, or use **Find Fénix** in SETTINGS.

<br>

## 03b — WHAT JEANCODE DOES DIFFERENTLY

Built from the most common complaints about Claude Code and OpenCode (user reports, issue trackers and forums):

| PROBLEM ELSEWHERE | JEANCODE |
|---|---|
| Claude Code: auto-compaction is opaque and drops instructions | Compaction is never silent: at 85 % it asks first and shows the summary. **Pinned rules** and project memory are sent on every turn, so compaction cannot lose them. |
| Claude Code: unpredictable cost | Tokens in and out under every answer, session total and real context size in the top bar. |
| Claude Code: checkpoints miss bash changes | **Back to here** on every message of the agent. In git folders the checkpoint is the whole working tree (a temporary index, no commits), so files changed by commands are restored too. Git runs hardened (no hooks, no fsmonitor, no system config) and repos that define their own filters fall back to file snapshots. |
| Claude Code: permission fatigue | **Allow always here** per folder for that exact command (never for commands with chaining, redirections or shell metacharacters), editable in SETTINGS. |
| Claude Code: plan mode output is hard to act on | After a PLAN run: **Approve and run in BUILD** or edit the plan first. |
| OpenCode: provider errors (wrong paths, Ollama, OpenRouter) | Provider presets with the right base URL, `/v1` auto-fix and plain-language diagnostics (CORS, sleeping server, bad key). |
| OpenCode: setup friction | **Use this PC's models**: one click finds Ollama, LM Studio, llama.cpp, vLLM, Jan or a local Jean server; install Ollama models from SETTINGS. |
| OpenCode: UI loaded from a CDN at runtime | Fonts and UI ship with the app; the web version is an installable PWA that works offline. No requests to Google. |
| OpenCode: validation errors on non-standard responses | Tolerant parser: `reasoning`, `reasoning_content` or `thinking`, tool calls native, fenced or Qwen `<tool_call>`, provider errors shown as they are. |
| OpenCode: sluggish UI and memory use | Streaming redraws at most once per frame (it used to re-render the whole answer on every token). |

Also from both tools: project subagents (`.jeancode/agents/*.md`), hooks (`.jeancode/hooks.json`: `post_edit`, `post_turn`, asked for trust first) and answer styles (concise, explanatory, learning).

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
| **Native tool calls** | Uses OpenAI function calling (verified on llama-server with Jean Grey) and falls back to a plain-text protocol on servers without it. |
| **THINK toggle** | Off by default: Jean answers without its reasoning phase, about 8× faster on a CPU Codespace (1.3 s vs 10.1 s measured). Turn it on for hard tasks. |

Installers are built by GitHub Actions for **Windows (.exe)**, **macOS (.dmg, Intel + Apple Silicon)** and **Linux (.AppImage)**, together with the **web version as a .zip** for self-hosting, and attached to each [release](https://github.com/jeancodeeer/JeanCode/releases). The macOS build is not signed: open it the first time with right-click → Open.

<br>

### Commands and shortcuts (web + desktop)

`/new` · `/clear` · `/compact` (summarise to free context) · `/model <id>` · `/export` (Markdown) · `/help` · `/zip` (CODE) · `/init` · `/plan` · `/build` · `/undo` · `/review` (AGENT). The **RAZONAR** switch in the top bar turns the model's reasoning on or off. A context meter estimates how much of the 131072-token window is used. `Esc` stops a reply, `Ctrl+K` starts a new conversation, `Ctrl+1/2/3` switches mode.

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

# tests
node --test tests/unit.test.mjs
```

### Release a new version

One version for everything (web, desktop, service worker), set by one script:

```bash
node scripts/version.mjs 1.1.0            # updates web/js/version.js, desktop/package.json, sw cache
git commit -am "JeanCode 1.1.0" && git tag v1.1.0 && git push origin main v1.1.0
```

The `desktop` workflow refuses a tag that does not match the version, builds the installers and adds the web `.zip` to the Release. The desktop app tells users when a newer release exists. History: [CHANGELOG.md](CHANGELOG.md).

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
