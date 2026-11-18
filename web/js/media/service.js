// Servicio común de generación: lo usan el estudio IMAGEN, el chat y las herramientas del agente.
// Elige el modelo, lanza el trabajo, sigue los vídeos (también tras cerrar la app) y guarda cada resultado en este
// dispositivo (IndexedDB). Nada de esto pasa por servidores de JeanCode: solo hacia el proveedor que elegiste.
import { store } from '../store.js';
import { mediaCall, mediaBytes, fetchMediaBlob, getEndpoints } from '../api.js';
import { providerOf } from '../providers.js';
import { billingOf } from '../capabilities.js';
import { mediaKindOf, knownModels, discoverModels, generateImage, submitVideo, pollVideo, controlsFor, MediaError } from './engine.js';

/* ---------------------------------------------------------------- biblioteca */
const DB = 'jeancode-media';
const STORE = 'items';
const memory = new Map(); // sin IndexedDB (modo privado estricto): dura lo que la sesión
let dbp = null;
const openDb = () => {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
};
const tx = async (mode, fn) => {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};

export const library = {
  async put(item) { memory.set(item.id, item); await tx('readwrite', (s) => s.put(item)).catch(() => {}); return item; },
  async get(id) { return memory.get(id) || (await tx('readonly', (s) => s.get(id)).catch(() => null)) || null; },
  async list() {
    const saved = (await tx('readonly', (s) => s.getAll()).catch(() => null)) || [];
    const all = new Map([...saved.map((i) => [i.id, i]), ...memory]);
    return [...all.values()].sort((a, b) => b.createdAt - a.createdAt);
  },
  async remove(id) { memory.delete(id); await tx('readwrite', (s) => s.delete(id)).catch(() => {}); },
  async wipe() { memory.clear(); await tx('readwrite', (s) => s.clear()).catch(() => {}); },
};

/* ---------------------------------------------------------------- utilidades */
export const extOf = (mime) => ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm', 'video/mp4': 'mp4' }[mime] || (String(mime).startsWith('video') ? 'mp4' : 'png'));

/** El tipo real del archivo por sus primeros bytes (los proveedores no siempre lo dicen bien). */
export function sniffMime(bytes, fallback = 'image/png') {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79) return 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45) return 'video/webm';
  return fallback;
}
function b64ToBlob(b64, mime) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: sniffMime(bytes, mime) });
}
export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
export const slugOf = (text) => String(text || 'generado').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'generado';

const JOBS_KEY = 'media:jobs';
const JOB_MAX_MS = 2 * 3600 * 1000;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
});

