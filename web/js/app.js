// JeanCode — interfaz. Modos: chat · code (archivos descargables) · agent (solo escritorio).
import { CONFIG, BRAND } from './config.js';
import { VERSION, isNewer } from './version.js';
import { store } from './store.js';
import { getEndpoints, saveEndpoints, addEndpoint, probe, generateKey, discoverSiblings, detectLocal, ollamaPull } from './api.js';
import { renderMarkdown, esc } from './md.js';
import { CODE_SYSTEM, parseFiles, projectContext, buildPreview } from './code.js';
import { makeZip, downloadBlob } from './zip.js';
import { agentSystem, runAgent, stripToolBlocks, STYLES } from './agent.js';
import { BUILTIN, PROMPTS, matchCommands, parseCommand, expandCustom, estimateTokens, CONTEXT_LIMIT } from './commands.js';
import { lineDiff, diffStats } from './diff.js';
import { PROVIDERS, providerById, providerOf, LOCAL_CANDIDATES, OLLAMA_SUGGESTED } from './providers.js';
import { AUTO, modelKey, chat as routedChat, probeEndpoint, healthOf, validateEndpoint, pickAuto, visibleModels, resolveSaved, formatLog, routeLog, FALLBACK_POLICIES, fallbackPolicy } from './router.js';
import { SLOTS, controlUrlFrom, hfSearch, hfFiles, control, gb } from './hf.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const desktop = window.jeancodeDesktop || null;

const DEFAULT_SYS = 'Eres Jean, un asistente de programación. Responde en el idioma del usuario, con precisión y código claro.';

const state = {
  mode: 'chat',
  threads: store.get('threads', []),
  current: null,
  models: [],   // todos los modelos de todas las conexiones (respaldo)
  visible: [],  // los que se muestran en el selector (sin duplicados de un mismo Codespace)
  model: store.get('model', null),
  abort: null,
  file: null,
  viewerTab: 'source',
  workspace: store.get('workspace', null),
  perm: store.get('perm', 'ask'),
  agent: store.get('agent', 'build'),
  think: store.get('think', false),
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
  $('#app-version').textContent = `JeanCode ${VERSION}${desktop ? ' · escritorio' : ' · web'}`;
  if (desktop) $$('.desktop-only').forEach((el) => { el.hidden = false; });
  if (!store.get('siblingsChecked', false)) {
    // conexiones anteriores a v0.2.1 solo guardaban un puerto: se buscan los otros modelos una vez
    for (const ep of getEndpoints()) await discoverSiblings(ep.url, ep.key);
    store.set('siblingsChecked', true);
  }
  await refreshModels();
  renderThreads();
  openThread(state.threads.find((t) => t.mode === state.mode)?.id || null);
  if (desktop) checkUpdate();
}

/** Escritorio: avisa una vez por sesión si hay una versión publicada más nueva. La web se actualiza sola. */
async function checkUpdate() {
  if (sessionStorage.getItem('jeancode.updateChecked')) return;
  sessionStorage.setItem('jeancode.updateChecked', '1');
  try {
    const res = await fetch(CONFIG.releasesApi, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const rel = await res.json();
    if (isNewer(rel.tag_name)) toast(`JeanCode ${rel.tag_name.replace(/^v/, '')} disponible · Más → Descargar la app`);
  } catch { /* sin red: nada que avisar */ }
}

/** Diagnóstico claro de una conexión fallida (queja típica de OpenCode: errores crípticos de proveedor). */
function diagnose(err, providerId) {
  const p = providerById(providerId);
  if (err.status === 0 && !desktop && (p.local || !p.browser)) {
    return `${err.message} ${p.local
      ? `Si ${p.name} está abierto, el navegador lo bloquea: permite el origen (Ollama: OLLAMA_ORIGINS=*) o usa la app de escritorio.`
      : `${p.name} suele bloquear llamadas desde páginas web: usa la app de escritorio.`}`;
  }
  return err.message;
}

/** Rellena un selector de proveedor y ajusta URL, clave y nota al cambiar. */
function wireProvider(select, urlInput, keyInput, note) {
  select.innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const apply = () => {
    const p = providerById(select.value);
    urlInput.value = p.url;
    urlInput.placeholder = p.id === 'jean' ? 'https://tu-codespace-8888.app.github.dev/v1' : (p.url || 'https://tu-servidor/v1');
    keyInput.placeholder = p.keyHint;
    const parts = [];
    if (p.note) parts.push(esc(p.note));
    if (!p.browser && !desktop) parts.push('Este proveedor suele bloquear llamadas desde la web: si falla, usa la app de escritorio.');
    if (p.keyUrl) parts.push(`<a href="${p.keyUrl}" target="_blank" rel="noopener">${p.id === 'jean' ? 'Crear mi API' : 'Conseguir la clave'} ↗</a>`);
    note.innerHTML = parts.join(' ');
  };
  select.addEventListener('change', apply);
  apply();
}
wireProvider($('#splash-provider'), $('#splash-url'), $('#splash-key'), $('#splash-provider-note'));
wireProvider($('#ep-provider'), $('#ep-url'), $('#ep-key'), $('#ep-provider-note'));

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
    const v = validateEndpoint({ url: $('#splash-url').value, key: $('#splash-key').value, provider: $('#splash-provider').value }, { desktop: !!desktop });
    if (!v.ok) { msg.className = 'msg err'; msg.textContent = v.errors.join(' '); return; }
    if (v.provider !== $('#splash-provider').value) $('#splash-provider').value = v.provider;
    const provider = v.provider;
    const r = await probe(v.url, v.key, provider);
    saveEndpoints([]);
    addEndpoint(r.url, v.key, provider);
    let more = [];
    if (provider === 'jean') {
      msg.textContent = 'Conectado. Buscando los demás modelos del servidor…';
      more = await discoverSiblings(r.url, v.key);
    }
    if (v.warnings.length) toast(v.warnings[0]);
    store.set('siblingsChecked', true);
    const all = [...r.models, ...more];
    msg.textContent = `Conectado: ${all.slice(0, 8).join(', ')}${all.length > 8 ? ` y ${all.length - 8} más` : ''}` || 'Conectado';
    await enterApp();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = diagnose(err, $('#splash-provider').value);
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
  let results = await Promise.allSettled(eps.map(async (ep) => (await probeEndpoint(ep)).ids.map((id) => ({ id, ep }))));
  // En modo Fénix, Jean-API-Generator apaga Grey/Marvel y sirve Fénix solo en :8890.
  // Si algo dejó de responder, se buscan puertos hermanos nuevos o el router (una vez por recarga).
  if (results.some((r) => r.status === 'rejected') && !refreshModels.searched) {
    refreshModels.searched = true;
    const before = getEndpoints().length;
    for (const ep of eps) if (providerOf(ep).id === 'jean') await discoverSiblings(ep.url, ep.key);
    if (getEndpoints().length > before) return refreshModels();
  }
  results.forEach((r) => { if (r.status === 'fulfilled') state.models.push(...r.value); });
  // todos los modelos sirven de respaldo; en el selector, cada modelo de un Codespace aparece una vez
  state.visible = visibleModels(state.models);
  const failed = results.filter((r) => r.status === 'rejected');
  const unavailable = eps.flatMap((ep) => (healthOf(ep)?.unavailable || []).map((u) => `${u.slot}: ${u.reason}`));
  status.className = 'status ' + (state.visible.length ? (failed.length ? 'warn' : 'ok') : 'bad');
  status.title = [...failed.map((f) => f.reason.message), ...unavailable].join('\n') || 'API conectada';
  if (!state.visible.length) {
    sel.innerHTML = '<option value="">SIN CONEXIÓN</option>';
  } else {
    // agrupados por proveedor; dentro de cada grupo, en el orden que da la API
    const groups = new Map();
    for (const m of state.visible) {
      const name = providerOf(m.ep).name;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(`<option value="${esc(modelKey(m))}">${esc(modelLabel(m.id))}</option>`);
    }
    const auto = `<option value="${AUTO}">AUTO</option>`;
    sel.innerHTML = auto + (groups.size === 1
      ? [...groups.values()][0].join('')
      : [...groups].map(([name, opts]) => `<optgroup label="${esc(name.toUpperCase())}">${opts.join('')}</optgroup>`).join(''));
  }
  const saved = resolveSaved(state.model, state.visible);
  if (saved) state.model = modelKey(saved); // migra lo guardado por versiones anteriores (solo el nombre)
  sel.value = state.model === AUTO ? AUTO : saved ? modelKey(saved) : (state.visible[0] ? modelKey(state.visible[0]) : '');
  updateAutoLabel();
  if (failed.length && !state.visible.length) toast(failed[0].reason.message);
  renderFenix();
}

