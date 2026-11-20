// Cliente OpenAI-compatible. Cada endpoint = { id, url, key, provider }; provider = 'jean'
// (Jean-API-Generator / llama-server) u otro de providers.js (OpenAI, OpenRouter, Groq…).
// En el escritorio las peticiones pasan por el proceso principal (sin CORS) vía window.jeancodeDesktop.
import { store } from './store.js';
import { applyReasoning } from './reasoning.js';
import { supportsThinkToggle, wantsStreamUsage, providerOf, adapterOf } from './providers.js';
import { learnCap, reportCaps, capsOf } from './capabilities.js';
import { looksBuffered } from './quality.js';

const bridge = () => (typeof window !== 'undefined' ? window.jeancodeDesktop : null);

export function normalizeUrl(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/(chat\/completions|models)$/, '');
  return u;
}

export function getEndpoints() {
  return store.get('endpoints', []);
}

export function saveEndpoints(list) {
  const b = bridge();
  if (b?.config) {
    // Escritorio: el proceso principal guarda las claves cifradas (safeStorage); el renderer
    // solo las mantiene en memoria.
    store.set('endpoints', list, false);
    b.config.save({ endpoints: list });
    return;
  }
  store.set('endpoints', list);
}

export function addEndpoint(url, key, provider = 'jean') {
  const list = getEndpoints();
  const ep = { id: crypto.randomUUID(), url: normalizeUrl(url), key: String(key).trim(), provider };
  list.push(ep);
  saveEndpoints(list);
  return ep;
}

/**
 * Error de una API, con su tipo (kind) para que el router y la interfaz decidan sin leer el texto:
 *   network  no se pudo conectar        timeout  sin respuesta a tiempo     auth   clave rechazada (401)
 *   forbidden acceso denegado (403)      model    el modelo no existe        rate   límite de uso (429)
 *   down     proveedor caído o cargando (5xx/503)   format  respuesta que no es OpenAI-compatible
 *   request  la petición no se aceptó (400/422)     aborted  el usuario lo detuvo
 */
export class ApiError extends Error {
  constructor(message, status, detail = '', kind = null) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.kind = kind || kindOf(status, detail);
  }
}

const MODEL_MISSING = /model[^.]*(not found|does not exist|not exist|no existe|unknown|invalid model|not available)|no such model|unknown model/i;
// Gemini y xAI responden 400 (no 401) a una clave inválida: se reconoce por el mensaje
const BAD_KEY = /api[ _-]?key (not valid|is invalid|invalid)|(invalid|valid) api[ _-]?key|incorrect api key|api_key_invalid|unauthenticated/i;

export function kindOf(status, detail = '') {
  if (status === 0) return 'network';
  if (status === 401 || ((status === 400 || status === 403) && BAD_KEY.test(detail))) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate';
  if (status === 408 || status === 504) return 'timeout';
  if ((status === 404 || status === 400 || status === 422) && MODEL_MISSING.test(detail)) return 'model';
  if (status === 404) return 'notfound';
  if (status >= 500) return 'down';
  if (status >= 400) return 'request';
  return 'unknown';
}