/* ---------------------------------------------------------------- servicio */
/** models() → los modelos de todas las conexiones: [{ id, ep }]. */
export function createMediaService({ models }) {
  const listeners = new Set();
  const live = new Map();       // trabajos en curso: id → { id, kind, prompt, model, startedAt, status, ctl }
  const discovered = new Map(); // ep.id → [{ id, kind }]
  const emit = (what) => listeners.forEach((fn) => fn(what));
  const netFor = (ep, signal) => ({ ep, call: (path, opts = {}) => mediaCall(ep, path, { ...opts, signal }), bytes: (path, opts = {}) => mediaBytes(ep, path, { ...opts, signal }) });

  const customList = () => store.get('media:custom', []);

  /** Modelos de imagen o de vídeo disponibles con tus conexiones, sin repetidos. */
  function catalog(kind) {
    const eps = getEndpoints();
    const seen = new Map();
    const add = (ep, id, custom = false) => { if (ep && !seen.has(`${ep.id}|${id}`)) seen.set(`${ep.id}|${id}`, { id, ep, kind, custom, key: `${ep.id}|${id}` }); };
    for (const m of models()) if (mediaKindOf(m.ep, m.id) === kind) add(m.ep, m.id);
    for (const ep of eps) {
      for (const m of discovered.get(ep.id) || []) if (m.kind === kind) add(ep, m.id);
      for (const m of knownModels(ep)) if (m.kind === kind) add(ep, m.id);
    }
    for (const c of customList()) if (c.kind === kind) add(eps.find((e) => e.id === c.epId), c.id, true);
    return [...seen.values()];
  }
  /** OpenRouter y similares publican imagen y vídeo en listas aparte. */
  async function refresh() {
    await Promise.all(getEndpoints().map(async (ep) => {
      const found = await discoverModels(ep, netFor(ep)).catch(() => []);
      if (found.length) discovered.set(ep.id, found);
    }));
    emit('catalog');
  }
  function addCustom(epId, id, kind) {
    const list = customList().filter((c) => !(c.epId === epId && c.id === id && c.kind === kind));
    store.set('media:custom', [...list, { epId, id, kind }]);
    emit('catalog');
    return `${epId}|${id}`;
  }
  /** El modelo elegido por el usuario o, si no hay, el primero sin coste por uso. */
  function pick(kind, wanted = store.get(`media:model:${kind}`, null)) {
    const list = catalog(kind);
    if (!list.length) return null;
    const asked = wanted && (list.find((m) => m.key === wanted) || list.find((m) => m.id.toLowerCase() === String(wanted).toLowerCase()));
    return asked || list.find((m) => ['local', 'own', 'free'].includes(billingOf(m.ep, m.id))) || list[0];
  }
  const choose = (kind, key) => { store.set(`media:model:${kind}`, key); emit('catalog'); };

  /** Convierte un resultado del proveedor en un archivo de la biblioteca. */
  async function persist(raw, meta, ep, signal) {
    let blob = null;
    let remoteUrl = '';
    if (raw.blob) blob = raw.blob;
    else if (raw.b64) blob = b64ToBlob(raw.b64, raw.mime || 'image/png');
    else {
      try { blob = await fetchMediaBlob(ep, raw.url, { auth: raw.auth, mime: raw.mime, signal }); } catch (e) {
        if (e.name === 'AbortError' || raw.auth || e.kind === 'forbidden' || !/^https?:\/\//i.test(raw.url)) throw e;
        remoteUrl = raw.url; // la web no puede leerlo (CORS), pero sí mostrarlo mientras la URL siga viva
      }
    }
    const mime = blob?.type || raw.mime || (meta.kind === 'video' ? 'video/mp4' : 'image/png');
    return library.put({ id: crypto.randomUUID(), createdAt: Date.now(), blob, mime, remoteUrl, ...meta });
  }

  const metaOf = (req, m, opts) => ({
    kind: req.kind, prompt: req.prompt, negative: req.negative || '', model: m.id, modelKey: m.key, provider: providerOf(m.ep).name,
    params: { ratio: req.ratio, resolution: req.resolution, seed: req.seed, steps: req.steps, guidance: req.guidance, quality: req.quality, duration: req.duration, audio: req.audio, background: req.background, count: req.count },
    parent: opts.parent || null, batch: opts.batch || null, source: opts.source || 'studio',
  });

  function track(job) { live.set(job.id, job); emit('jobs'); return job; }
  function untrack(id) { live.delete(id); emit('jobs'); }

  /** Sigue un vídeo hasta que termine. Los fallos de red pasajeros no lo dan por perdido. */
  async function watch(saved, m, job) {
    const net = netFor(m.ep, job.ctl.signal);
    let misses = 0;
    let wait = 4000;
    try {
      for (;;) {
        if (Date.now() - saved.startedAt > JOB_MAX_MS) throw new MediaError('El proveedor lleva más de dos horas sin terminar este vídeo.', { kind: 'timeout' });
        await sleep(wait, job.ctl.signal);
        wait = Math.min(wait * 1.25, 15000);
        let st;
        try { st = await pollVideo(saved.ref, net); misses = 0; } catch (e) {
          if (e.name === 'AbortError' || ++misses >= 6 || (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)) throw e;
          continue;
        }
        if (st.progress != null) { job.progress = st.progress; emit('jobs'); }
        if (!st.done) continue;
        if (st.error) throw new MediaError(st.error);
        const items = [];
        for (const raw of st.items) items.push(await persist(raw, saved.meta, m.ep, job.ctl.signal));
        emit('library');
        return items;
      }
    } finally {
      store.set(JOBS_KEY, store.get(JOBS_KEY, []).filter((j) => j.id !== saved.id));
      untrack(job.id);
    }
  }

  /**
   * Genera y guarda. req = petición normalizada (engine.js) + modelKey opcional.
   * opts = { source, parent, batch, signal, onStatus }. Devuelve los elementos de la biblioteca.
   */
  async function generate(req, opts = {}) {
    const m = pick(req.kind, req.modelKey);
    if (!m) throw new MediaError(`No hay ningún modelo de ${req.kind === 'video' ? 'vídeo' : 'imagen'} en tus conexiones.`, { kind: 'no-model' });
    const prompt = String(req.prompt || '').trim();
    if (!prompt) throw new MediaError('Escribe qué quieres generar.', { kind: 'request' });
    const full = { ...req, prompt, model: m.id };
    const ctl = new AbortController();
    opts.signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    const job = track({ id: crypto.randomUUID(), kind: req.kind, prompt, model: m.id, startedAt: Date.now(), ctl, source: opts.source || 'studio' });
    const meta = metaOf(full, m, opts);
    if (req.kind === 'image') {
      try {
        const raws = await generateImage(full, netFor(m.ep, ctl.signal));
        const items = [];
        for (const raw of raws) items.push(await persist(raw, meta, m.ep, ctl.signal));
        emit('library');
        return items;
      } finally { untrack(job.id); }
    }
    let ref;
    try { ref = await submitVideo(full, netFor(m.ep, ctl.signal)); } catch (e) { untrack(job.id); throw e; }
    if (!ref?.id) { untrack(job.id); throw new MediaError('El proveedor no devolvió un trabajo de vídeo.'); }
    // se recuerda (sin imágenes ni claves) para retomarlo si cierras la app mientras el proveedor trabaja
    const saved = { id: job.id, key: m.key, ref, meta, startedAt: job.startedAt };
    store.set(JOBS_KEY, [...store.get(JOBS_KEY, []), saved]);
    return watch(saved, m, job);
  }

  /** Al abrir la app: sigue los vídeos que quedaron en marcha. onDone(items) / onFail(error, job). */
  function resume({ onDone, onFail } = {}) {
    for (const saved of store.get(JOBS_KEY, [])) {
      if (live.has(saved.id)) continue;
      const m = catalog('video').find((x) => x.key === saved.key);
      if (!m) continue; // la conexión aún no cargó o se borró: se reintenta en el próximo arranque
      const job = track({ id: saved.id, kind: 'video', prompt: saved.meta.prompt, model: m.id, startedAt: saved.startedAt, ctl: new AbortController(), source: saved.meta.source });
      watch(saved, m, job).then((items) => onDone?.(items), (e) => { if (e.name !== 'AbortError') onFail?.(e, job); });
    }
  }

  /** Guarda un vídeo exportado desde HTML junto con su composición, para poder seguir editándola. */
  async function saveHtmlVideo(blob, { prompt, html, ratio, duration, source = 'html' }) {
    const item = await library.put({ id: crypto.randomUUID(), createdAt: Date.now(), kind: 'video', blob, mime: blob.type || 'video/mp4', remoteUrl: '', prompt, negative: '', model: 'Composición HTML', html, params: { ratio, duration }, parent: null, batch: null, source });
    emit('library');
    return item;
  }

  return {
    catalog, refresh, addCustom, pick, choose, generate, resume, saveHtmlVideo,
    controls: (m) => controlsFor(m.ep, m.id, m.kind),
    billing: (m) => billingOf(m.ep, m.id),
    jobs: () => [...live.values()],
    cancel: (id) => live.get(id)?.ctl.abort(),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    changed: () => emit('library'),
  };
}
