// Generación de imagen y vídeo: qué modelos sirven, qué admite cada uno y cómo se le pide a cada proveedor.
// Sin interfaz ni almacenamiento (eso va en service.js y studio.js). Cada proveedor habla su propio formato: aquí se
// traduce una petición normalizada al suyo y su respuesta a una lista de resultados.
//
// Petición normalizada: { kind, model, prompt, negative, ratio, resolution, count, seed, steps, guidance, quality,
//                         background, duration, audio, refs: [dataURL], mask: dataURL, start: dataURL, end: dataURL }
// Resultado:            { b64, mime } | { url, auth } (auth = la descarga lleva la clave del proveedor)
import { providerOf } from '../providers.js';
import { capsOf, IMAGE_MODEL, VIDEO_MODEL } from '../capabilities.js';

export class MediaError extends Error {
  constructor(message, { kind = 'provider', status = 0 } = {}) { super(message); this.kind = kind; this.status = status; }
}

/* ---------------------------------------------------------------- qué modelos */
// Proveedores que solo sirven texto: aunque un nombre se parezca, nunca se les pide imagen ni vídeo
const TEXT_ONLY = new Set(['anthropic', 'groq', 'cerebras', 'deepseek', 'cohere', 'moonshot', 'sambanova', 'hyperbolic']);
// El resto de proveedores usa el formato de OpenAI (/images/generations y /videos): lo que aquí no aparece, se intenta así.
const VIDEO_PROTOCOL = { fal: 'fal', replicate: 'replicate', luma: 'luma', openai: 'openai', openrouter: 'openrouter', gemini: 'veo', minimax: 'minimax', xai: 'xai', together: 'together', siliconflow: 'siliconflow', dashscope: 'dashscope', zai: 'zai' };
const IMAGE_PROTOCOL = { fal: 'fal', replicate: 'replicate', bfl: 'bfl', luma: 'luma', a1111: 'a1111', comfyui: 'comfy', openai: 'openai', openrouter: 'openrouter', gemini: 'gemini', minimax: 'minimax', xai: 'xai', together: 'together', siliconflow: 'siliconflow', nvidia: 'nvidia', huggingface: 'hf', dashscope: 'dashscope', zai: 'zai' };

/** Formato de la API de este proveedor para ese tipo de contenido, o null si no lo ofrece. */
export function protocolOf(ep, kind) {
  const p = providerOf(ep).id;
  if (TEXT_ONLY.has(p)) return null;
  return (kind === 'video' ? VIDEO_PROTOCOL[p] : IMAGE_PROTOCOL[p]) || 'generic';
}

/** 'image', 'video' o null: lo que informa el proveedor y, si no, el nombre del modelo. */
export function mediaKindOf(ep, id) {
  const p = providerOf(ep);
  if (p.mediaOnly) return p.media?.find(([m]) => m === id)?.[1] || 'image';
  const c = capsOf(ep, id);
  const kind = c.video === true ? 'video' : c.image === true ? 'image' : VIDEO_MODEL.test(id) ? 'video' : IMAGE_MODEL.test(id) ? 'image' : null;
  return kind && protocolOf(ep, kind) ? kind : null;
}

// Modelos que el proveedor documenta pero no siempre devuelve en /models
const KNOWN = {
  openai: [['gpt-image-2.6-sunburst', 'image'], ['gpt-image-2.6-flare', 'image'], ['gpt-image-2', 'image']],
  // integrate.api.nvidia.com/v1/models no lista los modelos visuales: viven en ai.api.nvidia.com
  // comprobados contra la API real (18-11-2026); Kontext no se ofrece porque la API hospedada solo acepta sus imágenes de ejemplo
  nvidia: [['black-forest-labs/flux-3-image-klein', 'image'], ['black-forest-labs/flux.1-dev', 'image'], ['black-forest-labs/flux.1-schnell', 'image'], ['black-forest-labs/flux.2-klein-4b', 'image']],
  huggingface: [['black-forest-labs/FLUX.1-schnell', 'image'], ['stabilityai/stable-diffusion-3-medium-diffusers', 'image']],
  dashscope: [['qwen-image-2.0-pro', 'image'], ['wan2.7-t2v', 'video']],
  zai: [['glm-image', 'image'], ['cogvideox-3', 'video']],
  minimax: [['image-01', 'image'], ['MiniMax-H3', 'video'], ['MiniMax-H3-Lite', 'video'], ['MiniMax-H3-Highspeed', 'video'], ['MiniMax-H3-Max', 'video']],
  xai: [['grok-imagine-image-2.0', 'image'], ['grok-imagine-video-1.5', 'video'], ['grok-imagine-video-1.5-lite', 'video'], ['grok-imagine-video', 'video']],
};
export const knownModels = (ep) => [...(KNOWN[providerOf(ep).id] || []), ...(providerOf(ep).media || [])].map(([id, kind]) => ({ id, kind, ep }));

const videoInfo = new Map(); // `${ep.id}|${modelo}` → lo que OpenRouter informa de cada modelo de vídeo

/** OpenRouter lista imagen y vídeo aparte de los modelos de chat. Devuelve [{ id, kind }]. */
export async function discoverModels(ep, net) {
  if (providerOf(ep).id !== 'openrouter') return [];
  const [imgs, vids] = await Promise.allSettled([net.call('/images/models'), net.call('/videos/models')]);
  const out = [];
  if (imgs.status === 'fulfilled') for (const m of imgs.value?.data || []) if (m.id) out.push({ id: m.id, kind: 'image' });
  if (vids.status === 'fulfilled') for (const m of vids.value?.data || []) {
    if (!m.id) continue;
    videoInfo.set(`${ep.id}|${m.id}`, m);
    out.push({ id: m.id, kind: 'video' });
  }
  return out;
}

/* ---------------------------------------------------------------- qué admite cada modelo */
const R_COMMON = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const R_VIDEO = ['16:9', '9:16', '1:1', '4:3', '3:4'];

/**
 * Controles que tiene sentido enseñar para este modelo. Lo que no está aquí no se muestra ni se envía.
 * ratios, resolutions, durations (s), count (máximo), refs (imágenes de referencia), y true/false para el resto.
 */
