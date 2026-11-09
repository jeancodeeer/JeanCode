// JeanCode — interfaz. Modos: chat · code (archivos descargables) · agent (solo escritorio).
import { CONFIG } from './config.js';
import { store } from './store.js';
import { getEndpoints, saveEndpoints, addEndpoint, listModels, probe, chatStream, generateKey } from './api.js';
import { renderMarkdown, esc } from './md.js';
import { CODE_SYSTEM, parseFiles, projectContext, buildPreview } from './code.js';
import { makeZip, downloadBlob } from './zip.js';
import { agentSystem, runAgent, stripToolBlocks } from './agent.js';
import { BUILTIN, PROMPTS, matchCommands, parseCommand, expandCustom, estimateTokens, CONTEXT_LIMIT } from './commands.js';
import { lineDiff, diffStats } from './diff.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const desktop = window.jeancodeDesktop || null;

const DEFAULT_SYS = 'Eres Jean, un asistente de programación. Responde en el idioma del usuario, con precisión y código claro.';

const state = {
  mode: 'chat',
  threads: store.get('threads', []),
  current: null,
  models: [],
  model: store.get('model', null),
  abort: null,
  file: null,
  viewerTab: 'source',
  workspace: store.get('workspace', null),
  perm: store.get('perm', 'ask'),
  agent: store.get('agent', 'build'),
  custom: [],          // comandos del proyecto (.jeancode/commands)
  fileCache: null,     // archivos de la carpeta para @menciones
  popup: { items: [], index: 0, kind: null, start: 0 },
};

/* ------------------------------------------------------------------ util */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
const saveThreads = () => store.set('threads', state.threads.slice(0, 200));
const thread = () => state.threads.find((t) => t.id === state.current) || null;

function newThread(mode = state.mode) {
  const t = { id: crypto.randomUUID(), mode, title: 'NUEVA CONVERSACIÓN', messages: [], files: {}, changed: {}, updated: Date.now() };
  state.threads.unshift(t);
  state.current = t.id;
  saveThreads();
  return t;
}

/* --------------------------------------------------------------- splash */
function showSplash() {
  $('#splash').hidden = false;
  $('#app').hidden = true;
  $('#api-repo-link').href = CONFIG.apiRepoUrl;
}

async function enterApp() {
  $('#splash').hidden = true;
  $('#app').hidden = false;
  $('#repo-link').href = CONFIG.repoUrl;
  if (desktop) $$('.desktop-only').forEach((el) => { el.hidden = false; });
  await refreshModels();
  renderThreads();
  openThread(state.threads.find((t) => t.mode === state.mode)?.id || null);
}

$('#splash-show').addEventListener('click', () => {
  const i = $('#splash-key');
  i.type = i.type === 'password' ? 'text' : 'password';
});
$('#gen-btn').addEventListener('click', async () => {
  const k = generateKey();
  $('#gen-key').value = k;
  try { await navigator.clipboard.writeText(k); toast('CLAVE GENERADA Y COPIADA'); } catch { toast('CLAVE GENERADA'); }
});
$('#splash-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#splash-msg');
  const btn = $('#splash-go');
  msg.className = 'msg';
  msg.textContent = 'Probando la conexión…';
  btn.disabled = true;
  try {
    store.setRemember($('#splash-remember').checked);
    const r = await probe($('#splash-url').value, $('#splash-key').value);
    saveEndpoints([]);
    addEndpoint(r.url, $('#splash-key').value);
    msg.textContent = `Conectado: ${r.models.join(', ') || 'sin modelos listados'}`;
    await enterApp();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* --------------------------------------------------------------- modelos */
async function refreshModels() {
  const eps = getEndpoints();
  const sel = $('#model-select');
  const status = $('#api-status');
  state.models = [];
  const results = await Promise.allSettled(eps.map(async (ep) => (await listModels(ep)).map((id) => ({ id, ep }))));
  results.forEach((r) => { if (r.status === 'fulfilled') state.models.push(...r.value); });
  const failed = results.filter((r) => r.status === 'rejected');
  status.className = 'status ' + (state.models.length ? 'ok' : 'bad');
  status.title = failed.length ? failed.map((f) => f.reason.message).join('\n') : 'API conectada';
  sel.innerHTML = state.models.length
    ? state.models.map((m, i) => `<option value="${i}">${esc(m.id.toUpperCase())}</option>`).join('')
    : '<option>SIN CONEXIÓN</option>';
  const idx = state.models.findIndex((m) => m.id === state.model);
  sel.value = String(idx >= 0 ? idx : 0);
  if (failed.length && !state.models.length) toast(failed[0].reason.message);
}
function selectModel(id) {
  const i = state.models.findIndex((m) => m.id.toLowerCase() === id.toLowerCase());
  if (i < 0) return false;
  $('#model-select').value = String(i);
  state.model = state.models[i].id;
  store.set('model', state.model);
  return true;
}
$('#model-select').addEventListener('change', (e) => {
  const m = state.models[+e.target.value];
  if (m) { state.model = m.id; store.set('model', m.id); }
});
const currentModel = () => state.models[+$('#model-select').value] || state.models[0] || null;

/* ---------------------------------------------------------------- hilos */
function renderThreads() {
  const box = $('#threads');
  const list = state.threads.filter((t) => t.mode === state.mode);
  if (!list.length) { box.innerHTML = '<p class="fine">Sin conversaciones todavía.</p>'; return; }
  box.innerHTML = '<div class="t-group">RECIENTES</div>' + list.map((t) => `
    <div class="thread ${t.id === state.current ? 'active' : ''}" data-id="${t.id}" role="button" tabindex="0">
      <span class="t-title">${esc(t.title)}</span>
      <button class="t-del" data-del="${t.id}" aria-label="Borrar">✕</button>
    </div>`).join('');
}
$('#threads').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    state.threads = state.threads.filter((t) => t.id !== del.dataset.del);
    if (state.current === del.dataset.del) state.current = null;
    saveThreads(); renderThreads(); openThread(state.current);
    return;
  }
  const row = e.target.closest('.thread');
  if (row) { openThread(row.dataset.id); $('#rail').classList.remove('open'); }
});
$('#new-thread').addEventListener('click', () => { state.current = null; openThread(null); input.focus(); });

