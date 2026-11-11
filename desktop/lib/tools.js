// Herramientas del agente. Todas las rutas se resuelven DENTRO del espacio de trabajo elegido.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next']);
const MAX_OUT = 200 * 1024;

/** Resuelve rel dentro de root; lanza si se sale (incluye symlinks). */
async function inside(root, rel = '.') {
  const base = await fs.realpath(root);
  const target = path.resolve(base, String(rel));
  const relToBase = path.relative(base, target);
  if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) {
    throw new Error(`ruta fuera del espacio de trabajo: ${rel}`);
  }
  try {
    const real = await fs.realpath(target);
    const r2 = path.relative(base, real);
    if (r2.startsWith('..') || path.isAbsolute(r2)) throw new Error(`enlace fuera del espacio de trabajo: ${rel}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return target;
}

async function list(root, rel) {
  const dir = await inside(root, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const rows = [];
  for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (e.isDirectory()) rows.push(`${e.name}/`);
    else {
      const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
      rows.push(`${e.name}  (${st ? st.size : '?'} B)`);
    }
  }
  return `${path.relative(await fs.realpath(root), dir) || '.'}:\n` + (rows.join('\n') || '(vacía)');
}

async function read(root, rel, offset = 0, limit = 400) {
  const file = await inside(root, rel);
  const st = await fs.stat(file);
  if (st.isDirectory()) return `${rel} es una carpeta, no un archivo. Contenido:\n${await list(root, rel)}`;
  if (st.size > 5 * 1024 * 1024) throw new Error('archivo de más de 5 MB; usa search o un comando');
  const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  const start = Math.max(0, offset | 0);
  const slice = lines.slice(start, start + Math.max(1, limit | 0));
  const body = slice.map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}`).join('\n');
  const more = start + slice.length < lines.length ? `\n…(${lines.length - start - slice.length} líneas más; usa offset)` : '';
  return `${rel} (${lines.length} líneas)\n${body}${more}`;
}

async function write(root, rel, content) {
  const file = await inside(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
  return `escrito ${rel} (${Buffer.byteLength(content)} B)`;
}

async function edit(root, rel, oldStr, newStr) {
  const file = await inside(root, rel);
  const text = await fs.readFile(file, 'utf8');
  if (!oldStr) throw new Error('"old" está vacío');
  const count = text.split(oldStr).length - 1;
  if (count === 0) throw new Error('no se encontró el texto "old" (debe coincidir exactamente)');
  if (count > 1) throw new Error(`"old" aparece ${count} veces; agrega más contexto para que sea único`);
  await fs.writeFile(file, text.replace(oldStr, () => newStr), 'utf8');
  return `editado ${rel}`;
}

/** Recorre lo que no es carpeta bajo dir (sin SKIP). onFile(p, dirent) devuelve false para detener todo. */
async function walkFiles(dir, onFile) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (await walkFiles(p, onFile) === false) return false; }
    else if (await onFile(p, e) === false) return false;
  }
  return true;
}

async function search(root, pattern, rel = '.') {
  let re;
  try { re = new RegExp(pattern, 'i'); } catch (e) { throw new Error('regex inválida: ' + e.message); }
  const base = await fs.realpath(root);
  const start = await inside(root, rel);
  const hits = [];
  let files = 0;
  await walkFiles(start, async (p, e) => {
    if (!e.isFile()) return true; // enlaces simbólicos: nunca se siguen
    if (++files > 5000) return false;
    const st = await fs.stat(p).catch(() => null);
    if (!st || st.size > 1024 * 1024) return true;
    const text = await fs.readFile(p, 'utf8').catch(() => '');
    if (text.includes('\u0000')) return true;
    text.split(/\r?\n/).forEach((line, i) => {
      if (hits.length < 200 && re.test(line)) hits.push(`${path.relative(base, p)}:${i + 1}: ${line.trim().slice(0, 200)}`);
    });
    return hits.length < 200;
  });
  return hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n…(más de 200 coincidencias)' : '') : 'sin coincidencias';
}

/**
 * Ejecuta un comando de terminal que el usuario ya aprobó en la interfaz.
 * Usa el shell del sistema a propósito (es una terminal), siempre con cwd = espacio de trabajo.
 */
