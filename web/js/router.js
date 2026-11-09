// Enrutador de JeanCode. Capas:
//   providers.js  qué proveedores existen (configuración estática)
//   router.js     validar conexiones, salud, elegir el backend (AUTO), respaldo y registro
//   api.js        ejecutar la petición (transporte, errores por proveedor, ajustes de parámetros)
// La interfaz (app.js, agent.js) solo habla con router.chat() y nunca decide transportes.
import { store } from './store.js';
import { chatStream, listModelsDetailed, normalizeUrl, isRouterUrl, sameServer } from './api.js';
import { PROVIDERS, providerById, providerOf } from './providers.js';

export const AUTO = 'auto';

/** Identidad de un modelo: el mismo nombre puede existir en dos conexiones. */
export const modelKey = (m) => (m ? `${m.ep.id}|${m.id}` : '');

/* ------------------------------------------------------------------ registro */
const LOG_MAX = 200;
const log = [];

/** Quita claves y tokens de cualquier texto: Bearer, sk-…, hf_…, jean_…, ?key=… y cadenas largas tipo token. */
export function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
    .replace(/\b(sk-(?:ant-|or-)?|hf_|gsk_|xai-|fw_|csk-|jean_|AIza)[A-Za-z0-9_-]{6,}/g, '$1***')
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, '$1***')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (/^[0-9a-f-]{36}$/i.test(m) ? m : '***'));
}

/** Host y ruta de un endpoint, sin consulta ni credenciales (lo único que entra en el registro). */
export function where(ep) {
  try { const u = new URL(ep.url); return `${u.host}${u.pathname}`; } catch { return '(url inválida)'; }
}

