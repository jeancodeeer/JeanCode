// Código que corre DENTRO del iframe de ejecución (sandbox="allow-scripts allow-forms allow-modals",
// origen opaco: no ve las claves, el historial ni el almacenamiento de JeanCode).
// run.js inyecta estas funciones con Function.prototype.toString(): cada una solo puede usar
// las demás funciones jc* de este archivo y de batch.js. No importes nada aquí.

/** Resuelve `ref` (tal como aparece en `from`) a una ruta del proyecto. null = externa (http:, data:, #…). */
export function jcNorm(from, ref) {
  let s = String(ref ?? '').trim();
  if (!s || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(s)) return null;
  s = s.replace(/[?#].*$/, '').replace(/\\/g, '/');
  if (!s) return null;
  const parts = s.startsWith('/') ? [] : String(from || '').split('/').slice(0, -1);
  for (let seg of s.split('/')) {
    try { seg = decodeURIComponent(seg); } catch { /* se deja tal cual */ }
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

export function jcMime(path) {
  const ext = String(path).toLowerCase().split('.').pop();
  return ({
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
    json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml',
    xml: 'application/xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', wasm: 'application/wasm',
  })[ext] || 'text/plain';
}

/** Reescribe url(...) e @import de una hoja de estilos. `link(ruta, tipo)` devuelve la URL servida o null. */
export function jcCss(css, from, link) {
  return String(css)
    .replace(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi, (m, q, ref) => {
      const u = link(jcNorm(from, ref), 'css');
      return u ? `@import url("${u}")` : m;
    })
    .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (m, q, ref) => {
      if (/^blob:/i.test(ref)) return m;
      const u = link(jcNorm(from, ref), 'raw');
      return u ? `url("${u}")` : m;
    });
}

/** Reescribe los import/export relativos de un módulo ES (estáticos y dinámicos con literal). */
export function jcImports(js, from, link) {
  return String(js).replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g, (m, head, q, ref) => {
    if (!/^(?:\.{1,2}\/|\/)/.test(ref)) return m;
    const u = link(jcNorm(from, ref), 'module');
    return u ? `${head}${q}${u}${q}` : m;
  });
}

/** Almacenamiento en memoria para el origen opaco (localStorage lanza SecurityError ahí). */
export function jcStorage(initial, onChange) {
  const data = new Map(Object.entries(initial || {}));
  const api = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => { data.set(String(k), String(v)); onChange && onChange(Object.fromEntries(data)); },
    removeItem: (k) => { data.delete(String(k)); onChange && onChange(Object.fromEntries(data)); },
    clear: () => { data.clear(); onChange && onChange({}); },
  };
  return new Proxy(api, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? t.getItem(k) ?? undefined : undefined),
    set: (t, k, v) => { if (k in t) return false; t.setItem(k, v); return true; },
    deleteProperty: (t, k) => { t.removeItem(k); return true; },
    has: (t, k) => k in t || data.has(String(k)),
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (t, k) => (data.has(String(k)) ? { value: data.get(String(k)), enumerable: true, configurable: true, writable: true } : undefined),
  });
}

/** Convierte cualquier valor en texto legible para la consola. */
export function jcFormat(args) {
  const one = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    if (typeof v === 'function') return `[Function ${v.name || '(anónima)'}]`;
    if (v === undefined) return 'undefined';
    try {
      const seen = new WeakSet();
      return JSON.stringify(v, (k, x) => {
        if (typeof x === 'bigint') return `${x}n`;
        if (x && typeof x === 'object') { if (seen.has(x)) return '[Circular]'; seen.add(x); }
        return x;
      }, 2) ?? String(v);
    } catch { return String(v); }
  };
  const list = [...args];
  if (typeof list[0] === 'string' && /%[sdifoOjc%]/.test(list[0])) {
    const fmt = list.shift();
    const head = fmt.replace(/%([sdifoOjc%])/g, (m, c) => {
      if (c === '%') return '%';
      if (!list.length) return m;
      const v = list.shift();
      if (c === 'c') return '';
      if (c === 'd' || c === 'i') return String(parseInt(v, 10));
      if (c === 'f') return String(parseFloat(v));
      return one(v);
    });
    return [head, ...list.map(one)].join(' ');
  }
  return list.map(one).join(' ');
}

