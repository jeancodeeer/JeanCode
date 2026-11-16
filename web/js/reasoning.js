// Modo de razonamiento por modelo: NORMAL, PENSAR (encender/apagar la fase de pensar) o ESFUERZO
// (bajo/medio/alto). Cada proveedor lo pide de una forma distinta; aquí se decide qué ofrece cada
// modelo y cómo se traduce en la petición. Lo que no se sabe no se ofrece (solo NORMAL).
import { providerOf, supportsThinkToggle } from './providers.js';

export const MODES = {
  normal: { label: 'Normal', short: 'NORMAL', title: 'Responde directamente: lo más rápido' },
  think: { label: 'Pensar', short: 'PENSAR', title: 'Razona antes de responder: mejor en tareas difíciles, más lento' },
  minimal: { label: 'Esfuerzo mínimo', short: 'MÍNIMO', title: 'Razona lo justo' },
  low: { label: 'Esfuerzo bajo', short: 'BAJO', title: 'Razona poco: rápido' },
  medium: { label: 'Esfuerzo medio', short: 'MEDIO', title: 'Equilibrio entre calidad y velocidad' },
  high: { label: 'Esfuerzo alto', short: 'ALTO', title: 'Razona a fondo: lo mejor en problemas difíciles, lo más lento' },
};

const id = (model) => String(model || '').toLowerCase().replace(/^.*\//, '');
// Modelos que razonan con nivel de esfuerzo (reasoning_effort de OpenAI y compatibles)
const OPENAI_EFFORT = /^(o[134](-|$)|gpt-5|codex-)/;
const GPT_OSS = /gpt-oss/;
const GROK_MINI = /^grok-3-mini/;
const GEMINI_THINK = /^gemini-(2\.5|3)/;
const CLAUDE_THINK = /^claude-(3-7|(opus|sonnet|haiku)-4|4|opus-5|sonnet-5|haiku-5|fable)/;
const QWEN_HYBRID = /qwen3(?!.*(instruct|coder))|qwq/;
// Razonan siempre y no se puede regular: solo se muestra su razonamiento
const ALWAYS = /deepseek-(r1|reasoner)|magistral|-thinking/;

/**
 * Cómo pide razonamiento este modelo: { style, modes } donde style es
 *   'toggle'     llama-server/Jean: chat_template_kwargs.enable_thinking
 *   'qwen'       DashScope/otros con enable_thinking en el cuerpo
 *   'effort'     reasoning_effort (OpenAI, Gemini, Groq, xAI, gpt-oss en cualquier proveedor)
 *   'openrouter' reasoning: { effort }
 *   'anthropic'  thinking: { type: 'enabled', budget_tokens }
 *   null         nada que elegir
 */
export function reasoningOf(ep, model, caps = {}) {
  const p = providerOf(ep).id;
  const m = id(model);
  if (supportsThinkToggle(ep)) return { style: 'toggle', modes: ['normal', 'think'] };
  if (p === 'openrouter' && (caps.reasoning || OPENAI_EFFORT.test(m) || GPT_OSS.test(m) || CLAUDE_THINK.test(m) || GEMINI_THINK.test(m) || GROK_MINI.test(m))) {
    return { style: 'openrouter', modes: ['normal', 'low', 'medium', 'high'] };
  }
  if (p === 'anthropic' && CLAUDE_THINK.test(m)) return { style: 'anthropic', modes: ['normal', 'low', 'medium', 'high'] };
  if (OPENAI_EFFORT.test(m) && (p === 'openai' || p === 'custom' || p === 'litellm')) {
    // los o-series y gpt-5 siempre razonan: lo regulable es cuánto (gpt-5 admite además "minimal")
    return { style: 'effort', modes: /^gpt-5(?!.*chat)/.test(m) ? ['minimal', 'low', 'medium', 'high'] : ['low', 'medium', 'high'], always: true };
  }
  if (GPT_OSS.test(m)) return { style: 'effort', modes: ['low', 'medium', 'high'], always: true };
  if (p === 'gemini' && GEMINI_THINK.test(m)) return { style: 'effort', modes: /flash/.test(m) ? ['normal', 'low', 'medium', 'high'] : ['low', 'medium', 'high'], always: !/flash/.test(m) };
  if (p === 'xai' && GROK_MINI.test(m)) return { style: 'effort', modes: ['low', 'high'], always: true };
  if (QWEN_HYBRID.test(m) && ['dashscope', 'siliconflow', 'groq'].includes(p)) return { style: p === 'groq' ? 'groq-qwen' : 'qwen', modes: ['normal', 'think'] };
  if (ALWAYS.test(m)) return { style: null, modes: [], always: true };
  return { style: null, modes: [] };
}

/** El modo guardado, o el más parecido que este modelo admite. */
export function resolveMode(wanted, info) {
  const modes = info.modes || [];
  if (!modes.length) return null;
  if (modes.includes(wanted)) return wanted;
  const level = { normal: 0, minimal: 1, low: 1, think: 2, medium: 2, high: 3 }[wanted] ?? 0;
  if (level === 0) return modes[0];
  if (modes.includes('think')) return 'think';
  return modes.find((x) => ({ minimal: 1, low: 1, medium: 2, high: 3 }[x] ?? 0) >= level) || modes[modes.length - 1];
}

const BUDGET = { minimal: 1024, low: 2048, medium: 8192, high: 24576 };

/** Ajusta el cuerpo de la petición. mode: 'normal' | 'think' | 'minimal' | 'low' | 'medium' | 'high'. */
export function applyReasoning(payload, ep, model, mode, caps = {}) {
  if (!mode) return payload;
  const info = reasoningOf(ep, model, caps);
  const m = resolveMode(mode, info);
  if (!m || !info.style) return payload;
  const out = { ...payload };
  switch (info.style) {
    case 'toggle': out.chat_template_kwargs = { ...(out.chat_template_kwargs || {}), enable_thinking: m !== 'normal' }; break;
    case 'qwen': out.enable_thinking = m !== 'normal'; break;
    case 'groq-qwen': out.reasoning_effort = m === 'normal' ? 'none' : 'default'; break;
    case 'effort':
      if (m === 'normal') { if (providerOf(ep).id === 'gemini') out.reasoning_effort = 'none'; }
      else { out.reasoning_effort = m; delete out.temperature; } // los modelos de razonamiento de OpenAI rechazan temperature
      break;
    case 'openrouter': if (m !== 'normal') out.reasoning = { effort: m === 'minimal' ? 'low' : m }; break;
    case 'anthropic':
      if (m !== 'normal') {
        out.thinking = { type: 'enabled', budget_tokens: BUDGET[m] || BUDGET.medium };
        out.max_tokens = Math.max(out.max_tokens || 0, out.thinking.budget_tokens + 8192);
        delete out.temperature; // con razonamiento Anthropic exige la temperatura por defecto
      }
      break;
    default: break;
  }
  return out;
}

/** Texto corto para el botón: "PENSAR", "ALTO"… */
export const modeShort = (m) => (MODES[m] ? MODES[m].short : 'NORMAL');
