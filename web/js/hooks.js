// Motor de hooks (como en Claude Code). Une los hooks globales del usuario y los del proyecto
// (estos solo si el usuario confió en ellos) y decide qué hacer con lo que devuelven.
//
//   salida 2           bloquea (pre_tool, user_prompt, stop); stderr = motivo
//   salida 0 + JSON    { decision: 'block' | 'allow', reason, context }
//   salida 0 + texto   contexto extra (session_start, user_prompt) o se añade al resultado (post_tool, post_edit)
//   otra salida        aviso, no bloquea
const TOOL_EVENTS = new Set(['pre_tool', 'post_tool']);
const SAFE_PATH = /^[\w./-]+$/;

/**
 * sources: [{ hooks, label }] en orden (global primero). exec(command, input, timeout) => { code, stdout, stderr }.
 * Devuelve run(event, payload) => { blocked, reason, allow, context, notes[] }.
 */
export function createHooks(sources, exec) {
  const lists = (event) => sources.flatMap((s) => (s.hooks?.[event] || []).map((h) => ({ ...h, label: s.label })));
  const has = (event) => lists(event).length > 0;

  async function run(event, payload = {}) {
    const out = { blocked: false, reason: '', allow: false, context: '', notes: [] };
    for (const h of lists(event)) {
      if (TOOL_EVENTS.has(event) && h.matcher && !new RegExp(`^(?:${h.matcher})$`).test(String(payload.tool || ''))) continue;
      let command = h.command;
      if (command.includes('{path}')) {
        // compatibilidad con post_edit: {path} viene del modelo, solo con caracteres seguros
        if (!SAFE_PATH.test(String(payload.path || ''))) { out.notes.push(`[hook ${event}] omitido: ruta con caracteres no seguros`); continue; }
        command = command.replace(/\{path\}/g, String(payload.path));
      }
      const r = await exec(command, { event, ...payload }, h.timeout || 60);
      const text = String(r.stdout || '').trim();
      if (r.code === 2) {
        out.blocked = true;
        out.reason = String(r.stderr || text || `bloqueado por un hook (${h.label})`).trim().slice(0, 2000);
        break;
      }
      if (r.code !== 0) { out.notes.push(`[hook ${event} · ${h.label}] salida ${r.code}${r.stderr ? `: ${String(r.stderr).slice(0, 400)}` : ''}`); continue; }
      let decision = null;
      if (text.startsWith('{')) { try { decision = JSON.parse(text); } catch { /* texto normal */ } }
      if (decision && typeof decision === 'object') {
        if (decision.context) out.context += `${out.context ? '\n' : ''}${String(decision.context).slice(0, 4000)}`;
        if (decision.decision === 'block') { out.blocked = true; out.reason = String(decision.reason || 'bloqueado por un hook').slice(0, 2000); break; }
        if (decision.decision === 'allow') out.allow = true;
      } else if (text) {
        out.context += `${out.context ? '\n' : ''}${text.slice(0, 4000)}`;
      }
    }
    return out;
  }

  return { run, has };
}
