// Cliente OpenAI-compatible para jean-api (llama-server). Cada endpoint = { id, url, key }.
// En el escritorio las peticiones pasan por el proceso principal (sin CORS) vía window.jeancodeDesktop.
import { store } from './store.js';

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

export function addEndpoint(url, key) {
  const list = getEndpoints();
  const ep = { id: crypto.randomUUID(), url: normalizeUrl(url), key: String(key).trim() };
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
    res = await fetch(ep.url + path, { ...init, headers, signal: init.signal });
  } catch (e) {
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
export async function chatStream({ ep, model, messages, signal, onDelta, onReasoning, temperature }) {
  const body = JSON.stringify({ model, messages, stream: true, temperature: temperature ?? 0.2 });
  const b = bridge();
  let full = '';
  const handleChunk = (json) => {
    const d = json.choices?.[0]?.delta || {};
    if (d.reasoning_content) onReasoning?.(d.reasoning_content);
    if (d.content) { full += d.content; onDelta?.(d.content); }
  };

  if (b?.stream) {
    await new Promise((resolve, reject) => {
      const id = b.stream(
        { url: ep.url + '/chat/completions', headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' }, body },
        {
          onEvent: (json) => handleChunk(json),
          onDone: resolve,
          onError: (err) => reject(new ApiError(err.status ? explain(err.status, err.body) : NETWORK_HINT, err.status || 0)),
        },
      );
      signal?.addEventListener('abort', () => { b.abort(id); reject(new DOMException('aborted', 'AbortError')); });
    });
    return full;
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
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try { handleChunk(JSON.parse(payload)); } catch { /* línea parcial */ }
    }
  }
  return full;
}

/** Clave aleatoria segura (256 bits, base64url) para usar como JEAN_API_KEY. */
export function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'jean_' + b64;
}
