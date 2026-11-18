// Vídeo HTML en el navegador: abre la composición en un iframe aislado, la previsualiza y la codifica a MP4.
import { buildCompositionDoc, extractHtml, htmlVideoSkill, lintComposition, HV_RATIOS } from './htmlvideo.js';
import { muxMp4 } from './mp4.js';

export const sizeOfRatio = (ratio) => { const [width, height] = HV_RATIOS[ratio] || HV_RATIOS['16:9']; return { width, height }; };
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Carga una composición en un iframe sin privilegios. → { frame, send(msg), on(fn), ready: Promise<{ duration }>, close() }
 * Solo se atienden mensajes de ESE iframe y con su token.
 */
export function mountComposition(html, { width, height, duration, parent = document.body, hidden = false }) {
  const token = randomToken();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'Composición de vídeo');
  frame.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  frame.width = width;
  frame.height = height;
  frame.style.cssText = `border:0;width:${width}px;height:${height}px;${hidden ? 'position:fixed;left:-100000px;top:0;pointer-events:none' : ''}`;
  const listeners = new Set();
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
    setTimeout(() => reject(new Error('La composición no arrancó: revisa su código.')), 15000);
  });
  const errors = [];
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow || e.data?.token !== token) return;
    if (e.data.type === 'ready') settle.resolve({ duration: e.data.duration });
    if (e.data.type === 'error') errors.push(e.data.message);
    listeners.forEach((fn) => fn(e.data));
  };
  window.addEventListener('message', onMessage);
  frame.srcdoc = buildCompositionDoc(html, { width, height, duration, token });
  parent.appendChild(frame);
  return {
    frame, ready, errors,
    send: (m) => frame.contentWindow?.postMessage({ ...m, token }, '*'),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    close: () => { window.removeEventListener('message', onMessage); frame.remove(); },
  };
}

/** El primer códec que este dispositivo sabe codificar: H.264 si puede, VP9 si no. */
async function pickEncoder({ width, height, fps }) {
  if (typeof VideoEncoder === 'undefined') return null;
  const bitrate = Math.round(width * height * fps * 0.14);
  for (const [codec, box] of [['avc1.640028', 'avc1'], ['avc1.4D0028', 'avc1'], ['avc1.42E028', 'avc1'], ['vp09.00.40.08', 'vp09']]) {
    const config = { codec, width, height, framerate: fps, bitrate, latencyMode: 'quality', ...(box === 'avc1' ? { avc: { format: 'avc' } } : {}) };
    const r = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (r?.supported) return { config, box };
  }
  return null;
}

/** Convierte la composición en un MP4 (sin sonido). onProgress(0..1). */
export async function exportHtmlVideo(html, { ratio = '16:9', duration, fps = 30, signal, onProgress } = {}) {
  const { width, height } = sizeOfRatio(ratio);
  const enc = await pickEncoder({ width, height, fps });
  if (!enc) throw new Error('Este dispositivo no puede codificar vídeo. Exporta desde la app de escritorio o desde Chrome o Edge.');
  const comp = mountComposition(html, { width, height, duration, hidden: true });
  const samples = [];
  let description = null;
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
      if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description.buffer || meta.decoderConfig.description);
    },
    error: (e) => { failure = e; },
  });
  try {
    const info = await comp.ready;
    const seconds = Math.min(Number(info.duration) || duration, 120);
    const total = Math.max(1, Math.round(seconds * fps));
    encoder.configure(enc.config);
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (failure) throw failure;
      const bitmap = await new Promise((resolve, reject) => {
        const off = comp.on((m) => {
          if (m.type === 'frame' && m.i === i) { off(); resolve(m.bitmap); }
          if (m.type === 'capture-error') { off(); reject(new Error(`No se pudo dibujar el fotograma ${i + 1}: ${m.message}`)); }
        });
        comp.send({ cmd: 'capture', i, t: i / fps });
      });
      const frame = new VideoFrame(bitmap, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      bitmap.close();
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      onProgress?.((i + 1) / total);
    }
    await encoder.flush();
    if (failure) throw failure;
    const file = muxMp4({ codec: enc.box, width, height, fps, description, samples });
    return new Blob([file], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    comp.close();
  }
}

/**
 * El modelo de chat escribe la composición. Si lo que devuelve incumple el contrato, se le pide corregirlo una vez.
 * chatText(system, user, signal) → texto. previous + brief = pedir cambios sobre una composición existente.
 */
export async function writeComposition({ brief, ratio = '16:9', duration = 10, previous = '', chatText, signal, onStatus }) {
  const { width, height } = sizeOfRatio(ratio);
  const system = htmlVideoSkill({ width, height, duration });
  const user = previous
    ? `Esta es la composición actual:\n\`\`\`html\n${previous}\n\`\`\`\n\nCambios pedidos: ${brief}\n\nDevuelve la composición completa con los cambios.`
    : `Vídeo pedido: ${brief}`;
  onStatus?.('Escribiendo la composición…');
  let html = extractHtml(await chatText(system, user, signal));
  if (!html) throw new Error('El modelo no devolvió una composición HTML. Prueba otra vez o elige otro modelo de chat.');
  const issues = lintComposition(html);
  if (issues.length) {
    onStatus?.('Corrigiendo la composición…');
    const fixed = extractHtml(await chatText(system, `Corrige esta composición sin cambiar su idea:\n${issues.map((x) => `- ${x.message}`).join('\n')}\n\n\`\`\`html\n${html}\n\`\`\``, signal));
    if (fixed) html = fixed;
  }
  return { html, issues: lintComposition(html) };
}