export function controlsFor(ep, id, kind) {
  const p = protocolOf(ep, kind);
  const base = { protocol: p, ratios: kind === 'video' ? R_VIDEO : R_COMMON, resolutions: [], durations: [], qualities: [], count: 1, refs: 0,
    negative: false, seed: false, steps: false, guidance: false, background: false, mask: false, audio: false, start: false, end: false };
  if (kind === 'image') {
    switch (p) {
      case 'openai': {
        // la familia gpt-image-2 acepta medidas libres; las anteriores, solo tres tamaños
        const free = /gpt-image-[2-9]/.test(id);
        return { ...base, ratios: free ? [...R_COMMON, '21:9'] : ['1:1', '3:2', '2:3'], resolutions: free ? ['1K', '2K'] : [], qualities: free ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] : ['auto', 'low', 'medium', 'high'],
          count: /dall-e-3/.test(id) ? 1 : 10, refs: /dall-e/.test(id) ? 0 : 16, background: !/dall-e/.test(id), mask: !/dall-e/.test(id) };
      }
      // la API hospedada no admite semilla ni imágenes propias; pasos y fidelidad solo en los modelos que los regulan
      case 'nvidia': { const tunable = /flux\.1-dev|flux-3/.test(id); return { ...base, steps: tunable, guidance: tunable }; }
      case 'fal': return { ...base, count: 4, seed: true, steps: true, guidance: true };
      case 'replicate': return { ...base, seed: true };
      case 'bfl': return { ...base, seed: true };
      case 'luma': return { ...base, ratios: [...R_COMMON, '21:9', '9:21'] };
      case 'a1111': return { ...base, count: 4, refs: 1, negative: true, seed: true, steps: true, guidance: true };
      case 'comfy': return { ...base, negative: true, seed: true, steps: true, guidance: true };
      case 'hf': return { ...base, negative: true, seed: true, steps: true, guidance: true };
      case 'dashscope': return { ...base, ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'], count: 6, negative: true, seed: true };
      case 'zai': return { ...base, ratios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'], qualities: ['hd', 'standard'] };
      case 'openrouter': return { ...base, ratios: [...R_COMMON, '21:9', '4:5', '5:4'], resolutions: ['1K', '2K', '4K'], qualities: ['auto', 'low', 'medium', 'high'], count: 10, refs: 16, seed: true, background: true };
      case 'gemini': return { ...base, ratios: [...R_COMMON, '21:9', '4:5', '5:4'], resolutions: ['1K', '2K', '4K'], refs: 14 };
      case 'minimax': return { ...base, ratios: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'], count: 9, refs: 1, seed: true };
      case 'xai': return { ...base, ratios: [...R_COMMON, '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20', '21:9', '5:2'], resolutions: ['1k', '2k'], count: 10, refs: 5 };
      case 'together': return { ...base, count: 4, refs: 4, negative: true, seed: true, steps: true, guidance: true };
      case 'siliconflow': return { ...base, ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'], count: 4, refs: 1, negative: true, seed: true, steps: true, guidance: true };
      default: return { ...base, count: 4, negative: true, seed: true, steps: true, guidance: true };
    }
  }
  switch (p) {
    case 'openrouter': {
      const info = videoInfo.get(`${ep.id}|${id}`) || {};
      return { ...base, ratios: info.supported_aspect_ratios?.length ? info.supported_aspect_ratios : R_VIDEO, resolutions: info.supported_resolutions?.length ? info.supported_resolutions : ['480p', '720p', '1080p'],
        durations: (info.supported_durations || [4, 6, 8]).filter((d) => d > 0), seed: true, audio: true, start: true, end: true, refs: 4 };
    }
    case 'xai': return { ...base, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'], resolutions: /1\.5/.test(id) ? ['480p', '720p', '1080p'] : ['480p', '720p'], durations: [4, 6, 8, 10, 12, 15], start: true };
    case 'fal': return { ...base, durations: [5, 8, 10], seed: true, start: true };
    case 'replicate': return { ...base, durations: [5, 8, 10], seed: true, start: true };
    case 'luma': return { ...base, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], resolutions: ['540p', '720p', '1080p'], durations: [5, 9] };
    case 'dashscope': return { ...base, resolutions: ['720P', '1080P'], durations: [5, 8, 10, 15], negative: true, seed: true };
    case 'zai': return { ...base, ratios: ['16:9', '9:16', '1:1'], durations: [5, 10], audio: true, start: true, end: true };
    case 'openai': return { ...base, ratios: ['16:9', '9:16'], durations: [4, 8, 12] };
    case 'together': return { ...base, resolutions: ['480p', '720p', '1080p'], durations: [5, 8, 10], negative: true, seed: true, audio: true, start: true, end: true };
    case 'siliconflow': return { ...base, ratios: ['16:9', '9:16', '1:1'], negative: true, seed: true, start: true };
    case 'veo': return { ...base, ratios: ['16:9', '9:16'], resolutions: ['720p', '1080p', '4k'], durations: [4, 6, 8], start: true, end: true };
    case 'minimax': return { ...base, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], resolutions: /-H3$/.test(id) ? ['480P', '768P', '2K'] : ['480P', '768P'], durations: /Max/.test(id) ? [5, 6, 8, 10, 15] : [4, 6, 8, 10, 15], audio: true, start: true, end: true };
    default: return { ...base, durations: [4, 5, 8, 10], negative: true, seed: true, start: true };
  }
}

/** Ancho y alto (múltiplos de `step`) para una proporción, con un área parecida a side². */
export function sizeFor(ratio, side = 1024, step = 16) {
  const [a, b] = String(ratio || '1:1').split(':').map(Number);
  if (!(a > 0 && b > 0)) return { width: side, height: side };
  const h = Math.sqrt((side * side * b) / a);
  const snap = (n) => Math.max(step, Math.round(n / step) * step);
  return { width: snap((h * a) / b), height: snap(h) };
}
const OPENAI_SIZE = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' };
/** NVIDIA solo acepta lados de 768 a 1344 en pasos de 64. */
function nvidiaSize(ratio) {
  const { width, height } = sizeFor(ratio, 1024, 64);
  const fit = (n) => Math.min(1344, Math.max(768, n));
  return { width: fit(width), height: fit(height) };
}
const ZAI_SIZE = { '1:1': '1280x1280', '3:2': '1568x1056', '2:3': '1056x1568', '4:3': '1472x1088', '3:4': '1088x1472', '16:9': '1728x960', '9:16': '960x1728' };
const ZAI_VIDEO = { '16:9': '1920x1080', '9:16': '1080x1920', '1:1': '1024x1024' };
const dashBase = (ep) => `${new URL(ep.url).origin}/api/v1`;
const VIDEO_SIZE = { '16:9': '1280x720', '9:16': '720x1280', '1:1': '960x960' };

/** Solo los campos con valor: lo que el usuario no tocó no se envía y decide el proveedor. */
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
const b64Of = (dataUrl) => String(dataUrl).replace(/^data:[^,]*,/, '');
const mimeOf = (dataUrl) => String(dataUrl).match(/^data:([^;,]+)/)?.[1] || 'image/png';

/* ---------------------------------------------------------------- respuestas */
const BASE64 = /^[A-Za-z0-9+/\s]+=*$/;
/** Imágenes de cualquier forma habitual: data[], images[], output[], con base64 o URL. */
export function parseImages(json, mime = 'image/png') {
  const list = [json?.data, json?.images, json?.artifacts, json?.output, json?.data?.image_base64, json?.data?.image_urls].find(Array.isArray) || (typeof json?.image === 'string' ? [json.image] : []);
  return list.map((x) => {
    if (typeof x === 'string') return /^https?:/i.test(x) ? { url: x } : { b64: b64Of(x), mime };
    const raw = x?.b64_json || x?.b64 || x?.image_base64 || x?.base64 || (typeof x?.image === 'string' && BASE64.test(x.image.slice(0, 200)) ? x.image : null);
    if (raw) return { b64: b64Of(raw), mime: x.media_type || mime };
    const url = x?.url || x?.image_url?.url || x?.image_url || (typeof x?.image === 'string' ? x.image : null);
    return typeof url === 'string' ? { url } : null;
  }).filter(Boolean);
}
const noResult = () => new MediaError('El proveedor respondió, pero sin ningún resultado. Puede que el filtro de contenido lo haya bloqueado: cambia el prompt o prueba otro modelo.', { kind: 'empty' });
const need = (items) => { if (!items.length) throw noResult(); return items; };

/** Reintenta sin el parámetro opcional que el proveedor rechace (cada API acepta cosas distintas). */
async function tolerant(body, optional, send) {
  const sent = { ...body };
  for (let i = 0; i <= optional.length; i++) {
    try { return await send(sent); } catch (e) {
      const why = `${e.detail || ''} ${e.message || ''}`;
      const bad = (e.status === 400 || e.status === 422) && optional.find((k) => k in sent && why.toLowerCase().includes(k.toLowerCase()));
      if (!bad) throw e;
      delete sent[bad];
    }
  }
  throw new MediaError('El proveedor rechazó la petición.');
}

/** Espera entre consultas a un trabajo en curso, cancelable. */
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
});
/** Consulta hasta que check() devuelva algo. net.fast acorta la espera en las pruebas. */
async function waitResult(net, check, maxMs = 600000) {
  const t0 = Date.now();
  for (let wait = net.fast ? 0 : 1200; ; wait = Math.min(wait * 1.3, 6000)) {
    const out = await check();
    if (out !== undefined) return out;
    if (Date.now() - t0 > maxMs) throw new MediaError('El proveedor tardó demasiado en responder.', { kind: 'timeout' });
    await pause(wait, net.signal);
  }
}
/** Llama a una URL que dio el proveedor, solo si está en su dominio: la clave no se envía a ningún otro. */
function callAt(net, url, host, opts = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !(u.hostname === host || u.hostname.endsWith(`.${host}`))) throw new MediaError('El proveedor devolvió una dirección inesperada: no se consulta.', { kind: 'provider' });
  return net.call(`${u.pathname}${u.search}`, { ...opts, base: u.origin });
}
const FAL_AUTH = (net) => ({ Authorization: `Key ${net.ep.key}` });
const falSubmit = (model, body, net) => net.call(`/${model}`, { method: 'POST', base: 'https://queue.fal.run', auth: FAL_AUTH(net), body });
const falStatus = (ref, net) => callAt(net, ref.status, 'fal.run', { auth: FAL_AUTH(net) });
const falResult = (ref, net) => callAt(net, ref.result, 'fal.run', { auth: FAL_AUTH(net) });
const falRef = (j) => ({ id: j.request_id, status: j.status_url, result: j.response_url });
const REPLICATE_FILES = 'replicate.delivery';
const replicateItems = (output, mime) => need((Array.isArray(output) ? output : [output]).filter((x) => typeof x === 'string').map((url) => ({ url, auth: true, authHost: REPLICATE_FILES, mime })));
const COMFY_WORKFLOW = (r, ckpt, width, height) => ({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
  2: { class_type: 'CLIPTextEncode', inputs: { text: r.prompt, clip: ['1', 1] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: r.negative || '', clip: ['1', 1] } },
  4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
  5: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: num(r.seed) ?? Math.floor(Math.random() * 2 ** 32), steps: num(r.steps) ?? 25, cfg: num(r.guidance) ?? 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'JeanCode' } },
});

