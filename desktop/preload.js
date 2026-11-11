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
    move: call('fs:move'),
    trash: call('fs:trash'),
    diagnose: call('fs:diagnose'),
  },
  web: { fetch: call('web:fetch') },
  project: { memory: call('project:memory'), commands: call('project:commands'), agents: call('project:agents'), hooks: call('project:hooks') },
  turn: { begin: call('turn:begin'), rewind: call('turn:rewind') },
  shell: { run: call('shell:run'), cancel: call('shell:cancel') },
  proc: { start: call('proc:start'), output: call('proc:output'), list: call('proc:list'), stop: call('proc:stop') },
  // Control del equipo: cada acción la ejecuta el proceso principal en serie, con parada y registro
  mcp: {
    list: call('mcp:list'), save: call('mcp:save'), remove: call('mcp:remove'), connect: call('mcp:connect'),
    disconnect: call('mcp:disconnect'), connectAll: call('mcp:connectAll'), tools: call('mcp:tools'), call: call('mcp:call'),
  },
  computer: {
    supported: call('computer:supported'),
    begin: call('computer:begin'),
    act: call('computer:act'),
    end: call('computer:end'),
    pause: call('computer:pause'),
    resume: call('computer:resume'),
    stop: call('computer:stop'),
    state: call('computer:state'),
    log: call('computer:log'),
    attention: call('computer:attention'),
    approveTerminal: call('computer:approveTerminal'),
    foreground: call('computer:foreground'),
    target: call('computer:target'),
    onState: (fn) => ipcRenderer.on('computer:state', (_e, s) => fn(s)),
    onEmergency: (fn) => ipcRenderer.on('computer:emergency', (_e, reason) => fn(reason)),
  },
  system: { info: call('system:info'), os: call('system:os') },
  skills: {
    list: call('skills:list'),
    read: call('skills:read'),
    remove: call('skills:remove'),
    installFolder: call('skills:installFolder'),
    installUrl: call('skills:installUrl'),
  },
});
