// JeanCode escritorio — proceso principal.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const tools = require('./lib/tools');
const { McpManager } = require('./lib/mcp');
const diagnostics = require('./lib/diagnostics');
const { checkLink } = require('./lib/linkcheck');
const skillsLib = require('./lib/skills');
const pluginsLib = require('./lib/plugins');
const { ComputerControl } = require('./lib/computer/control');
const runner = require('./lib/runner');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const skills = () => skillsLib.create(path.join(app.getPath('userData'), 'skills'));
// una sola instancia: guarda en memoria el índice de los plugins (cientos de SKILL.md) hasta que cambian
let pluginStore;
const plugins = () => (pluginStore ||= pluginsLib.create(path.join(app.getPath('userData'), 'plugins')));
const streams = new Map();
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600,
    backgroundColor: '#000000', title: 'JeanCode', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // Enlaces externos: al navegador del sistema, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
}

/* ---------------- configuración (claves cifradas con el llavero del sistema) ---------------- */
const decrypt = (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'));
const encrypt = (text) => safeStorage.encryptString(String(text)).toString('base64');
// Secretos que no son de un endpoint (p. ej. el token de Hugging Face). Solo nombres conocidos.
const SECRET_NAMES = new Set(['hfToken']);

async function readConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG_FILE(), 'utf8')); } catch { return {}; }
}

ipcMain.handle('config:load', async () => {
  const raw = await readConfig();
  const enc = safeStorage.isEncryptionAvailable();
  const endpoints = (raw.endpoints || []).map((ep) => (ep.keyEnc && enc ? { id: ep.id, url: ep.url, provider: ep.provider, key: decrypt(ep.keyEnc) } : ep));
  const secrets = {};
  for (const [name, v] of Object.entries(raw.secretsEnc || {})) {
    if (SECRET_NAMES.has(name) && enc) { try { secrets[name] = decrypt(v); } catch { /* otro usuario/equipo */ } }
  }
  return { endpoints, secrets };
});

// Los guardados van EN SERIE y son atómicos (temporal + rename): dos guardados casi simultáneos
// (p. ej. al conectar: vaciar la lista y agregar la conexión) se pisaban y corrompían config.json.
let configQueue = Promise.resolve();
ipcMain.handle('config:save', (_e, cfg) => {
  const job = configQueue.then(() => saveConfig(cfg));
  configQueue = job.catch(() => {});
  return job;
});

