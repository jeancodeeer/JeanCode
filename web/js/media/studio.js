// Modo IMAGEN: el estudio donde se escribe el prompt con calma, se ajusta cada parámetro que admite el modelo y se
// edita el resultado. El chat y el agente generan con el mismo servicio; aquí está el control fino.
import { GUIDE_FIELDS, composePrompt, expandPrompt, improveInstruction } from './engine.js';
import { library, extOf, makeThumb, slugOf } from './service.js';
import { createHtmlPanel } from './htmlstudio.js';
import { applyAdjust, adjusted, canvasBlob, canvasFromBlob, canvasOf, cropRect, cropped, flipped, maskFrom, referenceDataUrl, rotated } from './edit.js';

const PRESETS = {
  image: ['fotografía realista', 'fotograma de cine', 'anime', 'acuarela', 'óleo', 'render 3D', 'pixel art', 'dibujo a línea', 'isométrico', 'foto de producto'],
  video: ['plano secuencia', 'cámara en mano', 'toma de dron', 'cámara lenta', 'timelapse', 'zoom lento', 'travelling lateral', 'stop motion'],
};
const LABELS = { auto: 'Auto', low: 'Baja', medium: 'Media', high: 'Alta' };
const BILLING = { local: 'En tu equipo · sin coste por uso', own: 'Tu servidor · sin cobro por uso', free: 'Gratis según el proveedor', paid: 'De pago · cada generación consume saldo' };
const blank = (kind) => ({ prompt: '', negative: '', ratio: kind === 'video' ? '16:9' : '1:1', resolution: '', count: 1, duration: '', seed: '', steps: '', guidance: '', quality: 'auto', background: false, audio: true, tab: 'free', guide: {} });
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** deps: { $, esc, store, toast, confirmDialog, downloadBlob, service, chatText(system, user, signal) → texto | null, openSettings } */
export function initStudio(deps) {
  const { $, esc, store, toast, confirmDialog, downloadBlob, service } = deps;
  const view = $('#view-image');
  const rail = $('#media-gallery');
  const st = {
    kind: store.get('media:kind', 'image'),
    forms: { image: { ...blank('image'), ...store.get('media:draft:image', {}) }, video: { ...blank('video'), ...store.get('media:draft:video', {}) } },
    refs: [], start: null, end: null, // imágenes de entrada: { url (dataURL), name }
    current: null, items: [], filter: 'all', urls: new Map(), error: '', improving: null, undoPrompt: null, editor: null, manual: false,
  };
  const form = () => st.forms[st.kind];
  const model = () => service.pick(st.kind);
  const urlOf = (item) => {
    if (!item.blob) return item.remoteUrl || '';
    if (!st.urls.has(item.id)) st.urls.set(item.id, URL.createObjectURL(item.blob));
    return st.urls.get(item.id);
  };
  let draftTimer = null;
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { store.set('media:draft:image', st.forms.image); store.set('media:draft:video', st.forms.video); }, 300);
  };

  /* ---------------------------------------------------------------- estructura */
  view.innerHTML = `
    <form class="st-panel" id="st-form" autocomplete="off">
      <div class="st-scroll" id="st-controls"></div>
      <div class="st-go">
        <p class="fine st-summary" id="st-summary" aria-live="polite"></p>
        <div class="st-fail" id="st-fail" hidden><p class="st-error" id="st-error" role="alert"></p><button class="btn sm" type="button" id="st-fix" hidden></button></div>
        <button class="btn primary st-generate" id="st-generate" type="submit">Generar</button>
      </div>
    </form>
    <div class="st-stage" id="st-stage">
      <div class="st-bar" id="st-actions"></div>
      <div class="st-view" id="st-view"></div>
      <div class="st-strip" id="st-strip" aria-label="Versiones y trabajos en curso"></div>
    </div>`;

  const html = createHtmlPanel({
    esc, store, toast, chatText: deps.chatText, showError: (m) => showError(m),
    refresh: () => { renderControls(); renderStage(); },
    saveVideo: (blob, meta) => service.saveHtmlVideo(blob, meta),
    showItem: async (id) => { html.leave(); st.kind = 'video'; store.set('media:kind', 'video'); st.items = await library.list(); renderControls(); select(id); },
  });
  html.attach({ go: $('#st-generate'), summary: $('#st-summary'), actions: $('#st-actions'), view: $('#st-view') });

  /* ---------------------------------------------------------------- panel de controles */
  const kindTabs = () => `<div class="seg st-kind" role="tablist" aria-label="Qué generar">${[['image', 'Imagen'], ['video', 'Vídeo'], ['html', 'HTML']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${st.kind === k}" class="${st.kind === k ? 'active' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>`;
  function modelOptions() {
    const list = service.catalog(st.kind);
    const groups = new Map();
    for (const m of list) { const g = m.ep ? deps.providerName(m.ep) : ''; groups.set(g, [...(groups.get(g) || []), m]); }
    const cur = model()?.key;
    const opt = (m) => `<option value="${esc(m.key)}"${m.key === cur ? ' selected' : ''}>${esc(m.id)}</option>`;
    return (groups.size > 1 ? [...groups].map(([g, ms]) => `<optgroup label="${esc(g)}">${ms.map(opt).join('')}</optgroup>`).join('') : list.map(opt).join(''))
      + '<option value="__manual">Escribir otro modelo…</option>';
  }
  const seg = (name, values, cur, label = (v) => v) => `<div class="seg st-seg" role="group">${values.map((v) => `<button type="button" class="${String(v) === String(cur) ? 'active' : ''}" data-pick="${name}" data-value="${esc(String(v))}" aria-pressed="${String(v) === String(cur)}">${esc(String(label(v)))}</button>`).join('')}</div>`;
  const ratioButtons = (ratios, cur) => `<div class="st-ratios" role="group" aria-label="Proporción">${ratios.map((r) => {
    const [a, b] = r.split(':').map(Number);
    const k = 18 / Math.max(a, b);
    return `<button type="button" class="st-ratio${r === cur ? ' active' : ''}" data-pick="ratio" data-value="${esc(r)}" aria-pressed="${r === cur}"><i style="width:${Math.max(6, a * k)}px;height:${Math.max(6, b * k)}px"></i>${esc(r)}</button>`;
  }).join('')}</div>`;
  const thumb = (slot, x, i) => `<span class="st-thumb"><img src="${esc(x.url)}" alt="${esc(x.name)}"><button type="button" class="st-thumb-x" data-drop="${slot}" data-i="${i}" aria-label="Quitar ${esc(x.name)}">${icon('close')}</button></span>`;
  const dropZone = (slot, label, list, max) => `<div class="st-field"><span class="label">${label}</span><div class="st-inputs">${list.map((x, i) => thumb(slot, x, i)).join('')}${list.length < max ? `<label class="st-add">${icon('plus')}<span class="sr">Añadir ${label.toLowerCase()}</span><input type="file" accept="image/png,image/jpeg,image/webp" data-file="${slot}" ${max > 1 ? 'multiple' : ''}></label>` : ''}</div></div>`;

  function renderControls() {
    if (st.kind === 'html') {
      $('#st-controls').innerHTML = kindTabs() + html.controls();
      html.button();
      return;
    }
    const f = form();
    const m = model();
    const c = m ? service.controls(m) : null;
    // lo que este modelo no admite vuelve a un valor válido (y no se envía)
    if (c) {
      if (!c.ratios.includes(f.ratio)) f.ratio = c.ratios[0];
      if (c.resolutions.length && !c.resolutions.includes(f.resolution)) f.resolution = c.resolutions[Math.min(1, c.resolutions.length - 1)];
      if (c.durations.length && !c.durations.map(String).includes(String(f.duration))) f.duration = c.durations[0];
      f.count = Math.min(f.count, c.count) || 1;
      st.refs = st.refs.slice(0, c.refs);
      if (!c.start) st.start = null;
      if (!c.end) st.end = null;
    }
    if (!m) {
      $('#st-controls').innerHTML = `${kindTabs()}<div class="st-none"><h2 class="st-h">Conecta un modelo de ${st.kind === 'video' ? 'vídeo' : 'imagen'}</h2>
        <p class="note">Ninguna de tus conexiones ofrece uno todavía. ${st.kind === 'video' ? 'OpenRouter, xAI, Together, SiliconFlow, Google y MiniMax generan vídeo.' : 'OpenAI, OpenRouter, xAI, Together, SiliconFlow, Google y MiniMax generan imágenes; también cualquier servidor con /images/generations.'}</p>
        <div class="row gap wrap"><button class="btn" type="button" data-act="settings">Abrir Ajustes</button>${manualForm()}</div>${st.kind === 'video' ? '<p class="note">También puedes crear vídeo sin un modelo de vídeo en la pestaña HTML.</p>' : ''}</div>`;
      $('#st-generate').disabled = true;
      $('#st-summary').textContent = '';
      return;
    }
    $('#st-generate').disabled = false;
    const guided = f.tab === 'guide';
    const advanced = c.seed || c.steps || c.guidance || c.background || c.qualities.length;
    $('#st-controls').innerHTML = `${kindTabs()}
      <div class="st-field"><label class="label" for="st-model">Modelo</label>
        <select id="st-model" class="mono">${modelOptions()}</select>
        <span class="fine">${esc(BILLING[service.billing(m)] || 'Coste según tu proveedor')}</span>${st.manual ? manualForm() : ''}</div>
      <div class="st-field st-prompt">
        <div class="st-head"><span class="label" id="st-prompt-l">Prompt</span>${seg('tab', ['free', 'guide'], f.tab, (v) => (v === 'free' ? 'Libre' : 'Guiado'))}</div>
        ${guided ? `<div class="st-guide">${GUIDE_FIELDS.map(([k, l, ph]) => `<label><span class="fine">${l}</span><input type="text" data-guide="${k}" value="${esc(f.guide[k] || '')}" placeholder="${esc(ph)}"></label>`).join('')}</div>
          <p class="st-compiled fine" id="st-compiled">${esc(composePrompt(f.guide) || 'El prompt se escribe solo mientras rellenas los campos.')}</p>`
    : `<textarea id="st-prompt" data-f="prompt" rows="6" aria-labelledby="st-prompt-l" placeholder="${st.kind === 'video' ? 'Describe la escena, qué se mueve y cómo se mueve la cámara…' : 'Describe la imagen: sujeto, lugar, estilo, luz…'}">${esc(f.prompt)}</textarea>`}
        <div class="st-tools">
          <button class="btn ghost sm" type="button" data-act="improve" ${deps.chatText ? '' : 'disabled title="Conecta un modelo de chat para mejorar prompts"'}>${icon('spark')}${st.improving ? 'Mejorando…' : 'Mejorar prompt'}</button>
          ${st.undoPrompt != null ? '<button class="btn quiet sm" type="button" data-act="undo-prompt">Deshacer</button>' : ''}
          <span class="fine st-count" id="st-count"></span>
        </div>
        <div class="chips st-presets" aria-label="Añadir un estilo al prompt">${PRESETS[st.kind].map((p) => `<button type="button" class="chip${promptText().toLowerCase().includes(p) ? ' on' : ''}" data-preset="${esc(p)}" aria-pressed="${promptText().toLowerCase().includes(p)}">${esc(p)}</button>`).join('')}</div>
        <p class="fine">Escribe <code>{rojo|azul}</code> para generar una variante por opción.</p>
      </div>
      ${c.negative ? `<div class="st-field"><label class="label" for="st-negative">Evitar</label><textarea id="st-negative" data-f="negative" rows="2" placeholder="Lo que no debe aparecer">${esc(f.negative)}</textarea></div>` : ''}
      ${c.refs ? dropZone('refs', st.kind === 'video' ? 'Referencias' : 'Imágenes de referencia', st.refs, c.refs) : ''}
      ${c.start ? dropZone('start', 'Primer fotograma', st.start ? [st.start] : [], 1) : ''}
      ${c.end ? dropZone('end', 'Último fotograma', st.end ? [st.end] : [], 1) : ''}
      <div class="st-field"><span class="label">Proporción</span>${ratioButtons(c.ratios, f.ratio)}</div>
      ${c.resolutions.length ? `<div class="st-field"><span class="label">Resolución</span>${seg('resolution', c.resolutions, f.resolution)}</div>` : ''}
      ${c.durations.length ? `<div class="st-field"><span class="label">Duración</span>${seg('duration', c.durations, f.duration, (v) => `${v} s`)}</div>` : ''}
      ${c.count > 1 ? `<div class="st-field"><span class="label">Cantidad</span>${seg('count', Array.from({ length: Math.min(c.count, 4) }, (_, i) => i + 1), f.count)}</div>` : ''}
      ${c.audio ? `<label class="check"><input type="checkbox" data-f="audio" ${f.audio ? 'checked' : ''}> Generar sonido</label>` : ''}
      ${advanced ? `<details class="st-adv"${store.get('media:adv', false) ? ' open' : ''}><summary class="label">Avanzado</summary><div class="st-adv-body">
        ${c.qualities.length ? `<div class="st-field"><span class="label">Calidad</span>${seg('quality', c.qualities, f.quality, (v) => LABELS[v] || v)}</div>` : ''}
        ${c.seed ? `<div class="st-field"><label class="label" for="st-seed">Semilla</label><div class="row gap"><input id="st-seed" class="mono grow" data-f="seed" inputmode="numeric" value="${esc(String(f.seed))}" placeholder="Al azar"><button class="btn ghost sm" type="button" data-act="seed">Al azar</button></div></div>` : ''}
        ${c.steps ? `<div class="st-field"><label class="label" for="st-steps">Pasos</label><input id="st-steps" class="mono" data-f="steps" inputmode="numeric" value="${esc(String(f.steps))}" placeholder="Del modelo"></div>` : ''}
        ${c.guidance ? `<div class="st-field"><label class="label" for="st-guidance">Fidelidad al prompt</label><input id="st-guidance" class="mono" data-f="guidance" inputmode="decimal" value="${esc(String(f.guidance))}" placeholder="Del modelo"></div>` : ''}
        ${c.background ? '<label class="check"><input type="checkbox" data-f="background"' + (f.background ? ' checked' : '') + '> Fondo transparente</label>' : ''}
      </div></details>` : ''}`;
    summary();
  }
  function manualForm() {
    const eps = deps.endpoints();
    if (!eps.length) return '';
    return `<div class="st-manual"><select id="st-manual-ep" aria-label="Conexión">${eps.map((e) => `<option value="${esc(e.id)}">${esc(deps.providerName(e))}</option>`).join('')}</select>
      <input id="st-manual-id" class="mono" placeholder="id exacto del modelo" spellcheck="false" aria-label="Id del modelo"><button class="btn sm" type="button" data-act="manual-add">Añadir</button></div>`;
  }
  const promptText = () => (form().tab === 'guide' ? composePrompt(form().guide) : form().prompt);
  function summary() {
    const f = form();
    const m = model();
    if (!m) return;
    const c = service.controls(m);
    const variants = expandPrompt(promptText() || ' ').length;
    const total = variants * (st.kind === 'image' ? f.count : 1);
    const noun = st.kind === 'video' ? (total > 1 ? 'vídeos' : 'vídeo') : (total > 1 ? 'imágenes' : 'imagen');
    $('#st-summary').textContent = [`${total} ${noun}`, f.ratio, c.resolutions.length ? f.resolution : '', c.durations.length ? `${f.duration} s` : ''].filter(Boolean).join(' · ');
    $('#st-generate').textContent = total > 1 ? `Generar ${total}` : 'Generar';
    const n = $('#st-count');
    if (n) n.textContent = variants > 1 ? `${variants} variantes` : `${promptText().length} caracteres`;
    const comp = $('#st-compiled');
    if (comp) comp.textContent = composePrompt(f.guide) || 'El prompt se escribe solo mientras rellenas los campos.';
  }
  /** Error visible con la salida que tiene: reintentar o ir a Ajustes. */
  function showError(msg, action = '') {
    if (msg) window.dispatchEvent(new CustomEvent('jc:mascot', { detail: { fail: true } }));
    st.error = msg;
    $('#st-fail').hidden = !msg;
    $('#st-error').textContent = msg || '';
    const fix = $('#st-fix');
    fix.hidden = !msg || !action;
    fix.dataset.fix = action;
    fix.textContent = action === 'settings' ? 'Abrir Ajustes' : 'Reintentar';
  }

  /* ---------------------------------------------------------------- generar */
  function requestOf(prompt) {
    const f = form();
    const m = model();
    const c = service.controls(m);
    const req = { kind: st.kind, modelKey: m.key, prompt, ratio: f.ratio, count: 1 };
    if (c.negative && f.negative.trim()) req.negative = f.negative.trim();
    if (c.resolutions.length) req.resolution = f.resolution;
    if (c.durations.length) req.duration = Number(f.duration);
    if (c.count > 1) req.count = f.count;
    if (c.seed && f.seed !== '') req.seed = f.seed;
    if (c.steps && f.steps !== '') req.steps = f.steps;
    if (c.guidance && f.guidance !== '') req.guidance = f.guidance;
    if (c.qualities.length) req.quality = f.quality;
    if (c.background && f.background) req.background = true;
    if (c.audio) req.audio = !!f.audio;
    if (st.refs.length) req.refs = st.refs.map((x) => x.url);
    if (st.start) req.start = st.start.url;
    if (st.end) req.end = st.end.url;
    return req;
  }
  async function launch(reqs, opts = {}) {
    showError('');
    const batch = crypto.randomUUID();
    const results = await Promise.allSettled(reqs.map((r) => service.generate(r, { source: 'studio', batch, ...opts })));
    const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const bad = results.find((r) => r.status === 'rejected' && r.reason?.name !== 'AbortError');
    if (bad) { st.lastRun = () => launch(reqs, opts); showError(bad.reason.message, bad.reason.action || ''); }
    await reload();
    if (items.length) select(items[0].id);
    return items;
  }
  $('#st-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (st.kind === 'html') { await html.submit(); return; }
    const m = model();
    if (!m) return;
    const text = promptText().trim();
    if (!text) { showError('Escribe primero qué quieres generar.'); $('#st-prompt')?.focus(); return; }
    const prompts = expandPrompt(text);
    const f = form();
    const total = prompts.length * (st.kind === 'image' ? f.count : 1);
    if (total > 1 && service.billing(m) === 'paid' && !(await confirmDialog({ title: `GENERAR ${total} ${st.kind === 'video' ? 'VÍDEOS' : 'IMÁGENES'}`, command: `${m.id} cobra por cada resultado.\n\n${prompts.slice(0, 8).join('\n')}` }))) return;
    await launch(prompts.map(requestOf));
  });

  /* ---------------------------------------------------------------- escenario */
  const currentItem = () => st.items.find((i) => i.id === st.current) || null;
  function select(id) {
    st.current = id;
    st.editor = null;
    const item = currentItem();
    if (st.kind === 'html' && item) { html.leave(); st.kind = item.kind; store.set('media:kind', item.kind); renderControls(); }
    renderStage();
    renderGallery();
  }
  /** Misma tanda y misma familia de ediciones que el resultado abierto. */
  function lineage(item) {
    if (!item) return [];
    const byId = new Map(st.items.map((i) => [i.id, i]));
    const links = new Map(); // quién está unido a quién: padres, hijos y misma tanda
    const join = (a, b) => { links.set(a, [...(links.get(a) || []), b]); links.set(b, [...(links.get(b) || []), a]); };
    const batches = new Map();
    for (const i of st.items) {
      if (i.parent && byId.has(i.parent)) join(i.id, i.parent);
      if (i.batch) { if (batches.has(i.batch)) join(i.id, batches.get(i.batch)); else batches.set(i.batch, i.id); }
    }
    const ids = new Set([item.id]);
    for (const id of ids) for (const next of links.get(id) || []) ids.add(next); // un Set admite crecer mientras se recorre
    return st.items.filter((i) => ids.has(i.id)).reverse();
  }
  function renderStrip() {
    const jobs = service.jobs();
    const versions = lineage(currentItem());
    const strip = $('#st-strip');
    strip.hidden = !jobs.length && versions.length < 2;
    strip.innerHTML = jobs.map((j) => `<div class="st-job" data-job="${esc(j.id)}"><span class="st-job-t mono" data-started="${j.startedAt}">${clock(Date.now() - j.startedAt)}</span><span class="fine st-job-p">${esc(j.prompt)}</span><button type="button" class="st-thumb-x" data-cancel="${esc(j.id)}" aria-label="Cancelar">${icon('close')}</button></div>`).join('')
      + (versions.length > 1 ? versions.map((i) => `<button type="button" class="st-ver${i.id === st.current ? ' active' : ''}" data-open="${esc(i.id)}" aria-label="Abrir versión">${tile(i)}</button>`).join('') : '');
  }
  const thumbOf = (i) => { const k = `t:${i.id}`; if (!st.urls.has(k)) st.urls.set(k, URL.createObjectURL(i.thumb)); return st.urls.get(k); };
  const forget = (id) => { for (const k of [id, `t:${id}`]) if (st.urls.has(k)) { URL.revokeObjectURL(st.urls.get(k)); st.urls.delete(k); } };
  const tile = (i) => (i.thumb ? `<img src="${esc(thumbOf(i))}" alt="" loading="lazy">` : i.kind === 'video' ? `<video src="${esc(urlOf(i))}#t=0.1" muted preload="metadata" playsinline></video>` : `<img src="${esc(urlOf(i))}" alt="" loading="lazy">`);
  const bar = (b) => `<button class="btn ghost sm" type="button" data-act="${b[0]}"${b[3] ? ` title="${esc(b[3])}"` : ''}>${icon(b[1])}${b[2]}</button>`;

  function renderStage() {
    renderStrip();
    view.classList.toggle('editing', !!st.editor);
    if (st.kind === 'html') { html.stage(); return; }
    if (st.editor) return;
    const item = currentItem();
    const box = $('#st-view');
    const actions = $('#st-actions');
    if (!item) {
      actions.innerHTML = '';
      const jobs = service.jobs().length;
      box.innerHTML = `<div class="st-empty"><h2 class="st-h">${jobs ? 'Generando…' : st.kind === 'video' ? 'Tu vídeo aparecerá aquí' : 'Tu imagen aparecerá aquí'}</h2><p class="note">${jobs ? 'Puedes seguir trabajando: el resultado se guarda solo en este dispositivo.' : 'Escribe un prompt a la izquierda. Después podrás retocarla, recortarla, pedir cambios o animarla.'}</p></div>`;
      return;
    }
    const isVideo = item.kind === 'video';
    const canEdit = !isVideo && !!item.blob;
    actions.innerHTML = [
      canEdit && ['edit', 'brush', 'Editar'],
      canEdit && service.pick('image') && service.controls(service.pick('image')).refs > 0 && ['reference', 'plus', 'Referencia', 'Usarla como imagen de referencia'],
      canEdit && ['animate', 'film', 'Animar', 'Crear un vídeo a partir de esta imagen'],
      isVideo && item.blob && ['frame', 'image', 'Fotograma', 'Usar el fotograma actual como inicio de otro vídeo'],
      item.html && ['composition', 'brush', 'Editar HTML', 'Seguir trabajando la composición'],
      ['reuse', 'undo', 'Reutilizar', 'Volver a cargar su prompt y sus ajustes'],
    ].filter(Boolean).map(bar).join('') + `<span class="st-gap"></span>
      ${isVideo || !item.blob ? bar(['download', 'down', 'Descargar']) : `<details class="menu st-dl"><summary class="btn ghost sm">${icon('down')}Descargar</summary><div class="menu-list" role="menu">${['png', 'jpeg', 'webp'].map((x) => `<button type="button" role="menuitem" data-export="${x}">${x.toUpperCase()}</button>`).join('')}</div></details>`}
      <button class="icon-btn" type="button" data-act="delete" aria-label="Borrar">${icon('trash')}</button>`;
    const src = urlOf(item);
    const p = item.params || {};
    const meta = [item.model, p.ratio, p.resolution, p.duration ? `${p.duration} s` : '', p.seed ? `semilla ${p.seed}` : ''].filter(Boolean).join(' · ');
    box.innerHTML = `<figure class="st-figure">${isVideo ? `<video src="${esc(src)}" controls playsinline loop id="st-video"></video>` : `<img src="${esc(src)}" alt="${esc(item.prompt)}" id="st-img">`}
      <figcaption><p class="st-cap">${esc(item.prompt)}</p><p class="fine mono">${esc(meta)}</p>${item.blob ? '' : '<p class="fine">El proveedor no deja guardar este archivo desde la web: descárgalo pronto, su enlace caduca.</p>'}</figcaption></figure>`;
  }

  function renderGallery() {
    if (!rail) return;
    const all = st.items.filter((i) => st.filter === 'all' || i.kind === st.filter);
    const list = all.slice(0, st.shown || 60);
    rail.innerHTML = `<div class="st-gal-head">${seg('filter', ['all', 'image', 'video'], st.filter, (v) => ({ all: 'Todo', image: 'Imagen', video: 'Vídeo' }[v]))}</div>
      ${list.length ? `<div class="st-gal">${list.map((i) => `<button type="button" class="st-tile${i.id === st.current ? ' active' : ''}" data-open="${esc(i.id)}" title="${esc(i.prompt.slice(0, 120))}">${tile(i)}${i.kind === 'video' ? `<span class="st-badge">${icon('film')}</span>` : ''}</button>`).join('')}</div>${all.length > list.length ? `<button class="btn ghost sm" type="button" data-act="more">Ver ${Math.min(60, all.length - list.length)} más</button>` : ''}`
    : '<p class="note st-gal-none">Lo que generes se guarda aquí, solo en este dispositivo.</p>'}`;
  }
  async function reload() { st.items = await library.list(); if (st.current && !currentItem()) st.current = null; renderGallery(); if (st.kind !== 'html') renderStage(); }

  /* ---------------------------------------------------------------- editor */
  async function openEditor(item) {
    const base = await canvasFromBlob(item.blob);
    const paint = canvasOf(base.width, base.height);
    st.editor = { item, base, paint, undo: [], tab: 'retouch', adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 }, brush: Math.round(Math.max(base.width, base.height) / 18), cropRatio: 'free', crop: null, painted: false, busy: false };
    renderEditor();
  }
  const edit = () => st.editor;
  function drawEditor() {
    const e = edit();
    const c = $('#ed-canvas');
    if (!c) return;
    if (c.width !== e.base.width || c.height !== e.base.height) { c.width = e.base.width; c.height = e.base.height; $('#ed-over').width = c.width; $('#ed-over').height = c.height; }
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(e.base, 0, 0);
    if (e.tab === 'adjust' && Object.values(e.adjust).some(Boolean)) {
      const d = x.getImageData(0, 0, c.width, c.height);
      applyAdjust(d.data, e.adjust);
      x.putImageData(d, 0, 0);
    }
    const o = $('#ed-over').getContext('2d');
    o.clearRect(0, 0, c.width, c.height);
    if (e.tab === 'retouch') { o.globalAlpha = 0.55; o.drawImage(e.paint, 0, 0); o.globalAlpha = 1; }
    if (e.tab === 'crop' && e.crop) {
      o.fillStyle = 'rgba(0,0,0,.66)';
      o.fillRect(0, 0, c.width, c.height);
      o.clearRect(e.crop.x, e.crop.y, e.crop.width, e.crop.height);
      o.strokeStyle = '#f2f1ec';
      o.lineWidth = Math.max(2, c.width / 500);
      o.strokeRect(e.crop.x, e.crop.y, e.crop.width, e.crop.height);
    }
  }
  function renderEditor() {
    const e = edit();
    view.classList.add('editing');
    const m = service.pick('image');
    const c = m ? service.controls(m) : null;
    const canAi = !!c?.refs;
    $('#st-actions').innerHTML = `<div class="seg st-seg" role="tablist">${[['retouch', 'Retocar'], ['adjust', 'Ajustar'], ['crop', 'Recortar']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${e.tab === k}" class="${e.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <span class="st-gap"></span>
      <button class="icon-btn" type="button" data-ed="undo" aria-label="Deshacer" ${e.undo.length ? '' : 'disabled'}>${icon('undo')}</button>
      <button class="icon-btn" type="button" data-ed="rot" aria-label="Girar 90 grados">${icon('rotate')}</button>
      <button class="icon-btn" type="button" data-ed="flip" aria-label="Voltear">${icon('flip')}</button>
      <button class="btn ghost sm" type="button" data-ed="close">Cerrar</button>
      <button class="btn primary sm" type="button" data-ed="save">Guardar copia</button>`;
    const sliders = [['brightness', 'Brillo'], ['contrast', 'Contraste'], ['saturation', 'Saturación'], ['warmth', 'Temperatura']];
    const tools = {
      retouch: canAi ? `${c.mask ? `<label class="st-brush"><span class="fine">Pincel</span><input type="range" min="8" max="${Math.round(Math.max(e.base.width, e.base.height) / 4)}" value="${e.brush}" data-brush aria-label="Tamaño del pincel"></label><button class="btn quiet sm" type="button" data-ed="clear-mask">Limpiar</button>` : '<p class="fine st-note">Este modelo cambia la imagen entera según tu instrucción.</p>'}
          <input id="ed-prompt" class="grow" type="text" placeholder="${c.mask ? 'Qué poner en la zona pintada' : 'Qué cambiar en la imagen'}" aria-label="Instrucción de edición"><button class="btn sm" type="button" data-ed="ai" ${e.busy ? 'disabled' : ''}>${e.busy ? 'Editando…' : 'Aplicar'}</button>`
        : '<p class="fine st-note">El modelo elegido no acepta imágenes de entrada. Elige otro a la izquierda para retocar con IA.</p>',
      adjust: `${sliders.map(([k, l]) => `<label class="st-slider"><span class="fine">${l}</span><input type="range" min="-100" max="100" value="${e.adjust[k]}" data-adjust="${k}"></label>`).join('')}<button class="btn quiet sm" type="button" data-ed="reset">Restablecer</button>`,
      crop: `${seg('crop', ['free', '1:1', '16:9', '9:16', '4:3', '3:4'], e.cropRatio, (v) => (v === 'free' ? 'Libre' : v))}<p class="fine st-note">Arrastra sobre la imagen.</p><button class="btn sm" type="button" data-ed="crop" ${e.crop ? '' : 'disabled'}>Recortar</button>`,
    };
    $('#st-view').innerHTML = `<div class="ed"><div class="ed-fit"><div class="ed-frame" style="--r:${e.base.width / e.base.height}"><canvas id="ed-canvas"></canvas><canvas id="ed-over" class="${e.tab === 'adjust' ? '' : 'draw'}"></canvas></div></div><div class="ed-tools">${tools[e.tab]}</div></div>`;
    drawEditor();
  }
  function pushUndo() { const e = edit(); e.undo.push(e.base); if (e.undo.length > 12) e.undo.shift(); }
  /** Lo ajustado con los deslizadores pasa a formar parte de la imagen antes de otra operación. */
  function bakeAdjust() {
    const e = edit();
    if (!Object.values(e.adjust).some(Boolean)) return;
    pushUndo();
    e.base = adjusted(e.base, e.adjust);
    e.adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  }
  function resetPaint() { const e = edit(); e.paint = canvasOf(e.base.width, e.base.height); e.painted = false; e.crop = null; }
  async function saveEdit(blob, extra = {}) {
    const e = edit();
    const thumb = await makeThumb(blob, 'image').catch(() => null);
    const it = await library.put({ ...e.item, id: crypto.randomUUID(), createdAt: Date.now(), blob, thumb, mime: blob.type, remoteUrl: '', parent: e.item.id, source: 'edit', batch: null, ...extra });
    service.changed();
    st.editor = null;
    st.current = it.id;
    await reload();
    return it;
  }
  async function aiEdit() {
    const e = edit();
    const text = $('#ed-prompt')?.value.trim();
    if (!text) { $('#ed-prompt')?.focus(); toast('ESCRIBE QUÉ CAMBIAR'); return; }
    const m = service.pick('image');
    const c = service.controls(m);
    bakeAdjust();
    e.busy = true;
    renderEditor();
    try {
      const png = await canvasBlob(e.base);
      const req = { kind: 'image', modelKey: m.key, prompt: text, ratio: undefined, count: 1, refs: [await referenceDataUrl(png)] };
      if (c.mask && e.painted) req.mask = maskFrom(e.paint).toDataURL('image/png');
      const items = await service.generate(req, { source: 'edit', parent: e.item.id });
      st.editor = null;
      await reload();
      if (items[0]) select(items[0].id);
    } catch (err) {
      e.busy = false;
      if (st.editor) renderEditor();
      if (err.name !== 'AbortError') showError(err.message);
    }
  }
  // pintar la máscara o dibujar el recorte
  const pointFrom = (ev, c) => { const r = c.getBoundingClientRect(); return { x: ((ev.clientX - r.left) / r.width) * c.width, y: ((ev.clientY - r.top) / r.height) * c.height }; };
  let drag = null;
  view.addEventListener('pointerdown', (ev) => {
    const c = ev.target.closest('#ed-over');
    const e = edit();
    if (!c || !e || e.tab === 'adjust') return;
    if (e.tab === 'retouch' && !service.controls(service.pick('image') || {}).mask) return;
    c.setPointerCapture(ev.pointerId);
    drag = { from: pointFrom(ev, c), last: pointFrom(ev, c) };
    ev.preventDefault();
    if (e.tab === 'retouch') stroke(drag.last, drag.last);
  });
  view.addEventListener('pointermove', (ev) => {
    const e = edit();
    if (!drag || !e) return;
    const p = pointFrom(ev, $('#ed-over'));
    if (e.tab === 'retouch') stroke(drag.last, p);
    else { e.crop = cropRect(drag.from, p, e.base.width, e.base.height, e.cropRatio); drawEditor(); }
    drag.last = p;
  });
  const endDrag = () => { const e = edit(); if (drag && e?.tab === 'crop') { const b = $('[data-ed="crop"]'); if (b) b.disabled = !(e.crop?.width > 4 && e.crop?.height > 4); } drag = null; };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  function stroke(a, b) {
    const e = edit();
    const x = e.paint.getContext('2d');
    x.strokeStyle = '#f2f1ec';
    x.lineCap = 'round';
    x.lineWidth = e.brush;
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x + 0.01, b.y); x.stroke();
    e.painted = true;
    drawEditor();
  }

  /* ---------------------------------------------------------------- entradas */
  async function addFiles(slot, files) {
    const m = model();
    const max = slot === 'refs' ? service.controls(m).refs : 1;
    for (const file of [...files].slice(0, max)) {
      if (!file.type.startsWith('image/')) { toast('SOLO IMÁGENES PNG, JPG O WEBP'); continue; }
      const x = { url: await referenceDataUrl(file).catch(() => null), name: file.name };
      if (!x.url) { toast('NO SE PUDO LEER LA IMAGEN'); continue; }
      if (slot === 'refs') st.refs = [...st.refs, x].slice(0, max); else st[slot] = x;
    }
    renderControls();
  }
  function reuse(item) {
    const k = item.kind;
    const p = item.params || {};
    st.kind = k;
    store.set('media:kind', k);
    st.forms[k] = { ...st.forms[k], tab: 'free', prompt: item.prompt, negative: item.negative || '', ...Object.fromEntries(['ratio', 'resolution', 'duration', 'seed', 'steps', 'guidance', 'quality', 'audio', 'background'].filter((x) => p[x] !== undefined).map((x) => [x, p[x]])) };
    if (item.modelKey && service.catalog(k).some((m) => m.key === item.modelKey)) service.choose(k, item.modelKey);
    saveDraft();
    renderControls();
    $('#st-prompt')?.focus();
  }
  async function useAs(item, slot, kind) {
    const url = await referenceDataUrl(item.blob);
    if (kind && kind !== st.kind) { st.kind = kind; store.set('media:kind', kind); }
    const x = { url, name: item.prompt.slice(0, 40) };
    if (slot === 'refs') st.refs = [...st.refs, x]; else st[slot] = x;
    renderControls();
    toast(slot === 'start' ? 'LISTA COMO PRIMER FOTOGRAMA' : 'AÑADIDA COMO REFERENCIA');
  }
  async function exportAs(item, fmt) {
    const type = `image/${fmt}`;
    const blob = item.mime === type ? item.blob : await canvasBlob(await flat(item.blob, fmt), type);
    downloadBlob(blob, `${slugOf(item.prompt)}.${extOf(type)}`);
  }
  async function flat(blob, fmt) {
    const src = await canvasFromBlob(blob);
    if (fmt !== 'jpeg') return src;
    const c = canvasOf(src.width, src.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
    return c;
  }

  const actions = {
    settings: () => deps.openSettings(),
    more: () => { st.shown = (st.shown || 60) + 60; renderGallery(); },
    'manual-add': () => {
      const id = $('#st-manual-id').value.trim();
      if (!id) { $('#st-manual-id').focus(); return; }
      service.choose(st.kind, service.addCustom($('#st-manual-ep').value, id, st.kind));
      st.manual = false;
      renderControls();
    },
    seed: () => { form().seed = Math.floor(Math.random() * 2147483647); saveDraft(); renderControls(); },
    'undo-prompt': () => { form().prompt = st.undoPrompt; form().tab = 'free'; st.undoPrompt = null; saveDraft(); renderControls(); },
    improve: async () => {
      const text = promptText().trim();
      if (!text) { showError('Escribe primero una idea para mejorarla.'); return; }
      st.improving = new AbortController();
      renderControls();
      try {
        const out = await deps.chatText(improveInstruction(st.kind), text, st.improving.signal);
        if (out?.trim()) { st.undoPrompt = form().prompt || text; form().prompt = out.trim().replace(/^["«]|["»]$/g, ''); form().tab = 'free'; saveDraft(); }
      } catch (e) { if (e.name !== 'AbortError') showError(`No se pudo mejorar: ${e.message}`); } finally { st.improving = null; renderControls(); }
    },
    edit: () => { const i = currentItem(); if (i) openEditor(i); },
    reference: () => { const i = currentItem(); if (i) useAs(i, 'refs', 'image'); },
    animate: () => { const i = currentItem(); if (i) useAs(i, 'start', 'video'); },
    reuse: () => { const i = currentItem(); if (i) reuse(i); },
    composition: () => { const i = currentItem(); if (!i?.html) return; html.load(i); st.kind = 'html'; store.set('media:kind', 'html'); renderControls(); renderStage(); },
    frame: async () => {
      const v = $('#st-video');
      if (!v?.videoWidth) return;
      const c = canvasOf(v.videoWidth, v.videoHeight);
      c.getContext('2d').drawImage(v, 0, 0);
      st.start = { url: c.toDataURL('image/jpeg', 0.92), name: 'fotograma' };
      renderControls();
      toast('FOTOGRAMA LISTO PARA OTRO VÍDEO');
    },
    download: () => {
      const i = currentItem();
      if (!i) return;
      if (i.blob) downloadBlob(i.blob, `${slugOf(i.prompt)}.${extOf(i.mime)}`); else window.open(i.remoteUrl, '_blank', 'noopener');
    },
    delete: async () => {
      const i = currentItem();
      if (!i || !(await confirmDialog({ title: 'BORRAR DE LA GALERÍA', command: 'Se borrará de este dispositivo y no se puede recuperar.' }))) return;
      await library.remove(i.id);
      forget(i.id);
      st.current = null;
      await reload();
    },
  };
  const editorActions = {
    close: () => { st.editor = null; renderStage(); },
    undo: () => { const e = edit(); if (e.undo.length) { e.base = e.undo.pop(); resetPaint(); renderEditor(); } },
    rot: () => { bakeAdjust(); pushUndo(); const e = edit(); e.base = rotated(e.base); resetPaint(); renderEditor(); },
    flip: () => { bakeAdjust(); pushUndo(); const e = edit(); e.base = flipped(e.base); resetPaint(); renderEditor(); },
    'clear-mask': () => { resetPaint(); drawEditor(); },
    reset: () => { edit().adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 }; renderEditor(); },
    crop: () => { const e = edit(); if (!e.crop) return; bakeAdjust(); pushUndo(); e.base = cropped(e.base, e.crop); resetPaint(); renderEditor(); },
    ai: aiEdit,
    save: async () => { bakeAdjust(); await saveEdit(await canvasBlob(edit().base)); toast('COPIA GUARDADA EN LA GALERÍA'); },
  };

  /* ---------------------------------------------------------------- eventos */
  async function onClick(e) {
    const t = e.target;
    const fix = t.closest('#st-fix');
    if (fix) { if (fix.dataset.fix === 'settings') deps.openSettings(); else st.lastRun?.(); return; }
    if (st.kind === 'html' && html.onClick(t)) return;
    const open = t.closest('[data-open]');
    if (open) { select(open.dataset.open); document.querySelector('#rail')?.classList.remove('open'); return; }
    const cancel = t.closest('[data-cancel]');
    if (cancel) { service.cancel(cancel.dataset.cancel); return; }
    const pick = t.closest('[data-pick]');
    if (pick) {
      const { pick: name, value } = pick.dataset;
      if (name === 'filter') { st.filter = value; renderGallery(); return; }
      if (name === 'crop') { edit().cropRatio = value; edit().crop = null; renderEditor(); return; }
      form()[name] = name === 'count' ? Number(value) : value;
      saveDraft();
      renderControls();
      return;
    }
    const kind = t.closest('[data-kind]');
    if (kind) { if (st.kind === 'html') html.leave(); st.kind = kind.dataset.kind; st.editor = null; store.set('media:kind', st.kind); showError(''); renderControls(); renderStage(); return; }
    const preset = t.closest('[data-preset]');
    if (preset) {
      const f = form();
      const p = preset.dataset.preset;
      if (f.tab === 'guide') f.guide.style = String(f.guide.style || '').toLowerCase().includes(p) ? f.guide.style.replace(new RegExp(`,?\\s*${p}`, 'i'), '').trim() : [f.guide.style, p].filter(Boolean).join(', ');
      else f.prompt = f.prompt.toLowerCase().includes(p) ? f.prompt.replace(new RegExp(`[,.]?\\s*${p}`, 'i'), '').trim() : [f.prompt.trim().replace(/[.,]$/, ''), p].filter(Boolean).join(', ');
      saveDraft();
      renderControls();
      return;
    }
    const drop = t.closest('[data-drop]');
    if (drop) { if (drop.dataset.drop === 'refs') st.refs.splice(Number(drop.dataset.i), 1); else st[drop.dataset.drop] = null; renderControls(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { if (edit().tab === 'adjust' && tab.dataset.tab !== 'adjust') bakeAdjust(); edit().tab = tab.dataset.tab; renderEditor(); return; }
    const ed = t.closest('[data-ed]');
    if (ed) { await editorActions[ed.dataset.ed]?.(); return; }
    const exp = t.closest('[data-export]');
    if (exp) { t.closest('details').open = false; const i = currentItem(); if (i) exportAs(i, exp.dataset.export); return; }
    const act = t.closest('[data-act]');
    if (act) await actions[act.dataset.act]?.();
  }
  view.addEventListener('click', onClick);
  rail?.addEventListener('click', onClick);
  view.addEventListener('input', (e) => {
    const t = e.target;
    if (st.kind === 'html' && html.onInput(t)) return;
    const f = form();
    if (t.dataset.f) { f[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; saveDraft(); summary(); }
    if (t.dataset.guide) { f.guide[t.dataset.guide] = t.value; saveDraft(); summary(); }
    if (t.dataset.brush) edit().brush = Number(t.value);
    if (t.dataset.adjust) { edit().adjust[t.dataset.adjust] = Number(t.value); requestAnimationFrame(drawEditor); }
  });
  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'st-model') {
      st.manual = t.value === '__manual';
      if (!st.manual) service.choose(st.kind, t.value);
      renderControls();
    }
    if (t.dataset.file) { addFiles(t.dataset.file, t.files); t.value = ''; }
  });
  view.addEventListener('toggle', (e) => { if (e.target.classList?.contains('st-adv')) store.set('media:adv', e.target.open); }, true);
  // soltar o pegar imágenes en el panel: van a referencias o al primer fotograma
  const inputSlot = () => { const m = model(); if (!m) return null; const c = service.controls(m); return c.refs ? 'refs' : c.start ? 'start' : null; };
  view.addEventListener('dragover', (e) => { if (inputSlot() && !st.editor) e.preventDefault(); });
  view.addEventListener('drop', (e) => { const s = inputSlot(); if (s && e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(s, e.dataTransfer.files); } });
  view.addEventListener('paste', (e) => { const s = inputSlot(); const files = [...(e.clipboardData?.files || [])]; if (s && files.length) { e.preventDefault(); addFiles(s, files); } });

  // reloj de los trabajos en curso
  let ticking = 0; // el reloj solo corre mientras hay algo en marcha
  const tick = () => { for (const el of view.querySelectorAll('[data-started]')) el.textContent = clock(Date.now() - Number(el.dataset.started)); };
  service.subscribe((what) => {
    if (what === 'catalog') renderControls();
    if (what === 'jobs') {
      renderStrip();
      if (service.jobs().length && !ticking) ticking = setInterval(tick, 1000);
      if (!service.jobs().length && ticking) { clearInterval(ticking); ticking = 0; }
    }
    if (what === 'library') reload();
  });

  return {
    async show() { renderControls(); await reload(); if (st.kind === 'html') renderStage(); },
    async open(id) { await reload(); st.current = id; const i = currentItem(); if (i && i.kind !== st.kind) { st.kind = i.kind; store.set('media:kind', i.kind); renderControls(); } select(id); },
    async animate(id) { const i = await library.get(id); if (i?.blob) await useAs(i, 'start', 'video'); },
    refresh: renderControls,
  };
}
