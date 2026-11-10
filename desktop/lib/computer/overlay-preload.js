// Puente mínimo de la barra flotante: solo tres órdenes y el estado. Sin acceso a nada más.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jcOverlay', {
  send: (what, value) => { if (['pause', 'stop', 'hover'].includes(what)) ipcRenderer.send(`overlay:${what}`, value); },
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, s) => fn(s)),
});