/** Consola de texto (Python, Node, Batch, programas del PC). Devuelve { write, readLine, clear, … }. */
export function jcConsole(title) {
  const css = `
    html,body{margin:0;height:100%;background:#000;color:#f2f1ec}
    body{display:grid;grid-template-rows:auto minmax(0,1fr) auto;font:13px/1.55 "IBM Plex Mono",ui-monospace,Consolas,monospace}
    .jc-bar{display:flex;gap:12px;align-items:center;padding:8px 12px;border-bottom:1px solid #232323;color:#7f7e78;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
    .jc-bar b{color:#f2f1ec;font-weight:500}.jc-bar .st{margin-left:auto}
    .jc-out{margin:0;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word}
    .jc-err{color:#ff8a80}.jc-dim{color:#7f7e78}.jc-in{color:#cfe8b8}
    form{display:flex;border-top:1px solid #232323}form[hidden]{display:none}
    form span{padding:10px 0 10px 12px;color:#cfe8b8}
    input{flex:1;min-width:0;background:#000;color:#f2f1ec;border:0;outline:0;padding:10px 12px;font:inherit}
    input:focus{background:#0b0b0b}`;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
  document.body.innerHTML = '<div class="jc-bar"><b></b><span class="st"></span></div><pre class="jc-out" role="log" aria-live="polite"></pre><form hidden><span>›</span><input autocomplete="off" spellcheck="false" aria-label="Entrada del programa"></form>';
  const out = document.querySelector('.jc-out');
  const form = document.querySelector('form');
  const input = document.querySelector('input');
  document.querySelector('.jc-bar b').textContent = title;
  let waiting = null;
  const pending = [];
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    if (waiting) { const w = waiting; waiting = null; form.hidden = true; api.write(v + '\n', 'in'); w(v); }
    else pending.push(v);
  });
  const api = {
    out,
    write(text, cls) {
      // sin códigos de color ANSI; \r suelto (barras de progreso) no rompe la salida
      const s = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '');
      if (!s) return;
      const last = out.lastChild;
      if (!cls && last && last.nodeType === 3) last.data += s;
      else if (cls) { const sp = document.createElement('span'); sp.className = `jc-${cls}`; sp.textContent = s; out.append(sp); }
      else out.append(document.createTextNode(s));
      if (out.textContent.length > 400000) out.firstChild && out.firstChild.remove();
      out.scrollTop = out.scrollHeight;
    },
    /** Texto de la última línea sin terminar (sirve de pregunta para prompt()). */
    tail() { const t = out.textContent; return t.slice(t.lastIndexOf('\n') + 1); },
    readLine() {
      if (pending.length) return Promise.resolve(pending.shift());
      form.hidden = false;
      input.focus();
      return new Promise((r) => { waiting = r; });
    },
    clear() { out.textContent = ''; },
    status(text) { document.querySelector('.jc-bar .st').textContent = text || ''; },
    title(text) { document.querySelector('.jc-bar b').textContent = text; },
    colors(fg, bg) { document.body.style.color = fg || ''; document.body.style.background = bg || ''; input.style.background = bg || ''; },
  };
  return api;
}

/**
 * Arranque del iframe. FILES = { ruta: contenido } de TODO el proyecto, ENTRY = archivo a ejecutar,
 * OPTS = { token, mode: 'html'|'node'|'python'|'batch'|'remote', storage, pyodide, title }.
 * Monta el proyecto como un sistema de archivos virtual: <script src>, <link>, módulos ES,
 * fetch(), XMLHttpRequest, imágenes SVG, url() de CSS y enlaces entre páginas salen de FILES.
 */