async function saveConfig(cfg) {
  const enc = safeStorage.isEncryptionAvailable();
  const prev = await readConfig();
  const out = { endpoints: prev.endpoints || [], secretsEnc: prev.secretsEnc || {} };
  if (Array.isArray(cfg.endpoints)) {
    // sin llavero del sistema las claves NO se escriben en disco (habría que pedirlas otra vez)
    out.endpoints = cfg.endpoints.map((ep) => ({ id: ep.id, url: ep.url, provider: ep.provider, ...(enc ? { keyEnc: encrypt(ep.key) } : {}) }));
  }
  for (const [name, v] of Object.entries(cfg.secrets || {})) {
    if (!SECRET_NAMES.has(name)) continue;
    if (v && enc) out.secretsEnc[name] = encrypt(v); else delete out.secretsEnc[name];
  }
  await fs.mkdir(path.dirname(CONFIG_FILE()), { recursive: true });
  const tmp = `${CONFIG_FILE()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(out, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, CONFIG_FILE());
  return { encrypted: enc };
}

/* ---------------- red (sin CORS: las peticiones salen del proceso principal) ---------------- */
const okUrl = (u) => { try { return ['https:', 'http:'].includes(new URL(u).protocol); } catch { return false; } };

ipcMain.handle('http', async (_e, req) => {
  if (!okUrl(req.url)) return { error: 'URL inválida' };
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) return { error: 'método no permitido' };
  // sin límite, un servidor colgado dejaba la interfaz esperando para siempre
  const timeout = Math.min(Math.max(Number(req.timeout) || 60000, 1000), 3600000);
  // imagen o vídeo generado: con tope de tamaño y comprobando cada salto (lib/tools.js)
  if (req.binary) {
    try {
      const r = await tools.downloadBinary(req.url, { headers: req.headers, publicOnly: req.publicOnly !== false, timeout, method, body: req.body });
      return { status: r.status, type: r.type, b64: r.data ? r.data.toString('base64') : '' };
    } catch (e) { return { error: e.message }; }
  }
  try {
    // noRedirect: comprobar un enlace sin seguir redirecciones (podrían llevar a la red local)
    const res = await fetch(req.url, { method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeout), redirect: req.noRedirect ? 'manual' : 'follow' });
    if (req.noBody) { res.body?.cancel().catch(() => {}); return { status: res.status }; }
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'sin respuesta a tiempo' : e.message };
  }
});

// comprobar enlaces de una respuesta: DNS resuelto y validado aquí, nunca hacia la red local
ipcMain.handle('link:check', (_e, href) => checkLink(href));

ipcMain.on('stream:start', async (e, id, req) => {
  const wc = e.sender;
  if (!okUrl(req.url)) { wc.send('stream:error', id, { message: 'URL inválida' }); return; }
  const ctrl = new AbortController();
  streams.set(id, ctrl);
  // espera máxima hasta que el servidor responde; después el streaming puede durar lo que haga falta
  let timedOut = false;
  const firstByte = Math.min(Math.max(Number(req.timeout) || 120000, 5000), 3600000);
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, firstByte);
  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { wc.send('stream:error', id, { status: res.status, body: await res.text().catch(() => '') }); return; }
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // Ollama responde una línea JSON por trozo, sin el prefijo data:
        if (!req.ndjson && !line.startsWith('data:')) continue;
        const payload = req.ndjson ? line : line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        if (wc.isDestroyed()) { ctrl.abort(); break; }
        try { wc.send('stream:event', id, JSON.parse(payload)); } catch { /* parcial */ }
      }
    }
    if (!wc.isDestroyed()) wc.send('stream:done', id);
  } catch (err) {
    if (wc.isDestroyed()) return; // la ventana se cerró a mitad del streaming
    if (timedOut) wc.send('stream:error', id, { timeout: true, message: 'sin respuesta a tiempo' });
    else if (err.name !== 'AbortError') wc.send('stream:error', id, { message: err.message });
  } finally {
    clearTimeout(timer);
    streams.delete(id);
  }
});
ipcMain.on('stream:abort', (_e, id) => streams.get(id)?.abort());

/* ---------------- archivos, terminal y sistema ---------------- */
ipcMain.handle('fs:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Carpeta de trabajo de JeanCode' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('fs:list', (_e, root, rel) => tools.list(root, rel));
ipcMain.handle('fs:read', (_e, root, rel, off, lim) => tools.read(root, rel, off, lim));
ipcMain.handle('fs:write', (_e, root, rel, content) => tools.write(root, rel, content));
ipcMain.handle('fs:writeBinary', (_e, root, rel, b64) => tools.writeBinary(root, rel, b64));
ipcMain.handle('fs:edit', (_e, root, rel, a, b) => tools.edit(root, rel, a, b));
ipcMain.handle('fs:search', (_e, root, pat, rel) => tools.search(root, pat, rel));
ipcMain.handle('shell:run', (_e, root, cmd, timeout) => tools.run(root, cmd, timeout));
ipcMain.handle('fs:undo', (_e, root) => tools.undo(root));
ipcMain.handle('fs:peek', (_e, root, rel) => tools.peek(root, rel));
ipcMain.handle('fs:glob', (_e, root, pat, limit) => tools.glob(root, pat, limit));
/* ---------------- conexiones con otras apps (MCP) ---------------- */
// mcp.json guarda las conexiones; tokens OAuth, cabeceras y variables van CIFRADOS con el llavero
// del sistema. Sin llavero, los secretos no se escriben en disco (hay que volver a autorizar).
const MCP_FILE = () => path.join(app.getPath('userData'), 'mcp.json');
const SECRET_KEYS = ['headers', 'env', 'oauth', 'clientSecret'];
const mcp = new McpManager({
  open: (url) => {
    if (!/^https:\/\//.test(url)) throw new Error('URL de autorización no segura');
    return shell.openExternal(url);
  },
  store: {
    async load() {
      try {
        const j = JSON.parse(await fs.readFile(MCP_FILE(), 'utf8'));
        if (j.enc && safeStorage.isEncryptionAvailable()) return JSON.parse(decrypt(j.enc));
        return j.servers || [];
      } catch { return []; }
    },
    async save(servers) {
      const enc = safeStorage.isEncryptionAvailable();
      const body = enc ? { enc: encrypt(JSON.stringify(servers)) }
        : { servers: servers.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !SECRET_KEYS.includes(k)))) };
      await fs.mkdir(path.dirname(MCP_FILE()), { recursive: true });
      const tmp = `${MCP_FILE()}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, MCP_FILE());
    },
  },
});
ipcMain.handle('mcp:list', () => mcp.list());
ipcMain.handle('mcp:save', (_e, def) => mcp.save(def));
ipcMain.handle('mcp:remove', (_e, id) => mcp.remove(id));
ipcMain.handle('mcp:connect', (_e, id) => mcp.connect(id, { interactive: true }));
ipcMain.handle('mcp:disconnect', async (_e, id) => { await mcp.disconnect(id); return mcp.list(); });
ipcMain.handle('mcp:connectAll', () => mcp.connectAll());
ipcMain.handle('mcp:tools', () => mcp.tools());
ipcMain.handle('mcp:call', (_e, id, tool, args) => mcp.call(id, tool, args));