/** La opción AUTO dice qué modelo elegiría ahora para el modo actual. */
function updateAutoLabel() {
  const opt = $(`#model-select option[value="${AUTO}"]`);
  if (!opt) return;
  const pick = pickAuto(state.visible || [], state.mode, getEndpoints());
  opt.textContent = pick ? `AUTO · ${pick.id.toUpperCase()}` : 'AUTO';
}

/** Etiqueta del selector: nombre + carácter del modelo (ayuda a elegir en CPU). */
function modelLabel(id) {
  const name = id.toUpperCase();
  if (/fenix/i.test(id)) return `${name} · lento, el más capaz`;
  if (/marvel/i.test(id)) return `${name} · agente`;
  if (/grey/i.test(id)) return `${name} · rápido`;
  return name;
}

function renderFenix() {
  const box = $('#fenix-status');
  if (!box) return;
  const f = state.models.find((m) => /fenix/i.test(m.id));
  box.textContent = f ? `Conectado: ${f.id} en ${f.ep.url}` : 'No encontrado. Actívalo en tu Codespace y pulsa Buscar Fénix.';
  box.classList.toggle('ok', !!f);
}

function selectModel(id) {
  const want = String(id).toLowerCase();
  if (want === AUTO) { $('#model-select').value = AUTO; state.model = AUTO; store.set('model', AUTO); updateAutoLabel(); return true; }
  const m = (state.visible || []).find((x) => x.id.toLowerCase() === want);
  if (!m) return false;
  $('#model-select').value = modelKey(m);
  state.model = modelKey(m);
  store.set('model', state.model);
  return true;
}
$('#model-select').addEventListener('change', (e) => {
  if (e.target.value === AUTO) { state.model = AUTO; store.set('model', AUTO); updateAutoLabel(); return; }
  const m = (state.visible || []).find((x) => modelKey(x) === e.target.value);
  if (m) {
    state.model = modelKey(m); store.set('model', state.model);
    if (/fenix/i.test(m.id) && !store.get('fenixWarned', false)) {
      store.set('fenixWarned', true);
      toast('FÉNIX EN CPU RESPONDE LENTO: ÚSALO PARA TAREAS DIFÍCILES');
    }
  }
});
$('#fenix-find')?.addEventListener('click', async () => {
  const btn = $('#fenix-find');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  for (const ep of getEndpoints()) await discoverSiblings(ep.url, ep.key);
  refreshModels.searched = false;
  await refreshModels();
  btn.disabled = false;
  btn.textContent = 'Buscar Fénix';
  renderSettings();
  toast(state.models.some((m) => /fenix/i.test(m.id)) ? 'FÉNIX CONECTADO' : 'FÉNIX NO RESPONDE EN :8890');
});
const currentModel = () => {
  const v = $('#model-select').value;
  const visible = state.visible || [];
  if (v === AUTO) return pickAuto(visible, state.mode, getEndpoints());
  return visible.find((m) => modelKey(m) === v) || visible[0] || null;
};

/** Contexto del enrutador para cada envío: catálogo completo (respaldo) y aviso cuando cambia de backend. */
function routeCtx(onSwitch) {
  return {
    models: state.models, mode: state.mode, endpoints: getEndpoints(),
    onRoute: ({ from, to, error }) => {
      toast(`${from.id.toUpperCase()} NO RESPONDE → ${to.id.toUpperCase()}`);
      onSwitch?.(to, from, error);
    },
  };
}

