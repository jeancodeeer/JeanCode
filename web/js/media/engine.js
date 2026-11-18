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
const TEXT_ONLY = new Set(['anthropic', 'groq', 'cerebras', 'deepseek', 'cohere', 'moonshot', 'sambanova', 'ollama', 'lmstudio']);
// Vídeo solo donde la API está comprobada. OpenAI cerró su API de vídeo (Sora) el 24-09-2026.
const VIDEO_PROTOCOL = { openrouter: 'openrouter', gemini: 'veo', minimax: 'minimax', xai: 'xai', together: 'together', siliconflow: 'siliconflow', jean: 'generic', custom: 'generic', litellm: 'generic' };
const IMAGE_PROTOCOL = { openai: 'openai', openrouter: 'openrouter', gemini: 'gemini', minimax: 'minimax', xai: 'xai', together: 'together', siliconflow: 'siliconflow' };

/** Formato de la API de este proveedor para ese tipo de contenido, o null si no lo ofrece. */
export function protocolOf(ep, kind) {
  const p = providerOf(ep).id;
  if (TEXT_ONLY.has(p)) return null;
  return kind === 'video' ? VIDEO_PROTOCOL[p] || null : IMAGE_PROTOCOL[p] || 'generic';
}

/** 'image', 'video' o null: lo que informa el proveedor y, si no, el nombre del modelo. */
export function mediaKindOf(ep, id) {
  const c = capsOf(ep, id);
  const kind = c.video === true ? 'video' : c.image === true ? 'image' : VIDEO_MODEL.test(id) ? 'video' : IMAGE_MODEL.test(id) ? 'image' : null;
  return kind && protocolOf(ep, kind) ? kind : null;
}

// Modelos que el proveedor documenta pero no siempre devuelve en /models
const KNOWN = {
  minimax: [['image-01', 'image'], ['MiniMax-H3', 'video'], ['MiniMax-H3-Lite', 'video'], ['MiniMax-H3-Highspeed', 'video'], ['MiniMax-H3-Max', 'video']],
  xai: [['grok-imagine-image-2.0', 'image'], ['grok-imagine-video-1.5', 'video'], ['grok-imagine-video-1.5-lite', 'video'], ['grok-imagine-video', 'video']],
};
export const knownModels = (ep) => (KNOWN[providerOf(ep).id] || []).map(([id, kind]) => ({ id, kind, ep }));

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
      case 'openai': return { ...base, ratios: ['1:1', '3:2', '2:3'], qualities: ['auto', 'low', 'medium', 'high'], count: /dall-e-3/.test(id) ? 1 : 10, refs: /dall-e/.test(id) ? 0 : 16, background: !/dall-e/.test(id), mask: !/dall-e/.test(id) };
      case 'openrouter': return { ...base, ratios: [...R_COMMON, '21:9', '4:5', '5:4'], resolutions: ['1K', '2K', '4K'], qualities: ['auto', 'low', 'medium', 'high'], count: 10, refs: 16, seed: true, background: true };
      case 'gemini': return { ...base, ratios: [...R_COMMON, '21:9', '4:5', '5:4'], resolutions: ['1K', '2K', '4K'], refs: 14 };
      case 'minimax': return { ...base, ratios: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'], count: 9, refs: 1, seed: true };
      case 'xai': return { ...base, ratios: [...R_COMMON, '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20'], count: 10, refs: 5 };
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
    case 'xai': return { ...base, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'], resolutions: /1\.5/.test(id) ? ['480p', '720p', '1080p'] : ['480p', '720p'], durations: [4, 6, 8, 10, 12, 15], start: true };
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
  const list = [json?.data, json?.images, json?.output, json?.data?.image_base64, json?.data?.image_urls].find(Array.isArray) || [];
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

/* ---------------------------------------------------------------- imagen */
const IMAGE = {
  async openai(r, net) {
    const shared = clean({ model: r.model, prompt: r.prompt, n: r.count > 1 ? r.count : undefined, size: OPENAI_SIZE[r.ratio], quality: r.quality === 'auto' ? undefined : r.quality,
      background: r.background ? 'transparent' : undefined, ...(/dall-e/.test(r.model) ? { response_format: 'b64_json' } : {}) });
    if (r.refs?.length) {
      return need(parseImages(await net.call('/images/edits', { method: 'POST', body: clean({ ...shared, images: r.refs.map((image_url) => ({ image_url })), mask: r.mask ? { image_url: r.mask } : undefined }) })));
    }
    return need(parseImages(await net.call('/images/generations', { method: 'POST', body: shared })));
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
    const body = clean({ model: r.model, prompt: r.prompt, n: r.count > 1 ? r.count : undefined, aspect_ratio: r.ratio, response_format: 'b64_json' });
    const refs = (r.refs || []).map((url) => ({ url, type: 'image_url' }));
    const path = refs.length ? '/images/edits' : '/images/generations';
    const full = refs.length === 1 ? { ...body, image: refs[0] } : refs.length ? { ...body, images: refs } : body;
    return need(parseImages(await tolerant(full, ['response_format', 'aspect_ratio', 'n'], (b) => net.call(path, { method: 'POST', body: b })), 'image/jpeg'));
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
      return pending;
    },
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
export function generateImage(req, net) {
  const fn = IMAGE[protocolOf(net.ep, 'image')];
  if (!fn) throw new MediaError(`${providerOf(net.ep).name} no ofrece generación de imágenes.`, { kind: 'unsupported' });
  return fn(req, net);
}
export function submitVideo(req, net) {
  const api = VIDEO[protocolOf(net.ep, 'video')];
  if (!api) throw new MediaError(`${providerOf(net.ep).name} no ofrece una API de vídeo.`, { kind: 'unsupported' });
  return api.submit(req, net);
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
  if (last?.kind === 'image' && ANIMATE_RE.test(t)) return { kind: 'video', prompt: t, from: 'animate' };
  if (last?.kind === 'image' && EDIT_RE.test(t) && !NOT_MEDIA.test(t)) return { kind: 'image', prompt: t, from: 'edit' };
  if (NOT_MEDIA.test(t)) return null;
  for (const [kind, noun] of [['video', VID_NOUN], ['image', IMG_NOUN]]) {
    const m = t.match(intentRe(noun));
    if (m) return { kind, prompt: `${KEEP_NOUN.test(m[1]) ? `${m[1]} de ` : ''}${m[2].trim().replace(/[?!]+$/, '')}` };
  }
  return null;
}
