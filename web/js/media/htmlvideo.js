// Vídeo con HTML: el modelo de chat escribe una composición animada y JeanCode la convierte en MP4 en este dispositivo,
// sin gastar créditos de un modelo de vídeo. El formato es el de HyperFrames (HeyGen, Apache-2.0): raíz con
// data-composition-id, clips con data-start y data-duration, y una línea de tiempo en pausa en window.__timelines.
// Aquí no hay GSAP ni Chrome headless: jcHvRuntime trae un reloj virtual y una versión propia de la API de timeline.

export const HV_RATIOS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
export const HV_DURATIONS = [5, 10, 15, 30];
export const HV_STYLES = ['tipografía cinética', 'explicativo', 'lanzamiento de producto', 'datos animados', 'revelado de logo', 'anuncio vertical'];

/** Skill que recibe el modelo: el contrato de la composición y el oficio de motion design. */
export function htmlVideoSkill({ width, height, duration }) {
  return `Eres director de motion graphics. Escribes UNA composición HTML que se convierte, fotograma a fotograma, en un vídeo de ${width}×${height} y ${duration} s a 30 fps.

FORMATO (obligatorio)
- Responde SOLO con un bloque \`\`\`html. Sin explicaciones.
- Raíz: <div id="stage" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">. Todo va dentro, con position:absolute y medidas en px para ${width}×${height}.
- Cada escena o elemento temporal: class="clip" data-start="segundos" data-duration="segundos" data-track-index="0". Fuera de su intervalo no se ve. El orden de pintado lo decide z-index.
- Animación: const tl = gsap.timeline({ paused: true }); añade los tweens; al final window.__timelines["main"] = tl; El tiempo de la línea es el tiempo del vídeo.
- Ayudas: HV.split(selector, "words"|"chars") parte el texto en <span class="hv-w"> para animarlo; HV.onFrame(function (t) { ... }) ejecuta código en cada fotograma según el tiempo t (contadores, gráficos).
- Música opcional: añade a la raíz data-music="drive|tech|bounce|elegant|warm|opium" y data-cues con los segundos de cada cambio de escena separados por comas.
- API disponible, ya cargada: gsap.timeline, tl.to, tl.from, tl.fromTo, tl.set, tl.addLabel, posiciones (número, "+=0.2", "-=0.2", "<", ">", etiqueta), stagger, repeat finito, yoyo, eases power1-4, sine, expo, circ, back, elastic, bounce (.in, .out, .inOut). Propiedades: x, y, xPercent, yPercent, scale, scaleX, scaleY, rotation, skewX, skewY, opacity, autoAlpha, colores, filter, clipPath y cualquier CSS numérico.

REGLAS PARA QUE EL RENDER SEA EXACTO
- Todo lo visible depende solo del tiempo de la línea. Prohibido: Date.now, Math.random sin semilla, setTimeout, setInterval, requestAnimationFrame, fetch, repeat: -1, autoplay, <video> y <audio>.
- Sin recursos externos: nada de CDN, <link>, <script src> ni imágenes remotas. Usa CSS, SVG en línea, degradados y data: URI. Fuentes incluidas: "Anton", "Bebas Neue", "Archivo Black", "Playfair Display", "DM Serif Display", "Space Grotesk", "IBM Plex Sans", "IBM Plex Mono".
- No animes display ni visibility de un .clip: anima un hijo. No combines transform de CSS con transformaciones animadas en el mismo elemento.
- Anima transform y opacity antes que left, top, width o height.
- No uses backdrop-filter, mix-blend-mode sobre el fondo ni <iframe>.

OFICIO
- Una idea por escena, cada una en su propio .clip. Título legible en 1 s; cada escena dura lo que tarda en leerse. Una jerarquía clara: un elemento protagonista por escena.
- Nada se queda encima de lo siguiente: antes de que entre un elemento en un lugar, lo anterior ya salió o su clip terminó. Usa todo el encuadre, no una columna pequeña en el centro.
- Zona segura: el contenido dentro del 90 % central y el texto clave dentro del 80 %. En vertical, deja libre el 15 % inferior.
- Tipografía grande: en ${width}×${height}, el texto principal mide al menos ${Math.round(Math.min(width, height) * 0.14)} px y el secundario al menos ${Math.round(Math.min(width, height) * 0.06)} px.
- El movimiento guía la atención: entradas de 0.4 a 0.8 s con power3.out o expo.out, salidas más cortas con power2.in, y stagger de 0.04 a 0.1 s. Solapa las transiciones entre escenas; nunca dejes un fotograma vacío.
- Paleta de 2 o 3 colores con contraste alto y un fondo con profundidad (degradado, formas, textura SVG). Nada de plantilla genérica: una decisión visual fuerte y coherente.
- Respeta cualquier texto literal del usuario. Termina con un cierre deliberado que se sostenga al menos 0.5 s.`;
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
  if (/Date\.now|new Date\(\)/.test(code)) add('clock', 'Usa el tiempo de la línea, no el reloj.');
  if (/Math\.random/.test(code)) add('random', 'Math.random cambia entre fotogramas: usa valores fijos.');
  if (/\b(?:setTimeout|setInterval|requestAnimationFrame|fetch|XMLHttpRequest)\s*\(/.test(code)) add('timers', 'Temporizadores y red no son deterministas: usa la línea de tiempo.');
  if (/repeat\s*:\s*-1/.test(code)) add('infinite', 'repeat: -1 no tiene final: usa un número de repeticiones.');
  if (/gsap\.timeline/.test(code) && !/__timelines/.test(code)) add('register', 'Registra la línea en window.__timelines["main"].');
  if (/gsap\.timeline\((?![^)]*paused\s*:\s*true)/.test(code)) add('paused', 'La línea debe crearse con { paused: true }.');
  return out;
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
export function buildCompositionDoc(html, { width, height, duration, fps = 30, token = '' }) {
  const cfg = JSON.stringify({ width, height, duration, fps, token }).replace(/</g, '\\u003c');
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
  async function capture(i, t) {
    seek(t);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${snapshot()}`;
    await img.decode();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    ctx.drawImage(img, 0, 0, cfg.width, cfg.height);
    ctx.getImageData(0, 0, 1, 1); // este navegador bloquea leer el dibujo: se avisa en vez de exportar negro
    const bitmap = await createImageBitmap(canvas);
    post({ type: 'frame', i, bitmap }, [bitmap]);
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
