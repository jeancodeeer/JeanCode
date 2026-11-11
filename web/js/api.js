// Cliente OpenAI-compatible. Cada endpoint = { id, url, key, provider }; provider = 'jean'
// (Jean-API-Generator / llama-server) u otro de providers.js (OpenAI, OpenRouter, Groq…).
// En el escritorio las peticiones pasan por el proceso principal (sin CORS) vía window.jeancodeDesktop.
import { store } from './store.js';
import { supportsThinkToggle, wantsStreamUsage, providerOf, adapterOf } from './providers.js';
import { learnCap, reportCaps } from './capabilities.js';

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
    if (m) return maskKeys(String(m)).slice(0, 300);
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
  if (status === 403) return jean ? 'Acceso denegado (403). ¿El puerto del Codespace está como público? (jean-api.ps1 start lo hace)' : `${p.name} denegó el acceso (403): la clave no tiene permiso para ese modelo o recurso.${tail}`;
  if (status === 404) return jean && !detail ? 'No se encontró la ruta (404). La URL debe terminar en /v1.' : `No encontrado (404): la URL o el modelo no existen en ${p.name}.${tail}`;
  if (status === 429) return `${p.name} limitó las peticiones (429): espera un poco o usa otro modelo.${tail}`;
  if (status === 503 && jean) return detail ? `Jean no está listo (503): ${detail}` : 'El modelo todavía está cargando (503). Espera 2–4 minutos tras despertar el Codespace.';
  if (status >= 500) return `${p.name} tuvo un error interno (${status}). Suele ser temporal.${tail}`;
  return `${p.name} respondió ${status}.${tail}`;
}

function networkHint(ep) {
  const p = providerOf(ep);
  if (p.id === 'jean') return 'No se pudo conectar. Puede que el Codespace esté dormido, que el puerto no sea público o que la URL esté mal.';
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
  const j = getEndpoints().find((e) => (e.provider || 'jean') === 'jean' && /-8899\.|:8899(\/|$)/.test(e.url));
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

async function request(ep, path, init = {}) {
  const b = bridge();
  const timeout = init.timeout ?? ep.timeout ?? 60000;
  if (b?.http) {
    const r = await b.http({ url: ep.url + path, method: init.method || 'GET', headers: headersFor(ep), body: init.body, timeout });
    if (r.error) throw new ApiError(networkHint(ep) + ` (${r.error})`, 0, '', /a tiempo/.test(r.error) ? 'timeout' : 'network');
    if (r.status >= 400) throw new ApiError(explain(r.status, r.body, ep), r.status, serverMessage(r.body));
    try { return JSON.parse(r.body); } catch { throw notApi(ep, r.body); }
  }
  const rt = routeOf(ep, path);
  if (rt.via === 'native') return nativeRequest(ep, rt.url, { method: init.method, headers: rt.headers, body: init.body, timeout });
  let res;
  try {
    const signal = init.signal || AbortSignal.timeout(timeout);
    res = await fetch(rt.url, { ...init, headers: rt.headers, signal });
  } catch (e) {
    if (e.name === 'AbortError' && init.signal?.aborted) throw e;
    if (e.name === 'TimeoutError') throw new ApiError(`${providerOf(ep).name} no respondió a tiempo.`, 0, '', 'timeout');
    // fallo de red de un proveedor remoto desde la web: casi siempre CORS. Si hay relay o red nativa, se reintenta por ahí.
    if (rt.via === 'direct' && !init.retried && markCorsBlocked(ep)) return request(ep, path, { ...init, retried: true });
    throw new ApiError(rt.via === 'relay' ? 'No se pudo conectar con el relay de tu Jean-API-Generator: ¿el Codespace está despierto y el puerto 8899 es público?'
      : corsExposed(ep) ? `${networkHint(ep)} Si la URL es correcta, puede ser esto: ${corsHint(ep)}` : networkHint(ep), 0);
  }
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new ApiError(explain(res.status, body, ep), res.status, serverMessage(body)); }
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw notApi(ep, text); }
}