/**
 * Mata un proceso y TODOS sus hijos. child.kill() con shell:true solo mata el shell y deja vivos
 * los procesos que lanzó (npm, node, un servidor...): procesos zombis tras cancelar o agotar el tiempo.
 */
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      process.kill(-child.pid, 'SIGTERM'); // grupo de procesos (detached:true)
    }
  } catch { try { child.kill('SIGKILL'); } catch { /* ya terminó */ } }
}

const spawnShell = (command, cwd) => spawn(command, {
  cwd, shell: true, windowsHide: true, env: process.env, detached: process.platform !== 'win32',
});

const runningCommands = new Set(); // comandos en primer plano, para poder cancelarlos

async function run(root, command, timeoutSec = 120) {
  const cwd = await inside(root, '.');
  return new Promise((resolve) => {
    const child = spawnShell(command, cwd);
    let out = '';
    let cancelled = false;
    const add = (b) => { if (out.length < MAX_OUT) out += b.toString(); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const entry = { child, cancel: () => { cancelled = true; killTree(child); } };
    runningCommands.add(entry);
    const timer = setTimeout(() => { killTree(child); out += `\n(tiempo agotado: ${timeoutSec}s; proceso y subprocesos terminados)`; }, timeoutSec * 1000);
    child.on('error', (e) => { clearTimeout(timer); runningCommands.delete(entry); resolve(`ERROR al lanzar: ${e.message}`); });
    child.on('close', (code) => {
      clearTimeout(timer);
      runningCommands.delete(entry);
      resolve(`$ ${command}\n(salida ${code})${cancelled ? ' (cancelado por el usuario)' : ''}\n${out.slice(0, MAX_OUT)}`);
    });
  });
}

/** Cancela los comandos en primer plano (botón detener). Devuelve cuántos había. */
function cancelRuns() {
  const n = runningCommands.size;
  for (const e of runningCommands) e.cancel();
  return n;
}

/* ---------------- procesos en segundo plano (servidores de desarrollo) ---------------- */
const MAX_BG = 8;
const BG_OUT = 64 * 1024;
const background = new Map(); // id -> { child, command, cwd, started, out, exit }
let bgSeq = 0;

async function startProcess(root, command) {
  if ([...background.values()].filter((p) => p.exit === null).length >= MAX_BG) throw new Error(`ya hay ${MAX_BG} procesos en segundo plano: detén alguno (stop_process)`);
  const cwd = await inside(root, '.');
  const child = spawnShell(command, cwd);
  const id = `p${++bgSeq}`;
  const p = { id, child, command, cwd, started: Date.now(), out: '', exit: null };
  const add = (b) => { p.out = (p.out + b.toString()).slice(-BG_OUT); };
  child.stdout.on('data', add);
  child.stderr.on('data', add);
  child.on('error', (e) => { p.exit = `error: ${e.message}`; });
  child.on('close', (code) => { p.exit = code; });
  background.set(id, p);
  await new Promise((r) => setTimeout(r, 1500)); // primeras líneas (puerto, errores de arranque)
  return `${id} iniciado: ${command}\n${p.exit !== null ? `(terminó enseguida, salida ${p.exit})\n` : ''}${p.out.slice(-3000)}`;
}

function processOutput(id, tail = 4000) {
  const p = background.get(String(id));
  if (!p) throw new Error(`no existe el proceso ${id}`);
  const state = p.exit === null ? `en marcha desde hace ${Math.round((Date.now() - p.started) / 1000)} s` : `terminado (salida ${p.exit})`;
  return `${p.id} · ${p.command} · ${state}\n${p.out.slice(-Math.min(Number(tail) || 4000, BG_OUT))}`;
}

function listProcesses() {
  return [...background.values()].map((p) => ({ id: p.id, command: p.command, running: p.exit === null, exit: p.exit, started: p.started }));
}

function stopProcess(id) {
  const p = background.get(String(id));
  if (!p) throw new Error(`no existe el proceso ${id}`);
  if (p.exit === null) killTree(p.child);
  return `${p.id} detenido (${p.command})`;
}

/** Al salir de la app o en una parada de emergencia: nada queda corriendo a escondidas. */
function stopAllProcesses() {
  let n = 0;
  for (const p of background.values()) if (p.exit === null) { killTree(p.child); n++; }
  return n + cancelRuns();
}

/** Mueve o renombra dentro del espacio de trabajo (las dos rutas). No sobrescribe. */
async function move(root, from, to) {
  const src = await inside(root, from);
  const dst = await inside(root, to);
  await fs.stat(src).catch(() => { throw new Error(`no existe ${from}`); });
  if (await fs.stat(dst).then(() => true, () => false)) throw new Error(`ya existe ${to}: no se sobrescribe`);
  await snapshot(root, from);
  await snapshot(root, to);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return `movido ${from} -> ${to}`;
}

function version(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, windowsHide: true, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      resolve(err ? null : String(stdout || stderr).trim().split('\n')[0]);
    });
  });
}

