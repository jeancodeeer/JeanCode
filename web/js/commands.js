// Comandos "/" del composer (estilo Claude Code / OpenCode).
// modes: en qué modos aparece. Los comandos propios del proyecto vienen de .jeancode/commands/*.md (escritorio).
export const BUILTIN = [
  { name: 'new', desc: 'Nueva conversación', modes: ['chat', 'code', 'agent'] },
  { name: 'clear', desc: 'Vacía la conversación actual', modes: ['chat', 'code', 'agent'] },
  { name: 'compact', desc: 'Resume la conversación para liberar contexto', modes: ['chat', 'code', 'agent'] },
  { name: 'model', desc: 'Cambia de modelo: /model jean-marvel', modes: ['chat', 'code', 'agent'], arg: true },
  { name: 'export', desc: 'Descarga la conversación en Markdown', modes: ['chat', 'code', 'agent'] },
  { name: 'help', desc: 'Comandos y atajos de teclado', modes: ['chat', 'code', 'agent'] },
  { name: 'zip', desc: 'Descarga el proyecto en .zip', modes: ['code'] },
  { name: 'init', desc: 'Analiza la carpeta y crea AGENTS.md con la memoria del proyecto', modes: ['agent'] },
  { name: 'plan', desc: 'Agente PLAN: solo analiza y propone (Tab alterna)', modes: ['agent'] },
  { name: 'build', desc: 'Agente BUILD: implementa los cambios (Tab alterna)', modes: ['agent'] },
  { name: 'undo', desc: 'Deshace el último archivo que cambió el agente', modes: ['agent'] },
  { name: 'review', desc: 'Revisa los cambios sin commitear (git diff)', modes: ['agent'] },
];

export const PROMPTS = {
  init: `Analiza esta carpeta de trabajo (estructura, lenguajes, cómo se instala, cómo se ejecutan las pruebas, convenciones de código) y crea o actualiza AGENTS.md en la raíz con: resumen del proyecto, comandos de build/test/lint, estructura principal, convenciones y reglas importantes. Breve y concreto: es la memoria que leerás en cada sesión.`,
  review: `Revisa los cambios sin commitear: ejecuta "git status" y "git diff". Busca bugs, casos borde, problemas de seguridad y código que sobre. Responde con hallazgos ordenados por gravedad, cada uno con archivo:línea y una corrección propuesta. No modifiques archivos.`,
  compact: `Resume la conversación anterior para continuar en un contexto nuevo. Conserva: objetivo del usuario, decisiones tomadas, archivos y rutas relevantes, estado actual, pendientes y cualquier dato exacto (nombres, comandos, errores). Formato: viñetas breves en español. No agregues nada que no esté en la conversación.`,
};

export function matchCommands(query, mode, custom = []) {
  const q = query.toLowerCase();
  const all = [
    ...BUILTIN.filter((c) => c.modes.includes(mode)),
    ...(mode === 'agent' ? custom.map((c) => ({ name: c.name, desc: c.description || 'comando del proyecto', custom: true })) : []),
  ];
  return all.filter((c) => c.name.startsWith(q)).slice(0, 12);
}

/** "/model jean-grey" -> { name: 'model', args: 'jean-grey' } */
export function parseCommand(text) {
  const m = text.trim().match(/^\/([\w-]+)\s*([\s\S]*)$/);
  return m ? { name: m[1].toLowerCase(), args: m[2].trim() } : null;
}

/** Plantilla de comando propio: $ARGUMENTS se reemplaza por lo escrito tras el comando. */
export function expandCustom(body, args) {
  return body.includes('$ARGUMENTS') ? body.replace(/\$ARGUMENTS/g, args) : (args ? `${body}\n\n${args}` : body);
}

/** Estimación de tokens (≈ 3.6 caracteres por token en texto mixto español/código). */
export const estimateTokens = (messages) => Math.round(messages.reduce((s, m) => s + (m.content?.length || 0), 0) / 3.6);
export const CONTEXT_LIMIT = 131072;
