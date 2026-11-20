// Motor de hooks con la MISMA semántica que Claude Code (https://code.claude.com/docs/en/hooks).
// La configuración llega normalizada (desktop/lib/hookconfig.js): { Evento: [{ matcher, hooks: [{ type, command|prompt, timeout }] }] }.
//
// Entrada (JSON por stdin): session_id, transcript_path, cwd, permission_mode, hook_event_name + los campos del evento
// (tool_name, tool_input, tool_response, prompt, stop_hook_active, source, reason, trigger, message…).
// Las herramientas de JeanCode se presentan con su nombre de Claude Code (Bash, Read, Write, Edit…) y sus campos.
//
// Salida:
//   código 2   → bloquea (PreToolUse: no se ejecuta, el motivo va al modelo · PermissionRequest: deniega ·
//                PostToolUse/PostToolUseFailure: el motivo va al modelo · UserPromptSubmit: el mensaje no se envía ·
//                Stop/SubagentStop: el agente sigue con el motivo como instrucción · resto: se muestra al usuario)
//   código 0   → stdout en JSON: continue, stopReason, suppressOutput, systemMessage, decision ("block"), reason,
//                hookSpecificOutput { permissionDecision allow|deny|ask, permissionDecisionReason, updatedInput,
//                additionalContext, decision { behavior, updatedInput, message } }; o texto (contexto en
//                UserPromptSubmit y SessionStart; en el resto se muestra en el registro)
//   otro       → error que no bloquea (se avisa al usuario)

export const HOOK_EVENTS = ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Notification',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd'];

/** Campo con el que se compara el matcher en cada evento (los demás no usan matcher). */
const MATCH_FIELD = {
  PreToolUse: 'tool_name', PermissionRequest: 'tool_name', PostToolUse: 'tool_name', PostToolUseFailure: 'tool_name',
  SessionStart: 'source', SessionEnd: 'reason', PreCompact: 'trigger', Notification: 'notification_type',
  SubagentStart: 'agent_type', SubagentStop: 'agent_type',
};
// eventos en los que la salida de texto (código 0) se convierte en contexto para el modelo
const TEXT_IS_CONTEXT = new Set(['UserPromptSubmit', 'SessionStart']);
// eventos que admiten hooks de tipo "prompt" (los evalúa un modelo)
export const PROMPT_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'UserPromptSubmit', 'Stop', 'SubagentStop']);

/** Nombre de Claude Code de cada herramienta de JeanCode (las de apps, mcp__…, ya coinciden). */
export const CLAUDE_TOOL = {
  run_command: 'Bash', start_process: 'Bash', read_file: 'Read', write_file: 'Write', edit_file: 'Edit', glob: 'Glob',
  search: 'Grep', list_dir: 'LS', webfetch: 'WebFetch', spawn_subagent: 'Task', todo_write: 'TodoWrite', load_skill: 'Skill',
  schedule_wakeup: 'ScheduleWakeup',
};
export const claudeToolName = (tool) => CLAUDE_TOOL[tool] || tool;

const absPath = (ws, p) => {
  if (p == null || p === '') return p;
  const s = String(p);
  if (ws && /^\.[\\/]?$/.test(s)) return String(ws).replace(/[\\/]+$/, ''); // "." = la carpeta de trabajo
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(s) || !ws) return s;
  const sep = /\\/.test(ws) && !/\//.test(ws) ? '\\' : '/';
  return `${String(ws).replace(/[\\/]+$/, '')}${sep}${s.replace(/^\.[\\/]/, '').replace(/[\\/]+/g, sep)}`;
};
const relPath = (ws, p) => {
  const s = String(p ?? '');
  if (!ws) return s;
  const base = String(ws).replace(/[\\/]+$/, '');
  return s.toLowerCase().startsWith(base.toLowerCase()) ? s.slice(base.length).replace(/^[\\/]+/, '') || '.' : s;
};

/** tool_input con los campos de Claude Code (rutas absolutas, como allí). */
export function toolInput(tool, args = {}, ws = '') {
  switch (tool) {
    case 'run_command': return { command: String(args.command ?? ''), ...(args.timeout ? { timeout: args.timeout * 1000 } : {}) };
    case 'start_process': return { command: String(args.command ?? ''), run_in_background: true };
    case 'read_file': return { file_path: absPath(ws, args.path), ...(args.offset ? { offset: args.offset } : {}), ...(args.limit ? { limit: args.limit } : {}) };
    case 'write_file': return { file_path: absPath(ws, args.path), content: String(args.content ?? '') };
    case 'edit_file': return { file_path: absPath(ws, args.path), old_string: String(args.old ?? ''), new_string: String(args.new ?? '') };
    case 'glob': return { pattern: args.pattern };
    case 'search': return { pattern: args.pattern, path: absPath(ws, args.path || '.') };
    case 'list_dir': return { path: absPath(ws, args.path || '.') };
    case 'webfetch': return { url: args.url };
    case 'spawn_subagent': return { prompt: args.task, description: String(args.task || '').slice(0, 60), subagent_type: args.agent || 'general-purpose' };
    case 'todo_write': return { todos: args.todos };
    case 'load_skill': return { skill: args.name, ...(args.file ? { file: args.file } : {}) };
    default: return { ...args };
  }
}