/* ---------------------------------------------------------------- hilos */
function renderThreads() {
  const box = $('#threads');
  const list = state.threads.filter((t) => t.mode === state.mode);
  if (!list.length) { box.innerHTML = '<p class="fine">Sin conversaciones todavía.</p>'; return; }
  box.innerHTML = '<div class="t-group">RECIENTES</div>' + list.map((t) => `
    <div class="thread ${t.id === state.current ? 'active' : ''}" data-id="${t.id}" role="button" tabindex="0">
      <span class="t-title">${esc(t.title)}</span>
      <button class="t-del" data-del="${t.id}" aria-label="Borrar conversación"><svg class="i"><use href="#i-close"/></svg></button>
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
  updateAutoLabel();
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
  if (t) for (const m of t.messages) {
    const row = addMessage(m.role, m.content, { reasoning: m.reasoning, turn: m.turn });
    if (m.usage) setUsage(row, m.usage);
  }
  if (state.mode === 'code') { state.file = null; renderFiles(); }
  if (state.mode === 'agent') renderTodos(t?.todos || []);
  renderThreads();
  updateContext();
}

/* ------------------------------------------------------------ mensajes */
function addMessage(role, content, { reasoning = '', streaming = false, cls = '', turn = null } = {}) {
  const el = streamEl();
  const empty = $('.empty', el);
  if (empty) empty.hidden = true;
  const row = document.createElement('div');
  row.className = `msg-row ${role} ${cls}`.trim();
  const who = { user: 'TÚ', assistant: 'JEAN', tool: 'HERRAMIENTA', error: 'ERROR', system: 'SISTEMA' }[role] || role.toUpperCase();
  row.innerHTML = `<div class="who">${who}</div><div class="bubble"></div>`;
  el.appendChild(row);
  updateMessage(row, content, reasoning, streaming);
  if (role === 'user' && turn) addRewind(row, turn);
  el.scrollTop = el.scrollHeight;
  return row;
}

/** Botón "volver aquí" (checkpoint) en un mensaje del usuario del modo agente. */
function addRewind(row, turn) {
  if (!desktop || state.mode !== 'agent' || $('.rewind', row)) return;
  const b = document.createElement('button');
  b.className = 'rewind';
  b.type = 'button';
  b.dataset.turn = String(turn);
  b.title = 'Volver a antes de este mensaje: archivos y conversación';
  b.innerHTML = '<svg class="i"><use href="#i-undo"/></svg>VOLVER AQUÍ';
  $('.who', row).appendChild(b);
}

const fmtTok = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
/** Consumo visible por respuesta (queja típica de Claude Code: coste impredecible). */
function setUsage(row, u) {
  if (!row || !u) return;
  let f = $('.usage', row);
  if (!f) { f = document.createElement('div'); f.className = 'usage mono'; row.appendChild(f); }
  f.textContent = `↑ ${fmtTok(u.prompt)} · ↓ ${fmtTok(u.completion)} tokens${u.tps ? ` · ${u.tps.toFixed(1)} tok/s` : ''}`;
}

/** Streaming: como mucho un redibujo por fotograma (antes se redibujaba entero con cada token). */
function updateMessage(row, content, reasoning = '', streaming = false) {
  row._pending = { content, reasoning, streaming };
  if (!streaming) { if (row._raf) { cancelAnimationFrame(row._raf); row._raf = null; } renderRow(row); return; }
  if (row._raf) return;
  row._raf = requestAnimationFrame(() => { row._raf = null; renderRow(row); });
}

function renderRow(row) {
  const { content, reasoning, streaming } = row._pending;
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
  // dato real del servidor si lo hay (prompt + respuesta del último turno); si no, estimación
  const real = t?.lastContext || 0;
  const used = Math.max(real, real ? 0 : estimateTokens(msgs));
  const pct = Math.min(100, Math.round((used / CONTEXT_LIMIT) * 100));
  $('#ctx-fill').style.width = pct + '%';
  $('#ctx-text').textContent = pct + '%';
  const total = t?.usage ? ` · sesión: ↑ ${fmtTok(t.usage.prompt)} ↓ ${fmtTok(t.usage.completion)} tokens` : '';
  $('#ctx-meter').title = `${real ? '' : '≈ '}${used.toLocaleString()} de ${CONTEXT_LIMIT.toLocaleString()} tokens${total}. Usa /compact para resumir.`;
  $('#ctx-meter').classList.toggle('warn', pct >= 75);
  return pct;
}

function addUsage(t, u) {
  if (!t || !u) return;
  t.usage = { prompt: (t.usage?.prompt || 0) + u.prompt, completion: (t.usage?.completion || 0) + u.completion };
  t.lastContext = u.prompt + u.completion;
}

/* ------------------------------------------------------------- composer */
const input = $('#input');
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  input.style.overflowY = input.scrollHeight > 220 ? 'auto' : 'hidden';
}

function updateHint() {
  const base = '/ comandos · Esc detiene';
  $('#hint').textContent = state.mode === 'agent'
    ? `${base} · @ archivos · Tab → ${state.agent === 'build' ? 'Plan' : 'Build'}`
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
  // Compactación transparente: nunca a escondidas. Al 85 % se pregunta y se muestra el resumen.
  if (updateContext() >= 85 && t.messages.length > 4) {
    const ok = await confirmDialog({
      title: 'CONTEXTO AL 85 %',
      command: 'Se resumirá la conversación y verás el resumen antes de seguir. Las reglas fijadas y la memoria del proyecto (AGENTS.md) no se pierden: se envían siempre.',
    });
    if (ok) await compact(t);
  }
  if (!t.messages.length) {
    t.title = text.replace(/\s+/g, ' ').slice(0, 60).toUpperCase();
    $('#crumb-title').textContent = t.title;
  }
  input.value = ''; autosize();
  const turn = state.mode === 'agent' ? Date.now() : null;
  t.messages.push({ role: 'user', content: text, turn });
  addMessage('user', text, { turn });
  t.updated = Date.now(); saveThreads(); renderThreads();

  state.abort = new AbortController();
  busy(true);
  try {
    if (state.mode === 'agent') await sendAgent(t, m, text, turn);
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
    const { text: summary } = await routedChat(m, {
      signal: state.abort.signal, think: false,
      messages: [{ role: 'system', content: PROMPTS.compact }, { role: 'user', content: transcript }],
    }, routeCtx());
    const content = `RESUMEN DE LA CONVERSACIÓN ANTERIOR (lo que el modelo recordará; edítalo con /clear si algo falta):\n${summary.trim()}`;
    t.messages = [{ role: 'assistant', content }];
    t.agentMessages = null;
    t.lastContext = 0;
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
/** Estilo de respuesta y reglas fijadas: van en el prompt de sistema de cada envío. */
function extraSystem() {
  const style = STYLES[store.get('style', 'normal')] || '';
  const rules = String(store.get('rules', '')).trim();
  return (style ? `\n\n${style}` : '') + (rules ? `\n\nREGLAS FIJADAS POR EL USUARIO (siempre vigentes):\n${rules}` : '');
}

async function sendChat(t, m) {
  const sys = (state.mode === 'code'
    ? CODE_SYSTEM + '\n\n' + projectContext(t.files)
    : (store.get('sysChat', DEFAULT_SYS) || DEFAULT_SYS)) + extraSystem();
  const history = t.messages.slice(-24).map(({ role, content }) => ({ role, content }));
  const row = addMessage('assistant', '', { streaming: true });
  let text = '';
  let reasoning = '';
  let usage = null;
  const base = { ...t.files };
  let filesRaf = null;
  const paint = () => {
    updateMessage(row, text, reasoning, true);
    if (state.mode === 'code' && !filesRaf) {
      filesRaf = requestAnimationFrame(() => { filesRaf = null; applyFiles(t, base, text, false); });
    }
  };
  try {
    await routedChat(m, {
      signal: state.abort.signal, think: state.think,
      messages: [{ role: 'system', content: sys }, ...history],
      onDelta: (d) => { text += d; paint(); },
      onReasoning: (d) => { reasoning += d; paint(); },
      onUsage: (u) => { usage = u; },
    }, routeCtx((to) => { $('.who', row).textContent = `JEAN · ${to.id.toUpperCase()}`; }));
  } finally {
    if (filesRaf) cancelAnimationFrame(filesRaf);
    updateMessage(row, text, reasoning, false);
    if (!text && !reasoning) row.remove(); // falló antes de responder: solo queda el mensaje de error
    if (usage) { setUsage(row, usage); addUsage(t, usage); }
    if (text) t.messages.push({ role: 'assistant', content: text, reasoning, usage: usage || undefined });
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
  if (!desktop || !state.workspace) { state.custom = []; state.agents = []; return; }
  [state.custom, state.agents] = await Promise.all([
    desktop.project.commands(state.workspace).catch(() => []),
    desktop.project.agents(state.workspace).catch(() => []),
  ]);
  state.fileCache = null;
}

/* permisos guardados por carpeta: "permitir siempre" guarda el prefijo (dos primeras palabras) */
const allowKey = () => `allow:${state.workspace}`;
// Se guarda y se compara el COMANDO EXACTO: un prefijo ("npm run", "make") dejaría ejecutar
// scripts que el propio agente puede escribir antes en package.json o Makefile.
const allowPrefix = (cmd) => cmd.trim();
// Nunca se auto-permite nada que la shell pueda encadenar o expandir: separadores, redirecciones,
// saltos de línea y otros caracteres de control, y metacaracteres de cmd/PowerShell.
const UNSAFE_CMD = /[;&|`$<>\r\n\x00-\x1f\x7f(){}\\%^!]/;
function isAllowed(cmd) {
  const c = cmd.trim();
  if (UNSAFE_CMD.test(c)) return false;
  return store.get(allowKey(), []).includes(c);
}
function allowCommand(cmd) {
  const list = store.get(allowKey(), []);
  const p = allowPrefix(cmd);
  if (!list.includes(p)) store.set(allowKey(), [...list, p]);
  toast(`PERMITIDO SIEMPRE AQUÍ: ${p.slice(0, 60)}`);
}

/* hooks del proyecto: se piden confianza la primera vez y cada vez que cambian */
async function loadHooks() {
  const h = await desktop.project.hooks(state.workspace).catch(() => null);
  if (!h) return null;
  if (h.error) { addMessage('system', h.error); return null; }
  const trusted = store.get(`hooksTrust:${state.workspace}`, '');
  if (trusted === h.hash) return h.hooks;
  const ok = await confirmDialog({
    title: 'HOOKS DEL PROYECTO',
    command: `Esta carpeta define comandos que se ejecutarán solos:\n\n${JSON.stringify(h.hooks, null, 2)}\n\nPermítelos solo si confías en el proyecto.`,
  });
  if (!ok) { addMessage('system', 'Hooks del proyecto desactivados para esta sesión.'); return null; }
  store.set(`hooksTrust:${state.workspace}`, h.hash);
  return h.hooks;
}

function hookRunner(hooks) {
  return async (event, vars = {}) => {
    const cmds = hooks?.[event];
    if (!cmds?.length) return '';
    let out = '';
    for (const tpl of cmds) {
      // {path} viene del modelo: solo rutas con caracteres seguros, o el hook se omite
      if (tpl.includes('{path}') && !/^[\w./-]+$/.test(String(vars.path || ''))) { out += `\n[hook ${event}] omitido: ruta con caracteres no seguros`; continue; }
      const cmd = tpl.replace(/\{path\}/g, String(vars.path || ''));
      const r = await desktop.shell.run(state.workspace, cmd, 120);
      out += `\n[hook ${event}] ${r.slice(0, 1500)}`;
    }
    return out;
  };
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

async function sendAgent(t, m, text, turn) {
  await loadProject();
  const [skills, os, memory, hooks] = await Promise.all([
    desktop.skills.list(), desktop.system.os(), desktop.project.memory(state.workspace).catch(() => ''), loadHooks(),
  ]);
  // checkpoint del turno (con git cubre también lo que cambien los comandos)
  const cp = await desktop.turn.begin(state.workspace, turn).catch(() => ({ git: false }));
  if (!cp.git && !store.get(`nogitWarned:${state.workspace}`, false)) {
    store.set(`nogitWarned:${state.workspace}`, true);
    addMessage('system', 'Esta carpeta no es un repo git: «volver aquí» deshará los archivos que edite el agente, pero no lo que cambien los comandos de terminal. Con git init se cubre todo.');
  }
  const sys = {
    workspace: state.workspace, os, skills, mode: state.perm, agent: state.agent, memory,
    agents: state.agents || [], style: store.get('style', 'normal'), rules: store.get('rules', ''),
  };
  if (!t.agentMessages) {
    // tras /compact el historial visible es un resumen: se usa como contexto inicial
    t.agentMessages = [{ role: 'system', content: '' }, ...t.messages.slice(0, -1).map(({ role, content }) => ({ role, content }))];
  }
  t.agentMessages[0] = { role: 'system', content: agentSystem(sys) };
  const userMsg = t.messages[t.messages.length - 1];
  userMsg.agentIndex = t.agentMessages.length; // para "volver aquí"
  t.agentMessages.push({ role: 'user', content: await expandMentions(text) });

  let row = null;
  const ctx = {
    ep: m.ep, model: m.id, desktop, workspace: state.workspace, mode: state.perm, agent: state.agent, sys, think: state.think,
    // el agente pide cada paso al enrutador; si cambia de backend, los pasos siguientes siguen en el nuevo
    chat: (o) => routedChat({ id: o.model, ep: o.ep }, o, routeCtx((to) => { ctx.ep = to.ep; ctx.model = to.id; })).then((r) => r.text),
    signal: state.abort.signal, confirm: confirmDialog, isAllowed, allowCommand, runHooks: hookRunner(hooks),
    onEvent: (ev) => {
      if (ev.type === 'usage') { addUsage(t, ev.usage); if (row) setUsage(row, ev.usage); }
      if (ev.type === 'assistant-start') row = addMessage('assistant', '', { streaming: true, cls: ev.nested ? 'nested' : '' });
      if (ev.type === 'assistant-delta' && row) updateMessage(row, ev.text, ev.reasoning, true);
      if (ev.type === 'assistant-end' && row) {
        updateMessage(row, ev.text, ev.reasoning, false);
        if (ev.nested) $('.who', row).textContent = 'SUBAGENTE';
        if (!stripToolBlocks(ev.text) && !ev.reasoning) row.remove();
      }
      if (ev.type === 'tool-end') addToolLine(ev.call, ev.result, ev.nested);
      if (ev.type === 'subagent-start') addMessage('system', `SUBAGENTE${ev.agent ? ` ${ev.agent.toUpperCase()}` : ''} LANZADO · ${String(ev.task).slice(0, 300)}`);
      if (ev.type === 'subagent-end') addMessage('system', `SUBAGENTE TERMINÓ`);
      if (ev.type === 'todos' && !ev.nested) { t.todos = ev.todos; renderTodos(ev.todos); }
      if (ev.type === 'file-changed') state.fileCache = null;
      updateContext();
    },
  };
  const final = await runAgent(ctx, t.agentMessages);
  t.messages.push({ role: 'assistant', content: stripToolBlocks(final) || final });
  const post = await ctx.runHooks('post_turn');
  if (post) addMessage('tool', post.trim());
  // PLAN → BUILD: el plan se aprueba con un clic (y se puede editar antes en el campo de texto)
  if (state.agent === 'plan') {
    const bar = document.createElement('div');
    bar.className = 'plan-actions';
    bar.innerHTML = '<button class="btn primary" type="button" data-plan="run">Aprobar y ejecutar en BUILD</button><button class="btn ghost" type="button" data-plan="edit">Editar el plan</button>';
    streamEl().appendChild(bar);
  }
}

streamElAll().forEach((el) => el.addEventListener('click', async (e) => {
  const plan = e.target.closest('[data-plan]');
  if (plan) {
    const last = [...thread()?.messages || []].reverse().find((x) => x.role === 'assistant');
    plan.closest('.plan-actions').remove();
    setAgent('build');
    if (plan.dataset.plan === 'run') await send('Ejecuta el plan anterior paso a paso. Usa todo_write para seguir el avance.');
    else { input.value = `Ajusta y ejecuta este plan:\n\n${last?.content || ''}`; autosize(); input.focus(); }
    return;
  }
  const rw = e.target.closest('.rewind');
  if (!rw || state.abort) return;
  const t = thread();
  const turn = Number(rw.dataset.turn);
  const idx = t.messages.findIndex((x) => x.turn === turn);
  if (idx < 0) return;
  const ok = await confirmDialog({ title: 'VOLVER A ESTE MENSAJE', command: 'Se restauran los archivos y la conversación a como estaban antes de este mensaje. Lo que vino después se descarta.' });
  if (!ok) return;
  try {
    const r = await desktop.turn.rewind(state.workspace, turn);
    const msg = t.messages[idx];
    t.messages = t.messages.slice(0, idx);
    if (t.agentMessages && msg.agentIndex) t.agentMessages = t.agentMessages.slice(0, msg.agentIndex);
    t.todos = [];
    t.lastContext = 0;
    saveThreads();
    openThread(t.id);
    addMessage('system', r);
    input.value = msg.content; autosize(); input.focus();
    state.fileCache = null;
  } catch (err) { toast(err.message); }
}));

function streamElAll() { return [$('#chat-stream'), $('#code-stream'), $('#agent-stream')]; }

function confirmDialog({ title, command, path, before, after, allowAlways = false }) {
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
    const always = $('#confirm-always');
    const canAlways = allowAlways && command && !UNSAFE_CMD.test(command.trim());
    always.hidden = !canAlways;
    if (canAlways) always.textContent = 'PERMITIR SIEMPRE ESTE COMANDO AQUÍ';
    always.onclick = () => done('always');
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
  if (name === 'hf') initHf();
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

// pestañas de cada panel: "Sobre" usa data-it/data-info; Ajustes usa data-tab/data-pane
$$('.tabs').forEach((bar) => bar.addEventListener('click', (e) => {
  const b = e.target.closest('.it');
  if (!b) return;
  const panel = bar.closest('dialog');
  $$('.it', bar).forEach((x) => x.classList.toggle('active', x === b));
  if (b.dataset.it) $$('[data-info]', panel).forEach((s) => { s.hidden = s.dataset.info !== b.dataset.it; });
  if (b.dataset.tab) $$('[data-pane]', panel).forEach((s) => { s.hidden = s.dataset.pane !== b.dataset.tab; });
}));

// cajón lateral (móvil) y menús desplegables
const closeRail = () => $('#rail').classList.remove('open');
$$('[data-rail-close]').forEach((el) => el.addEventListener('click', closeRail));
document.addEventListener('click', (e) => {
  $$('details.menu[open]').forEach((m) => {
    if (!m.contains(e.target) || e.target.closest('.menu-list button')) m.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $$('details.menu[open]').forEach((m) => { m.open = false; }); closeRail(); }
});

/* ---------------------------------------------- Hugging Face → Codespace */
const hf = { repo: null, file: null, ram: 0, files: [] };
const jeanEndpoint = () => getEndpoints().find((e) => providerOf(e).id === 'jean');

function initHf() {
  $('#hf-token').value = store.get('hfToken', '');
  const ep = jeanEndpoint();
  if (!$('#hf-control').value) $('#hf-control').value = store.get('hfControl', '') || (ep ? controlUrlFrom(ep.url) : '');
  $('#hf-slot').innerHTML = SLOTS.map((s) => `<option value="${s.port}">${s.label}</option>`).join('');
  $('#hf-slot').value = '8890';
  if (!ep) $('#hf-control-note').textContent = 'Primero conecta tu Jean-API-Generator (splash o AJUSTES): el control usa su misma clave.';
  if (ep && $('#hf-control').value) refreshSlots();
}
$('#hf-token').addEventListener('change', (e) => store.set('hfToken', e.target.value.trim()));
$('#hf-control').addEventListener('change', (e) => store.set('hfControl', e.target.value.trim().replace(/\/+$/, '')));

const ctl = (path, body) => {
  const ep = jeanEndpoint();
  if (!ep) throw new Error('Conecta primero tu Jean-API-Generator.');
  const base = $('#hf-control').value.trim().replace(/\/+$/, '');
  if (!base) throw new Error('Falta la URL del control (puerto 8899 de tu Codespace).');
  return control(base, ep.key, path, body);
};

async function refreshSlots() {
  const list = $('#hf-slots');
  list.innerHTML = '<li>Consultando tu Codespace…</li>';
  try {
    const st = await ctl('/status');
    hf.ram = st.ram_available || 0;
    $('#hf-res').textContent = `RAM libre ${gb(st.ram_available)} de ${gb(st.ram_total)} · disco libre ${gb(st.disk_free)}`;
    list.innerHTML = Object.entries(st.slots).map(([port, s]) => {
      const what = s.custom || s.default;
      const state = s.busy ? 'cargando…' : s.running ? (s.models.join(', ') || 'iniciando') : 'apagado';
      const restore = s.custom ? `<button class="btn ghost sm" data-restore="${port}">Restaurar</button>` : '';
      return `<li><span class="slot-port">:${port}</span><span class="ep-url">${esc(what)}</span><span class="ep-meta">${esc(state)}</span>${restore}</li>`;
    }).join('');
    renderHfFiles();
  } catch (err) {
    list.innerHTML = `<li>${esc(err.message)}</li>`;
  }
}
$('#hf-refresh').addEventListener('click', refreshSlots);
$('#hf-slots').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-restore]');
  if (!b) return;
  try {
    await ctl('/restore', { slot: +b.dataset.restore });
    toast(`PUERTO ${b.dataset.restore}: VOLVIENDO AL MODELO JEAN`);
    setTimeout(refreshSlots, 1500);
  } catch (err) { toast(err.message); }
});

$('#hf-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#hf-query').value.trim();
  if (!q) return;
  const box = $('#hf-results');
  box.innerHTML = '<li class="fine">Buscando…</li>';
  try {
    const items = await hfSearch(q, store.get('hfToken', ''));
    box.innerHTML = items.length ? items.map((m) => `<li><button type="button" data-repo="${esc(m.id)}">
      <span>${esc(m.id)}${m.gated ? ' · restringido' : ''}</span><span class="hf-meta">↓ ${m.downloads.toLocaleString()}</span></button></li>`).join('')
      : '<li class="fine">Sin resultados GGUF.</li>';
  } catch (err) {
    box.innerHTML = `<li class="fine">No se pudo buscar: ${esc(err.message)}</li>`;
  }
});