async function systemInfo() {
  const tools = {};
  for (const [name, cmd] of [['git', 'git'], ['node', 'node'], ['npm', 'npm'], ['python', process.platform === 'win32' ? 'python' : 'python3'], ['docker', 'docker']]) {
    tools[name] = (await version(cmd)) || 'no instalado';
  }
  return {
    os: `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`,
    cpu: `${os.cpus()[0]?.model || '?'} × ${os.cpus().length}`,
    ram: `${(os.totalmem() / 2 ** 30).toFixed(1)} GB total, ${(os.freemem() / 2 ** 30).toFixed(1)} GB libres`,
    home: os.homedir(),
    shell: process.env.SHELL || process.env.ComSpec || '?',
    tools,
  };
}

const osShort = () => `${os.type()} ${os.release()} ${os.arch()}`;

/* ---------------- deshacer: copia de cada archivo antes de escribirlo ---------------- */
const snapshots = []; // { root, rel, existed, content, turn }
const currentTurn = new Map(); // root -> id del turno en curso
async function snapshot(root, rel) {
  const file = await inside(root, rel);
  const content = await fs.readFile(file, 'utf8').catch(() => null);
  snapshots.push({ root, rel, existed: content !== null, content, turn: currentTurn.get(root) || null });
  if (snapshots.length > 500) snapshots.shift();
}

/* ---------------- checkpoints por turno ----------------
 * Claude Code no cubre los cambios hechos por comandos de terminal. Aquí, si la carpeta es un
 * repo git, cada turno guarda un "tree" de TODO el árbol de trabajo (incluidos archivos nuevos no
 * ignorados) con un índice temporal: no crea commits ni toca el índice del usuario. */
const checkpoints = []; // { root, turn, tree, at }

// Carpeta vacía para core.hooksPath: un repo ajeno no puede colar hooks en nuestras llamadas.
const NO_HOOKS = path.join(os.tmpdir(), 'jeancode-no-hooks');
require('node:fs').mkdirSync(NO_HOOKS, { recursive: true });

function git(root, args, env = {}) {
  return new Promise((resolve) => {
    // - sin conversión de fin de línea: los checkpoints guardan y restauran los bytes exactos
    // - endurecido frente a un .git/config malicioso: sin fsmonitor, sin hooks, sin protocolos
    //   externos y sin la configuración del sistema
    const hardened = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false',
      '-c', `core.hooksPath=${NO_HOOKS}`, '-c', 'protocol.allow=never', '-c', 'core.untrackedCache=false'];
    execFile('git', [...hardened, '-C', root, ...args], {
      windowsHide: true, timeout: 120000, maxBuffer: 32 << 20,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...env },
    },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '') }));
  });
}