/* ---------------------------------------------------------------- imagen */
const IMAGE = {
  async fal(r, net) {
    const { width, height } = sizeFor(r.ratio);
    const ref = falRef(await falSubmit(r.model, clean({ prompt: r.prompt, image_size: { width, height }, num_images: r.count > 1 ? r.count : undefined, seed: num(r.seed), guidance_scale: num(r.guidance), num_inference_steps: num(r.steps) }), net));
    await waitResult(net, async () => { const s = await falStatus(ref, net); if (s.error) throw new MediaError(String(s.error)); return s.status === 'COMPLETED' ? true : undefined; });
    return need(parseImages(await falResult(ref, net)));
  },
  async replicate(r, net) {
    const input = clean({ prompt: r.prompt, aspect_ratio: r.ratio, seed: num(r.seed) });
    let j = await tolerant(input, ['aspect_ratio', 'seed'], (b) => net.call(`/models/${r.model}/predictions`, { method: 'POST', headers: { Prefer: 'wait=55' }, body: { input: b } }));
    j = await waitResult(net, async () => {
      if (j.status === 'succeeded') return j;
      if (['failed', 'canceled'].includes(j.status)) throw new MediaError(String(j.error || 'Replicate no pudo generar la imagen.'));
      j = await net.call(`/predictions/${encodeURIComponent(j.id)}`);
      return undefined;
    });
    return replicateItems(j.output, 'image/webp');
  },
  async bfl(r, net) {
    const { width, height } = sizeFor(r.ratio, 1024, 16);
    const auth = { 'x-key': net.ep.key };
    const j = await net.call(`/${r.model}`, { method: 'POST', auth, body: clean({ prompt: r.prompt, width, height, seed: num(r.seed) }) });
    const done = await waitResult(net, async () => {
      const s = await callAt(net, j.polling_url, 'bfl.ai', { auth });
      if (s.status === 'Ready') return s;
      if (['Error', 'Failed'].includes(s.status)) throw new MediaError(String(s.details?.message || s.status));
      if (/moderated/i.test(s.status || '')) throw new MediaError('El filtro de contenido de Black Forest Labs bloqueó esta imagen: cambia el prompt.', { kind: 'empty' });
      return undefined;
    });
    return need(done.result?.sample ? [{ url: done.result.sample }] : []);
  },
  async luma(r, net) {
    let j = await net.call('/generations/image', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, aspect_ratio: r.ratio }) });
    j = await waitResult(net, async () => {
      if (j.state === 'completed') return j;
      if (j.state === 'failed') throw new MediaError(String(j.failure_reason || 'Luma no pudo generar la imagen.'));
      j = await net.call(`/generations/${encodeURIComponent(j.id)}`);
      return undefined;
    });
    return need(j.assets?.image ? [{ url: j.assets.image }] : []);
  },
  /** Stable Diffusion WebUI y Forge en tu PC. */
  async a1111(r, net) {
    const { width, height } = sizeFor(r.ratio, 768, 8);
    const init = r.refs?.[0];
    const body = clean({ prompt: r.prompt, negative_prompt: r.negative, width, height, steps: num(r.steps), cfg_scale: num(r.guidance), seed: num(r.seed), batch_size: r.count > 1 ? r.count : undefined,
      init_images: init ? [b64Of(init)] : undefined, override_settings: { sd_model_checkpoint: r.model } });
    return need(parseImages(await net.call(init ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img', { method: 'POST', body, timeout: 1800000 })));
  },
  /** ComfyUI en tu PC: un flujo estándar de texto a imagen con el checkpoint elegido. */
  async comfy(r, net) {
    const { width, height } = sizeFor(r.ratio, 768, 8);
    const j = await net.call('/prompt', { method: 'POST', body: { prompt: COMFY_WORKFLOW(r, r.model, width, height), client_id: 'jeancode' } });
    if (j.error) throw new MediaError(`ComfyUI rechazó el flujo: ${j.error.message || j.error}`);
    const entry = await waitResult(net, async () => (await net.call(`/history/${encodeURIComponent(j.prompt_id)}`))[j.prompt_id], 1800000);
    const images = Object.values(entry.outputs || {}).flatMap((o) => o.images || []);
    return need(images.map((x) => ({ url: `${net.ep.url}/view?${new URLSearchParams({ filename: x.filename, subfolder: x.subfolder || '', type: x.type || 'output' })}`, mime: 'image/png' })));
  },
  async openai(r, net) {
    const free = /gpt-image-[2-9]/.test(r.model);
    const side = r.resolution === '2K' ? 2048 : 1024;
    const { width, height } = sizeFor(r.ratio, side, 16);
    const shared = clean({ model: r.model, prompt: r.prompt, n: r.count > 1 ? r.count : undefined, size: free && r.ratio ? `${width}x${height}` : OPENAI_SIZE[r.ratio], quality: r.quality === 'auto' ? undefined : r.quality,
      background: r.background ? 'transparent' : undefined, ...(/dall-e/.test(r.model) ? { response_format: 'b64_json' } : {}) });
    const optional = ['background', 'quality', 'size'];
    if (r.refs?.length) {
      const body = clean({ ...shared, images: r.refs.map((image_url) => ({ image_url })), mask: r.mask ? { image_url: r.mask } : undefined });
      return need(parseImages(await tolerant(body, optional, (b) => net.call('/images/edits', { method: 'POST', body: b }))));
    }
    return need(parseImages(await tolerant(shared, optional, (b) => net.call('/images/generations', { method: 'POST', body: b }))));
  },
  /** NVIDIA: cada modelo tiene su URL en ai.api.nvidia.com y rechaza cualquier campo que no conozca. */
  async nvidia(r, net) {
    const dev = /flux\.1-dev/.test(r.model);
    const range = (v, lo, hi) => (num(v) === undefined ? undefined : Math.min(hi, Math.max(lo, num(v))));
    const body = clean({ prompt: r.prompt, ...nvidiaSize(r.ratio), steps: range(r.steps, dev ? 5 : 1, dev ? 100 : 50), cfg_scale: range(r.guidance, dev ? 1.1 : 0, dev ? 9 : 20) });
    const json = await tolerant(body, ['steps', 'cfg_scale', 'width', 'height'], (b) => net.call(`/${r.model}`, { method: 'POST', base: 'https://ai.api.nvidia.com/v1/genai', body: b }));
    if (json.artifacts?.some((a) => a.finishReason === 'CONTENT_FILTERED')) throw new MediaError('El filtro de contenido de NVIDIA bloqueó esta imagen: cambia el prompt.', { kind: 'empty' });
    return need(parseImages(json, 'image/jpeg'));
  },
  /** Hugging Face devuelve directamente los bytes de la imagen. */
  async hf(r, net) {
    const { width, height } = sizeFor(r.ratio);
    const blob = await net.bytes(`/models/${r.model}`, { base: 'https://router.huggingface.co/hf-inference', body: { inputs: r.prompt, parameters: clean({ width, height, negative_prompt: r.negative, seed: num(r.seed), num_inference_steps: num(r.steps), guidance_scale: num(r.guidance) }) } });
    return [{ blob, mime: blob.type || 'image/jpeg' }];
  },
  async dashscope(r, net) {
    const { width, height } = sizeFor(r.ratio, 1328, 16);
    const json = await net.call('/services/aigc/multimodal-generation/generation', { method: 'POST', base: dashBase(net.ep), body: { model: r.model, input: { messages: [{ role: 'user', content: [...(r.refs || []).map((image) => ({ image })), { text: r.prompt }] }] },
      parameters: clean({ size: `${width}*${height}`, n: r.count > 1 ? r.count : undefined, negative_prompt: r.negative, seed: num(r.seed) }) } });
    return need((json.output?.choices || []).flatMap((c) => c.message?.content || []).filter((x) => x.image).map((x) => ({ url: x.image })));
  },
  async zai(r, net) {
    return need(parseImages(await net.call('/images/generations', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, size: ZAI_SIZE[r.ratio], quality: r.quality === 'auto' ? undefined : r.quality }) })));
  },
  async openrouter(r, net) {
    return need(parseImages(await net.call('/images', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, n: r.count > 1 ? r.count : undefined, aspect_ratio: r.ratio, resolution: r.resolution, seed: num(r.seed),
      quality: r.quality === 'auto' ? undefined : r.quality, background: r.background ? 'transparent' : undefined,
      input_references: r.refs?.map((url) => ({ type: 'image_url', image_url: { url } })) }) })));
  },
  async gemini(r, net) {
    const input = r.refs?.length ? [{ type: 'text', text: r.prompt }, ...r.refs.map((d) => ({ type: 'image', mime_type: mimeOf(d), data: b64Of(d) }))] : r.prompt;
    const json = await net.call('/interactions', { method: 'POST', base: geminiBase(net.ep), auth: { 'x-goog-api-key': net.ep.key },
      body: { model: r.model, input, response_format: clean({ type: 'image', aspect_ratio: r.ratio, image_size: r.resolution }) } });
    const blocks = (json.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []).filter((c) => c.type === 'image' && c.data);
    if (!blocks.length && json.output_image?.data) blocks.push(json.output_image);
    return need(blocks.map((c) => ({ b64: c.data, mime: c.mime_type || 'image/png' })));
  },
  async minimax(r, net) {
    const json = await net.call('/image_generation', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, aspect_ratio: r.ratio, n: r.count, seed: num(r.seed), response_format: 'base64',
      subject_reference: r.refs?.length ? [{ type: 'character', image_file: r.refs[0] }] : undefined }) });
    minimaxOk(json);
    return need(parseImages(json, 'image/jpeg'));
  },
  async xai(r, net) {
    const body = clean({ model: r.model, prompt: r.prompt, n: r.count > 1 ? r.count : undefined, aspect_ratio: r.ratio, resolution: r.resolution, response_format: 'b64_json' });
    const refs = (r.refs || []).map((url) => ({ url, type: 'image_url' }));
    const path = refs.length ? '/images/edits' : '/images/generations';
    const full = refs.length === 1 ? { ...body, image: refs[0] } : refs.length ? { ...body, images: refs } : body;
    return need(parseImages(await tolerant(full, ['response_format', 'aspect_ratio', 'resolution', 'n'], (b) => net.call(path, { method: 'POST', body: b })), 'image/jpeg'));
  },
  async together(r, net) {
    const { width, height } = sizeFor(r.ratio);
    const [first, ...rest] = r.refs || [];
    const body = clean({ model: r.model, prompt: r.prompt, n: r.count, width, height, steps: num(r.steps), seed: num(r.seed), negative_prompt: r.negative, guidance_scale: num(r.guidance),
      response_format: 'base64', output_format: 'png', image_url: first, reference_images: rest });
    return need(parseImages(await tolerant(body, ['negative_prompt', 'guidance_scale', 'steps', 'reference_images', 'n'], (b) => net.call('/images/generations', { method: 'POST', body: b }))));
  },
  async siliconflow(r, net) {
    const { width, height } = sizeFor(r.ratio);
    const body = clean({ model: r.model, prompt: r.prompt, image_size: `${width}x${height}`, batch_size: r.count > 1 ? r.count : undefined, num_inference_steps: num(r.steps), guidance_scale: num(r.guidance),
      negative_prompt: r.negative, seed: num(r.seed), image: r.refs?.[0] });
    return need(parseImages(await tolerant(body, ['batch_size', 'num_inference_steps', 'guidance_scale', 'negative_prompt'], (b) => net.call('/images/generations', { method: 'POST', body: b }))));
  },
  /** Cualquier API compatible con /images/generations de OpenAI (servidores propios, LiteLLM, DeepInfra, Nebius…). */
  async generic(r, net) {
    const { width, height } = sizeFor(r.ratio);
    const body = clean({ model: r.model, prompt: r.prompt, n: r.count > 1 ? r.count : undefined, size: `${width}x${height}`, response_format: 'b64_json', negative_prompt: r.negative, seed: num(r.seed),
      steps: num(r.steps), guidance_scale: num(r.guidance) });
    return need(parseImages(await tolerant(body, ['negative_prompt', 'seed', 'steps', 'guidance_scale', 'response_format', 'n'], (b) => net.call('/images/generations', { method: 'POST', body: b, timeout: 600000 }))));
  },
};