ipcMain.handle('fs:diagnose', (_e, root, rel, opts) => diagnostics.diagnose(root, rel, { deep: !!opts?.deep, auto: !!opts?.auto }));
ipcMain.handle('web:fetch', (_e, url) => tools.webfetch(url));
ipcMain.handle('project:memory', (_e, root) => tools.projectMemory(root));
// los del proyecto primero: si un nombre coincide con el de un plugin, gana el proyecto
const merge = (own, extra) => [...own, ...extra.filter((x) => !own.some((o) => o.name === x.name))];
ipcMain.handle('project:commands', async (_e, root) => merge(await tools.commands(root), await plugins().commands().catch(() => [])));
ipcMain.handle('project:agents', async (_e, root) => merge(await tools.agents(root), await plugins().agents().catch(() => [])));
ipcMain.handle('project:hooks', (_e, root) => tools.hooks(root));
// Hooks globales del usuario (Ajustes): <userData>/settings.json, como ~/.claude/settings.json de Claude Code.
// No piden confianza porque los escribe él. Se sigue leyendo <userData>/hooks.json (formato antiguo) si no hay settings.json.
const hookconfig = require('./lib/hookconfig');
const USER_SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const LEGACY_HOOKS = () => path.join(app.getPath('userData'), 'hooks.json');
ipcMain.handle('hooks:global', async () => {
  let file = USER_SETTINGS();
  let text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!text.trim()) { file = LEGACY_HOOKS(); text = await fs.readFile(file, 'utf8').catch(() => ''); }
  if (!text.trim()) return { text: '', hooks: {}, file: USER_SETTINGS() };
  try {
    const n = hookconfig.normalize(JSON.parse(text));
    return { text, hooks: n.disableAll ? {} : n.hooks, disableAll: n.disableAll, file };
  } catch (e) { return { text, hooks: {}, error: e.message, file }; }
});
ipcMain.handle('hooks:saveGlobal', async (_e, text) => {
  const t = String(text || '').trim();
  if (t) hookconfig.normalize(JSON.parse(t)); // lanza si no es válido: no se guarda
  await fs.writeFile(USER_SETTINGS(), t ? `${t}
` : '', 'utf8');
  await fs.rm(LEGACY_HOOKS(), { force: true }); // ya migrado al formato nuevo
  return true;
});
// transcript_path de los hooks: la conversación en JSONL (como Claude Code), en <userData>/transcripts/<id>.jsonl
ipcMain.handle('hooks:transcript', async (_e, id, lines) => {
  const safe = String(id).replace(/[^\w-]/g, '').slice(0, 80);
  if (!safe) throw new Error('id inválido');
  const dir = path.join(app.getPath('userData'), 'transcripts');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safe}.jsonl`);
  await fs.writeFile(file, (Array.isArray(lines) ? lines : []).map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
});
ipcMain.handle('hooks:exec', (_e, root, command, input, timeout) => tools.execHook(root, command, input, timeout));
ipcMain.handle('turn:begin', (_e, root, turn) => tools.beginTurn(root, turn));
ipcMain.handle('turn:rewind', (_e, root, turn) => tools.rewind(root, turn));
ipcMain.handle('system:info', () => tools.systemInfo());
ipcMain.handle('system:os', () => tools.osShort());

/* ---------------- control del equipo ----------------
 * El agente (renderer) pide acciones; aquí se ejecutan en serie con el driver del sistema.
 * Mientras hay una tarea: barra flotante siempre visible (excluida de las capturas), atajo de
 * emergencia Ctrl+Alt+Q, y JeanCode excluido de las capturas (setContentProtection) y, si el
 * usuario lo eligió, minimizado para que el agente vea y use el escritorio. */
let control = null;
let overlay = null;
const EMERGENCY = 'CommandOrControl+Alt+Q';

function getControl() {
  if (!control) {
    control = new ComputerControl({ logFile: path.join(app.getPath('userData'), 'computer-actions.jsonl'), ownPid: process.pid });
    control.on('state', (s) => {
      if (win && !win.isDestroyed()) win.webContents.send('computer:state', s);
      if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:state', s);
      if (s.status === 'stopped' || s.status === 'idle') finishSession();
    });
  }
  return control;
}

function showOverlay() {
  if (overlay && !overlay.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const w = 560;
  overlay = new BrowserWindow({
    width: w, height: 40, x: Math.round(area.x + (area.width - w) / 2), y: area.y + 6,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'lib', 'computer', 'overlay-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setContentProtection(true);            // nunca sale en las capturas del agente
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'lib', 'computer', 'overlay.html'));
  overlay.once('ready-to-show', () => { overlay.showInactive(); overlay.webContents.send('overlay:state', control.state); });
}

function finishSession() {
  try { globalShortcut.unregister(EMERGENCY); } catch { /* no estaba */ }
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
  if (win && !win.isDestroyed()) {
    win.setContentProtection(false);
    if (control?.minimizedByUs) { control.minimizedByUs = false; win.restore(); }
  }
}

function emergencyStop(reason) {
  if (!control || control.state.status === 'idle') return;
  const killed = tools.stopAllProcesses() + runner.stopAll();
  control.stop(`${reason}${killed ? ` · ${killed} proceso(s) terminados` : ''}`);
  if (win && !win.isDestroyed()) { win.webContents.send('computer:emergency', reason); win.restore(); win.focus(); }
}

ipcMain.handle('computer:supported', () => ({ supported: ComputerControl.isSupported(), platform: process.platform }));
ipcMain.handle('computer:begin', async (_e, task, opts = {}) => {
  const c = getControl();
  const info = await c.begin(task);
  globalShortcut.register(EMERGENCY, () => emergencyStop('parada de emergencia (Ctrl+Alt+Q)'));
  showOverlay();
  win.setContentProtection(true);                // JeanCode no aparece en las capturas (ni sus ajustes)
  if (opts.minimize !== false) { c.minimizedByUs = true; win.minimize(); }
  return info;
});
ipcMain.handle('computer:act', (_e, name, args) => getControl().act(name, args));
ipcMain.handle('computer:approveTerminal', () => { getControl().approveTerminal(); return true; });
ipcMain.handle('computer:foreground', () => getControl().foreground());
ipcMain.handle('computer:target', (_e, tool, args) => getControl().targetInfo(tool, args));
ipcMain.handle('computer:end', (_e, reason) => { getControl().end(reason); return true; });
ipcMain.handle('computer:pause', () => { getControl().pause(); return getControl().state; });
ipcMain.handle('computer:resume', () => { getControl().resume(); return getControl().state; });
ipcMain.handle('computer:stop', (_e, reason) => { emergencyStop(reason || 'detenida por el usuario'); return true; });
ipcMain.handle('computer:state', () => (control ? control.state : { status: 'idle' }));
// Un permiso pendiente necesita al usuario: JeanCode vuelve al frente; después se aparta otra vez
ipcMain.handle('computer:attention', (_e, on) => {
  if (!win || win.isDestroyed()) return false;
  if (on) { win.restore(); win.show(); win.focus(); if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:state', { ...control.state, note: 'ESPERANDO TU PERMISO EN JEANCODE' }); }
  else if (control?.minimizedByUs && control.state.status !== 'idle') { win.minimize(); }
  return true;
});
ipcMain.handle('computer:log', (_e, n) => getControl().recent(n));
ipcMain.on('overlay:pause', () => { const c = getControl(); if (c.state.status === 'paused') c.resume(); else c.pause(); });
ipcMain.on('overlay:stop', () => emergencyStop('detenida desde la barra flotante'));
ipcMain.on('overlay:hover', (_e, on) => { if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(!on, { forward: true }); });

/* ---------------- procesos y papelera ---------------- */
ipcMain.handle('shell:cancel', () => tools.cancelRuns());
ipcMain.handle('proc:start', (_e, root, cmd) => tools.startProcess(root, cmd));
ipcMain.handle('proc:output', (_e, id, tail) => tools.processOutput(id, tail));
ipcMain.handle('proc:list', () => tools.listProcesses());
ipcMain.handle('proc:stop', (_e, id) => tools.stopProcess(id));
ipcMain.handle('fs:move', (_e, root, from, to) => tools.move(root, from, to));
// Borrar = mover a la papelera del sistema (recuperable), nunca borrado definitivo
ipcMain.handle('fs:trash', async (_e, root, rel) => {
  const file = await tools.inside(root, rel);
  if (path.resolve(file) === path.resolve(await tools.inside(root, '.'))) throw new Error('no se puede borrar la carpeta de trabajo entera');
  await shell.trashItem(file);
  return `${rel} enviado a la papelera (recuperable)`;
});

/* ---------------- ejecutar el proyecto del modo CODE en el PC (lib/runner.js) ---------------- */
ipcMain.handle('run:plan', (_e, req) => runner.plan(req));
ipcMain.handle('run:start', (e, req) => runner.start(req, (id, ev) => { if (!e.sender.isDestroyed()) e.sender.send('run:event', id, ev); }));
ipcMain.handle('run:input', (_e, id, text) => runner.input(id, text));
ipcMain.handle('run:stop', (_e, id) => runner.stop(id));

/* ---------------- skills ---------------- */
ipcMain.handle('skills:list', async () => merge(await skills().list(), await plugins().skills().catch(() => [])));
// skill propia primero; si no, la de un plugin (o el índice/archivo de un plugin con "file")
ipcMain.handle('skills:read', async (_e, name, file) => {
  name = String(name);
  const own = (await skills().list()).some((s) => s.name === name || s.id === name);
  if (own && !file) return skills().read(name);
  const r = await plugins().read(name, file ? String(file) : '');
  if (r != null) return r;
  if (own) throw new Error('las skills propias no admiten "file"; usa read_file si la skill está en la carpeta de trabajo');
  return skills().read(name); // lanza el error con la lista de instaladas
});
ipcMain.handle('skills:remove', (_e, id) => skills().remove(id));
ipcMain.handle('skills:installFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Carpeta de la skill (con SKILL.md)' });
  return r.canceled ? null : skills().installFrom(r.filePaths[0]);
});
ipcMain.handle('skills:installUrl', (_e, url) => skills().installUrl(url, app.getPath('temp')));
ipcMain.handle('skills:installGithub', (_e, repo, dir, branch) => skills().installGithubDir(repo, dir, branch));

/* ---------------- plugins (formato de Claude Code: skills + subagentes + comandos) ---------------- */
ipcMain.handle('plugins:list', () => plugins().list());
ipcMain.handle('plugins:installGit', (_e, url) => plugins().installGit(String(url), app.getPath('temp')));
ipcMain.handle('plugins:installFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Carpeta del plugin (con .claude-plugin/plugin.json)' });
  return r.canceled ? null : plugins().installFrom(r.filePaths[0], r.filePaths[0]);
});
ipcMain.handle('plugins:setEnabled', (_e, id, on) => plugins().setEnabled(String(id), !!on));
ipcMain.handle('plugins:remove', (_e, id) => plugins().remove(String(id)));

/* ---------------- control remoto desde el móvil ---------------- */
// Móviles emparejados (con su clave) y ajustes en <userData>/remote.json, cifrado con el llavero del sistema.
const REMOTE_FILE = () => path.join(app.getPath('userData'), 'remote.json');
const remoteLan = require('./lib/remote-lan').create({ onEvent: (ev) => win?.webContents.send('remote:lan', ev) });
ipcMain.handle('remote:load', async () => {
  try {
    const j = JSON.parse(await fs.readFile(REMOTE_FILE(), 'utf8'));
    return j.enc ? JSON.parse(decrypt(j.enc)) : j.data || {};
  } catch { return {}; }
});
ipcMain.handle('remote:save', async (_e, data) => {
  const text = JSON.stringify(data ?? {});
  if (text.length > 200000) throw new Error('datos del control remoto demasiado grandes');
  const body = safeStorage.isEncryptionAvailable() ? { enc: encrypt(text) } : { data: JSON.parse(text) };
  await fs.writeFile(REMOTE_FILE(), JSON.stringify(body), 'utf8');
  return true;
});
ipcMain.handle('remote:lanStart', (_e, port) => remoteLan.start(Number(port) || undefined));
ipcMain.handle('remote:lanStop', () => remoteLan.stop());
ipcMain.handle('remote:lanStatus', () => remoteLan.status());
ipcMain.handle('remote:lanSend', (_e, conn, text) => remoteLan.send(Number(conn), String(text)));
ipcMain.handle('remote:lanClose', (_e, conn) => remoteLan.close(Number(conn)));
ipcMain.handle('remote:qr', (_e, text) => require('qrcode').toDataURL(String(text).slice(0, 2000), { margin: 2, scale: 6, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#f2f1ec' } }));
app.on('before-quit', () => remoteLan.stop());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Al salir no queda nada corriendo: ni procesos del agente ni el driver de control
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tools.stopAllProcesses();
  runner.stopAll();
  if (control) control.driver.stop();
  mcp.closeAll().catch(() => {});
});
