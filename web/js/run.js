// Ejecución del modo CODE: la vista "Ejecutar" corre el PROYECTO ENTERO, no un archivo suelto.
// · Navegador y móvil: iframe aislado (sandbox, origen opaco) con todos los archivos montados como
//   sistema de archivos virtual: HTML con sus JS/CSS/módulos/fetch, JavaScript tipo Node, Python
//   (Pyodide), Batch (intérprete propio), Markdown y SVG.
// · Escritorio: además, cualquier lenguaje instalado en el PC (python, node, cmd, bash, gcc…), con permiso.
import { jcNorm, jcMime, jcCss, jcImports, jcStorage, jcFormat, jcConsole, jcBoot, jcRemote, jcRunNode, jcRunPython } from './sandbox.js';
import { jcBatch } from './batch.js';
import { renderMarkdown } from './md.js';

export const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

/** web: motor en el navegador · pc: el escritorio lo ejecuta con el programa instalado. */
export const LANGS = [
  { id: 'html', label: 'HTML', re: /\.html?$/i, web: 'html' },
  { id: 'markdown', label: 'Markdown', re: /\.(md|markdown)$/i, web: 'markdown' },
  { id: 'svg', label: 'SVG', re: /\.svg$/i, web: 'svg' },
  { id: 'python', label: 'Python', re: /\.pyw?$/i, web: 'python', pc: true },
  { id: 'node', label: 'JavaScript', re: /\.(m?js|cjs)$/i, web: 'node', pc: true },
  { id: 'typescript', label: 'TypeScript', re: /\.(m?ts|cts)$/i, pc: true },
  { id: 'batch', label: 'Batch', re: /\.(bat|cmd)$/i, web: 'batch', pc: true },
  { id: 'powershell', label: 'PowerShell', re: /\.ps1$/i, pc: true },
  { id: 'shell', label: 'Shell', re: /\.(sh|bash)$/i, pc: true },
  { id: 'ruby', label: 'Ruby', re: /\.rb$/i, pc: true },
  { id: 'php', label: 'PHP', re: /\.php$/i, pc: true },
  { id: 'lua', label: 'Lua', re: /\.lua$/i, pc: true },
  { id: 'perl', label: 'Perl', re: /\.pl$/i, pc: true },
  { id: 'r', label: 'R', re: /\.r$/i, pc: true },
  { id: 'go', label: 'Go', re: /\.go$/i, pc: true },
  { id: 'java', label: 'Java', re: /\.java$/i, pc: true },
  { id: 'c', label: 'C', re: /\.c$/i, pc: true },
  { id: 'cpp', label: 'C++', re: /\.(cpp|cc|cxx)$/i, pc: true },
  { id: 'rust', label: 'Rust', re: /\.rs$/i, pc: true },
  { id: 'dart', label: 'Dart', re: /\.dart$/i, pc: true },
  { id: 'swift', label: 'Swift', re: /\.swift$/i, pc: true },
  { id: 'kotlin', label: 'Kotlin', re: /\.kts$/i, pc: true },
];

export const langOf = (path) => (path ? LANGS.find((l) => l.re.test(path)) || null : null);

/** ¿Se puede ejecutar aquí? (en el navegador siempre que haya motor web; en escritorio también con el PC). */
export const canRun = (lang, { desktop = false } = {}) => !!lang && (!!lang.web || (desktop && !!lang.pc));

