// Skills y plugins en la web y en el móvil: lo mismo que la app de escritorio guarda en disco, aquí va en IndexedDB.
// Se descargan de GitHub (árbol del repo con la API + archivos desde raw.githubusercontent.com, ambos con CORS).
// Solo se guarda texto (SKILL.md, agentes, comandos, referencias): nada se ejecuta.
import { parseFrontmatter } from './skills-meta.js';

const DB = 'jeancode-ext';
const MAX_FILES = 6000; // los mismos límites que la app de escritorio
const MAX_BYTES = 80 * 2 ** 20;
const MAX_FILE = 2 * 2 ** 20;
const TEXT = /\.(md|markdown|txt|json|ya?ml|toml|py|js|ts|sh|html|css|csv|xml)$/i;
const PLUGIN_KEEP = /^(\.claude-plugin\/|plugin\.json$|skills\/|agents\/|commands\/|docs\/|resources\/|LICENSE|README\.md$)/;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 64) || 'x';

/* ---------------------------------------------------------------- almacén: { key, kind, id, files: {ruta: texto}, state } */
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'key' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('items', mode);
    const out = fn(t.objectStore('items'));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}
const all = async (kind) => (await tx('readonly', (s) => s.getAll())).filter((x) => x.kind === kind);
const put = (item) => tx('readwrite', (s) => s.put(item));
const del = (key) => tx('readwrite', (s) => s.delete(key));

/* ---------------------------------------------------------------- descargas */
const trees = new Map();
/** "https://github.com/a/b(.git)(/tree/rama/carpeta)" → { repo, branch, dir } */
export function parseGithub(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL inválida'); }
  if (u.protocol !== 'https:') throw new Error('solo se aceptan URLs https');
  if (u.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, branch, ...rest] = u.pathname.slice(1).split('/');
    return { repo: `${owner}/${repo}`, branch, dir: rest.join('/'), file: true };
  }
  if (u.hostname !== 'github.com') throw new Error('En la web se instalan desde GitHub (github.com/usuario/repo).');
  const [owner, repo, kind, branch, ...rest] = u.pathname.slice(1).replace(/\.git$/, '').split('/');
  if (!owner || !repo) throw new Error('URL de GitHub incompleta');
  return { repo: `${owner}/${repo.replace(/\.git$/, '')}`, branch: branch || 'HEAD', dir: rest.join('/'), file: kind === 'blob' };
}
async function treeOf(repo, branch = 'HEAD') {
  const key = `${repo}@${branch}`;
  if (!trees.has(key)) {
    const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 403 || r.status === 429) throw new Error('GitHub limitó las descargas por ahora (60 por hora sin cuenta); prueba en un rato');
    if (!r.ok) throw new Error(`no se pudo leer ${repo} (${r.status})`);
    trees.set(key, (await r.json()).tree || []);
  }
  return trees.get(key);
}
const raw = (repo, branch, p) => `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${p.split('/').map(encodeURIComponent).join('/')}`;
/** Descarga los archivos de texto que pasen el filtro, en paralelo y con límites. → { ruta relativa: texto } */
async function download(repo, branch, entries, base, onProgress) {
  const list = entries.filter((f) => f.type === 'blob' && TEXT.test(f.path) && (f.size || 0) <= MAX_FILE);
  const total = list.reduce((s, f) => s + (f.size || 0), 0);
  if (list.length > MAX_FILES || total > MAX_BYTES) throw new Error(`demasiado grande para el navegador (${list.length} archivos, ${Math.round(total / 2 ** 20)} MB)`);
  const files = {};
  let i = 0, done = 0;
  const worker = async () => {
    while (i < list.length) {
      const f = list[i++];
      const rel = base ? f.path.slice(base.length + 1) : f.path;
      if (!f.size) { files[rel] = ''; continue; }
      const r = await fetch(raw(repo, branch, f.path));
      if (!r.ok) throw new Error(`descarga fallida: ${rel} (${r.status})`);
      files[rel] = await r.text();
      onProgress?.(++done / list.length);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return files;
}
/** Archivos elegidos con <input webkitdirectory> → { ruta: texto } (sin la carpeta raíz). */
async function readPicked(fileList) {
  const files = {};
  let bytes = 0;
  for (const f of fileList) {
    const p = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
    if (p.split('/').some((x) => x === '.git' || x === 'node_modules') || !TEXT.test(p) || f.size > MAX_FILE) continue;
    bytes += f.size;
    if (bytes > MAX_BYTES) throw new Error('la carpeta es demasiado grande');
    files[p] = await f.text();
  }
  return files;
}
/** Abre el selector de carpetas del navegador. → FileList | null */
function pickFolder() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.webkitdirectory = true;
    i.multiple = true;
    i.onchange = () => resolve(i.files?.length ? i.files : null);
    i.addEventListener('cancel', () => resolve(null));
    i.click();
  });
}