export function logRoute(entry) {
  log.push({ t: Date.now(), ...entry, msg: entry.msg ? redact(entry.msg).slice(0, 300) : undefined });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

export const routeLog = () => log.slice();

export function formatLog() {
  return log.map((e) => {
    const time = new Date(e.t).toISOString().slice(11, 19);
    return [time, e.kind, e.provider, e.where, e.model, e.status != null ? `status=${e.status}` : '', e.ms != null ? `${e.ms}ms` : '', e.msg || '']
      .filter(Boolean).join(' · ');
  }).join('\n');
}

/* ------------------------------------------------------------------ salud */
const health = new Map(); // ep.id -> { ok, ms, at, error, router, unavailable }
export const healthOf = (ep) => health.get(ep.id) || null;
// Un modelo concreto que no respondió (p. ej. el router dice que Grey se reinicia) se aparta un minuto
// sin marcar como caída toda la conexión, que puede seguir sirviendo otros modelos.
const modelDown = new Map(); // modelKey -> hasta cuándo
const DOWN_MS = 60000;
export const isModelDown = (m) => (modelDown.get(`${m.ep.id}|${m.id}`) || 0) > Date.now();

/** Lista los modelos de un endpoint y anota su salud (latencia, último error). */
export async function probeEndpoint(ep) {
  const t0 = performance.now();
  try {
    const r = await listModelsDetailed(ep);
    const ms = Math.round(performance.now() - t0);
    health.set(ep.id, { ok: true, ms, at: Date.now(), router: r.router, unavailable: r.unavailable });
    logRoute({ kind: 'modelos', provider: providerOf(ep).name, where: where(ep), ms, msg: `${r.ids.length} modelos${r.router ? ' (router)' : ''}` });
    return r;
  } catch (e) {
    health.set(ep.id, { ok: false, ms: null, at: Date.now(), error: redact(e.message) });
    logRoute({ kind: 'modelos-error', provider: providerOf(ep).name, where: where(ep), status: e.status, msg: e.message });
    throw e;
  }
}

/* ------------------------------------------------------------------ validación */
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;
const isLocalHost = (host) => LOCAL_HOST.test(host);

/** Proveedor conocido al que pertenece un host (para corregir una elección equivocada). */
function providerForHost(host) {
  return PROVIDERS.find((p) => p.url && !p.local && (() => { try { return new URL(p.url).host === host; } catch { return false; } })());
}

/**
 * Valida una conexión ANTES de intentar nada. Devuelve { ok, url, key, provider, errors, warnings }.
 * Corrige lo seguro (barra final, /chat/completions pegado, proveedor que no corresponde al host)
 * y rechaza lo que fallaría o expondría la clave.
 */
export function validateEndpoint({ url, key, provider }, { existing = [], desktop = false, pageProtocol = (typeof location !== 'undefined' ? location.protocol : 'https:') } = {}) {
  const errors = [];
  const warnings = [];
  const clean = normalizeUrl(url);
  let prov = providerById(provider);
  const k = String(key ?? '').trim();
  let u;
  try { u = new URL(clean); } catch { errors.push('La URL no es válida. Ejemplo: https://tu-servidor/v1'); }
  if (u) {
    if (!['http:', 'https:'].includes(u.protocol)) errors.push('La URL debe empezar por http:// o https://');
    if (u.username || u.password) errors.push('No pongas usuario o contraseña dentro de la URL: usa el campo de la clave.');
    if (/[?&](key|api_key|token|access_token)=/i.test(u.search)) errors.push('La URL lleva una clave en la consulta (?key=…). Quítala y ponla en el campo de la clave.');
    const local = isLocalHost(u.hostname);
    if (u.protocol === 'http:' && !local) {
      if (!desktop && pageProtocol === 'https:') errors.push('Esta página es https y el navegador bloquea APIs http remotas. Usa la URL https del servidor o la app de escritorio.');
      else warnings.push('La conexión es http sin cifrar: la clave viaja en claro por la red.');
    }
    const owner = providerForHost(u.host);
    if (owner && owner.id !== prov.id) {
      warnings.push(`Esa URL es de ${owner.name}: se usará ese proveedor (elegiste ${prov.name}).`);
      prov = owner;
    }
    if (prov.id === 'jean' && /\.app\.github\.dev$/.test(u.hostname) && !/-(8888|8889|8890|8899)\./.test(u.hostname)) {
      warnings.push('Esta URL de Codespace no es de un puerto de Jean (8899 router, 8888 Grey, 8889 Marvel, 8890 Fénix).');
    }
    if (local && !prov.local && prov.url && prov.id !== 'custom' && prov.id !== 'jean') {
      warnings.push(`${prov.name} no corre en esta PC: ¿querías Ollama, LM Studio u «Otra API»?`);
    }
  }
  const keyOptional = prov.local || (u && isLocalHost(u.hostname));
  if (!k && !keyOptional) errors.push(`Falta la clave de ${prov.name}${prov.keyHint ? ` (${prov.keyHint})` : ''}.`);
  if (k && /^https?:\/\//i.test(k)) errors.push('En el campo de la clave pegaste una URL.');
  if (k && /\s/.test(k)) errors.push('La clave tiene espacios o saltos de línea: cópiala de nuevo, sin espacios.');
  if (/^Bearer\s/i.test(k)) errors.push('Pega solo la clave, sin la palabra «Bearer».');
  if (existing.some((e) => normalizeUrl(e.url) === clean && e.key === k)) errors.push('Esa conexión ya está agregada.');
  return { ok: !errors.length, url: clean, key: k || (keyOptional ? 'local' : ''), provider: prov.id, errors, warnings };
}

/* ------------------------------------------------------------------ elección automática */
// Por modo, qué tipo de modelo conviene primero. Los nombres Jean se reconocen; para el resto
// se respeta el orden de las conexiones (la primera agregada es la preferida).
const MODE_PREF = {
  chat: [/grey/i, /marvel/i, /fenix/i],
  code: [/grey/i, /marvel/i, /fenix/i],
  agent: [/marvel/i, /grey/i, /fenix/i],
};

function score(m, mode, order) {
  const prefs = MODE_PREF[mode] || MODE_PREF.chat;
  const i = prefs.findIndex((re) => re.test(m.id));
  const h = healthOf(m.ep);
  // conexiones y modelos sanos primero; luego preferencia del modo; luego orden en que el usuario las agregó
  return [(h && !h.ok) || isModelDown(m) ? 1 : 0, i < 0 ? prefs.length : i, order.indexOf(m.ep.id)];
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Modelos ordenados del más al menos adecuado para el modo. */
export function rank(models, mode, endpoints) {
  const order = endpoints.map((e) => e.id);
  return [...models].sort((a, b) => cmp(score(a, mode, order), score(b, mode, order)));
}

export function pickAuto(models, mode, endpoints) {
  return rank(models, mode, endpoints)[0] || null;
}

/* ------------------------------------------------------------------ respaldo */
export const FALLBACK_POLICIES = {
  off: 'No cambiar de modelo (mostrar el error)',
  same: 'El mismo modelo por otra conexión',
  any: 'Cualquier otro modelo disponible',
};
export const fallbackPolicy = () => (store.get('fallback', 'same') in FALLBACK_POLICIES ? store.get('fallback', 'same') : 'same');

/** Errores en los que es seguro reintentar en otro backend: no hubo respuesta útil y no es culpa de la petición. */
export const retriable = (e) => e?.name !== 'AbortError' && (e?.status === 0 || e?.status === 408 || e?.status === 429 || e?.status >= 500);

/** Backends de respaldo para `primary` según la política. */
export function candidates(primary, models, mode, endpoints, policy = fallbackPolicy()) {
  if (policy === 'off') return [];
  const others = models.filter((m) => modelKey(m) !== modelKey(primary));
  const same = others.filter((m) => m.id.toLowerCase() === primary.id.toLowerCase());
  if (policy === 'same') return same;
  return [...same, ...rank(others.filter((m) => !same.includes(m)), mode, endpoints)];
}

/**
 * Chat con enrutado. Reintenta en otro backend solo si falla ANTES de que llegue el primer token
 * (así nunca se mezclan dos respuestas) y solo con errores de disponibilidad (red, 429, 5xx).
 * opts: los de chatStream sin ep/model. Devuelve { text, used } (used = modelo que respondió).
 */
export async function chat(target, opts, { models = [], mode = 'chat', endpoints = [], onRoute } = {}) {
  const chain = [target, ...candidates(target, models, mode, endpoints)];
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i];
    let started = false;
    const mark = (fn) => (...a) => { started = true; return fn?.(...a); };
    const t0 = performance.now();
    try {
      const text = await chatStream({
        ...opts, ep: m.ep, model: m.id,
        onDelta: mark(opts.onDelta), onReasoning: mark(opts.onReasoning), onToolCalls: mark(opts.onToolCalls),
        onAdapt: (param) => logRoute({ kind: 'ajuste', provider: providerOf(m.ep).name, where: where(m.ep), model: m.id, msg: `el proveedor rechazó «${param}»: se reintenta sin él` }),
      });
      modelDown.delete(modelKey(m));
      logRoute({ kind: i ? 'respaldo-ok' : 'chat', provider: providerOf(m.ep).name, where: where(m.ep), model: m.id, ms: Math.round(performance.now() - t0) });
      return { text, used: m };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      const h = health.get(m.ep.id);
      if (e.status === 0) health.set(m.ep.id, { ...(h || {}), ok: false, at: Date.now(), error: redact(e.message) });
      else if (retriable(e)) modelDown.set(modelKey(m), Date.now() + DOWN_MS);
      logRoute({ kind: 'chat-error', provider: providerOf(m.ep).name, where: where(m.ep), model: m.id, status: e.status, ms: Math.round(performance.now() - t0), msg: e.message });
      const next = chain[i + 1];
      if (started || !retriable(e) || !next) throw e;
      onRoute?.({ from: m, to: next, error: e });
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ catálogo */
/**
 * Modelos de todas las conexiones, sin duplicados de un mismo Codespace: si un Jean-API-Generator
 * tiene router, sus modelos se muestran una vez (por el router) y los puertos quedan como respaldo.
 */
export function visibleModels(models) {
  const routers = models.filter((m) => healthOf(m.ep)?.router || isRouterUrl(m.ep.url));
  return models.filter((m) => {
    if (routers.includes(m)) return true;
    return !routers.some((r) => r.id.toLowerCase() === m.id.toLowerCase() && sameServer(r.ep.url, m.ep.url));
  });
}

/** Resuelve el modelo guardado ("auto", "epId|modelo" o, de versiones anteriores, solo "modelo"). */
export function resolveSaved(saved, models) {
  if (!saved || saved === AUTO) return null;
  return models.find((m) => modelKey(m) === saved) || models.find((m) => m.id.toLowerCase() === String(saved).toLowerCase()) || null;
}