function setMode(mode) {
  if (mode === 'agent' && !desktop) return;
  state.mode = mode;
  $$('.mode').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $('#view-chat').hidden = mode !== 'chat';
  $('#view-code').hidden = mode !== 'code';
  $('#view-agent').hidden = mode !== 'agent';
  $('#crumb-mode').textContent = mode === 'agent' ? `AGENT · ${state.agent.toUpperCase()}` : mode.toUpperCase();
  updateHint();
  renderThreads();
  openThread(state.threads.find((t) => t.mode === mode)?.id || null);
  if (mode === 'agent') loadProject();
}
$$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function streamEl() {
  return { chat: $('#chat-stream'), code: $('#code-stream'), agent: $('#agent-stream') }[state.mode];
}

function openThread(id) {
  const t = state.threads.find((x) => x.id === id && x.mode === state.mode) || null;
  state.current = t?.id || null;
  $('#crumb-title').textContent = t?.title || 'NUEVA CONVERSACIÓN';
  const el = streamEl();
  $$('.msg-row', el).forEach((n) => n.remove());
  const empty = $('.empty', el);
  if (empty) empty.hidden = !!(t && t.messages.length);
  if (t) for (const m of t.messages) addMessage(m.role, m.content, { reasoning: m.reasoning });
  if (state.mode === 'code') { state.file = null; renderFiles(); }
  if (state.mode === 'agent') renderTodos(t?.todos || []);
  renderThreads();
  updateContext();
}

/* ------------------------------------------------------------ mensajes */
function addMessage(role, content, { reasoning = '', streaming = false, cls = '' } = {}) {
  const el = streamEl();
  const empty = $('.empty', el);
  if (empty) empty.hidden = true;
  const row = document.createElement('div');
  row.className = `msg-row ${role} ${cls}`.trim();
  const who = { user: 'TÚ', assistant: 'JEAN', tool: 'HERRAMIENTA', error: 'ERROR', system: 'SISTEMA' }[role] || role.toUpperCase();
  row.innerHTML = `<div class="who">${who}</div><div class="bubble"></div>`;
  el.appendChild(row);
  updateMessage(row, content, reasoning, streaming);
  el.scrollTop = el.scrollHeight;
  return row;
}

function updateMessage(row, content, reasoning = '', streaming = false) {
  const b = $('.bubble', row);
  const role = ['user', 'tool', 'error', 'system'].find((r) => row.classList.contains(r)) || 'assistant';
  if (role !== 'assistant') b.textContent = content;
  else {
    let shown = content;
    if (state.mode === 'code') shown = parseFiles(content).prose;
    if (state.mode === 'agent') shown = stripToolBlocks(content);
    b.innerHTML = renderMarkdown(shown, reasoning) || (streaming ? '' : '<p class="muted">(usando herramientas…)</p>');
  }
  b.classList.toggle('cursor', streaming);
  const el = row.parentElement;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
}

