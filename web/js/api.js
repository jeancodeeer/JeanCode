// Cliente OpenAI-compatible. Cada endpoint = { id, url, key, provider }; provider = 'jean'
// (Jean-API-Generator / llama-server) u otro de providers.js (OpenAI, OpenRouter, Groq…).
// En el escritorio las peticiones pasan por el proceso principal (sin CORS) vía window.jeancodeDesktop.
import { store } from './store.js';
import { supportsThinkToggle, wantsStreamUsage, providerOf } from './providers.js';

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

export class ApiError extends Error {
  constructor(message, status, detail = '') { super(message); this.status = status; this.detail = detail; }
}

const headersFor = (ep) => ({ Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' });

/** Mensaje del servidor ({error:{message}}, {error:"..."}, {message}) sin volcar HTML ni cuerpos enormes. */
export function serverMessage(body) {
  const raw = String(body || '');
  try {
    const j = JSON.parse(raw);
    const m = typeof j.error === 'string' ? j.error : (j.error?.message || j.message || j.detail);
    if (m) return String(m).slice(0, 300);
  } catch { /* no es JSON */ }
  return /<html|<!doctype/i.test(raw) ? '' : raw.slice(0, 200);
}

/** Error claro según el proveedor (antes todo hablaba de JEAN_API_KEY, aunque fuera OpenAI). */
export function explain(status, body, ep) {
  const p = providerOf(ep);
  const jean = p.id === 'jean';
  const detail = serverMessage(body);
  const tail = detail ? ` Detalle: ${detail}` : '';
  if (status === 401) return `${p.name} rechazó la clave (401). ${jean ? 'Revisa tu JEAN_API_KEY.' : `Revisa la clave (${p.keyHint}).`}`;
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

async function request(ep, path, init = {}) {
  const b = bridge();
  const timeout = init.timeout ?? ep.timeout ?? 60000;
  if (b?.http) {
    const r = await b.http({ url: ep.url + path, method: init.method || 'GET', headers: headersFor(ep), body: init.body, timeout });
    if (r.error) throw new ApiError(networkHint(ep) + ` (${r.error})`, 0);
    if (r.status >= 400) throw new ApiError(explain(r.status, r.body, ep), r.status, serverMessage(r.body));
    return JSON.parse(r.body);
  }
  let res;
  try {
    const signal = init.signal || AbortSignal.timeout(timeout);
    res = await fetch(ep.url + path, { ...init, headers: headersFor(ep), signal });
  } catch (e) {
    if (e.name === 'AbortError' && init.signal?.aborted) throw e;
    throw new ApiError(networkHint(ep) + (e.name === 'TimeoutError' ? ' (sin respuesta a tiempo)' : ''), 0);
  }
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new ApiError(explain(res.status, body, ep), res.status, serverMessage(body)); }
  return res.json();
}

/** Modelos de un endpoint y, si es el router de Jean-API-Generator, qué puertos no están disponibles y por qué. */
export async function listModelsDetailed(ep) {
  const data = await request(ep, '/models', { timeout: ep.timeout ?? MODELS_TIMEOUT });
  return {
    ids: (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean),
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
      const drop = e.status === 400 && !streamed && tries < DROPPABLE.length
        && DROPPABLE.find((d) => d.re.test(why) && !dropped.get(key)?.has(d.key));
      if (!drop) throw e;
      if (!dropped.has(key)) dropped.set(key, new Set());
      dropped.get(key).add(drop.key);
      opts.onAdapt?.(drop.key, e);
    }
  }
}

async function chatOnce({ ep, model, messages, signal, onDelta, onReasoning, onToolCalls, onUsage, temperature, think, tools }, skip = new Set()) {
  const payload = { model, messages, stream: true, temperature: temperature ?? 0.2 };
  // Modelos Qwen/Jean: sin la fase de razonamiento responden varias veces más rápido en CPU.
  // Solo llama-server entiende este parámetro; OpenAI y otros lo rechazarían.
  if (typeof think === 'boolean' && supportsThinkToggle(ep)) payload.chat_template_kwargs = { enable_thinking: think };
  // Herramientas nativas (function calling de OpenAI): el servidor interpreta la plantilla del modelo.
  if (tools?.length) payload.tools = tools;
  if (wantsStreamUsage(ep)) payload.stream_options = { include_usage: true };
  for (const k of skip) delete payload[k];
  const body = JSON.stringify(payload);
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
    if (json.error) throw new ApiError(typeof json.error === 'string' ? json.error : (json.error.message || 'error del proveedor'), json.error.code === 503 ? 503 : 0);
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
    if (calls.length) onToolCalls?.(calls.filter(Boolean));
    if (usage) onUsage?.(usage);
    return full;
  };

  if (b?.stream) {
    await new Promise((resolve, reject) => {
      const id = b.stream(
        { url: ep.url + '/chat/completions', headers: headersFor(ep), body },
        {
          onEvent: (json) => { try { handleChunk(json); } catch (e) { b.abort(id); reject(e); } },
          onDone: resolve,
          onError: (err) => reject(err.status
            ? new ApiError(explain(err.status, err.body, ep), err.status, serverMessage(err.body))
            : new ApiError(networkHint(ep) + (err.message ? ` (${err.message})` : ''), 0)),
        },
      );
      signal?.addEventListener('abort', () => { b.abort(id); reject(new DOMException('aborted', 'AbortError')); });
    });
    return finish();
  }

  let res;
  try {
    res = await fetch(ep.url + '/chat/completions', {
      method: 'POST', signal, body, headers: headersFor(ep),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(networkHint(ep), 0);
  }
  if (!res.ok) { const text = await res.text().catch(() => ''); throw new ApiError(explain(res.status, text, ep), res.status, serverMessage(text)); }

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