/** Rutas a las que apunta un archivo (src/href/import/require/url()/fetch con literal). */
export function refsOf(files, path) {
  const text = files[path];
  if (typeof text !== 'string') return [];
  const found = new Set();
  const add = (ref) => { const p = jcNorm(path, ref); if (p && p in files && p !== path) found.add(p); };
  if (/\.html?$/i.test(path)) {
    for (const m of text.matchAll(/\b(?:src|href|data|poster)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  }
  if (/\.(html?|m?js|cjs|jsx)$/i.test(path)) {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'`]([^"'`\n]+)["'`]/g)) add(m[1]);
    // fetch() y Worker resuelven contra la PÁGINA, que no se conoce aquí: se prueban ambas
    for (const m of text.matchAll(/(?:\bfetch\s*\(\s*|\bnew\s+Worker\s*\(\s*)["'`]([^"'`\n]+)["'`]/g)) { add(m[1]); const p = jcNorm('', m[1]); if (p && p in files && p !== path) found.add(p); }
  }
  if (/\.(html?|css)$/i.test(path)) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) add(m[1] || m[2]);
  }
  return [...found];
}

/** Archivos que necesita `entry` (cierre transitivo de referencias), incluida ella misma. */
export function dependencies(files, entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) for (const r of refsOf(files, queue.shift())) if (!seen.has(r)) { seen.add(r); queue.push(r); }
  return [...seen];
}

const DOCS = /\.(md|markdown|svg)$/i;
const ENTRY_NAMES = ['index.html', 'main.py', 'app.py', '__main__.py', 'main.bat', 'run.bat', 'start.bat', 'main.cmd', 'index.js', 'main.js', 'app.js', 'server.js',
  'main.ts', 'index.ts', 'main.go', 'Main.java', 'main.c', 'main.cpp', 'main.rs', 'main.rb', 'main.lua', 'index.php', 'main.sh', 'run.sh', 'README.md'];

/** Todos los archivos ejecutables del proyecto, los "de entrada" primero. */
export function runnableFiles(files, opts = {}) {
  const paths = Object.keys(files).filter((p) => canRun(langOf(p), opts));
  const rank = (p) => {
    const name = p.split('/').pop();
    const i = ENTRY_NAMES.indexOf(name);
    // documentos (Markdown, SVG) solo si no hay nada más que ejecutar
    return (i < 0 ? 100 : i) + (DOCS.test(p) ? 200 : 0) + p.split('/').length * 0.01;
  };
  return paths.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Qué se ejecuta cuando el usuario está mirando `selected`: el propio archivo si es ejecutable; si es
 * una dependencia (styles.css, script.js, datos.json…) la página HTML que la usa; si no, la entrada del proyecto.
 * opts: { desktop, explicit } (explicit = el usuario lo abrió a propósito: también Markdown/SVG).
 */
export function entryFor(files, selected, opts = {}) {
  const pages = Object.keys(files).filter((p) => /\.html?$/i.test(p));
  if (selected && selected in files) {
    if (!/\.html?$/i.test(selected) && !/\.(md|markdown)$/i.test(selected)) {
      const users = pages.filter((h) => dependencies(files, h).includes(selected));
      if (users.length) return users.sort((a, b) => a.split('/').length - b.split('/').length || (a.endsWith('index.html') ? -1 : 1))[0];
    }
    // un README abierto no le quita el sitio al programa, salvo que el usuario lo elija (explicit)
    if (canRun(langOf(selected), opts) && (opts.explicit || !DOCS.test(selected))) return selected;
  }
  return runnableFiles(files, opts)[0] || null;
}

/** Fuente de las funciones que se inyectan en el iframe (sin dependencias externas). */
const RUNTIME = [jcNorm, jcMime, jcCss, jcImports, jcStorage, jcFormat, jcConsole, jcBoot, jcRemote, jcRunNode, jcRunPython, jcBatch]
  .map(String).join('\n').replace(/<\/script/gi, '<\\/script');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const DOC_CSS = 'body{max-width:760px;margin:0 auto;padding:32px 20px;font:16px/1.65 system-ui,sans-serif;color:#111;background:#fff}'
  + 'pre{background:#f4f4f2;padding:12px;overflow:auto}code{font-family:ui-monospace,Consolas,monospace}img{max-width:100%}'
  + 'table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}.tb-head,.code-head button{display:none}';

/**
 * Documento (srcdoc) del iframe. mode 'remote' es la consola de un programa que corre en el PC.
 * Devuelve { srcdoc, mode, entry }.
 */
export function buildRunDoc(files, entry, { token, storage = {}, pyodide = PYODIDE_URL, remote = false, title = '', desktop = false } = {}) {
  const lang = langOf(entry);
  let mode = remote ? 'remote' : lang?.web || null;
  let all = files;
  let start = entry;
  if (mode === 'markdown' || mode === 'svg') {
    // página sintética junto al archivo: así sus imágenes y enlaces relativos también resuelven
    const dir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
    const name = entry.slice(dir.length);
    start = `${dir}.jeancode-vista-${name}.html`;
    const body = mode === 'svg'
      ? `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff"><img src="${name.replace(/"/g, '&quot;')}" alt="" style="max-width:100%;max-height:100vh"></body>`
      : `<body>${renderMarkdown(files[entry] || '')}</body>`;
    all = { ...files, [start]: `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${DOC_CSS}</style></head>${body}</html>` };
    mode = 'html';
  }
  if (!mode) return null;
  const opts = { token, mode, storage, pyodide, desktop, title: title || `${lang?.label || ''} · ${entry}` };
  const srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<script>${RUNTIME}\njcBoot(${json(remote ? {} : all)}, ${json(start)}, ${json(opts)});<\/script>`;
  return { srcdoc, mode, entry: start };
}