function addToolLine(call, result, nested) {
  const el = streamEl();
  const row = document.createElement('details');
  row.className = 'tool-line' + (nested ? ' nested' : '');
  const target = call.args.path || call.args.pattern || call.args.command || call.args.url || call.args.name || '';
  const bad = /^(ERROR|DENEGADO|RECHAZADO)/.test(String(result));
  row.innerHTML = `<summary><span class="tl-name">${esc(call.tool)}</span><span class="tl-arg mono">${esc(String(target).slice(0, 120))}</span>${bad ? '<span class="tl-bad">✕</span>' : '<span class="tl-ok">✓</span>'}</summary><pre></pre>`;
  $('pre', row).textContent = String(result).slice(0, 4000);
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const code = copy.closest('.codeblock').querySelector('code').textContent;
    try { await navigator.clipboard.writeText(code); copy.textContent = 'COPIADO'; setTimeout(() => { copy.textContent = 'COPIAR'; }, 1200); } catch { toast('NO SE PUDO COPIAR'); }
  }
  const chip = e.target.closest('.chip');
  if (chip) { input.value = chip.dataset.prompt.replace(/\\n/g, '\n'); autosize(); input.focus(); }
});

/* ------------------------------------------------------ medidor de contexto */
function updateContext() {
  const t = thread();
  const msgs = state.mode === 'agent' ? (t?.agentMessages || t?.messages || []) : (t?.messages || []);
  const used = estimateTokens(msgs);
  const pct = Math.min(100, Math.round((used / CONTEXT_LIMIT) * 100));
  $('#ctx-fill').style.width = pct + '%';
  $('#ctx-text').textContent = pct + '%';
  $('#ctx-meter').title = `≈ ${used.toLocaleString()} de ${CONTEXT_LIMIT.toLocaleString()} tokens. Usa /compact para resumir.`;
  $('#ctx-meter').classList.toggle('warn', pct >= 75);
}

/* ------------------------------------------------------------- composer */
const input = $('#input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; }

function updateHint() {
  const base = 'ENTER envía · / comandos · ESC para';
  $('#hint').textContent = state.mode === 'agent'
    ? `${base} · @ archivos · TAB → ${state.agent === 'build' ? 'PLAN' : 'BUILD'}`
    : base;
}

/* popup de comandos y menciones */
function closePopup() { $('#popup').hidden = true; state.popup.items = []; }
function showPopup(items, kind, start) {
  const pop = $('#popup');
  state.popup = { items, index: 0, kind, start };
  if (!items.length) { closePopup(); return; }
  pop.innerHTML = items.map((it, i) => `<li role="option" data-i="${i}" class="${i === 0 ? 'active' : ''}">
    <span class="pp-name mono">${kind === 'cmd' ? '/' : '@'}${esc(it.name)}</span>
    <span class="pp-desc">${esc(it.desc || '')}${it.custom ? ' · PROYECTO' : ''}</span></li>`).join('');
  pop.hidden = false;
}
function movePopup(d) {
  const p = state.popup;
  p.index = (p.index + d + p.items.length) % p.items.length;
  $$('#popup li').forEach((li, i) => li.classList.toggle('active', i === p.index));
  $$('#popup li')[p.index]?.scrollIntoView({ block: 'nearest' });
}
function acceptPopup(i = state.popup.index) {
  const it = state.popup.items[i];
  if (!it) return;
  const { kind, start } = state.popup;
  const caret = input.selectionStart;
  const insert = kind === 'cmd' ? `/${it.name} ` : `@${it.name} `;
  input.value = input.value.slice(0, start) + insert + input.value.slice(caret);
  const pos = start + insert.length;
  input.setSelectionRange(pos, pos);
  closePopup();
  autosize();
  input.focus();
}
$('#popup').addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) { e.preventDefault(); acceptPopup(+li.dataset.i); }
});

async function refreshPopup() {
  const v = input.value;
  const caret = input.selectionStart;
  const before = v.slice(0, caret);
  const cmd = before.match(/^\/([\w-]*)$/);
  if (cmd) {
    const items = matchCommands(cmd[1], state.mode, state.custom);
    showPopup(items.map((c) => ({ name: c.name, desc: c.desc, custom: c.custom })), 'cmd', 0);
    return;
  }
  const at = state.mode === 'agent' && desktop && state.workspace ? before.match(/(^|\s)@([\w./\\-]*)$/) : null;
  if (at) {
    if (!state.fileCache) state.fileCache = await desktop.fs.glob(state.workspace, '**/*', 4000).catch(() => []);
    const q = at[2].toLowerCase().replace(/\\/g, '/');
    const items = state.fileCache.filter((f) => f.toLowerCase().includes(q))
      .sort((a, b) => a.length - b.length).slice(0, 12).map((f) => ({ name: f, desc: '' }));
    showPopup(items, 'file', caret - at[2].length - 1);
    return;
  }
  closePopup();
}

