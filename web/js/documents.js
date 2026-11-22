// Documentos adjuntos: se convierten a texto aquí, en el navegador, y viajan dentro del mensaje.
// Así sirven con cualquier modelo, también con los que no ven imágenes.
export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const MAX_DOC_CHARS = 120000; // ~30k tokens por documento; más se recorta con aviso

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|ipynb|java|kt|c|h|cc|cpp|hpp|cs|go|rs|rb|php|swift|sh|bash|zsh|ps1|bat|sql|ya?ml|toml|ini|cfg|conf|env|log|tex|rtf|srt|vtt|r|lua|dart|scala|vue|svelte|gradle|properties)$/i;
const OFFICE_EXT = /\.(docx|xlsx|pptx|odt)$/i;

/** Extensiones que acepta el selector de archivos (además de las imágenes). */
export const DOC_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.odt,.txt,.md,.csv,.tsv,.json,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.yaml,.yml,.toml,.log,.ipynb,text/*,application/pdf,application/json';

export const isDocument = (f) => !f.type.startsWith('image/') && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || OFFICE_EXT.test(f.name) || TEXT_EXT.test(f.name) || f.type.startsWith('text/') || f.type === 'application/json');

/** Texto del documento. Lanza un Error con un mensaje legible si no se puede leer. */
export async function readDocument(file) {
  if (file.size > MAX_DOC_BYTES) throw new Error('El documento pasa de 25 MB.');
  let text;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) text = await readPdf(file);
  else if (OFFICE_EXT.test(file.name)) text = await readOffice(file);
  else text = await file.text();
  text = text.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!text) throw new Error(/\.pdf$/i.test(file.name) ? 'El PDF no tiene texto (¿es un escaneo? Adjúntalo como imagen).' : 'El documento está vacío.');
  const cut = text.length > MAX_DOC_CHARS;
  return { name: file.name || 'documento', text: cut ? `${text.slice(0, MAX_DOC_CHARS)}\n[… documento recortado: ${text.length - MAX_DOC_CHARS} caracteres más]` : text, cut };
}

async function readPdf(file) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    pages.push(`--- página ${n} ---\n` + c.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n'));
    if (pages.join('').length > MAX_DOC_CHARS * 1.2) break;
  }
  await doc.destroy();
  return pages.join('\n\n').replace(/--- página \d+ ---\n\s*(?=---|$)/g, '');
}

/* Office (docx/xlsx/pptx/odt) son zips con XML dentro: se leen sin librerías. */
async function unzip(buf) {
  const v = new DataView(buf);
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('El archivo está dañado o no es un documento de Office.');
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nl));
    p += 46 + nl + xl + cl;
    if (!/\.xml$/.test(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Uint8Array(buf, start, size);
    out.set(name, async () => {
      if (method === 0) return dec.decode(raw);
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(s).text();
    });
  }
  return out;
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const paraText = (xml, para, run) => xml.split(para).map((p) => [...p.matchAll(run)].map((m) => unxml(m[1])).join('')).filter((s) => s.trim()).join('\n');

async function readOffice(file) {
  const z = await unzip(await file.arrayBuffer());
  const get = async (n) => (z.has(n) ? z.get(n)() : '');
  const num = (n) => +(n.match(/(\d+)\.xml$/)?.[1] || 0);
  if (/\.docx$/i.test(file.name)) {
    const xml = (await get('word/document.xml')).replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>');
    return paraText(xml, /<\/w:p>/, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g);
  }
  if (/\.odt$/i.test(file.name)) return (await get('content.xml')).replace(/<text:tab\/>/g, '\t').split(/<\/text:(?:p|h)>/).map((p) => unxml(p.replace(/<[^>]+>/g, ''))).filter((p) => p.trim()).join('\n');
  if (/\.pptx$/i.test(file.name)) {
    const slides = [...z.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    const out = [];
    for (const s of slides) out.push(`--- diapositiva ${num(s)} ---\n` + paraText(await get(s), /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g));
    return out.join('\n\n');
  }
  // xlsx: textos compartidos + celdas de cada hoja, en CSV
  const shared = [...(await get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => unxml(t[1])).join(''));
  const sheets = [...z.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out = [];
  for (const s of sheets) {
    const rows = [...(await get(s)).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? '';
      const val = /t="s"/.test(c[1]) ? shared[+v] ?? '' : unxml(v);
      return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(','));
    out.push(`--- hoja ${num(s)} ---\n` + rows.join('\n'));
  }
  return out.join('\n\n');
}

/** Bloque que se añade al mensaje para el modelo. */
export const docBlock = (docs) => docs.map((d) => `\n\n<documento nombre="${d.name.replace(/"/g, "'")}">\n${d.text}\n</documento>`).join('');

/** Separa el texto que escribió el usuario de los documentos adjuntos (para mostrarlo). */
export function splitDocs(content) {
  if (typeof content !== 'string' || !content.includes('<documento nombre="')) return { text: content, names: [] };
  const names = [];
  const text = content.replace(/\n*<documento nombre="([^"]*)">[\s\S]*?<\/documento>/g, (_, n) => { names.push(n); return ''; }).trim();
  return { text, names };
}