async function treeOfWorktree(root) {
  const idx = path.join(os.tmpdir(), `jeancode-idx-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: idx };
    const head = await git(root, ['rev-parse', '--verify', 'HEAD']);
    if (head.ok) await git(root, ['read-tree', 'HEAD'], env);
    const add = await git(root, ['add', '-A', '--', '.'], env);
    if (!add.ok) return null;
    const tree = await git(root, ['write-tree'], env);
    return tree.ok ? tree.out : null;
  } finally {
    await fs.rm(idx, { force: true });
  }
}

/** Marca el inicio de un turno del agente y, si hay git, guarda el checkpoint del árbol. */
async function beginTurn(root, turn) {
  const base = await fs.realpath(root);
  currentTurn.set(root, turn);
  const inRepo = await git(base, ['rev-parse', '--is-inside-work-tree']);
  if (!inRepo.ok || inRepo.out !== 'true') return { turn, git: false };
  // filtros clean/smudge/process o fsmonitor definidos por el repo ejecutarían programas en
  // git add / checkout: en ese caso no se usa git para los checkpoints (solo copias de archivos)
  // solo la configuración del propio repo (.git/config, la que trae un repo ajeno); la global del
  // usuario (p. ej. Git LFS) es suya y de confianza. Un include en .git/config también se trata como riesgo.
  // Se revisan TODAS las fuentes con --show-scope: cualquier coincidencia que no venga de la
  // configuración global del usuario (local, worktree, etc.) se trata como riesgo. Si este git no
  // admite --show-scope, por prudencia tampoco se usa git.
  const scan = await git(base, ['config', '--show-scope', '--get-regexp',
    '^(filter\\..*\\.(clean|smudge|process)|core\\.fsmonitor|include\\..*|includeif\\..*|extensions\\.worktreeconfig)$']);
  if (!scan.ok && scan.err && !/^$/.test(scan.out) && !/exit code 1|returned 1/i.test(scan.err) && /unknown option|usage/i.test(scan.err)) {
    return { turn, git: false, reason: 'versión de git sin --show-scope' };
  }
  const repoScoped = scan.out.split('\n').filter(Boolean).filter((l) => !/^(global|command)\t/.test(l));
  if (repoScoped.length) return { turn, git: false, reason: 'el repo define filtros, fsmonitor o includes propios' };
  const tree = await treeOfWorktree(base);
  if (tree) {
    checkpoints.push({ root, turn, tree, at: Date.now() });
    if (checkpoints.length > 100) checkpoints.shift();
  }
  return { turn, git: !!tree };
}

/** Vuelve al estado anterior al turno indicado: árbol git completo si existe; si no, archivos tocados por el agente. */
async function rewind(root, turn) {
  const base = await fs.realpath(root);
  const cp = checkpoints.find((c) => c.root === root && c.turn === turn);
  if (cp) {
    const now = await treeOfWorktree(base);
    const idx = path.join(os.tmpdir(), `jeancode-rw-${process.pid}-${Date.now()}`);
    try {
      const env = { GIT_INDEX_FILE: idx };
      // archivos que existen ahora y no existían en el checkpoint -> se borran
      // todo limitado a la carpeta de trabajo ("-- ." relativo a -C base): nada fuera se toca
      const added = now ? await git(base, ['diff', '--name-only', '--relative', '--diff-filter=A', '-z', cp.tree, now, '--', '.']) : { ok: true, out: '' };
      await git(base, ['read-tree', cp.tree], env);
      const co = await git(base, ['checkout', cp.tree, '--', '.'], env);
      if (!co.ok) throw new Error('git checkout falló: ' + co.err.slice(0, 200));
      let removed = 0;
      for (const rel of added.out.split('\0').filter(Boolean)) {
        await fs.rm(await inside(base, rel), { force: true });
        removed++;
      }
      for (let i = snapshots.length - 1; i >= 0; i--) if (snapshots[i].root === root && snapshots[i].turn >= turn) snapshots.splice(i, 1);
      for (let i = checkpoints.length - 1; i >= 0; i--) if (checkpoints[i].root === root && checkpoints[i].turn > turn) checkpoints.splice(i, 1);
      return `restaurado el estado de antes de ese mensaje (git: archivos y comandos incluidos${removed ? `, ${removed} archivo(s) nuevo(s) borrado(s)` : ''})`;
    } finally {
      await fs.rm(idx, { force: true });
    }
  }
  // sin git: deshace en orden inverso las escrituras del agente desde ese turno
  let n = 0;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    if (s.root !== root || !s.turn || s.turn < turn) continue;
    const file = await inside(root, s.rel);
    if (s.existed) await fs.writeFile(file, s.content, 'utf8');
    else await fs.rm(file, { force: true });
    snapshots.splice(i, 1);
    n++;
  }
  return n ? `restaurados ${n} cambio(s) de archivo hechos por el agente (sin git, los comandos de terminal no se pueden deshacer)`
    : 'no había cambios del agente desde ese mensaje';
}
async function writeTracked(root, rel, content) { await snapshot(root, rel); return write(root, rel, content); }
async function editTracked(root, rel, a, b) { await snapshot(root, rel); return edit(root, rel, a, b); }
async function undo(root) {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].root !== root) continue;
    const s = snapshots.splice(i, 1)[0];
    const file = await inside(root, s.rel);
    if (s.existed) await fs.writeFile(file, s.content, 'utf8');
    else await fs.rm(file, { force: true });
    return `deshecho: ${s.rel} ${s.existed ? 'restaurado' : 'eliminado (era nuevo)'}`;
  }
  return 'no hay cambios que deshacer en esta carpeta';
}

/** Contenido actual de un archivo (para mostrar el diff antes de aprobar). */
async function peek(root, rel) {
  try { return await fs.readFile(await inside(root, rel), 'utf8'); } catch { return null; }
}

/* ---------------- glob: lista de archivos por patrón (** , *, ?) ---------------- */
function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}
async function glob(root, pattern = '**/*', limit = 500) {
  const base = await fs.realpath(root);
  const re = globToRegex(String(pattern).replace(/\\/g, '/'));
  const out = [];
  await walkFiles(base, (p) => {
    const rel = path.relative(base, p).split(path.sep).join('/');
    if (re.test(rel)) out.push(rel);
    return out.length < limit;
  });
  return out;
}

/* ---------------- webfetch: texto de una página (solo http/https) ---------------- */
const dns = require('node:dns').promises;
const net = require('node:net');

// Redes no públicas. BlockList compara también las IPv6 mapeadas (::ffff:a.b.c.d) con las reglas IPv4;
// NAT64 y 6to4, que incrustan IPv4, se rechazan enteras.
const BLOCKED = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) BLOCKED.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCKED.addSubnet(a, p, 'ipv6');

/** true si la IP es de loopback, privada, enlace local o no enrutable. */
function privateIp(ip) {
  return BLOCKED.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

async function assertPublic(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('solo http/https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error(`destino no permitido (red local o privada): ${u.hostname}`);
}

async function webfetch(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL inválida'); }
  let res;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(u);
    res = await fetch(u, { headers: { 'User-Agent': 'JeanCode' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) break;
    u = new URL(loc, u);
    if (hop === 4) throw new Error('demasiadas redirecciones');
  }
  const type = res.headers.get('content-type') || '';
  let text = await res.text();
  if (type.includes('html')) {
    text = text.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
  }
  return `${res.status} ${u.href}\n\n${text.trim().slice(0, 40000)}`;
}

/* ---------------- memoria del proyecto y comandos propios ---------------- */
const MEMORY_FILES = ['AGENTS.md', 'JEANCODE.md', 'CLAUDE.md'];
async function projectMemory(root) {
  const parts = [];
  for (const name of MEMORY_FILES) {
    const t = await peek(root, name);
    if (t) parts.push(`--- ${name} ---\n${t.slice(0, 16000)}`);
  }
  return parts.join('\n\n');
}
async function commands(root) {
  const dir = await inside(root, '.jeancode/commands').catch(() => null);
  if (!dir) return [];
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const body = await fs.readFile(path.join(dir, e.name), 'utf8');
    const desc = (body.match(/^description:\s*(.+)$/m) || [])[1] || body.split('\n').find((l) => l.trim() && !l.startsWith('---')) || '';
    out.push({ name: e.name.slice(0, -3), description: desc.trim().slice(0, 120), body: body.replace(/^---[\s\S]*?---\s*/, '') });
  }
  return out;
}

/** Subagentes propios (como .claude/agents): .jeancode/agents/<nombre>.md con frontmatter
 *  name, description y tools (read | all). El cuerpo es su prompt de sistema. */
async function agents(root) {
  const dir = await inside(root, '.jeancode/agents').catch(() => null);
  if (!dir) return [];
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const text = await fs.readFile(path.join(dir, e.name), 'utf8');
    const fm = (text.match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || '';
    const get = (k) => ((fm.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
    out.push({
      name: get('name') || e.name.slice(0, -3), description: get('description').slice(0, 200),
      write: /^(all|write|todas)$/i.test(get('tools')), prompt: text.replace(/^---[\s\S]*?---\s*/, '').slice(0, 12000),
    });
  }
  return out;
}

/** Hooks del proyecto (.jeancode/hooks.json). Se devuelven con su huella para que la interfaz
 *  pida confianza antes de ejecutarlos (un repo ajeno no debe poder correr comandos solo). */
/*
 * Hooks (como los de Claude Code). .jeancode/hooks.json del proyecto (pide confianza) o hooks.json global
 * del usuario (Ajustes). Cada evento: lista de comandos ("cmd") o de { "matcher": "regex de herramienta", "command": "cmd" }.
 *   session_start  al empezar un turno del agente     stdout = contexto extra para el modelo
 *   user_prompt    antes de enviar tu mensaje         salida 2 = no se envía · stdout = contexto extra
 *   pre_tool       antes de cada herramienta          salida 2 = bloqueada (stderr = motivo para el modelo)
 *   post_tool      después de cada herramienta        stdout = se añade al resultado
 *   post_edit      tras escribir/editar un archivo    (compatibilidad: {path} en el comando)
 *   stop           cuando el agente va a terminar     salida 2 = sigue trabajando con stderr como instrucción
 *   post_turn      al final del turno
 * Entrada: JSON por stdin ({ event, tool, args, result, prompt, workspace }). Salida JSON opcional en stdout:
 * { "decision": "block" | "allow" | "ask", "reason": "...", "context": "..." }.
 */
const HOOK_EVENTS = ['session_start', 'user_prompt', 'pre_tool', 'post_tool', 'post_edit', 'stop', 'post_turn'];

function cleanHooks(data) {
  const clean = {};
  for (const ev of HOOK_EVENTS) {
    if (!Array.isArray(data?.[ev])) continue;
    const list = data[ev].slice(0, 10).map((h) => (typeof h === 'string' ? { command: h }
      : h && typeof h.command === 'string' ? { command: h.command, ...(typeof h.matcher === 'string' ? { matcher: h.matcher.slice(0, 200) } : {}), ...(Number.isFinite(h.timeout) ? { timeout: Math.min(Math.max(h.timeout, 1), 600) } : {}) } : null))
      .filter(Boolean);
    for (const h of list) { if (h.matcher) { try { new RegExp(h.matcher); } catch { throw new Error(`matcher inválido en ${ev}: ${h.matcher}`); } } }
    if (list.length) clean[ev] = list;
  }
  return clean;
}

async function hooks(root) {
  const file = await inside(root, '.jeancode/hooks.json').catch(() => null);
  const text = file ? await fs.readFile(file, 'utf8').catch(() => null) : null;
  if (!text) return null;
  let clean;
  try { clean = cleanHooks(JSON.parse(text)); } catch (e) { return { error: 'hooks.json no es válido: ' + e.message }; }
  const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(clean)).digest('hex');
  return { hooks: clean, hash };
}

/** Ejecuta un hook: JSON por stdin, devuelve { code, stdout, stderr }. Sin límite de confianza aquí: lo decide la interfaz. */
async function execHook(root, command, input, timeoutSec = 60) {
  const cwd = await inside(root, '.');
  return new Promise((resolve) => {
    const child = spawnShell(command, cwd);
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { if (stdout.length < 64 * 1024) stdout += b.toString(); });
    child.stderr.on('data', (b) => { if (stderr.length < 64 * 1024) stderr += b.toString(); });
    const timer = setTimeout(() => { killTree(child); stderr += `\n(hook: tiempo agotado, ${timeoutSec}s)`; }, timeoutSec * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `no se pudo lanzar: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input ?? {}));
  });
}

module.exports = {
  inside, list, read, write: writeTracked, edit: editTracked, search, run, cancelRuns, systemInfo, osShort,
  startProcess, processOutput, listProcesses, stopProcess, stopAllProcesses, move, killTree,
  undo, peek, glob, webfetch, projectMemory, commands, agents, hooks, cleanHooks, execHook, beginTurn, rewind,
};