$('#hf-results').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-repo]');
  if (!b) return;
  $$('#hf-results button').forEach((x) => x.classList.toggle('active', x === b));
  hf.repo = b.dataset.repo; hf.file = null;
  $('#hf-pick').hidden = false;
  $('#hf-pick-title').textContent = `ARCHIVOS DE ${hf.repo.toUpperCase()}`;
  $('#hf-files').innerHTML = '<li class="fine">Leyendo archivos…</li>';
  $('#hf-load').disabled = true;
  try {
    hf.files = await hfFiles(hf.repo, store.get('hfToken', ''));
    renderHfFiles();
  } catch (err) {
    $('#hf-files').innerHTML = `<li class="fine">No se pudieron leer: ${esc(err.message)} (¿repo privado o restringido? agrega tu token)</li>`;
  }
});

function renderHfFiles() {
  if (!hf.repo) return;
  const fits = (size) => !hf.ram || size * 1.1 + 1.5 * 2 ** 30 <= hf.ram;
  $('#hf-files').innerHTML = hf.files.length ? hf.files.map((f) => {
    const note = f.split ? 'dividido: no compatible' : fits(f.size) ? 'cabe' : 'no cabe en la RAM libre';
    return `<li><button type="button" data-file="${esc(f.path)}" class="${f.path === hf.file ? 'active' : ''} ${fits(f.size) && !f.split ? '' : 'nofit'}" ${f.split ? 'disabled' : ''}>
      <span>${esc(f.path)}</span><span class="hf-meta">${gb(f.size)} · ${note}</span></button></li>`;
  }).join('') : '<li class="fine">Este repo no tiene archivos .gguf.</li>';
}
$('#hf-files').addEventListener('click', (e) => {
  const b = e.target.closest('[data-file]');
  if (!b) return;
  hf.file = b.dataset.file;
  renderHfFiles();
  $('#hf-load').disabled = false;
});