/* ---------------------------------------------------------------- skills */
/** Carpetas con SKILL.md dentro de un conjunto de archivos (raíz o hasta dos niveles). → [{ dir, files }] */
function skillDirs(files) {
  const dirs = Object.keys(files).filter((p) => /(^|\/)SKILL\.md$/.test(p)).map((p) => p.replace(/\/?SKILL\.md$/, ''))
    .filter((d) => d.split('/').filter(Boolean).length <= 3);
  return dirs.map((d) => {
    const own = {};
    for (const [p, t] of Object.entries(files)) if (!d || p.startsWith(`${d}/`)) own[d ? p.slice(d.length + 1) : p] = t;
    return { dir: d, files: own };
  });
}
async function saveSkills(files, source) {
  const found = skillDirs(files);
  if (!found.length) throw new Error('no se encontró ningún SKILL.md');
  const names = [];
  for (const { files: f } of found) {
    const meta = parseFrontmatter(f['SKILL.md']);
    const id = slug(meta.name || 'skill');
    await put({ key: `skill:${id}`, kind: 'skill', id, files: f, state: { source, installedAt: Date.now() } });
    names.push(meta.name || id);
  }
  return names.join(', ');
}

export const skills = {
  async list() {
    return (await all('skill')).map((s) => {
      const meta = parseFrontmatter(s.files['SKILL.md'] || '');
      return { id: s.id, name: meta.name || s.id, description: meta.description || '(sin descripción)' };
    });
  },
  /** Texto completo de la skill, con sus otros .md de referencia (hasta un límite). */
  async read(name) {
    const s = (await all('skill')).find((x) => x.id === name || parseFrontmatter(x.files['SKILL.md'] || '').name === name);
    if (!s) return null;
    let budget = 40000;
    const extra = [];
    for (const [p, t] of Object.entries(s.files)) {
      if (p === 'SKILL.md' || !/\.md$/i.test(p) || t.length > budget) continue;
      budget -= t.length;
      extra.push(`--- ${p} ---\n${t}`);
    }
    return [s.files['SKILL.md'], ...extra].join('\n\n');
  },
  remove: (id) => del(`skill:${slug(id)}`),
  async installGithub(repo, dir, branch = 'main') {
    const base = String(dir).replace(/^\/+|\/+$/g, '');
    let ref = branch;
    const tree = await treeOf(repo, ref).catch(() => { ref = 'HEAD'; return treeOf(repo, ref); });
    const entries = tree.filter((f) => f.path.startsWith(`${base}/`));
    if (!entries.some((f) => f.path === `${base}/SKILL.md`)) throw new Error(`${repo}/${base} no tiene SKILL.md`);
    return saveSkills(await download(repo, ref, entries, base), `https://github.com/${repo}/tree/${ref}/${base}`);
  },
  async installUrl(url) {
    const g = parseGithub(url);
    if (g.file || /SKILL\.md$/i.test(url)) {
      const r = await fetch(raw(g.repo, g.branch, g.dir));
      if (!r.ok) throw new Error(`descarga fallida (${r.status})`);
      return saveSkills({ 'SKILL.md': await r.text() }, url);
    }
    const tree = await treeOf(g.repo, g.branch);
    const entries = tree.filter((f) => !g.dir || f.path.startsWith(`${g.dir}/`));
    return saveSkills(await download(g.repo, g.branch, entries, g.dir), url);
  },
  async installFolder() {
    const picked = await pickFolder();
    return picked ? saveSkills(await readPicked(picked), 'carpeta local') : '';
  },
};

