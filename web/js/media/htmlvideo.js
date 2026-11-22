// Vídeo con HTML: el modelo de chat escribe una composición animada y JeanCode la convierte en MP4 en este dispositivo,
// sin gastar créditos de un modelo de vídeo. El formato es el de HyperFrames (HeyGen, Apache-2.0): raíz con
// data-composition-id, clips con data-start y data-duration, y una línea de tiempo en pausa en window.__timelines.
// Aquí no hay GSAP ni Chrome headless: jcHvRuntime trae un reloj virtual y una versión propia de la API de timeline.

export const HV_RATIOS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
export const HV_DURATIONS = [5, 10, 15, 30];

/** Encargo para la primera pasada: el plan creativo, corto, antes de escribir código. */
export function treatmentPrompt({ width, height, duration, style }) {
  return `Eres director creativo de motion graphics. Vas a planificar un vídeo de ${width}×${height}, ${duration} s.

DIRECCIÓN DE ARTE
${style}

Escribe un plan breve en texto plano (máx. 220 palabras), sin código:
1. CONCEPTO: la idea visual en una frase (qué lo hace memorable).
2. PALETA: 3-4 colores en hexadecimal y para qué se usa cada uno.
3. TIPOGRAFÍA: familias (solo de: Anton, Bebas Neue, Archivo Black, Playfair Display, DM Serif Display, Space Grotesk, IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Mono) y tamaños.
4. ESCENAS: lista con segundo de inicio y fin, qué se ve, el texto exacto en pantalla y cómo entra y sale. Entre 3 y ${Math.max(4, Math.round(duration / 2))} escenas, cubriendo de 0 a ${duration} s sin huecos.
5. HILO CONDUCTOR: el elemento o movimiento que conecta las escenas (transiciones).
Respeta literalmente cualquier texto, marca o dato que dé el usuario.`;
}

/** Skill que recibe el modelo: el contrato técnico y el oficio. El estilo y el plan llegan aparte. */
export function htmlVideoSkill({ width, height, duration, sound = true }) {
  const big = Math.round(Math.min(width, height) * 0.12), small = Math.round(Math.min(width, height) * 0.045);
  return `Eres un motion designer y desarrollador front-end de primer nivel. Escribes desde cero UNA composición HTML/CSS/JS que se graba fotograma a fotograma como vídeo de ${width}×${height} px, ${duration} s, 30 fps. Debe parecer hecha por un estudio, no una plantilla.

FORMATO
- Responde SOLO con un bloque \`\`\`html completo. Sin explicaciones antes ni después.
- Raíz obligatoria: <div id="stage" data-composition-id="main" data-duration="${duration}"${sound ? ' data-music="…" data-cues="…"' : ''}>. Todo dentro, posicionado en px para un lienzo exacto de ${width}×${height}. Pon tus <style> y <script> después de la raíz.
- Escenas: cada una en un contenedor class="clip" data-start="s" data-duration="s" (solo se ve dentro de su intervalo). Puedes solapar clips para transiciones.${sound ? `
- Música (síntesis propia, opcional pero recomendada): data-music="drive|tech|bounce|elegant|warm|opium" según el tono, y data-cues con los segundos de cada cambio de escena, separados por comas.` : ''}

CÓMO ANIMAR (el tiempo es virtual: la app lo avanza y captura; todo debe depender solo del tiempo)
Elige lo que mejor sirva; puedes combinarlo:
1. Línea de tiempo estilo GSAP (recomendado para coreografía): const tl = gsap.timeline({ paused: true }); tl.from/to/fromTo/set(selector, { ...props, duration, ease, stagger }, posición); al final window.__timelines["main"] = tl;
   Posiciones: número absoluto en segundos, "+=0.2", "-=0.3", "<", ">", etiquetas. Eases: power1-4, sine, expo, circ, back, elastic, bounce con .in/.out/.inOut, "none". Props: x, y, xPercent, yPercent, scale, scaleX, scaleY, rotation, skewX, skewY, opacity, autoAlpha, transformOrigin, colores, filter, clipPath, backgroundPosition, strokeDashoffset, variables CSS (--algo) y cualquier propiedad CSS numérica. repeat finito y yoyo.
2. CSS @keyframes con animation-delay en segundos absolutos y animation-fill-mode: both (la app las sincroniza con el tiempo del vídeo).
3. HV.onFrame(function (t) { ... }) para lo procedural: contadores, partículas, gráficos en <canvas> 2D, ruido, ondas. t = segundos. Math.random está sembrado y se resiembra en cada fotograma: genera datos fijos una vez fuera de onFrame.
4. Ayuda: HV.split(selector, "words"|"chars") parte el texto en spans .hv-w (inline-block) para animarlo con stagger.

LÍMITES TÉCNICOS
- Sin red: nada de CDN, <link>, <script src>, @import ni imágenes remotas. Usa CSS, SVG en línea (formas, paths, filtros feTurbulence/feGaussianBlur, degradados), <canvas> y data: URI. Sin <video>, <audio>, <iframe>, backdrop-filter ni mix-blend-mode.
- Fuentes disponibles (ya incluidas): "Anton", "Bebas Neue", "Archivo Black", "Playfair Display", "DM Serif Display", "Space Grotesk", "IBM Plex Sans", "IBM Plex Sans Condensed", "IBM Plex Mono". Ninguna otra.
- No animes display/visibility de un .clip (lo controla la app): anima sus hijos. No mezcles un transform de CSS fijo con transformaciones animadas en el mismo elemento: envuelve en otro div.
- Nada infinito (repeat: -1, animation infinite): todo tiene final.

OFICIO (lo que separa un vídeo bueno de uno malo)
- Concepto visual fuerte y coherente; fondos con profundidad (capas, degradados, formas, textura), nunca un color plano solo.
- Tipografía protagonista: texto principal ≥ ${big} px, secundario ≥ ${small} px. Máximo ~7 palabras en pantalla a la vez. Cada texto visible el tiempo suficiente para leerlo (~0.3 s por palabra + 0.6 s).
- Movimiento con intención: entradas 0.4-0.9 s (power3.out / expo.out), salidas más cortas (power2.in), stagger 0.03-0.08 s, transiciones solapadas; algo se mueve siempre (deriva lenta del fondo, parallax) pero nunca todo a la vez.
- Composición: usa todo el encuadre, jerarquía clara (un protagonista por escena), alineaciones deliberadas, zona segura del 90 %${height > width ? ', y en vertical deja libre el 15 % inferior' : ''}. Nada se sale del encuadre ni se pisa sin querer: antes de que algo ocupe un lugar, lo anterior ya salió.
- El primer fotograma ya muestra algo atractivo (no negro). El cierre se sostiene ≥ 0.8 s.
- Respeta literalmente textos, marcas y datos del usuario. Idioma del texto en pantalla: el del pedido.`;
}

