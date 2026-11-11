// Ajustes → Apps: conexiones con otras apps (MCP). Solo escritorio: las conexiones viven en el
// proceso principal (tokens cifrados, OAuth con el navegador del sistema, programas locales).
import { CONNECTORS, CATEGORIES, connectorById, definitionFor } from './connectors.js';

const AUTH_LABEL = { none: 'sin cuenta', oauth: 'un clic · autorizas en el navegador', token: 'con token', google: 'cuenta de Google', local: 'programa en esta PC' };

export function initApps({ $, esc, toast, desktop, confirmDialog }) {
  const pane = $('#apps-pane');
  if (!pane || !desktop?.mcp) return { refresh: async () => {} };
  let servers = [];
  let busy = new Set();

  const statusOf = (s) => (busy.has(s.id) ? ['warn', 'conectando…'] : s.status === 'ready' ? ['ok', `${s.tools.length} herramientas`]
    : s.status === 'error' ? ['bad', s.error || 'error'] : ['', s.authorized || s.preset ? 'desconectada' : 'desconectada']);

  function render() {
    const mine = $('#apps-list');
    mine.innerHTML = servers.length ? servers.map((s) => {
      const [cls, text] = statusOf(s);
      const ready = s.status === 'ready';
      return `<li data-id="${esc(s.id)}">
        <span class="status ${cls}" aria-hidden="true"></span>
        <span class="ep-prov">${esc(s.name)}</span>
        <span class="ep-url" title="${esc(text)}">${esc(text)}</span>
        <button class="btn ghost sm" type="button" data-act="${ready ? 'off' : 'on'}">${ready ? 'Desconectar' : 'Conectar'}</button>
        ${ready ? `<button class="btn ghost sm" type="button" data-act="tools">Ver</button>` : ''}
        <button class="btn ghost sm" type="button" data-act="rm" aria-label="Quitar ${esc(s.name)}">Quitar</button>
        <div class="apps-tools mono" hidden>${s.tools.map((t) => `<div>${esc(t.name)}${t.readOnly ? ' · solo lee' : ''}<span class="fine"> ${esc(t.description.slice(0, 110))}</span></div>`).join('')}</div>
      </li>`;
    }).join('') : '<li class="fine">Todavía no hay apps conectadas. Elige una abajo.</li>';

    const added = new Set(servers.map((s) => s.preset).filter(Boolean));
    $('#apps-catalog').innerHTML = CATEGORIES.map((cat) => {
      const items = CONNECTORS.filter((c) => c.category === cat);
      return `<h4 class="apps-cat">${esc(cat)}</h4><ul class="rows">${items.map((c) => `<li data-preset="${esc(c.id)}">
        <span class="ep-prov">${esc(c.name)}</span>
        <span class="ep-url apps-desc">${esc(c.desc)}</span>
        <span class="ep-meta">${esc(AUTH_LABEL[c.auth])}${c.needs ? ` · necesita ${esc(c.needs)}` : ''}</span>
        ${added.has(c.id) ? '<span class="ep-meta">añadida</span>' : '<button class="btn sm" type="button" data-act="add">Añadir</button>'}
        <form class="apps-ask add-form" hidden></form>
      </li>`).join('')}</ul>`;
    }).join('');
  }

  async function refresh() {
    servers = await desktop.mcp.list().catch(() => []);
    render();
  }

  async function connect(id) {
    busy.add(id); render();
    const s = servers.find((x) => x.id === id);
    if (s && !s.authorized && ['oauth', 'google'].includes(connectorById(s.preset)?.auth || '')) toast('SE ABRE EL NAVEGADOR PARA AUTORIZAR');
    try {
      const r = await desktop.mcp.connect(id);
      toast(r?.status === 'ready' ? `${r.name.toUpperCase()} · ${r.tools.length} HERRAMIENTAS` : `NO SE PUDO CONECTAR: ${(r?.error || '').toUpperCase().slice(0, 80)}`);
    } finally { busy.delete(id); await refresh(); }
  }

  /** Formulario en línea para lo que pida la conexión (token, cliente de Google, carpeta...). */
  function askFor(li, c) {
    const form = $('.apps-ask', li);
    const fields = [];
    if (c.auth === 'token') fields.push(`<input name="token" type="password" placeholder="${esc(c.tokenHint)}" autocomplete="off" spellcheck="false">${c.tokenUrl ? `<a class="fine" href="${esc(c.tokenUrl)}" target="_blank" rel="noopener">crear token ↗</a>` : ''}`);
    if (c.auth === 'google') fields.push('<input name="clientId" type="text" placeholder="ID de cliente (….apps.googleusercontent.com)" autocomplete="off" spellcheck="false"><input name="clientSecret" type="password" placeholder="secreto del cliente" autocomplete="off" spellcheck="false"><a class="fine" href="https://github.com/jeancodeeer/JeanCode/blob/main/docs/apps.md#google" target="_blank" rel="noopener">cómo crearlo (una vez) ↗</a>');
    for (const [k, label] of Object.entries(c.ask || {})) fields.push(`<input name="${esc(k)}" type="text" placeholder="${esc(label)}" spellcheck="false">`);
    if (!fields.length) return null;
    form.innerHTML = `${fields.join('')}<button class="btn sm" type="submit">Conectar</button>`;
    form.hidden = false;
    $('input', form)?.focus();
    return form;
  }

  async function add(c, values = {}) {
    if (c.type === 'stdio') {
      const ok = await confirmDialog({ title: 'EJECUTAR UN PROGRAMA', command: `${c.command} ${c.args.join(' ')}\n\nEsta conexión arranca un programa en tu PC cada vez que JeanCode se conecta. Viene del catálogo oficial de servidores MCP.` });
      if (!ok) return;
    }
    const def = definitionFor(c, { token: values.token, clientId: values.clientId, clientSecret: values.clientSecret, answers: values });
    const id = await desktop.mcp.save(def);
    await refresh();
    await connect(id);
  }

  pane.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const li = b.closest('li');
    try {
      if (b.dataset.act === 'add') {
        const c = connectorById(li.dataset.preset);
        if (!askFor(li, c)) await add(c);
        return;
      }
      const id = li.dataset.id;
      if (b.dataset.act === 'on') await connect(id);
      if (b.dataset.act === 'off') { await desktop.mcp.disconnect(id); await refresh(); }
      if (b.dataset.act === 'tools') { const t = $('.apps-tools', li); t.hidden = !t.hidden; }
      if (b.dataset.act === 'rm') {
        const s = servers.find((x) => x.id === id);
        if (await confirmDialog({ title: 'QUITAR CONEXIÓN', command: `Se borra «${s?.name}» y sus credenciales guardadas en este equipo.` })) { await desktop.mcp.remove(id); await refresh(); }
      }
    } catch (err) { toast(String(err.message || err).toUpperCase().slice(0, 120)); }
  });

  pane.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      if (form.id === 'apps-custom') {
        const v = Object.fromEntries(new FormData(form));
        const target = String(v.target || '').trim();
        const def = /^https?:\/\//.test(target)
          ? { name: v.name, type: 'http', url: target, headers: v.header ? { Authorization: String(v.header).trim().replace(/^(?!Bearer\s)/i, 'Bearer ') } : {} }
          : { name: v.name, type: 'stdio', command: target.split(/\s+/)[0], args: target.split(/\s+/).slice(1) };
        if (def.type === 'stdio' && !(await confirmDialog({ title: 'EJECUTAR UN PROGRAMA', command: `${target}\n\nSe ejecutará en tu PC cada vez que JeanCode se conecte. Añade solo servidores MCP en los que confíes.` }))) return;
        const id = await desktop.mcp.save(def);
        form.reset();
        await refresh();
        await connect(id);
        return;
      }
      const li = form.closest('li[data-preset]');
      if (li) await add(connectorById(li.dataset.preset), Object.fromEntries(new FormData(form)));
    } catch (err) { toast(String(err.message || err).toUpperCase().slice(0, 120)); }
  });

  // al abrir la app, las conexiones que no necesitan navegador se activan solas
  setTimeout(() => desktop.mcp.connectAll().then(refresh).catch(refresh), 3000);
  return { refresh };
}