/** Cabeceras: la clave (Bearer) y lo que pida el adaptador del proveedor. La clave solo sale de aquí. */
const headersFor = (ep) => ({ ...adapterOf(ep).headers(ep), Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' });

/** Respuesta que no es JSON: casi siempre una página web o una API con otro formato. */
function notApi(ep, body) {
  const html = /<html|<!doctype/i.test(String(body || '').slice(0, 500));
  return new ApiError(html
    ? `La URL de ${providerOf(ep).name} devolvió una página web, no una API. Revisa que termine en /v1 (la URL base de la API).`
    : `La respuesta de ${providerOf(ep).name} no tiene formato OpenAI-compatible.`, -1, '', 'format');
}

/** Algunos proveedores repiten parte de la clave en el error ("Incorrect API key provided: sk-…"). */
const maskKeys = (t) => t.replace(/Bearer\s+\S+/gi, 'Bearer ***')
  .replace(/\b(sk-(?:ant-|or-|proj-)?|hf_|gsk_|xai-|fw_|csk-|jean_|AIza)[A-Za-z0-9_*.-]{4,}/g, '$1***');

/** Mensaje del servidor ({error:{message}}, {error:"..."}, {message}) sin volcar HTML ni cuerpos enormes. */
export function serverMessage(body) {
  const raw = String(body || '');
  try {
    let j = JSON.parse(raw);
    if (Array.isArray(j)) j = j[0] || {}; // Gemini envuelve el error en una lista
    const m = typeof j.error === 'string' ? j.error : (j.error?.message || j.message || j.detail);
    if (m) return maskKeys(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 300); // NVIDIA detalla los campos en una lista
  } catch { /* no es JSON */ }
  return /<html|<!doctype/i.test(raw) ? '' : maskKeys(raw).slice(0, 200);
}

/** Error claro según el proveedor (antes todo hablaba de JEAN_API_KEY, aunque fuera OpenAI). */
export function explain(status, body, ep) {
  const p = providerOf(ep);
  const jean = p.id === 'jean';
  const detail = serverMessage(body);
  const tail = detail ? ` Detalle: ${detail}` : '';
  if (status === 401 || kindOf(status, detail) === 'auth') return `${p.name} rechazó la clave (${status}). ${jean ? 'Revisa tu JEAN_API_KEY.' : `Revisa la clave (${p.keyHint}).`}`;
  if (status === 403) return jean ? 'Acceso denegado (403). Revisa que la URL sea la que imprimió tu Jean-API-Generator.' : `${p.name} denegó el acceso (403): la clave no tiene permiso para ese modelo o recurso.${tail}`;
  if (status === 404) return jean && !detail ? 'No se encontró la ruta (404). La URL debe terminar en /v1.' : `No encontrado (404): la URL o el modelo no existen en ${p.name}.${tail}`;
  if (status === 429) return `${p.name} limitó las peticiones (429): espera un poco o usa otro modelo.${tail}`;
  if (status === 503 && jean) return detail ? `Jean no está listo (503): ${detail}` : 'El modelo todavía está cargando (503). Espera 2–5 minutos tras arrancarlo.';
  if (status >= 500) return `${p.name} tuvo un error interno (${status}). Suele ser temporal.${tail}`;
  return `${p.name} respondió ${status}.${tail}`;
}

function networkHint(ep) {
  const p = providerOf(ep);
  if (p.id === 'jean') return /\.trycloudflare\.com/i.test(ep.url)
    ? 'No se pudo conectar con tu notebook de Kaggle: la sesión terminó o se reinició. Pulsa Run All otra vez y pega la URL nueva.'
    : 'No se pudo conectar con tu Jean-API-Generator. ¿Sigue corriendo? Si lo reiniciaste, la URL pudo cambiar.';
  if (p.local) return `No se pudo conectar con ${p.name}. ¿Está abierto en esta PC?`;
  return `No se pudo conectar con ${p.name}. Revisa la URL y tu conexión.`;
}

const MODELS_TIMEOUT = 12000;

/* ------------------------------------------------ APIs que bloquean el navegador (CORS)
 * El escritorio no tiene CORS (las peticiones salen del proceso principal). En la web y en las apps
 * móviles, un proveedor que no acepta llamadas de páginas web se alcanza así, en este orden:
 *   1. el relay de TU Jean-API-Generator (router :8899, /relay/<host>/...): con streaming
 *   2. en iOS/Android, la red nativa del teléfono (CapacitorHttp): sin CORS, respuesta de una vez
 * Nunca pasa por servidores de terceros. */
const LOCALISH = /^https?:\/\/(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;
export const isNativeApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
const nativeHttp = () => (isNativeApp() ? window.Capacitor?.Plugins?.CapacitorHttp : null);

/** Router de un Jean-API-Generator configurado (URL del puerto 8899) que hace de relay. */
export function relayBase() {
  const j = getEndpoints().find((e) => (e.provider || 'jean') === 'jean' && isRouterUrl(e.url));
  if (j) { try { return { origin: new URL(j.url).origin, key: j.key }; } catch { /* URL rara: se prueba el relay propio */ } }
  // sin Codespace: un relay propio (p. ej. el Cloudflare Worker de relay/worker.js), configurado en Ajustes
  const own = store.get('relay', null);
  if (own?.url && own?.key) { try { return { origin: new URL(own.url).origin, key: own.key }; } catch { return null; } }
  return null;
}

/** ¿Este endpoint puede verse bloqueado por CORS aquí? (solo web/app, solo proveedores remotos). */
const corsExposed = (ep) => !bridge()?.http && providerOf(ep).id !== 'jean' && !providerOf(ep).local && !LOCALISH.test(ep.url);
/** ¿Hay que esquivar CORS para este endpoint? (el proveedor lo bloquea, o ya se vio fallar). */
const needsBypass = (ep) => corsExposed(ep) && (providerOf(ep).browser === false || ep.corsBlocked === true);

/** URL y cabeceras de una petición: directa o por el relay. */
export function routeOf(ep, path) {
  const direct = { url: ep.url + path, headers: headersFor(ep), via: 'direct' };
  if (!needsBypass(ep)) return direct;
  const r = relayBase();
  if (r) {
    const u = new URL(ep.url + path);
    return { url: `${r.origin}/relay/${u.host}${u.pathname}${u.search}`, headers: { ...headersFor(ep), 'X-Jean-Key': r.key }, via: 'relay' };
  }
  if (nativeHttp()) return { ...direct, via: 'native' };
  return direct;
}

/** Recuerda que un proveedor bloquea el navegador (tras un fallo de red con alternativa disponible). */
function markCorsBlocked(ep) {
  if (!corsExposed(ep) || ep.corsBlocked || !(relayBase() || nativeHttp())) return false;
  ep.corsBlocked = true;
  const list = getEndpoints().map((e) => (e.id === ep.id ? { ...e, corsBlocked: true } : e));
  saveEndpoints(list);
  return true;
}

/** Petición por la red nativa del teléfono (sin CORS, sin streaming). */
async function nativeRequest(ep, url, { method = 'GET', headers, body, timeout }) {
  let r;
  try {
    r = await nativeHttp().request({ url, method, headers, data: body ? JSON.parse(body) : undefined, connectTimeout: timeout, readTimeout: timeout, responseType: 'json' });
  } catch (e) {
    throw new ApiError(networkHint(ep) + ` (${e.message || e})`, 0);
  }
  const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
  if (r.status >= 400) throw new ApiError(explain(r.status, text, ep), r.status, serverMessage(text));
  if (typeof r.data === 'object' && r.data) return r.data;
  try { return JSON.parse(text); } catch { throw notApi(ep, text); }
}

/** Mensaje claro cuando un proveedor bloquea el navegador y no hay forma de esquivarlo aquí. */
function corsHint(ep) {
  return `${providerOf(ep).name} no acepta llamadas desde una página web (CORS). Soluciones: añade tu Jean-API-Generator (URL del puerto 8899) en Ajustes y JeanCode usará su relay, o usa la app de escritorio o la de móvil.`;
}

/** Google pide la clave en su propia cabecera: `auth` sustituye a la de Bearer. */
const withAuth = (headers, auth, extra) => {
  if (!auth) return extra ? { ...headers, ...extra } : headers;
  const { Authorization: _bearer, ...rest } = headers;
  return { ...rest, ...auth, ...extra };
};

async function request(ep, path, init = {}) {
  const b = bridge();
  const timeout = init.timeout ?? ep.timeout ?? 60000;
  if (b?.http) {
    const r = await b.http({ url: ep.url + path, method: init.method || 'GET', headers: withAuth(headersFor(ep), init.auth, init.headers), body: init.body, timeout });
    if (r.error) throw new ApiError(networkHint(ep) + ` (${r.error})`, 0, '', /a tiempo/.test(r.error) ? 'timeout' : 'network');
    if (r.status >= 400) throw new ApiError(explain(r.status, r.body, ep), r.status, serverMessage(r.body));
    try { return JSON.parse(r.body); } catch { throw notApi(ep, r.body); }
  }
  const rt = routeOf(ep, path);
  rt.headers = withAuth(rt.headers, init.auth, init.headers);
  if (rt.via === 'native') return nativeRequest(ep, rt.url, { method: init.method, headers: rt.headers, body: init.body, timeout });
  let res;
  try {
    const signal = init.signal || AbortSignal.timeout(timeout);
    const { auth: _auth, timeout: _timeout, retried: _retried, ...opts } = init;
    res = await fetch(rt.url, { ...opts, headers: rt.headers, signal });
  } catch (e) {
    if (e.name === 'AbortError' && init.signal?.aborted) throw e;
    if (e.name === 'TimeoutError') throw new ApiError(`${providerOf(ep).name} no respondió a tiempo.`, 0, '', 'timeout');
    // fallo de red de un proveedor remoto desde la web: casi siempre CORS. Si hay relay o red nativa, se reintenta por ahí.
    if (rt.via === 'direct' && !init.retried && markCorsBlocked(ep)) return request(ep, path, { ...init, retried: true });
    throw new ApiError(rt.via === 'relay' ? 'No se pudo conectar con el relay de tu Jean-API-Generator: ¿sigue corriendo y la URL es la última que imprimió?'
      : corsExposed(ep) ? `${networkHint(ep)} Si la URL es correcta, puede ser esto: ${corsHint(ep)}` : networkHint(ep), 0);
  }
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new ApiError(explain(res.status, body, ep), res.status, serverMessage(body)); }
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw notApi(ep, text); }
}

/**
 * ¿Apunta a este equipo o a una red privada? Se mira el host ya interpretado por URL, nunca el texto: así
 * `http://usuario@127.0.0.1/`, `localhost.` o `2130706433` no se cuelan.
 */
export function isPrivateTarget(url) {
  let u;
  try { u = url instanceof URL ? url : new URL(url); } catch { return true; }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h.includes(':')) return /^(::|f[cd]|fe[89ab]|ff|64:ff9b:|2002:)/.test(h);
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return !h || /(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(h);
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 100 && b >= 64 && b <= 127);
}

