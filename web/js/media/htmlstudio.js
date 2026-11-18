// Pestaña HTML del estudio: pedir una composición, verla, retocarla y exportarla a MP4.
import { HV_DURATIONS, HV_RATIOS, HV_STYLES, lintComposition } from './htmlvideo.js';
import { exportHtmlVideo, mountComposition, sizeOfRatio, writeComposition } from './htmlrender.js';

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** deps: { esc, store, toast, chatText, saveVideo(blob, meta) → item, showItem(id) } */
export function createHtmlPanel(deps) {
  const { esc, store, toast } = deps;
  const s = { brief: '', ratio: '16:9', duration: 10, html: '', view: 'preview', ...store.get('media:draft:html', {}) };
  const live = { busy: '', progress: 0, error: '', ctl: null, comp: null, t: 0, length: 0, playing: false, raf: 0, refine: '', issues: [] };
  let els = {};
  const save = () => store.set('media:draft:html', { brief: s.brief, ratio: s.ratio, duration: s.duration, html: s.html, view: s.view });

  function stop() { live.playing = false; cancelAnimationFrame(live.raf); }
  function unmount() { stop(); live.comp?.close(); live.comp = null; }
  function setError(msg) { live.error = msg || ''; deps.showError(live.error); }

  const seg = (name, values, cur, label = (v) => v) => `<div class="seg st-seg" role="group">${values.map((v) => `<button type="button" class="${String(v) === String(cur) ? 'active' : ''}" data-hv="${name}" data-value="${esc(String(v))}" aria-pressed="${String(v) === String(cur)}">${esc(String(label(v)))}</button>`).join('')}</div>`;

  function controls() {
    return `<div class="st-field st-prompt">
        <label class="label" for="hv-brief">Qué vídeo quieres</label>
        <textarea id="hv-brief" data-hv-f="brief" rows="6" placeholder="Anuncio de 10 segundos para una cafetería: titular grande, tres beneficios y cierre con el logo escrito en texto.">${esc(s.brief)}</textarea>
        <div class="chips st-presets" aria-label="Tipo de pieza">${HV_STYLES.map((p) => `<button type="button" class="chip${s.brief.includes(p) ? ' on' : ''}" data-hv-style="${esc(p)}" aria-pressed="${s.brief.includes(p)}">${esc(p)}</button>`).join('')}</div>
        <p class="fine">Tu modelo de chat escribe la animación y este dispositivo la convierte en MP4. No gasta créditos de vídeo.</p>
      </div>
      <div class="st-field"><span class="label">Proporción</span>${seg('ratio', Object.keys(HV_RATIOS), s.ratio)}</div>
      <div class="st-field"><span class="label">Duración</span>${seg('duration', HV_DURATIONS, s.duration, (v) => `${v} s`)}</div>
      ${s.html ? `<div class="st-field"><label class="label" for="hv-refine">Pedir cambios</label><textarea id="hv-refine" data-hv-live="refine" rows="2" placeholder="Hazlo más rápido y cambia el fondo a azul noche">${esc(live.refine)}</textarea><button class="btn sm" type="button" data-hv-act="refine" ${live.busy ? 'disabled' : ''}>Aplicar cambios</button></div>` : ''}`;
  }

  function button() {
    const b = els.go;
    if (!b) return;
    b.textContent = live.busy ? `${live.busy} · Cancelar` : s.html ? 'Exportar MP4' : 'Crear composición';
    els.summary.textContent = `${s.ratio} · ${s.duration} s · 30 fps · sin sonido`;
  }

  function stage() {
    els.actions.innerHTML = s.html ? `${seg('view', ['preview', 'code'], s.view, (v) => (v === 'preview' ? 'Vista previa' : 'Código'))}<span class="st-gap"></span>
      ${s.html ? `<button class="btn ghost sm" type="button" data-hv-act="redo" ${live.busy ? 'disabled' : ''}>${icon('undo')}Rehacer</button>` : ''}` : '';
    unmount();
    if (live.busy && !s.html) {
      els.view.innerHTML = `<div class="st-empty"><h2 class="st-h">${esc(live.busy)}</h2><p class="note">El modelo está escribiendo la animación.</p></div>`;
      return;
    }
    if (!s.html) {
      els.view.innerHTML = '<div class="st-empty"><h2 class="st-h">Tu composición aparecerá aquí</h2><p class="note">Describe la pieza a la izquierda. Podrás verla, pedir cambios, editar su código y exportarla a MP4.</p></div>';
      return;
    }
    if (s.view === 'code') {
      els.view.innerHTML = `<div class="hv-code"><label class="sr" for="hv-source">Código de la composición</label><textarea id="hv-source" class="mono" spellcheck="false" data-hv-f="html">${esc(s.html)}</textarea><p class="fine hv-lint" id="hv-lint"></p></div>`;
      lint();
      return;
    }
    els.view.innerHTML = `<div class="hv-preview"><div class="hv-fit" id="hv-fit"><div class="hv-scale" id="hv-scale"></div></div>
      <div class="hv-bar"><button class="icon-btn" type="button" data-hv-act="play" aria-label="Reproducir">${icon('play')}</button>
      <input id="hv-time" type="range" min="0" max="1000" value="0" aria-label="Posición del vídeo"><span class="fine mono" id="hv-clock">0:00</span></div>
      ${live.busy ? `<div class="hv-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(live.progress * 100)}"><i style="width:${live.progress * 100}%"></i></div>` : ''}</div>`;
    mountPreview();
  }

  function lint() {
    const el = els.view.querySelector('#hv-lint');
    if (!el) return;
    const issues = lintComposition(s.html);
    el.textContent = issues.length ? issues.map((x) => x.message).join(' · ') : 'Composición correcta.';
    el.classList.toggle('bad', !!issues.length);
  }

  async function mountPreview() {
    const { width, height } = sizeOfRatio(s.ratio);
    const box = els.view.querySelector('#hv-scale');
    const fit = els.view.querySelector('#hv-fit');
    const comp = mountComposition(s.html, { width, height, duration: s.duration, parent: box });
    live.comp = comp;
    const resize = () => {
      const k = Math.min(fit.clientWidth / width, fit.clientHeight / height) || 0.1;
      box.style.transform = `scale(${k})`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.left = `${(fit.clientWidth - width * k) / 2}px`;
      box.style.top = `${(fit.clientHeight - height * k) / 2}px`;
    };
    resize();
    new ResizeObserver(resize).observe(fit);
    comp.on((m) => { if (m.type === 'error') setError(`Error en la composición: ${m.message}`); });
    try {
      const info = await comp.ready;
      if (live.comp !== comp) return;
      live.length = Number(info.duration) || s.duration;
      seekTo(0);
    } catch (e) { if (live.comp === comp) setError(e.message); }
  }
  function seekTo(t) {
    live.t = Math.max(0, Math.min(live.length, t));
    live.comp?.send({ cmd: 'seek', t: live.t });
    const range = els.view.querySelector('#hv-time');
    if (range) range.value = String(Math.round((live.t / (live.length || 1)) * 1000));
    const c = els.view.querySelector('#hv-clock');
    if (c) c.textContent = `${clock(live.t)} / ${clock(live.length)}`;
  }
  function togglePlay() {
    if (live.playing) { stop(); playIcon(); return; }
    live.playing = true;
    playIcon();
    if (live.t >= live.length) seekTo(0);
    let last = performance.now();
    const tick = (now) => {
      if (!live.playing) return;
      seekTo(live.t + (now - last) / 1000);
      last = now;
      if (live.t >= live.length) { stop(); playIcon(); return; }
      live.raf = requestAnimationFrame(tick);
    };
    live.raf = requestAnimationFrame(tick);
  }
  function playIcon() {
    const b = els.view.querySelector('[data-hv-act="play"]');
    if (!b) return;
    b.innerHTML = icon(live.playing ? 'stop' : 'play');
    b.setAttribute('aria-label', live.playing ? 'Pausar' : 'Reproducir');
  }

  async function write(brief, previous = '') {
    if (!deps.chatText) { setError('Conecta un modelo de chat para escribir la composición.'); return; }
    setError('');
    live.ctl = new AbortController();
    live.busy = 'Escribiendo…';
    deps.refresh();
    try {
      const r = await writeComposition({ brief, ratio: s.ratio, duration: s.duration, previous, chatText: deps.chatText, signal: live.ctl.signal, onStatus: (t) => { live.busy = t; button(); } });
      s.html = r.html;
      s.view = 'preview';
      live.refine = '';
      save();
      if (r.issues.length) setError(`Revisa la composición: ${r.issues.map((x) => x.message).join(' ')}`);
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); } finally { live.busy = ''; live.ctl = null; deps.refresh(); }
  }

  async function exportNow() {
    setError('');
    stop();
    live.ctl = new AbortController();
    live.busy = 'Exportando… 0 %';
    live.progress = 0;
    deps.refresh();
    try {
      const blob = await exportHtmlVideo(s.html, { ratio: s.ratio, duration: s.duration, signal: live.ctl.signal, onProgress: (p) => {
        live.progress = p;
        live.busy = `Exportando… ${Math.round(p * 100)} %`;
        button();
        const bar = els.view.querySelector('.hv-progress');
        if (bar) { bar.firstElementChild.style.width = `${p * 100}%`; bar.setAttribute('aria-valuenow', String(Math.round(p * 100))); }
      } });
      const item = await deps.saveVideo(blob, { prompt: s.brief || 'Composición HTML', html: s.html, ratio: s.ratio, duration: s.duration });
      live.busy = '';
      toast('VÍDEO EXPORTADO');
      deps.showItem(item.id);
    } catch (e) {
      live.busy = '';
      if (e.name !== 'AbortError') setError(e.message);
      deps.refresh();
    } finally { live.ctl = null; }
  }

  return {
    attach(next) { els = next; },
    controls,
    stage,
    button,
    leave: unmount,
    /** Abre una composición ya exportada para seguir trabajándola. */
    load(item) { s.html = item.html; s.brief = item.prompt; s.ratio = item.params?.ratio || s.ratio; s.duration = Number(item.params?.duration) || s.duration; s.view = 'preview'; save(); },
    async submit() {
      if (live.busy) { live.ctl?.abort(); return; }
      if (s.html) return exportNow();
      if (!s.brief.trim()) { setError('Describe primero el vídeo que quieres.'); return; }
      return write(s.brief.trim());
    },
    onClick(t) {
      const pick = t.closest('[data-hv]');
      if (pick) {
        const { hv: name, value } = pick.dataset;
        const before = s[name];
        s[name] = name === 'duration' ? Number(value) : value;
        save();
        // la composición está medida para un formato: si cambia, se adapta en vez de verse cortada
        if (s.html && ['ratio', 'duration'].includes(name) && String(before) !== String(s[name]) && !live.busy) write(`Adapta la composición a ${s.ratio} y ${s.duration} segundos.`, s.html);
        else deps.refresh();
        return true;
      }
      const style = t.closest('[data-hv-style]');
      if (style) {
        const p = style.dataset.hvStyle;
        s.brief = s.brief.includes(p) ? s.brief.replace(new RegExp(`[,.]?\\s*${p}`), '').trim() : [s.brief.trim().replace(/[.,]$/, ''), p].filter(Boolean).join(', ');
        save();
        deps.refresh();
        return true;
      }
      const act = t.closest('[data-hv-act]')?.dataset.hvAct;
      if (!act) return false;
      if (act === 'play') togglePlay();
      if (act === 'refine') { if (live.refine.trim()) write(live.refine.trim(), s.html); else els.view.ownerDocument.querySelector('#hv-refine')?.focus(); }
      if (act === 'redo') { s.html = ''; save(); deps.refresh(); }
      return true;
    },
    onInput(t) {
      if (t.id === 'hv-time') { stop(); playIcon(); seekTo((Number(t.value) / 1000) * live.length); return true; }
      if (t.dataset.hvF) { s[t.dataset.hvF] = t.value; save(); if (t.dataset.hvF === 'html') lint(); return true; }
      if (t.dataset.hvLive) { live[t.dataset.hvLive] = t.value; return true; }
      return false;
    },
  };
}