$('#hf-load').addEventListener('click', async () => {
  if (!hf.repo || !hf.file) return;
  const btn = $('#hf-load');
  const job = $('#hf-job');
  btn.disabled = true;
  try {
    const slot = +$('#hf-slot').value;
    const token = store.get('hfToken', '') || undefined;
    let j = await ctl('/load', { repo: hf.repo, file: hf.file, slot, hf_token: token });
    $('#hf-progress').hidden = false;
    while (!['done', 'error'].includes(j.state)) {
      const pct = j.size ? Math.round((j.downloaded / j.size) * 100) : 0;
      $('#hf-bar').style.width = pct + '%';
      job.textContent = j.state === 'downloading' ? `Descargando ${pct}% de ${gb(j.size)}…`
        : j.state === 'starting' ? 'Arrancando el modelo…' : 'En cola…';
      await new Promise((r) => setTimeout(r, 2500));
      j = await ctl(`/jobs/${j.id}`);
    }
    if (j.state === 'error') throw new Error(j.error);
    $('#hf-bar').style.width = '100%';
    job.textContent = `Listo: ${j.alias} en el puerto ${slot}.`;
    for (const ep of getEndpoints()) if (providerOf(ep).id === 'jean') await discoverSiblings(ep.url, ep.key);
    refreshModels.searched = false;
    await refreshModels();
    selectModel(j.alias);
    refreshSlots();
    toast(`MODELO CARGADO: ${String(j.alias).toUpperCase()}`);
  } catch (err) {
    job.textContent = err.message;
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

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
    const latest = rel.tag_name.replace(/^v/, '');
    const mine = isNewer(rel.tag_name) ? `Tienes la ${VERSION}: hay una versión nueva.` : `Tienes la ${VERSION}.`;
    note.textContent = `Última versión: ${latest}. ${desktop ? mine + ' ' : ''}En macOS, la primera vez abre la app con clic derecho → Abrir (no está firmada).`;
  } catch {
    note.innerHTML = `Todavía no hay una versión publicada. Puedes compilarla desde <a href="${CONFIG.repoUrl}/tree/main/desktop" target="_blank" rel="noopener">desktop/</a>.`;
  }
}

function renderSettings() {
  const list = $('#endpoint-list');
  const eps = getEndpoints();
  list.innerHTML = eps.map((ep) => {
    const h = healthOf(ep);
    const ids = state.models.filter((m) => m.ep.id === ep.id).map((m) => m.id);
    const what = h?.ok ? (ids.length > 3 ? `${ids.length} modelos` : ids.join(', ') || 'sin modelos') : (h?.error || 'sin respuesta');
    const meta = [h?.router ? 'router' : '', what, h?.ok && h.ms != null ? `${h.ms} ms` : ''].filter(Boolean).join(' · ');
    const down = (h?.unavailable || []).map((u) => `<span class="ep-down">${esc(u.slot)}: ${esc(u.reason)}</span>`).join('');
    return `<li><span class="status ${h ? (h.ok ? 'ok' : 'bad') : ''}" aria-hidden="true"></span><span class="ep-prov">${esc(providerOf(ep).name)}</span><span class="ep-url">${esc(ep.url)}</span><span class="ep-meta">${esc(meta)}</span><button class="btn ghost sm" data-ep-test="${ep.id}">PROBAR</button><button class="btn ghost sm" data-ep-del="${ep.id}">QUITAR</button>${down}</li>`;
  }).join('') || '<li>Sin endpoints.</li>';
  $('#fallback-select').value = fallbackPolicy();
  renderRouteLog();
  $('#sys-chat').value = store.get('sysChat', DEFAULT_SYS);
  $('#style-select').value = store.get('style', 'normal');
  $('#rules').value = store.get('rules', '');
  renderAllowList();
  renderFenix();
}

function renderAllowList() {
  const rows = [];
  let keys = [];
  try { keys = Object.keys(localStorage); } catch { /* almacenamiento bloqueado */ }
  for (const k of keys.filter((x) => x.startsWith('jeancode.allow:'))) {
    const ws = k.slice('jeancode.allow:'.length);
    for (const p of store.get(`allow:${ws}`, [])) {
      rows.push(`<li><span class="ep-url mono">${esc(p)}</span><span class="ep-meta">${esc(ws)}</span><button class="btn ghost sm" data-allow-ws="${esc(ws)}" data-allow-p="${esc(p)}">QUITAR</button></li>`);
    }
  }
  $('#allow-list').innerHTML = rows.join('') || '<li>Ninguno. En el agente, «Permitir siempre aquí» guarda el comando para esa carpeta.</li>';
}
$('#allow-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-allow-p]');
  if (!b) return;
  const key = `allow:${b.dataset.allowWs}`;
  store.set(key, store.get(key, []).filter((p) => p !== b.dataset.allowP));
  renderAllowList();
});
$('#style-select').addEventListener('change', (e) => { store.set('style', e.target.value); toast('ESTILO: ' + e.target.selectedOptions[0].textContent.toUpperCase()); });
$('#rules').addEventListener('change', (e) => store.set('rules', e.target.value));

