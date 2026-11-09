// Modo CODE (estilo Abacus): el modelo devuelve archivos completos en bloques marcados,
// que se reflejan en el árbol de archivos mientras llegan. No se ejecuta nada en la PC.

export const CODE_SYSTEM = `Eres Jean, un generador de proyectos de software.
Cuando el usuario describa o pida cambios en un proyecto, responde con una explicación breve
y después con CADA archivo creado o modificado, completo, usando exactamente este formato:

<<<FILE ruta/relativa/archivo.ext>>>
contenido completo del archivo
<<<END>>>

Para borrar un archivo usa una línea: <<<DELETE ruta/relativa/archivo.ext>>>
Reglas:
- Rutas relativas, con "/", sin "..".
- Escribe siempre el archivo entero, nunca fragmentos ni "...resto igual".
- Incluye lo necesario para ejecutar el proyecto (package.json, requirements.txt, README.md).
- No pongas los archivos dentro de bloques \`\`\`.`;

const FILE_RE = /<<<FILE\s+([^>\n]+?)\s*>>>\n?([\s\S]*?)(?:<<<END>>>|$)/g;
const DEL_RE = /<<<DELETE\s+([^>\n]+?)\s*>>>/g;

export function safePath(p) {
  const clean = String(p).trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
  if (!clean || clean.split('/').some((s) => s === '..' || s === '')) return null;
  return clean;
}

/** Devuelve { files: {ruta: contenido}, deletes: [ruta], prose: texto sin bloques, open: ruta en curso } */
export function parseFiles(text) {
  const files = {};
  const deletes = [];
  let open = null;
  for (const m of text.matchAll(FILE_RE)) {
    const p = safePath(m[1]);
    if (!p) continue;
    const complete = m[0].endsWith('<<<END>>>');
    files[p] = m[2].replace(/\n$/, '');
    if (!complete) open = p;
  }
  for (const m of text.matchAll(DEL_RE)) {
    const p = safePath(m[1]);
    if (p) deletes.push(p);
  }
  const prose = text.replace(FILE_RE, (_, p) => `\n\`${safePath(p) || p}\` · escrito\n`).replace(DEL_RE, (_, p) => `\n\`${p}\` · borrado\n`).trim();
  return { files, deletes, prose, open };
}

/** Contexto del proyecto actual para pedir cambios (recorta archivos grandes). */
export function projectContext(files, budget = 24000) {
  const entries = Object.entries(files);
  if (!entries.length) return '';
  let out = 'PROYECTO ACTUAL (archivos existentes):\n';
  let used = 0;
  for (const [p, c] of entries) {
    const chunk = c.length + used > budget ? c.slice(0, Math.max(0, budget - used)) + '\n…(recortado)' : c;
    used += chunk.length;
    out += `\n<<<FILE ${p}>>>\n${chunk}\n<<<END>>>\n`;
    if (used >= budget) { out += '\n(otros archivos omitidos por tamaño: ' + entries.map((e) => e[0]).join(', ') + ')\n'; break; }
  }
  return out;
}

/** HTML para la vista previa: incrusta CSS y JS locales referenciados por el index. */
export function buildPreview(files, path) {
  const html = files[path];
  if (html == null) return null;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const resolve = (ref) => safePath(dir + ref.replace(/^\.\//, ''));
  return html
    .replace(/<link[^>]+href=["']([^"':]+\.css)["'][^>]*>/gi, (m, href) => {
      const f = files[resolve(href)];
      return f != null ? `<style>${f}</style>` : m;
    })
    .replace(/<script([^>]*)\ssrc=["']([^"':]+\.js)["']([^>]*)><\/script>/gi, (m, a, src, b) => {
      const f = files[resolve(src)];
      return f != null ? `<script${a}${b}>${f.replace(/<\/script/gi, '<\\/script')}</script>` : m;
    });
}
