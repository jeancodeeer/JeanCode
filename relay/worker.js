// Relay CORS de JeanCode para Cloudflare Workers (plan gratuito: 100 000 peticiones al día).
// Permite usar desde la web o el móvil las APIs que rechazan llamadas de páginas web
// (NVIDIA NIM, SambaNova, DeepSeek, Mistral...). Es TU worker, en TU cuenta: no hay terceros.
//
//   GET|POST https://<tu-worker>.workers.dev/relay/<host>/<ruta>
//   cabecera X-Jean-Key: el secreto RELAY_KEY que configures (wrangler secret put RELAY_KEY)
//
// Mismo protocolo que el relay de Jean-API-Generator (puerto 8899), así que JeanCode usa uno u otro.
// Seguridad: solo hosts de la lista (no es un proxy abierto), solo https, sin seguir redirecciones;
// la clave del proveedor (Authorization) pasa sin tocarse y no se registra; X-Jean-Key no se reenvía.

const HOSTS = new Set(`
api.openai.com api.anthropic.com generativelanguage.googleapis.com openrouter.ai api.groq.com
router.huggingface.co api.deepseek.com api.mistral.ai api.x.ai api.together.xyz api.fireworks.ai
api.cerebras.ai integrate.api.nvidia.com api.sambanova.ai api.deepinfra.com api.hyperbolic.xyz
api.novita.ai api.tokenfactory.nebius.com api.studio.nebius.com llm.chutes.ai api.siliconflow.com
api.inference.net api.moonshot.ai api.z.ai dashscope-intl.aliyuncs.com api.minimax.io api.cohere.ai
api.scaleway.ai openai.inference.de-txl.ionos.com
`.split(/\s+/).filter(Boolean));
const FORWARD = ['authorization', 'content-type', 'accept', 'x-title', 'http-referer', 'anthropic-version', 'x-api-key'];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  Vary: 'Origin',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-jean-key, x-title, http-referer, anthropic-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});
const fail = (status, message, origin) => new Response(JSON.stringify({ error: { message, type: 'jean_relay_error' } }), {
  status, headers: { 'Content-Type': 'application/json', ...cors(origin) },
});

/** Comparación en tiempo constante (la clave no se filtra por tiempos). */
function same(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json', ...cors(origin) } });
    if (!url.pathname.startsWith('/relay/')) return fail(404, 'Usa /relay/<host>/<ruta>.', origin);
    if (!env.RELAY_KEY || !same(req.headers.get('X-Jean-Key') || '', env.RELAY_KEY)) return fail(401, 'X-Jean-Key inválida o ausente.', origin);
    if (!['GET', 'POST'].includes(req.method)) return fail(405, 'Solo GET y POST.', origin);

    const rest = url.pathname.slice('/relay/'.length);
    const slash = rest.indexOf('/');
    const host = (slash > 0 ? rest.slice(0, slash) : '').toLowerCase();
    const extra = new Set(String(env.RELAY_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
    if (!host || !/^[a-z0-9.-]+$/.test(host)) return fail(400, 'Ruta de relay inválida.', origin);
    if (!HOSTS.has(host) && !extra.has(host)) return fail(403, `El relay no reenvía a ${host}. Añádelo a RELAY_HOSTS si es tuyo.`, origin);

    const headers = {};
    for (const h of FORWARD) { const v = req.headers.get(h); if (v) headers[h] = v; }
    let upstream;
    try {
      upstream = await fetch(`https://${host}${rest.slice(slash)}${url.search}`, {
        method: req.method, headers, body: req.method === 'POST' ? req.body : undefined, redirect: 'manual',
      });
    } catch (e) {
      return fail(502, `No se pudo contactar con el proveedor (${e.name}).`, origin);
    }
    // el cuerpo pasa en streaming, trozo a trozo
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-cache', ...cors(origin) },
    });
  },
};
