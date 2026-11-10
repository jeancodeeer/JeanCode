// Enrutador de JeanCode. Capas:
//   providers.js     qué proveedores existen y su adaptador (en qué se apartan del estándar OpenAI)
//   capabilities.js  qué sabe hacer cada modelo (registro central)
//   router.js        validar conexiones, salud, decidir el backend (explicado), respaldo, trazas
//   api.js           ejecutar la petición normalizada (transporte, errores con tipo, ajustes)
// La interfaz (app.js, agent.js) solo habla con router.chat()/router.decide() y nunca con un proveedor.
import { store } from './store.js';
import { chatStream, listModelsDetailed, normalizeUrl, isRouterUrl, sameServer, ApiError } from './api.js';
import { PROVIDERS, providerById, providerOf } from './providers.js';
import { capsOf, billingOf, unfitReason, isLocalUrl } from './capabilities.js';

export const AUTO = 'auto';

/** Identidad de un modelo: el mismo nombre puede existir en dos conexiones. */
export const modelKey = (m) => (m ? `${m.ep.id}|${m.id}` : '');

/* ------------------------------------------------------------------ registro y trazas */
const LOG_MAX = 200;
const log = [];

/**
 * Quita claves y tokens de cualquier texto: Bearer, sk-…, hf_…, ghp_…, nvapi-…, ?key=… y cadenas largas
 * tipo token. Misma regla que desktop/lib/redact.js (proceso principal): si cambias una, cambia la otra.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
    .replace(/\b(sk-(?:ant-|or-|proj-)?|hf_|gsk_|xai-|fw_|csk-|jean_|jeantest_|AIza|ghp_|gho_|ghs_|github_pat_|nvapi-|glpat-|xox[abpr]-)[A-Za-z0-9_-]{6,}/g, '$1***')
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, '$1***')
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '***');
}

/**
 * Host y ruta de un endpoint, sin consulta ni credenciales. El nombre de un Codespace identifica a su
 * dueño: se enmascara (…-8899.app.github.dev) para que el registro se pueda compartir.
 */
