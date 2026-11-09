// Hugging Face → tu Codespace: búsqueda de modelos GGUF en el Hub y control del
// servidor de Jean-API-Generator (puerto 8899) para cargarlos en un puerto de modelo.
import { normalizeUrl } from './api.js';

const HUB = 'https://huggingface.co';
const bridge = () => (typeof window !== 'undefined' ? window.jeancodeDesktop : null);

export const SLOTS = [
  { port: 8888, label: 'Puerto 8888 (Grey)' },
  { port: 8889, label: 'Puerto 8889 (Marvel)' },
  { port: 8890, label: 'Puerto 8890 (Fénix)' },
];

/**
 * URL del servidor de control a partir de un endpoint Jean (-8888.app.github.dev → -8899).
 * El router de Jean-API-Generator ya vive en :8899: su URL sin /v1 es el control.
 */
export function controlUrlFrom(epUrl) {
  const u = normalizeUrl(epUrl).replace(/\/v1$/, '');
  if (/-(8888|8889|8890|8899)\.app\.github\.dev/.test(u)) return u.replace(/-(8888|8889|8890|8899)(\.app\.github\.dev)/, '-8899$2');
  if (/:(8888|8889|8890|8899)$/.test(u)) return u.replace(/:(8888|8889|8890|8899)$/, ':8899');
  return '';
}

async function getJson(url, headers = {}) {
  const b = bridge();
  if (b?.http) {
    const r = await b.http({ url, method: 'GET', headers });
    if (r.error) throw new Error(r.error);
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(r.body);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const hubHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

/** Modelos GGUF del Hub ordenados por descargas. */
export async function hfSearch(query, token) {
  const q = new URLSearchParams({ search: query, filter: 'gguf', sort: 'downloads', direction: '-1', limit: '20' });
  const list = await getJson(`${HUB}/api/models?${q}`, hubHeaders(token));
  return list.map((m) => ({ id: m.id || m.modelId, downloads: m.downloads || 0, likes: m.likes || 0, gated: !!m.gated, private: !!m.private }));
}

/** Archivos .gguf de un repo, con tamaño. Los modelos divididos (-00001-of-0000N) se marcan. */
export async function hfFiles(repo, token) {
  const tree = await getJson(`${HUB}/api/models/${repo}/tree/main?recursive=true`, hubHeaders(token));
  return tree.filter((f) => f.type === 'file' && /\.gguf$/i.test(f.path) && !/mmproj/i.test(f.path))
    .map((f) => ({ path: f.path, size: (f.lfs && f.lfs.size) || f.size || 0, split: /-\d{5}-of-\d{5}\.gguf$/i.test(f.path) }))
    .sort((a, b) => a.size - b.size);
}

/** Llamada al servidor de control con la clave de la API. */
export async function control(base, key, path, body) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const method = body ? 'POST' : 'GET';
  const b = bridge();
  let status, text;
  if (b?.http) {
    const r = await b.http({ url: base + path, method, headers, body: body ? JSON.stringify(body) : undefined });
    if (r.error) throw new Error('No se pudo conectar con el control (puerto 8899 público y Codespace encendido).');
    status = r.status; text = r.body;
  } else {
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('No se pudo conectar con el control: el puerto 8899 debe ser público y el Codespace estar encendido.');
    }
    status = res.status; text = await res.text();
  }
  let data = {};
  try { data = JSON.parse(text); } catch { /* respuesta no JSON (proxy) */ }
  if (status === 401) throw new Error('El control rechazó la clave (usa la misma JEAN_API_KEY de tu API).');
  if (status === 404 && !data.error) throw new Error('El control no responde: actualiza tu Jean-API-Generator (necesita control/control_server.py).');
  if (status >= 400) throw new Error(data.error || `Error ${status}`);
  return data;
}

export const gb = (bytes) => (bytes / 2 ** 30).toFixed(bytes >= 10 * 2 ** 30 ? 0 : 1) + ' GB';
