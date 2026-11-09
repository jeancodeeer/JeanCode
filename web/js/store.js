// Persistencia local. Todo vive en este navegador (o en el archivo local del escritorio).
// Cada acceso va en try/catch: en modo privado o con almacenamiento bloqueado la app sigue funcionando en memoria.
const PREFIX = 'jeancode.';
const memory = new Map();

function backend(remember) {
  try {
    const s = remember ? window.localStorage : window.sessionStorage;
    const probe = PREFIX + '__probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function rememberFlag() {
  try { return window.localStorage.getItem(PREFIX + 'remember') !== '0'; } catch { return true; }
}

export const store = {
  get(key, fallback = null) {
    const full = PREFIX + key;
    try {
      const raw = (backend(true)?.getItem(full)) ?? (backend(false)?.getItem(full));
      if (raw != null) return JSON.parse(raw);
    } catch { /* ignore */ }
    return memory.has(full) ? memory.get(full) : fallback;
  },
  set(key, value, remember = rememberFlag()) {
    const full = PREFIX + key;
    memory.set(full, value);
    try {
      const s = backend(remember);
      if (s) s.setItem(full, JSON.stringify(value));
    } catch { /* cuota llena o bloqueado: queda en memoria */ }
  },
  remove(key) {
    const full = PREFIX + key;
    memory.delete(full);
    try { window.localStorage.removeItem(full); } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(full); } catch { /* ignore */ }
  },
  setRemember(on) {
    try { window.localStorage.setItem(PREFIX + 'remember', on ? '1' : '0'); } catch { /* ignore */ }
  },
  wipe() {
    memory.clear();
    for (const s of [window.localStorage, window.sessionStorage]) {
      try {
        Object.keys(s).filter((k) => k.startsWith(PREFIX)).forEach((k) => s.removeItem(k));
      } catch { /* ignore */ }
    }
  },
};
