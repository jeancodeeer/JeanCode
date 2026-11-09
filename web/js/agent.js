// Agente local (solo escritorio). Protocolo de herramientas por texto, independiente de que el
// servidor tenga tool-calling nativo: el modelo escribe bloques ```tool {json}``` y recibe resultados.
import { chatStream } from './api.js';

const TOOL_RE = /```tool\s*\n([\s\S]*?)```/g;
const MAX_STEPS = 30;
const SUB_MAX_STEPS = 12;
const MAX_RESULT = 12000;

const TOOL_DOCS = `HERRAMIENTAS (escribe un bloque por llamada; puedes poner varios en un mismo mensaje):
\`\`\`tool
{"tool": "nombre", "args": { ... }}
\`\`\`
- list_dir {"path": "."}                       lista una carpeta del espacio de trabajo
- read_file {"path": "a.js", "offset": 0, "limit": 400}   lee líneas de un archivo
- search {"pattern": "regex", "path": "."}     busca texto en los archivos
- write_file {"path": "a.js", "content": "..."} crea o reemplaza un archivo completo
- edit_file {"path": "a.js", "old": "texto exacto", "new": "reemplazo"}  reemplazo único
- run_command {"command": "npm test", "timeout": 120}   ejecuta en la terminal (cwd = espacio de trabajo)
- system_info {}                               sistema operativo, CPU, RAM, herramientas instaladas
- spawn_subagent {"task": "instrucción completa", "write": false}  lanza un subagente con contexto propio;
    varios spawn_subagent en un mismo mensaje corren en paralelo. Devuelve su informe final.
- load_skill {"name": "nombre"}                carga las instrucciones completas de una skill
Tras cada bloque recibirás "RESULTADO". Cuando termines, responde sin bloques tool con un resumen.`;

export function agentSystem({ workspace, os, skills, mode, sub }) {
  const skillList = skills.length
    ? skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
    : '(ninguna instalada)';
  return `Eres Jean, un agente de programación que trabaja en la PC del usuario${sub ? ' como SUBAGENTE de otro agente' : ''}.
Espacio de trabajo: ${workspace}
Sistema: ${os}
Modo de permisos: ${mode === 'plan' ? 'SOLO LECTURA (no escribas ni ejecutes)' : mode === 'auto-edit' ? 'puedes editar archivos; los comandos piden permiso' : 'cada escritura y comando pide permiso al usuario'}
Trabaja paso a paso: inspecciona antes de cambiar, haz cambios pequeños y verifica.
Si el usuario rechaza una acción, no la repitas: propone otra cosa o pregunta.

${TOOL_DOCS}

SKILLS INSTALADAS (usa load_skill cuando una aplique):
${skillList}`;
}

export function parseToolCalls(text) {
  const calls = [];
  for (const m of text.matchAll(TOOL_RE)) {
    try {
      const j = JSON.parse(m[1].trim());
      if (j && typeof j.tool === 'string') calls.push({ tool: j.tool, args: j.args || {} });
    } catch {
      calls.push({ tool: '__invalid', args: { raw: m[1].slice(0, 300) } });
    }
  }
  return calls;
}

const clip = (s) => {
  s = typeof s === 'string' ? s : JSON.stringify(s, null, 2);
  return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + `\n…(recortado, ${s.length} caracteres en total)` : s;
};

/**
 * ctx: { ep, model, desktop, workspace, mode, confirm(title, body) => Promise<bool>,
 *        onEvent({type, ...}), signal }
 */
