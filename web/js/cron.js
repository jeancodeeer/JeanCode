// Expresiones cron de 5 campos (minuto hora día-del-mes mes día-de-la-semana), como las tareas
// programadas de Claude: hora local salvo prefijo "CRON_TZ=Zona/IANA ". Admite *, listas, rangos,
// pasos (*/15, 1-5/2), nombres (MON-FRI, JAN) y @hourly @daily @weekly @monthly @yearly.
// Día del mes y día de la semana restringidos a la vez = basta con que se cumpla uno (como Vixie cron).

const FIELDS = [
  { name: 'minuto', min: 0, max: 59 },
  { name: 'hora', min: 0, max: 23 },
  { name: 'día del mes', min: 1, max: 31 },
  { name: 'mes', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { name: 'día de la semana', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
];
const MACROS = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *' };

function parseField(src, f) {
  const set = new Set();
  const val = (s) => {
    const i = f.names ? f.names.indexOf(s.toLowerCase()) : -1;
    const n = i >= 0 ? i + (f.min === 1 ? 1 : 0) : Number(s);
    if (!Number.isInteger(n) || n < f.min || n > f.max) throw new Error(`valor fuera de rango en ${f.name}: ${s}`);
    return n;
  };
  for (const part of src.split(',')) {
    const m = part.match(/^(\*|[\w]+(?:-[\w]+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`campo ${f.name} no válido: ${part}`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`paso no válido en ${f.name}`);
    let lo, hi;
    if (m[1] === '*') { lo = f.min; hi = f.max; } else if (m[1].includes('-')) { [lo, hi] = m[1].split('-').map(val); } else { lo = val(m[1]); hi = m[2] ? f.max : lo; }
    if (lo > hi) throw new Error(`rango al revés en ${f.name}: ${m[1]}`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { set, any: src === '*' || src === '?' };
}

/** "CRON_TZ=Europe/Madrid 30 8 * * 1-5" -> { tz, fields } (lanza un error legible si no es válida). */
export function parseCron(expr) {
  let text = String(expr || '').trim();
  let tz = '';
  const z = text.match(/^CRON_TZ=(\S+)\s+(.*)$/);
  if (z) {
    tz = z[1]; text = z[2].trim();
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new Error(`zona horaria desconocida: ${tz}`); }
  }
  text = MACROS[text.toLowerCase()] || text;
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new Error('una expresión cron tiene 5 campos: minuto hora día mes día-de-la-semana');
  const fields = parts.map((p, i) => parseField(p === '?' ? '*' : p, FIELDS[i]));
  if (fields[4].set.has(7)) fields[4].set.add(0); // 7 = domingo también
  return { tz, fields, source: String(expr).trim() };
}

const partsCache = new Map();
/** Minuto, hora, día, mes y día de la semana de `ms` en la zona `tz` ('' = hora local). */
function partsOf(ms, tz) {
  if (!tz) { const d = new Date(ms); return [d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getDay()]; }
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short' });
    partsCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return [Number(p.minute), Number(p.hour) % 24, Number(p.day), Number(p.month), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)];
}

/** Próximo instante (ms, al minuto exacto) estrictamente posterior a `from` que cumple la expresión; null si no hay en 5 años. */
export function nextCron(expr, from = Date.now()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const [fMin, fHour, fDom, fMon, fDow] = c.fields;
  const dayOk = (dom, dow) => {
    if (fDom.any && fDow.any) return true;
    if (fDom.any) return fDow.set.has(dow);
    if (fDow.any) return fDom.set.has(dom);
    return fDom.set.has(dom) || fDow.set.has(dow);
  };
  let t = Math.floor(from / 60000) * 60000 + 60000;
  const end = from + 5 * 366 * 86400000;
  // se avanza por horas mientras el día o la hora no cuadran (también vale con cambios de horario) y por minutos dentro de una hora válida
  while (t <= end) {
    const [mi, h, dom, mon, dow] = partsOf(t, c.tz);
    // día que no cuadra: a las 23:00 de ese día (luego una hora más = medianoche, aunque cambie el horario)
    if (!fMon.set.has(mon) || !dayOk(dom, dow)) { t += h < 23 ? ((23 - h) * 60 - mi) * 60000 : (60 - mi) * 60000; continue; }
    if (!fHour.set.has(h)) { t += (60 - mi) * 60000; continue; }
    if (fMin.set.has(mi)) return t;
    t += 60000;
  }
  return null;
}

/** Comprueba la expresión; devuelve un mensaje de error o '' si es válida. */
export function cronError(expr) {
  try { parseCron(expr); return ''; } catch (e) { return e.message; }
}

/** Frases para los casos habituales; si no, la propia expresión. */
export function describeCron(expr) {
  let c;
  try { c = parseCron(expr); } catch { return String(expr); }
  const raw = c.source.replace(/^CRON_TZ=\S+\s+/, '');
  const norm = MACROS[raw.toLowerCase()] || raw;
  const [mi, h, dom, mon, dow] = norm.split(/\s+/);
  const tz = c.tz ? ` (${c.tz})` : '';
  const hh = (x) => String(x).padStart(2, '0');
  const at = /^\d+$/.test(mi) && /^\d+$/.test(h) ? `a las ${hh(h)}:${hh(mi)}` : '';
  const days = { '1-5': 'de lunes a viernes', '0,6': 'sábados y domingos', '6,0': 'sábados y domingos', 0: 'cada domingo', 1: 'cada lunes', 2: 'cada martes', 3: 'cada miércoles', 4: 'cada jueves', 5: 'cada viernes', 6: 'cada sábado', 7: 'cada domingo' };
  if (dom === '*' && mon === '*') {
    if (/^\d+$/.test(mi) && h === '*' && dow === '*') return `Cada hora, en el minuto ${mi}${tz}`;
    const every = mi.match(/^\*\/(\d+)$/);
    if (every && h === '*' && dow === '*') return `Cada ${every[1]} minutos${tz}`;
    const everyH = h.match(/^\*\/(\d+)$/);
    if (everyH && /^\d+$/.test(mi) && dow === '*') return `Cada ${everyH[1]} horas, en el minuto ${mi}${tz}`;
    if (at && dow === '*') return `Cada día ${at}${tz}`;
    const d = days[dow.toLowerCase() === 'mon-fri' ? '1-5' : dow];
    if (at && d) return `${d[0].toUpperCase()}${d.slice(1)} ${at}${tz}`;
  }
  if (at && /^\d+$/.test(dom) && mon === '*' && dow === '*') return `El día ${dom} de cada mes ${at}${tz}`;
  return `cron ${c.source}`;
}

/** Atajos de la interfaz (como los de Claude): devuelven una expresión cron. `minute` ancla "cada hora" al minuto de creación. */
export function presetCron(kind, { time = '09:00', day = 1, minute = new Date().getMinutes() } = {}) {
  const [h, m] = String(time).split(':').map(Number);
  switch (kind) {
    case 'hourly': return `${minute} * * * *`;
    case 'daily': return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekly': return `${m} ${h} * * ${Number(day) % 7}`;
    default: throw new Error(`atajo desconocido: ${kind}`);
  }
}
