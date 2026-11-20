// Tareas programadas con el mismo modelo que las de Claude (escritorio y rutinas):
//   - frecuencia: expresión cron (con atajos: cada hora, cada día, días laborables, cada semana, personalizada),
//     una sola vez a una fecha y hora, o manual (solo «Ejecutar ahora»)
//   - carpeta, modelo, modo de permisos, conversación nueva en cada ejecución o siempre la misma, notificación
//   - historial de ejecuciones, editar, pausar, ejecutar ahora con instrucciones extra
//   - el propio agente puede crearlas, listarlas, cambiarlas y borrarlas (herramienta schedule_task, con tu permiso)
// Corren mientras JeanCode está abierto; una ejecución que se perdió con la app cerrada se hace UNA vez al abrirla.
// Son DESATENDIDAS: nadie puede aprobar nada, así que lo que pediría permiso se deniega y se cuenta en el resultado.
import { nextCron, cronError, describeCron, presetCron, parseCron } from './cron.js';

export const MAX_RUNS = 20;          // historial guardado por tarea
export const MAX_AGENT_TASKS = 20;   // tareas activas que puede haber creado el agente
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Próxima ejecución (ms) de una tarea, o null (manual, una vez ya pasada, o cron sin más fechas). */
export function nextRunOf(task, from = Date.now()) {
  const s = task.schedule || {};
  if (s.type === 'cron') { try { return nextCron(s.cron, from); } catch { return null; } }
  if (s.type === 'once') return s.at > from || !task.runs?.length ? s.at : null;
  return null;
}

export function describeTaskSchedule(s = {}) {
  if (s.type === 'manual') return 'Manual';
  if (s.type === 'once') return `Una vez, ${fmtWhen(s.at)}`;
  if (s.type === 'cron') return describeCron(s.cron);
  return '—';
}

/** Comprueba y completa una tarea (la de la interfaz o la del agente). Lanza un error legible. */
export function validateTask(input, now = Date.now()) {
  const t = { ...input };
  t.name = String(t.name || '').trim().slice(0, 60) || 'Tarea';
  t.prompt = String(t.prompt || '').trim();
  if (!t.prompt) throw new Error('escribe qué debe hacer');
  t.folder = String(t.folder || '').trim();
  if (!t.folder) throw new Error('elige la carpeta de trabajo');
  const s = t.schedule || { type: 'manual' };
  if (s.type === 'cron') { const e = cronError(s.cron); if (e) throw new Error(`cron: ${e}`); t.schedule = { type: 'cron', cron: String(s.cron).trim() }; }
  else if (s.type === 'once') {
    const at = typeof s.at === 'number' ? s.at : Date.parse(s.at);
    if (!Number.isFinite(at)) throw new Error('fecha y hora no válidas');
    if (at <= now && !t.runs?.length) throw new Error('la fecha ya pasó');
    t.schedule = { type: 'once', at };
  } else t.schedule = { type: 'manual' };
  t.perm = t.perm === 'edit' ? 'edit' : 'read';
  t.target = t.target === 'same' ? 'same' : 'new';
  t.notify = t.notify !== false;
  t.model = String(t.model || '');
  t.enabled = t.enabled !== false;
  t.runs = Array.isArray(t.runs) ? t.runs.slice(-MAX_RUNS) : [];
  t.createdAt ||= now;
  t.id ||= (globalThis.crypto?.randomUUID?.() || `t-${now}-${Math.random().toString(36).slice(2)}`);
  t.next = t.enabled ? nextRunOf(t, now) : null;
  return t;
}

/** Tareas de la versión anterior (schedule.kind) → modelo nuevo (cron). */
export function migrateTask(t) {
  if (!t || t.schedule?.type) return t;
  const s = t.schedule || {};
  const [h, m] = String(s.time || '09:00').split(':').map(Number);
  let cron;
  if (s.kind === 'every') {
    const min = Math.max(5, Number(s.minutes) || 60);
    const at = new Date(t.next || Date.now()).getMinutes();
    cron = min < 60 ? `*/${min} * * * *` : min === 60 ? `${at} * * * *` : `${at} */${Math.round(min / 60)} * * *`;
  } else if (s.kind === 'daily') cron = `${m} ${h} * * *`;
  else if (s.kind === 'weekdays') cron = `${m} ${h} * * 1-5`;
  else cron = `${m} ${h} * * 1`;
  const runs = t.lastRun ? [{ id: 'migrada', start: t.lastRun, end: t.lastRun, status: t.lastOk === false ? 'error' : 'ok', summary: '', thread: t.lastThread || null, trigger: 'schedule' }] : [];
  const { lastRun, lastOk, lastThread, ...rest } = t;
  return { ...rest, schedule: { type: 'cron', cron }, target: 'new', notify: true, model: '', runs, createdAt: t.createdAt || Date.now() };
}