/* ------------------------------------------------------- modelos locales */
async function findLocal() {
  const found = (await detectLocal(LOCAL_CANDIDATES)).filter((c) => c.models?.length);
  return found;
}
function addLocalEndpoints(found) {
  const known = new Set(getEndpoints().map((e) => e.url));
  let n = 0;
  for (const f of found) if (!known.has(f.url)) { addEndpoint(f.url, 'local', f.provider); n++; }
  return n;
}
const LOCAL_HELP = desktop
  ? 'No encontré servidores locales. Instala Ollama (ollama.com) o LM Studio, ábrelo y vuelve a detectar.'
  : 'No encontré servidores locales. Instala Ollama (ollama.com) y ábrelo con OLLAMA_ORIGINS=* para que la web pueda hablar con él, o usa la app de escritorio (no tiene ese límite).';

$('#local-detect').addEventListener('click', async () => {
  const btn = $('#local-detect');
  btn.disabled = true; btn.textContent = 'Buscando…';
  try {
    const found = await findLocal();
    $('#local-list').innerHTML = found.length
      ? found.map((f) => `<li><span class="ep-prov">${esc(f.label)}</span><span class="ep-url">${esc(f.url)}</span><span class="ep-meta">${f.models.length} modelo(s)</span></li>`).join('')
      : `<li>${esc(LOCAL_HELP)}</li>`;
    const n = addLocalEndpoints(found);
    if (n) { await refreshModels(); renderSettings(); toast(`${n} SERVIDOR(ES) LOCAL(ES) AGREGADO(S)`); }
  } finally {
    btn.disabled = false; btn.textContent = 'Detectar modelos de esta PC';
  }
});
$('#ollama-suggest').innerHTML = OLLAMA_SUGGESTED.map((m) => `<option value="${m.name}">${esc(m.note)}</option>`).join('');
$('#ollama-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#ollama-model').value.trim();
  if (!/^[\w.:/-]{2,120}$/.test(name)) { toast('NOMBRE DE MODELO INVÁLIDO'); return; }
  const st = $('#ollama-status');
  try {
    await ollamaPull(name, (s, f) => { st.textContent = `${name}: ${s}${f != null ? ` ${Math.round(f * 100)}%` : ''}`; });
    st.textContent = `${name}: instalado.`;
    addLocalEndpoints([{ url: 'http://localhost:11434/v1', provider: 'ollama' }]);
    await refreshModels(); renderSettings();
    toast(`INSTALADO: ${name.toUpperCase()}`);
  } catch (err) { st.textContent = err.message; }
});

