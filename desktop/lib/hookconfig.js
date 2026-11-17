// Configuración de hooks con el MISMO esquema que Claude Code (settings.json):
//   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "…", "timeout": 60 } ] } ] },
//     "disableAllHooks": false }
// También acepta el objeto de eventos suelto y el formato antiguo de JeanCode (pre_tool, post_edit…), que se convierte.

const EVENTS = ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Notification',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd'];
// formato antiguo de JeanCode (≤ 1.2) → evento de Claude Code (+ matcher implícito)
const LEGACY = {
  session_start: ['SessionStart'], user_prompt: ['UserPromptSubmit'], pre_tool: ['PreToolUse'], post_tool: ['PostToolUse'],
  post_edit: ['PostToolUse', 'Write|Edit'], stop: ['Stop'], post_turn: ['Stop'],
};
const MAX_GROUPS = 20;
const MAX_HOOKS = 20;

function hookEntry(h, where) {
  if (typeof h === 'string') return { type: 'command', command: h };
  if (!h || typeof h !== 'object') throw new Error(`${where}: cada hook es un objeto { "type": "command", "command": "…" }`);
  const type = h.type || (h.prompt ? 'prompt' : 'command');
  const timeout = Number.isFinite(h.timeout) ? Math.min(Math.max(h.timeout, 1), 600) : undefined;
  if (type === 'command') {
    if (typeof h.command !== 'string' || !h.command.trim()) throw new Error(`${where}: falta "command"`);
    return { type, command: h.command, ...(timeout ? { timeout } : {}) };
  }
  if (type === 'prompt') {
    if (typeof h.prompt !== 'string' || !h.prompt.trim()) throw new Error(`${where}: falta "prompt"`);
    return { type, prompt: h.prompt.slice(0, 8000), ...(timeout ? { timeout } : {}) };
  }
  throw new Error(`${where}: tipo de hook desconocido "${type}" (command o prompt)`);
}

function checkMatcher(m, where) {
  if (m == null || m === '' || m === '*') return '';
  if (typeof m !== 'string') throw new Error(`${where}: "matcher" debe ser texto`);
  try { new RegExp(m); } catch { throw new Error(`${where}: matcher inválido ${m}`); }
  return m.slice(0, 300);
}

/** Cualquier formato admitido → { hooks: { Evento: [{ matcher, hooks: [...] }] }, disableAll }. Lanza un error legible. */
function normalize(data) {
  if (data == null) return { hooks: {}, disableAll: false };
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('la configuración debe ser un objeto JSON');
  const disableAll = data.disableAllHooks === true;
  const src = data.hooks && typeof data.hooks === 'object' ? data.hooks : data;
  const out = {};
  const push = (ev, group) => { (out[ev] ||= []).push(group); };
  for (const [key, value] of Object.entries(src)) {
    if (key === 'disableAllHooks') continue;
    if (LEGACY[key]) {
      const [ev, implicit] = LEGACY[key];
      for (const [i, h] of (Array.isArray(value) ? value : []).entries()) {
        const where = `${key}[${i}]`;
        const entry = hookEntry(typeof h === 'string' ? h : { type: 'command', command: h?.command, timeout: h?.timeout }, where);
        push(ev, { matcher: checkMatcher(h?.matcher ?? implicit ?? '', where), hooks: [entry], legacy: key });
      }
      continue;
    }
    if (!EVENTS.includes(key)) {
      if (data.hooks) throw new Error(`evento de hook desconocido: ${key}. Válidos: ${EVENTS.join(', ')}`);
      continue; // objeto de ajustes con otras claves (permissions, env…): se ignoran
    }
    if (!Array.isArray(value)) throw new Error(`${key}: debe ser una lista de grupos { "matcher", "hooks": [...] }`);
    for (const [i, g] of value.slice(0, MAX_GROUPS).entries()) {
      const where = `${key}[${i}]`;
      if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) throw new Error(`${where}: falta la lista "hooks"`);
      push(key, { matcher: checkMatcher(g.matcher, where), hooks: g.hooks.slice(0, MAX_HOOKS).map((h, j) => hookEntry(h, `${where}.hooks[${j}]`)) });
    }
  }
  return { hooks: out, disableAll };
}

const count = (hooks) => Object.values(hooks || {}).reduce((n, groups) => n + groups.reduce((m, g) => m + g.hooks.length, 0), 0);

module.exports = { EVENTS, LEGACY, normalize, count };
