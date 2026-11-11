// Tareas programadas (como las de Claude Code de escritorio) y su calendario.
// Corren mientras JeanCode está abierto; una ejecución que se perdió con la app cerrada se hace una
// sola vez al abrirla. Son DESATENDIDAS: nada puede pedir permiso, así que lo que lo necesite se
// deniega y se informa (solo corren los comandos marcados como "permitir siempre" en esa carpeta).

export const SCHEDULES = [
  ['every:15', 'Cada 15 minutos'], ['every:30', 'Cada 30 minutos'], ['every:60', 'Cada hora'], ['every:180', 'Cada 3 horas'],
  ['every:360', 'Cada 6 horas'], ['every:720', 'Cada 12 horas'], ['daily', 'Cada día a las…'], ['weekdays', 'De lunes a viernes a las…'], ['weekly', 'Cada lunes a las…'],
];

/** Próxima ejecución (ms) después de `from`. schedule: { kind: 'every', minutes } | { kind: 'daily'|'weekdays'|'weekly', time: 'HH:MM' } */
export function nextRun(schedule, from = Date.now()) {
  if (schedule.kind === 'every') return from + Math.max(5, Number(schedule.minutes) || 60) * 60000;
  const [h, m] = String(schedule.time || '09:00').split(':').map(Number);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(h, m);
  const ok = (x) => schedule.kind === 'daily' || (schedule.kind === 'weekdays' ? x.getDay() >= 1 && x.getDay() <= 5 : x.getDay() === 1);
  for (let i = 0; i < 9; i++) {
    if (d.getTime() > from && ok(d)) return d.getTime();
    d.setDate(d.getDate() + 1);
    d.setHours(h, m);
  }
  return from + 86400000;
}

export function parseSchedule(value, time) {
  if (String(value).startsWith('every:')) return { kind: 'every', minutes: Number(value.split(':')[1]) };
  if (!/^\d{2}:\d{2}$/.test(time || '')) throw new Error('falta la hora (HH:MM)');
  return { kind: value, time };
}

export function describeSchedule(s) {
  if (s.kind === 'every') return SCHEDULES.find(([v]) => v === `every:${s.minutes}`)?.[1] || `Cada ${s.minutes} min`;
  return `${{ daily: 'Cada día', weekdays: 'Lunes a viernes', weekly: 'Cada lunes' }[s.kind]} a las ${s.time}`;
}

/** Tareas que tocan ahora (incluidas las que se perdieron con la app cerrada: una vez). */
export const dueTasks = (tasks, now = Date.now()) => tasks.filter((t) => t.enabled !== false && t.next && t.next <= now);

/** Intervalo de /loop: "10m", "2h", "90s" (mín. 1 min, máx. 24 h). */
export function parseInterval(s) {
  const m = String(s || '').trim().match(/^(\d+)\s*(s|m|h)$/i);
  if (!m) return null;
  const ms = Number(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2].toLowerCase()];
  return Math.min(Math.max(ms, 60000), 86400000);
}

const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Panel de Automatizaciones. deps: { $, esc, toast, store, desktop, confirmDialog, run(task) => Promise<{ ok, summary }> , openThread(id) }
 */
