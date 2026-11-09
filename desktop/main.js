// JeanCode escritorio — proceso principal.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const tools = require('./lib/tools');
const skillsLib = require('./lib/skills');

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
ipcMain.handle('config:load', async () => {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE(), 'utf8'));
    raw.endpoints = (raw.endpoints || []).map((ep) => {
      if (ep.keyEnc && safeStorage.isEncryptionAvailable()) {
        return { ...ep, key: safeStorage.decryptString(Buffer.from(ep.keyEnc, 'base64')), keyEnc: undefined };
      }
      return ep;
    });
    return raw;
  } catch {
    return { endpoints: [] };
  }
});
ipcMain.handle('config:save', async (_e, cfg) => {
  const enc = safeStorage.isEncryptionAvailable();
  const out = {
    endpoints: (cfg.endpoints || []).map((ep) => (enc
      ? { id: ep.id, url: ep.url, provider: ep.provider, keyEnc: safeStorage.encryptString(ep.key).toString('base64') }
      : ep)),
  };
  await fs.mkdir(path.dirname(CONFIG_FILE()), { recursive: true });
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(out, null, 2), 'utf8');
  return true;
});

/* ---------------- red (sin CORS: las peticiones salen del proceso principal) ---------------- */
const okUrl = (u) => { try { return ['https:', 'http:'].includes(new URL(u).protocol); } catch { return false; } };

ipcMain.handle('http', async (_e, req) => {
  if (!okUrl(req.url)) return { error: 'URL inválida' };
  try {
    const res = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.on('stream:start', async (e, id, req) => {
  const wc = e.sender;
  if (!okUrl(req.url)) { wc.send('stream:error', id, { message: 'URL inválida' }); return; }
  const ctrl = new AbortController();
  streams.set(id, ctrl);
  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctrl.signal });
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
        try { wc.send('stream:event', id, JSON.parse(payload)); } catch { /* parcial */ }
      }
    }
    wc.send('stream:done', id);
  } catch (err) {
    if (err.name !== 'AbortError') wc.send('stream:error', id, { message: err.message });
  } finally {
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