input.addEventListener('input', () => { autosize(); refreshPopup(); });
input.addEventListener('keydown', (e) => {
  const open = !$('#popup').hidden;
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); movePopup(e.key === 'ArrowDown' ? 1 : -1); return; }
  if (open && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
    const exact = state.popup.kind === 'cmd' && input.value.trim() === `/${state.popup.items[state.popup.index]?.name}`;
    if (!(e.key === 'Enter' && exact)) { e.preventDefault(); acceptPopup(); return; }
  }
  if (open && e.key === 'Escape') { e.preventDefault(); closePopup(); return; }
  if (e.key === 'Tab' && !e.shiftKey && state.mode === 'agent') { e.preventDefault(); setAgent(state.agent === 'build' ? 'plan' : 'build'); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); closePopup(); $('#composer').requestSubmit(); }
});
input.addEventListener('blur', () => setTimeout(closePopup, 150));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.abort && $('#popup').hidden && !document.querySelector('dialog[open]')) { state.abort.abort(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.current = null; openThread(null); input.focus(); }
  if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); setMode(['chat', 'code', 'agent'][+e.key - 1]); }
});
$('#stop-btn').addEventListener('click', () => state.abort?.abort());

function busy(on) {
  $('#send-btn').disabled = on;
  $('#stop-btn').hidden = !on;
}

$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  let text = input.value.trim();
  if (!text || state.abort) return;

  const cmd = parseCommand(text);
  if (cmd) {
    const custom = state.custom.find((c) => c.name === cmd.name);
    if (custom && state.mode === 'agent') {
      text = expandCustom(custom.body, cmd.args);
    } else {
      input.value = ''; autosize();
      const prompt = await runCommand(cmd);
      if (!prompt) return;
      text = prompt;
    }
  }
  await send(text);
});

async function send(text) {
  const m = currentModel();
  if (!m) { toast('SIN API CONECTADA — REVISA AJUSTES'); return; }
  if (state.mode === 'agent' && !state.workspace) { toast('ELIGE UNA CARPETA DE TRABAJO'); return; }

  const t = thread() || newThread();
  if (!t.messages.length) {
    t.title = text.replace(/\s+/g, ' ').slice(0, 60).toUpperCase();
    $('#crumb-title').textContent = t.title;
  }
  input.value = ''; autosize();
  t.messages.push({ role: 'user', content: text });
  addMessage('user', text);
  t.updated = Date.now(); saveThreads(); renderThreads();

  state.abort = new AbortController();
  busy(true);
  try {
    if (state.mode === 'agent') await sendAgent(t, m, text);
    else await sendChat(t, m);
  } catch (err) {
    if (err.name !== 'AbortError') addMessage('error', err.message || String(err));
    else addMessage('system', 'Detenido.');
  } finally {
    state.abort = null;
    busy(false);
    t.updated = Date.now();
    saveThreads();
    updateContext();
  }
}

/* ------------------------------------------------------------- comandos */
async function runCommand({ name, args }) {
  const t = thread();
  switch (name) {
    case 'new': state.current = null; openThread(null); return null;
    case 'clear':
      if (t) { t.messages = []; t.agentMessages = null; t.todos = []; saveThreads(); openThread(t.id); }
      return null;
    case 'help': openPanel('help'); return null;
    case 'model':
      if (!args) { toast('MODELOS: ' + state.models.map((x) => x.id).join(', ')); return null; }
      toast(selectModel(args) ? 'MODELO: ' + args.toUpperCase() : 'NO EXISTE ESE MODELO');
      return null;
    case 'export': exportThread(t); return null;
    case 'zip': $('#dl-zip').click(); return null;
    case 'compact': await compact(t); return null;
    case 'plan': setAgent('plan'); return null;
    case 'build': setAgent('build'); return null;
    case 'undo': {
      if (!desktop || !state.workspace) return null;
      const r = await desktop.fs.undo(state.workspace);
      addMessage('system', r); state.fileCache = null;
      return null;
    }
    case 'init': setAgent('build'); return PROMPTS.init;
    case 'review': return PROMPTS.review + (args ? `\n\nEnfócate en: ${args}` : '');
    default: toast(`COMANDO DESCONOCIDO: /${name}`); return null;
  }
}