export function jcBoot(FILES, ENTRY, OPTS) {
  const post = (m) => { try { parent.postMessage({ jc: OPTS.token, ...m }, '*'); } catch { /* sin padre */ } };
  const urls = Object.create(null);
  const back = Object.create(null); // blob: -> ruta, para que los errores digan "app.js:12"
  const busy = Object.create(null);

  function link(path, kind) {
    if (path == null || !Object.prototype.hasOwnProperty.call(FILES, path)) return null;
    const isJs = /\.(m?js|cjs|jsx)$/i.test(path);
    const isCss = /\.css$/i.test(path);
    const k = (isJs && kind === 'module' ? 'module' : isCss ? 'css' : 'raw') + ':' + path;
    if (urls[k]) return urls[k];
    if (busy[k]) return null; // importación circular: se queda la ruta original
    busy[k] = 1;
    let body = FILES[path];
    if (isCss) body = jcCss(body, path, link);
    else if (k.startsWith('module:')) body = jcImports(body, path, link);
    if (isJs) body += `\n//# sourceURL=${path}`;
    const u = URL.createObjectURL(new Blob([body], { type: isJs ? 'text/javascript' : jcMime(path) }));
    delete busy[k];
    back[u] = path;
    urls[k] = u;
    return u;
  }
  const where = (src) => (src && back[src]) || (src && /^about:srcdoc/.test(src) ? ENTRY : src) || '';
  window.__jc = { FILES, ENTRY, link, post, norm: jcNorm };

  // --- consola y errores -> panel CONSOLA de JeanCode
  const con = window.console;
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
    const orig = con[level] ? con[level].bind(con) : () => {};
    con[level] = (...a) => { orig(...a); post({ type: 'log', level, text: jcFormat(a) }); };
  });
  window.addEventListener('error', (e) => {
    const at = e.filename ? ` (${where(e.filename)}:${e.lineno})` : '';
    post({ type: 'log', level: 'error', text: `${e.message || 'Error'}${at}` });
  });
  window.addEventListener('unhandledrejection', (e) => post({ type: 'log', level: 'error', text: `Promesa rechazada: ${jcFormat([e.reason])}` }));

  // --- almacenamiento: el origen opaco no tiene localStorage; se simula y se conserva entre ejecuciones
  const stores = { localStorage: OPTS.storage || {}, sessionStorage: {} };
  for (const name of Object.keys(stores)) {
    let ok = false;
    try { ok = !!window[name] && typeof window[name].length === 'number'; } catch { ok = false; }
    if (ok) continue;
    const s = jcStorage(stores[name], name === 'localStorage' ? (data) => post({ type: 'storage', data }) : null);
    try { Object.defineProperty(window, name, { configurable: true, get: () => s }); } catch { /* sin simulación */ }
  }

  // --- red local: fetch/XHR/Worker y asignaciones dinámicas de src/href leen del proyecto
  const BASE = new URL('.', document.baseURI).href;
  // Rutas relativas -> siempre del proyecto (si no existen, 404 sin salir a la red).
  // URL absolutas bajo la base del iframe (p. ej. un Request ya resuelto) -> del proyecto solo si existen.
  const local = (input) => {
    const s = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    if (typeof s !== 'string') return null;
    if (s.startsWith(BASE)) { const p = jcNorm(ENTRY, s.slice(BASE.length)); return p != null && Object.prototype.hasOwnProperty.call(FILES, p) ? p : null; }
    return jcNorm(ENTRY, s);
  };
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    const p = local(input);
    if (p == null) return realFetch(input, init);
    if (!Object.prototype.hasOwnProperty.call(FILES, p)) return Promise.resolve(new Response(`No existe en el proyecto: ${p}`, { status: 404, statusText: 'Not Found', headers: { 'content-type': 'text/plain' } }));
    return Promise.resolve(new Response(FILES[p], { status: 200, statusText: 'OK', headers: { 'content-type': jcMime(p) } }));
  };
  const xopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const p = local(url);
    return xopen.call(this, method, (p != null && link(p, 'raw')) || url, ...rest);
  };
  if (window.Worker) {
    const W = window.Worker;
    window.Worker = function (url, o) { const p = local(url); return new W((p != null && link(p, o && o.type === 'module' ? 'module' : 'raw')) || url, o); };
    window.Worker.prototype = W.prototype;
  }
  const kindOf = (el, attr) => (el.localName === 'script' ? (el.type === 'module' ? 'module' : 'raw') : el.localName === 'link' && /stylesheet/i.test(el.rel) ? 'css' : el.localName === 'link' && /modulepreload/i.test(el.rel) ? 'module' : attr === 'href' && el.localName !== 'link' ? null : 'raw');
  const mapUrl = (el, attr, v) => {
    const k = kindOf(el, attr);
    if (!k || typeof v !== 'string') return v;
    const p = local(v);
    return (p != null && link(p, k)) || v;
  };
  [['HTMLScriptElement', 'src'], ['HTMLImageElement', 'src'], ['HTMLMediaElement', 'src'], ['HTMLSourceElement', 'src'],
    ['HTMLLinkElement', 'href'], ['HTMLEmbedElement', 'src'], ['HTMLTrackElement', 'src']].forEach(([C, prop]) => {
    const proto = window[C] && window[C].prototype;
    const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { ...d, set(v) { d.set.call(this, mapUrl(this, prop, v)); } });
  });
  const setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name).toLowerCase();
    return setAttr.call(this, name, n === 'src' || n === 'href' ? mapUrl(this, n, String(value)) : value);
  };

  // --- enlaces y formularios: las páginas del proyecto se abren en la misma vista
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    const raw = a.getAttribute('href');
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return;
    const p = jcNorm(ENTRY, raw);
    if (p == null) { e.preventDefault(); post({ type: 'external', url: a.href }); return; }
    e.preventDefault();
    post({ type: 'nav', path: p, hash: (raw.match(/#.*$/) || [''])[0] });
  });
  window.addEventListener('submit', (e) => {
    // nunca se navega fuera (dejaría la vista en blanco); si apunta a otra página del proyecto, se abre
    e.preventDefault();
    const f = e.target;
    const action = f && f.getAttribute && f.getAttribute('action');
    const p = action ? jcNorm(ENTRY, action) : null;
    if (p && /\.html?$/i.test(p) && p !== ENTRY) setTimeout(() => post({ type: 'nav', path: p }), 0);
  }, true);

  const mode = OPTS.mode;
  if (mode === 'html') {
    const doc = new DOMParser().parseFromString(FILES[ENTRY] ?? '', 'text/html');
    const rew = (el, attr, kind) => {
      const v = el.getAttribute(attr);
      const u = v != null ? link(jcNorm(ENTRY, v), kind) : null;
      if (u) el.setAttribute(attr, u);
    };
    doc.querySelectorAll('script[src]').forEach((el) => rew(el, 'src', el.type === 'module' ? 'module' : 'raw'));
    doc.querySelectorAll('script[type=module]:not([src])').forEach((el) => { el.textContent = jcImports(el.textContent, ENTRY, link); });
    doc.querySelectorAll('link[href]').forEach((el) => rew(el, 'href', /stylesheet/i.test(el.rel) ? 'css' : /modulepreload/i.test(el.rel) ? 'module' : 'raw'));
    doc.querySelectorAll('img[src],source[src],audio[src],video[src],track[src],embed[src],input[src]').forEach((el) => rew(el, 'src', 'raw'));
    doc.querySelectorAll('video[poster]').forEach((el) => rew(el, 'poster', 'raw'));
    doc.querySelectorAll('object[data]').forEach((el) => rew(el, 'data', 'raw'));
    doc.querySelectorAll('img[srcset],source[srcset]').forEach((el) => {
      el.setAttribute('srcset', el.getAttribute('srcset').split(',').map((part) => {
        const [u, ...d] = part.trim().split(/\s+/);
        return [link(jcNorm(ENTRY, u), 'raw') || u, ...d].join(' ');
      }).join(', '));
    });
    doc.querySelectorAll('iframe[src]').forEach((el) => {
      const p = jcNorm(ENTRY, el.getAttribute('src'));
      if (p && /\.html?$/i.test(p) && p in FILES) el.setAttribute('src', link(p, 'raw'));
    });
    doc.querySelectorAll('style').forEach((el) => { el.textContent = jcCss(el.textContent, ENTRY, link); });
    doc.querySelectorAll('[style]').forEach((el) => el.setAttribute('style', jcCss(el.getAttribute('style'), ENTRY, link)));
    for (const a of doc.documentElement.attributes) document.documentElement.setAttribute(a.name, a.value);
    // Este script está en <head> y el analizador sigue después de él: lo escrito continúa el documento
    document.write(`${doc.head.innerHTML}</head>${doc.body.outerHTML}</html>`);
    return;
  }

  document.write('</head><body></body></html>');
  document.addEventListener('DOMContentLoaded', () => {
    const term = jcConsole(OPTS.title || ENTRY);
    window.__jc.term = term;
    const done = (code) => {
      term.status(code ? `salida ${code}` : 'terminado');
      term.write(`\n[proceso terminado${code ? ` · código ${code}` : ''}]\n`, 'dim');
      post({ type: 'exit', code: code || 0 });
    };
    const fail = (err) => { term.write(`${err && err.message ? err.message : String(err)}\n`, 'err'); done(1); };
    try {
      if (mode === 'node') jcRunNode(FILES, ENTRY, term, done).catch(fail);
      else if (mode === 'python') jcRunPython(FILES, ENTRY, term, OPTS).then(done, fail);
      else if (mode === 'batch') { term.status('en marcha'); jcBatch(FILES, ENTRY, term).then(done, fail); }
      else if (mode === 'remote') jcRemote(term, post);
    } catch (err) { fail(err); }
  });
}

/** Programas del PC (escritorio): la salida llega del proceso real y la entrada vuelve a él. */
export function jcRemote(term, post) {
  term.status('ejecutándose en tu PC');
  const ask = () => term.readLine().then((v) => { post({ type: 'stdin', text: v }); ask(); });
  ask();
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.jc !== 'host') return;
    if (m.type === 'out') term.write(m.text, m.err ? 'err' : '');
    else if (m.type === 'note') term.write(m.text, 'dim');
    else if (m.type === 'exit') { term.status(m.code ? `salida ${m.code}` : 'terminado'); term.write(`\n[proceso terminado${m.code ? ` · código ${m.code}` : ''}]\n`, 'dim'); }
  });
}

