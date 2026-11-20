// Vídeo HTML dirigido: el modelo de chat solo decide QUÉ se cuenta (un guion en JSON) y aquí se decide CÓMO se ve.
// Así el resultado es sólido aunque el modelo sea pequeño o local: dirección de arte, tipografía, ritmo, transiciones y
// sonido salen de plantillas hechas a mano. La salida es una composición normal, que se puede seguir editando.
import { HV_RATIOS } from './htmlvideo.js';

export const THEMES = {
  impacto: { label: 'Impacto', display: 'Anton', width: 0.42, upper: true, body: 'IBM Plex Sans', bg: '#0b0b0b', ink: '#f7f5ef', accent: '#e8ff3a', alt: '#ff3d2e', cut: 'wipe', music: 'drive' },
  editorial: { label: 'Editorial', display: 'Playfair Display', width: 0.54, upper: false, body: 'IBM Plex Sans', bg: '#f3ecdf', ink: '#1c1712', accent: '#8f1d2c', alt: '#b8901f', cut: 'slide', music: 'elegant' },
  tecno: { label: 'Tecno', display: 'Space Grotesk', width: 0.58, upper: false, body: 'IBM Plex Mono', bg: '#070b1a', ink: '#e9f1ff', accent: '#38e1ff', alt: '#7c5cff', cut: 'bars', music: 'tech' },
  pop: { label: 'Pop', display: 'Archivo Black', width: 0.74, upper: true, body: 'IBM Plex Sans', bg: '#ffcf33', ink: '#141414', accent: '#e8234f', alt: '#1f4bff', cut: 'rise', music: 'bounce' },
  calido: { label: 'Cálido', display: 'DM Serif Display', width: 0.49, upper: false, body: 'IBM Plex Sans', bg: '#2a150e', ink: '#fbeedd', accent: '#f2a65a', alt: '#d9563b', cut: 'fade', music: 'warm' },
  minimal: { label: 'Minimal', display: 'Bebas Neue', width: 0.39, upper: true, body: 'IBM Plex Sans', bg: '#000000', ink: '#ffffff', accent: '#ffffff', alt: '#8a8a8a', cut: 'wipe', music: 'tech' },
};
const SCENE_WEIGHT = { hook: 1.1, words: 1.5, list: 1.7, stat: 1.2, quote: 1.4, compare: 1.6, cta: 1.3 };
const BEAT = 0.5; // 120 pulsaciones por minuto: los cortes caen en el pulso de la música

/** Lo que se pide al modelo: solo el contenido, en JSON. */
export function storyboardPrompt({ duration }) {
  const max = Math.max(2, Math.min(7, Math.floor(duration / 2)));
  return `Eres guionista de vídeos cortos publicitarios y explicativos. Convierte el pedido en un guion de ${duration} segundos con ${Math.min(3, max)} a ${max} escenas.
Responde SOLO con JSON válido, sin explicaciones:
{"mood":"impacto|editorial|tecno|pop|calido|minimal","accent":"#rrggbb opcional","scenes":[ESCENA,...]}
Tipos de ESCENA:
{"type":"hook","headline":"frase que engancha, máximo 7 palabras","sub":"apoyo opcional, máximo 10 palabras"}
{"type":"words","words":["palabra o frase corta","otra","otra"]}  de 3 a 5 golpes de texto
{"type":"list","headline":"título corto","items":["punto breve","punto breve","punto breve"]}  de 2 a 4 puntos
{"type":"stat","value":"98%","label":"qué significa esa cifra"}  SOLO con cifras que dé el usuario
{"type":"quote","text":"frase memorable, máximo 16 palabras","author":"opcional"}
{"type":"compare","left":{"title":"antes","text":"breve"},"right":{"title":"después","text":"breve"}}
{"type":"cta","headline":"nombre o marca","sub":"llamada a la acción breve","action":"web o acción opcional"}
Reglas: empieza con hook y termina con cta. Escribe en el idioma del pedido. Respeta nombres y textos literales. No inventes datos, cifras, premios ni direcciones.`;
}

