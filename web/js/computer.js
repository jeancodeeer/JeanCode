// Control del equipo: catálogo de acciones del agente, niveles de riesgo y política de permisos.
// Un único sitio: el agente (agent.js) toma de aquí los esquemas y la documentación, la interfaz
// (app.js) los textos de permiso, y el escritorio (lib/computer) ejecuta. Ninguna acción se salta
// el permiso: low se ejecuta si el usuario lo permitió, medium pregunta (o una vez por tarea),
// high pregunta SIEMPRE.

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const XY = { x: int('x en píxeles de la última captura'), y: int('y en píxeles de la última captura') };

/** [nombre, riesgo, descripción para el modelo, esquema, texto para el usuario] */
const CATALOG = [
  ['screenshot', 'low', 'Captura la pantalla. Solo si tu modelo ve imágenes; si no, usa inspect_screen.', S({}), () => 'mirar la pantalla'],
  ['inspect_screen', 'low', 'Lista los controles de la ventana activa (id, tipo, nombre, valor, x, y). La forma más fiable de saber dónde hacer clic.', S({ max: int('máximo de elementos (150)') }), () => 'leer los controles de la ventana activa'],
  ['list_windows', 'low', 'Ventanas abiertas (título y proceso).', S({}), () => 'listar las ventanas abiertas'],
  ['focus_window', 'low', 'Trae al frente una ventana por parte de su título o proceso.', S({ title: str('texto del título o nombre del proceso') }, ['title']), (a) => `traer al frente «${a.title}»`],
  ['mouse_move', 'low', 'Mueve el ratón.', S(XY, ['x', 'y']), (a) => `mover el ratón a (${a.x}, ${a.y})`],
  ['mouse_click', 'low', 'Clic en coordenadas de la última captura.', S({ ...XY, button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean' } }, ['x', 'y']), (a) => `${a.double ? 'doble ' : ''}clic${a.button && a.button !== 'left' ? ` ${a.button === 'right' ? 'derecho' : 'central'}` : ''} en (${a.x}, ${a.y})`],
  ['click_element', 'low', 'Clic en un control por su id de inspect_screen (más fiable que coordenadas).', S({ id: int('id de inspect_screen'), button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean' } }, ['id']), (a) => `clic en el control ${a.id}`],
  ['mouse_drag', 'low', 'Arrastra con el botón izquierdo de (x,y) a (toX,toY).', S({ ...XY, toX: int('x destino'), toY: int('y destino') }, ['x', 'y', 'toX', 'toY']), (a) => `arrastrar de (${a.x}, ${a.y}) a (${a.toX}, ${a.toY})`],
  ['scroll', 'low', 'Rueda del ratón: clicks positivos = arriba, negativos = abajo.', S({ clicks: int('-30..30'), x: int('opcional'), y: int('opcional'), horizontal: { type: 'boolean' } }, ['clicks']), (a) => `desplazar ${a.clicks}`],
  ['type_text', 'low', 'Escribe texto en el control con el foco (teclado real). Nunca contraseñas.', S({ text: str('texto') }, ['text']), (a) => `escribir ${String(a.text ?? '').length} caracteres: «${preview(a.text)}»`],
  ['set_text', 'low', 'Pone el texto de un campo por su id de inspect_screen.', S({ id: int('id'), text: str('texto') }, ['id', 'text']), (a) => `escribir en el control ${a.id}: «${preview(a.text)}»`],
  ['key_press', 'medium', 'Pulsa una tecla o combinación, p. ej. ["enter"], ["ctrl","s"], ["alt","f4"].', S({ keys: { type: 'array', items: { type: 'string' } }, repeat: int('veces (1)') }, ['keys']), (a) => `pulsar ${keyLabel(a)}`],
  ['open_application', 'medium', 'Abre una aplicación, archivo o carpeta (p. ej. "notepad.exe", "wt", "explorer.exe", una ruta).', S({ target: str('programa, archivo o carpeta'), args: { type: 'array', items: { type: 'string' } } }, ['target']), (a) => `abrir «${a.target}»${a.args?.length ? ` ${a.args.join(' ')}` : ''}`],
  ['wait', 'low', 'Espera a que la interfaz cambie (ms, máx. 15000).', S({ ms: int('milisegundos') }), (a) => `esperar ${a.ms || 1000} ms`],
];

const preview = (t) => { const s = String(t ?? '').replace(/\s+/g, ' '); return s.length > 80 ? s.slice(0, 80) + '…' : s; };
const keyLabel = (a) => (Array.isArray(a.keys) ? a.keys.join('+') : String(a.keys || '')) + (a.repeat > 1 ? ` ×${a.repeat}` : '');

export const COMPUTER_TOOL_NAMES = CATALOG.map(([name]) => name);
const BY_NAME = Object.fromEntries(CATALOG.map(([name, risk, desc, schema, label]) => [name, { name, risk, desc, schema, label }]));

/** Atajos que pueden lanzar programas, cerrar ventanas o cambiar el sistema: siempre confirmación. */
const SENSITIVE_KEYS = /^(win|meta|cmd)$|^f4$/i;

/** Programas que ejecutan código arbitrario: abrirlos es riesgo alto (y con argumentos, más aún). */
const SHELL_TARGET = /(^|[\\/])(cmd|powershell|powershell_ise|pwsh|wt|windowsterminal|wsl|bash|sh|python|pythonw|py|node|cscript|wscript|mshta|rundll32|regsvr32|msiexec|reg|regedit|schtasks|sc|bitsadmin|certutil|curl|wget)(\.exe|\.com)?$/i;

/**
 * Nivel de riesgo real de una acción concreta. Sube según los argumentos y según la ventana activa
 * (env.terminal = la ventana activa es una terminal, según el escritorio): teclear ahí = ejecutar comandos.
 */
export function riskOf(tool, args = {}, env = {}) {
  const t = BY_NAME[tool];
  if (!t) return 'high';
  const inTerminal = env.terminal === true;
  if (INPUT_TOOLS.includes(tool) && inTerminal) return 'high'; // teclear, pegar (clic derecho/central) o clic en una terminal
  if (tool === 'key_press') {
    const keys = Array.isArray(args.keys) ? args.keys : String(args.keys || '').split('+');
    if (keys.some((k) => SENSITIVE_KEYS.test(String(k).trim()))) return 'high';
  }
  if ((tool === 'type_text' || tool === 'set_text') && /[\r\n]/.test(String(args.text ?? ''))) return 'medium'; // un salto de línea = Enter
  if (tool === 'open_application') {
    const target = String(args.target || '').trim();
    const extra = Array.isArray(args.args) ? args.args.join(' ') : '';
    if (SHELL_TARGET.test(target) || (Array.isArray(args.args) && args.args.length) || DESTRUCTIVE_COMMAND.test(`${target} ${extra}`)) return 'high';
  }
  return t.risk;
}

/** Acciones que entregan entrada a la ventana de destino. */
export const INPUT_TOOLS = ['type_text', 'set_text', 'key_press', 'mouse_click', 'click_element', 'mouse_drag'];

/** Clave de una aprobación "en esta tarea": la acción EXACTA, nunca solo el nombre de la herramienta. */
export const actionKey = (tool, args = {}) => `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`;

/** ¿Esta acción, con este riesgo, escribe en una terminal? (el escritorio exige una aprobación de un solo uso) */
export const needsTerminalApproval = (tool, env = {}) => INPUT_TOOLS.includes(tool) && env.terminal === true;

export const describeAction = (tool, args = {}) => (BY_NAME[tool] ? BY_NAME[tool].label(args) : tool);

/** Comandos de terminal destructivos o que cambian el sistema: confirmación siempre, aunque estén en la lista de permitidos. */
export const DESTRUCTIVE_COMMAND = /\b(rm\s+-[a-z]*[rf]|rmdir\s+\/s|del\s+\/[sfq]|rd\s+\/s|format(\.com)?\s+[a-z]:|diskpart|mkfs|dd\s+if=|shutdown|restart-computer|stop-computer|remove-item\b[^\n]*-recurse|reg(\.exe)?\s+(add|delete)|set-itemproperty\s+.*hk(lm|cu)|bcdedit|netsh\s+(advfirewall|firewall)|sc(\.exe)?\s+(delete|config)|takeown|icacls\s+.*\/(grant|remove)|cipher\s+\/w|vssadmin\s+delete|git\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+[^\n]*--force)|chmod\s+-R\s+777|:\(\)\s*\{)/i;

/**
 * Política de permisos (Ajustes → Control del equipo). Por nivel:
 *   allow  se ejecuta sin preguntar (solo low)
 *   task   pregunta la primera vez de cada acción en la tarea (medium)
 *   ask    pregunta cada vez (high siempre)
 */
export const DEFAULT_POLICY = { low: 'allow', medium: 'task', high: 'ask' };
export function normalizePolicy(p) {
  const out = { ...DEFAULT_POLICY, ...(p && typeof p === 'object' ? p : {}) };
  if (!['allow', 'ask'].includes(out.low)) out.low = 'allow';
  if (!['task', 'ask'].includes(out.medium)) out.medium = 'task';
  out.high = 'ask'; // nunca configurable
  return out;
}

/** Esquemas para function calling nativo. */
export const COMPUTER_SCHEMAS = CATALOG.map(([name, , description, parameters]) => ({ type: 'function', function: { name, description, parameters } }));

/** Herramientas de desarrollo del escritorio (procesos y archivos) que no son de pantalla. */
export const DEV_SCHEMAS = [
  ['start_process', 'Arranca un proceso de larga duración en segundo plano (servidor de desarrollo, watcher). Devuelve un id.', S({ command: str('comando') }, ['command'])],
  ['process_output', 'Últimas líneas de la salida de un proceso en segundo plano.', S({ id: str('id, p. ej. p1'), tail: int('caracteres (4000)') }, ['id'])],
  ['stop_process', 'Detiene un proceso en segundo plano y sus subprocesos.', S({ id: str('id') }, ['id'])],
  ['move_file', 'Mueve o renombra un archivo o carpeta dentro de la carpeta de trabajo (no sobrescribe).', S({ from: str('ruta relativa'), to: str('ruta relativa nueva') }, ['from', 'to'])],
  ['delete_file', 'Envía un archivo o carpeta a la papelera del sistema (recuperable). Pide confirmación siempre.', S({ path: str('ruta relativa') }, ['path'])],
].map(([name, description, parameters]) => ({ type: 'function', function: { name, description, parameters } }));

export const DEV_DOCS = `Procesos y archivos:
- start_process {"command": "npm run dev"}        proceso en segundo plano (servidores); devuelve un id
- process_output {"id": "p1"}                     últimas líneas de su salida
- stop_process {"id": "p1"}                       lo detiene con sus subprocesos
- move_file {"from": "a.txt", "to": "b/a.txt"}    mover o renombrar (no sobrescribe)
- delete_file {"path": "tmp.log"}                 a la papelera (recuperable); siempre pide confirmación`;

/** Instrucciones de control del equipo para el prompt de sistema. */
export function computerDocs({ native, vision, screen }) {
  const list = CATALOG.map(([name, , desc]) => `- ${name}: ${desc}`).join('\n');
  return `CONTROL DEL EQUIPO (activado por el usuario). Puedes operar esta PC con ratón y teclado reales.
Pantalla: ${screen ? `${screen.modelWidth}×${screen.modelHeight}` : 'desconocida'} (coordenadas de la captura; la esquina superior izquierda es 0,0).
${vision ? 'Ves imágenes: screenshot te devuelve la pantalla.' : 'Tu modelo NO ve imágenes: no uses screenshot; observa con inspect_screen y list_windows.'}
Método obligatorio, paso a paso: OBSERVA (inspect_screen${vision ? ' o screenshot' : ''}) → DECIDE → ACTÚA (una acción) → VERIFICA (el resultado trae la ventana activa; vuelve a observar si dudas).
- Prefiere click_element/set_text con ids de inspect_screen antes que coordenadas. Tras abrir o cambiar de ventana, inspecciona de nuevo: los ids cambian.
- Para escribir: enfoca la ventana correcta, haz clic en el campo y luego type_text. Atajos con key_press (["ctrl","s"]).
- Si algo no salió como esperabas, observa otra vez y corrige; no repitas a ciegas.
- NUNCA escribas contraseñas, datos de pago ni códigos de verificación; si una ventana los pide, detente y pregúntale al usuario.
- No operes la ventana de JeanCode. Para archivos y comandos usa read_file/write_file/run_command, que son más fiables que la interfaz gráfica.
- Si el usuario rechaza una acción o la tarea se detiene, no insistas.
${native ? '' : `Acciones disponibles (mismo formato de bloque tool):\n${list}`}`;
}