async function compact(t) {
  const m = currentModel();
  if (!t || !t.messages.length || !m) { toast('NADA QUE RESUMIR'); return; }
  state.abort = new AbortController();
  busy(true);
  const row = addMessage('system', 'Resumiendo la conversación…');
  try {
    const transcript = (t.agentMessages || t.messages).filter((x) => x.role !== 'system')
      .map((x) => `${x.role.toUpperCase()}: ${x.content}`).join('\n\n').slice(-120000);
    const summary = await chatStream({
      ep: m.ep, model: m.id, signal: state.abort.signal,
      messages: [{ role: 'system', content: PROMPTS.compact }, { role: 'user', content: transcript }],
    });
    const content = `RESUMEN DE LA CONVERSACIÓN ANTERIOR:\n${summary.trim()}`;
    t.messages = [{ role: 'assistant', content }];
    t.agentMessages = null;
    saveThreads();
    openThread(t.id);
    toast('CONVERSACIÓN COMPACTADA');
  } catch (err) {
    if (err.name !== 'AbortError') updateMessage(row, 'No se pudo resumir: ' + err.message);
  } finally {
    state.abort = null;
    busy(false);
    updateContext();
  }
}

function exportThread(t) {
  if (!t) { toast('NO HAY CONVERSACIÓN'); return; }
  const md = `# ${t.title}\n\n` + t.messages.map((x) => `## ${x.role === 'user' ? 'Tú' : 'Jean'}\n\n${x.content}`).join('\n\n');
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'conversacion'}.md`);
}

/* ------------------------------------------------------------ chat / code */
async function sendChat(t, m) {
  const sys = state.mode === 'code'
    ? CODE_SYSTEM + '\n\n' + projectContext(t.files)
    : (store.get('sysChat', DEFAULT_SYS) || DEFAULT_SYS);
  const history = t.messages.slice(-24).map(({ role, content }) => ({ role, content }));
  const row = addMessage('assistant', '', { streaming: true });
  let text = '';
  let reasoning = '';
  const base = { ...t.files };
  const paint = () => {
    updateMessage(row, text, reasoning, true);
    if (state.mode === 'code') applyFiles(t, base, text, false);
  };
  try {
    await chatStream({
      ep: m.ep, model: m.id, signal: state.abort.signal,
      messages: [{ role: 'system', content: sys }, ...history],
      onDelta: (d) => { text += d; paint(); },
      onReasoning: (d) => { reasoning += d; paint(); },
    });
  } finally {
    updateMessage(row, text, reasoning, false);
    if (text) t.messages.push({ role: 'assistant', content: text, reasoning });
    if (state.mode === 'code') applyFiles(t, base, text, true);
  }
}

function applyFiles(t, base, text, final) {
  const { files, deletes, open } = parseFiles(text);
  const next = { ...base, ...files };
  deletes.forEach((p) => delete next[p]);
  t.files = next;
  t.changed = Object.fromEntries(Object.keys(files).map((p) => [p, p in base ? (base[p] === files[p] ? '' : 'M') : 'A']).filter(([, v]) => v));
  if (open && open !== state.file) state.file = open;
  if (final) state.file = ['index.html', 'README.md'].find((p) => p in files) || state.file;
  if (!state.file || !(state.file in next)) state.file = Object.keys(files)[0] || Object.keys(next)[0] || null;
  renderFiles();
}

function renderFiles() {
  const t = thread();
  const files = t?.files || {};
  const changed = t?.changed || {};
  const paths = Object.keys(files).sort();
  const tree = $('#file-tree');
  if (!paths.length) {
    tree.innerHTML = '<li class="tree-empty">Aún no hay archivos. Describe tu proyecto.</li>';
  } else {
    let lastDir = null;
    tree.innerHTML = paths.map((p) => {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      const name = p.slice(dir ? dir.length + 1 : 0);
      const head = dir !== lastDir && dir ? `<li class="dir">${esc(dir)}/</li>` : '';
      lastDir = dir;
      const badge = changed[p] ? `<span class="badge">${changed[p]}</span>` : '';
      return `${head}<li><button data-file="${esc(p)}" class="${p === state.file ? 'active' : ''}" style="padding-left:${dir ? 24 : 12}px">${esc(name)}${badge}</button></li>`;
    }).join('');
  }
  const src = $('#viewer-src');
  $('#viewer-path').textContent = state.file || '—';
  if (document.activeElement !== src) src.value = state.file ? files[state.file] ?? '' : '';
  const isHtml = state.file && /\.html?$/i.test(state.file);
  $('[data-vt="preview"]').disabled = !isHtml;
  if (state.viewerTab === 'preview' && isHtml) $('#viewer-preview').srcdoc = buildPreview(files, state.file) || '';
  else if (state.viewerTab === 'preview') setViewerTab('source');
  if (t && $('#project-name').value === 'mi-proyecto' && t.title !== 'NUEVA CONVERSACIÓN') {
    $('#project-name').value = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'mi-proyecto';
  }
}

function setViewerTab(tab) {
  state.viewerTab = tab;
  $$('.vt').forEach((b) => b.classList.toggle('active', b.dataset.vt === tab));
  $('#viewer-src').hidden = tab !== 'source';
  $('#viewer-preview').hidden = tab !== 'preview';
  if (tab === 'preview') renderFiles();
}
$$('.vt').forEach((b) => b.addEventListener('click', () => setViewerTab(b.dataset.vt)));
$('#file-tree').addEventListener('click', (e) => {
  const b = e.target.closest('[data-file]');
  if (b) { state.file = b.dataset.file; renderFiles(); }
});
$('#viewer-src').addEventListener('input', (e) => {
  const t = thread();
  if (t && state.file) { t.files[state.file] = e.target.value; saveThreads(); }
});
$('#dl-zip').addEventListener('click', () => {
  const t = thread();
  if (!t || !Object.keys(t.files || {}).length) { toast('NO HAY ARCHIVOS TODAVÍA'); return; }
  const name = ($('#project-name').value.trim() || 'proyecto').replace(/[^\w.-]+/g, '-');
  downloadBlob(makeZip(t.files, name), `${name}.zip`);
});
$('#dl-file').addEventListener('click', () => {
  const t = thread();
  if (!t || !state.file) return;
  downloadBlob(new Blob([t.files[state.file]], { type: 'text/plain;charset=utf-8' }), state.file.split('/').pop());
});

/* ------------------------------------------------------------ modo agent */
function setAgent(agent) {
  state.agent = agent;
  store.set('agent', agent);
  $$('#agent-toggle button').forEach((b) => {
    const on = b.dataset.agent === agent;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
  if (state.mode === 'agent') $('#crumb-mode').textContent = `AGENT · ${agent.toUpperCase()}`;
  updateHint();
}
$$('#agent-toggle button').forEach((b) => b.addEventListener('click', () => setAgent(b.dataset.agent)));

async function loadProject() {
  if (!desktop || !state.workspace) { state.custom = []; return; }
  state.custom = await desktop.project.commands(state.workspace).catch(() => []);
  state.fileCache = null;
}

function renderTodos(todos) {
  const box = $('#todos');
  box.hidden = !todos.length;
  $('#todo-list').innerHTML = todos.map((t) => `<li class="todo ${t.status}"><span class="todo-mark">${t.status === 'done' ? '■' : t.status === 'in_progress' ? '▶' : '□'}</span>${esc(t.content)}</li>`).join('');
}

async function expandMentions(text) {
  if (!desktop || !state.workspace) return text;
  const mentions = [...new Set([...text.matchAll(/(?:^|\s)@([\w./\\-]+)/g)].map((m) => m[1]))];
  const parts = [];
  for (const p of mentions.slice(0, 8)) {
    try { parts.push(`ARCHIVO MENCIONADO ${p}:\n${await desktop.fs.read(state.workspace, p, 0, 600)}`); } catch { /* no existe */ }
  }
  return parts.length ? `${text}\n\n${parts.join('\n\n')}` : text;
}

async function sendAgent(t, m, text) {
  const [skills, os, memory] = await Promise.all([
    desktop.skills.list(), desktop.system.os(), desktop.project.memory(state.workspace).catch(() => ''),
  ]);
  const sys = { workspace: state.workspace, os, skills, mode: state.perm, agent: state.agent, memory };
  if (!t.agentMessages) {
    // tras /compact el historial visible es un resumen: se usa como contexto inicial
    t.agentMessages = [{ role: 'system', content: '' }, ...t.messages.slice(0, -1).map(({ role, content }) => ({ role, content }))];
  }
  t.agentMessages[0] = { role: 'system', content: agentSystem(sys) };
  t.agentMessages.push({ role: 'user', content: await expandMentions(text) });

  let row = null;
  const ctx = {
    ep: m.ep, model: m.id, desktop, workspace: state.workspace, mode: state.perm, agent: state.agent, sys,
    signal: state.abort.signal, confirm: confirmDialog,
    onEvent: (ev) => {
      if (ev.type === 'assistant-start') row = addMessage('assistant', '', { streaming: true, cls: ev.nested ? 'nested' : '' });
      if (ev.type === 'assistant-delta' && row) updateMessage(row, ev.text, ev.reasoning, true);
      if (ev.type === 'assistant-end' && row) {
        updateMessage(row, ev.text, ev.reasoning, false);
        if (ev.nested) $('.who', row).textContent = 'SUBAGENTE';
        if (!stripToolBlocks(ev.text) && !ev.reasoning) row.remove();
      }
      if (ev.type === 'tool-end') addToolLine(ev.call, ev.result, ev.nested);
      if (ev.type === 'subagent-start') addMessage('system', `SUBAGENTE LANZADO · ${String(ev.task).slice(0, 300)}`);
      if (ev.type === 'subagent-end') addMessage('system', `SUBAGENTE TERMINÓ`);
      if (ev.type === 'todos' && !ev.nested) { t.todos = ev.todos; renderTodos(ev.todos); }
      if (ev.type === 'file-changed') state.fileCache = null;
      updateContext();
    },
  };
  const final = await runAgent(ctx, t.agentMessages);
  t.messages.push({ role: 'assistant', content: stripToolBlocks(final) || final });
}

function confirmDialog({ title, command, path, before, after }) {
  return new Promise((resolve) => {
    const d = $('#panel-confirm');
    $('#confirm-title').textContent = title;
    const body = $('#confirm-body');
    if (command != null) {
      $('#confirm-path').textContent = state.workspace || '';
      body.innerHTML = `<pre class="cmd">${title.includes('COMANDO') ? '$ ' : ''}${esc(command)}</pre>`;
    } else {
      const ops = lineDiff(before, after);
      const st = diffStats(ops);
      $('#confirm-path').textContent = `${path}   +${st.add} −${st.del}`;
      body.innerHTML = `<pre class="diff">${ops.map((o) => `<span class="d d${o.t === '+' ? 'a' : o.t === '-' ? 'r' : o.t === '@' ? 's' : 'c'}">${o.t === '@' ? '' : esc(o.t)} ${esc(o.s)}</span>`).join('\n')}</pre>`;
    }
    const done = (v) => { d.close(); resolve(v); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    d.oncancel = () => resolve(false);
    d.showModal();
    $('#confirm-no').focus();
  });
}

if (desktop) {
  $('#workspace-path').textContent = state.workspace || 'sin carpeta';
  $('#perm-mode').value = state.perm;
  setAgent(state.agent);
  $('#perm-mode').addEventListener('change', (e) => { state.perm = e.target.value; store.set('perm', state.perm); });
  $('#pick-workspace').addEventListener('click', async () => {
    const dir = await desktop.fs.pickFolder();
    if (dir) { state.workspace = dir; store.set('workspace', dir); $('#workspace-path').textContent = dir; await loadProject(); }
  });
  $('#undo-btn').addEventListener('click', () => runCommand({ name: 'undo', args: '' }));
}

/* ---------------------------------------------------------------- panels */
function openPanel(name) {
  const d = $(`#panel-${name}`);
  if (!d) return;
  if (name === 'settings') renderSettings();
  if (name === 'download') loadReleases();
  if (name === 'skills') renderSkills();
  if (name === 'help') renderHelp();
  d.showModal();
  $('#rail').classList.remove('open');
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-panel]');
  if (p) openPanel(p.dataset.panel);
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  if (e.target.tagName === 'DIALOG' && e.target.id !== 'panel-confirm') e.target.close();
});
$('#rail-toggle').addEventListener('click', () => $('#rail').classList.toggle('open'));