const geminiBase = (ep) => ep.url.replace(/\/openai\/?$/, '');
function minimaxOk(json) {
  const b = json?.base_resp;
  if (b && b.status_code) throw new MediaError(`MiniMax: ${b.status_msg || `error ${b.status_code}`}`);
}

/* ---------------------------------------------------------------- vídeo
 * submit(r, net) → referencia del trabajo (se guarda para retomarlo tras cerrar la app; nunca lleva la clave).
 * poll(ref, net) → { done, progress?, items?, error? } */
const pending = { done: false };
const failed = (error) => ({ done: true, error: String(error || 'El proveedor no pudo generar el vídeo.') });
const VIDEO = {
  fal: {
    async submit(r, net) {
      return falRef(await falSubmit(r.model, clean({ prompt: r.prompt, aspect_ratio: r.ratio, duration: r.duration ? String(r.duration) : undefined, seed: num(r.seed), image_url: r.start }), net));
    },
    async poll(ref, net) {
      const s = await falStatus(ref, net);
      if (s.error) return failed(s.error);
      if (s.status !== 'COMPLETED') return pending;
      const j = await falResult(ref, net);
      return { done: true, items: need(j.video?.url ? [{ url: j.video.url, mime: 'video/mp4' }] : (j.videos || []).map((v) => ({ url: v.url, mime: 'video/mp4' }))) };
    },
  },
  replicate: {
    async submit(r, net) {
      const input = clean({ prompt: r.prompt, aspect_ratio: r.ratio, duration: num(r.duration), seed: num(r.seed), image: r.start });
      const j = await tolerant(input, ['aspect_ratio', 'duration', 'seed'], (b) => net.call(`/models/${r.model}/predictions`, { method: 'POST', body: { input: b } }));
      return { id: j.id };
    },
    async poll(ref, net) {
      const j = await net.call(`/predictions/${encodeURIComponent(ref.id)}`);
      if (j.status === 'succeeded') return { done: true, items: replicateItems(j.output, 'video/mp4') };
      if (['failed', 'canceled'].includes(j.status)) return failed(j.error);
      return pending;
    },
  },
  luma: {
    async submit(r, net) {
      const j = await net.call('/generations/video', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, aspect_ratio: r.ratio, resolution: r.resolution, duration: r.duration ? `${r.duration}s` : undefined }) });
      return { id: j.id };
    },
    async poll(ref, net) {
      const j = await net.call(`/generations/${encodeURIComponent(ref.id)}`);
      if (j.state === 'completed') return { done: true, items: need(j.assets?.video ? [{ url: j.assets.video, mime: 'video/mp4' }] : []) };
      if (j.state === 'failed') return failed(j.failure_reason);
      return pending;
    },
  },
  openrouter: {
    async submit(r, net) {
      const frames = [r.start && { type: 'image_url', image_url: { url: r.start }, frame_type: 'first_frame' }, r.end && { type: 'image_url', image_url: { url: r.end }, frame_type: 'last_frame' }].filter(Boolean);
      const j = await net.call('/videos', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, duration: num(r.duration), resolution: r.resolution, aspect_ratio: r.ratio, seed: num(r.seed),
        generate_audio: r.audio === undefined ? undefined : !!r.audio, frame_images: frames, input_references: r.refs?.map((url) => ({ type: 'image_url', image_url: { url } })) }) });
      return { id: j.id };
    },
    async poll(ref, net) {
      const j = await net.call(`/videos/${encodeURIComponent(ref.id)}`);
      if (j.status === 'completed') return { done: true, items: need((j.unsigned_urls || j.urls || [`${net.ep.url}/videos/${ref.id}/content?index=0`]).map((url) => ({ url, auth: true, mime: 'video/mp4' }))) };
      if (['failed', 'cancelled', 'expired'].includes(j.status)) return failed(j.error || `Trabajo ${j.status}`);
      return pending;
    },
  },
  xai: {
    async submit(r, net) {
      const j = await net.call('/videos/generations', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, duration: num(r.duration), aspect_ratio: r.start ? undefined : r.ratio, resolution: r.resolution, image: r.start ? { url: r.start } : undefined }) });
      return { id: j.request_id };
    },
    async poll(ref, net) {
      const j = await net.call(`/videos/${encodeURIComponent(ref.id)}`);
      if (j.status === 'done' || j.video?.url) return { done: true, items: need(j.video?.url ? [{ url: j.video.url, mime: 'video/mp4' }] : []) };
      if (['failed', 'expired'].includes(j.status)) return failed(j.error?.message || j.error || `Trabajo ${j.status}`);
      return { done: false, progress: num(j.progress) };
    },
  },
  dashscope: {
    async submit(r, net) {
      const j = await net.call('/services/aigc/video-generation/video-synthesis', { method: 'POST', base: dashBase(net.ep), headers: { 'X-DashScope-Async': 'enable' },
        body: { model: r.model, input: clean({ prompt: r.prompt, negative_prompt: r.negative }), parameters: clean({ resolution: r.resolution, ratio: r.ratio, duration: num(r.duration), seed: num(r.seed) }) } });
      return { id: j.output?.task_id };
    },
    async poll(ref, net) {
      const o = (await net.call(`/tasks/${encodeURIComponent(ref.id)}`, { base: dashBase(net.ep) })).output || {};
      if (o.task_status === 'SUCCEEDED') return { done: true, items: need(o.video_url ? [{ url: o.video_url, mime: 'video/mp4' }] : []) };
      if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(o.task_status)) return failed(o.message || `Trabajo ${o.task_status}`);
      return pending;
    },
  },
  zai: {
    async submit(r, net) {
      const frames = [r.start, r.end].filter(Boolean);
      const j = await net.call('/videos/generations', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, size: ZAI_VIDEO[r.ratio], duration: num(r.duration), with_audio: r.audio === undefined ? undefined : !!r.audio, image_url: frames.length > 1 ? frames : frames[0], quality: frames.length > 1 ? 'speed' : undefined }) });
      return { id: j.id };
    },
    async poll(ref, net) {
      const j = await net.call(`/async-result/${encodeURIComponent(ref.id)}`);
      if (j.task_status === 'SUCCESS') return { done: true, items: need((j.video_result || []).map((v) => ({ url: v.url, mime: 'video/mp4' }))) };
      if (j.task_status === 'FAIL') return failed('Z.ai no pudo generar el vídeo.');
      return pending;
    },
  },
  /** La API /videos de OpenAI. La oficial cerró el 24-09-2026, pero el formato sigue vivo en pasarelas compatibles. */
  openai: {
    async submit(r, net) {
      try {
        const j = await net.call('/videos', { method: 'POST', timeout: 120000, body: clean({ model: r.model, prompt: r.prompt, size: VIDEO_SIZE[r.ratio] || VIDEO_SIZE['16:9'], seconds: r.duration ? String(r.duration) : undefined }) });
        return { id: j.id };
      } catch (e) {
        if ([404, 410].includes(e.status)) throw new MediaError('OpenAI cerró su API de vídeo (Sora) el 24 de septiembre de 2026. Puedes usar Sora u otros modelos por OpenRouter o Together, o crear el vídeo en la pestaña HTML.', { kind: 'unsupported', status: e.status });
        throw e;
      }
    },
    poll: (ref, net) => VIDEO.generic.poll(ref, net),
  },
  together: {
    async submit(r, net) {
      const frames = [r.start && { input_image: r.start, frame: 'first' }, r.end && { input_image: r.end, frame: 'last' }].filter(Boolean);
      const j = await net.call('/videos', { method: 'POST', base: net.ep.url.replace(/\/v1\/?$/, '/v2'), body: clean({ model: r.model, prompt: r.prompt, seconds: r.duration ? String(r.duration) : undefined, resolution: r.resolution, ratio: r.ratio,
        seed: num(r.seed), negative_prompt: r.negative, generate_audio: r.audio === undefined ? undefined : !!r.audio, media: frames.length ? { frame_images: frames } : undefined }) });
      return { id: j.id };
    },
    async poll(ref, net) {
      const j = await net.call(`/videos/${encodeURIComponent(ref.id)}`, { base: net.ep.url.replace(/\/v1\/?$/, '/v2') });
      if (j.status === 'completed') return { done: true, items: need(j.outputs?.video_url ? [{ url: j.outputs.video_url, mime: 'video/mp4' }] : []) };
      if (j.status === 'failed') return failed(j.error?.message);
      return pending;
    },
  },
  siliconflow: {
    async submit(r, net) {
      const j = await net.call('/video/submit', { method: 'POST', body: clean({ model: r.model, prompt: r.prompt, image_size: VIDEO_SIZE[r.ratio] || VIDEO_SIZE['16:9'], negative_prompt: r.negative, seed: num(r.seed), image: r.start }) });
      return { id: j.requestId };
    },
    async poll(ref, net) {
      const j = await net.call('/video/status', { method: 'POST', body: { requestId: ref.id } });
      if (j.status === 'Succeed') return { done: true, items: need((j.results?.videos || []).map((v) => ({ url: v.url, mime: 'video/mp4' }))) };
      if (j.status === 'Failed') return failed(j.reason);
      return pending;
    },
  },
  veo: {
    async submit(r, net) {
      const frame = (d) => ({ inlineData: { mimeType: mimeOf(d), data: b64Of(d) } });
      const j = await net.call(`/models/${encodeURIComponent(r.model)}:predictLongRunning`, { method: 'POST', base: geminiBase(net.ep), auth: { 'x-goog-api-key': net.ep.key },
        body: { instances: [clean({ prompt: r.prompt, image: r.start ? frame(r.start) : undefined, lastFrame: r.end ? frame(r.end) : undefined })],
          parameters: clean({ aspectRatio: r.ratio, resolution: r.resolution, durationSeconds: r.duration ? String(r.duration) : undefined }) } });
      return { id: j.name };
    },
    async poll(ref, net) {
      const j = await net.call(`/${String(ref.id).replace(/^\/+/, '')}`, { base: geminiBase(net.ep), auth: { 'x-goog-api-key': net.ep.key } });
      if (j.error) return failed(j.error.message);
      if (!j.done) return pending;
      const uri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      return uri ? { done: true, items: [{ url: uri, auth: { 'x-goog-api-key': true }, mime: 'video/mp4' }] } : failed('Google no devolvió el vídeo: puede que su filtro de contenido lo haya bloqueado.');
    },
  },
  minimax: {
    async submit(r, net) {
      const content = [{ type: 'text', text: r.prompt }, r.start && { type: 'image_url', image_url: { url: r.start }, role: 'first_frame' }, r.end && { type: 'image_url', image_url: { url: r.end }, role: 'last_frame' }].filter(Boolean);
      const j = await net.call('/video_generation', { method: 'POST', base: net.ep.url.replace(/\/v1\/?$/, '/v2'), body: clean({ model: r.model, content, resolution: r.resolution || '768P', duration: num(r.duration) || 6, ratio: r.start ? undefined : r.ratio, generate_audio: r.audio === undefined ? undefined : !!r.audio }) });
      minimaxOk(j);
      return { id: j.task_id };
    },
    async poll(ref, net) {
      const raw = await net.call(`/query/video_generation/${encodeURIComponent(ref.id)}`, { base: net.ep.url.replace(/\/v1\/?$/, '/v2') });
      const j = raw.task || raw;
      if (j.status === 'succeeded') return { done: true, items: need(j.content?.url ? [{ url: j.content.url, mime: 'video/mp4' }] : []) };
      if (['failed', 'cancelled'].includes(j.status)) return failed(j.error?.message || `Trabajo ${j.status}`);
      return pending;
    },
  },
  /** Servidor propio con el formato /videos: crear, consultar y descargar. */
  generic: {
    async submit(r, net) {
      const j = await net.call('/videos', { method: 'POST', timeout: 120000, body: clean({ model: r.model, prompt: r.prompt, size: VIDEO_SIZE[r.ratio] || VIDEO_SIZE['16:9'], seconds: r.duration ? String(r.duration) : undefined, seed: num(r.seed), negative_prompt: r.negative, image: r.start }) });
      if (!j.id) throw new MediaError('El servidor no devolvió un id de trabajo: no parece una API de vídeo compatible.');
      return { id: j.id };
    },
    async poll(ref, net) {
      const j = await net.call(`/videos/${encodeURIComponent(ref.id)}`);
      if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(j.status)) return failed(j.error?.message || j.error);
      if (!['completed', 'succeeded', 'success', 'done'].includes(j.status)) return { done: false, progress: num(j.progress) };
      const url = j.url || j.video_url || j.video?.url || j.outputs?.video_url;
      return { done: true, items: [url ? { url, mime: 'video/mp4' } : { url: `${net.ep.url}/videos/${encodeURIComponent(ref.id)}/content`, auth: true, mime: 'video/mp4' }] };
    },
  },
};

