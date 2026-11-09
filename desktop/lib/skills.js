// Skills: carpetas con SKILL.md (frontmatter name/description) en <userData>/skills/<id>/.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return meta;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';

function create(dir) {
  async function list() {
    await fs.mkdir(dir, { recursive: true });
    const out = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const text = await fs.readFile(path.join(dir, e.name, 'SKILL.md'), 'utf8').catch(() => null);
      if (text == null) continue;
      const meta = parseFrontmatter(text);
      out.push({ id: e.name, name: meta.name || e.name, description: meta.description || '(sin descripción)' });
    }
    return out;
  }

  async function read(name) {
    const skills = await list();
    const s = skills.find((x) => x.name === name || x.id === name);
    if (!s) throw new Error(`skill no encontrada: ${name}. Instaladas: ${skills.map((x) => x.name).join(', ') || 'ninguna'}`);
    const root = path.join(dir, s.id);
    const text = await fs.readFile(path.join(root, 'SKILL.md'), 'utf8');
    const extra = (await fs.readdir(root, { recursive: true })).filter((f) => f !== 'SKILL.md');
    return `${text}\n\n(archivos de la skill en ${root}: ${extra.join(', ') || 'ninguno'})`;
  }

  async function remove(id) {
    const target = path.join(dir, slug(id));
    if (path.dirname(target) !== dir) throw new Error('id inválido');
    await fs.rm(target, { recursive: true, force: true });
    return true;
  }

  /** Copia cada carpeta que contenga SKILL.md (la raíz o subcarpetas de primer/segundo nivel). */
  async function installFrom(srcRoot) {
    const found = [];
    async function scan(d, depth) {
      if (await fs.stat(path.join(d, 'SKILL.md')).catch(() => null)) { found.push(d); return; }
      if (depth >= 2) return;
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') await scan(path.join(d, e.name), depth + 1);
      }
    }
    await scan(srcRoot, 0);
    if (!found.length) throw new Error('no se encontró ningún SKILL.md');
    await fs.mkdir(dir, { recursive: true });
    const names = [];
    for (const d of found) {
      const meta = parseFrontmatter(await fs.readFile(path.join(d, 'SKILL.md'), 'utf8'));
      const id = slug(meta.name || path.basename(d));
      await fs.rm(path.join(dir, id), { recursive: true, force: true });
      await fs.cp(d, path.join(dir, id), { recursive: true, filter: (p) => !p.includes(`${path.sep}.git`) });
      names.push(meta.name || id);
    }
    return names.join(', ');
  }

  async function installUrl(url, tmpDir) {
    let u;
    try { u = new URL(url); } catch { throw new Error('URL inválida'); }
    if (u.protocol !== 'https:') throw new Error('solo se aceptan URLs https');
    if (/SKILL\.md$/i.test(u.pathname)) {
      const raw = u.hostname === 'github.com' ? url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/') : url;
      const res = await fetch(raw);
      if (!res.ok) throw new Error(`descarga fallida (${res.status})`);
      const text = await res.text();
      const meta = parseFrontmatter(text);
      if (!meta.name) throw new Error('el SKILL.md no tiene "name" en el encabezado');
      const id = slug(meta.name);
      await fs.mkdir(path.join(dir, id), { recursive: true });
      await fs.writeFile(path.join(dir, id, 'SKILL.md'), text, 'utf8');
      return meta.name;
    }
    // repositorio git: clon superficial con argumentos separados (sin shell)
    const dest = path.join(tmpDir, `skill-${Date.now()}`);
    await new Promise((resolve, reject) => {
      execFile('git', ['clone', '--depth', '1', '--', url, dest], { timeout: 120000, windowsHide: true },
        (err, _o, stderr) => (err ? reject(new Error('git clone falló: ' + (stderr || err.message).slice(0, 300))) : resolve()));
    });
    try { return await installFrom(dest); } finally { await fs.rm(dest, { recursive: true, force: true }); }
  }

  return { list, read, remove, installFrom, installUrl };
}

module.exports = { create, parseFrontmatter };