/** Llamada JSON a la API de imagen o vídeo de un proveedor. base = otra raíz del mismo proveedor (…/v2). */
export function mediaCall(ep, path, { method = 'GET', body, base, auth, headers, timeout = 300000, signal } = {}) {
  const job = request(base ? { ...ep, url: base } : ep, path, { method, body: body === undefined ? undefined : JSON.stringify(body), auth, headers, timeout, signal });
  if (!signal) return job;
  // el puente del escritorio y la red nativa no se cancelan a medias: Parar responde igualmente al momento
  return Promise.race([job, new Promise((_, reject) => {
    const stop = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
  })]);
}

/** POST que responde con el archivo (Hugging Face). */
export async function mediaBytes(ep, path, { body, base, timeout = 300000, signal } = {}) {
  const url = `${base || ep.url}${path}`;
  const headers = { ...headersFor(ep), Accept: 'image/png' };
  const payload = JSON.stringify(body);
  const fail = (status, text) => new ApiError(explain(status, text, ep), status, serverMessage(text));
  const toBlob = (b64, type) => { const bin = atob(String(b64).replace(/\s/g, '')); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type }); };
  const b = bridge();
  if (b?.http) {
    const r = await b.http({ url, method: 'POST', headers, body: payload, timeout, binary: true, publicOnly: !isPrivateTarget(url) });
    if (r.error) throw new ApiError(networkHint(ep) + ` (${r.error})`, 0);
    if (r.status >= 400) throw fail(r.status, r.b64 ? atob(r.b64) : '');
    return toBlob(r.b64, r.type || 'image/jpeg');
  }
  const native = nativeHttp();
  if (native) {
    const r = await native.request({ url, method: 'POST', headers, data: body, responseType: 'blob', connectTimeout: 30000, readTimeout: timeout });
    if (r.status >= 400) throw fail(r.status, typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
    return toBlob(r.data, r.headers?.['Content-Type'] || r.headers?.['content-type'] || 'image/jpeg');
  }
  const res = await fetch(url, { method: 'POST', headers, body: payload, signal });
  if (!res.ok) throw fail(res.status, await res.text().catch(() => ''));
  return res.blob();
}

/**
 * Descarga un resultado → Blob. La clave solo viaja si el archivo está en el MISMO origen que la API: las URL las
 * escribe el proveedor y una ajena no debe recibirla nunca. auth: true (Bearer) u { cabecera: true } (clave en esa cabecera).
 */
