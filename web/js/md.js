// Markdown mínimo y seguro: todo se escapa antes de dar formato; los enlaces solo aceptan http(s).
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

function table(lines) {
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  // envoltorio desplazable (las tablas anchas no rompen la pantalla) y copiar como CSV o Markdown
  return `<div class="table-wrap"><div class="tb-head"><button type="button" data-copy-table="csv">CSV</button><button type="button" data-copy-table="md">MD</button></div><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function blocks(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w.+#-]*)/);
    if (fence) {
      const lang = fence[1] || 'texto';
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<div class="codeblock"><div class="cb-head"><span>${esc(lang.toUpperCase())}</span><span class="cb-acts">${body.length > 24 ? '<button type="button" data-expand>AMPLIAR</button>' : ''}<button type="button" data-copy>COPIAR</button></span></div><pre><code>${esc(body.join('\n'))}</code></pre></div>`);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const n = line.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(line.replace(/^#+\s*/, ''))}</h${n}>`);
      i++; continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const t = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) t.push(lines[i++]);
      out.push(table(t));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,3}\s|>|([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('');
}

/** Separa el razonamiento (<think>) del texto final y devuelve HTML. */
export function renderMarkdown(text, reasoning = '') {
  let thinking = reasoning;
  let body = text;
  const open = body.indexOf('<think>');
  if (open >= 0) {
    const close = body.indexOf('</think>', open);
    thinking += body.slice(open + 7, close >= 0 ? close : undefined);
    body = body.slice(0, open) + (close >= 0 ? body.slice(close + 8) : '');
  }
  const think = thinking.trim()
    ? `<details class="think"><summary>RAZONAMIENTO</summary>${blocks(thinking.trim())}</details>` : '';
  return think + blocks(body.trim());
}

export { esc };