/** El guion de la respuesta del modelo, o null. Tolera texto alrededor y comas de más. */
export function parseStoryboard(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const raw = t.slice(a, b + 1);
  for (const candidate of [raw, raw.replace(/,\s*([}\]])/g, '$1')]) {
    try { const j = JSON.parse(candidate); if (Array.isArray(j.scenes) && j.scenes.length) return j; } catch { /* se intenta corregido */ }
  }
  return null;
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t; };
const list = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => clip(typeof x === 'string' ? x : x?.text ?? x?.title, len)).filter(Boolean).slice(0, n);

/** Deja el guion dentro de lo que las plantillas saben pintar, siempre con inicio y cierre. */
export function normalizeBoard(board, { duration, brief = '' }) {
  const max = Math.max(2, Math.min(7, Math.floor(duration / 2)));
  const scenes = [];
  for (const s of board?.scenes || []) {
    if (s?.type === 'hook' && clip(s.headline, 70)) scenes.push({ type: 'hook', headline: clip(s.headline, 70), sub: clip(s.sub, 90) });
    if (s?.type === 'words') { const words = list(s.words, 5, 28); if (words.length >= 2) scenes.push({ type: 'words', words }); }
    if (s?.type === 'list') { const items = list(s.items, 4, 52); if (items.length) scenes.push({ type: 'list', headline: clip(s.headline, 40), items }); }
    if (s?.type === 'stat' && /\d/.test(String(s.value))) scenes.push({ type: 'stat', value: clip(s.value, 12), label: clip(s.label, 60) });
    if (s?.type === 'quote' && clip(s.text, 120)) scenes.push({ type: 'quote', text: clip(s.text, 120), author: clip(s.author, 40) });
    if (s?.type === 'compare' && s.left && s.right) scenes.push({ type: 'compare', left: { title: clip(s.left.title, 22), text: clip(s.left.text, 60) }, right: { title: clip(s.right.title, 22), text: clip(s.right.text, 60) } });
    if (s?.type === 'cta' && clip(s.headline, 36)) scenes.push({ type: 'cta', headline: clip(s.headline, 36), sub: clip(s.sub, 70), action: clip(s.action, 36) });
  }
  const fallback = fallbackBoard(brief);
  if (!scenes.length) scenes.push(...fallback.scenes);
  if (scenes[0].type !== 'hook' && scenes.length < max) scenes.unshift(fallback.scenes[0]);
  const cta = [...scenes].reverse().find((s) => s.type === 'cta') || fallback.scenes[fallback.scenes.length - 1];
  const middle = scenes.filter((s) => s.type !== 'cta').slice(0, max - 1);
  const mood = THEMES[board?.mood] ? board.mood : 'impacto';
  const accent = /^#[0-9a-f]{6}$/i.test(board?.accent || '') ? board.accent : '';
  return { mood, accent, scenes: [...middle, cta] };
}

/** Guion mínimo a partir del pedido: un modelo que falla nunca deja al usuario sin vídeo. */
export function fallbackBoard(brief) {
  const text = String(brief || 'Tu idea en movimiento').replace(/\s+/g, ' ').trim();
  const quoted = text.match(/["«“]([^"»”]{2,36})["»”]/)?.[1];
  const parts = text.split(/[.:;\n]|,\s+(?=\p{L})/u).map((x) => x.trim()).filter((x) => x.length > 2);
  const scenes = [{ type: 'hook', headline: clip(parts[0] || text, 60), sub: '' }];
  const rest = parts.slice(1, 5).map((x) => clip(x, 52));
  if (rest.length >= 2) scenes.push({ type: 'list', headline: '', items: rest.slice(0, 4) });
  scenes.push({ type: 'cta', headline: clip(quoted || parts[parts.length - 1] || text, 36), sub: '', action: '' });
  return { mood: 'impacto', accent: '', scenes };
}

/* ---------------------------------------------------------------- medidas */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (x) => Number(x).toFixed(2);

/** Reparte el texto en líneas buscando el mayor tamaño de letra que quepa. */
export function fitText(text, { width, height, max, charWidth, lineHeight = 1.04, maxLines = 4 }) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let best = { size: 0, lines: [String(text)] };
  for (let count = 1; count <= Math.min(maxLines, words.length); count++) {
    const target = words.join(' ').length / count;
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && next.length > target * 1.25 && lines.length < count - 1) { lines.push(cur); cur = w; } else cur = next;
    }
    lines.push(cur);
    const longest = Math.max(...lines.map((l) => l.length));
    const size = Math.min(max, width / (longest * charWidth), height / (lines.length * lineHeight));
    if (size > best.size * 1.02) best = { size, lines };
  }
  return { size: Math.floor(best.size), lines: best.lines };
}