export async function fetchMediaBlob(ep, url, { auth = false, authHost = '', mime = '', signal } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new ApiError('El proveedor devolvió una URL de descarga no válida.', -1, '', 'format'); }
  // un proveedor remoto no puede hacer que la app lea tu red local; se repite en cada redirección
  const remoteApi = !isPrivateTarget(ep.url);
  const refuse = (x) => {
    if (!['https:', 'http:'].includes(x.protocol) || x.username || x.password) throw new ApiError('El proveedor devolvió una URL de descarga no válida.', -1, '', 'format');
    if (remoteApi && isPrivateTarget(x)) throw new ApiError('El proveedor devolvió una dirección de tu red local: no se descarga.', -1, '', 'forbidden');
  };
  refuse(u);
  const same = u.origin === new URL(ep.url).origin || (authHost && (u.hostname === authHost || u.hostname.endsWith(`.${authHost}`)));
  const headers = !auth || !same ? {} : auth === true ? { Authorization: `Bearer ${ep.key}` } : Object.fromEntries(Object.keys(auth).map((k) => [k, ep.key]));
  const fromB64 = (b64, type) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || mime });
  };
  const b = bridge();
  if (b?.http) {
    const r = await b.http({ url, method: 'GET', headers, timeout: 600000, binary: true, publicOnly: remoteApi });
    if (r.error) throw new ApiError(`No se pudo descargar el resultado (${r.error}).`, 0);
    if (r.status >= 400) throw new ApiError(`No se pudo descargar el resultado (${r.status}).`, r.status);
    return fromB64(r.b64, r.type);
  }
  const native = nativeHttp();
  // Android: el DNS del teléfono se comprueba en cada salto y la conexión va a esas IP (plugin JeanDevice, sin Shizuku)
  const device = native && window.Capacitor?.getPlatform?.() === 'android' ? window.Capacitor.Plugins?.JeanDevice : null;
  if (device?.fetch) {
    let at = u;
    let sent = headers;
    for (let hop = 0; hop <= 5; hop++) {
      const host = at.hostname.replace(/^\[|\]$/g, '');
      const literal = /^[\d.]+$/.test(host) || host.includes(':');
      const addresses = literal ? [host] : (await device.resolve({ host })).addresses || [];
      if (remoteApi && addresses.some((a) => isPrivateTarget(`http://${a.includes(':') ? `[${a}]` : a}/`))) refuse(new URL('http://localhost/'));
      const r = await device.fetch({ url: at.href, addresses, headers: sent, binary: true });
      if (r.status >= 300 && r.status < 400 && r.location) {
        const next = new URL(r.location, at);
        refuse(next);
        if (next.origin !== at.origin) sent = {};
        at = next;
        continue;
      }
      if (r.status >= 400) throw new ApiError(`No se pudo descargar el resultado (${r.status}).`, r.status);
      return fromB64(r.b64, r.type);
    }
    throw new ApiError('Demasiadas redirecciones al descargar el resultado.', -1, '', 'format');
  }
  // iPhone: una URL ajena se pide como en la web (el navegador no deja leer una red privada); solo la API propia va por la red nativa
  if (native && !auth) {
    // sin seguir redirecciones: si la hay, el archivo se muestra por su enlace, sin que la app lea la respuesta
    const res = await fetch(url, { signal, redirect: 'error' });
    if (!res.ok) throw new ApiError(`No se pudo descargar el resultado (${res.status}).`, res.status);
    return res.blob();
  }
  if (native) {
    // las redirecciones se siguen a mano para comprobar cada destino; la clave no cambia de origen
    let r;
    let at = u;
    let sent = headers;
    for (let hop = 0; ; hop++) {
      r = await native.request({ url: at.href, method: 'GET', headers: sent, responseType: 'blob', connectTimeout: 30000, readTimeout: 600000, disableRedirects: true });
      const loc = r.status >= 300 && r.status < 400 ? (r.headers?.Location || r.headers?.location) : null;
      if (!loc) break;
      if (hop >= 5) throw new ApiError('Demasiadas redirecciones al descargar el resultado.', -1, '', 'format');
      const next = new URL(loc, at);
      refuse(next);
      if (next.origin !== at.origin) sent = {};
      at = next;
    }
    if (r.status >= 400) throw new ApiError(`No se pudo descargar el resultado (${r.status}).`, r.status);
    return fromB64(String(r.data).replace(/\s/g, ''), r.headers?.['Content-Type'] || r.headers?.['content-type']);
  }
  // una URL ajena no sigue redirecciones (el navegador no deja comprobarlas antes); la de tu API sí, y se revisa su destino
  const res = await fetch(url, { headers, signal, redirect: auth ? 'follow' : 'error' });
  if (res.url) refuse(new URL(res.url));
  if (!res.ok) throw new ApiError(`No se pudo descargar el resultado (${res.status}).`, res.status);
  return res.blob();
}

/** Servidores solo de imagen: sus modelos instalados (locales) o los que publica el proveedor. */
async function mediaOnlyModels(ep, prov) {
  const timeout = ep.timeout ?? MODELS_TIMEOUT;
  if (prov.id === 'a1111') return (await request(ep, '/sdapi/v1/sd-models', { timeout })).map((m) => m.title || m.model_name).filter(Boolean);
  if (prov.id === 'comfyui') return (await request(ep, '/object_info/CheckpointLoaderSimple', { timeout }))?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  return (prov.media || []).map(([id]) => id);
}