/* ---------------------------------------------------------------- plugins (formato de Claude Code) */
const manifestOf = (files) => {
  for (const p of ['.claude-plugin/plugin.json', 'plugin.json']) {
    try { const m = JSON.parse(files[p] || ''); if (m?.name) return m; } catch { /* sigue */ }
  }
  return null;
};
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const clean = (r) => String(r).replace(/^\.\//, '').replace(/\/+$/, '');
function indexPlugin(p) {
  const m = manifestOf(p.files) || { name: p.id };
  const folders = (key, def) => (m[key] != null ? asList(m[key]) : [def]).map(clean);
  const inside = (path, dirs) => dirs.some((d) => path === d || path.startsWith(`${d}/`));
  const resolve = (text) => text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.md)/g, (all, rel) => (p.files[rel] ? `\n--- plugin:${p.id}/${rel} ---\n${p.files[rel].replace(/^---[\s\S]*?---\s*/, '')}\n` : all)).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, `plugin:${p.id}`);
  const mdIn = (dirs) => Object.keys(p.files).filter((f) => /\.md$/i.test(f) && !/readme\.md$/i.test(f) && inside(f, dirs) && f.split('/').length === dirs.find((d) => inside(f, [d])).split('/').length + 1);
  const skillsDirs = folders('skills', 'skills');
  const skillList = Object.keys(p.files).filter((f) => /(^|\/)SKILL\.md$/.test(f) && inside(f, skillsDirs)).map((f) => {
    const meta = parseFrontmatter(p.files[f]);
    const dir = f.replace(/\/?SKILL\.md$/, '');
    return { name: meta.name || dir.split('/').pop(), description: meta.description || '(sin descripción)', dir };
  });
  const agents = mdIn(folders('agents', 'agents')).map((f) => {
    const meta = parseFrontmatter(p.files[f]);
    return { name: meta.name || f.split('/').pop().replace(/\.md$/, ''), description: String(meta.description || '').slice(0, 200), prompt: resolve(p.files[f].replace(/^---[\s\S]*?---\s*/, '')).slice(0, 40000), plugin: p.id };
  });
  const commands = mdIn(folders('commands', 'commands')).map((f) => {
    const meta = parseFrontmatter(p.files[f]);
    return { name: `${p.id}:${f.split('/').pop().replace(/\.md$/, '')}`, description: String(meta.description || '').slice(0, 120), body: resolve(p.files[f].replace(/^---[\s\S]*?---\s*/, '')), plugin: p.id };
  });
  return { id: p.id, name: m.name, displayName: m.displayName || m.name, version: m.version || '', description: m.description || '', license: m.license || '', source: p.state?.source || '', enabled: p.state?.enabled !== false, skills: skillList, agents, commands, files: p.files, resolve };
}
async function savePlugin(files, source) {
  const m = manifestOf(files);
  if (!m) throw new Error('no es un plugin: falta .claude-plugin/plugin.json');
  const id = slug(m.name);
  const prev = (await all('plugin')).find((x) => x.id === id);
  const kept = Object.fromEntries(Object.entries(files).filter(([p]) => PLUGIN_KEEP.test(p)));
  await put({ key: `plugin:${id}`, kind: 'plugin', id, files: kept, state: { enabled: prev?.state?.enabled !== false, source, installedAt: Date.now() } });
  const p = indexPlugin({ id, files: kept });
  return { id, name: p.displayName, version: p.version, counts: { skills: p.skills.length, agents: p.agents.length, commands: p.commands.length } };
}
const loaded = async () => (await all('plugin')).map(indexPlugin);
const enabled = async () => (await loaded()).filter((p) => p.enabled);

export const plugins = {
  async list() {
    return (await loaded()).map((p) => ({ id: p.id, name: p.name, displayName: p.displayName, version: p.version, description: p.description, license: p.license, source: p.source, enabled: p.enabled, counts: { skills: p.skills.length, agents: p.agents.length, commands: p.commands.length } }));
  },
  async skills() { return (await enabled()).flatMap((p) => p.skills.map((s) => ({ id: `plugin:${p.id}/${s.name}`, name: s.name, description: s.description, plugin: p.id }))); },
  async agents() { return (await enabled()).flatMap((p) => p.agents); },
  async commands() { return (await enabled()).flatMap((p) => p.commands); },
  async readSkill(name) {
    for (const p of await enabled()) {
      const s = p.skills.find((x) => x.name === name);
      if (s) return p.resolve(p.files[s.dir ? `${s.dir}/SKILL.md` : 'SKILL.md']);
    }
    return null;
  },
  async setEnabled(id, on) {
    const p = (await all('plugin')).find((x) => x.id === id);
    if (!p) throw new Error(`plugin no instalado: ${id}`);
    p.state = { ...p.state, enabled: !!on };
    await put(p);
    return true;
  },
  remove: (id) => del(`plugin:${slug(id)}`),
  async installGit(url, onProgress) {
    const g = parseGithub(url);
    const tree = await treeOf(g.repo, g.branch);
    const base = g.dir;
    const entries = tree.filter((f) => (!base || f.path.startsWith(`${base}/`)) && PLUGIN_KEEP.test(base ? f.path.slice(base.length + 1) : f.path));
    return savePlugin(await download(g.repo, g.branch, entries, base, onProgress), url);
  },
  async installFolder() {
    const picked = await pickFolder();
    return picked ? savePlugin(await readPicked(picked), 'carpeta local') : null;
  },
};

/** Comandos para el chat: los de los plugins activos y cada skill como /nombre. */
export async function commands() {
  const out = await plugins.commands();
  const taken = new Set(out.map((c) => c.name));
  for (const s of [...(await skills.list()), ...(await plugins.skills())]) {
    if (taken.has(s.name)) continue;
    taken.add(s.name);
    const body = (await skills.read(s.name)) ?? (await plugins.readSkill(s.name));
    if (body) out.push({ name: s.name, description: `skill · ${String(s.description).replace(/\s+/g, ' ').slice(0, 100)}`, body: `Aplica la skill «${s.name}». Sus instrucciones:\n\n<skill>\n${body.slice(0, 60000)}\n</skill>\n\nTarea: $ARGUMENTS`, skill: true });
  }
  return out;
}
