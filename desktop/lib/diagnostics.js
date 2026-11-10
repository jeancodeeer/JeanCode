// Diagnósticos de archivos para el agente (lo que un LSP le daría): errores de sintaxis con analizadores
// del sistema y, en modo profundo (deep, con permiso del usuario), lint y tipos con las herramientas
// que el propio proyecto tiene instaladas.
// Solo lee: nunca escribe en la carpeta (Python se valida con ast.parse, sin __pycache__), sin shell,
// y siempre con rutas resueltas dentro del espacio de trabajo.
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { inside } = require('./tools');

const MAX_LINES = 30;

/** Ejecuta sin shell; nunca lanza: devuelve { code, out, missing }. */
function runFile(cmd, args, { cwd, env, timeout = 20000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, env: { ...process.env, ...env }, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ missing: true, code: -1, out: '' });
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}`, timedOut: !!err?.killed });
    });
    if (input != null) child.stdin?.end(input); // el código va por stdin: nada se escribe en disco
  });
}

/** ¿Se carga como módulo ES? .mjs siempre, .cjs nunca; .js según package.json o si usa import/export. */
async function isModule(abs, src) {
  if (/\.mjs$/i.test(abs)) return true;
  if (/\.cjs$/i.test(abs)) return false;
  const usesEsm = /^\s*(import|export)\b/m.test(src);
  for (let dir = path.dirname(abs); ; dir = path.dirname(dir)) {
    try { return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).type === 'module' || usesEsm; } catch { /* sin package.json aquí */ }
    if (path.dirname(dir) === dir) return usesEsm;
  }
}

// node empaquetado en Electron: el mismo ejecutable hace de node con ELECTRON_RUN_AS_NODE
const NODE = [process.execPath, { ELECTRON_RUN_AS_NODE: '1' }];

/** Quita la ruta absoluta (y su forma con / ) para que el informe use la ruta relativa. */
function tidy(out, abs, rel) {
  return out.split(abs).join(rel).split(abs.replace(/\\/g, '/')).join(rel)
    .split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/^\(node:\d+\) |^\(Use `node --trace/.test(l)).slice(0, MAX_LINES).join('\n');
}

const PY_CHECK = 'import ast,sys\nsrc=open(sys.argv[1],encoding="utf-8").read()\ntry:\n ast.parse(src,sys.argv[1])\nexcept SyntaxError as e:\n print(f"{e.lineno}:{e.offset}: {e.msg}");sys.exit(1)';
const PS_CHECK = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:JC_DIAG_FILE,[ref]$null,[ref]$e);foreach($x in $e){"$($x.Extent.StartLineNumber):$($x.Extent.StartColumnNumber): $($x.Message)"};if($e.Count){exit 1}';