/** Modelos de un endpoint y, si es el router de Jean-API-Generator, qué puertos no están disponibles y por qué. */
export async function listModelsDetailed(ep) {
  const prov = providerOf(ep);
  if (prov.mediaOnly) return { ids: await mediaOnlyModels(ep, prov), router: false, unavailable: [] };
  const data = await request(ep, '/models', { timeout: ep.timeout ?? MODELS_TIMEOUT });
  if (!data || typeof data !== 'object' || !(Array.isArray(data) || Array.isArray(data.data) || Array.isArray(data.models))) {
    throw new ApiError(`${providerOf(ep).name} respondió, pero /models no trae una lista de modelos: no parece una API OpenAI-compatible.`, -1, '', 'format');
  }
  const ids = adapterOf(ep).models(data, ep);
  // llama-server (un puerto de Jean o uno local) informa en /props el contexto CONFIGURADO real
  // En segundo plano: la lista de modelos no espera (un servidor sin /props costaría segundos en cada recarga).
  learnLocalModels(ep, ids);
  if (!data.jean?.router && (providerOf(ep).id === 'jean' || /llama/i.test(data.data?.[0]?.owned_by || ''))) {
    request({ ...ep, url: ep.url.replace(/\/v1$/, '') }, '/props', { timeout: 5000 }).then((props) => {
      const n = props?.default_generation_settings?.n_ctx || props?.n_ctx;
      if (n) for (const id of ids) reportCaps(ep, id, { context: Number(n) });
    }).catch(() => { /* servidor sin /props: el contexto queda desconocido */ });
  }
  return {
    ids,
    router: !!data.jean?.router,
    unavailable: Array.isArray(data.jean?.unavailable) ? data.jean.unavailable : [],
  };
}

/**
 * Lo que un servidor local sabe de sus modelos (contexto real, herramientas, visión). En segundo plano: la lista no espera.
 */
function learnLocalModels(ep, ids) {
  const prov = providerOf(ep);
  const root = { ...ep, url: ep.url.replace(/\/v1\/?$/, '') };
  if (prov.id === 'ollama') {
    for (const model of ids.slice(0, 40)) {
      request(root, '/api/show', { method: 'POST', body: JSON.stringify({ model }), timeout: 5000 }).then((j) => {
        const caps = Array.isArray(j.capabilities) ? j.capabilities : null;
        const max = Object.entries(j.model_info || {}).find(([k]) => k.endsWith('.context_length'))?.[1];
        reportCaps(ep, model, { ...(Number(max) ? { context: Number(max) } : {}), ...(caps ? { tools: caps.includes('tools'), vision: caps.includes('vision'), reasoning: caps.includes('thinking'), chat: caps.includes('completion'), embeddings: caps.includes('embedding') } : {}) });
      }).catch(() => { /* versión antigua de Ollama: se queda lo que se sabía */ });
    }
  }
  if (prov.id === 'lmstudio') {
    request(root, '/api/v0/models', { timeout: 5000 }).then((j) => {
      for (const m of j.data || []) reportCaps(ep, m.id, { context: m.loaded_context_length || m.max_context_length || null, vision: m.type === 'vlm', chat: m.type !== 'embeddings', embeddings: m.type === 'embeddings', tools: Array.isArray(m.capabilities) ? m.capabilities.includes('tool_use') : null });
    }).catch(() => { /* LM Studio sin la API v0 */ });
  }
}

/* ------------------------------------------------ Ollama por su API propia
 * Por /v1 no se puede elegir el tamaño del contexto: con menos de 24 GB de VRAM queda en 4096 y recorta las conversaciones
 * sin avisar. Por /api/chat se pide el que hace falta, en escalones para no recargar el modelo en cada mensaje. */
const CTX_STEPS = [8192, 16384, 32768, 65536, 131072];
const ctxUsed = new Map();
export function ollamaContext(ep, model, tokens, max = null) {
  const key = `${ep.id}|${model}`;
  const want = CTX_STEPS.find((n) => n >= tokens * 1.35 + 2048) || CTX_STEPS[CTX_STEPS.length - 1];
  const size = Math.max(ctxUsed.get(key) || 0, want);
  const out = max ? Math.min(size, max) : size;
  ctxUsed.set(key, out);
  return out;
}
/** Petición OpenAI → /api/chat de Ollama. */
export function toOllamaChat(payload, { numCtx, thinking = null } = {}) {
  const messages = payload.messages.map((m) => {
    const out = { role: m.role, content: typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n') };
    const images = Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').map((p) => String(p.image_url?.url || '').replace(/^data:[^,]*,/, '')) : [];
    if (images.length) out.images = images;
    if (m.tool_calls?.length) out.tool_calls = m.tool_calls.map((c) => { let args = {}; try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* se envía vacío */ } return { function: { name: c.function?.name, arguments: args } }; });
    return out;
  });
  return { model: payload.model, messages, stream: true, keep_alive: '30m', options: { num_ctx: numCtx, ...(payload.temperature != null ? { temperature: payload.temperature } : {}) }, ...(payload.tools?.length ? { tools: payload.tools } : {}), ...(thinking === null ? {} : { think: thinking }) };
}
/** Línea de /api/chat → el mismo trozo que da la API de OpenAI. */
export function fromOllamaChunk(j) {
  if (j.error) return { error: j.error };
  const m = j.message || {};
  const delta = { ...(m.content ? { content: m.content } : {}), ...(m.thinking ? { reasoning_content: m.thinking } : {}) };
  if (m.tool_calls?.length) delta.tool_calls = m.tool_calls.map((c, index) => ({ index, id: `call_${index}`, function: { name: c.function?.name, arguments: JSON.stringify(c.function?.arguments ?? {}) } }));
  return { choices: [{ delta }], ...(j.done ? { usage: { prompt_tokens: j.prompt_eval_count || 0, completion_tokens: j.eval_count || 0 } } : {}) };
}

export async function listModels(ep) {
  return (await listModelsDetailed(ep)).ids;
}

/** Prueba un endpoint; si falla con 404 y no termina en /v1, reintenta añadiéndolo. */
export async function probe(url, key, provider = 'jean') {
  const ep = { url: normalizeUrl(url), key: String(key).trim(), provider };
  try {
    return { url: ep.url, models: await listModels(ep) };
  } catch (e) {
    if ((e.status === 404 || e.status === 0) && !/\/v1$/.test(ep.url)) {
      const alt = { ...ep, url: ep.url + '/v1' };
      try { return { url: alt.url, models: await listModels(alt) }; } catch { throw e; }
    }
    throw e;
  }
}

