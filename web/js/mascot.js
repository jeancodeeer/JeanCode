// La mascota de JeanCode: reacciona a lo que hace la app. Es decorativa: no recibe foco ni la leen los lectores de pantalla.
// Hoja de sprites icons/mascot.png: fila 0 = cuerpo de cada expresión, fila 1 = sus marcas (corazón, zzz, !…).
const FRAMES = ['idle', 'alert', 'happy', 'angry', 'bored', 'sleep', 'walk', 'coffee', 'confused'];
export const MASCOT_WORK = { thinking: 'confused', writing: 'walk', media: 'coffee', waiting: 'alert' };
// cuánto tiempo sin actividad hasta cada gesto de reposo (ms)
export const MASCOT_IDLE = [[180000, 'sleep'], [70000, 'bored'], [25000, 'coffee']];

/** Expresión de reposo según el tiempo sin actividad. */
export const restFrame = (quietMs) => MASCOT_IDLE.find(([ms]) => quietMs >= ms)?.[1] || 'idle';

/** Quién manda: una reacción breve, luego el trabajo en curso y, si no hay ninguno, el reposo. */
export const pickFrame = ({ reaction, work, quietMs }) => reaction || MASCOT_WORK[work] || restFrame(quietMs);

export function createMascot({ store, now = () => Date.now() }) {
  const el = document.createElement('div');
  el.className = 'mascot';
  el.id = 'mascot';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="m-sprite m-body"></i><i class="m-sprite m-marks"></i>';
  const st = { work: null, reaction: null, until: 0, last: now(), failed: false, frame: '', mode: 'chat' };
  let timer = 0;

  function paint() {
    clearTimeout(timer);
    const t = now();
    if (st.reaction && t >= st.until) st.reaction = null;
    const frame = pickFrame({ reaction: st.reaction, work: st.work, quietMs: t - st.last });
    if (frame !== st.frame) {
      st.frame = frame;
      el.dataset.state = frame;
      el.style.setProperty('--m-col', FRAMES.indexOf(frame));
    }
    // se vuelve a mirar solo cuando algo puede cambiar
    const next = st.reaction ? st.until - t : st.work ? 0 : (MASCOT_IDLE.map(([ms]) => ms - (t - st.last)).filter((x) => x > 0).sort((a, b) => a - b)[0] || 0);
    if (next > 0) timer = setTimeout(paint, next + 20);
  }

  const api = {
    el,
    /** Reacción breve: 'happy', 'angry' o 'alert'. */
    react(frame, ms = 2600) { st.reaction = frame; st.until = now() + ms; paint(); },
    /** Trabajo en curso: 'thinking', 'writing', 'media' o 'waiting'. */
    work(kind) { if (st.work !== kind) { st.work = kind; st.failed = false; paint(); } },
    /** Terminó el trabajo: se alegra, salvo que haya fallado. */
    done() {
      const was = st.work;
      st.work = null;
      st.last = now();
      if (was && !st.failed) api.react('happy'); else paint();
    },
    fail() { st.failed = true; st.work = null; api.react('angry', 3400); },
    /** Mientras un diálogo espera tu respuesta. */
    ask(promise) {
      const before = st.work;
      st.work = 'waiting';
      paint();
      Promise.resolve(promise).finally(() => { st.work = before; paint(); });
    },
    /** Actividad del usuario: si dormía, se despierta. */
    wake() {
      const asleep = ['sleep', 'bored'].includes(st.frame);
      st.last = now();
      if (asleep) api.react('alert', 900); else if (!st.work && st.frame === 'coffee') paint();
    },
    /** Dónde está según el modo. holder = el elemento sobre el que se apoya; null la oculta. */
    place(holder) {
      const on = store.get('mascot', true) !== false && !!holder;
      el.hidden = !on;
      if (on && el.parentElement !== holder) holder.appendChild(el);
    },
  };
  el.addEventListener('click', () => api.react('happy', 1800));
  // actividad, sin escuchar cada movimiento del ratón a ritmo completo
  let throttled = 0;
  const activity = () => { const t = now(); if (t - throttled > 1500) { throttled = t; api.wake(); } };
  for (const ev of ['keydown', 'pointerdown', 'pointermove']) window.addEventListener(ev, activity, { passive: true });
  // otros módulos (estudio) avisan sin depender de este
  window.addEventListener('jc:mascot', (e) => { const { work, done, fail } = e.detail || {}; if (work) api.work(work); if (done) api.done(); if (fail) api.fail(); });
  paint();
  return api;
}
