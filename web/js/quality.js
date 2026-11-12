// Calidad de las respuestas y utilidades de la conversación (lógica pura, sin DOM: se prueba en tests/unit).

/** Reglas que van en el prompt de sistema de chat, código y agente: honestidad antes que apariencia. */
export const QUALITY_RULES = `PRINCIPIOS DE RESPUESTA:
- Si no sabes algo o no estás seguro, dilo claramente ("no lo sé", "no estoy seguro") y explica qué haría falta para saberlo. Una respuesta honesta incompleta vale más que una inventada.
- Para afirmaciones fácticas importantes, indica tu grado de confianza o de dónde sale el dato. Nunca inventes citas, autores, URLs, versiones ni referencias: si no tienes una fuente real, no pongas enlace.
- Tus datos tienen una fecha de corte: si algo puede haber cambiado (versiones, precios, noticias, leyes), avisa de que puede estar desactualizado.
- Para cálculos y cifras exactas, muestra el cálculo paso a paso o, si tienes herramientas, ejecútalo; no des un número de memoria.
- Mantén la coherencia con lo que ya dijiste en esta conversación; si cambias de opinión, dilo y explica por qué.
- Si la petición es ambigua y una mala interpretación costaría trabajo, haz UNA pregunta corta de aclaración antes de responder.
- Sé útil de verdad: no rellenes ni aparentes; no adules ni des la razón por complacer. Si el usuario se equivoca, díselo con respeto.
- Sin sermones ni avisos innecesarios. En temas médicos, legales o financieros con riesgo real, da la información útil y recomienda consultar a un profesional, una sola vez.
- Si no puedes ayudar con algo, explica el motivo en una frase y ofrece una alternativa segura.
- En traducciones, si hay matices o registros distintos, ofrece la variante principal y una nota breve con alternativas.
- Elige el formato según la tarea (prosa, lista, tabla o código); no uses siempre la misma estructura.`;

export const DIRECTNESS = {
  normal: '',
  direct: 'FRANQUEZA: muy directa. Ve al grano, señala errores y riesgos sin suavizarlos.',
  gentle: 'FRANQUEZA: amable. Señala los errores con tacto y explica con paciencia.',
};

export const LENGTH = {
  auto: 'LONGITUD: adapta la extensión a la tarea: breve para preguntas simples, completa y detallada para tareas complejas.',
  short: 'LONGITUD: respuestas cortas (unas pocas frases o líneas), salvo que el usuario pida más.',
  long: 'LONGITUD: respuestas completas y detalladas, con ejemplos y pasos; no recortes en tareas complejas.',
};

/** Bloque para el prompt de sistema según los ajustes del usuario. */
export function qualityPrompt({ directness = 'normal', length = 'auto' } = {}) {
  return [QUALITY_RULES, DIRECTNESS[directness] || '', LENGTH[length] || LENGTH.auto].filter(Boolean).join('\n');
}

/* ------------------------------------------------ datos sensibles antes de enviar */
const SECRET_PATTERNS = [
  ['clave de API', /\b(sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|nvapi-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|csk-[A-Za-z0-9]{20,}|fw_[A-Za-z0-9]{16,})\b/],
  ['token de GitHub', /\b(ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['clave de AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['clave privada', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['token JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['contraseña', /\b(password|passwd|contraseña|clave)\s*[:=]\s*\S{6,}/i],
  ['cadena de conexión con contraseña', /\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]{4,}@/i],
];

/** Luhn: distingue números de tarjeta reales de cualquier secuencia larga de dígitos. */
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Datos que conviene no enviar a un modelo remoto. Devuelve [{ kind, sample }] con la muestra enmascarada. */
export function detectSensitive(text) {
  const s = String(text || '');
  const out = [];
  const mask = (m) => (m.length <= 8 ? '***' : `${m.slice(0, 4)}…${m.slice(-2)}`);
  for (const [kind, re] of SECRET_PATTERNS) {
    const m = s.match(re);
    if (m) out.push({ kind, sample: mask(m[0]) });
  }
  for (const m of s.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) { out.push({ kind: 'número de tarjeta', sample: `…${digits.slice(-4)}` }); break; }
  }
  const iban = s.match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/);
  if (iban) out.push({ kind: 'IBAN', sample: mask(iban[0].replace(/\s/g, '')) });
  return out;
}

/* ------------------------------------------------ tablas y copiar */
const csvCell = (v) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Filas de texto → CSV (Excel/Sheets lo abren tal cual). */
export const rowsToCsv = (rows) => rows.map((r) => r.map((c) => csvCell(String(c ?? ''))).join(',')).join('\n');
/** Filas → tabla Markdown (la primera fila es la cabecera). */
export function rowsToMarkdown(rows) {
  if (!rows.length) return '';
  const line = (r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(rows[0]), `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

/** Texto plano de una respuesta en Markdown (para "copiar como texto"). */
export function markdownToText(md) {
  return String(md || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```[\w.+#-]*\n?/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .trim();
}

/** URLs http(s) de una respuesta (enlaces Markdown y sueltos), sin repetir. */
export function extractLinks(md) {
  const urls = new Set();
  for (const m of String(md || '').matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
  for (const m of String(md || '').matchAll(/(?<![\](])\bhttps?:\/\/[^\s<>)"'`]+/g)) urls.add(m[0].replace(/[.,;:!?]+$/, ''));
  return [...urls].slice(0, 20);
}

/* ------------------------------------------------ buscar conversaciones */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * Búsqueda de texto completo: todas las palabras deben aparecer (título o mensajes).
 * Devuelve [{ thread, snippet }] ordenado por coincidencias en el título y por fecha.
 */
export function searchThreads(threads, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return threads.map((t) => ({ thread: t, snippet: '' }));
  const out = [];
  for (const t of threads) {
    const title = fold(t.title);
    const body = (t.messages || []).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const hay = `${title}\n${fold(body)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const at = fold(body).indexOf(words[0]);
    const snippet = at >= 0 ? body.slice(Math.max(0, at - 30), at + 70).replace(/\s+/g, ' ').trim() : '';
    out.push({ thread: t, snippet, score: words.filter((w) => title.includes(w)).length });
  }
  return out.sort((a, b) => b.score - a.score || (b.thread.updated || 0) - (a.thread.updated || 0));
}

/** Exportación JSON de una conversación (sin el historial interno del agente). */
export function threadToJson(t, version) {
  return JSON.stringify({
    app: 'JeanCode', version, exported: new Date().toISOString(), title: t.title, mode: t.mode,
    messages: (t.messages || []).map((m) => ({ role: m.role, content: m.content, ...(m.model ? { model: m.model } : {}), ...(m.at ? { at: new Date(m.at).toISOString() } : {}) })),
  }, null, 2);
}

/**
 * ¿Un proxy está almacenando la respuesta en vez de transmitirla? (la respuesta llega de golpe al final)
 * stats: { firstByteMs, totalMs, reads, chars }
 */
export const looksBuffered = ({ firstByteMs = 0, totalMs = 0, reads = 0, chars = 0 } = {}) =>
  totalMs > 3000 && chars > 400 && reads <= 2 && firstByteMs > totalMs * 0.8;