/* Parámetros que algunos proveedores/modelos rechazan con 400 (p. ej. temperatura en modelos de
   razonamiento de OpenAI). Si el 400 nombra uno, se reintenta sin él y se recuerda en la sesión. */
const DROPPABLE = [
  { key: 'temperature', re: /temperature/i },
  { key: 'stream_options', re: /stream_options|include_usage/i },
  { key: 'chat_template_kwargs', re: /chat_template_kwargs|enable_thinking/i },
  { key: 'reasoning_effort', re: /reasoning_effort/i },
  { key: 'reasoning', re: /\breasoning\b/i },
  { key: 'thinking', re: /\bthinking\b|budget_tokens/i },
  { key: 'enable_thinking', re: /enable_thinking/i },
];
const dropped = new Map(); // `${ep.id}|${model}` -> Set de parámetros a omitir
export const droppedParams = (ep, model) => [...(dropped.get(`${ep.id}|${model}`) || [])];

/**
 * Chat en streaming. onDelta(texto), onReasoning(texto). Devuelve el texto completo.
 * El razonamiento de Qwen puede llegar como reasoning_content o dentro de <think>…</think>.
 */
export async function chatStream(opts) {
  const { ep, model } = opts;
  const key = `${ep.id}|${model}`;
  for (let tries = 0; ; tries++) {
    let streamed = false;
    const mark = (fn) => fn && ((...a) => { streamed = true; return fn(...a); });
    try {
      return await chatOnce({ ...opts, onDelta: mark(opts.onDelta), onReasoning: mark(opts.onReasoning) }, dropped.get(key));
    } catch (e) {
      if (e.ollamaLegacy) { ollamaLegacy.add(ep.id); continue; }
      // 400 que nombra un parámetro opcional: se quita y se repite (solo si aún no salió texto)
      const why = `${e.detail || ''} ${e.message || ''}`;
      // un modelo que no ve imágenes: se recuerda y se explica, en vez de un 400 incomprensible
      if ([400, 422].includes(e.status) && opts.messages?.some((m) => Array.isArray(m.content)) && /image|vision|multi-?modal|image_url|content.*(array|list|string)/i.test(why)) {
        learnCap(ep, model, { vision: false });
        throw new ApiError(`${model} no acepta imágenes. Elige un modelo con visión o quita la imagen adjunta.`, e.status, e.detail, 'request');
      }
      if (e.status === 400 && opts.tools?.length && /tool|function/i.test(why)) learnCap(ep, model, { tools: false });
      const drop = e.status === 400 && !streamed && tries < DROPPABLE.length
        && DROPPABLE.find((d) => d.re.test(why) && !dropped.get(key)?.has(d.key));
      if (!drop) throw e;
      if (!dropped.has(key)) dropped.set(key, new Set());
      dropped.get(key).add(drop.key);
      opts.onAdapt?.(drop.key, e);
    }
  }
}

/** Espera máxima hasta que el servidor responde (cabeceras). En CPU (Jean, local) leer un contexto largo tarda. */
export const firstByteTimeout = (ep) => (providerOf(ep).id === 'jean' || providerOf(ep).local || /localhost|127\.0\.0\.1/.test(ep.url) ? 900000 : 120000);

