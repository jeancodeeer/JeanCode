// Encabezado YAML de un SKILL.md o de un agente/comando (name, description…). Igual que desktop/lib/skills.js.
export function parseFrontmatter(text) {
  const m = String(text || '').replace(/\r\n/g, '\n').match(/^---\s*\n([\s\S]*?)\n---/);
  const meta = {};
  let key = null;
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      key = kv[1];
      meta[key] = /^[>|][+-]?$/.test(kv[2].trim()) ? '' : kv[2].replace(/^["']|["']$/g, '').trim();
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim();
    }
  }
  return meta;
}