export async function runAgent(ctx, messages, { sub = false } = {}) {
  const d = ctx.desktop;
  const limit = sub ? SUB_MAX_STEPS : MAX_STEPS;

  const exec = async (call) => {
    const { tool, args } = call;
    const writes = ['write_file', 'edit_file'].includes(tool);
    const runs = tool === 'run_command';
    if (tool === '__invalid') return 'ERROR: el bloque tool no es JSON válido: ' + args.raw;
    if ((writes || runs) && ctx.mode === 'plan') return 'DENEGADO: modo solo lectura.';
    if (sub && (writes || runs) && !ctx.subWrite) return 'DENEGADO: este subagente es de solo lectura.';
    if (runs || (writes && ctx.mode === 'ask')) {
      const detail = runs ? `$ ${args.command}` : `${tool} → ${args.path}\n\n${(args.content ?? args.new ?? '').slice(0, 1500)}`;
      const ok = await ctx.confirm(runs ? 'EJECUTAR COMANDO' : 'MODIFICAR ARCHIVO', detail);
      if (!ok) return 'RECHAZADO por el usuario.';
    }
    try {
      switch (tool) {
        case 'list_dir': return clip(await d.fs.list(ctx.workspace, args.path || '.'));
        case 'read_file': return clip(await d.fs.read(ctx.workspace, args.path, args.offset || 0, args.limit || 400));
        case 'search': return clip(await d.fs.search(ctx.workspace, args.pattern, args.path || '.'));
        case 'write_file': return clip(await d.fs.write(ctx.workspace, args.path, String(args.content ?? '')));
        case 'edit_file': return clip(await d.fs.edit(ctx.workspace, args.path, String(args.old ?? ''), String(args.new ?? '')));
        case 'run_command': return clip(await d.shell.run(ctx.workspace, String(args.command), Math.min(+args.timeout || 120, 1800)));
        case 'system_info': return clip(await d.system.info());
        case 'load_skill': return clip(await d.skills.read(String(args.name)));
        case 'spawn_subagent': {
          if (sub) return 'DENEGADO: un subagente no puede lanzar otros subagentes.';
          ctx.onEvent({ type: 'subagent-start', task: args.task });
          const subCtx = { ...ctx, subWrite: !!args.write, onEvent: (e) => ctx.onEvent({ ...e, nested: true }) };
          const report = await runAgent(subCtx, [
            { role: 'system', content: agentSystem({ ...ctx.sys, sub: true }) },
            { role: 'user', content: String(args.task) },
          ], { sub: true });
          ctx.onEvent({ type: 'subagent-end', task: args.task, report });
          return clip('INFORME DEL SUBAGENTE:\n' + report);
        }
        default: return `ERROR: herramienta desconocida "${tool}".`;
      }
    } catch (e) {
      return 'ERROR: ' + (e.message || String(e));
    }
  };

  for (let step = 0; step < limit; step++) {
    let text = '';
    let reasoning = '';
    ctx.onEvent({ type: 'assistant-start', sub });
    text = await chatStream({
      ep: ctx.ep, model: ctx.model, messages, signal: ctx.signal,
      onDelta: (t) => { text += t; ctx.onEvent({ type: 'assistant-delta', text, reasoning, sub }); },
      onReasoning: (t) => { reasoning += t; ctx.onEvent({ type: 'assistant-delta', text, reasoning, sub }); },
    });
    messages.push({ role: 'assistant', content: text });
    ctx.onEvent({ type: 'assistant-end', text, reasoning, sub });

    const calls = parseToolCalls(text);
    if (!calls.length) return text;

    // Los subagentes del mismo mensaje corren en paralelo; el resto, en orden.
    const results = new Array(calls.length);
    const subIdx = calls.map((c, i) => (c.tool === 'spawn_subagent' ? i : -1)).filter((i) => i >= 0);
    await Promise.all(subIdx.map(async (i) => { results[i] = await exec(calls[i]); }));
    for (let i = 0; i < calls.length; i++) {
      if (results[i] !== undefined) continue;
      ctx.onEvent({ type: 'tool-start', call: calls[i], sub });
      results[i] = await exec(calls[i]);
      ctx.onEvent({ type: 'tool-end', call: calls[i], result: results[i], sub });
    }
    messages.push({
      role: 'user',
      content: calls.map((c, i) => `RESULTADO ${c.tool}:\n${results[i]}`).join('\n\n'),
    });
  }
  return `(Se alcanzó el límite de ${limit} pasos. Pide que continúe si hace falta.)`;
}