const ollamaLegacy = new Set(); // servidores detrás de un proxy que solo expone /v1
async function chatOnce({ ep, model, messages, signal, onDelta, onReasoning, onToolCalls, onUsage, temperature, think, reasoning, tools, firstByteMs }, skip = new Set()) {
  const waitFirst = firstByteMs || firstByteTimeout(ep); // un trabajo largo (escribir una composición) puede pedir más margen
  let payload = { model, messages, stream: true, temperature: temperature ?? 0.2 };
  // Modo de razonamiento elegido (NORMAL / PENSAR / ESFUERZO): cada proveedor lo pide a su manera (reasoning.js)
  if (reasoning) payload = applyReasoning(payload, ep, model, reasoning, capsOf(ep, model));
  // Llamadas internas con think:false (resúmenes, pruebas): solo llama-server entiende este parámetro.
  else if (typeof think === 'boolean' && supportsThinkToggle(ep)) payload.chat_template_kwargs = { enable_thinking: think };
  // Herramientas nativas (function calling de OpenAI): el servidor interpreta la plantilla del modelo.
  if (tools?.length) payload.tools = tools;
  if (wantsStreamUsage(ep)) payload.stream_options = { include_usage: true };
  for (const k of skip) delete payload[k];
  payload = adapterOf(ep).request(payload, ep);
  // Ollama: API propia para poder elegir el contexto (en el móvil, la red nativa sigue por /v1)
  const useOllama = providerOf(ep).id === 'ollama' && !nativeHttp() && !ollamaLegacy.has(ep.id);
  const caps = useOllama ? capsOf(ep, model) : null;
  const tokensNow = useOllama ? Math.round(JSON.stringify(messages).length / 3.6) + Math.round(JSON.stringify(tools || []).length / 3.6) : 0;
  const body = useOllama
    ? JSON.stringify(toOllamaChat(payload, { numCtx: ollamaContext(ep, model, tokensNow, caps.context), thinking: caps.reasoning === true ? (typeof think === 'boolean' ? think : !!(reasoning && reasoning !== 'normal')) : null }))
    : JSON.stringify(payload);
  const chatUrl = useOllama ? `${ep.url.replace(/\/v1\/?$/, '')}/api/chat` : `${ep.url}/chat/completions`;
  let chunks = 0; // trozos con formato OpenAI recibidos (0 al final = respuesta inválida)
  const b = bridge();
  let full = '';
  let usage = null;
  const calls = []; // acumuladas por índice mientras llegan en streaming
  // detección de un proxy que almacena el streaming: los trozos llegan todos juntos al final
  const t0 = Date.now();
  const arrivals = [];
  const handleChunk = (raw) => {
    const json = useOllama ? fromOllamaChunk(raw) : raw;
    const now = Date.now();
    if (!arrivals.length || now - arrivals[arrivals.length - 1] > 50) arrivals.push(now);
    // consumo: estándar OpenAI (usage) o llama-server (timings), normalmente en el último trozo
    if (json.usage?.prompt_tokens != null || json.usage?.completion_tokens != null) {
      usage = { prompt: json.usage.prompt_tokens || 0, completion: json.usage.completion_tokens || 0 };
    } else if (json.timings?.prompt_n != null) {
      usage = { prompt: (json.timings.prompt_n || 0) + (json.timings.cache_n || 0), completion: json.timings.predicted_n || 0,
        tps: json.timings.predicted_per_second };
    }
    if (json.error) {
      const msg = typeof json.error === 'string' ? json.error : (json.error.message || 'error del proveedor');
      const code = Number(json.error.code) || 0;
      throw new ApiError(msg, code >= 400 ? code : 0, msg, code >= 400 ? null : 'down');
    }
    if (json.choices || json.usage || json.timings) chunks++;
    const d = json.choices?.[0]?.delta || json.choices?.[0]?.message || {};
    // tolerante: cada proveedor nombra distinto el razonamiento
    const think = d.reasoning_content ?? d.reasoning ?? d.thinking;
    if (typeof think === 'string' && think) onReasoning?.(think);
    if (typeof d.content === 'string' && d.content) { full += d.content; onDelta?.(d.content); }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? calls.length;
      calls[i] ||= { id: '', name: '', arguments: '' };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].name += tc.function.name;
      if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
    }
  };
  const finish = () => {
    if (!chunks) throw new ApiError(`${providerOf(ep).name} terminó sin enviar una respuesta con formato OpenAI (streaming).`, -1, '', 'format');
    if (calls.length) onToolCalls?.(calls.filter(Boolean));
    if (usage) onUsage?.(usage);
    if (typeof window !== 'undefined' && arrivals.length && looksBuffered({ firstByteMs: arrivals[0] - t0, totalMs: Date.now() - t0, reads: arrivals.length, chars: full.length })) {
      window.dispatchEvent(new CustomEvent('jc:buffered', { detail: { where: providerOf(ep).name } }));
    }
    return full;
  };

  if (b?.stream) {
    await new Promise((resolve, reject) => {
      const id = b.stream(
        { url: chatUrl, headers: headersFor(ep), body, timeout: waitFirst, ndjson: useOllama },
        {
          onEvent: (json) => { try { handleChunk(json); } catch (e) { b.abort(id); reject(e); } },
          onDone: resolve,
          onError: (err) => reject(useOllama && err.status === 404 && !/model/i.test(err.body || '') ? Object.assign(new Error('sin /api/chat'), { ollamaLegacy: true }) : err.status
            ? new ApiError(explain(err.status, err.body, ep), err.status, serverMessage(err.body))
            : err.timeout ? new ApiError(`${providerOf(ep).name} no empezó a responder a tiempo.`, 0, '', 'timeout')
              : new ApiError(networkHint(ep) + (err.message ? ` (${err.message})` : ''), 0)),
        },
      );
      signal?.addEventListener('abort', () => { b.abort(id); reject(new DOMException('aborted', 'AbortError')); });
    });
    return finish();
  }

  // red nativa del teléfono: sin streaming, la respuesta llega completa (el usuario puede detener igual)
  const chatNative = async (r) => {
    const once = { ...payload, stream: false };
    delete once.stream_options;
    const job = nativeRequest(ep, r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(once), timeout: waitFirst });
    const stop = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    handleChunk(await Promise.race([job, stop]));
    return finish();
  };
  let rt = useOllama ? { url: chatUrl, headers: headersFor(ep), via: 'direct' } : routeOf(ep, '/chat/completions');
  if (rt.via === 'native') return chatNative(rt);
  let res;
  const ctl = new AbortController();
  const onUserAbort = () => ctl.abort(new DOMException('aborted', 'AbortError'));
  signal?.addEventListener('abort', onUserAbort);
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), waitFirst);
  try {
    try {
      res = await fetch(rt.url, { method: 'POST', signal: ctl.signal, body, headers: rt.headers });
    } catch (e) {
      // CORS: un reintento por el relay o la red nativa, si existen
      if (signal?.aborted || ctl.signal.aborted || rt.via !== 'direct' || !markCorsBlocked(ep)) throw e;
      rt = routeOf(ep, '/chat/completions');
      if (rt.via === 'native') return await chatNative(rt);
      res = await fetch(rt.url, { method: 'POST', signal: ctl.signal, body, headers: rt.headers });
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (ctl.signal.reason?.name === 'TimeoutError') throw new ApiError(`${providerOf(ep).name} no empezó a responder a tiempo.`, 0, '', 'timeout');
    throw new ApiError(rt.via === 'relay' ? 'No se pudo conectar con el relay de tu Jean-API-Generator: ¿sigue corriendo y la URL es la última que imprimió?'
      : corsExposed(ep) ? `${networkHint(ep)} Si la URL es correcta, puede ser esto: ${corsHint(ep)}` : networkHint(ep), 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (useOllama && res.status === 404 && !/model/i.test(text)) throw Object.assign(new Error('sin /api/chat'), { ollamaLegacy: true });
    throw new ApiError(explain(res.status, text, ep), res.status, serverMessage(text));
  }
  if (/text\/html/i.test(res.headers.get('content-type') || '')) throw notApi(ep, '<html>');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (useOllama) { if (line) { let row = null; try { row = JSON.parse(line); } catch { /* línea parcial */ } if (row) handleChunk(row); } continue; }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return finish();
      let json = null;
      try { json = JSON.parse(data); } catch { /* línea parcial */ }
      if (json) handleChunk(json); // los errores del proveedor sí se propagan
    }
  }
  return finish();
}