$('#splash-local').addEventListener('click', async () => {
  const msg = $('#splash-msg');
  msg.className = 'msg';
  msg.textContent = 'Buscando Ollama, LM Studio, llama.cpp… en esta PC';
  const found = await findLocal();
  if (!found.length) { msg.className = 'msg err'; msg.textContent = LOCAL_HELP; return; }
  store.setRemember($('#splash-remember').checked);
  saveEndpoints([]);
  addLocalEndpoints(found);
  store.set('siblingsChecked', true);
  msg.textContent = `Encontrado: ${found.map((f) => `${f.label} (${f.models.length})`).join(', ')}`;
  await enterApp();
});
$('#endpoint-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ep-del]');
  if (!b) return;
  saveEndpoints(getEndpoints().filter((x) => x.id !== b.dataset.epDel));
  if (!getEndpoints().length) { $('#panel-settings').close(); showSplash(); return; }
  await refreshModels(); renderSettings();
});
$('#endpoint-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#ep-msg');
  msg.className = 'msg';
  const v = validateEndpoint({ url: $('#ep-url').value, key: $('#ep-key').value, provider: $('#ep-provider').value },
    { existing: getEndpoints(), desktop: !!desktop });
  if (!v.ok) { msg.className = 'msg err'; msg.textContent = v.errors.join(' '); return; }
  if (v.provider !== $('#ep-provider').value) $('#ep-provider').value = v.provider;
  msg.textContent = [...v.warnings, 'Probando la conexión…'].join(' ');
  try {
    const r = await probe(v.url, v.key, v.provider);
    addEndpoint(r.url, v.key, v.provider);
    if (v.provider === 'jean') await discoverSiblings(r.url, v.key);
    $('#ep-url').value = ''; $('#ep-key').value = '';
    await refreshModels(); renderSettings();
    msg.textContent = v.warnings.join(' ');
    toast('CONEXIÓN AGREGADA');
  } catch (err) { msg.className = 'msg err'; msg.textContent = diagnose(err, v.provider); toast('NO SE PUDO CONECTAR'); }
});
$('#endpoint-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ep-test]');
  if (!b) return;
  const ep = getEndpoints().find((x) => x.id === b.dataset.epTest);
  if (!ep) return;
  b.disabled = true;
  try { const r = await probeEndpoint(ep); toast(`OK · ${r.ids.length} MODELOS · ${healthOf(ep).ms} MS`); } catch (err) { toast(diagnose(err, providerOf(ep).id)); }
  b.disabled = false;
  await refreshModels(); renderSettings();
});
$('#fallback-select').innerHTML = Object.entries(FALLBACK_POLICIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
$('#fallback-select').addEventListener('change', (e) => { store.set('fallback', e.target.value); toast('RESPALDO: ' + e.target.selectedOptions[0].textContent.toUpperCase()); });
function renderRouteLog() {
  const box = $('#route-log');
  if (box) box.textContent = routeLog().length ? formatLog().split('\n').slice(-60).reverse().join('\n') : 'Todavía no hay peticiones registradas.';
}
$('#log-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(formatLog() || '(vacío)'); toast('REGISTRO COPIADO (SIN CLAVES)'); } catch { toast('NO SE PUDO COPIAR'); }
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
function setThink(on) {
  state.think = on;
  store.set('think', on);
  $('#think-btn').setAttribute('aria-pressed', String(on));
}
$('#think-btn').addEventListener('click', () => { setThink(!state.think); toast(state.think ? 'RAZONAR: SÍ (MÁS LENTO)' : 'RAZONAR: NO (MÁS RÁPIDO)'); });

function applyBrand() {
  if (!BRAND.logo) return;
  $$('[data-logo]').forEach((slot) => {
    const img = new Image();
    img.alt = '';
    img.onload = () => { slot.replaceChildren(img); slot.classList.add('filled'); };
    img.src = BRAND.logo;
  });
}

// web instalable y usable sin conexión (en el escritorio la interfaz ya va dentro de la app)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !desktop) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW la web funciona igual */ });
}

(async function init() {
  applyBrand();
  $('#splash-version').textContent = `v${VERSION}`;
  setThink(state.think);
  updateHint();
  if (desktop?.config) {
    const saved = await desktop.config.load();
    if (saved?.endpoints?.length) saveEndpoints(saved.endpoints);
  }
  if (getEndpoints().length) await enterApp();
  else showSplash();
})();