export function initAutomations({ $, esc, toast, store, desktop, confirmDialog, run, openThread }) {
  const panel = $('#panel-automations');
  if (!panel || !desktop) return { tick: () => {} };
  const load = () => store.get('automations', []);
  const save = (list) => store.set('automations', list);
  let running = null;

  function render() {
    const list = load();
    $('#auto-list').innerHTML = list.length ? list.map((t) => `<li data-id="${esc(t.id)}">
      <span class="status ${t.lastOk === false ? 'bad' : t.lastOk ? 'ok' : ''}" aria-hidden="true"></span>
      <span class="ep-prov">${esc(t.name)}</span>
      <span class="ep-url apps-desc">${esc(describeSchedule(t.schedule))} · ${esc(t.perm === 'edit' ? 'puede editar' : 'solo lectura')} · próxima: ${esc(t.enabled === false ? 'en pausa' : fmtWhen(t.next))}${t.lastRun ? ` · última: ${esc(fmtWhen(t.lastRun))}${t.lastOk === false ? ' (falló)' : ''}` : ''}</span>
      <span class="fine ep-meta">${esc(t.folder)}</span>
      <button class="btn ghost sm" type="button" data-act="run">${running === t.id ? 'Ejecutando…' : 'Ejecutar ahora'}</button>
      ${t.lastThread ? '<button class="btn ghost sm" type="button" data-act="open">Ver resultado</button>' : ''}
      <button class="btn ghost sm" type="button" data-act="toggle">${t.enabled === false ? 'Reanudar' : 'Pausar'}</button>
      <button class="btn ghost sm" type="button" data-act="rm">Borrar</button>
    </li>`).join('') : '<li class="fine">Sin tareas programadas.</li>';
  }

  async function execute(id) {
    if (running) return;
    const task = load().find((t) => t.id === id);
    if (!task) return;
    running = id; render();
    let r;
    try { r = await run(task); } catch (e) { r = { ok: false, summary: String(e.message || e), thread: null }; }
    const list = load().map((t) => (t.id === id ? { ...t, lastRun: Date.now(), lastOk: r.ok, lastThread: r.thread || t.lastThread, next: nextRun(t.schedule) } : t));
    save(list);
    running = null; render();
    try { new Notification(`JeanCode · ${task.name}`, { body: (r.ok ? '' : 'Falló: ') + String(r.summary || '').slice(0, 180) }); } catch { /* sin notificaciones */ }
  }

  async function tick() {
    if (running) return;
    const due = dueTasks(load());
    if (due.length) await execute(due[0].id);
  }

  $('#auto-pick').addEventListener('click', async () => { const f = await desktop.fs.pickFolder(); if (f) $('#auto-folder').value = f; });
  $('#auto-when').addEventListener('change', (e) => { $('#auto-time').hidden = String(e.target.value).startsWith('every:'); });
  $('#auto-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const schedule = parseSchedule($('#auto-when').value, $('#auto-time').value);
      const task = {
        id: crypto.randomUUID(), name: $('#auto-name').value.trim().slice(0, 60) || 'Tarea', prompt: $('#auto-prompt').value.trim(),
        folder: $('#auto-folder').value.trim(), schedule, perm: $('#auto-perm').value, enabled: true, next: nextRun(schedule),
      };
      if (!task.prompt) throw new Error('escribe qué debe hacer');
      if (!task.folder) throw new Error('elige la carpeta de trabajo');
      save([...load(), task]);
      e.target.reset();
      $('#auto-time').hidden = true;
      render();
      toast(`PROGRAMADA · PRÓXIMA: ${fmtWhen(task.next).toUpperCase()}`);
    } catch (err) { toast(String(err.message).toUpperCase()); }
  });
  $('#auto-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('li').dataset.id;
    const act = b.dataset.act;
    if (act === 'run') return execute(id);
    if (act === 'open') { const t = load().find((x) => x.id === id); panel.close(); return openThread(t.lastThread); }
    if (act === 'toggle') save(load().map((t) => (t.id === id ? { ...t, enabled: t.enabled === false, next: nextRun(t.schedule) } : t)));
    if (act === 'rm' && await confirmDialog({ title: 'BORRAR TAREA', command: 'La tarea deja de ejecutarse. Sus resultados anteriores siguen en el historial.' })) save(load().filter((t) => t.id !== id));
    render();
  });
  $('#auto-when').innerHTML = SCHEDULES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  $('#auto-when').value = 'every:60';
  panel.addEventListener('toggle', render);
  render();
  try { if (Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
  setInterval(tick, 30000);
  setTimeout(tick, 8000); // al abrir: las que se perdieron con la app cerrada
  return { tick, render };
}