// Jean-API-Generator sirve un modelo por puerto: Grey :8888, Marvel :8889, Fénix :8890, y el router
// (todos los modelos en una URL) en :8899.
const JEAN_PORTS = ['8899', '8888', '8889', '8890'];
export const ROUTER_PORT = '8899';
/** launch.py usa el 8899; si está ocupado, pasa al 9899 y sigue (9900, 9901...). */
const FALLBACK_ROUTER_PORT = /:(9899|99\d\d)(?=\/|$)/;

/** URLs de los otros puertos del mismo servidor (Codespaces "-8888.app.github.dev" o host:8888). */
export function siblingUrls(url) {
  const out = [];
  for (const re of [/-(8888|8889|8890|8899)(\.app\.github\.dev)/, /:(8888|8889|8890|8899)(?=\/|$)/]) {
    const m = url.match(re);
    if (!m) continue;
    for (const p of JEAN_PORTS) {
      if (p === m[1]) continue;
      out.push(url.replace(re, re.source.startsWith('-') ? `-${p}$2` : `:${p}`));
    }
    break;
  }
  return out;
}

/** true si la URL es el router de un Jean-API-Generator: el túnel de Kaggle (….trycloudflare.com), el puerto 8899
 * o el de respaldo de launch.py (9899 en adelante) cuando el 8899 estaba ocupado. */
export const isRouterUrl = (url) => /^https:\/\/[a-z0-9-]+\.trycloudflare\.com(\/|$)/i.test(String(url))
  || new RegExp(`[-:]${ROUTER_PORT}(\\.app\\.github\\.dev)?(?=/|$)`).test(String(url))
  || FALLBACK_ROUTER_PORT.test(String(url));

/**
 * Completa la conexión a un Jean-API-Generator. Si el router (:8899) responde, basta con él: una URL,
 * todos los modelos (incluidos los GGUF de Hugging Face cargados en el Codespace). Si no (Codespace
 * con una versión anterior), se agregan los puertos de modelo que respondan. Devuelve los modelos nuevos.
 */
export async function discoverSiblings(baseUrl, key) {
  const known = new Set(getEndpoints().map((e) => e.url));
  const urls = siblingUrls(normalizeUrl(baseUrl)).filter((u) => !known.has(u));
  const router = urls.find(isRouterUrl);
  if (router) {
    try {
      const r = await listModelsDetailed({ url: router, key, provider: 'jean', timeout: 8000 });
      if (r.router) { addEndpoint(router, key, 'jean'); return r.ids; }
    } catch { /* Codespace sin router: se usan los puertos */ }
  }
  if (isRouterUrl(baseUrl) || getEndpoints().some((e) => isRouterUrl(e.url) && sameServer(e.url, baseUrl))) return [];
  const found = [];
  await Promise.all(urls.filter((u) => !isRouterUrl(u)).map(async (u) => {
    try {
      const models = await listModels({ url: u, key, provider: 'jean', timeout: 8000 });
      if (models.length) found.push({ url: u, models });
    } catch { /* ese puerto no tiene modelo: normal */ }
  }));
  for (const f of found.sort((a, b) => a.url.localeCompare(b.url))) addEndpoint(f.url, key, 'jean');
  return found.flatMap((f) => f.models);
}

/** Dos URLs del mismo Codespace/servidor que solo cambian de puerto. */
export function sameServer(a, b) {
  const base = (u) => String(u).replace(/-(8888|8889|8890|8899)(\.app\.github\.dev)/, '-*$2').replace(/:(8888|8889|8890|8899)(?=\/|$)/, ':*');
  return base(a) === base(b);
}

/** Prueba en paralelo los servidores locales conocidos (Ollama, LM Studio, llama.cpp…). */
export async function detectLocal(candidates) {
  return Promise.all(candidates.map(async (c) => {
    try {
      const models = await listModels({ id: `detect:${c.url}`, url: c.url, key: 'local', provider: c.provider, timeout: 2500 });
      return { ...c, models };
    } catch (e) {
      return { ...c, models: null, error: e.message };
    }
  }));
}

/** Descarga un modelo con Ollama (POST /api/pull). onProgress(texto, fracción 0-1). */
export async function ollamaPull(name, onProgress) {
  const url = 'http://localhost:11434/api/pull';
  const b = bridge();
  if (b?.http) {
    // escritorio: sin CORS; respuesta única al terminar
    onProgress?.('descargando… (puede tardar varios minutos)', null);
    const r = await b.http({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, stream: false }), timeout: 3600000 });
    if (r.error) throw new Error('Ollama no responde en localhost:11434. ¿Está abierto?');
    const j = JSON.parse(r.body || '{}');
    if (r.status >= 400 || j.error) throw new Error(j.error || `Ollama respondió ${r.status}`);
    return;
  }
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, stream: true }) });
  } catch {
    throw new Error('No se pudo hablar con Ollama desde la web: ábrelo con OLLAMA_ORIGINS=* o usa la app de escritorio.');
  }
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      onProgress?.(j.status || '', j.total ? (j.completed || 0) / j.total : null);
    }
  }
}

/** Clave aleatoria segura (256 bits, base64url) para usar como JEAN_API_KEY. */
export function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'jean_' + b64;
}