$$('.it').forEach((b) => b.addEventListener('click', () => {
  $$('.it').forEach((x) => x.classList.toggle('active', x === b));
  $$('[data-info]').forEach((s) => { s.hidden = s.dataset.info !== b.dataset.it; });
}));

function renderHelp() {
  const rows = BUILTIN.filter((c) => desktop || !c.modes.every((m) => m === 'agent'))
    .map((c) => `<tr><td class="mono">/${c.name}</td><td>${esc(c.desc)} <span class="fine">${c.modes.map((m) => m.toUpperCase()).join(' · ')}</span></td></tr>`);
  rows.push(...state.custom.map((c) => `<tr><td class="mono">/${esc(c.name)}</td><td>${esc(c.description)} <span class="fine">PROYECTO</span></td></tr>`));
  $('#help-commands').innerHTML = rows.join('');
}

async function loadReleases() {
  const note = $('#release-note');
  const map = { win: /\.exe$/i, mac: /arm64\.dmg$/i, macx: /x64\.dmg$/i, linux: /\.AppImage$/i, web: /web.*\.zip$/i };
  $$('.os').forEach((a) => { a.href = CONFIG.releasesUrl; });
  try {
    const res = await fetch(CONFIG.releasesApi, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(res.status);
    const rel = await res.json();
    $$('.os').forEach((a) => {
      const asset = rel.assets.find((x) => map[a.dataset.os]?.test(x.name));
      a.classList.toggle('disabled', !asset);
      if (asset) { a.href = asset.browser_download_url; $('.os-file', a).textContent = `${asset.name} · ${(asset.size / 1048576).toFixed(0)} MB`; }
    });
    note.textContent = `Versión ${rel.tag_name}. En macOS, la primera vez abre la app con clic derecho → Abrir (no está firmada).`;
  } catch {
    note.innerHTML = `Todavía no hay una versión publicada. Puedes compilarla desde <a href="${CONFIG.repoUrl}/tree/main/desktop" target="_blank" rel="noopener">desktop/</a>.`;
  }
}

function renderSettings() {
  const list = $('#endpoint-list');
  const eps = getEndpoints();
  list.innerHTML = eps.map((ep) => {
    const n = state.models.filter((m) => m.ep.id === ep.id).map((m) => m.id).join(', ');
    return `<li><span class="ep-url">${esc(ep.url)}</span><span class="ep-meta">${esc(n || 'sin respuesta')}</span><button class="btn ghost sm" data-ep-del="${ep.id}">QUITAR</button></li>`;
  }).join('') || '<li>Sin endpoints.</li>';
  $('#sys-chat').value = store.get('sysChat', DEFAULT_SYS);
}
$('#endpoint-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ep-del]');
  if (!b) return;
  saveEndpoints(getEndpoints().filter((x) => x.id !== b.dataset.epDel));
  if (!getEndpoints().length) { $('#panel-settings').close(); showSplash(); return; }
  await refreshModels(); renderSettings();
});
$('#endpoint-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await probe($('#ep-url').value, $('#ep-key').value);
    addEndpoint(r.url, $('#ep-key').value);
    $('#ep-url').value = ''; $('#ep-key').value = '';
    await refreshModels(); renderSettings();
    toast('ENDPOINT AGREGADO');
  } catch (err) { toast(err.message); }
});
$('#sys-chat').addEventListener('change', (e) => store.set('sysChat', e.target.value));
$('#export-btn').addEventListener('click', () => {
  downloadBlob(new Blob([JSON.stringify(state.threads, null, 2)], { type: 'application/json' }), 'jeancode-historial.json');
});
$('#wipe-btn').addEventListener('click', () => {
  if (!window.confirm('Esto borra la URL, la clave y todo el historial de este equipo. ¿Seguir?')) return;
  store.wipe();
  location.reload();
});