/** updatedInput (campos de Claude Code) → argumentos de la herramienta de JeanCode. */
export function fromToolInput(tool, input, ws = '', prev = {}) {
  if (!input || typeof input !== 'object') return prev;
  const path = (v) => (v == null ? undefined : relPath(ws, v));
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  switch (tool) {
    case 'run_command': return pick({ ...prev, command: input.command ?? prev.command, timeout: input.timeout ? Math.round(input.timeout / 1000) : prev.timeout });
    case 'start_process': return pick({ ...prev, command: input.command ?? prev.command });
    case 'read_file': return pick({ ...prev, path: path(input.file_path) ?? prev.path, offset: input.offset ?? prev.offset, limit: input.limit ?? prev.limit });
    case 'write_file': return pick({ ...prev, path: path(input.file_path) ?? prev.path, content: input.content ?? prev.content });
    case 'edit_file': return pick({ ...prev, path: path(input.file_path) ?? prev.path, old: input.old_string ?? prev.old, new: input.new_string ?? prev.new });
    case 'search': return pick({ ...prev, pattern: input.pattern ?? prev.pattern, path: path(input.path) ?? prev.path });
    case 'list_dir': return pick({ ...prev, path: path(input.path) ?? prev.path });
    case 'spawn_subagent': return pick({ ...prev, task: input.prompt ?? prev.task, agent: input.subagent_type && input.subagent_type !== 'general-purpose' ? input.subagent_type : prev.agent });
    case 'load_skill': return pick({ ...prev, name: input.skill ?? prev.name, file: input.file ?? prev.file });
    default: return { ...prev, ...input };
  }
}

/** Modo de permisos con los nombres de Claude Code. */
export function permissionMode(perm, agent) {
  if (agent === 'plan' || perm === 'plan') return 'plan';
  if (perm === 'auto-edit') return 'acceptEdits';
  return 'default';
}

function matches(matcher, values) {
  if (!matcher || matcher === '*') return true;
  let re;
  try { re = new RegExp(`^(?:${matcher})$`); } catch { return false; }
  return values.some((v) => v != null && re.test(String(v)));
}

const parseJson = (text) => {
  const t = String(text || '').trim();
  if (!t.startsWith('{')) return null;
  try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : null; } catch { return null; }
};

/**
 * sources: [{ hooks, label }] (global primero).
 * io: { exec(command, input, timeoutSec) => { code, stdout, stderr },
 *       llm?(prompt, timeoutSec) => texto,     // para hooks de tipo "prompt"
 *       base?() => { session_id, transcript_path, cwd, permission_mode } }
 */