/** JavaScript tipo Node: require() de los archivos del proyecto y módulos básicos (fs, path, readline…). */
export async function jcRunNode(FILES, ENTRY, term, done) {
  const has = (p) => Object.prototype.hasOwnProperty.call(FILES, p);
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const print = (cls) => (...a) => term.write(jcFormat(a) + '\n', cls);
  const c = window.console;
  const origLog = c.log;
  c.log = c.info = c.debug = ((p) => (...a) => { p(...a); origLog(...a); })(print(''));
  const origErr = c.error;
  c.error = c.warn = ((p) => (...a) => { p(...a); origErr(...a); })(print('err'));
  let exited = false;
  const stdout = { write: (s) => { term.write(String(s)); return true; }, isTTY: false, columns: 80 };
  const proc = {
    argv: ['node', '/proyecto/' + ENTRY], env: { NODE_ENV: 'development' }, platform: 'browser', version: 'v20.0.0-navegador',
    versions: { node: '20.0.0' }, cwd: () => '/proyecto', exit: (code) => { if (!exited) { exited = true; done(code || 0); } throw Object.assign(new Error('process.exit'), { jcExit: true }); },
    stdout, stderr: { write: (s) => { term.write(String(s), 'err'); return true; } },
    stdin: { on() {}, setEncoding() {}, resume() {}, pause() {} },
    on() { return proc; }, nextTick: (fn, ...a) => Promise.resolve().then(() => fn(...a)), hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
    memoryUsage: () => ({ rss: 0, heapUsed: 0 }), uptime: () => performance.now() / 1000,
  };
  window.process = proc;
  const pathMod = {
    sep: '/', delimiter: ':',
    join: (...a) => jcNorm('', a.filter(Boolean).join('/')) || '.',
    resolve: (...a) => '/proyecto/' + (jcNorm('', a.join('/').replace(/^\/proyecto\/?/, '')) || ''),
    dirname: (p) => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/')) || '/' : '.'),
    basename: (p, ext) => { const b = String(p).split('/').pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
    extname: (p) => { const b = String(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    relative: (a, b) => b, normalize: (p) => jcNorm('', p) || '.', isAbsolute: (p) => String(p).startsWith('/'),
  };
  const fsPath = (p) => jcNorm('', String(p).replace(/^\/proyecto\/?/, '').replace(/^\.\//, ''));
  const fsMod = {
    existsSync: (p) => { const f = fsPath(p); return f != null && (has(f) || Object.keys(FILES).some((k) => k.startsWith(f + '/'))); },
    readFileSync: (p, enc) => { const f = fsPath(p); if (!has(f)) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' }); return FILES[f]; },
    writeFileSync: (p, d) => { FILES[fsPath(p)] = String(d); },
    appendFileSync: (p, d) => { const f = fsPath(p); FILES[f] = (FILES[f] || '') + String(d); },
    readdirSync: (p) => { const f = fsPath(p); const pre = f ? f + '/' : ''; return [...new Set(Object.keys(FILES).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length).split('/')[0]))]; },
    mkdirSync() {}, unlinkSync: (p) => { delete FILES[fsPath(p)]; },
    statSync: (p) => { const f = fsPath(p); const file = has(f); return { isFile: () => file, isDirectory: () => !file, size: file ? FILES[f].length : 0, mtime: new Date() }; },
  };
  fsMod.promises = Object.fromEntries(['readFile', 'writeFile', 'appendFile', 'readdir', 'mkdir', 'unlink', 'stat'].map((n) => [n, async (...a) => fsMod[n + 'Sync'](...a)]));
  fsMod.readFile = (p, o, cb) => { cb = typeof o === 'function' ? o : cb; try { cb(null, fsMod.readFileSync(p)); } catch (e) { cb(e); } };
  fsMod.writeFile = (p, d, o, cb) => { cb = typeof o === 'function' ? o : cb; fsMod.writeFileSync(p, d); cb && cb(null); };
  const question = (q) => { term.write(String(q ?? '')); return term.readLine(); };
  const rlIface = () => {
    const handlers = {};
    let closed = false;
    const iface = {
      question: (q, o, cb) => { cb = typeof o === 'function' ? o : cb; question(q).then((v) => cb && cb(v)); },
      on(ev, fn) {
        (handlers[ev] = handlers[ev] || []).push(fn);
        if (ev === 'line' && handlers.line.length === 1) (async () => { while (!closed) { const v = await term.readLine(); (handlers.line || []).forEach((h) => h(v)); } })();
        return iface;
      },
      once(ev, fn) { return iface.on(ev, fn); },
      close() { closed = true; (handlers.close || []).forEach((h) => h()); },
      setPrompt(p) { iface._p = p; }, prompt() { term.write(iface._p || '> '); }, write(s) { term.write(String(s)); },
      [Symbol.asyncIterator]: async function* () { while (!closed) yield await term.readLine(); },
    };
    return iface;
  };
  const events = (() => {
    function EventEmitter() { this._e = {}; }
    EventEmitter.prototype.on = EventEmitter.prototype.addListener = function (n, f) { (this._e[n] = this._e[n] || []).push(f); return this; };
    EventEmitter.prototype.once = function (n, f) { const w = (...a) => { this.off(n, w); f(...a); }; return this.on(n, w); };
    EventEmitter.prototype.off = EventEmitter.prototype.removeListener = function (n, f) { this._e[n] = (this._e[n] || []).filter((x) => x !== f); return this; };
    EventEmitter.prototype.emit = function (n, ...a) { (this._e[n] || []).slice().forEach((f) => f.apply(this, a)); return (this._e[n] || []).length > 0; };
    EventEmitter.EventEmitter = EventEmitter;
    return EventEmitter;
  })();
  const builtins = {
    fs: fsMod, 'fs/promises': fsMod.promises, path: pathMod, process: proc, events,
    readline: { createInterface: rlIface }, 'readline/promises': { createInterface: () => ({ ...rlIface(), question }) },
    util: { format: (...a) => jcFormat(a), inspect: (v) => jcFormat([v]), promisify: (f) => (...a) => new Promise((ok, ko) => f(...a, (e, v) => (e ? ko(e) : ok(v)))) },
    os: { EOL: '\n', platform: () => 'browser', type: () => 'Browser', homedir: () => '/proyecto', tmpdir: () => '/tmp', cpus: () => [{}], hostname: () => 'jeancode' },
    assert: Object.assign((v, m) => { if (!v) throw new Error(m || 'AssertionError'); }, { equal: (a, b, m) => { if (a != b) throw new Error(m || `${a} != ${b}`); }, strictEqual: (a, b, m) => { if (a !== b) throw new Error(m || `${a} !== ${b}`); } }),
  };
  const cache = Object.create(null);
  function load(from, id) {
    const name = String(id).replace(/^node:/, '');
    if (!/^(?:\.{1,2}\/|\/)/.test(name)) {
      if (builtins[name]) return builtins[name];
      throw Object.assign(new Error(`Cannot find module '${id}': en el navegador solo hay archivos del proyecto y fs, path, readline, events, util, os. Ejecútalo en el escritorio para usar paquetes de npm.`), { code: 'MODULE_NOT_FOUND' });
    }
    const base = jcNorm(from, name) || '';
    const p = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.js`].find(has);
    if (!p) throw Object.assign(new Error(`Cannot find module '${id}' (desde ${from})`), { code: 'MODULE_NOT_FOUND' });
    if (cache[p]) return cache[p].exports;
    if (/\.json$/i.test(p)) return (cache[p] = { exports: JSON.parse(FILES[p]) }).exports;
    const module = { exports: {}, id: p, filename: '/proyecto/' + p };
    cache[p] = module;
    const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', 'process', `${FILES[p]}\n//# sourceURL=${p}`);
    fn((x) => load(p, x), module, module.exports, '/proyecto/' + p, '/proyecto/' + dirOf(p), proc);
    return module.exports;
  }
  window.require = (x) => load(ENTRY, x);
  term.status('en marcha');
  const src = FILES[ENTRY] || '';
  const esm = /\.mjs$/i.test(ENTRY) || /^\s*(?:import\s+[\w{*'"]|export\s+)/m.test(src);
  try {
    if (esm) {
      await import(window.__jc.link(ENTRY, 'module'));
    } else {
      load('', '/' + ENTRY);
    }
  } catch (err) {
    if (err && err.jcExit) return;
    term.write(`${err && err.stack ? err.stack.split('\n').filter((l) => !/blob:|jcRunNode|load \(/.test(l)).join('\n') : err}\n`, 'err');
    if (!exited) { exited = true; done(1); }
    return;
  }
  // el programa puede seguir vivo (temporizadores, readline, servidores simulados): no se da por terminado
  if (!exited) term.status('listo');
}

/** Python con Pyodide: se copia TODO el proyecto a /home/pyodide/proyecto, así funcionan import y open(). */
export async function jcRunPython(FILES, ENTRY, term, OPTS) {
  const src = FILES[ENTRY] || '';
  const gui = (src.match(/^\s*(?:import|from)\s+(tkinter|pygame|turtle|PyQt5|PyQt6|PySide6|wx|kivy)\b/m) || [])[1];
  term.status('cargando Python…');
  term.write('Cargando Python en el navegador (Pyodide, unos 10 MB la primera vez)…\n', 'dim');
  if (!window.loadPyodide) {
    await new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = OPTS.pyodide + 'pyodide.js';
      s.onload = ok;
      s.onerror = () => ko(new Error(`No se pudo descargar Pyodide de ${OPTS.pyodide}. Revisa la conexión${OPTS.desktop ? '' : ' o usa la app de escritorio para ejecutarlo con tu Python'}.`));
      document.head.append(s);
    });
  }
  const py = await window.loadPyodide({ indexURL: OPTS.pyodide });
  const dec = new TextDecoder();
  py.setStdout({ write: (b) => { term.write(dec.decode(b, { stream: true })); return b.length; } });
  py.setStderr({ write: (b) => { term.write(dec.decode(b, { stream: true }), 'err'); return b.length; } });
  // input(): el iframe no puede bloquearse esperando al cuadro de texto, así que se usa prompt()
  py.setStdin({ stdin: () => { const r = window.prompt(term.tail() || 'input()', ''); if (r === null) return null; term.write(r + '\n', 'in'); return r + '\n'; } });
  const root = '/home/pyodide/proyecto';
  for (const [p, c] of Object.entries(FILES)) {
    const full = `${root}/${p}`;
    py.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    py.FS.writeFile(full, c);
  }
  const dir = ENTRY.includes('/') ? `${root}/${ENTRY.slice(0, ENTRY.lastIndexOf('/'))}` : root;
  py.FS.chdir(dir);
  term.clear();
  if (gui) term.write(`Aviso: ${gui} abre ventanas y no funciona en el navegador. En la app de escritorio se ejecuta con tu Python.\n`, 'dim');
  term.status('instalando paquetes…');
  const allPy = Object.entries(FILES).filter(([p]) => /\.py$/i.test(p)).map(([, c]) => c).join('\n');
  try { await py.loadPackagesFromImports(allPy, { messageCallback: () => {} }); } catch (e) { term.write(`(paquetes: ${e.message})\n`, 'dim'); }
  const req = Object.keys(FILES).find((p) => /(^|\/)requirements\.txt$/i.test(p));
  if (req) {
    const pkgs = FILES[req].split('\n').map((l) => l.replace(/#.*/, '').trim()).filter((l) => l && !l.startsWith('-'));
    if (pkgs.length) {
      try {
        await py.loadPackage('micropip', { messageCallback: () => {} });
        await py.pyimport('micropip').install(pkgs);
      } catch (e) { term.write(`(requirements.txt: no se pudo instalar todo en el navegador: ${String(e.message).split('\n').pop()})\n`, 'dim'); }
    }
  }
  term.status('en marcha');
  py.runPython(`import sys, os\nsys.path.insert(0, os.getcwd())\nsys.argv = [${JSON.stringify(ENTRY)}]`);
  const g = py.globals.get('dict')();
  g.set('__name__', '__main__');
  g.set('__file__', `${root}/${ENTRY}`);
  try {
    await py.runPythonAsync(src, { globals: g, filename: ENTRY });
  } catch (err) {
    const msg = String(err.message || err);
    if (/SystemExit/.test(msg)) { const code = Number((msg.match(/SystemExit:\s*(\d+)/) || [])[1] || 0); return code; }
    // solo el traceback del programa, sin las capas internas de Pyodide
    const lines = msg.split('\n');
    const start = lines.findIndex((l) => l.includes(`File "${ENTRY}"`) || l.includes(`File "${root}`));
    term.write((start > 0 ? ['Traceback (most recent call last):', ...lines.slice(start)] : lines).join('\n') + '\n', 'err');
    return 1;
  }
  return 0;
}