async function renderSkills() {
  if (!desktop) return;
  const list = $('#skill-list');
  const skills = await desktop.skills.list();
  list.innerHTML = skills.map((s) => `<li><span class="ep-url"><strong>${esc(s.name)}</strong> — ${esc(s.description)}</span><button class="btn ghost sm" data-skill-del="${esc(s.id)}">QUITAR</button></li>`).join('') || '<li>Sin skills instaladas.</li>';
}
if (desktop) {
  $('#skill-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-skill-del]');
    if (b) { await desktop.skills.remove(b.dataset.skillDel); renderSkills(); }
  });
  $('#skill-folder').addEventListener('click', async () => {
    try { const r = await desktop.skills.installFolder(); if (r) toast('SKILL INSTALADA: ' + r); renderSkills(); } catch (err) { toast(err.message); }
  });
  $('#skill-url-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await desktop.skills.installUrl($('#skill-url').value); toast('SKILL INSTALADA: ' + r); $('#skill-url').value = ''; renderSkills(); } catch (err) { toast(err.message); }
  });
}

/* ------------------------------------------------------------------ init */
(async function init() {
  updateHint();
  if (desktop?.config) {
    const saved = await desktop.config.load();
    if (saved?.endpoints?.length) saveEndpoints(saved.endpoints);
  }
  if (getEndpoints().length) await enterApp();
  else showSplash();
})();