/** Modelos de un endpoint y, si es el router de Jean-API-Generator, qué puertos no están disponibles y por qué. */
export async function listModelsDetailed(ep) {
  const data = await request(ep, '/models', { timeout: ep.timeout ?? MODELS_TIMEOUT });
  if (!data || typeof data !== 'object' || !(Array.isArray(data.data) || Array.isArray(data.models))) {
    throw new ApiError(`${providerOf(ep).name} respondió, pero /models no trae una lista de modelos: no parece una API OpenAI-compatible.`, -1, '', 'format');
  }
  const ids = adapterOf(ep).models(data, ep);
  // llama-server (un puerto de Jean o uno local) informa en /props el contexto CONFIGURADO real
  // En segundo plano: la lista de modelos no espera (un servidor sin /props costaría segundos en cada recarga).
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
      // 400 que nombra un parámetro opcional: se quita y se repite (solo si aún no salió texto)
      const why = `${e.detail || ''} ${e.message || ''}`;
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

async function chatOnce({ ep, model, messages, signal, onDelta, onReasoning, onToolCalls, onUsage, temperature, think, tools }, skip = new Set()) {
  let payload = { model, messages, stream: true, temperature: temperature ?? 0.2 };
  // Modelos Qwen/Jean: sin la fase de razonamiento responden varias veces más rápido en CPU.
  // Solo llama-server entiende este parámetro; OpenAI y otros lo rechazarían.
  if (typeof think === 'boolean' && supportsThinkToggle(ep)) payload.chat_template_kwargs = { enable_thinking: think };
  // Herramientas nativas (function calling de OpenAI): el servidor interpreta la plantilla del modelo.
  if (tools?.length) payload.tools = tools;
  if (wantsStreamUsage(ep)) payload.stream_options = { include_usage: true };
  for (const k of skip) delete payload[k];
  payload = adapterOf(ep).request(payload, ep);
  const body = JSON.stringify(payload);
  let chunks = 0; // trozos con formato OpenAI recibidos (0 al final = respuesta inválida)
  const b = bridge();
  let full = '';
  let usage = null;
  const calls = []; // acumuladas por índice mientras llegan en streaming
  const handleChunk = (json) => {
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
    return full;
  };

  if (b?.stream) {
    await new Promise((resolve, reject) => {
      const id = b.stream(
        { url: ep.url + '/chat/completions', headers: headersFor(ep), body, timeout: firstByteTimeout(ep) },
        {
          onEvent: (json) => { try { handleChunk(json); } catch (e) { b.abort(id); reject(e); } },
          onDone: resolve,
          onError: (err) => reject(err.status
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
    const job = nativeRequest(ep, r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(once), timeout: firstByteTimeout(ep) });
    const stop = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    handleChunk(await Promise.race([job, stop]));
    return finish();
  };
  let rt = routeOf(ep, '/chat/completions');
  if (rt.via === 'native') return chatNative(rt);
  let res;
  const ctl = new AbortController();
  const onUserAbort = () => ctl.abort(new DOMException('aborted', 'AbortError'));
  signal?.addEventListener('abort', onUserAbort);
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), firstByteTimeout(ep));
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
    throw new ApiError(rt.via === 'relay' ? 'No se pudo conectar con el relay de tu Jean-API-Generator: ¿el Codespace está despierto y el puerto 8899 es público?'
      : corsExposed(ep) ? `${networkHint(ep)} Si la URL es correcta, puede ser esto: ${corsHint(ep)}` : networkHint(ep), 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) { const text = await res.text().catch(() => ''); throw new ApiError(explain(res.status, text, ep), res.status, serverMessage(text)); }
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

/** true si la URL es el router (:8899) de un Jean-API-Generator. */
export const isRouterUrl = (url) => new RegExp(`[-:]${ROUTER_PORT}(\\.app\\.github\\.dev)?(?=/|$)`).test(String(url));

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
      const models = await listModels({ url: c.url, key: 'local', timeout: 2500 });
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