/** Cada palabra dentro de una máscara, para que entre deslizándose desde abajo. */
const masked = (lines) => lines.map((l) => `<div class="ln">${l.split(' ').map((w) => `<span class="w"><span class="wi">${esc(w)}</span></span>`).join(' ')}</div>`).join('');

/** Reparte la duración entre escenas, con los cortes sobre el pulso. */
export function sceneTimes(scenes, duration) {
  const total = scenes.reduce((s, x) => s + (SCENE_WEIGHT[x.type] || 1), 0);
  let at = 0;
  return scenes.map((s, i) => {
    const last = i === scenes.length - 1;
    const len = last ? duration - at : Math.max(1.5, Math.round(((SCENE_WEIGHT[s.type] || 1) / total) * duration / BEAT) * BEAT);
    const out = { start: at, end: last ? duration : at + len };
    at = out.end;
    return out;
  });
}

/* ---------------------------------------------------------------- escenas: cada una devuelve su HTML y sus animaciones */
function renderScene(s, i, t, ctx) {
  const { W, H, u, theme, safeW } = ctx;
  const q = `.s${i}`;
  const t0 = t.start + (i ? 0.12 : 0.15);
  const len = t.end - t.start;
  const display = (text, box) => fitText(theme.upper ? text.toUpperCase() : text, { charWidth: theme.width, ...box });
  const rise = (sel, at, each = 0.07) => `tl.from("${q} ${sel}",{yPercent:115,duration:.75,stagger:${each},ease:"power4.out"},${n2(at)});`;
  const fadeUp = (sel, at, each = 0) => `tl.from("${q} ${sel}",{y:${Math.round(u * 3)},opacity:0,duration:.6,stagger:${each},ease:"power3.out"},${n2(at)});`;
  switch (s.type) {
    case 'hook': {
      const f = display(s.headline, { width: safeW, height: H * 0.56, max: u * 26 });
      return { html: `<div class="fill col"><div class="big" style="font-size:${f.size}px">${masked(f.lines)}</div><i class="bar"></i>${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ''}</div>`,
        code: [rise('.wi', t0), `tl.from("${q} .bar",{scaleX:0,duration:.6,ease:"expo.out"},${n2(t0 + 0.45)});`, s.sub ? fadeUp('.sub', t0 + 0.6) : ''] };
    }
    case 'words': {
      const each = (len - 0.2) / s.words.length;
      const items = s.words.map((w, k) => { const f = display(w, { width: safeW, height: H * 0.62, max: u * 26, maxLines: 3 }); return `<div class="fill center beat b${k}${k % 2 ? ' inv' : ''} clip" data-start="${n2(t.start + k * each)}" data-duration="${n2(each)}" data-track-index="2"><div class="big" style="font-size:${f.size}px">${f.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div></div>`; });
      return { html: items.join(''), code: s.words.map((_, k) => `tl.from("${q} .b${k} .big",{scale:1.28,opacity:0,duration:.34,ease:"power4.out"},${n2(t.start + k * each + 0.02)});`) };
    }
    case 'list': {
      const head = s.headline ? display(s.headline, { width: safeW, height: H * 0.2, max: u * 13, maxLines: 2 }) : null;
      const itemSize = Math.min(u * 8.6, (safeW * 0.84) / (Math.max(...s.items.map((x) => x.length)) * 0.54), ((H * (head ? 0.5 : 0.7)) / s.items.length) / 1.9);
      return { html: `<div class="fill col">${head ? `<div class="big head" style="font-size:${head.size}px">${masked(head.lines)}</div>` : ''}<ol class="rows">${s.items.map((x, k) => `<li style="font-size:${Math.floor(itemSize)}px"><b>${String(k + 1).padStart(2, '0')}</b><span>${esc(x)}</span><i></i></li>`).join('')}</ol></div>`,
        code: [head ? rise('.wi', t0) : '', `tl.from("${q} li i",{scaleX:0,duration:.6,stagger:.22,ease:"expo.out"},${n2(t0 + 0.25)});`, `tl.from("${q} li b, ${q} li span",{x:${Math.round(-u * 5)},opacity:0,duration:.55,stagger:.11,ease:"power3.out"},${n2(t0 + 0.3)});`] };
    }
    case 'stat': {
      const m = String(s.value).match(/^(\D*)([\d.,]*\d)(.*)$/) || ['', '', '0', ''];
      const target = Number(m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      const decimals = (String(target).split('.')[1] || '').length;
      const f = display(s.value, { width: safeW, height: H * 0.5, max: u * 34, maxLines: 1 });
      const grouped = /[.,]\d{3}\b/.test(m[2]);
      const sep = m[2].match(/[.,](?=\d{3}\b)/)?.[0] || '.';
      return { html: `<div class="fill center"><div class="big stat" style="font-size:${f.size}px" id="n${i}">${esc(s.value)}</div>${s.label ? `<p class="sub">${esc(s.label)}</p>` : ''}<i class="bar wide"></i></div>`,
        code: [`tl.from("${q} .stat",{scale:.72,opacity:0,duration:.6,ease:"back.out"},${n2(t0)});`, s.label ? fadeUp('.sub', t0 + 0.5) : '', `tl.from("${q} .bar",{scaleX:0,duration:1.1,ease:"expo.out"},${n2(t0 + 0.2)});`,
          `HV.onFrame(function(t){var p=Math.min(1,Math.max(0,(t-${n2(t0)})/1.2));p=1-Math.pow(1-p,4);var v=(${target}*p).toFixed(${decimals});document.getElementById("n${i}").textContent=${JSON.stringify(m[1])}+${grouped ? `v.replace(/\\B(?=(\\d{3})+$)/g,${JSON.stringify(sep)})` : 'v'}+${JSON.stringify(m[3])};});`] };
    }
    case 'quote': {
      const f = display(s.text, { width: safeW, height: H * 0.56, max: u * 15, maxLines: 5, charWidth: theme.width * 1.02 });
      return { html: `<div class="fill col"><div class="mark">“</div><div class="big q" style="font-size:${f.size}px">${masked(f.lines)}</div>${s.author ? `<p class="sub">${esc(s.author)}</p>` : ''}</div>`,
        code: [`tl.from("${q} .mark",{scale:.4,opacity:0,duration:.5,ease:"back.out"},${n2(t0)});`, rise('.wi', t0 + 0.15, 0.045), s.author ? fadeUp('.sub', t0 + 1) : ''] };
    }
    case 'compare': {
      const vertical = H > W;
      const side = (x, cls) => { const f = display(x.title, { width: vertical ? safeW : safeW * 0.42, height: H * 0.26, max: u * 19, maxLines: 2 }); return `<div class="half ${cls}"><div class="big" style="font-size:${f.size}px">${esc(theme.upper ? x.title.toUpperCase() : x.title)}</div>${x.text ? `<p class="sub">${esc(x.text)}</p>` : ''}</div>`; };
      const axis = vertical ? 'y' : 'x', far = vertical ? H : W;
      return { html: `<div class="fill halves${vertical ? ' stack' : ''}">${side(s.left, 'l')}${side(s.right, 'r')}</div>`,
        code: [`tl.from("${q} .l",{${axis}:${-far / 2},duration:.7,ease:"expo.out"},${n2(t0)});`, `tl.from("${q} .r",{${axis}:${far / 2},duration:.7,ease:"expo.out"},${n2(t0 + Math.min(0.9, len * 0.32))});`] };
    }
    default: {
      const f = display(s.headline, { width: safeW, height: H * 0.46, max: u * 34, maxLines: 2 });
      return { html: `<div class="fill center"><i class="ring"></i><div class="big" style="font-size:${f.size}px">${masked(f.lines)}</div>${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ''}${s.action ? `<p class="pill">${esc(s.action)}</p>` : ''}</div>`,
        code: [`tl.fromTo("${q} .ring",{scale:0,opacity:.9},{scale:3.2,opacity:0,duration:1.2,ease:"expo.out"},${n2(t0)});`, rise('.wi', t0 + 0.05), s.sub ? fadeUp('.sub', t0 + 0.55) : '', s.action ? `tl.from("${q} .pill",{scale:.6,opacity:0,duration:.5,ease:"back.out"},${n2(t0 + 0.8)});` : ''] };
    }
  }
}

/** El fondo propio de cada estilo: da profundidad sin competir con el texto. */
function decor(name, { W, H, u, theme, duration }) {
  const move = (sel, to) => `tl.to("${sel}",{${to},duration:${duration},ease:"none"},0);`;
  const r = Math.round;
  switch (name) {
    case 'impacto': return { html: `<i class="d d1" style="right:${-r(W * 0.08)}px;top:${-r(H * 0.3)}px;width:${r(u * 16)}px;height:${r(H * 1.6)}px;background:${theme.accent};opacity:.1;transform:rotate(24deg)"></i><i class="d d2" style="right:${r(W * 0.09)}px;top:${-r(H * 0.3)}px;width:${r(u * 5)}px;height:${r(H * 1.6)}px;background:${theme.alt};opacity:.16;transform:rotate(24deg)"></i>`, code: `tl.fromTo(".d1",{rotation:24,x:0},{rotation:24,x:${r(-W * 0.2)},duration:${duration},ease:"none"},0);tl.fromTo(".d2",{rotation:24,x:0},{rotation:24,x:${r(-W * 0.34)},duration:${duration},ease:"none"},0);` };
    case 'editorial': return { html: `<i class="d" style="inset:${r(u * 3.5)}px;border:${Math.max(2, r(u * 0.22))}px solid ${theme.ink};opacity:.34"></i><i class="d d1" style="right:${-r(u * 22)}px;bottom:${-r(u * 22)}px;width:${r(u * 62)}px;height:${r(u * 62)}px;border-radius:50%;background:${theme.accent};opacity:.08"></i>`, code: move('.d1', `x:${r(-u * 12)},y:${r(-u * 8)}`) };
    case 'tecno': return { html: `<i class="d d1" style="inset:-${r(u * 12)}px;background-image:linear-gradient(${theme.accent}22 1px,transparent 1px),linear-gradient(90deg,${theme.accent}22 1px,transparent 1px);background-size:${r(u * 8)}px ${r(u * 8)}px"></i>`, code: move('.d1', `x:${r(u * 8)},y:${r(u * 8)}`) };
    case 'pop': return { html: `<i class="d d1" style="right:${-r(u * 14)}px;top:${-r(u * 16)}px;width:${r(u * 58)}px;height:${r(u * 58)}px;border-radius:50%;background:${theme.accent}"></i><i class="d d2" style="left:${-r(u * 12)}px;bottom:${-r(u * 14)}px;width:${r(u * 40)}px;height:${r(u * 40)}px;background:${theme.alt}"></i>`, code: `${move('.d1', `x:${r(-u * 9)},y:${r(u * 7)}`)}${move('.d2', `rotation:90,x:${r(u * 7)}`)}` };
    case 'calido': return { html: `<i class="d d1" style="left:50%;top:${r(H * 0.5)}px;width:${r(u * 120)}px;height:${r(u * 120)}px;margin-left:-${r(u * 60)}px;border-radius:50%;background:radial-gradient(circle,${theme.accent}40,transparent 62%)"></i>`, code: `tl.fromTo(".d1",{y:${r(H * 0.2)},scale:.8},{y:${r(-H * 0.5)},scale:1.25,duration:${duration},ease:"none"},0);` };
    default: return { html: '', code: '' };
  }
}

/** La transición entre dos escenas: cubre el corte y descubre la siguiente. */
function transition(kind, at, theme, axis) {
  const t = n2(at - 0.26);
  const out = n2(at);
  if (kind === 'fade') return `tl.fromTo(".cut",{opacity:0},{opacity:1,duration:.26,ease:"none"},${t}).to(".cut",{opacity:0,duration:.34,ease:"none"},${out});`;
  if (kind === 'bars') return `tl.fromTo(".cutbar",{scaleX:0,transformOrigin:"0 50%"},{scaleX:1,duration:.26,stagger:.03,ease:"power3.in"},${n2(at - 0.36)}).set(".cutbar",{transformOrigin:"100% 50%"},${out}).to(".cutbar",{scaleX:0,duration:.3,stagger:.03,ease:"power3.out"},${out});`;
  const p = kind === 'rise' || (kind === 'slide' && axis) ? 'yPercent' : 'xPercent';
  return `tl.fromTo(".cut",{${p}:101,opacity:1},{${p}:0,duration:.26,ease:"power3.in"},${t}).to(".cut",{${p}:-101,duration:.32,ease:"power3.out"},${out});`;
}

/** Composición completa a partir de un guion normalizado. */
export function buildComposition(board, { ratio = '16:9', duration = 10, theme: forced = '', sound = true } = {}) {
  const [W, H] = HV_RATIOS[ratio] || HV_RATIOS['16:9'];
  const base = THEMES[forced] || THEMES[board.mood] || THEMES.impacto;
  const theme = { ...base, accent: !forced && board.accent ? board.accent : base.accent };
  const u = Math.min(W, H) / 100;
  const safeW = Math.round(W * 0.82);
  const times = sceneTimes(board.scenes, duration);
  const ctx = { W, H, u, theme, safeW };
  const parts = board.scenes.map((s, i) => ({ s, t: times[i], ...renderScene(s, i, times[i], ctx) }));
  const cuts = times.slice(1).map((t) => t.start);
  const scenes = parts.map((p, i) => `<section class="clip scene s${i}" data-start="${n2(p.t.start)}" data-duration="${n2(p.t.end - p.t.start)}" data-track-index="1">${p.html}</section>`).join('\n  ');
  const code = parts.flatMap((p) => p.code).filter(Boolean).join('\n');
  const themeName = forced && THEMES[forced] ? forced : THEMES[board.mood] ? board.mood : 'impacto';
  const art = decor(themeName, { W, H, u, theme, duration });
  const bars = Array.from({ length: 6 }, (_, k) => `<i class="cutbar" style="top:${(k * 100) / 6}%"></i>`).join('');
  return `<style>
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${theme.bg};color:${theme.ink};font-family:"${theme.body}",Arial,sans-serif}
.d{position:absolute;display:block}
.prog{position:absolute;left:0;bottom:0;width:100%;height:${Math.max(4, Math.round(u * 0.55))}px;background:${theme.accent};transform-origin:0 50%;z-index:15}
.bg{position:absolute;inset:-12%;background:radial-gradient(circle at 18% 22%,${theme.accent}26,transparent 42%),radial-gradient(circle at 84% 78%,${theme.alt}24,transparent 46%)}
.scene{position:absolute;inset:0}
.fill{position:absolute;inset:0;padding:${Math.round(H * 0.1)}px ${Math.round(W * 0.09)}px;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box}
.center{align-items:center;text-align:center}
.big{font-family:"${theme.display}",Impact,sans-serif;font-weight:${theme.display === 'Playfair Display' ? 800 : theme.display === 'Space Grotesk' ? 700 : 400};line-height:1.04;letter-spacing:${theme.upper ? '.005em' : '-.015em'}}
.ln{white-space:nowrap}.w{display:inline-block;overflow:hidden;vertical-align:top;padding:.04em .02em .08em;margin:-.04em -.02em -.08em}.wi{display:inline-block}
.bar{display:block;width:${Math.round(u * 22)}px;height:${Math.round(u * 1.5)}px;margin-top:${Math.round(u * 4)}px;background:${theme.accent};transform-origin:0 50%}
.bar.wide{width:${Math.round(u * 54)}px;transform-origin:50% 50%}
.sub{margin:${Math.round(u * 3.4)}px 0 0;font-size:${Math.round(u * 5.6)}px;line-height:1.3;font-weight:500;max-width:${Math.round(safeW * 0.86)}px;opacity:.86}
.beat.inv{background:${theme.accent};color:${theme.bg}}
.head{margin-bottom:${Math.round(u * 5)}px;color:${theme.accent}}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:${Math.round(u * 3.2)}px}
.rows li{position:relative;display:grid;grid-template-columns:${Math.round(u * 11)}px 1fr;align-items:baseline;padding-bottom:${Math.round(u * 2.6)}px;font-weight:500;line-height:1.16}
.rows b{font-family:"${theme.display}",Impact,sans-serif;font-weight:400;color:${theme.accent}}
.rows i{position:absolute;left:0;right:0;bottom:0;height:${Math.max(2, Math.round(u * 0.26))}px;background:${theme.ink};opacity:.28;transform-origin:0 50%}
.stat{color:${theme.accent};font-variant-numeric:tabular-nums}
.mark{font-family:"${theme.display}",Georgia,serif;font-size:${Math.round(u * 34)}px;line-height:.62;height:${Math.round(u * 15)}px;color:${theme.accent}}
.halves{flex-direction:row;padding:0}.halves.stack{flex-direction:column}
.half{flex:1;display:flex;flex-direction:column;justify-content:center;padding:${Math.round(u * 8)}px;box-sizing:border-box}
.half.r{background:${theme.accent};color:${theme.bg}}
.ring{position:absolute;left:50%;top:50%;width:${Math.round(u * 42)}px;height:${Math.round(u * 42)}px;margin:-${Math.round(u * 21)}px 0 0 -${Math.round(u * 21)}px;border:${Math.round(u * 1.2)}px solid ${theme.accent};border-radius:50%;box-sizing:border-box}
.pill{margin:${Math.round(u * 4)}px 0 0;padding:${Math.round(u * 1.6)}px ${Math.round(u * 4)}px;font-size:${Math.round(u * 4.6)}px;font-weight:500;background:${theme.accent};color:${theme.bg}}
.cut{position:absolute;inset:0;background:${theme.accent};opacity:${theme.cut === 'fade' ? 0 : 1};transform:translate(101%,0);z-index:20}
.cutbar{position:absolute;left:0;width:100%;height:calc(100% / 6 + 1px);background:${theme.accent};transform:scaleX(0);z-index:20}
</style>
<div id="stage" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${W}" data-height="${H}" data-music="${sound ? theme.music : 'none'}" data-cues="${cuts.map(n2).join(',')}">
  <div class="bg"></div>${art.html}
  ${scenes}
  <i class="prog"></i>
  ${theme.cut === 'bars' ? bars : '<div class="cut"></div>'}
</div>
<script>
const tl = gsap.timeline({ paused: true });
tl.fromTo(".bg",{x:${Math.round(-u * 6)},y:${Math.round(-u * 3)},scale:1},{x:${Math.round(u * 6)},y:${Math.round(u * 3)},scale:1.1,duration:${duration},ease:"none"},0);
tl.fromTo(".prog",{scaleX:0},{scaleX:1,duration:${duration},ease:"none"},0);
${art.code}
${code}
${cuts.map((c) => transition(theme.cut, c, theme, H > W)).join('\n')}
window.__timelines["main"] = tl;
</script>`;
}
