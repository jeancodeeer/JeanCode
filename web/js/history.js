// Historial de conversaciones en IndexedDB (antes: localStorage).
// Por qué: localStorage guarda todo como un solo texto (~5 MB en Chrome) y se reescribía entero en cada
// mensaje; con el agente (resultados de herramientas, capturas) se llenaba y el historial dejaba de
// guardarse sin avisar. Aquí cada conversación es un registro aparte, solo se escribe lo que cambió,
// de forma asíncrona y agrupada, y lo que no hace falta para continuar no se guarda.
import { store } from './store.js';

const DB = 'jeancode';
const STORE = 'threads';
const LEGACY_KEY = 'jeancode.threads';
const MAX_TOOL = 4000;   // resultados de herramientas antiguos: se guardan recortados
const KEEP_FULL = 12;    // los últimos mensajes del agente se guardan completos

let db = null;
let pending = null;
let timer = null;
const written = new Map(); // id -> { sig, json } guardado (para escribir solo lo que cambió)
let hot = null;            // conversación abierta: se compara siempre entera
// firma barata: si no cambia, la conversación no se vuelve a serializar
const sig = (t) => `${t.updated}|${t.title}|${t.messages?.length}|${t.agentMessages?.length || 0}|${Object.keys(t.files || {}).length}|${(t.todos || []).length}`;
let onError = () => {};

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = (mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode);
  const out = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(out?.result);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

/** Copia para guardar: sin capturas viejas, sin el prompt del sistema (se regenera) y con resultados antiguos recortados. */
export function compactThread(t) {
  if (!Array.isArray(t.agentMessages)) return t;
  const n = t.agentMessages.length;
  const agentMessages = t.agentMessages.map((m, i) => {
    if (i === 0 && m.role === 'system') return { role: 'system', content: '' };
    if (Array.isArray(m.content)) return { role: m.role, content: m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') + '\n(captura omitida)' };
    if (i < n - KEEP_FULL && m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL) {
      return { ...m, content: `${m.content.slice(0, MAX_TOOL / 2)}\n…(resultado recortado al guardar)…\n${m.content.slice(-MAX_TOOL / 2)}` };
    }
    return m;
  });
  return { ...t, agentMessages };
}

/** Carga el historial. La primera vez, migra lo que hubiera en localStorage. */
export async function loadThreads(onFail = () => {}) {
  onError = onFail;
  try {
    db = await open();
    let list = await tx('readonly', (s) => s.getAll());
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { /* sin localStorage */ }
    if (Array.isArray(legacy) && legacy.length) {
      const have = new Set(list.map((t) => t.id));
      const add = legacy.filter((t) => t?.id && !have.has(t.id)).map(compactThread);
      if (add.length) await tx('readwrite', (s) => add.forEach((t) => s.put(t)));
      list = [...list, ...add];
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* */ }
    }
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    for (const t of list) written.set(t.id, { sig: sig(t), json: JSON.stringify(t) });
    return list;
  } catch {
    db = null; // sin IndexedDB (modo privado estricto): se sigue como antes
    return store.get('threads', []);
  }
}

async function flush() {
  timer = null;
  const threads = pending;
  pending = null;
  if (!threads) return;
  if (!db) { store.set('threads', threads.map(compactThread)); return; }
  try {
    const ids = new Set(threads.map((t) => t.id));
    const changed = [];
    for (const t of threads) {
      const prev = written.get(t.id);
      const sg = sig(t);
      if (prev && prev.sig === sg && t.id !== hot) continue;
      const json = JSON.stringify(compactThread(t));
      if (!prev || prev.json !== json) changed.push([t.id, json, sg]);
      else prev.sig = sg;
    }
    const gone = [...written.keys()].filter((id) => !ids.has(id));
    if (!changed.length && !gone.length) return;
    await tx('readwrite', (s) => {
      for (const [, json] of changed) s.put(JSON.parse(json));
      for (const id of gone) s.delete(id);
    });
    for (const [id, json, sg] of changed) written.set(id, { sig: sg, json });
    for (const id of gone) written.delete(id);
  } catch (e) {
    onError(e);
  }
}

/** Guarda (agrupado: como mucho una escritura cada 400 ms; solo las conversaciones que cambiaron). */
export function saveThreadsSoon(threads, current = null) {
  pending = threads;
  hot = current;
  if (!timer) timer = setTimeout(flush, 400);
}

/** Guarda ya (antes de cerrar o recargar). */
export function saveThreadsNow(threads) {
  if (threads) pending = threads;
  clearTimeout(timer);
  return flush();
}

/** Borra todo el historial (Ajustes → Borrar todo). */
export async function wipeThreads() {
  written.clear();
  pending = null;
  try { if (db) await tx('readwrite', (s) => s.clear()); } catch { /* */ }
  try { indexedDB.deleteDatabase(DB); } catch { /* */ }
}