/** El HTML de la respuesta del modelo. */
export function extractHtml(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const fence = t.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  const html = (fence ? fence[1] : t).trim();
  return /<[a-z][\s\S]*>/i.test(html) ? html : '';
}

/** Problemas que harían que el vídeo salga mal o distinto cada vez. [{ code, message }] */
export function lintComposition(html) {
  const s = String(html || '');
  const out = [];
  const add = (code, message) => out.push({ code, message });
  const code = (s.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join('\n');
  if (!/data-composition-id\s*=/.test(s)) add('root', 'Falta la raíz con data-composition-id.');
  if (!/data-duration\s*=/.test(s)) add('duration', 'Falta data-duration en la raíz.');
  if (/<script\b[^>]*\bsrc\s*=/i.test(s)) add('script-src', 'No se pueden cargar scripts externos.');
  if (/<link\b/i.test(s)) add('link', 'No se pueden cargar hojas de estilo externas: usa <style>.');
  if (/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import/i.test(s)) add('remote', 'Hay recursos remotos: el render no tiene red. Usa SVG o data: URI.');
  if (/<(?:video|audio|iframe)\b/i.test(s)) add('media', 'No se admiten <video>, <audio> ni <iframe>.');
  if (/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(code)) add('network', 'La composición no tiene red.');
  if (/repeat\s*:\s*-1/.test(code) || /animation[^;{}]*\binfinite\b/i.test(s)) add('infinite', 'Hay animaciones infinitas: todo debe tener final.');
  if (/gsap\.timeline/.test(code) && !/__timelines/.test(code)) add('register', 'Registra la línea en window.__timelines["main"].');
  if (/gsap\.timeline\((?![^)]*paused\s*:\s*true)/.test(code)) add('paused', 'La línea debe crearse con { paused: true }.');
  return out;
}

/** Arregla lo que se puede arreglar sin el modelo: raíz que falta, infinitos y la música si no se quiere. */
export function repairComposition(html, { duration, width, height, sound = true }) {
  let s = String(html || '').replace(/<!doctype[^>]*>/gi, '').replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '').trim();
  if (!/data-composition-id\s*=/.test(s)) {
    const scripts = (s.match(/<script\b[\s\S]*?<\/script>/gi) || []).join('\n');
    const styles = (s.match(/<style\b[\s\S]*?<\/style>/gi) || []).join('\n');
    const body = s.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
    s = `<div id="stage" data-composition-id="main" data-duration="${duration}" style="position:relative;width:${width}px;height:${height}px;overflow:hidden">${body}</div>\n${styles}\n${scripts}`;
  } else if (!/data-composition-id[^>]*data-duration|data-duration[^>]*data-composition-id/.test(s)) {
    s = s.replace(/data-composition-id\s*=\s*(["'][^"']*["'])/, `data-composition-id=$1 data-duration="${duration}"`);
  }
  s = s.replace(/repeat\s*:\s*-1/g, 'repeat: 0').replace(/(animation[^;{}]*?)\binfinite\b/gi, '$1 1');
  if (!sound) s = s.replace(/\sdata-(?:music|cues)\s*=\s*("[^"]*"|'[^']*')/g, '');
  return s;
}

/** Quita del HTML lo que nunca debe llegar al documento, aunque el modelo lo escriba. */
function sanitize(html) {
  return String(html)
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<(?:meta|base|link|title)\b[^>]*>(?:\s*<\/(?:meta|base|link|title)>)?/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
    .replace(/<(iframe|object|embed)\b[\s\S]*?(?:<\/\1>|\/>|>)/gi, '');
}

/**
 * Documento para un iframe con sandbox="allow-scripts": origen opaco, sin red (CSP) y sin acceso a la app.
 * token identifica sus mensajes.
 */
export function buildCompositionDoc(html, { width, height, duration, fps = 30, token = '', raster = false }) {
  const cfg = JSON.stringify({ width, height, duration, fps, token, raster }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:">
<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}</style>
<script>(${jcHvRuntime.toString()})(${cfg});</script></head><body>${sanitize(html)}<script>window.__jcHvReady();</script></body></html>`;
}

/* Corre DENTRO del iframe: solo puede usar lo que hay en esta función. */
export function jcHvRuntime(cfg) {
  const W = window;
  const post = (m, transfer) => parent.postMessage({ ...m, token: cfg.token }, '*', transfer || []);
  W.addEventListener('error', (e) => post({ type: 'error', message: String(e.message || 'error de script') }));
  W.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String(e.reason?.message || e.reason) }));

  /* ---- reloj virtual: el mismo tiempo da siempre el mismo fotograma ---- */
  let T = 0;
  const realTimeout = W.setTimeout.bind(W); // un iframe fuera de pantalla o una ventana en segundo plano no reciben requestAnimationFrame
  const BASE = 1767225600000;
  const RealDate = Date;
  W.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(BASE + T * 1000); } static now() { return BASE + T * 1000; } };
  try { Object.defineProperty(performance, 'now', { value: () => T * 1000 }); } catch { /* el navegador no deja */ }
  let seed = 0x2f6e2b1;
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const timers = new Map();
  let timerId = 1;
  W.setTimeout = (fn, ms = 0, ...a) => { timers.set(timerId, { fn, at: T + ms / 1000, a }); return timerId++; };
  W.setInterval = (fn, ms = 16, ...a) => { timers.set(timerId, { fn, at: T + ms / 1000, every: Math.max(ms, 1) / 1000, a }); return timerId++; };
  W.clearTimeout = W.clearInterval = (id) => timers.delete(id);
  let frames = [];
  W.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  W.cancelAnimationFrame = () => {};

  /* ---- curvas ---- */
  const power = (p) => ({ in: (t) => t ** p, out: (t) => 1 - (1 - t) ** p, inOut: (t) => (t < 0.5 ? (2 * t) ** p / 2 : 1 - (2 * (1 - t)) ** p / 2) });
  const fromIn = (f) => ({ in: f, out: (t) => 1 - f(1 - t), inOut: (t) => (t < 0.5 ? f(2 * t) / 2 : 1 - f(2 * (1 - t)) / 2) });
  const bounceOut = (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; };
  const CURVES = {
    power1: power(2), power2: power(3), power3: power(4), power4: power(5), quad: power(2), cubic: power(3), quart: power(4), quint: power(5), strong: power(5),
    sine: fromIn((t) => 1 - Math.cos((t * Math.PI) / 2)), expo: fromIn((t) => (t === 0 ? 0 : 2 ** (10 * t - 10))), circ: fromIn((t) => 1 - Math.sqrt(1 - t * t)),
    back: fromIn((t) => 2.70158 * t * t * t - 1.70158 * t * t),
    elastic: fromIn((t) => (t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)))),
    bounce: fromIn((t) => 1 - bounceOut(1 - t)),
  };
  const easeOf = (e) => {
    if (typeof e === 'function') return e;
    if (e === 'none' || e === 'linear') return (t) => t;
    const [name, kind = 'out'] = String(e || 'power1.out').replace(/\(.*\)$/, '').split('.');
    return CURVES[name]?.[kind] || CURVES.power1.out;
  };

  /* ---- valores ---- */
  const TRANSFORM = { x: 0, y: 0, z: 0, xPercent: 0, yPercent: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, rotate: 0, skewX: 0, skewY: 0 };
  const RESERVED = new Set(['duration', 'delay', 'ease', 'stagger', 'repeat', 'yoyo', 'repeatDelay', 'onComplete', 'onStart', 'onUpdate', 'immediateRender', 'overwrite', 'paused', 'defaults', 'id', 'transformOrigin', 'force3D', 'lazy']);
  const ALIAS = { rotate: 'rotation' };
  const paint = document.createElement('canvas').getContext('2d');
  const isColor = (v) => /^(#|rgb|hsl)/i.test(v) || (/^[a-z]+$/i.test(v) && v !== 'none' && v !== 'auto' && CSS.supports('color', v));
  const norm = (v) => {
    let s = String(v).trim();
    if (isColor(s)) { paint.fillStyle = '#000'; paint.fillStyle = s; s = paint.fillStyle; if (s[0] === '#') { const n = parseInt(s.slice(1), 16); s = `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; } }
    return s;
  };
  const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  const mix = (a, b, p) => {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p;
    const x = norm(a), y = norm(b);
    const nx = x.match(NUM) || [], ny = y.match(NUM) || [];
    if (nx.length !== ny.length || !ny.length) return p < 1 ? x : y;
    let i = 0;
    const round = /^rgb/.test(y);
    return y.replace(NUM, () => { const v = Number(nx[i]) + (Number(ny[i]) - Number(nx[i])) * p; i++; return round && i <= 3 ? Math.round(v) : +v.toFixed(4); });
  };
  const relative = (to, from) => {
    const m = typeof to === 'string' && to.match(/^([+\-*/])=(-?\d*\.?\d+)(.*)$/);
    if (!m) return typeof to === 'string' && /^-?\d*\.?\d+$/.test(to) ? Number(to) : to;
    const base = parseFloat(from) || 0, n = Number(m[2]);
    const v = { '+': base + n, '-': base - n, '*': base * n, '/': base / n }[m[1]];
    return m[3] ? `${v}${m[3]}` : v;
  };
  const targetsOf = (t) => (typeof t === 'string' ? [...document.querySelectorAll(t)] : t instanceof Element ? [t] : t?.length != null ? [...t].flatMap(targetsOf) : t ? [t] : []);
  const cssName = (p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const NEEDS_PX = /^(width|height|top|left|right|bottom|margin|padding|font-size|border-radius|gap|letter-spacing|outline-offset|border-width)/;
  // gsap.set fija el punto de partida de un elemento; lo que anime después empieza desde ahí
  const FIXED = new WeakMap();
  let frameState = new WeakMap();
  const startValue = (el, prop) => {
    const fixed = FIXED.get(el);
    if (fixed && prop in fixed) return fixed[prop];
    if (prop in TRANSFORM) return TRANSFORM[prop];
    if (prop === 'autoAlpha') return parseFloat(getComputedStyle(el).opacity);
    if (prop.startsWith('--')) return getComputedStyle(el).getPropertyValue(prop).trim();
    const v = getComputedStyle(el)[prop] ?? getComputedStyle(el).getPropertyValue(cssName(prop));
    return /^-?\d*\.?\d+$/.test(v) ? Number(v) : v;
  };
  function applyAll(el, partial) {
    // varias líneas pueden animar el mismo elemento: cada una suma sus propiedades a las del fotograma
    const state = { ...(FIXED.get(el) || {}), ...(frameState.get(el) || {}), ...partial };
    frameState.set(el, state);
    const t = { ...TRANSFORM };
    let hasT = false;
    for (const [p, v] of Object.entries(state)) {
      if (p in TRANSFORM) { t[p] = v; hasT = true; continue; }
      if (p === 'autoAlpha') { el.style.opacity = v; el.style.visibility = v <= 0 ? 'hidden' : 'inherit'; continue; }
      if (p.startsWith('--')) { el.style.setProperty(p, v); continue; }
      const name = cssName(p);
      el.style.setProperty(name, typeof v === 'number' && NEEDS_PX.test(name) ? `${v}px` : String(v));
    }
    if (hasT) {
      const unit = (v, u) => (typeof v === 'number' ? `${v}${u}` : v);
      el.style.transform = `translate(${t.xPercent}%, ${t.yPercent}%) translate3d(${unit(t.x, 'px')}, ${unit(t.y, 'px')}, ${unit(t.z, 'px')}) rotate(${unit(t.rotation, 'deg')}) skew(${unit(t.skewX, 'deg')}, ${unit(t.skewY, 'deg')}) scale(${t.scale * t.scaleX}, ${t.scale * t.scaleY})`;
    }
  }

  /* ---- línea de tiempo: la API que escriben los modelos, resuelta de forma que se pueda saltar a cualquier instante ---- */
  class Timeline {
    constructor(opts = {}) { this.tweens = []; this.labels = {}; this.cursor = 0; this.last = 0; this.defaults = opts.defaults || {}; this.resolved = false; }
    _at(pos) {
      if (pos == null) return this.cursor;
      if (typeof pos === 'number') return pos;
      const s = String(pos);
      let m;
      if ((m = s.match(/^([<>])([+-]?\d*\.?\d*)$/))) return (m[1] === '<' ? this.last : this.cursor) + (Number(m[2]) || 0);
      if ((m = s.match(/^([+-])=(\d*\.?\d+)$/))) return this.cursor + (m[1] === '+' ? 1 : -1) * Number(m[2]);
      if ((m = s.match(/^([^+\-]+)([+-]=)(\d*\.?\d+)$/))) return (this.labels[m[1]] ?? this.cursor) + (m[2] === '+=' ? 1 : -1) * Number(m[3]);
      return this.labels[s] ?? this.cursor;
    }
    _add(kind, targets, from, to, pos) {
      const vars = { ...this.defaults, ...(to || from) };
      const list = targetsOf(targets);
      const duration = kind === 'set' ? 0 : Number(vars.duration ?? 0.5);
      const at = this._at(pos) + Number(vars.delay || 0);
      const st = vars.stagger;
      const each = typeof st === 'number' ? st : st?.amount != null ? st.amount / Math.max(1, list.length - 1) : Number(st?.each || 0);
      const order = st?.from === 'end' ? list.map((_, i) => list.length - 1 - i) : st?.from === 'center' ? list.map((_, i) => Math.abs(i - (list.length - 1) / 2)) : list.map((_, i) => i);
      const repeat = Math.max(0, Number(vars.repeat || 0));
      const span = duration * (repeat + 1) + Number(vars.repeatDelay || 0) * repeat;
      let end = at;
      list.forEach((el, i) => {
        const start = at + order[i] * each;
        end = Math.max(end, start + span);
        if (el instanceof Element && vars.transformOrigin) el.style.transformOrigin = vars.transformOrigin;
        this.tweens.push({ kind, el, start, duration, repeat, yoyo: !!vars.yoyo, gap: Number(vars.repeatDelay || 0), ease: easeOf(vars.ease), from: from && kind === 'fromTo' ? from : kind === 'from' ? to : null, to: kind === 'from' ? null : to, order: this.tweens.length });
      });
      this.last = at;
      this.cursor = Math.max(this.cursor, end);
      this.resolved = false;
      return this;
    }
    to(t, v, p) { return this._add('to', t, null, v, p); }
    from(t, v, p) { return this._add('from', t, null, v, p); }
    fromTo(t, a, b, p) { return this._add('fromTo', t, a, b, p); }
    set(t, v, p) { return this._add('set', t, null, v, p); }
    addLabel(n, p) { this.labels[n] = this._at(p); return this; }
    add(x, p) { if (typeof x === 'string') return this.addLabel(x, p); if (x instanceof Timeline) { const at = this._at(p); x.tweens.forEach((w) => this.tweens.push({ ...w, start: w.start + at })); this.cursor = Math.max(this.cursor, at + x.cursor); this.resolved = false; } return this; }
    call() { return this; }
    play() { return this; } pause() { return this; } restart() { return this; } progress() { return this; } timeScale() { return this; } kill() { return this; }
    totalDuration() { return this.cursor; }
    duration() { return this.cursor; }
    /** De cada propiedad, sus tramos en orden: cada tween empieza donde dejó el anterior. */
    _resolve() {
      this.tracks = new Map();
      const sorted = [...this.tweens].sort((a, b) => a.start - b.start || a.order - b.order);
      const now = new Map();
      for (const w of sorted) {
        if (!now.has(w.el)) now.set(w.el, {});
        const cur = now.get(w.el);
        const props = Object.keys({ ...(w.from || {}), ...(w.to || {}) }).filter((p) => !RESERVED.has(p));
        if (!this.tracks.has(w.el)) this.tracks.set(w.el, {});
        for (const raw of props) {
          const p = ALIAS[raw] || raw;
          if (!(p in cur)) cur[p] = startValue(w.el, p);
          const base = cur[p];
          const a = w.kind === 'fromTo' || w.kind === 'from' ? relative(w.from[raw] ?? base, base) : base;
          const b = w.kind === 'from' ? base : relative(w.to[raw], base);
          (this.tracks.get(w.el)[p] ||= []).push({ w, a, b });
          cur[p] = b;
        }
      }
      this.resolved = true;
    }
    seek(t) {
      if (!this.resolved) this._resolve();
      for (const [el, props] of this.tracks) {
        const state = {};
        for (const [p, parts] of Object.entries(props)) {
          let part = null;
          for (const x of parts) if (x.w.start <= t + 1e-6) part = x;
          // antes de empezar: from y fromTo ya muestran su valor inicial
          if (!part) { state[p] = parts[0].a; continue; }
          const { w, a, b } = part;
          let local = t - w.start;
          let flip = false;
          if (w.repeat && w.duration > 0) {
            const cycle = w.duration + w.gap;
            const n = Math.min(w.repeat, Math.floor(local / cycle));
            local -= n * cycle;
            flip = w.yoyo && n % 2 === 1;
          }
          const q = w.duration > 0 ? Math.min(1, Math.max(0, local / w.duration)) : 1;
          state[p] = mix(a, b, w.ease(flip ? 1 - q : q));
        }
        if (el instanceof Element) applyAll(el, state);
      }
      return this;
    }
  }
  const root = new Timeline();
  W.__timelines = {};
  W.gsap = {
    timeline: (o) => new Timeline(o), to: (t, v) => root.to(t, v, 0), from: (t, v) => root.from(t, v, 0), fromTo: (t, a, b) => root.fromTo(t, a, b, 0),
    set: (t, v) => {
      for (const el of targetsOf(t)) {
        if (!(el instanceof Element)) continue;
        const cur = FIXED.get(el) || {};
        for (const [raw, val] of Object.entries(v)) if (!RESERVED.has(raw)) { const p = ALIAS[raw] || raw; cur[p] = relative(val, cur[p] ?? startValue(el, p)); }
        FIXED.set(el, cur);
        if (v.transformOrigin) el.style.transformOrigin = v.transformOrigin;
        applyAll(el, {});
      }
      return W.gsap;
    },
    registerPlugin() {}, defaults() {}, config() {}, killTweensOf() {},
    utils: { toArray: targetsOf, clamp: (a, b, v) => Math.min(b, Math.max(a, v)), random: (a, b) => a + Math.random() * (b - a), wrap: (a, b, v) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a)) },
  };

  const frameFns = [];
  W.HV = {
    onFrame: (fn) => { frameFns.push(fn); },
    split(selector, by = 'words') {
      const out = [];
      for (const el of targetsOf(selector)) {
        const text = el.textContent;
        el.textContent = '';
        for (const part of by === 'chars' ? [...text] : text.split(/(\s+)/)) {
          if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part === ' ' && by === 'chars' ? '\u00a0' : ' ')); continue; }
          const s = document.createElement('span');
          s.className = 'hv-w';
          s.style.display = 'inline-block';
          s.textContent = part;
          el.appendChild(s);
          out.push(s);
        }
      }
      return out;
    },
  };

  /* ---- saltar a un instante ---- */
  function seek(t) {
    T = t;
    seed = 0x2f6e2b1 + Math.round(t * 30); // lo aleatorio por fotograma (grano, ruido) es estable: el mismo instante, el mismo dibujo
    frameState = new WeakMap();
    for (const [id, x] of [...timers]) {
      while (timers.has(id) && x.at <= T) { x.fn(...x.a); if (x.every) x.at += x.every; else timers.delete(id); }
    }
    const fns = frames; frames = [];
    fns.forEach((f) => f(T * 1000));
    for (const el of document.querySelectorAll('[data-start]:not([data-composition-id])')) {
      const start = Number(el.dataset.start) || 0;
      const dur = el.dataset.duration == null ? Infinity : Number(el.dataset.duration);
      el.style.visibility = T >= start && T < start + dur ? '' : 'hidden';
    }
    root.seek(T);
    Object.values(W.__timelines).forEach((tl) => tl?.seek?.(T));
    frameFns.forEach((fn) => fn(T));
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = T * 1000; }
  }

  /* ---- un fotograma: el DOM del instante T se dibuja en un canvas ---- */
  const canvas = document.createElement('canvas');
  canvas.width = cfg.width; canvas.height = cfg.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const XHTML = 'http://www.w3.org/1999/xhtml';
  let headXml = null; // estilos y fuentes no cambian entre fotogramas: se preparan una vez
  function prepareHead() {
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n').replace(/:root/g, 'html');
    const style = document.createElementNS(XHTML, 'style');
    style.textContent = `${css}\n*,*::before,*::after{animation:none!important;transition:none!important}`;
    const head = document.createElementNS(XHTML, 'head');
    head.appendChild(style);
    return encodeURIComponent(new XMLSerializer().serializeToString(head));
  }
  function snapshot() {
    const body = document.body.cloneNode(true);
    const a = [document.body, ...document.body.querySelectorAll('*')];
    const b = [body, ...body.querySelectorAll('*')];
    a.forEach((orig, i) => {
      const copy = b[i];
      // lo que anima CSS no está en el DOM: se copia su valor en este instante
      for (const anim of orig.getAnimations?.() || []) {
        const cs = getComputedStyle(orig);
        for (const k of anim.effect?.getKeyframes?.() || []) for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) copy.style[p] = cs[p];
      }
      if (orig instanceof HTMLCanvasElement) {
        const img = document.createElementNS(XHTML, 'img');
        try { img.src = orig.toDataURL(); } catch { /* lienzo no legible */ }
        img.setAttribute('style', orig.getAttribute('style') || '');
        img.width = orig.width; img.height = orig.height;
        copy.replaceWith(img);
      }
    });
    body.querySelectorAll('script').forEach((s) => s.remove());
    // lo que no está en pantalla no se dibuja: una pieza con muchas imágenes exporta mucho más rápido
    body.querySelectorAll('[data-start]:not([data-composition-id])').forEach((el) => { if (el.style.visibility === 'hidden') el.remove(); });
    headXml ||= prepareHead();
    const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${cfg.height}"><foreignObject x="0" y="0" width="100%" height="100%"><html xmlns="${XHTML}">`;
    return `${encodeURIComponent(open)}${headXml}${encodeURIComponent(`${new XMLSerializer().serializeToString(body)}</html></foreignObject></svg>`)}`;
  }

  /* ---- revisión automática: lo que se vería mal en pantalla ---- */
  function audit(times) {
    const issues = new Map();
    const outside = new Map(); // lo que entra deslizándose está fuera un momento: solo cuenta si sigue fuera en la siguiente muestra
    const note = (code, message) => { if (!issues.has(code)) issues.set(code, { code, message }); };
    const shown = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.visibility === 'hidden' || c.display === 'none' || Number(c.opacity) < 0.05) return false; } return true; };
    for (const t of times) {
      seek(t);
      const boxes = [];
      for (const el of document.querySelectorAll('[data-composition-id] *')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        boxes.push({ r, el });
        const text = el.textContent.trim().slice(0, 30);
        const off = r.left < -2 || r.top < -2 || r.right > cfg.width + 2 || r.bottom > cfg.height + 2;
        const times_off = off ? (outside.get(el) || 0) + 1 : 0;
        outside.set(el, times_off);
        if (times_off >= 2) note('overflow', `El texto «${text}» se sale del encuadre en el segundo ${t.toFixed(1)}.`);
        if (parseFloat(getComputedStyle(el).fontSize) < Math.min(cfg.width, cfg.height) * 0.024) note('small', `El texto «${text}» es demasiado pequeño para leerse.`);
      }
      for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) {
        const a = boxes[i], b = boxes[k];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 0 && h > 0 && w * h > 0.18 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) note('overlap', `«${a.el.textContent.trim().slice(0, 24)}» y «${b.el.textContent.trim().slice(0, 24)}» se pisan en el segundo ${t.toFixed(1)}.`);
      }
      if (!boxes.length && !document.querySelector('[data-composition-id] svg, [data-composition-id] canvas')) note('empty', `No se ve nada en el segundo ${t.toFixed(1)}.`);
    }
    return [...issues.values()];
  }
  /* ---- dibujo propio, para Safari: no deja leer un lienzo donde se pintó HTML con foreignObject, así que se
     recorre el DOM y se pinta cada caja, degradado, texto, SVG y canvas con la API 2D. Es una aproximación fiel
     a lo que usan las composiciones (transformaciones, opacidad, recortes, degradados, sombras de texto). ---- */
  let raster = !!cfg.raster;
  let rcanvas = null;
  const splitTop = (s) => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const px = (v, ref) => (/%$/.test(v) ? (parseFloat(v) / 100) * ref : parseFloat(v) || 0);
  function stopsOf(parts, len) {
    const out = [];
    for (const p of parts) {
      const m = p.match(/^((?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]+|[a-z]+)\s*(.*)$/i);
      if (!m) continue;
      const pos = m[2].trim().split(/\s+/).filter(Boolean);
      if (!pos.length) out.push({ c: m[1], at: null });
      for (const q of pos) out.push({ c: m[1], at: px(q, len) / len });
    }
    out.forEach((x, i) => { if (x.at == null) x.at = i === 0 ? 0 : i === out.length - 1 ? 1 : null; });
    for (let i = 0; i < out.length; i++) if (out[i].at == null) { let k = i; while (out[k].at == null) k++; const a = out[i - 1].at, b = out[k].at; for (let j = i; j < k; j++) out[j].at = a + ((b - a) * (j - i + 1)) / (k - i + 1); }
    for (let i = 1; i < out.length; i++) out[i].at = Math.max(out[i].at, out[i - 1].at);
    return out;
  }
  function gradient(c, img, w, h) {
    const m = img.match(/^(repeating-)?(linear|radial)-gradient\((.*)\)$/s);
    if (!m) return null;
    const parts = splitTop(m[3]);
    let g, len;
    if (m[2] === 'linear') {
      let ang = 180;
      if (/^(-?[\d.]+)(deg|turn|rad)$/.test(parts[0])) { const [, n, u] = parts.shift().match(/^(-?[\d.]+)(deg|turn|rad)$/); ang = u === 'deg' ? +n : u === 'turn' ? n * 360 : (n * 180) / Math.PI; } else if (/^to /.test(parts[0])) {
        const d = parts.shift();
        ang = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 }[d] ?? 180;
      }
      const r = (ang * Math.PI) / 180, dx = Math.sin(r), dy = -Math.cos(r);
      len = Math.abs(w * dx) + Math.abs(h * dy);
      g = c.createLinearGradient(w / 2 - (dx * len) / 2, h / 2 - (dy * len) / 2, w / 2 + (dx * len) / 2, h / 2 + (dy * len) / 2);
    } else {
      let cx = w / 2, cy = h / 2, rad = Math.hypot(w / 2, h / 2);
      if (!/^((?:rgba?|hsla?)\(|#)/i.test(parts[0])) {
        const d = parts.shift();
        const at = d.match(/at\s+(\S+)\s+(\S+)/);
        if (at) { cx = px(at[1], w); cy = px(at[2], h); }
        const size = d.replace(/at\s.*$/, '').trim().split(/\s+/).filter((x) => /\d/.test(x));
        rad = size.length ? px(size[0], w) : /closest-side/.test(d) ? Math.min(cx, cy, w - cx, h - cy) : Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
      }
      len = rad;
      g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rad, 0.01));
    }
    let stops = stopsOf(parts, len || 1);
    if (m[1] && stops.length > 1) { // repetido: se copian los tramos hasta cubrir la longitud
      const span = stops.at(-1).at - stops[0].at;
      if (span > 0.001) { const base = stops.slice(); for (let k = 1; stops.at(-1).at < 1 && k < 400; k++) stops = stops.concat(base.map((x) => ({ c: x.c, at: x.at + span * k }))); }
    }
    for (const st of stops) if (st.at >= 0 && st.at <= 1) { try { g.addColorStop(st.at, st.c); } catch { /* color raro */ } }
    return g;
  }
  function boxPath(c, x, y, w, h, cs) {
    const r = Math.min(px(cs.borderTopLeftRadius, w), w / 2, h / 2);
    c.beginPath();
    if (r > 0 && c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  }
  function clipPathOf(c, cp, x, y, w, h) {
    let m;
    if ((m = cp.match(/^inset\(([^)]*)\)/))) { const v = m[1].replace(/round.*$/, '').trim().split(/\s+/); const [t, r = t, b = t, l = r] = v; c.beginPath(); c.rect(x + px(l, w), y + px(t, h), w - px(l, w) - px(r, w), h - px(t, h) - px(b, h)); return true; }
    if ((m = cp.match(/^polygon\(([^)]*)\)/))) { c.beginPath(); splitTop(m[1].replace(/^(nonzero|evenodd),/, '')).forEach((pt, i) => { const [a, b] = pt.trim().split(/\s+/); c[i ? 'lineTo' : 'moveTo'](x + px(a, w), y + px(b, h)); }); c.closePath(); return true; }
    if ((m = cp.match(/^(circle|ellipse)\(([^)]*)\)/))) { const [size, at = '50% 50%'] = m[2].split(/\s+at\s+/); const [ax, ay] = at.split(/\s+/); const rr = size.split(/\s+/); c.beginPath(); c.ellipse(x + px(ax, w), y + px(ay ?? '50%', h), Math.max(0, px(rr[0] || '50%', Math.hypot(w, h) / Math.SQRT2)), Math.max(0, px(rr[1] || rr[0] || '50%', Math.hypot(w, h) / Math.SQRT2)), 0, 0, Math.PI * 2); return true; }
    return false;
  }
  const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform', 'transform-origin', 'font-family', 'font-size', 'font-weight', 'stop-color', 'stop-opacity', 'visibility'];
  function svgImage(svg, w, h) {
    const copy = svg.cloneNode(true);
    const a = [svg, ...svg.querySelectorAll('*')], b = [copy, ...copy.querySelectorAll('*')];
    a.forEach((el, i) => { const cs = getComputedStyle(el); b[i].setAttribute('style', SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')); });
    copy.setAttribute('width', w); copy.setAttribute('height', h);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    return img.decode().then(() => img, () => null);
  }
  const words = (node) => { const out = []; for (const m of node.data.matchAll(/\S+/g)) out.push([m.index, m[0]]); return out; };
  async function rasterFrame(c) {
    const root = document.querySelector('[data-composition-id]') || document.body;
    const all = [root, ...root.querySelectorAll('*')];
    const info = new Map();
    // 1) transformaciones calculadas y luego, sin ellas, la posición de cada caja y de cada palabra
    for (const el of all) { const cs = getComputedStyle(el); info.set(el, { cs, tf: cs.transform, origin: cs.transformOrigin, rot: cs.rotate, sc: cs.scale, tr: cs.translate }); }
    const undo = [];
    for (const el of all) {
      const x = info.get(el);
      if ((x.tf && x.tf !== 'none') || (x.rot && x.rot !== 'none') || (x.sc && x.sc !== 'none') || (x.tr && x.tr !== 'none')) {
        undo.push([el, el.getAttribute('style')]);
        for (const p of ['transform', 'rotate', 'scale', 'translate']) el.style.setProperty(p, 'none', 'important');
      }
    }
    const base = root.getBoundingClientRect();
    const svgs = [];
    for (const el of all) {
      const x = info.get(el);
      const r = el.getBoundingClientRect();
      x.r = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      if (el instanceof SVGSVGElement && r.width && r.height) svgs.push(svgImage(el, r.width, r.height).then((img) => { x.img = img; }));
      x.text = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.data.trim()) continue;
        const range = document.createRange();
        for (const [i, w] of words(n)) { range.setStart(n, i); range.setEnd(n, i + w.length); const q = range.getClientRects()[0]; if (q && q.width) x.text.push({ w, x: q.left - base.left, y: q.top - base.top, h: q.height }); }
      }
    }
    for (const [el, st] of undo) { if (st == null) el.removeAttribute('style'); else el.setAttribute('style', st); }
    await Promise.all(svgs);
    // 2) pintado en orden, con la matriz acumulada de cada elemento
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = getComputedStyle(document.body).backgroundColor || '#000';
    c.fillRect(0, 0, cfg.width, cfg.height);
    const zOf = (el) => { const z = parseInt(info.get(el)?.cs.zIndex, 10); return Number.isFinite(z) && info.get(el).cs.position !== 'static' ? z : 0; };
    function paint(el, matrix, alpha) {
      const x = info.get(el);
      if (!x) return;
      const cs = x.cs;
      if (cs.display === 'none') return;
      const { x: bx, y: by, w, h } = x.r;
      let m = matrix;
      const tfs = [];
      if (x.tr && x.tr !== 'none') { const [a, b = '0'] = x.tr.split(/\s+/); tfs.push(new DOMMatrix().translate(px(a, w), px(b, h))); }
      if (x.rot && x.rot !== 'none') tfs.push(new DOMMatrix().rotate(parseFloat(x.rot) || 0));
      if (x.sc && x.sc !== 'none') { const [a, b = a] = x.sc.split(/\s+/); tfs.push(new DOMMatrix().scale(+a, +b)); }
      if (x.tf && x.tf !== 'none') { try { tfs.push(new DOMMatrix(x.tf)); } catch { /* 3D raro */ } }
      if (tfs.length) {
        const [ox, oy] = x.origin.split(' ').map(parseFloat);
        let local = new DOMMatrix().translate(bx + ox, by + oy);
        for (const t of tfs) local = local.multiply(t);
        m = m.multiply(local.translate(-(bx + ox), -(by + oy)));
      }
      const a = alpha * (parseFloat(cs.opacity) || 0);
      if (a <= 0.002) return;
      c.save();
      c.setTransform(m);
      c.globalAlpha = a;
      if (cs.clipPath && cs.clipPath !== 'none' && clipPathOf(c, cs.clipPath, bx, by, w, h)) c.clip();
      const visible = cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
      if (visible && w && h) {
        if (cs.boxShadow && cs.boxShadow !== 'none') {
          const sh = splitTop(cs.boxShadow)[0].match(/^((?:rgba?|hsla?)\([^)]*\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*([\d.]+)?/);
          if (sh && !/inset/.test(cs.boxShadow)) { c.save(); c.shadowColor = sh[1]; c.shadowOffsetX = +sh[2]; c.shadowOffsetY = +sh[3]; c.shadowBlur = +(sh[4] || 0); c.fillStyle = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : sh[1]; boxPath(c, bx, by, w, h, cs); c.fill(); c.restore(); }
        }
        const clipText = /text/.test(cs.webkitBackgroundClip || cs.backgroundClip || '');
        if (!clipText && cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') { c.fillStyle = cs.backgroundColor; boxPath(c, bx, by, w, h, cs); c.fill(); }
        let textFill = null;
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          for (const layer of splitTop(cs.backgroundImage).reverse()) {
            const sizes = cs.backgroundSize.split(',')[0].trim().split(/\s+/);
            const tw = sizes[0] && sizes[0] !== 'auto' && sizes[0] !== 'cover' && sizes[0] !== 'contain' ? px(sizes[0], w) : w;
            const th = sizes[1] && sizes[1] !== 'auto' ? px(sizes[1], h) : sizes[0] && /%|px/.test(sizes[0]) ? tw : h;
            const g = gradient(c, layer, tw, th);
            if (!g) continue;
            if (clipText) { textFill = g; continue; }
            const [pxp, pyp] = cs.backgroundPosition.split(',')[0].trim().split(/\s+/);
            const offX = /%$/.test(pxp) ? (parseFloat(pxp) / 100) * (w - tw) : parseFloat(pxp) || 0;
            const offY = /%$/.test(pyp || '') ? (parseFloat(pyp) / 100) * (h - th) : parseFloat(pyp) || 0;
            c.save(); boxPath(c, bx, by, w, h, cs); c.clip();
            const repeat = !/no-repeat/.test(cs.backgroundRepeat) && (tw < w || th < h);
            c.translate(bx, by);
            if (repeat) { for (let yy = (offY % th) - th; yy < h; yy += th) for (let xx = (offX % tw) - tw; xx < w; xx += tw) { c.save(); c.translate(xx, yy); c.fillStyle = g; c.fillRect(0, 0, tw, th); c.restore(); } } else { c.translate(offX, offY); c.fillStyle = g; c.fillRect(0, 0, tw, th); }
            c.restore();
          }
        }
        const bw = parseFloat(cs.borderTopWidth) || 0;
        if (bw > 0 && cs.borderTopStyle !== 'none') { c.strokeStyle = cs.borderTopColor; c.lineWidth = bw; const r2 = Math.min(px(cs.borderTopLeftRadius, w), w / 2, h / 2); c.beginPath(); if (r2 > 0 && c.roundRect) c.roundRect(bx + bw / 2, by + bw / 2, w - bw, h - bw, Math.max(0, r2 - bw / 2)); else c.rect(bx + bw / 2, by + bw / 2, w - bw, h - bw); c.stroke(); }
        if (x.img) c.drawImage(x.img, bx, by, w, h);
        else if (el instanceof HTMLCanvasElement) { try { c.drawImage(el, bx, by, w, h); } catch { /* lienzo vacío */ } }
        else if (el instanceof HTMLImageElement && el.complete) { try { c.drawImage(el, bx, by, w, h); } catch { /* imagen rota */ } }
        if (x.text.length) {
          c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          if ('letterSpacing' in c) c.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
          c.textBaseline = 'alphabetic';
          const transparent = /rgba\(.*,\s*0\)$/.test(cs.color) || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)';
          c.fillStyle = cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && !transparent ? cs.webkitTextFillColor : cs.color;
          // texto con degradado (background-clip: text): el degradado está en coordenadas de la caja
          let ox = 0, oy = 0;
          if (textFill) { c.save(); c.translate(bx, by); ox = -bx; oy = -by; c.fillStyle = textFill; }
          const shadows = cs.textShadow && cs.textShadow !== 'none' ? splitTop(cs.textShadow) : [];
          const met = c.measureText('Hg');
          const asc = met.fontBoundingBoxAscent ?? parseFloat(cs.fontSize) * 0.8, desc = met.fontBoundingBoxDescent ?? parseFloat(cs.fontSize) * 0.2;
          const stroke = parseFloat(cs.webkitTextStrokeWidth) || 0;
          const tt = cs.textTransform;
          const draw = () => {
            for (const t of x.text) {
              const word = tt === 'uppercase' ? t.w.toUpperCase() : tt === 'lowercase' ? t.w.toLowerCase() : t.w;
              const y = t.y + (t.h - (asc + desc)) / 2 + asc + oy;
              if (!transparent || textFill) c.fillText(word, t.x + ox, y);
              if (stroke) { c.lineWidth = stroke; c.strokeStyle = cs.webkitTextStrokeColor; c.strokeText(word, t.x + ox, y); }
            }
          };
          // cada sombra (el brillo de neón son varias) se pinta en su pasada; después el texto limpio
          for (const sh of shadows.reverse()) {
            const p = sh.match(/^((?:rgba?|hsla?)\([^)]*\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*([\d.]+)?/);
            if (!p) continue;
            c.save(); c.shadowColor = p[1]; c.shadowOffsetX = +p[2]; c.shadowOffsetY = +p[3]; c.shadowBlur = +(p[4] || 0); draw(); c.restore();
          }
          draw();
          if (textFill) c.restore();
        }
      }
      if (cs.overflow !== 'visible' && el !== document.body) { c.beginPath(); c.rect(bx, by, w, h); c.clip(); }
      if (!(el instanceof SVGElement)) {
        const kids = [...el.children].map((k, i) => [k, i]).sort((p, q) => zOf(p[0]) - zOf(q[0]) || p[1] - q[1]);
        for (const [k] of kids) if (info.has(k)) paint(k, m, a);
      }
      c.restore();
    }
    paint(root, new DOMMatrix(), 1);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  async function capture(i, t) {
    seek(t);
    if (!raster) {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${snapshot()}`;
      await img.decode();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cfg.width, cfg.height);
      ctx.drawImage(img, 0, 0, cfg.width, cfg.height);
      // Safari bloquea leer un lienzo con HTML dibujado: a partir de aquí se usa el dibujo propio
      try { ctx.getImageData(0, 0, 1, 1); } catch { raster = true; }
    }
    let target = canvas;
    if (raster) {
      rcanvas ||= Object.assign(document.createElement('canvas'), { width: cfg.width, height: cfg.height }); // uno nuevo: el bloqueado no se puede leer nunca
      await rasterFrame(rcanvas.getContext('2d'));
      target = rcanvas;
    }
    const bitmap = await createImageBitmap(target);
    post({ type: 'frame', i, bitmap, raster }, [bitmap]);
  }
  W.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== parent || m?.token !== cfg.token) return;
    if (m.cmd === 'seek') seek(Number(m.t) || 0);
    if (m.cmd === 'capture') capture(m.i, m.t).catch((err) => post({ type: 'capture-error', message: String(err?.message || err) }));
    if (m.cmd === 'audit') { try { post({ type: 'audit', issues: audit(m.times || []) }); } catch (err) { post({ type: 'audit', issues: [{ code: 'script', message: String(err?.message || err) }] }); } }
  });
  W.__jcHvReady = () => {
    const stage = document.querySelector('[data-composition-id]');
    if (stage) { stage.style.width ||= `${cfg.width}px`; stage.style.height ||= `${cfg.height}px`; stage.style.position ||= 'relative'; stage.style.overflow ||= 'hidden'; }
    const fonts = Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
    fonts.then(() => realTimeout(() => { try { seek(0); } catch (e) { post({ type: 'error', message: String(e.message) }); } post({ type: 'ready', duration: Number(stage?.dataset.duration) || cfg.duration }); }, 0));
  };
}
