// Registro central de capacidades de modelos. Es el ÚNICO sitio donde JeanCode decide qué sabe hacer
// un modelo (chat, herramientas, visión, contexto...). El resto de la app pregunta aquí.
//
// Fuentes, de más a menos fiable:
//   1. lo que informa el propio endpoint (OpenRouter /models, el router de Jean-API-Generator con el
//      contexto real de llama-server, Ollama /api/show)
//   2. lo aprendido en uso (un 400 al enviar herramientas => no las acepta)
//   3. hechos conocidos por familia de modelo (tabla FAMILIES, conservadora)
// Lo que no se sabe queda en null ("desconocido"). Nunca se inventa una capacidad.
import { providerOf } from './providers.js';

/** Campos de una ficha. true/false = sabido; null = desconocido. */
const EMPTY = {
  chat: null, code: null, tools: null, vision: null, streaming: null, structured: null, embeddings: null,
  context: null, maxOutput: null, local: null, billing: null, price: null, source: [],
};

/*
 * Familias conocidas (id del modelo, sin distinguir mayúsculas). Solo hechos públicos y estables.
 * Para agregar una familia: una línea más. context = ventana documentada por el fabricante.
 */
const FAMILIES = [
  // Jean: plantillas Qwen con tool calls. El CONTEXTO no va aquí: depende de quién lo sirve (serve.sh
  // usa -c 131072; Ollama usa su propio num_ctx). Lo informa el adaptador de cada proveedor.
  { re: /^jean-(grey|marvel)/, caps: { chat: true, code: true, tools: true, vision: false, streaming: true } },
  { re: /^jean-fenix/, caps: { chat: true, code: true, tools: true, vision: false, streaming: true } },
  { re: /^(gpt-4o|gpt-4\.1|gpt-5)/, caps: { chat: true, code: true, tools: true, vision: true, streaming: true, structured: true } },
  { re: /^o[134](-|$)/, caps: { chat: true, code: true, tools: true, streaming: true, structured: true } },
  { re: /^claude-/, caps: { chat: true, code: true, tools: true, vision: true, streaming: true } },
  { re: /^gemini-/, caps: { chat: true, code: true, tools: true, vision: true, streaming: true } },
  { re: /qwen2\.5-coder|qwen3.*coder|deepseek-coder|codestral|codellama|starcoder/, caps: { chat: true, code: true, streaming: true } },
  { re: /llama-?3|mistral|mixtral|qwen|deepseek|gemma|phi-?[34]/, caps: { chat: true, streaming: true } },
  // modelos que NO son de chat: se ocultan del selector
  { re: /embed|embedding|bge-|e5-|nomic-embed/, caps: { chat: false, embeddings: true } },
  { re: /whisper|transcribe|tts|text-to-speech|dall-e|gpt-image|moderation|rerank|^babbage|^davinci/, caps: { chat: false } },
];

const learned = new Map();   // `${ep.id}|${model}` -> caps aprendidas en uso
const reported = new Map();  // `${ep.id}|${model}` -> caps informadas por el endpoint

const key = (ep, model) => `${ep.id}|${model}`;

/** Guarda lo que un endpoint dice de sus modelos (llamado por los adaptadores al listar). */
export function reportCaps(ep, model, caps) {
  reported.set(key(ep, model), { ...(reported.get(key(ep, model)) || {}), ...caps });
}

/** Lo aprendido en uso: p. ej. learnCap(ep, 'gpt-x', { tools: false }) tras un 400 con herramientas. */
export function learnCap(ep, model, caps) {
  learned.set(key(ep, model), { ...(learned.get(key(ep, model)) || {}), ...caps });
}

/** Ficha de capacidades de un modelo en una conexión. */
export function capsOf(ep, model) {
  const p = providerOf(ep);
  const out = { ...EMPTY, source: [] };
  const fam = FAMILIES.find((f) => f.re.test(String(model).toLowerCase()));
  const layers = [
    ['familia', fam?.caps],
    ['proveedor', { local: !!p.local || isLocalUrl(ep.url) }],
    ['endpoint', reported.get(key(ep, model))],
    ['uso', learned.get(key(ep, model))],
  ];
  for (const [name, caps] of layers) {
    if (!caps) continue;
    let used = false;
    for (const [k, v] of Object.entries(caps)) {
      if (v === undefined || v === null || !(k in EMPTY) || k === 'source') continue;
      out[k] = v;
      used = true;
    }
    if (used) out.source.push(name);
  }
  // un modelo sin dato de chat en un endpoint de chat se asume de chat salvo que la familia diga lo contrario
  if (out.chat === null) out.chat = true;
  out.billing = billingOf(ep, model); // por modelo: OpenRouter informa precio 0 en los :free
  if (out.streaming === null && p.id !== 'custom') out.streaming = true;
  return out;
}

/**
 * Coste, solo lo verificable:
 *   local  corre en tu equipo: sin coste por uso
 *   own    tu servidor/Codespace: consume tu cuota de cómputo, no cobra por token
 *   free   el proveedor informa precio 0 para ese modelo
 *   paid   el proveedor cobra por uso (el importe depende de tu plan/cuenta)
 *   null   desconocido (API propia o genérica)
 */
export function billingOf(ep, model) {
  const p = providerOf(ep);
  if (p.local || isLocalUrl(ep.url)) return 'local';
  if (p.billing === 'own') return 'own';
  const r = model ? reported.get(key(ep, model)) : null;
  if (r?.price && r.price.prompt === 0 && r.price.completion === 0) return 'free';
  return p.billing ?? null;
}

export const BILLING_LABEL = {
  local: 'local · sin coste por uso',
  own: 'tu servidor · sin cobro por token',
  free: 'gratis según el proveedor',
  paid: 'de pago · según tu plan',
  null: 'coste desconocido',
};

const LOCAL_RE = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(\/|$)/i;
export const isLocalUrl = (url) => LOCAL_RE.test(String(url || ''));

/** ¿Puede este modelo atender esta petición? Devuelve null si sí, o el motivo si no. */
export function unfitReason(caps, need) {
  if (caps.chat === false) return 'no es un modelo de chat';
  if (need.tools && caps.tools === false) return 'no acepta herramientas (el agente las necesita)';
  if (need.vision && caps.vision === false) return 'no acepta imágenes';
  if (need.tokens && caps.context && need.tokens > caps.context * 0.9) {
    return `el contexto (${fmtCtx(caps.context)}) es menor que la conversación (~${fmtCtx(need.tokens)})`;
  }
  return null;
}

export const fmtCtx = (n) => (n >= 1000 ? `${Math.round(n / 1024)}k` : String(n));

/** Resumen legible de una ficha (para la tarjeta de ruta). */
export function describeCaps(caps) {
  const yes = (v, label) => (v === true ? label : null);
  const list = [yes(caps.code, 'código'), yes(caps.tools, 'herramientas'), yes(caps.vision, 'visión'),
    yes(caps.structured, 'salida estructurada'), yes(caps.embeddings, 'embeddings')].filter(Boolean);
  return {
    can: list,
    context: caps.context ? fmtCtx(caps.context) + ' tokens' : 'desconocido',
    billing: BILLING_LABEL[caps.billing ?? 'null'],
    price: caps.price ? `${perMillion(caps.price.prompt)} entrada · ${perMillion(caps.price.completion)} salida por 1M tokens (dato del proveedor)` : null,
    source: caps.source.join(' + '),
  };
}

const perMillion = (perToken) => `$${(perToken * 1e6).toFixed(perToken * 1e6 < 1 ? 3 : 2)}`;
