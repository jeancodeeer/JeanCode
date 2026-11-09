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

async function search(root, pattern, rel = '.') {
  let re;
  try { re = new RegExp(pattern, 'i'); } catch (e) { throw new Error('regex inválida: ' + e.message); }
  const base = await fs.realpath(root);
  const start = await inside(root, rel);
  const hits = [];
  let files = 0;
  async function walk(dir) {
    if (hits.length >= 200 || files >= 5000) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files++;
        const st = await fs.stat(p).catch(() => null);
        if (!st || st.size > 1024 * 1024) continue;
        const text = await fs.readFile(p, 'utf8').catch(() => '');
        if (text.includes('\u0000')) continue;
        text.split(/\r?\n/).forEach((line, i) => {
          if (hits.length < 200 && re.test(line)) hits.push(`${path.relative(base, p)}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
      if (hits.length >= 200) return;
    }
  }
  await walk(start);
  return hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n…(más de 200 coincidencias)' : '') : 'sin coincidencias';
}

/**
 * Ejecuta un comando de terminal que el usuario ya aprobó en la interfaz.
 * Usa el shell del sistema a propósito (es una terminal), siempre con cwd = espacio de trabajo.
 */
async function run(root, command, timeoutSec = 120) {
  const cwd = await inside(root, '.');
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, env: process.env });
    let out = '';
    const add = (b) => { if (out.length < MAX_OUT) out += b.toString(); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { child.kill(); out += `\n(tiempo agotado: ${timeoutSec}s)`; }, timeoutSec * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve(`ERROR al lanzar: ${e.message}`); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(`$ ${command}\n(salida ${code})\n${out.slice(0, MAX_OUT)}`);
    });
  });
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
const snapshots = []; // { root, rel, existed, content }
async function snapshot(root, rel) {
  const file = await inside(root, rel);
  const content = await fs.readFile(file, 'utf8').catch(() => null);
  snapshots.push({ root, rel, existed: content !== null, content });
  if (snapshots.length > 200) snapshots.shift();
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
  async function walk(dir) {
    if (out.length >= limit) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const rel = path.relative(base, p).split(path.sep).join('/');
        if (re.test(rel)) out.push(rel);
      }
      if (out.length >= limit) return;
    }
  }
  await walk(base);
  return out;
}

/* ---------------- webfetch: texto de una página (solo http/https) ---------------- */
const dns = require('node:dns').promises;
const net = require('node:net');

/** true si la IP es de loopback, privada, enlace local o no enrutable. */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
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

module.exports = {
  inside, list, read, write: writeTracked, edit: editTracked, search, run, systemInfo, osShort,
  undo, peek, glob, webfetch, projectMemory, commands,
};
