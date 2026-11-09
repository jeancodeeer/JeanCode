// Cliente OpenAI-compatible. Cada endpoint = { id, url, key, provider }; provider = 'jean'
// (Jean-API-Generator / llama-server) u otro de providers.js (OpenAI, OpenRouter, Groq…).
// En el escritorio las peticiones pasan por el proceso principal (sin CORS) vía window.jeancodeDesktop.
import { store } from './store.js';
import { supportsThinkToggle, wantsStreamUsage } from './providers.js';

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
  constructor(message, status) { super(message); this.status = status; }
}

function explain(status, body) {
  if (status === 401) return 'La API rechazó la clave (401). Revisa tu JEAN_API_KEY.';
  if (status === 403) return 'Acceso denegado (403). ¿El puerto del Codespace está como público?';
  if (status === 404) return 'No se encontró la ruta (404). La URL debe terminar en /v1.';
  if (status === 503) return 'El modelo todavía está cargando (503). Espera 2–4 minutos tras despertar el Codespace.';
  return `La API respondió ${status}. ${String(body || '').slice(0, 200)}`;
}

const NETWORK_HINT = 'No se pudo conectar. Puede que el Codespace esté dormido, que el puerto no sea público o que la URL esté mal.';

async function request(ep, path, init = {}) {
  const b = bridge();
  const headers = { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' };
  if (b?.http) {
    const r = await b.http({ url: ep.url + path, method: init.method || 'GET', headers, body: init.body });
    if (r.error) throw new ApiError(NETWORK_HINT + ` (${r.error})`, 0);
    if (r.status >= 400) throw new ApiError(explain(r.status, r.body), r.status);
    return JSON.parse(r.body);
  }
  let res;
  try {
    const signal = init.signal || (ep.timeout ? AbortSignal.timeout(ep.timeout) : undefined);
    res = await fetch(ep.url + path, { ...init, headers, signal });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new ApiError(NETWORK_HINT, 0);
    if (e.name === 'AbortError') throw e;
    throw new ApiError(NETWORK_HINT, 0);
  }
  if (!res.ok) throw new ApiError(explain(res.status, await res.text().catch(() => '')), res.status);
  return res.json();
}

export async function listModels(ep) {
  const data = await request(ep, '/models');
  return (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
}

/** Prueba un endpoint; si falla con 404 y no termina en /v1, reintenta añadiéndolo. */
export async function probe(url, key) {
  const ep = { url: normalizeUrl(url), key: String(key).trim() };
  try {
    return { url: ep.url, models: await listModels(ep) };
  } catch (e) {
    if ((e.status === 404 || e.status === 0) && !/\/v1$/.test(ep.url)) {
      const alt = { ...ep, url: ep.url + '/v1' };
      return { url: alt.url, models: await listModels(alt) };
    }
    throw e;
  }
}

/**
 * Chat en streaming. onDelta(texto), onReasoning(texto). Devuelve el texto completo.
 * El razonamiento de Qwen puede llegar como reasoning_content o dentro de <think>…</think>.
 */
export async function chatStream({ ep, model, messages, signal, onDelta, onReasoning, onToolCalls, onUsage, temperature, think, tools }) {
  const payload = { model, messages, stream: true, temperature: temperature ?? 0.2 };
  // Modelos Qwen/Jean: sin la fase de razonamiento responden varias veces más rápido en CPU.
  // Solo llama-server entiende este parámetro; OpenAI y otros lo rechazarían.
  if (typeof think === 'boolean' && supportsThinkToggle(ep)) payload.chat_template_kwargs = { enable_thinking: think };
  // Herramientas nativas (function calling de OpenAI): el servidor interpreta la plantilla del modelo.
  if (tools?.length) payload.tools = tools;
  if (wantsStreamUsage(ep)) payload.stream_options = { include_usage: true };
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
    if (json.error) throw new ApiError(typeof json.error === 'string' ? json.error : (json.error.message || 'error del proveedor'), 0);
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
        { url: ep.url + '/chat/completions', headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' }, body },
        {
          onEvent: (json) => { try { handleChunk(json); } catch (e) { b.abort(id); reject(e); } },
          onDone: resolve,
          onError: (err) => reject(new ApiError(err.status ? explain(err.status, err.body) : NETWORK_HINT, err.status || 0)),
        },
      );
      signal?.addEventListener('abort', () => { b.abort(id); reject(new DOMException('aborted', 'AbortError')); });
    });
    return finish();
  }

  let res;
  try {
    res = await fetch(ep.url + '/chat/completions', {
      method: 'POST', signal, body,
      headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(NETWORK_HINT, 0);
  }
  if (!res.ok) throw new ApiError(explain(res.status, await res.text().catch(() => '')), res.status);

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

// Jean-API-Generator sirve un modelo por puerto: Grey :8888, Marvel :8889, Fénix :8890.
const JEAN_PORTS = ['8888', '8889', '8890'];

/** URLs de los otros puertos del mismo servidor (Codespaces "-8888.app.github.dev" o host:8888). */
export function siblingUrls(url) {
  const out = [];
  for (const re of [/-(8888|8889|8890)(\.app\.github\.dev)/, /:(8888|8889|8890)(?=\/|$)/]) {
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

/** Agrega los puertos hermanos que respondan con la misma clave. Devuelve los modelos nuevos. */
export async function discoverSiblings(baseUrl, key) {
  const known = new Set(getEndpoints().map((e) => e.url));
  const found = [];
  await Promise.all(siblingUrls(normalizeUrl(baseUrl)).filter((u) => !known.has(u)).map(async (u) => {
    try {
      const models = await listModels({ url: u, key, timeout: 8000 });
      if (models.length) found.push({ url: u, models });
    } catch { /* ese puerto no tiene modelo: normal */ }
  }));
  for (const f of found.sort((a, b) => a.url.localeCompare(b.url))) addEndpoint(f.url, key, 'jean');
  return found.flatMap((f) => f.models);
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
    const r = await b.http({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, stream: false }) });
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