/** Genera imágenes. net = { ep, call(path, { method, body, base, auth, timeout }) }. */
/**
 * Convierte un fallo técnico en un mensaje que dice qué pasó y qué hacer. action: 'settings' si hay que revisar la conexión,
 * 'retry' si volver a intentarlo puede funcionar.
 */
export function friendlyMediaError(e, { provider = 'El proveedor', model = '', local = false } = {}) {
  if (e?.name === 'AbortError') return e;
  const detail = `${e?.detail || ''} ${e?.message || ''}`;
  const out = (message, action = '', kind = e?.kind) => Object.assign(new MediaError(message, { kind: kind || 'provider', status: e?.status || 0 }), { action, cause: e });
  if (/safety|nsfw|moderat|content.?(policy|filter)|sensitive|inappropriate|prohibited/i.test(detail)) return out(`El filtro de contenido de ${provider} rechazó este pedido. Cambia el prompt y prueba otra vez.`, '', 'empty');
  if (e?.status === 402 || /insufficient|out of credit|no credit|quota|balance|billing|exhausted/i.test(detail)) return out(`Te quedaste sin saldo o sin cuota en ${provider}. Recarga tu cuenta o elige otro modelo.`, 'settings');
  if (e?.status === 401 || e?.kind === 'auth') return out(`${provider} rechazó tu clave. Revísala en Ajustes → Conexiones.`, 'settings', 'auth');
  if (e?.status === 403 || e?.kind === 'forbidden') return out(`Tu cuenta de ${provider} no tiene acceso a ${model || 'este modelo'}.`, 'settings', 'forbidden');
  if (e?.status === 404 || e?.kind === 'model') return out(`${provider} no encuentra ${model || 'ese modelo'}. Elige otro de la lista.`, '', 'model');
  if (e?.status === 413) return out('La imagen o el pedido pesan demasiado para este proveedor. Usa una imagen más pequeña.');
  if (e?.status === 429 || e?.kind === 'rate') return out(`${provider} está limitando tus peticiones. Espera un momento y reinténtalo.`, 'retry', 'rate');
  if (e?.status >= 500 || e?.kind === 'down') return out(`${provider} tuvo un problema temporal. Reinténtalo en un momento.`, 'retry', 'down');
  if (e?.kind === 'timeout') return out(`${provider} tardó demasiado en responder. Reinténtalo o elige un modelo más rápido.`, 'retry', 'timeout');
  if (e?.status === 0 || e?.kind === 'network') return out(local ? `No hay conexión con ${provider}. Comprueba que esté abierto en esta PC.` : `No se pudo conectar con ${provider}. Revisa tu conexión a internet.`, 'retry', 'network');
  if ((e?.status === 400 || e?.status === 422) && e?.detail) return out(`${provider} no aceptó el pedido: ${String(e.detail).slice(0, 220)}`);
  return e;
}
/** ¿Tiene sentido repetir automáticamente? Solo con fallos pasajeros, nunca con los que dependen del pedido. */
export const isTransient = (e) => e?.name !== 'AbortError' && ([0, 408, 429, 500, 502, 503, 504].includes(e?.status) || ['network', 'rate', 'down', 'timeout'].includes(e?.kind));

