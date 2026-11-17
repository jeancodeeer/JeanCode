// Plugins: paquetes con el formato de los plugins de Claude Code (.claude-plugin/plugin.json + skills/,
// agents/ y commands/) instalados en <userData>/plugins/<id>/. Un plugin aporta a la vez skills (load_skill),
// subagentes (spawn_subagent con "agent") y comandos (/<plugin>:<comando>). Sus hooks, servidores MCP y
// scripts NO se ejecutan: solo se usa el texto (instrucciones y prompts), así un plugin no corre código solo.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { parseFrontmatter } = require('./skills');

const STATE = '.jeancode-plugin.json';
// solo esto se copia del repositorio: texto que el agente puede leer (nada de node_modules, tests, CI…)
const KEEP = ['.claude-plugin', 'plugin.json', 'skills', 'agents', 'commands', 'docs', 'resources', 'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'README.md'];
const MAX_FILES = 6000;
const MAX_BYTES = 80 * 2 ** 20;
const MAX_FILE = 2 * 2 ** 20;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'plugin';
const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Manifiesto del plugin: .claude-plugin/plugin.json (formato de Claude Code) o plugin.json en la raíz. */
async function manifestOf(root) {
  for (const f of [path.join(root, '.claude-plugin', 'plugin.json'), path.join(root, 'plugin.json')]) {
    const m = await readJson(f).catch(() => null);
    if (m && typeof m === 'object' && m.name) return m;
  }
  return null;
}

/** Ruta del manifiesto ("./skills/") resuelta dentro del plugin; fuera de él se ignora. */
function within(root, rel) {
  const p = path.resolve(root, String(rel));
  return p === root || p.startsWith(root + path.sep) ? p : null;
}

/** "Read, Grep" · "[Read, Grep]" · ausente (= todas, como en Claude Code) → ¿puede escribir o ejecutar? */
function canWrite(tools) {
  if (tools == null || !String(tools).trim()) return true;
  return /\b(Write|Edit|MultiEdit|Bash|NotebookEdit|all|write|todas)\b/.test(String(tools));
}

function create(dir) {
  let cache = null; // índice en memoria; se invalida al instalar, quitar o activar/desactivar

  async function scanSkills(root, folders) {
    const out = [];
    async function scan(d, depth) {
      const text = await fs.readFile(path.join(d, 'SKILL.md'), 'utf8').catch(() => null);
      if (text != null) {
        const meta = parseFrontmatter(text);
        out.push({ name: meta.name || path.basename(d), description: meta.description || '(sin descripción)', dir: d });
        return;
      }
      if (depth >= 2) return;
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && !e.name.startsWith('.')) await scan(path.join(d, e.name), depth + 1);
      }
    }
    for (const f of folders) await scan(f, 0);
    return out;
  }

  async function mdFiles(root, entries) {
    const files = [];
    for (const p of entries) {
      const st = await fs.stat(p).catch(() => null);
      if (!st) continue;
      if (st.isFile() && p.endsWith('.md')) files.push(p);
      else if (st.isDirectory()) {
        for (const e of await fs.readdir(p, { withFileTypes: true })) {
          if (e.isFile() && e.name.endsWith('.md') && !/^readme\.md$/i.test(e.name)) files.push(path.join(p, e.name));
        }
      }
    }
    return files;
  }

  /** Los prompts de Claude citan ${CLAUDE_PLUGIN_ROOT}/x.md: se insertan esos archivos (el subagente no
   *  puede leer fuera de la carpeta de trabajo) y el resto de menciones se reescribe como plugin:<id>. */
  async function resolveRefs(root, id, text) {
    let budget = 60000;
    const seen = new Set();
    const refs = [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.md)/g)].map((m) => m[1]);
    const extra = [];
    for (const rel of refs) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const p = within(root, rel);
      const body = p && await fs.readFile(p, 'utf8').catch(() => null);
      if (!body || body.length > budget) continue;
      budget -= body.length;
      extra.push(`--- plugin:${id}/${rel} ---\n${body.replace(/^---[\s\S]*?---\s*/, '')}`);
    }
    const out = text
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.md)/g, (all, rel) => (extra.some((x) => x.startsWith(`--- plugin:${id}/${rel} ---`)) ? `plugin:${id}/${rel} (incluido más abajo)` : all))
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, `plugin:${id}`);
    return extra.length ? `${out}\n\n${extra.join('\n\n')}` : out;
  }

  async function load() {
    if (cache) return cache;
    await fs.mkdir(dir, { recursive: true });
    const plugins = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const root = path.join(dir, e.name);
      const m = await manifestOf(root);
      if (!m) continue;
      const state = await readJson(path.join(root, STATE)).catch(() => ({}));
      const folders = (key, def) => (m[key] != null ? asList(m[key]) : [def]).map((r) => within(root, r)).filter(Boolean);
      const skills = await scanSkills(root, folders('skills', 'skills'));
      const agents = [];
      for (const f of await mdFiles(root, folders('agents', 'agents'))) {
        const text = await fs.readFile(f, 'utf8');
        const meta = parseFrontmatter(text);
        const fmTools = (text.match(/^tools\s*:\s*(.*)$/m) || [])[1];
        agents.push({
          name: meta.name || path.basename(f, '.md'), description: String(meta.description || '').slice(0, 200),
          write: canWrite(fmTools), prompt: (await resolveRefs(root, e.name, text.replace(/^---[\s\S]*?---\s*/, ''))).slice(0, 40000),
          plugin: e.name,
        });
      }
      const commands = [];
      for (const f of await mdFiles(root, folders('commands', 'commands'))) {
        const body = await fs.readFile(f, 'utf8');
        const meta = parseFrontmatter(body);
        commands.push({
          name: `${e.name}:${path.basename(f, '.md')}`, description: String(meta.description || '').slice(0, 120),
          body: await resolveRefs(root, e.name, body.replace(/^---[\s\S]*?---\s*/, '')), plugin: e.name,
        });
      }
      plugins.push({
        id: e.name, root, name: m.name, displayName: m.displayName || m.name, version: m.version || '',
        description: m.description || '', license: m.license || '', source: state.source || '',
        enabled: state.enabled !== false, skills, agents, commands,
      });
    }
    cache = plugins;
    return plugins;
  }

  const enabled = async () => (await load()).filter((p) => p.enabled);

  async function list() {
    return (await load()).map((p) => ({
      id: p.id, name: p.name, displayName: p.displayName, version: p.version, description: p.description,
      license: p.license, source: p.source, enabled: p.enabled,
      counts: { skills: p.skills.length, agents: p.agents.length, commands: p.commands.length },
    }));
  }

  async function skills() {
    return (await enabled()).flatMap((p) => p.skills.map((s) => ({ id: `plugin:${p.id}/${s.name}`, name: s.name, description: s.description, plugin: p.id })));
  }
  async function agents() { return (await enabled()).flatMap((p) => p.agents.map(({ plugin, ...a }) => ({ ...a, plugin }))); }
  async function commands() { return (await enabled()).flatMap((p) => p.commands); }

  /** Archivo de un plugin, sin salir de su carpeta. */
  async function readFileIn(root, base, rel) {
    // primero relativo a la skill, después a la raíz del plugin; nunca fuera de la raíz
    for (const c of [within(base, rel), within(root, rel)].filter(Boolean)) {
      if (!c.startsWith(root + path.sep)) continue;
      const st = await fs.stat(c).catch(() => null);
      if (st?.isFile()) {
        if (st.size > MAX_FILE) throw new Error(`archivo demasiado grande: ${rel}`);
        return fs.readFile(c, 'utf8');
      }
    }
    throw new Error(`no existe en el plugin: ${rel}`);
  }

  /** Índice de un plugin (para los grandes, cuyo contenido no cabe en el prompt). */
  function index(p) {
    const lines = [`PLUGIN ${p.displayName} ${p.version} (${p.license || 'sin licencia indicada'}): ${p.description}`];
    if (p.skills.length) lines.push(`\nSKILLS (${p.skills.length}) — load_skill {"name": nombre}:`, ...p.skills.map((s) => `- ${s.name}: ${String(s.description).replace(/\s+/g, ' ').slice(0, 140)}`));
    if (p.agents.length) lines.push(`\nSUBAGENTES (${p.agents.length}) — spawn_subagent {"agent": nombre}:`, ...p.agents.map((a) => `- ${a.name}: ${a.description}`));
    if (p.commands.length) lines.push(`\nCOMANDOS (${p.commands.length}) — el usuario los escribe como /nombre:`, ...p.commands.map((c) => `- /${c.name}: ${c.description}`));
    lines.push(`\nOtros archivos del plugin: load_skill {"name": "${p.id}", "file": "ruta/dentro/del/plugin"}`);
    return lines.join('\n');
  }

  /** null si el nombre no es de ningún plugin activo. */
  async function read(name, file) {
    const ps = await enabled();
    const plug = ps.find((p) => p.id === name || p.name === name);
    if (plug) return file ? readFileIn(plug.root, plug.root, file) : index(plug);
    for (const p of ps) {
      const s = p.skills.find((x) => x.name === name);
      if (!s) continue;
      if (file) return readFileIn(p.root, s.dir, file);
      const text = await resolveRefs(p.root, p.id, await fs.readFile(path.join(s.dir, 'SKILL.md'), 'utf8'));
      const extra = (await fs.readdir(s.dir, { recursive: true })).filter((f) => f !== 'SKILL.md');
      return `${text}\n\n(skill del plugin ${p.id}. Archivos propios: ${extra.join(', ') || 'ninguno'}. `
        + `Léelos con load_skill {"name": "${s.name}", "file": "ruta"}; los de plugin:${p.id}/… con load_skill {"name": "${p.id}", "file": "ruta"})`;
    }
    return null;
  }

  async function writeState(id, patch) {
    const root = path.join(dir, slug(id));
    if (path.dirname(root) !== dir || !(await manifestOf(root))) throw new Error(`plugin no instalado: ${id}`);
    const f = path.join(root, STATE);
    const cur = await readJson(f).catch(() => ({}));
    await fs.writeFile(f, JSON.stringify({ ...cur, ...patch }, null, 2));
    cache = null;
    return true;
  }
  const setEnabled = (id, on) => writeState(id, { enabled: !!on });

  async function remove(id) {
    const target = path.join(dir, slug(id));
    if (path.dirname(target) !== dir) throw new Error('id inválido');
    await fs.rm(target, { recursive: true, force: true });
    cache = null;
    return true;
  }

  /** Copia del repositorio solo lo que sirve al agente (KEEP), con límites de tamaño. */
  async function installFrom(srcRoot, source = '') {
    const m = await manifestOf(srcRoot);
    if (!m) throw new Error('no es un plugin: falta .claude-plugin/plugin.json');
    const id = slug(m.name);
    let files = 0, bytes = 0;
    const filter = async (p) => {
      const base = path.basename(p);
      if (base === '.git' || base === 'node_modules' || base === '__pycache__') return false;
      const st = await fs.lstat(p);
      if (st.isSymbolicLink()) return false;
      if (st.isFile()) {
        if (st.size > MAX_FILE) return false;
        files++; bytes += st.size;
        if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error(`el plugin es demasiado grande (más de ${MAX_FILES} archivos o ${MAX_BYTES / 2 ** 20} MB)`);
      }
      return true;
    };
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.tmp-${id}-${Date.now()}`);
    try {
      for (const k of KEEP) {
        const from = path.join(srcRoot, k);
        if (!(await fs.stat(from).catch(() => null))) continue;
        await fs.cp(from, path.join(tmp, k), { recursive: true, filter });
      }
      const target = path.join(dir, id);
      const prev = await readJson(path.join(target, STATE)).catch(() => ({}));
      await fs.writeFile(path.join(tmp, STATE), JSON.stringify({ enabled: prev.enabled !== false, source, installedAt: new Date().toISOString() }, null, 2));
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(tmp, target);
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
    cache = null;
    const p = (await load()).find((x) => x.id === id);
    return { id, name: p.displayName, version: p.version, counts: { skills: p.skills.length, agents: p.agents.length, commands: p.commands.length } };
  }

  /** Repositorio git público (https): clon superficial sin shell y copia filtrada. */
  async function installGit(url, tmpDir) {
    let u;
    try { u = new URL(url); } catch { throw new Error('URL inválida'); }
    if (u.protocol !== 'https:') throw new Error('solo se aceptan URLs https');
    const dest = path.join(tmpDir, `plugin-${Date.now()}`);
    await new Promise((resolve, reject) => {
      execFile('git', ['clone', '--depth', '1', '--', url, dest], { timeout: 300000, windowsHide: true },
        (err, _o, stderr) => (err ? reject(new Error('git clone falló: ' + (stderr || err.message).slice(0, 300))) : resolve()));
    });
    try { return await installFrom(dest, url); } finally { await fs.rm(dest, { recursive: true, force: true }); }
  }

  return { list, skills, agents, commands, read, setEnabled, remove, installFrom, installGit, invalidate: () => { cache = null; } };
}

module.exports = { create, canWrite, manifestOf };