/** Tareas que tocan ahora (incluidas las que se perdieron con la app cerrada: una vez). */
export const dueTasks = (tasks, now = Date.now()) => tasks.filter((t) => t.enabled !== false && t.next && t.next <= now);

/** Tras una ejecución: historial (máx. MAX_RUNS) y próxima fecha. Una tarea "una vez" queda en pausa. */
export function recordRun(task, run, now = Date.now()) {
  const runs = [...(task.runs || []), run].slice(-MAX_RUNS);
  const done = task.schedule?.type === 'once' && run.trigger === 'schedule';
  const t = { ...task, runs, enabled: done ? false : task.enabled, ...(done ? { endedReason: 'una sola vez: ya se ejecutó' } : {}) };
  // la próxima se calcula desde AHORA: una que se perdió con la app cerrada no se repite varias veces
  t.next = t.enabled ? nextRunOf(t, now) : null;
  return t;
}

/** Intervalo de /loop: "10m", "2h", "90s", "1d" (mín. 1 min, máx. 24 h). */
export function parseInterval(s) {
  const m = String(s || '').trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return null;
  const ms = Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  return Math.min(Math.max(ms, 60000), 86400000);
}

export const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDur = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
const STATUS = { ok: 'correcta', error: 'falló', denied: 'con permisos pendientes', cancelled: 'cancelada', running: 'en curso' };

/** Lo que el agente ve de una tarea (schedule_task list). */
export function taskSummary(t) {
  const last = t.runs?.at(-1);
  return `- ${t.id} · ${t.name} · ${describeTaskSchedule(t.schedule)}${t.schedule?.type === 'cron' ? ` (${t.schedule.cron})` : ''} · ${t.enabled ? `próxima: ${t.next ? fmtWhen(t.next) : 'manual'}` : (t.endedReason || 'en pausa')}`
    + ` · ${t.perm === 'edit' ? 'puede editar' : 'solo lectura'} · ${t.target === 'same' ? 'misma conversación' : 'conversación nueva'} · carpeta ${t.folder}`
    + `${last ? ` · última: ${fmtWhen(last.start)} ${STATUS[last.status] || last.status}` : ''}\n  ${t.prompt.replace(/\s+/g, ' ').slice(0, 200)}`;
}
export const runSummary = (r) => `- ${fmtWhen(r.start)} · ${STATUS[r.status] || r.status} · ${fmtDur((r.end || r.start) - r.start)} · ${r.trigger}${r.extra ? ` · extra: ${r.extra}` : ''}\n  ${r.summary || ''}`;

/**
 * Panel de Automatizaciones + planificador. deps: { $, esc, toast, store, desktop, confirmDialog, models() => [{ key, label }],
 *   run(task, { extra, trigger }) => Promise<{ status, summary, thread }>, openThread(id), defaultFolder() }
 * Devuelve la API que usa el agente (create, list, update, remove, runNow, runs) y tick/render.
 */