/** Un 404 en el formato de OpenAI casi siempre significa que ese proveedor no tiene esa API: se dice claro. */
const explainMissing = (ep, what) => (e) => {
  if (e.status === 404 && !e.detail) throw new MediaError(`${providerOf(ep).name} no tiene una API de ${what} compatible en esta URL, o ese modelo no existe.`, { kind: 'unsupported', status: 404 });
  throw e;
};
export async function generateImage(req, net) {
  const protocol = protocolOf(net.ep, 'image');
  if (!protocol) throw new MediaError(`${providerOf(net.ep).name} no ofrece generación de imágenes.`, { kind: 'unsupported' });
  return IMAGE[protocol](req, net).catch(explainMissing(net.ep, 'imágenes'));
}
export async function submitVideo(req, net) {
  const protocol = protocolOf(net.ep, 'video');
  if (!protocol) throw new MediaError(`${providerOf(net.ep).name} no ofrece una API de vídeo.`, { kind: 'unsupported' });
  return VIDEO[protocol].submit(req, net).catch(explainMissing(net.ep, 'vídeo'));
}
export const pollVideo = (ref, net) => VIDEO[protocolOf(net.ep, 'video')].poll(ref, net);

/* ---------------------------------------------------------------- prompts */
/** «un coche {rojo|azul}» → una variante por opción (como mucho `max`). Sin llaves, el mismo texto. */
export function expandPrompt(text, max = 8) {
  let out = [String(text)];
  for (;;) {
    const m = out[0].match(/\{([^{}]*\|[^{}]*)\}/);
    if (!m) return out;
    out = out.flatMap((t) => m[1].split('|').map((o) => t.replace(m[0], o.trim()))).slice(0, max);
  }
}

