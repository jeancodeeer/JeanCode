// Ejecución del modo CODE en el PC: copia TODO el proyecto a una carpeta temporal propia y lo ejecuta
// con el programa instalado (python, node, cmd, bash, gcc…). Los comandos los decide este archivo a
// partir del lenguaje; la interfaz solo elige archivo y lenguaje, y pide permiso antes (confirm).
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inside, killTree } = require('./tools');

const isWin = process.platform === 'win32';
const EXE = isWin ? '.exe' : '';
const MAX_RUNS = 4;
const MAX_FILES = 2000;
const MAX_BYTES = 50 * 1024 * 1024;

const sameDir = (files, entry, re) => {
  const dir = path.posix.dirname(entry);
  return Object.keys(files).filter((p) => path.posix.dirname(p) === dir && re.test(p)).map((p) => path.posix.basename(p)).sort();
};
const rel = (entry) => path.posix.basename(entry);
// [alternativas] por paso: se prueba la siguiente si el programa no está instalado (ENOENT)
const step = (...alts) => alts.map(([cmd, ...args]) => ({ cmd, args }));

/** Pasos para ejecutar `entry` según el lenguaje. cwd = carpeta del archivo dentro de la copia. */
function stepsFor(lang, entry, files) {
  const f = rel(entry);
  const base = f.replace(/\.[^.]+$/, '');
  const out = `./jeancode-run${EXE}`;
  switch (lang) {
    case 'python': return [step(...(isWin ? [['python', '-u', f], ['py', '-3', '-u', f]] : [['python3', '-u', f], ['python', '-u', f]]))];
    case 'node': return [step(['node', f])];
    case 'typescript': return [step(['node', '--experimental-strip-types', '--no-warnings', f], ['deno', 'run', '-A', f], ['bun', f])];
    case 'batch':
      if (!isWin) return null;
      // chcp 65001: acentos bien; /s quita las comillas exteriores y respeta las interiores
      return [[{ cmd: 'cmd.exe', args: ['/d', '/s', '/c', `"chcp 65001 >nul & call "${f}""`], verbatim: true }]];
    case 'powershell': return [step(...(isWin ? [['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], ['pwsh', '-NoProfile', '-File', f]] : [['pwsh', '-NoProfile', '-File', f]]))];
    case 'shell': return [step(['bash', f], ['sh', f])];
    case 'ruby': return [step(['ruby', f])];
    case 'php': return [step(['php', f])];
    case 'lua': return [step(['lua', f], ['lua5.4', f], ['luajit', f])];
    case 'perl': return [step(['perl', f])];
    case 'r': return [step(['Rscript', f])];
    case 'dart': return [step(['dart', 'run', f])];
    case 'swift': return [step(['swift', f])];
    case 'kotlin': return [step(['kotlinc', '-script', f])];
    case 'go': {
      const hasMod = Object.keys(files).some((p) => p === path.posix.join(path.posix.dirname(entry), 'go.mod').replace(/^\.\//, ''));
      return [step(['go', 'run', ...(hasMod ? ['.'] : sameDir(files, entry, /\.go$/i).filter((x) => !/_test\.go$/i.test(x)))])];
    }
    case 'java': {
      const pkg = (String(files[entry]).match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
      return [step(['javac', '-encoding', 'UTF-8', '-d', 'jeancode-classes', ...sameDir(files, entry, /\.java$/i)]), step(['java', '-cp', 'jeancode-classes', pkg ? `${pkg}.${base}` : base])];
    }
    case 'c': { const src = sameDir(files, entry, /\.c$/i); return [step(['gcc', ...src, '-o', out, '-lm'], ['clang', ...src, '-o', out, '-lm'], ['cc', ...src, '-o', out]), step([out])]; }
    case 'cpp': { const src = sameDir(files, entry, /\.(cpp|cc|cxx)$/i); return [step(['g++', '-std=c++17', ...src, '-o', out], ['clang++', '-std=c++17', ...src, '-o', out]), step([out])]; }
    case 'rust': {
      const cargo = Object.keys(files).find((p) => /(^|\/)Cargo\.toml$/.test(p));
      if (cargo) return [step(['cargo', 'run', '--quiet', '--manifest-path', path.posix.relative(path.posix.dirname(entry), cargo) || 'Cargo.toml'])];
      return [step(['rustc', f, '-o', out]), step([out])];
    }
    default: return null;
  }
}

const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const show = (s) => (s.verbatim ? `${s.cmd} ${s.args.join(' ')}` : [s.cmd, ...s.args].map(quote).join(' '));

/** Lo que se va a ejecutar, para el cuadro de permiso. */
function plan({ files = {}, entry, lang }) {
  const steps = stepsFor(lang, entry, files);
  if (!steps) return { ok: false, reason: lang === 'batch' ? 'los .bat solo se ejecutan con cmd.exe en Windows' : `no hay ejecutor de ${lang} en el PC` };
  return { ok: true, command: steps.map((alts) => show(alts[0])).join(' && '), cwd: path.posix.dirname(entry) };
}

const runs = new Map(); // id -> { child, dir, stopped }
let seq = 0;

async function writeProject(dir, files) {
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) throw new Error(`demasiados archivos (${entries.length}; máximo ${MAX_FILES})`);
  let bytes = 0;
  for (const [p, content] of entries) {
    bytes += Buffer.byteLength(String(content));
    if (bytes > MAX_BYTES) throw new Error('el proyecto pesa demasiado para ejecutarlo (máx. 50 MB)');
    const file = await inside(dir, p); // nunca fuera de la carpeta temporal
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(content));
  }
}

/** Arranca la ejecución. send(id, evento): { type: 'out', text, err } | { type: 'missing', cmd } | { type: 'exit', code }. */
async function start({ files = {}, entry, lang }, send) {
  const steps = stepsFor(lang, entry, files);
  if (!steps) throw new Error(plan({ files, entry, lang }).reason);
  if (!(entry in files)) throw new Error(`no existe ${entry}`);
  if (runs.size >= MAX_RUNS) stop(runs.keys().next().value); // la más antigua
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jeancode-run-'));
  await writeProject(dir, files);
  const cwd = await inside(dir, path.posix.dirname(entry) || '.');
  const id = `r${++seq}`;
  const run = { id, child: null, dir, stopped: false };
  runs.set(id, run);
  const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  const finish = async (code) => {
    runs.delete(id);
    send(id, { type: 'exit', code });
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  (async () => {
    for (const alts of steps) {
      let code = null;
      for (let i = 0; i < alts.length && code === null; i++) {
        const s = alts[i];
        code = await new Promise((resolve) => {
          let child;
          try {
            child = spawn(s.cmd, s.args, { cwd, env, windowsHide: true, windowsVerbatimArguments: !!s.verbatim, detached: !isWin });
          } catch (e) { send(id, { type: 'out', text: `${e.message}\n`, err: true }); resolve(1); return; }
          run.child = child;
          child.stdout.on('data', (b) => send(id, { type: 'out', text: b.toString() }));
          child.stderr.on('data', (b) => send(id, { type: 'out', text: b.toString(), err: true }));
          child.stdin.on('error', () => {});
          child.on('error', (e) => {
            if (e.code === 'ENOENT') { if (i === alts.length - 1) send(id, { type: 'missing', cmd: alts.map((a) => a.cmd).join(' / ') }); resolve(i === alts.length - 1 ? 127 : null); }
            else { send(id, { type: 'out', text: `${e.message}\n`, err: true }); resolve(1); }
          });
          child.on('close', (c, sig) => resolve(c ?? (sig ? 130 : 1)));
        });
        if (code === null) continue; // siguiente alternativa
      }
      if (run.stopped) return finish(130);
      if (code !== 0) return finish(code);
    }
    return finish(0);
  })();
  return { id, command: steps.map((alts) => show(alts[0])).join(' && ') };
}

function input(id, text) {
  const r = runs.get(String(id));
  if (!r || !r.child || !r.child.stdin.writable) return false;
  r.child.stdin.write(`${text}\n`);
  return true;
}

function stop(id) {
  const r = runs.get(String(id));
  if (!r) return false;
  r.stopped = true;
  if (r.child) killTree(r.child);
  return true;
}

function stopAll() {
  let n = 0;
  for (const id of [...runs.keys()]) if (stop(id)) n++;
  return n;
}

module.exports = { plan, start, input, stop, stopAll, stepsFor };
