// Vídeo HTML en el navegador: abre la composición en un iframe aislado, la previsualiza y la codifica a MP4.
import { buildCompositionDoc, extractHtml, htmlVideoSkill, lintComposition, HV_RATIOS } from './htmlvideo.js';
import { muxMp4 } from './mp4.js';
import { buildComposition, fallbackBoard, normalizeBoard, parseStoryboard, storyboardPrompt } from './htmlscenes.js';
import { encodeSoundtrack, renderSoundtrack, soundOf } from './htmlaudio.js';

// Tipografías libres (SIL OFL) que puede usar una composición; se incrustan solo las que aparecen en ella
const FONT_FILES = {
  Anton: ['video/anton', 400], 'Bebas Neue': ['video/bebas-neue', 400], 'Archivo Black': ['video/archivo-black', 400], 'Playfair Display': ['video/playfair-800', 800],
  'DM Serif Display': ['video/dm-serif', 400], 'Space Grotesk': ['video/space-grotesk-700', 700], 'IBM Plex Sans': ['IBMPlexSans-500', 500], 'IBM Plex Mono': ['IBMPlexMono-500', 500],
};
const fontCache = new Map();
async function fontFace(family, [file, weight]) {
  if (!fontCache.has(family)) {
    fontCache.set(family, fetch(new URL(`../../fonts/${file}.woff2`, import.meta.url)).then((r) => r.blob()).then((b) => new Promise((resolve) => {
      const f = new FileReader(); f.onload = () => resolve(f.result.split(',')[1]); f.readAsDataURL(b);
    })));
  }
  const b64 = await fontCache.get(family);
  return `@font-face{font-family:"${family}";font-weight:${weight === 400 ? '100 900' : weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
}
/** La composición con sus fuentes dentro: el iframe no tiene red. */
export async function withFonts(html) {
  const used = Object.entries(FONT_FILES).filter(([family]) => html.includes(family));
  if (!used.length) return html;
  const faces = await Promise.all(used.map(([family, file]) => fontFace(family, file).catch(() => '')));
  return `<style>${faces.join('')}</style>${html}`;
}

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
async function encoders({ width, height, fps }) {
  if (typeof VideoEncoder === 'undefined') return [];
  const found = [];
  const bitrate = Math.round(width * height * fps * 0.14);
  for (const [codec, box] of [['avc1.640028', 'avc1'], ['avc1.4D0028', 'avc1'], ['avc1.42E028', 'avc1'], ['vp09.00.40.08', 'vp09']]) {
    const config = { codec, width, height, framerate: fps, bitrate, latencyMode: 'quality', ...(box === 'avc1' ? { avc: { format: 'avc' } } : {}) };
    const r = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (r?.supported) found.push({ config, box });
  }
  return found;
}

/** Convierte la composición en un MP4, con su banda sonora si la lleva. onProgress(0..1). */
export async function exportHtmlVideo(source, { ratio = '16:9', duration, fps = 30, signal, onProgress } = {}) {
  const html = await withFonts(source);
  const { width, height } = sizeOfRatio(ratio);
  const list = await encoders({ width, height, fps });
  if (!list.length) throw new Error('Este dispositivo no puede codificar vídeo. Exporta desde la app de escritorio o desde Chrome o Edge.');
  let last = null;
  // un códec anunciado puede fallar al empezar (pasa con aceleración por hardware): entonces se usa el siguiente
  for (const enc of list) {
    try { return await encodeWith(enc, { source, html, width, height, duration, fps, signal, onProgress }); } catch (e) {
      if (e.name === 'AbortError' || e.fatal) throw e;
      last = e;
    }
  }
  throw last;
}

async function encodeWith(enc, { source, html, width, height, duration, fps, signal, onProgress }) {
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
          if (m.type === 'capture-error') { off(); reject(Object.assign(new Error(/insecure|tainted|security/i.test(m.message) ? 'Este navegador no permite exportar el vídeo. Usa la app de escritorio, Android, Chrome o Edge.' : `No se pudo dibujar el fotograma ${i + 1}: ${m.message}`), { fatal: true })); }
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
    const sound = soundOf(source);
    let audio = null;
    if (sound) {
      try { audio = await encodeSoundtrack(await renderSoundtrack({ ...sound, duration: seconds })); } catch { audio = null; } // sin sonido antes que sin vídeo
    }
    const file = muxMp4({ codec: enc.box, width, height, fps, description, samples, audio });
    return new Blob([file], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    comp.close();
  }
}

/** Revisa la composición en un iframe oculto: lo que se sale, se pisa o no se lee. */
export async function auditComposition(source, { ratio, duration }) {
  const { width, height } = sizeOfRatio(ratio);
  const comp = mountComposition(await withFonts(source), { width, height, duration, hidden: true });
  try {
    await comp.ready;
    const times = Array.from({ length: Math.min(12, Math.ceil(duration * 1.5)) }, (_, i) => ((i + 0.6) / Math.min(12, Math.ceil(duration * 1.5))) * duration);
    const issues = await new Promise((resolve) => {
      const off = comp.on((m) => { if (m.type === 'audit') { off(); resolve(m.issues); } });
      comp.send({ cmd: 'audit', times });
      setTimeout(() => resolve([]), 8000);
    });
    return [...issues, ...comp.errors.map((message) => ({ code: 'script', message }))];
  } catch (e) { return [{ code: 'script', message: e.message }]; } finally { comp.close(); }
}

/**
 * Vídeo dirigido: el modelo escribe solo el guion y las plantillas lo convierten en composición. Si el modelo falla o
 * no devuelve un guion válido, el vídeo sale igualmente a partir del pedido.
 */
export async function directComposition({ brief, ratio = '16:9', duration = 10, theme = '', sound = true, previous = null, chatText, signal, onStatus }) {
  onStatus?.('Escribiendo el guion…');
  const user = previous ? `Guion actual:\n${JSON.stringify(previous)}\n\nCambios pedidos: ${brief}\nDevuelve el guion completo con los cambios.` : `Pedido: ${brief}`;
  let board = null;
  let note = '';
  try {
    const system = storyboardPrompt({ duration });
    const first = await chatText(system, user, signal);
    board = parseStoryboard(first);
    if (!board) board = parseStoryboard(await chatText(system, `${user}\n\nTu respuesta anterior no era JSON válido. Responde solo con el JSON.`, signal));
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    note = e.message;
  }
  if (!board && previous) board = previous;
  if (!board) note ||= 'el modelo no devolvió un guion válido';
  const clean = normalizeBoard(board || fallbackBoard(brief), { duration, brief });
  onStatus?.('Montando el vídeo…');
  return { html: buildComposition(clean, { ratio, duration, theme, sound }), board: clean, issues: [], note };
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
  // se mira cómo queda de verdad y se le devuelve lo que falla, una vez
  onStatus?.('Revisando el resultado…');
  const seen = await auditComposition(html, { ratio, duration }).catch(() => []);
  if (seen.length) {
    onStatus?.('Corrigiendo lo que se ve mal…');
    const fixed = extractHtml(await chatText(system, `Al renderizar esta composición se detectó:\n${seen.map((x) => `- ${x.message}`).join('\n')}\nCorrígelo sin cambiar la idea.\n\n\`\`\`html\n${html}\n\`\`\``, signal).catch((e) => { if (e.name === 'AbortError') throw e; return ''; }));
    if (fixed && !lintComposition(fixed).length) html = fixed;
  }
  return { html, issues: lintComposition(html) };
}