export function createHooks(sources, io) {
  const exec = typeof io === 'function' ? io : io.exec; // compatibilidad: createHooks(sources, exec)
  const llm = typeof io === 'object' ? io.llm : null;
  const base = typeof io === 'object' && io.base ? io.base : () => ({});

  const groups = (event) => sources.flatMap((s) => (s.hooks?.[event] || []).map((g) => ({ ...g, label: s.label })));
  const has = (event) => groups(event).length > 0;

  /** Para /hooks: [{ event, matcher, type, command|prompt, label }] */
  const list = () => HOOK_EVENTS.flatMap((event) => groups(event).flatMap((g) => g.hooks.map((h) => ({ event, matcher: g.matcher || '*', ...h, label: g.label }))));

  async function runOne(h, event, input, label) {
    if (h.type === 'prompt') {
      if (!llm) return { code: 1, stderr: 'los hooks de tipo prompt no están disponibles aquí', label };
      if (!PROMPT_EVENTS.has(event)) return { code: 1, stderr: `${event} no admite hooks de tipo prompt`, label };
      const json = JSON.stringify(input, null, 2);
      const prompt = h.prompt.includes('$ARGUMENTS') ? h.prompt.replace(/\$ARGUMENTS/g, json) : `${h.prompt}\n\nEntrada del hook:\n${json}`;
      try {
        const text = await llm(`${prompt}\n\nResponde SOLO con JSON: {"ok": true} para permitirlo o {"ok": false, "reason": "motivo"} para impedirlo.`, h.timeout || 30);
        const j = parseJson(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) || {};
        if (j.ok === false || j.decision === 'block') return { code: 0, stdout: JSON.stringify({ decision: 'block', reason: j.reason || 'rechazado por un hook de tipo prompt' }), label };
        return { code: 0, stdout: '', label };
      } catch (e) { return { code: 1, stderr: `hook prompt: ${e.message}`, label }; }
    }
    let command = h.command;
    if (command.includes('{path}')) {
      // formato antiguo (post_edit): {path} viene del modelo, solo con caracteres seguros
      const p = String(input.jeancode_args?.path || '');
      if (!/^[\w./-]+$/.test(p)) return { code: 1, stderr: 'omitido: ruta con caracteres no seguros', label };
      command = command.replace(/\{path\}/g, p);
    }
    const r = await exec(command, input, h.timeout || 60);
    return { ...r, label };
  }

  /**
   * run(event, campos) → { blocked, reason, decision, decisionReason, updatedInput, context, stop, stopReason, messages, outputs, ran }
   * decision: 'allow' | 'deny' | 'ask' | null (PreToolUse y PermissionRequest; deny > ask > allow).
   */
  async function run(event, fields = {}) {
    const input = { ...base(), hook_event_name: event, ...fields };
    const field = MATCH_FIELD[event];
    const values = field ? [input[field], input.jeancode_tool] : [];
    const seen = new Set();
    const todo = [];
    for (const g of groups(event)) {
      if (field && !matches(g.matcher, values)) continue;
      for (const h of g.hooks) {
        const key = h.type === 'prompt' ? `p:${h.prompt}` : `c:${h.command}`;
        if (seen.has(key)) continue; // el mismo hook en varias fuentes se ejecuta una vez
        seen.add(key);
        todo.push(runOne(h, event, input, g.label));
      }
    }
    const res = { blocked: false, reason: '', decision: null, decisionReason: '', updatedInput: null, context: '', stop: false, stopReason: '', messages: [], outputs: [], ran: todo.length };
    const addCtx = (t) => { if (t) res.context += `${res.context ? '\n' : ''}${String(t).slice(0, 10000)}`; };
    const block = (why) => { res.blocked = true; res.reason += `${res.reason ? '\n' : ''}${String(why).trim().slice(0, 4000)}`; };
    const rank = { allow: 1, ask: 2, deny: 3 };
    const decide = (d, why) => {
      if (!rank[d]) return;
      if (!res.decision || rank[d] > rank[res.decision]) { res.decision = d; res.decisionReason = why ? String(why).slice(0, 2000) : ''; }
    };

    for (const r of await Promise.all(todo)) {
      const out = String(r.stdout || '').trim();
      const err = String(r.stderr || '').trim();
      if (r.code === 2) {
        const why = err || out || `bloqueado por un hook (${r.label})`;
        block(why);
        if (event === 'PreToolUse' || event === 'PermissionRequest') decide('deny', why);
        continue;
      }
      if (r.code !== 0) { res.messages.push(`Hook ${event} (${r.label}) falló con código ${r.code}${err ? `: ${err.slice(0, 500)}` : ''}`); continue; }
      const j = parseJson(out);
      if (!j) {
        if (TEXT_IS_CONTEXT.has(event)) addCtx(out);
        else if (out) res.outputs.push(out.slice(0, 4000));
        continue;
      }
      if (j.continue === false) { res.stop = true; res.stopReason = String(j.stopReason || 'detenido por un hook').slice(0, 2000); }
      if (j.systemMessage) res.messages.push(String(j.systemMessage).slice(0, 2000));
      const hso = j.hookSpecificOutput && typeof j.hookSpecificOutput === 'object' ? j.hookSpecificOutput : {};
      if (hso.additionalContext) addCtx(hso.additionalContext);
      if (j.context) addCtx(j.context); // formato antiguo de JeanCode
      if (event === 'PreToolUse') {
        if (hso.permissionDecision) decide(hso.permissionDecision, hso.permissionDecisionReason);
        // forma antigua de Claude Code y de JeanCode: decision approve|allow|block
        if (j.decision === 'approve' || j.decision === 'allow') decide('allow', j.reason);
        if (j.decision === 'block') decide('deny', j.reason);
        if (hso.updatedInput && typeof hso.updatedInput === 'object') res.updatedInput = { ...(res.updatedInput || {}), ...hso.updatedInput };
        if (res.decision === 'deny' && !res.blocked) block(res.decisionReason || 'bloqueado por un hook');
      } else if (event === 'PermissionRequest') {
        const d = hso.decision && typeof hso.decision === 'object' ? hso.decision : {};
        if (d.behavior === 'allow') decide('allow', d.message);
        if (d.behavior === 'deny') { decide('deny', d.message); block(d.message || 'denegado por un hook'); }
        if (d.updatedInput && typeof d.updatedInput === 'object') res.updatedInput = { ...(res.updatedInput || {}), ...d.updatedInput };
      } else if (j.decision === 'block') {
        block(j.reason || 'bloqueado por un hook');
      }
    }
    return res;
  }

  return { run, has, list };
}
