// JeanCode escritorio — proceso principal.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const tools = require('./lib/tools');
const skillsLib = require('./lib/skills');
const { ComputerControl } = require('./lib/computer/control');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const skills = () => skillsLib.create(path.join(app.getPath('userData'), 'skills'));
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
  try {
    const res = await fetch(req.url, { method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeout) });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'sin respuesta a tiempo' : e.message };
  }
});

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
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
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
ipcMain.handle('fs:edit', (_e, root, rel, a, b) => tools.edit(root, rel, a, b));
ipcMain.handle('fs:search', (_e, root, pat, rel) => tools.search(root, pat, rel));
ipcMain.handle('shell:run', (_e, root, cmd, timeout) => tools.run(root, cmd, timeout));
ipcMain.handle('fs:undo', (_e, root) => tools.undo(root));
ipcMain.handle('fs:peek', (_e, root, rel) => tools.peek(root, rel));
ipcMain.handle('fs:glob', (_e, root, pat, limit) => tools.glob(root, pat, limit));
ipcMain.handle('web:fetch', (_e, url) => tools.webfetch(url));
ipcMain.handle('project:memory', (_e, root) => tools.projectMemory(root));
ipcMain.handle('project:commands', (_e, root) => tools.commands(root));
ipcMain.handle('project:agents', (_e, root) => tools.agents(root));
ipcMain.handle('project:hooks', (_e, root) => tools.hooks(root));
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
  const killed = tools.stopAllProcesses();
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

/* ---------------- skills ---------------- */
ipcMain.handle('skills:list', () => skills().list());
ipcMain.handle('skills:read', (_e, name) => skills().read(name));
ipcMain.handle('skills:remove', (_e, id) => skills().remove(id));
ipcMain.handle('skills:installFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Carpeta de la skill (con SKILL.md)' });
  return r.canceled ? null : skills().installFrom(r.filePaths[0]);
});
ipcMain.handle('skills:installUrl', (_e, url) => skills().installUrl(url, app.getPath('temp')));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Al salir no queda nada corriendo: ni procesos del agente ni el driver de control
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tools.stopAllProcesses();
  if (control) control.driver.stop();
});
