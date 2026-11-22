// Gasto de tokens y límites. Tres fuentes:
//   1. lo que informa cada respuesta (usage) → registro diario por proveedor y modelo, guardado en este dispositivo;
//   2. las cabeceras de límite del proveedor (x-ratelimit-*, anthropic-ratelimit-*, retry-after) y los 429;
//   3. el saldo de la clave cuando el proveedor lo ofrece (OpenRouter: /key).
// Más un presupuesto propio (diario y mensual) que avisa al acercarse y pide confirmación al pasarlo.
import { store } from './store.js';

const KEEP_DAYS = 62;
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const month = (d = new Date()) => day(d).slice(0, 7);

/* ---------------------------------------------------------------- registro */
/** Suma un turno al registro. u = { prompt, completion }, cost en USD o 0. */
export function recordUsage({ ep, model, provider = '' }, u, cost = 0) {
  if (!u) return;
  const log = store.get('usageLog', {});
  const today = day();
  const key = `${ep?.id || '?'}|${model || '?'}`;
  const row = (log[today] ||= {})[key] ||= { provider: provider || ep?.name || '', model: model || '', prompt: 0, completion: 0, cost: 0, calls: 0 };
  row.prompt += u.prompt || 0;
  row.completion += u.completion || 0;
  row.cost += cost || 0;
  row.calls += 1;
  const cutoff = day(new Date(Date.now() - KEEP_DAYS * 864e5));
  for (const d of Object.keys(log)) if (d < cutoff) delete log[d];
  store.set('usageLog', log);
}

const sum = (rows) => rows.reduce((a, r) => ({ prompt: a.prompt + r.prompt, completion: a.completion + r.completion, cost: a.cost + r.cost, calls: a.calls + r.calls }), { prompt: 0, completion: 0, cost: 0, calls: 0 });
const total = (x) => x.prompt + x.completion;

/** Totales de hoy, del mes y de los últimos 7 días (por día), y desglose por modelo del mes. */
export function usageSummary() {
  const log = store.get('usageLog', {});
  const today = day(), m = month();
  const todayRows = Object.values(log[today] || {});
  const monthRows = Object.entries(log).filter(([d]) => d.startsWith(m)).flatMap(([, r]) => Object.values(r));
  const byModel = {};
  for (const r of monthRows) {
    const k = `${r.provider}|${r.model}`;
    byModel[k] = sum([byModel[k] || { prompt: 0, completion: 0, cost: 0, calls: 0 }, r]);
    Object.assign(byModel[k], { provider: r.provider, model: r.model });
  }
  const week = Array.from({ length: 7 }, (_, i) => { const d = day(new Date(Date.now() - (6 - i) * 864e5)); return { day: d, ...sum(Object.values(log[d] || {})) }; });
  return { today: sum(todayRows), month: sum(monthRows), week, byModel: Object.values(byModel).sort((a, b) => total(b) - total(a)) };
}

/* ---------------------------------------------------------------- presupuesto propio */
/** { daily: tokens|0, monthly: tokens|0 } — 0 = sin límite. */
export const getBudget = () => ({ daily: 0, monthly: 0, ...store.get('usageBudget', {}) });
export const setBudget = (b) => store.set('usageBudget', { daily: Math.max(0, Number(b.daily) || 0), monthly: Math.max(0, Number(b.monthly) || 0) });

/** Estado frente al presupuesto: { level: 'ok'|'near'|'over', pct, which, used, limit } (el más apretado). */
export function budgetStatus(s = usageSummary()) {
  const b = getBudget();
  const checks = [['daily', total(s.today), b.daily], ['monthly', total(s.month), b.monthly]].filter(([, , l]) => l > 0);
  let worst = { level: 'ok', pct: 0, which: '', used: 0, limit: 0 };
  for (const [which, used, limit] of checks) {
    const pct = Math.round((used / limit) * 100);
    if (pct >= worst.pct) worst = { level: pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok', pct, which, used, limit };
  }
  return worst;
}

/* ---------------------------------------------------------------- límites del proveedor */
const rates = new Map(store.get('rateLimits', []));
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** "1m30s", "6ms", "20s", "2024-…Z" o segundos → segundos hasta el reinicio. */
function resetIn(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d{4}-\d\d-\d\dT/.test(s)) return Math.max(0, (Date.parse(s) - Date.now()) / 1000);
  let secs = 0, ok = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) { ok = true; secs += Number(n) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[u]); }
  return ok ? secs : null;
}
/** Lee las cabeceras de una respuesta del proveedor. Solo se ven las que el proveedor expone al navegador. */
export function noteRateLimit(ep, headers, status = 200) {
  if (!ep || !headers?.get) return;
  const h = (n) => headers.get(n);
  const r = {
    tokens: { limit: num(h('x-ratelimit-limit-tokens') ?? h('anthropic-ratelimit-tokens-limit')), remaining: num(h('x-ratelimit-remaining-tokens') ?? h('anthropic-ratelimit-tokens-remaining')), reset: resetIn(h('x-ratelimit-reset-tokens') ?? h('anthropic-ratelimit-tokens-reset')) },
    requests: { limit: num(h('x-ratelimit-limit-requests') ?? h('x-ratelimit-limit') ?? h('anthropic-ratelimit-requests-limit')), remaining: num(h('x-ratelimit-remaining-requests') ?? h('x-ratelimit-remaining') ?? h('anthropic-ratelimit-requests-remaining')), reset: resetIn(h('x-ratelimit-reset-requests') ?? h('x-ratelimit-reset') ?? h('anthropic-ratelimit-requests-reset')) },
  };
  const retry = resetIn(h('retry-after'));
  const seen = r.tokens.limit != null || r.requests.limit != null || status === 429;
  if (!seen) return;
  const prev = rates.get(ep.id) || {};
  rates.set(ep.id, { ...prev, ...r, name: ep.name || prev.name || '', at: Date.now(), limited: status === 429 ? Date.now() + (retry ?? 60) * 1000 : 0 });
  store.set('rateLimits', [...rates]);
}
/** Último límite visto de cada proveedor. */
export const rateLimits = () => [...rates].map(([id, r]) => ({ id, ...r }));
export const isLimited = (epId) => (rates.get(epId)?.limited || 0) > Date.now();

/** Saldo y límite de la clave, si el proveedor lo informa. → { usage, limit, remaining, free } | null */
export async function keyBalance(ep, providerId) {
  if (providerId !== 'openrouter' || !ep?.key) return null;
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${ep.key}` } });
  if (!r.ok) throw new Error(`OpenRouter respondió ${r.status}`);
  const d = (await r.json()).data || {};
  return { usage: Number(d.usage) || 0, limit: d.limit == null ? null : Number(d.limit), remaining: d.limit_remaining == null ? null : Number(d.limit_remaining), free: !!d.is_free_tier };
}
