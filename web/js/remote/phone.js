// Control remoto, lado móvil (web y apps de Android/iOS): maneja el agente de JeanCode en tu PC.
// Emparejar: escanea el QR del PC (con la cámara del sistema, que abre la web con #pair=…, o desde aquí si el
// navegador sabe leer QR) o pega el enlace. Después conecta solo: Wi-Fi directa → internet (P2P) → relay.
import { decodePairing } from './crypto.js';
import { phoneConnect } from './link.js';

const KIND = { lan: 'WI-FI DIRECTA', p2p: 'P2P', relay: 'RELAY (WORKER)' };

/** deps: { $, esc, store, toast, renderMarkdown, platform } */
export function initRemotePhone({ $, esc, store, toast, renderMarkdown, platform = 'web' }) {
  const view = $('#view-remote');
  if (!view) return null;
  let link = null;
  let st = {};                      // estado del PC
  let threads = [];
  let current = null;               // conversación abierta: { id, title, messages }
  let live = null;                  // respuesta en curso: { el, text }
  const confirms = new Map();       // id → elemento
  let connecting = false;

  const pcs = () => store.get('remotePCs', []);
  const savePCs = (list) => store.set('remotePCs', list);

  /* ---------------- conexión ---------------- */
  function status(text, kind = '') {
    $('#rm-status').textContent = text;
    $('#rm-status').dataset.kind = kind;
  }
  async function connect(pc = pcs()[0]) {
    if (!pc || connecting) return;
    connecting = true;
    disconnect(false);
    try {
      link = await phoneConnect({ secret: pc.secret, lan: pc.lan, worker: pc.worker, wkey: pc.wkey }, {
        hello: { name: deviceName(), platform }, onStatus: (t) => status(t),
      });
      link.on('message', onMessage).on('close', () => { link = null; status('Desconectado', 'off'); render(); })
        .on('kind', (k) => status(`Conectado a ${pc.hostName} · ${KIND[k] || k}`, 'on'));
      status(`Conectado a ${pc.hostName} · ${KIND[link.kind] || link.kind}`, 'on');
      await link.send({ type: 'threads' });
    } catch (e) {
      status(String(e.message || e), 'off');
    } finally { connecting = false; render(); }
  }
  function disconnect(redraw = true) { if (link) { const l = link; link = null; l.close(); } if (redraw) { status('Desconectado', 'off'); render(); } }

  async function pair(text) {
    let p;
    try { p = decodePairing(text); } catch (e) { toast(String(e.message).toUpperCase()); return; }
    status(`Emparejando con ${p.name || 'tu PC'}… acepta en el PC`);
    let l;
    try {
      l = await phoneConnect({ secret: p.secret, lan: p.lan, worker: p.worker, wkey: p.wkey }, { hello: { name: deviceName(), platform }, p2p: false, onStatus: (t) => status(t) });
    } catch (e) { status(String(e.message || e), 'off'); return; }
    const answer = new Promise((resolve) => {
      l.on('message', resolve);
      l.on('close', () => resolve({ type: 'error', message: 'el PC cerró la conexión' }));
      setTimeout(() => resolve({ type: 'error', message: 'nadie aceptó el emparejamiento en el PC a tiempo' }), 120000);
    });
    await l.send({ type: 'pair', name: deviceName(), platform });
    const r = await answer;
    l.close();
    if (r.type !== 'paired') { status(r.message || 'No se pudo emparejar', 'off'); return; }
    const pc = { hostId: r.host.id, hostName: r.host.name || p.name || 'PC', deviceId: r.device.id, secret: r.device.secret, lan: p.lan, worker: p.worker, wkey: p.wkey, paired: Date.now() };
    savePCs([pc, ...pcs().filter((x) => x.hostId !== pc.hostId)]);
    toast(`EMPAREJADO CON ${pc.hostName.toUpperCase()}`);
    if (location.hash.includes('pair=')) history.replaceState(null, '', location.pathname + location.search); // el código no se queda en el historial
    await connect(pc);
  }

  const deviceName = () => store.get('remoteName', '') || (/(android)/i.test(navigator.userAgent) ? 'Android' : /(iphone|ipad)/i.test(navigator.userAgent) ? 'iPhone' : 'Navegador');

  /* ---------------- mensajes del PC ---------------- */
  function onMessage(m) {
    switch (m.type) {
      case 'state': st = m; renderState(); break;
      case 'threads': threads = m.list || []; renderThreads(); if (!current && st.thread) open(st.thread); break;
      case 'thread': current = { id: m.id, title: m.title, messages: m.messages || [] }; live = null; renderThread(); break;
      case 'event': onEvent(m.ev || {}); break;
      case 'confirm': showConfirm(m); break;
      case 'confirm-done': confirms.get(m.id)?.remove(); confirms.delete(m.id); break;
      case 'error': toast(String(m.message || 'error').toUpperCase().slice(0, 140)); break;
      default: break;
    }
  }
  function onEvent(ev) {
    if (ev.kind === 'threads') { link?.send({ type: 'threads' }); return; }
    if (!current || ev.thread !== current.id) { if (ev.kind === 'user' || ev.kind === 'turn-end') link?.send({ type: 'threads' }); return; }
    const box = $('#rm-stream');
    if (ev.kind === 'user') addRow('user', ev.text);
    if (ev.kind === 'assistant-start') live = { el: addRow('assistant', ''), text: '' };
    if (ev.kind === 'delta' || ev.kind === 'assistant-end') {
      if (!live) live = { el: addRow('assistant', ''), text: '' };
      live.text = ev.text || '';
      $('.rm-body', live.el).innerHTML = renderMarkdown(live.text);
      if (ev.kind === 'assistant-end') { if (!live.text.trim()) live.el.remove(); live = null; }
    }
    if (ev.kind === 'tool') {
      const row = box.querySelector(`[data-call="${CSS.escape(ev.id || '')}"]`) || addRow('tool', '');
      row.dataset.call = ev.id || '';
      row.classList.toggle('bad', ev.status === 'error');
      $('.rm-body', row).textContent = `${ev.status === 'start' ? '…' : ev.status === 'error' ? '✕' : '✓'} ${ev.label || ev.tool}`;
    }
    if (ev.kind === 'system') addRow('system', ev.text);
    if (ev.kind === 'todos') {
      $('#rm-todos').hidden = !ev.todos?.length;
      $('#rm-todos').innerHTML = (ev.todos || []).map((t) => `<li class="todo ${esc(t.status)}">${t.status === 'done' ? '■' : t.status === 'in_progress' ? '▶' : '□'} ${esc(t.content)}</li>`).join('');
    }
    box.scrollTop = box.scrollHeight;
  }

  function addRow(role, text) {
    const row = document.createElement('div');
    row.className = `rm-row rm-${role}`;
    row.innerHTML = `<div class="rm-who">${{ user: 'TÚ', assistant: 'JEAN', tool: '', system: '' }[role] ?? ''}</div><div class="rm-body"></div>`;
    $('.rm-body', row)[role === 'assistant' || role === 'user' ? 'innerHTML' : 'textContent'] = role === 'assistant' || role === 'user' ? renderMarkdown(text || '') : text || '';
    $('#rm-stream').appendChild(row);
    return row;
  }

  function showConfirm(c) {
    if (confirms.has(c.id)) return;
    const el = document.createElement('div');
    el.className = 'rm-confirm';
    const body = c.command != null ? `<pre class="cmd">${esc(c.command)}</pre>`
      : `<p class="mono">${esc(c.path || '')}</p><pre class="cmd">${esc(String(c.after ?? '').slice(0, 4000))}</pre>`;
    el.innerHTML = `<h4>${esc(c.title)}</h4>${c.where ? `<p class="fine mono">${esc(c.where)}</p>` : ''}${body}
      <div class="row gap wrap end"><button class="btn ghost" data-ans="no">Rechazar</button>${c.allowAlways ? '<button class="btn" data-ans="always">Siempre aquí</button>' : ''}<button class="btn primary" data-ans="yes">Permitir</button></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ans]');
      if (!b) return;
      link?.send({ type: 'answer', id: c.id, value: b.dataset.ans === 'yes' ? true : b.dataset.ans === 'always' ? 'always' : false });
      el.remove(); confirms.delete(c.id);
    });
    confirms.set(c.id, el);
    $('#rm-confirms').appendChild(el);
    try { navigator.vibrate?.(200); } catch { /* */ }
  }

  /* ---------------- interfaz ---------------- */
  function open(id) { link?.send({ type: 'open', id }); }
  function renderState() {
    $('#rm-busy').hidden = !st.busy;
    $('#rm-stop').hidden = !st.busy;
    $('#rm-send').disabled = !!st.busy;
    $('#rm-folder').textContent = st.workspace || 'sin carpeta';
    $('#rm-perm').value = st.perm || 'ask';
    $('#rm-agent').value = st.agent || 'build';
    $('#rm-model').textContent = st.model || '';
  }
  function renderThreads() {
    $('#rm-threads').innerHTML = threads.map((t) => `<option value="${esc(t.id)}" ${current?.id === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('') || '<option value="">(sin conversaciones)</option>';
  }
  function renderThread() {
    const box = $('#rm-stream');
    box.innerHTML = '';
    for (const m of current?.messages || []) addRow(m.role, m.content);
    box.scrollTop = box.scrollHeight;
    renderThreads();
  }
  function render() {
    const has = pcs().length > 0;
    $('#rm-pair').hidden = has && !!link;
    $('#rm-main').hidden = !link;
    $('#rm-connect').hidden = !has || !!link;
    $('#rm-disconnect').hidden = !link;
    $('#rm-pcs').innerHTML = pcs().map((p) => `<li><span class="ep-prov">${esc(p.hostName)}</span><span class="ep-url apps-desc">${esc([p.lan?.length ? 'Wi-Fi' : '', p.worker ? 'internet' : ''].filter(Boolean).join(' + ') || '—')}</span>
      <button class="btn ghost sm" type="button" data-pc-connect="${esc(p.hostId)}">Conectar</button><button class="btn ghost sm" type="button" data-pc-forget="${esc(p.hostId)}">Olvidar</button></li>`).join('') || '<li class="fine">Ningún PC emparejado todavía.</li>';
  }

  $('#rm-pair-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#rm-code').value.trim(); if (v) pair(v); });
  $('#rm-scan').addEventListener('click', scanQr);
  $('#rm-connect').addEventListener('click', () => connect());
  $('#rm-disconnect').addEventListener('click', () => disconnect());
  $('#rm-pcs').addEventListener('click', (e) => {
    const c = e.target.closest('[data-pc-connect]');
    const f = e.target.closest('[data-pc-forget]');
    if (c) connect(pcs().find((p) => p.hostId === c.dataset.pcConnect));
    if (f) { savePCs(pcs().filter((p) => p.hostId !== f.dataset.pcForget)); disconnect(); }
  });
  $('#rm-threads').addEventListener('change', (e) => { if (e.target.value) open(e.target.value); });
  $('#rm-new').addEventListener('click', () => { current = null; $('#rm-stream').innerHTML = ''; link?.send({ type: 'new' }); });
  $('#rm-stop').addEventListener('click', () => link?.send({ type: 'stop' }));
  $('#rm-perm').addEventListener('change', (e) => link?.send({ type: 'perm', value: e.target.value }));
  $('#rm-agent').addEventListener('change', (e) => link?.send({ type: 'agent', value: e.target.value }));
  $('#rm-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#rm-input').value.trim();
    if (!text || !link) return;
    link.send({ type: 'send', text, thread: current?.id || null });
    $('#rm-input').value = '';
  });

  /** QR con la cámara (si el navegador trae BarcodeDetector); si no, se explica cómo hacerlo con la cámara del sistema. */
  async function scanQr() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      toast('ESTE NAVEGADOR NO LEE QR: ESCANÉALO CON LA CÁMARA DEL MÓVIL O PEGA EL ENLACE');
      return;
    }
    const video = $('#rm-video');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { toast('SIN PERMISO PARA LA CÁMARA'); return; }
    video.hidden = false;
    video.srcObject = stream;
    await video.play().catch(() => {});
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const until = Date.now() + 60000;
    const stopCam = () => { stream.getTracks().forEach((t) => t.stop()); video.hidden = true; };
    while (Date.now() < until && !video.hidden) {
      try {
        const [code] = await det.detect(video);
        if (code?.rawValue?.includes('pair=')) { stopCam(); pair(code.rawValue); return; }
      } catch { /* sigue */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    stopCam();
  }

  // ¿se abrió con un enlace de emparejamiento (QR escaneado con la cámara del sistema)?
  const fromLink = location.hash.match(/pair=[\w-]+/) ? location.hash : '';
  render();
  return {
    view, fromLink,
    autoconnect: () => { if (fromLink) pair(fromLink); else if (pcs().length && !link) connect(); },
    connected: () => !!link,
  };
}