export const GUIDE_FIELDS = [
  ['subject', 'Sujeto', 'Quién o qué aparece'],
  ['action', 'Acción', 'Qué está pasando'],
  ['place', 'Lugar', 'Dónde y cuándo'],
  ['style', 'Estilo', 'Fotografía, óleo, anime, render 3D…'],
  ['light', 'Luz', 'Hora dorada, neón, contraluz…'],
  ['camera', 'Cámara', 'Plano, lente, ángulo, movimiento'],
  ['palette', 'Paleta', 'Colores dominantes'],
  ['details', 'Detalles', 'Texturas, texto exacto, lo que no puede faltar'],
];
/** Une los campos guiados en un prompt, en el orden que mejor entienden los modelos. */
export function composePrompt(f = {}) {
  const head = [f.subject, f.action].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  const parts = [head, f.place, f.style && `Estilo: ${f.style}`, f.light && `Luz: ${f.light}`, f.camera && `Cámara: ${f.camera}`, f.palette && `Paleta: ${f.palette}`, f.details]
    .map((x) => String(x || '').trim()).filter(Boolean);
  return parts.join('. ').replace(/\.\./g, '.');
}

/** Instrucción para que el modelo de chat convierta una idea en un buen prompt. */
export function improveInstruction(kind) {
  return `Eres un director de arte experto en prompts para modelos de generación de ${kind === 'video' ? 'vídeo' : 'imagen'}. Reescribe la idea del usuario como UN solo prompt listo para usar, concreto y visual: sujeto, composición, entorno, estilo, luz, color y ${kind === 'video' ? 'movimiento de cámara y acción en el tiempo' : 'lente o técnica'}. Conserva todo lo que el usuario pidió y cualquier texto literal entre comillas; no inventes marcas ni cambies el tema. Máximo 90 palabras, en el idioma del usuario. Responde SOLO con el prompt, sin comillas ni explicaciones.`;
}