/** Verificadores rápidos de sintaxis, por extensión. Cada uno devuelve { tool, ok, out } o null si no aplica. */
const SYNTAX = [
  { re: /\.(m?js|cjs)$/i, tool: 'node --check', run: async (abs) => {
    // un .js con import/export (o en un paquete "type": "module") se comprueba como módulo ES
    const src = await fs.readFile(abs, 'utf8');
    if (!(await isModule(abs, src))) return runFile(NODE[0], ['--check', abs], { env: NODE[1] });
    const r = await runFile(NODE[0], ['--input-type=module', '--check'], { env: NODE[1], input: src });
    return { ...r, out: r.out.split('[stdin]').join(abs) };
  } },
  { re: /\.json$/i, tool: 'JSON.parse', run: async (abs) => {
    const src = await fs.readFile(abs, 'utf8');
    try { JSON.parse(src.replace(/^\uFEFF/, '')); return { code: 0, out: '' }; } catch (e) {
      const pos = Number((e.message.match(/position (\d+)/) || [])[1]);
      const line = Number.isFinite(pos) ? src.slice(0, pos).split('\n').length : '?';
      return { code: 1, out: `${line}: ${e.message}` };
    }
  } },
  { re: /\.pyw?$/i, tool: 'python ast', run: async (abs) => {
    for (const py of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
      const r = await runFile(py, ['-c', PY_CHECK, abs]);
      // el alias de la Microsoft Store existe pero no es Python: se reconoce por su mensaje
      if (!r.missing && !/Microsoft Store|was not found/i.test(r.out)) return r;
    }
    return { missing: true };
  } },
  { re: /\.(ps1|psm1)$/i, tool: 'PowerShell parser', run: (abs) => runFile(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', PS_CHECK], { env: { JC_DIAG_FILE: abs } }) },
  { re: /\.(sh|bash)$/i, tool: 'bash -n', run: (abs) => runFile('bash', ['-n', abs]) },
  { re: /\.go$/i, tool: 'gofmt -e', run: async (abs) => { const r = await runFile('gofmt', ['-e', '-l', abs]); return { ...r, code: /:\d+:\d+:/.test(r.out) ? 1 : r.code }; } },
];
// SEGURIDAD: la lista de arriba solo usa analizadores del sistema/la app. Nada del proyecto (node_modules,
// configuraciones) se carga aquí: un repositorio no confiable no puede ejecutar código con solo abrirlo
// o con una edición del agente. Lo que usa herramientas del proyecto está en deepChecks y requiere permiso.

// sintaxis TypeScript con el typescript DEL PROYECTO, en un proceso aparte (solo en deep, con permiso)
const TS_SYNTAX = 'const ts=require(process.env.JC_TS);const f=process.env.JC_DIAG_FILE;const o=ts.transpileModule(require("fs").readFileSync(f,"utf8"),{reportDiagnostics:true,fileName:f,compilerOptions:{jsx:1}});for(const d of o.diagnostics||[]){const p=d.file&&d.start!=null?d.file.getLineAndCharacterOfPosition(d.start):null;console.log((p?(p.line+1)+":"+(p.character+1):"?")+": "+ts.flattenDiagnosticMessageText(d.messageText," "))}process.exitCode=(o.diagnostics||[]).length?1:0';

/**
 * Análisis profundo con las herramientas del PROYECTO (TypeScript, ESLint, tsc). Ejecuta código del
 * repositorio (sus paquetes y su eslint.config.js): el agente lo pide con permiso, como un comando.
 */
async function deepChecks(abs, rel, root) {
  const out = [];
  const bin = (p) => path.join(root, 'node_modules', ...p.split('/'));
  if (/\.(tsx?|mts|cts)$/i.test(abs) && fss.existsSync(bin('typescript/package.json'))) {
    const r = await runFile(NODE[0], ['-e', TS_SYNTAX], { cwd: root, env: { ...NODE[1], JC_TS: bin('typescript'), JC_DIAG_FILE: abs }, timeout: 60000 });
    out.push({ tool: 'TypeScript (sintaxis)', ok: r.code === 0, out: tidy(r.out, abs, rel) });
  }
  if (/\.(m?[jt]sx?|cjs|cts|mts)$/i.test(abs) && fss.existsSync(bin('eslint/bin/eslint.js'))) {
    const r = await runFile(NODE[0], [bin('eslint/bin/eslint.js'), '--format', 'unix', abs], { cwd: root, env: NODE[1], timeout: 60000 });
    out.push({ tool: 'eslint', ok: r.code === 0, out: tidy(r.out, abs, rel) });
  }
  if (/\.(tsx?|mts|cts)$/i.test(abs) && fss.existsSync(bin('typescript/bin/tsc')) && fss.existsSync(path.join(root, 'tsconfig.json'))) {
    const r = await runFile(NODE[0], [bin('typescript/bin/tsc'), '--noEmit', '--pretty', 'false', '-p', root], { cwd: root, env: NODE[1], timeout: 120000 });
    const mine = r.out.split(/\r?\n/).filter((l) => l.replace(/\\/g, '/').includes(rel.replace(/\\/g, '/')));
    out.push({ tool: 'tsc --noEmit', ok: !mine.length, out: mine.slice(0, MAX_LINES).join('\n') + (r.timedOut ? '\n(tsc tardó demasiado: resultado parcial)' : '') });
  }
  return out;
}

/**
 * Diagnósticos de un archivo del espacio de trabajo.
 * auto=true (tras cada edición): solo sintaxis rápida y '' si no hay verificador o no está instalado.
 */
async function diagnose(root, rel, { deep = false, auto = false } = {}) {
  const abs = await inside(root, rel);
  const base = await fs.realpath(root);
  const shown = path.relative(base, abs).replace(/\\/g, '/');
  if (!fss.existsSync(abs)) return auto ? '' : `ERROR: no existe ${shown}`;
  const checker = SYNTAX.find((c) => c.re.test(abs));
  const results = [];
  if (checker) {
    const r = await checker.run(abs, base);
    if (r.missing) { if (!auto) results.push({ tool: checker.tool, missing: true }); }
    else results.push({ tool: checker.tool, ok: r.code === 0, out: tidy(r.out, abs, shown) });
  }
  if (deep) results.push(...await deepChecks(abs, shown, base));
  if (!results.length) {
    return auto ? '' : `DIAGNÓSTICOS ${shown}: no hay verificador para este tipo de archivo (se admiten .js .mjs .cjs .json .py .ps1 .sh .go; con deep, y con permiso, TypeScript, ESLint y tsc del proyecto).`;
  }
  return results.map((r) => (r.missing
    ? `DIAGNÓSTICOS ${shown} (${r.tool}): la herramienta no está instalada en esta PC.`
    : r.ok ? `DIAGNÓSTICOS ${shown} (${r.tool}): sin errores.`
      : `DIAGNÓSTICOS ${shown} (${r.tool}): HAY ERRORES — corrígelos antes de seguir:\n${r.out || '(sin detalle)'}`)).join('\n');
}

module.exports = { diagnose };