export function initAutomations({ $, esc, toast, store, desktop, confirmDialog, run, openThread, models = () => [], defaultFolder = () => '' }) {
  const panel = $('#panel-automations');
  if (!panel || !desktop) return null;
  const load = () => {
    const raw = store.get('automations', []);
    const list = raw.map(migrateTask);
    if (list.some((t, i) => t !== raw[i])) store.set('automations', list);
    return list;
  };
  const save = (list) => { store.set('automations', list); render(); };
  const update = (id, fn) => save(load().map((t) => (t.id === id ? fn(t) : t)));
  const running = new Set();
  let editing = null; // id de la tarea que se está editando en el formulario

  /* ---------------- ejecución ---------------- */
  async function execute(id, { extra = '', trigger = 'schedule' } = {}) {
    if (running.has(id)) return { status: 'running', summary: 'ya se está ejecutando' };
    const task = load().find((t) => t.id === id);
    if (!task) return { status: 'error', summary: 'no existe esa tarea' };
    running.add(id); render();
    const start = Date.now();
    let r;
    try { r = await run(task, { extra, trigger }); } catch (e) { r = { status: e.name === 'AbortError' ? 'cancelled' : 'error', summary: String(e.message || e), thread: null }; }
    running.delete(id);
    const entry = { id: `r-${start.toString(36)}`, start, end: Date.now(), status: r.status || 'ok', summary: String(r.summary || '').slice(0, 300), thread: r.thread || null, trigger, ...(extra ? { extra: extra.slice(0, 300) } : {}) };
    const after = load().find((t) => t.id === id);
    if (after) {
      const next = recordRun(after, entry);
      if (r.thread && after.target === 'same') next.threadId = r.thread;
      save(load().map((t) => (t.id === id ? next : t)));
    } else render();
    if (task.notify !== false) {
      try { new Notification(`JeanCode · ${task.name}`, { body: `${entry.status === 'ok' ? '' : `${STATUS[entry.status] || entry.status}: `}${entry.summary.slice(0, 180)}` }); } catch { /* sin notificaciones */ }
    }
    return entry;
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      // de una en una (una ejecución usa el modelo y la CPU); las demás esperan al siguiente tic
      const due = dueTasks(load()).filter((t) => !running.has(t.id));
      if (due.length) await execute(due[0].id, { trigger: 'schedule' });
    } finally { ticking = false; }
  }

  /* ---------------- API (interfaz y agente) ---------------- */
  const api = {
    list: () => load(),
    get: (id) => load().find((t) => t.id === id || t.name.toLowerCase() === String(id).toLowerCase()) || null,
    create(input, { by = 'user' } = {}) {
      if (by === 'agent' && load().filter((t) => t.by === 'agent' && t.enabled).length >= MAX_AGENT_TASKS) throw new Error(`el agente ya tiene ${MAX_AGENT_TASKS} tareas activas; borra alguna antes`);
      const t = validateTask({ ...input, id: undefined, runs: [], by });
      save([...load(), t]);
      return t;
    },
    update(id, patch) {
      const cur = api.get(id);
      if (!cur) throw new Error(`no existe la tarea ${id}`);
      const t = validateTask({ ...cur, ...patch, id: cur.id, runs: cur.runs, createdAt: cur.createdAt, endedReason: undefined });
      save(load().map((x) => (x.id === cur.id ? t : x)));
      return t;
    },
    remove(id) {
      const cur = api.get(id);
      if (!cur) throw new Error(`no existe la tarea ${id}`);
      save(load().filter((x) => x.id !== cur.id));
      return cur;
    },
    runNow(id, extra = '', trigger = 'manual') {
      const cur = api.get(id);
      if (!cur) throw new Error(`no existe la tarea ${id}`);
      return execute(cur.id, { extra, trigger });
    },
    runs: (id) => api.get(id)?.runs || [],
    isRunning: (id) => running.has(id),
  };

  /* ---------------- interfaz ---------------- */
  function render() {
    const list = load();
    $('#auto-list').innerHTML = list.length ? list.map((t) => {
      const last = t.runs?.at(-1);
      const bad = last && last.status !== 'ok';
      return `<li data-id="${esc(t.id)}" class="auto-item">
      <span class="status ${last ? (bad ? 'bad' : 'ok') : ''}" aria-hidden="true"></span>
      <span class="ep-prov">${esc(t.name)}${t.by === 'agent' ? ' <span class="fine">· creada por el agente</span>' : ''}</span>
      <span class="ep-url apps-desc">${esc(describeTaskSchedule(t.schedule))} · ${esc(t.perm === 'edit' ? 'puede editar' : 'solo lectura')} · ${esc(t.target === 'same' ? 'misma conversación' : 'conversación nueva')} · próxima: ${esc(running.has(t.id) ? 'ejecutándose' : !t.enabled ? (t.endedReason || 'en pausa') : t.next ? fmtWhen(t.next) : 'manual')}${last ? ` · última: ${esc(fmtWhen(last.start))} ${esc(STATUS[last.status] || last.status)}` : ''}</span>
      <span class="fine ep-meta">${esc(t.folder)}${t.model ? ` · ${esc(t.model.split('|').pop())}` : ''}</span>
      <button class="btn ghost sm" type="button" data-act="run" ${running.has(t.id) ? 'disabled' : ''}>${running.has(t.id) ? 'Ejecutando…' : 'Ejecutar ahora'}</button>
      <button class="btn ghost sm" type="button" data-act="edit">Editar</button>
      <button class="btn ghost sm" type="button" data-act="toggle">${t.enabled ? 'Pausar' : 'Reanudar'}</button>
      <button class="btn ghost sm" type="button" data-act="rm">Borrar</button>
      <details class="auto-runs"><summary>Historial (${t.runs?.length || 0}) e instrucciones extra</summary>
        <form class="row gap wrap" data-act="extra"><input type="text" class="grow" placeholder="Ejecutar ahora con estas instrucciones extra…" spellcheck="false" aria-label="Instrucciones extra"><button class="btn sm" type="submit">Ejecutar</button></form>
        <ul class="rows">${(t.runs || []).slice().reverse().map((r) => `<li>
          <span class="status ${r.status === 'ok' ? 'ok' : 'bad'}" aria-hidden="true"></span>
          <span class="ep-prov">${esc(fmtWhen(r.start))}</span>
          <span class="ep-url apps-desc">${esc(STATUS[r.status] || r.status)} · ${esc(fmtDur((r.end || r.start) - r.start))} · ${esc({ schedule: 'programada', manual: 'a mano', agent: 'por el agente' }[r.trigger] || r.trigger)}${r.extra ? ` · «${esc(r.extra)}»` : ''}<br>${esc(r.summary || '')}</span>
          ${r.thread ? `<button class="btn ghost sm" type="button" data-act="open" data-thread="${esc(r.thread)}">Ver</button>` : ''}
        </li>`).join('') || '<li class="fine">Aún no se ha ejecutado.</li>'}</ul>
      </details>
    </li>`;
    }).join('') : '<li class="fine">Sin tareas programadas.</li>';
  }

  const freq = () => $('#auto-when').value;
  function syncForm() {
    const f = freq();
    $('#auto-time').hidden = !['daily', 'weekdays', 'weekly'].includes(f);
    $('#auto-day').hidden = f !== 'weekly';
    $('#auto-at').hidden = f !== 'once';
    $('#auto-cron').hidden = f !== 'cron';
    $('#auto-cron-help').hidden = f !== 'cron';
    previewCron();
  }
  function scheduleFromForm() {
    const f = freq();
    if (f === 'manual') return { type: 'manual' };
    if (f === 'once') return { type: 'once', at: Date.parse($('#auto-at').value) };
    if (f === 'cron') return { type: 'cron', cron: $('#auto-cron').value.trim() };
    if (['daily', 'weekdays', 'weekly'].includes(f) && !/^\d{2}:\d{2}$/.test($('#auto-time').value)) throw new Error('falta la hora (HH:MM)');
    return { type: 'cron', cron: presetCron(f, { time: $('#auto-time').value, day: Number($('#auto-day').value) }) };
  }
  function previewCron() {
    const out = $('#auto-cron-help');
    if (out.hidden) return;
    const v = $('#auto-cron').value.trim();
    const e = v ? cronError(v) : 'minuto hora día mes día-de-la-semana · p. ej. 30 8 * * 1-5 · CRON_TZ=Europe/Madrid 0 9 * * MON';
    if (e) { out.textContent = e; return; }
    const c = parseCron(v);
    const nexts = [];
    let from = Date.now();
    for (let i = 0; i < 3; i++) { const n = nextCron(c, from); if (!n) break; nexts.push(fmtWhen(n)); from = n; }
    out.textContent = `${describeCron(v)} · próximas: ${nexts.join(' · ') || 'ninguna'}`;
  }
  function fillModels(selected = '') {
    $('#auto-model').innerHTML = `<option value="">Modelo automático</option>${models().map((m) => `<option value="${esc(m.key)}">${esc(m.label)}</option>`).join('')}`;
    $('#auto-model').value = models().some((m) => m.key === selected) ? selected : '';
  }
  function resetForm() {
    editing = null;
    $('#auto-form').reset();
    $('#auto-when').value = 'daily';
    $('#auto-time').value = '09:00';
    $('#auto-notify').checked = true;
    $('#auto-submit').textContent = 'Programar';
    $('#auto-cancel').hidden = true;
    $('#auto-form-title').textContent = 'Nueva tarea';
    if (!$('#auto-folder').value) $('#auto-folder').value = defaultFolder() || '';
    fillModels();
    syncForm();
  }
  function editTask(t) {
    editing = t.id;
    $('#auto-name').value = t.name;
    $('#auto-prompt').value = t.prompt;
    $('#auto-folder').value = t.folder;
    $('#auto-perm').value = t.perm;
    $('#auto-target').value = t.target;
    $('#auto-notify').checked = t.notify !== false;
    fillModels(t.model);
    if (t.schedule.type === 'manual') $('#auto-when').value = 'manual';
    else if (t.schedule.type === 'once') {
      $('#auto-when').value = 'once';
      const d = new Date(t.schedule.at - new Date(t.schedule.at).getTimezoneOffset() * 60000);
      $('#auto-at').value = d.toISOString().slice(0, 16);
    } else { $('#auto-when').value = 'cron'; $('#auto-cron').value = t.schedule.cron; }
    $('#auto-submit').textContent = 'Guardar cambios';
    $('#auto-cancel').hidden = false;
    $('#auto-form-title').textContent = `Editar · ${t.name}`;
    syncForm();
    $('#auto-name').focus();
  }

  $('#auto-pick').addEventListener('click', async () => { const f = await desktop.fs.pickFolder(); if (f) $('#auto-folder').value = f; });
  $('#auto-when').addEventListener('change', syncForm);
  $('#auto-cron').addEventListener('input', previewCron);
  $('#auto-cancel').addEventListener('click', resetForm);
  $('#auto-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const data = {
        name: $('#auto-name').value, prompt: $('#auto-prompt').value, folder: $('#auto-folder').value, schedule: scheduleFromForm(),
        perm: $('#auto-perm').value, target: $('#auto-target').value, notify: $('#auto-notify').checked, model: $('#auto-model').value,
      };
      const t = editing ? api.update(editing, data) : api.create(data);
      toast(`${editing ? 'GUARDADA' : 'PROGRAMADA'} · ${t.next ? `PRÓXIMA: ${fmtWhen(t.next).toUpperCase()}` : 'MANUAL'}`);
      resetForm();
    } catch (err) { toast(String(err.message).toUpperCase()); }
  });
  $('#auto-list').addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-act="extra"]');
    if (!f) return;
    e.preventDefault();
    const extra = $('input', f).value.trim();
    execute(f.closest('li.auto-item').dataset.id, { extra, trigger: 'manual' });
    $('input', f).value = '';
  });
  $('#auto-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('li.auto-item').dataset.id;
    const act = b.dataset.act;
    const t = load().find((x) => x.id === id);
    if (act === 'run') return execute(id, { trigger: 'manual' });
    if (act === 'open') { panel.close(); return openThread(b.dataset.thread); }
    if (act === 'edit' && t) return editTask(t);
    if (act === 'toggle' && t) {
      update(id, (x) => {
        const y = { ...x, enabled: !x.enabled, endedReason: undefined };
        // reanudar una "una vez" ya ejecutada: vuelve a valer su fecha si es futura
        y.next = y.enabled ? nextRunOf(x.schedule.type === 'once' ? { ...y, runs: [] } : y) : null;
        return y;
      });
    }
    if (act === 'rm' && await confirmDialog({ title: 'BORRAR TAREA', command: `«${t?.name}» deja de ejecutarse. Sus resultados anteriores siguen en el historial de conversaciones.` })) { if (editing === id) resetForm(); save(load().filter((x) => x.id !== id)); }
  });
  $('#auto-when').innerHTML = [['manual', 'Manual (solo «Ejecutar ahora»)'], ['once', 'Una sola vez…'], ['hourly', 'Cada hora'], ['daily', 'Cada día a las…'],
    ['weekdays', 'Días laborables a las…'], ['weekly', 'Cada semana…'], ['cron', 'Personalizada (cron)…']].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  $('#auto-day').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}">${DAY_NAMES[d]}</option>`).join('');
  panel.addEventListener('toggle', () => { if (panel.open) { render(); if (!editing) resetForm(); } });
  resetForm();
  render();
  try { if (Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
  setInterval(tick, 30000);
  setTimeout(tick, 8000); // al abrir: las que se perdieron con la app cerrada
  return { ...api, tick, render };
}