/* ---------------------------------------------------------------- pedirlo en el chat */
const NOT_MEDIA = /docker|contenedor|container|\biso\b|disco|base64|\bcss\b|html|python|javascript|typescript|\bjs\b|c[oó]digo|\bcode\b|script|funci[oó]n|function|componente|component|etiqueta|\bsvg\b|bucket|kubernetes|ffmpeg|\breact\b|\bapi\b|programa|tutorial|guion|gui[oó]n|resumen|summary/i;
const LEAD = '(?:(?:por\\s+favor|porfa|oye|hola|please|hey)[,\\s]+)?(?:(?:me\\s+)?(?:puedes|podr[ií]as|can\\s+you|could\\s+you)\\s+)?';
const VERB = '(?:gen[eé]ra(?:me|r)?|cr[eé]a(?:me|r)?|haz(?:me)?|hacer|dib[uú]ja(?:me|r)?|p[ií]nta(?:me|r)?|il[uú]stra(?:me|r)?|dis[eé][ñn]a(?:me|r)?|quiero|necesito|dame|generate|create|make|draw|paint|render)';
const IMG_NOUN = 'im[aá]gen(?:es)?|images?|fotos?|fotograf[ií]as?|photos?|pictures?|ilustraci[oó]n(?:es)?|illustrations?|dibujos?|drawings?|logos?|p[oó]sters?|posters?|retratos?|portraits?|wallpapers?|fondos?\\s+de\\s+pantalla';
const VID_NOUN = 'v[ií]deos?|clips?|animaci[oó]n(?:es)?|animations?';
const intentRe = (noun) => new RegExp(`^\\s*${LEAD}${VERB}\\s+(?:(?:una?|unas?|unos|otra|otro|an?|the|some)\\s+)?(?:[\\p{L}\\d-]+\\s+)?(${noun})\\b[\\s,:]*(?:(?:de|del|con|sobre|que|donde|en\\s+la\\s+que|of|with|about|showing)\\s+)?([\\s\\S]{3,})$`, 'iu');
const KEEP_NOUN = /logo|p[oó]ster|poster|retrato|portrait|wallpaper|fondo|ilustraci|illustration|dibujo|drawing/i;
const HTML_VIDEO_RE = /^\s*(?:(?:por\s+favor|porfa|oye)[,\s]+)?(?:gen[eé]ra(?:me)?|cr[eé]a(?:me)?|haz(?:me)?|dise[ñn]a(?:me)?|quiero|necesito|make|create|generate)\b[^.?!]*?\b(?:v[ií]deo|video|animaci[oó]n|animation|clip)\b[^.?!]*?\b(?:html|motion\s+graphics?|gr[aá]ficos\s+animados)\b/i;
const EDIT_RE = /^\s*(?:(?:ahora|y|pero)[,\s]+)?(?:hazla|hazlo|ponle|p[oó]n|c[aá]mbia(?:le|la|lo)?|qu[ií]ta(?:le)?|a[nñ]ade|a[nñ][aá]dele|agr[eé]ga(?:le)?|ed[ií]ta(?:la|lo)|mejora(?:la|lo)|make\s+it|change|add|remove|turn\s+it)\b/i;
const ANIMATE_RE = /^\s*(?:(?:ahora|y|pero)[,\s]+)?(?:an[ií]ma(?:la|lo|r)|convi[eé]rte(?:la|lo)\s+en\s+(?:un\s+)?v[ií]deo|haz(?:la|lo)?\s+(?:un\s+)?v[ií]deo|dale\s+movimiento|animate\s+(?:it|this))/i;

/**
 * ¿El mensaje pide generar algo? { kind, prompt, from?: 'edit'|'animate' } o null. Es deliberadamente estricto: tiene que
 * ser una orden («genera una imagen de…»), no una pregunta sobre imágenes de Docker o cómo crear un vídeo en Python.
 * last = id del último resultado de la conversación, para «hazla más azul» o «anímala».
 */
export function detectMediaIntent(text, { last = null } = {}) {
  const t = String(text || '').replace(/^[¿¡\s]+/, '').trim();
  if (!t || t.startsWith('/') || t.length > 2000 || /[?¿]\s*$/.test(t) && !/^\s*(?:me\s+)?(?:puedes|podr[ií]as|can\s+you|could\s+you)/i.test(t)) return null;
  if (HTML_VIDEO_RE.test(t)) return { kind: 'html', prompt: t };
  if (last?.kind === 'image' && ANIMATE_RE.test(t)) return { kind: 'video', prompt: t, from: 'animate' };
  if (last?.kind === 'image' && EDIT_RE.test(t) && !NOT_MEDIA.test(t)) return { kind: 'image', prompt: t, from: 'edit' };
  if (NOT_MEDIA.test(t)) return null;
  for (const [kind, noun] of [['video', VID_NOUN], ['image', IMG_NOUN]]) {
    const m = t.match(intentRe(noun));
    if (m) return { kind, prompt: `${KEEP_NOUN.test(m[1]) ? `${m[1]} de ` : ''}${m[2].trim().replace(/[?!]+$/, '')}` };
  }
  return null;
}