export function where(ep) {
  try {
    const u = new URL(ep.url);
    const host = u.host.replace(/^[a-z0-9-]+-(\d{4,5})\.app\.github\.dev$/i, '…-$1.app.github.dev');
    return `${host}${u.pathname}`;
  } catch { return '(url inválida)'; }
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

const traces = []; // las últimas peticiones completas, para "ver la ruta" de una respuesta
const TRACE_MAX = 60;
export const traceById = (id) => traces.find((t) => t.id === id) || null;
export const recentTraces = () => traces.slice();

/** Texto de una traza: REQUEST → ROUTER → PROVIDER → MODEL → RESPONSE (sin secretos). */
export function formatTrace(tr) {
  if (!tr) return '';
  const lines = [
    `REQUEST   modo ${tr.request.mode} · ~${tr.request.tokens} tokens${tr.request.tools ? ' · con herramientas' : ''}`,
    `ROUTER    ${tr.router.routing}${tr.router.reasons.length ? ' · ' + tr.router.reasons.join(' · ') : ''}`,
    ...tr.router.skipped.map((s) => `          descartado ${s.model}: ${s.why}`),
  ];
  tr.attempts.forEach((a, i) => {
    lines.push(`${i ? 'FALLBACK ' : 'PROVIDER '} ${a.provider} · ${a.where}`);
    lines.push(`MODEL     ${a.model}${a.billing ? ' · ' + a.billing : ''}`);
    lines.push(`RESPONSE  ${a.ok ? 'ok' : `${a.kind} (${a.status ?? '-'})`} · ${a.ms} ms${a.ttft != null ? ` · primer token ${a.ttft} ms` : ''}${a.msg ? ' · ' + redact(a.msg) : ''}`);
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ salud */
const health = new Map(); // ep.id -> { ok, kind, ms, at, error, router, unavailable }
export const healthOf = (ep) => health.get(ep.id) || null;
// Un modelo concreto que no respondió se aparta un minuto sin marcar como caída toda la conexión.
const modelDown = new Map(); // modelKey -> hasta cuándo
const DOWN_MS = 60000;
export const isModelDown = (m) => (modelDown.get(`${m.ep.id}|${m.id}`) || 0) > Date.now();
// Latencia medida: media móvil del primer token por modelo (solo lo medido, nunca supuesto).
const latency = new Map(); // modelKey -> ms
export const latencyOf = (m) => latency.get(modelKey(m)) ?? null;
function noteLatency(m, ms) {
  const k = modelKey(m);
  latency.set(k, latency.has(k) ? Math.round(latency.get(k) * 0.7 + ms * 0.3) : ms);
}

/** Mensajes humanos por tipo de fallo (el detalle técnico va en la traza). */
export const KIND_LABEL = {
  ok: 'conectada',
  network: 'no se puede conectar',
  timeout: 'no respondió a tiempo',
  auth: 'clave inválida',
  forbidden: 'acceso denegado',
  model: 'el modelo no existe',
  notfound: 'URL equivocada (404)',
  rate: 'límite de uso alcanzado',
  down: 'proveedor caído o cargando',
  format: 'no es una API OpenAI-compatible',
  request: 'petición rechazada',
  unknown: 'error',
};

/** Lista los modelos de un endpoint y anota su salud (latencia, último error y su tipo). */
export async function probeEndpoint(ep) {
  const t0 = performance.now();
  try {
    const r = await listModelsDetailed(ep);
    const ms = Math.round(performance.now() - t0);
    health.set(ep.id, { ok: true, kind: 'ok', ms, at: Date.now(), router: r.router, unavailable: r.unavailable });
    logRoute({ kind: 'modelos', provider: providerOf(ep).name, where: where(ep), ms, msg: `${r.ids.length} modelos${r.router ? ' (router)' : ''}` });
    return r;
  } catch (e) {
    health.set(ep.id, { ok: false, kind: e.kind || 'unknown', ms: null, at: Date.now(), error: redact(e.message) });
    logRoute({ kind: 'modelos-error', provider: providerOf(ep).name, where: where(ep), status: e.status, msg: `${e.kind || ''} ${e.message}` });
    throw e;
  }
}

/**
 * Comprobación completa de una conexión: lista de modelos y, si se pide, una respuesta de 1 token
 * para validar autenticación, modelo, formato de petición y de respuesta (streaming). Devuelve un informe.
 * chat=true en un proveedor de pago gasta ~1 token: la interfaz lo avisa antes.
 */
export async function checkEndpoint(ep, { model, chat = false } = {}) {
  const report = { steps: [] };
  const step = (name, ok, detail) => report.steps.push({ name, ok, detail: redact(detail || '') });
  let r;
  try {
    r = await probeEndpoint(ep);
    step('conexión y clave', true, `${healthOf(ep).ms} ms`);
    step('formato de /models', true, `${r.ids.length} modelos`);
  } catch (e) {
    step(e.kind === 'format' ? 'formato de /models' : 'conexión y clave', false, `${KIND_LABEL[e.kind] || e.kind}: ${e.message}`);
    report.kind = e.kind;
    return report;
  }
  const target = model || r.ids.find((id) => capsOf(ep, id).chat !== false);
  if (model) step('el modelo existe', r.ids.includes(model), r.ids.includes(model) ? model : `${model} no está en la lista`);
  if (chat && target) {
    const t0 = performance.now();
    let text = '';
    try {
      await chatStream({ ep, model: target, think: false, temperature: 0,
        messages: [{ role: 'user', content: 'Responde solo: ok' }], onDelta: (d) => { text += d; } });
      step('chat en streaming', true, `${Math.round(performance.now() - t0)} ms · «${text.trim().slice(0, 20)}»`);
    } catch (e) {
      step('chat en streaming', false, `${KIND_LABEL[e.kind] || e.kind}: ${e.message}`);
      report.kind = e.kind;
      return report;
    }
  }
  report.kind = 'ok';
  return report;
}

/* ------------------------------------------------------------------ validación (generador de conexiones) */
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;
const isLocalHost = (host) => LOCAL_HOST.test(host);

/** Proveedor conocido al que pertenece un host (para corregir una elección equivocada). */
function providerForHost(host) {
  return PROVIDERS.find((p) => p.url && !p.local && (() => { try { return new URL(p.url).host === host; } catch { return false; } })());
}

/**
 * APIs con un formato que no es el de OpenAI: se reconocen por la URL y se explica qué usar.
 * Devuelve { fix?: url corregida, error?: texto } o null.
 */
function incompatibleFormat(u) {
  const path = u.pathname.replace(/\/+$/, '');
  if (/(^|\.)openai\.azure\.com$/i.test(u.hostname) || /\/openai\/deployments\//i.test(path)) {
    return { error: 'Azure OpenAI usa otra forma de URL y autenticación (deployments, api-version, cabecera api-key). Usa su endpoint compatible "/openai/v1" o un proxy OpenAI-compatible.' };
  }
  if (u.hostname === 'generativelanguage.googleapis.com' && !/\/openai$/.test(path)) {
    return { fix: `${u.origin}/v1beta/openai`, warn: 'Gemini: se usa su capa compatible con OpenAI (/v1beta/openai).' };
  }
  if (/:11434$/.test(u.host) && (path === '' || path === '/api' || path.startsWith('/api/'))) {
    return { fix: `${u.origin}/v1`, warn: 'Ollama: la API nativa (/api) no es OpenAI; se usa la compatible en /v1.' };
  }
  if (u.hostname === 'api.anthropic.com' && path === '') return { fix: `${u.origin}/v1`, warn: 'Anthropic: se usa su capa compatible con OpenAI en /v1.' };
  if (/\/chat\/completions$|\/completions$|\/responses$/.test(path)) return { fix: u.origin + path.replace(/\/(chat\/)?completions$|\/responses$/, ''), warn: 'Se quitó la ruta de la petición: la URL debe ser la base (…/v1).' };
  return null;
}

/**
 * Valida y normaliza una conexión ANTES de intentar nada: { ok, url, key, provider, errors, warnings }.
 * Corrige lo seguro (barra final, ruta de petición pegada, proveedor que no corresponde al host, la
 * capa OpenAI de Gemini/Ollama/Anthropic) y rechaza lo que fallaría o expondría la clave.
 */
export function validateEndpoint({ url, key, provider }, { existing = [], desktop = false, pageProtocol = (typeof location !== 'undefined' ? location.protocol : 'https:') } = {}) {
  const errors = [];
  const warnings = [];
  let clean = normalizeUrl(url);
  let prov = providerById(provider);
  const k = String(key ?? '').trim();
  let u;
  try { u = new URL(clean); } catch { errors.push('La URL no es válida. Ejemplo: https://tu-servidor/v1'); }
  if (u) {
    const fmt = incompatibleFormat(u);
    if (fmt?.error) errors.push(fmt.error);
    if (fmt?.fix) { clean = normalizeUrl(fmt.fix); u = new URL(clean); warnings.push(fmt.warn); }
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

/**
 * Configuraciones listas para otras herramientas a partir de una conexión ya validada. La clave
 * NUNCA va dentro: se referencia como variable de entorno.
 */
export function exportConfig(ep, model) {
  const p = providerOf(ep);
  const env = p.id === 'jean' ? 'JEAN_API_KEY' : `${p.id.toUpperCase()}_API_KEY`;
  const m = model || 'MODELO';
  return {
    env,
    curl: `curl ${ep.url}/chat/completions \\\n  -H "Authorization: Bearer $${env}" -H "Content-Type: application/json" \\\n  -d '{"model":"${m}","stream":true,"messages":[{"role":"user","content":"hola"}]}'`,
    opencode: JSON.stringify({ provider: { [p.id]: { npm: '@ai-sdk/openai-compatible', name: p.name,
      options: { baseURL: ep.url, apiKey: `{env:${env}}` }, models: { [m]: {} } } } }, null, 2),
  };
}

/* ------------------------------------------------------------------ decisión explicable */
// Por modo, qué tipo de modelo conviene primero (nombres Jean). Para el resto se respeta el orden
// en que el usuario agregó las conexiones y, si se midió, la latencia.
const MODE_PREF = {
  chat: [/grey/i, /marvel/i, /fenix/i],
  code: [/grey/i, /marvel/i, /fenix/i],
  agent: [/marvel/i, /grey/i, /fenix/i],
};

/** ¿Se permite que el modo automático o el respaldo usen modelos de pago sin elegirlos a mano? */
export const allowPaidAuto = () => store.get('allowPaidAuto', false) === true;
const autoBillingOk = (m) => { const b = billingOf(m.ep, m.id); return b !== 'paid' || allowPaidAuto(); };

/** Motivo por el que un modelo no sirve para esta petición (o null). */
function skipReason(m, need) {
  const h = healthOf(m.ep);
  if (h && !h.ok) return `conexión ${h.kind ? (KIND_LABEL[h.kind] || h.kind) : 'caída'}`;
  if (isModelDown(m)) return 'no respondió hace menos de un minuto';
  return unfitReason(capsOf(m.ep, m.id), need);
}

function score(m, mode, order) {
  const prefs = MODE_PREF[mode] || MODE_PREF.chat;
  const i = prefs.findIndex((re) => re.test(m.id));
  const local = billingOf(m.ep, m.id) === 'local' ? 0 : 1;
  return [i < 0 ? prefs.length : i, order.indexOf(m.ep.id), latencyOf(m) ?? 1e9, local];
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Modelos ordenados del más al menos adecuado para el modo (los que no sirven, al final). */
export function rank(models, mode, endpoints, need = {}) {
  const order = endpoints.map((e) => e.id);
  return [...models].sort((a, b) => cmp([skipReason(a, need) ? 1 : 0, ...score(a, mode, order)], [skipReason(b, need) ? 1 : 0, ...score(b, mode, order)]));
}

export function pickAuto(models, mode, endpoints, need = {}) {
  return decide({ routing: AUTO }, { models, mode, endpoints, need }).model;
}

/**
 * Decide el modelo para una petición y explica por qué. route:
 *   { routing: 'auto' }                         el mejor modelo disponible
 *   { routing: 'model', target: modelKey }      ese modelo, tal cual lo eligió el usuario
 *   { routing: 'endpoint', target: ep.id }      el mejor modelo de esa conexión
 * need: { tokens, tools, vision } de la petición. Devuelve { model, routing, reasons, skipped }.
 */
export function decide(route, { models = [], mode = 'chat', endpoints = [], need = {} } = {}) {
  const routing = route?.routing || AUTO;
  const skipped = [];
  if (routing === 'model') {
    const m = models.find((x) => modelKey(x) === route.target) || resolveSaved(route.target, models);
    const why = m && skipReason(m, need);
    return { model: m || null, routing: 'modelo elegido', reasons: m ? [why ? `elegido por ti (aviso: ${why})` : 'elegido por ti'] : ['el modelo elegido ya no está disponible'], skipped };
  }
  let pool = models;
  const reasons = [];
  if (routing === 'endpoint') {
    pool = models.filter((m) => m.ep.id === route.target);
    const ep = endpoints.find((e) => e.id === route.target);
    reasons.push(`solo ${ep ? `${providerOf(ep).name} · ${where(ep)}` : 'esa conexión'}`);
  }
  const order = endpoints.map((e) => e.id);
  const usable = [];
  for (const m of pool) {
    const why = skipReason(m, need) || (routing === AUTO && !autoBillingOk(m) ? 'es de pago y no permitiste pago en automático' : null);
    if (why) skipped.push({ model: m.id, why }); else usable.push(m);
  }
  usable.sort((a, b) => cmp(score(a, mode, order), score(b, mode, order)));
  const pick = usable[0] || null;
  if (pick) {
    const prefs = MODE_PREF[mode] || MODE_PREF.chat;
    const pref = prefs.findIndex((re) => re.test(pick.id));
    reasons.push(pref >= 0 ? `preferido para ${mode}` : 'primera conexión disponible');
    const lat = latencyOf(pick);
    if (lat != null) reasons.push(`primer token ~${lat} ms`);
    const caps = capsOf(pick.ep, pick.id);
    if (need.tokens && caps.context) reasons.push(`cabe en su contexto (${Math.round(caps.context / 1024)}k)`);
  } else if (pool.length) {
    reasons.push('ningún modelo cumple: revisa los descartes');
  }
  return { model: pick, routing: routing === 'endpoint' ? 'conexión fija' : 'automático', reasons, skipped };
}

/* ------------------------------------------------------------------ respaldo */
export const FALLBACK_POLICIES = {
  off: 'No cambiar de modelo (mostrar el error)',
  same: 'El mismo modelo por otra conexión',
  chain: 'Mi cadena de respaldo (abajo)',
  free: 'Cualquier modelo local o propio disponible',
};
export const fallbackPolicy = () => {
  const p = store.get('fallback', 'same');
  if (p === 'any') return 'free'; // nombre de versiones anteriores
  return p in FALLBACK_POLICIES ? p : 'same';
};
/** Cadena definida por el usuario: claves de modelo en orden (respaldo 1, respaldo 2, local...). */
export const fallbackChain = () => (Array.isArray(store.get('fallbackChain', [])) ? store.get('fallbackChain', []) : []);

/** Errores en los que es seguro reintentar en otro backend: no hubo respuesta útil y no es culpa de la petición. */
export const retriable = (e) => e?.name !== 'AbortError' && (e?.status === 0 || e?.status === 408 || e?.status === 429 || e?.status >= 500
  || ['network', 'timeout', 'rate', 'down'].includes(e?.kind));

/**
 * Backends de respaldo para `primary` según la política. Nunca agrega en silencio un modelo de pago:
 * solo si está en la cadena que el usuario escribió o si permitió pago en automático.
 */
export function candidates(primary, models, mode, endpoints, policy = fallbackPolicy(), need = {}) {
  if (policy === 'off' || !primary) return [];
  const others = models.filter((m) => modelKey(m) !== modelKey(primary) && !skipReason(m, need));
  const same = others.filter((m) => m.id.toLowerCase() === primary.id.toLowerCase());
  if (policy === 'same') return same;
  if (policy === 'chain') {
    const chain = fallbackChain().map((k) => others.find((m) => modelKey(m) === k)).filter(Boolean);
    return [...same.filter((m) => !chain.includes(m)), ...chain];
  }
  // 'free' (y el 'any' antiguo): local o propio; de pago solo con permiso explícito
  const rest = rank(others.filter((m) => !same.includes(m) && autoBillingOk(m)), mode, endpoints, need);
  return [...same, ...rest];
}

/**
 * Chat con enrutado. Reintenta en otro backend solo si falla ANTES de que llegue el primer token
 * (así nunca se mezclan dos respuestas) y solo con errores de disponibilidad (red, tiempo, 429, 5xx).
 * opts: los de chatStream sin ep/model. Devuelve { text, used, trace }.
 */
export async function chat(target, opts, { models = [], mode = 'chat', endpoints = [], onRoute, need = {}, decision = null, onTrace } = {}) {
  const tokens = need.tokens ?? Math.round((opts.messages || []).reduce((s, m) => s + String(m.content || '').length, 0) / 3.6);
  const chain = [target, ...candidates(target, models, mode, endpoints, fallbackPolicy(), { ...need, tokens })];
  const trace = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(),
    request: { mode, tokens, tools: !!opts.tools?.length },
    router: { routing: decision?.routing || 'modelo elegido', reasons: decision?.reasons || [], skipped: decision?.skipped || [] },
    attempts: [],
  };
  traces.push(trace);
  if (traces.length > TRACE_MAX) traces.shift();
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i];
    let started = false;
    let ttft = null;
    const t0 = performance.now();
    const mark = (fn) => (...a) => {
      if (!started) { started = true; ttft = Math.round(performance.now() - t0); }
      return fn?.(...a);
    };
    const attempt = { provider: providerOf(m.ep).name, where: where(m.ep), model: m.id, billing: billingOf(m.ep, m.id) };
    trace.attempts.push(attempt);
    try {
      const text = await chatStream({
        ...opts, ep: m.ep, model: m.id,
        onDelta: mark(opts.onDelta), onReasoning: mark(opts.onReasoning), onToolCalls: mark(opts.onToolCalls),
        onAdapt: (param) => logRoute({ kind: 'ajuste', provider: attempt.provider, where: attempt.where, model: m.id, msg: `el proveedor rechazó «${param}»: se reintenta sin él` }),
      });
      Object.assign(attempt, { ok: true, ms: Math.round(performance.now() - t0), ttft });
      modelDown.delete(modelKey(m));
      if (ttft != null) noteLatency(m, ttft);
      logRoute({ kind: i ? 'respaldo-ok' : 'chat', provider: attempt.provider, where: attempt.where, model: m.id, ms: attempt.ms, msg: ttft != null ? `primer token ${ttft} ms` : '' });
      onTrace?.(trace);
      return { text, used: m, trace };
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      if (e.name === 'AbortError') { Object.assign(attempt, { ok: false, kind: 'aborted', ms }); onTrace?.(trace); throw e; }
      lastErr = e;
      Object.assign(attempt, { ok: false, kind: e.kind || 'unknown', status: e.status, ms, msg: e.message });
      const h = health.get(m.ep.id);
      if (['network', 'auth', 'forbidden', 'format'].includes(e.kind)) health.set(m.ep.id, { ...(h || {}), ok: false, kind: e.kind, at: Date.now(), error: redact(e.message) });
      else if (retriable(e)) modelDown.set(modelKey(m), Date.now() + DOWN_MS);
      logRoute({ kind: 'chat-error', provider: attempt.provider, where: attempt.where, model: m.id, status: e.status, ms, msg: `${e.kind}: ${e.message}` });
      const next = chain[i + 1];
      if (started || !retriable(e) || !next) { onTrace?.(trace); e.trace = trace; throw e; }
      onRoute?.({ from: m, to: next, error: e });
    }
  }
  onTrace?.(trace);
  throw lastErr || new ApiError('No hay ningún modelo disponible.', 0, '', 'network');
}

/* ------------------------------------------------------------------ catálogo */
/**
 * Modelos de chat de todas las conexiones, sin duplicados de un mismo Codespace: si un
 * Jean-API-Generator tiene router, sus modelos se muestran una vez (por el router) y los puertos
 * quedan como respaldo. Los que no son de chat (embeddings, audio, imagen) no se muestran.
 */
export function visibleModels(models) {
  const chatty = models.filter((m) => capsOf(m.ep, m.id).chat !== false);
  const routers = chatty.filter((m) => healthOf(m.ep)?.router || isRouterUrl(m.ep.url));
  return chatty.filter((m) => {
    if (routers.includes(m)) return true;
    return !routers.some((r) => r.id.toLowerCase() === m.id.toLowerCase() && sameServer(r.ep.url, m.ep.url));
  });
}

/** Resuelve el modelo guardado ("auto", "epId|modelo" o, de versiones anteriores, solo "modelo"). */
export function resolveSaved(saved, models) {
  if (!saved || saved === AUTO) return null;
  return models.find((m) => modelKey(m) === saved) || models.find((m) => m.id.toLowerCase() === String(saved).toLowerCase()) || null;
}

/* ------------------------------------------------------------------ preferencia por modo */
/**
 * Enrutado elegido para un modo de trabajo (chat, code, agent): así un proyecto puede usar un
 * modelo local para CODE y el Codespace para el agente. { routing, target }.
 */
export function routeFor(mode) {
  const r = store.get(`route:${mode}`, null);
  if (r && ['auto', 'model', 'endpoint'].includes(r.routing)) return r;
  const legacy = store.get('model', null); // versiones anteriores: un modelo para todo
  if (legacy && legacy !== AUTO) return { routing: 'model', target: legacy };
  return { routing: AUTO };
}
export const setRouteFor = (mode, route) => store.set(`route:${mode}`, route);

export { isLocalUrl };
