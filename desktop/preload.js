// Puente seguro renderer <-> main. La interfaz solo ve estas funciones (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require('electron');

const streams = new Map();
ipcRenderer.on('stream:event', (_e, id, json) => streams.get(id)?.onEvent(json));
ipcRenderer.on('stream:done', (_e, id) => { streams.get(id)?.onDone(); streams.delete(id); });
ipcRenderer.on('stream:error', (_e, id, err) => { streams.get(id)?.onError(err); streams.delete(id); });

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('jeancodeDesktop', {
  version: process.versions.electron,
  http: call('http'),
  stream(req, handlers) {
    const id = Math.random().toString(36).slice(2);
    streams.set(id, handlers);
    ipcRenderer.send('stream:start', id, req);
    return id;
  },
  abort(id) { ipcRenderer.send('stream:abort', id); streams.delete(id); },
  config: { load: call('config:load'), save: call('config:save') },
  fs: {
    pickFolder: call('fs:pickFolder'),
    list: call('fs:list'),
    read: call('fs:read'),
    write: call('fs:write'),
    edit: call('fs:edit'),
    search: call('fs:search'),
    undo: call('fs:undo'),
    peek: call('fs:peek'),
    glob: call('fs:glob'),
  },
  web: { fetch: call('web:fetch') },
  project: { memory: call('project:memory'), commands: call('project:commands') },
  shell: { run: call('shell:run') },
  system: { info: call('system:info'), os: call('system:os') },
  skills: {
    list: call('skills:list'),
    read: call('skills:read'),
    remove: call('skills:remove'),
    installFolder: call('skills:installFolder'),
    installUrl: call('skills:installUrl'),
  },
});
