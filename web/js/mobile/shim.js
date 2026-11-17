// El mini agente del móvil usa el MISMO motor que el agente del PC (agent.js): este adaptador le da un "escritorio"
// hecho con el ayudante del teléfono (device.js). Archivos y comandos van por shell; la pantalla de Android, por
// uiautomator (controles), screencap (capturas) e input (toques, texto, teclas).
//
// Reglas: toda ruta o texto que venga del modelo se pasa entre comillas simples (sq) y las rutas de archivos no
// salen de la carpeta de trabajo. Los comandos (run_command) pasan por los permisos del agente, como en el PC.
import { sq, b64ToText, textToB64 } from './device.js';

const MAX_OUT = 60000;

/** Ruta relativa a la carpeta de trabajo → absoluta, sin escapar de ella. */
export function insidePath(root, rel = '.') {
  const base = String(root).replace(/\/+$/, '') || '/';
  const parts = [];
  for (const p of String(rel || '.').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!parts.length) throw new Error(`ruta fuera de la carpeta de trabajo: ${rel}`); parts.pop(); continue; }
    parts.push(p);
  }
  if (String(rel).startsWith('/')) {
    // absoluta: solo si está dentro de la carpeta de trabajo
    const abs = `/${parts.join('/')}`;
    if (abs !== base && !abs.startsWith(`${base}/`)) throw new Error(`ruta fuera de la carpeta de trabajo: ${rel}`);
    return abs;
  }
  return parts.length ? `${base}/${parts.join('/')}` : base;
}

/** Glob sencillo (**, *, ?) → expresión regular sobre rutas relativas. */
export function globToRegex(glob) {
  let re = '';
  const g = String(glob || '**/*');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Un "desktop" para agent.js sobre el ayudante del teléfono. root = carpeta de trabajo (p. ej. /sdcard/JeanCode). */
export function createPhoneDesktop(dev) {
  const sh = async (cmd, timeout = 60000) => {
    const r = await dev.exec(cmd, timeout);
    return { code: r.code ?? -1, out: String(r.out ?? ''), err: String(r.err ?? '') };
  };
  const must = async (cmd, what) => {
    const r = await sh(cmd);
    if (r.code !== 0) throw new Error(`${what}: ${(r.err || r.out).trim().slice(0, 300) || `salida ${r.code}`}`);
    return r.out;
  };
  const readText = async (abs) => b64ToText(await dev.readFile(abs));
  const writeText = async (abs, text) => {
    await must(`mkdir -p ${sq(abs.replace(/\/[^/]*$/, '') || '/')}`, 'no se pudo crear la carpeta');
    await dev.writeFile(abs, textToB64(text));
  };
  const isDir = async (abs) => (await sh(`[ -d ${sq(abs)} ]`)).code === 0;
  const exists = async (abs) => (await sh(`[ -e ${sq(abs)} ]`)).code === 0;

  const fs = {
    async list(root, rel = '.') {
      const dir = insidePath(root, rel);
      const out = await must(`cd ${sq(dir)} && for f in .* *; do [ "$f" = . ] || [ "$f" = .. ] || [ ! -e "$f" ] && continue; if [ -d "$f" ]; then echo "D	$f"; else echo "F	$f	$(wc -c < "$f" 2>/dev/null)"; fi; done`, `no se pudo listar ${rel}`);
      const rows = out.split('\n').filter(Boolean).map((l) => l.split('\t'))
        .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0] === 'D' ? -1 : 1))
        .map(([k, name, size]) => (k === 'D' ? `${name}/` : `${name}  (${String(size || '?').trim()} B)`));
      return `${rel || '.'}:\n${rows.join('\n') || '(vacía)'}`;
    },
    async read(root, rel, offset = 0, limit = 400) {
      const abs = insidePath(root, rel);
      if (await isDir(abs)) return `${rel} es una carpeta, no un archivo. Contenido:\n${await fs.list(root, rel)}`;
      const lines = (await readText(abs)).split(/\r?\n/);
      const start = Math.max(0, offset | 0);
      const slice = lines.slice(start, start + Math.max(1, limit | 0));
      const more = start + slice.length < lines.length ? `\n…(${lines.length - start - slice.length} líneas más; usa offset)` : '';
      return `${rel} (${lines.length} líneas)\n${slice.map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}`).join('\n')}${more}`;
    },
    async peek(root, rel) {
      try { const abs = insidePath(root, rel); return (await exists(abs)) && !(await isDir(abs)) ? await readText(abs) : null; } catch { return null; }
    },
    async write(root, rel, content) {
      const abs = insidePath(root, rel);
      const existed = await exists(abs);
      await writeText(abs, content);
      return `${existed ? 'Actualizado' : 'Creado'} ${rel} (${String(content).split('\n').length} líneas)`;
    },
    async edit(root, rel, oldText, newText) {
      const abs = insidePath(root, rel);
      const text = await readText(abs);
      const n = oldText ? text.split(oldText).length - 1 : 0;
      if (n === 0) throw new Error(`el texto a reemplazar no está en ${rel}`);
      if (n > 1) throw new Error(`el texto a reemplazar aparece ${n} veces en ${rel}; añade contexto para que sea único`);
      await writeText(abs, text.replace(oldText, () => newText));
      return `Editado ${rel}`;
    },
    async glob(root, pattern = '**/*', max = 500) {
      const base = insidePath(root, '.');
      const out = await must(`cd ${sq(base)} && find . -type f 2>/dev/null | grep -v -E '/(\\.git|node_modules)/' | head -n 5000`, 'no se pudo buscar');
      const re = globToRegex(pattern);
      return out.split('\n').filter(Boolean).map((p) => p.replace(/^\.\//, '')).filter((p) => re.test(p)).slice(0, max);
    },
    async search(root, pattern, rel = '.') {
      const dir = insidePath(root, rel);
      const r = await sh(`grep -rnIE --exclude-dir=.git --exclude-dir=node_modules -e ${sq(pattern)} ${sq(dir)} 2>/dev/null | head -n 200`);
      const base = `${insidePath(root, '.')}/`;
      return r.out.split('\n').filter(Boolean).map((l) => (l.startsWith(base) ? l.slice(base.length) : l)).join('\n') || 'sin coincidencias';
    },
    async move(root, from, to) {
      const a = insidePath(root, from), b = insidePath(root, to);
      if (await exists(b)) throw new Error(`ya existe ${to}`);
      await must(`mkdir -p ${sq(b.replace(/\/[^/]*$/, ''))} && mv ${sq(a)} ${sq(b)}`, 'no se pudo mover');
      return `Movido ${from} → ${to}`;
    },
    async trash(root, rel) {
      // los teléfonos no tienen papelera de sistema: .papelera dentro de la carpeta de trabajo (recuperable)
      const abs = insidePath(root, rel);
      const bin = insidePath(root, `.papelera/${Date.now()}-${rel.split('/').pop()}`);
      await must(`mkdir -p ${sq(insidePath(root, '.papelera'))} && mv ${sq(abs)} ${sq(bin)}`, 'no se pudo mover a la papelera');
      return `${rel} movido a .papelera (recuperable)`;
    },
  };

  const shell = {
    async run(root, command, timeoutSec = 120) {
      const dir = insidePath(root, '.');
      const r = await sh(`mkdir -p ${sq(dir)} && cd ${sq(dir)} && ${command}`, Math.min(Math.max(timeoutSec, 1), 600) * 1000);
      const out = `${r.out}${r.err ? `${r.out ? '\n' : ''}${r.err}` : ''}`;
      return `$ ${command}\n(salida ${r.code})\n${out.slice(0, MAX_OUT)}`;
    },
    cancel: async () => {},
  };

  const unsupported = (what) => async () => `ERROR: ${what} no está disponible en el agente del móvil.`;
  return {
    fs, shell,
    proc: { start: unsupported('los procesos en segundo plano'), output: unsupported('los procesos en segundo plano'), stop: unsupported('los procesos en segundo plano') },
    web: { fetch: unsupported('webfetch') },
    skills: { list: async () => [], read: async () => { throw new Error('las skills están en el PC'); } },
    system: {
      async info() {
        const r = await sh(dev.kind === 'android'
          ? 'echo "Android $(getprop ro.build.version.release) (API $(getprop ro.build.version.sdk)) · $(getprop ro.product.manufacturer) $(getprop ro.product.model)"; dumpsys battery 2>/dev/null | grep -E "level|AC powered|USB powered" ; id'
          : 'uname -a; sw_vers 2>/dev/null; id');
        return r.out.trim();
      },
    },
  };
}

/* ---------------------------------------------------------------- pantalla de Android */
const KEYCODES = {
  enter: 66, return: 66, back: 4, escape: 4, esc: 4, home: 3, tab: 61, backspace: 67, delete: 112, del: 67,
  up: 19, down: 20, left: 21, right: 22, space: 62, menu: 82, search: 84, recents: 187, app_switch: 187,
  volume_up: 24, volume_down: 25, page_up: 92, page_down: 93, move_home: 122, move_end: 123,
};

/** Nodos de un volcado de uiautomator: { id, text, desc, rid, cls, pkg, clickable, x, y, w, h } (coordenadas reales). */
export function parseUiDump(xml) {
  const nodes = [];
  const attr = (s, k) => { const m = s.match(new RegExp(`\\s${k}="([^"]*)"`)); return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : ''; };
  for (const m of String(xml).matchAll(/<node\b([^>]*?)\/?>/g)) {
    const s = m[1];
    const b = attr(s, 'bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    const n = { text: attr(s, 'text'), desc: attr(s, 'content-desc'), rid: attr(s, 'resource-id').replace(/^.*:id\//, ''), cls: attr(s, 'class').replace(/^.*\./, ''), pkg: attr(s, 'package'),
      clickable: attr(s, 'clickable') === 'true', editable: /EditText/.test(attr(s, 'class')), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1, w: x2 - x1, h: y2 - y1 };
    if (n.text || n.desc || n.clickable || n.editable) nodes.push({ id: nodes.length + 1, ...n });
  }
  return nodes;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function findNode(nodes, { name, id, type } = {}) {
  if (id != null) return nodes.find((n) => n.id === Number(id)) || null;
  const q = norm(name);
  if (!q) return null;
  const pool = type ? nodes.filter((n) => norm(n.cls).includes(norm(type))) : nodes;
  const label = (n) => norm(n.text || n.desc || n.rid);
  return pool.find((n) => label(n) === q) || pool.find((n) => label(n).startsWith(q)) || pool.find((n) => label(n).includes(q))
    || pool.find((n) => norm(n.rid) === q) || null;
}

/** Texto para `input text`: espacios como %s y cada carácter especial escapado para el shell. */
export function inputText(text) {
  return String(text).replace(/[\\'"`$&|;<>()*?#~!{}[\] ]/g, (c) => (c === ' ' ? '%s' : `\\${c}`));
}

/**
 * ctx.computer para agent.js sobre la pantalla de Android. permit(tool, args, risk, label) lo pone la app (permisos).
 * Las coordenadas que ve el modelo son las de la captura reducida (modelWidth × modelHeight); aquí se pasan a reales.
 */
export function createPhoneScreen(dev, { permit, vision = true, modelWidth = 540 } = {}) {
  const screen = { modelWidth, modelHeight: 1170, realWidth: 1080, realHeight: 2340 };
  const toReal = (x, y) => [Math.round((Number(x) * screen.realWidth) / screen.modelWidth), Math.round((Number(y) * screen.realHeight) / screen.modelHeight)];
  const toModel = (x, y) => [Math.round((x * screen.modelWidth) / screen.realWidth), Math.round((y * screen.modelHeight) / screen.realHeight)];
  const sh = (cmd, t = 20000) => dev.exec(cmd, t);
  let nodes = [];

  async function size() {
    const r = await sh('wm size');
    const m = String(r.out).match(/(?:Override|Physical) size: (\d+)x(\d+)(?![\s\S]*Override)/) || String(r.out).match(/(\d+)x(\d+)/);
    if (m) { screen.realWidth = +m[1]; screen.realHeight = +m[2]; screen.modelHeight = Math.round((screen.realHeight * screen.modelWidth) / screen.realWidth); }
  }
  async function dump() {
    const path = '/data/local/tmp/jeancode-ui.xml';
    const r = await sh(`uiautomator dump ${path} >/dev/null 2>&1; cat ${path}`, 20000);
    nodes = parseUiDump(r.out);
    return nodes;
  }
  const listNodes = (max = 150) => nodes.slice(0, max).map((n) => {
    const [x, y] = toModel(n.x, n.y);
    return `${n.id}. ${n.cls}${n.editable ? ' (campo)' : ''}${n.clickable ? ' (pulsable)' : ''} «${n.text || n.desc || n.rid}» (${x}, ${y})`;
  }).join('\n');
  const tap = async (x, y) => sh(`input tap ${Math.round(x)} ${Math.round(y)}`);
  const focused = async () => {
    const r = await sh("dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 2");
    return r.out.trim() || '(desconocida)';
  };

  async function act(tool, a = {}) {
    if (!screen.ready) { await size(); screen.ready = true; }
    switch (tool) {
      case 'screenshot': {
        const s = await dev.screenshot(screen.modelWidth);
        if (!s?.b64) return 'ERROR: no se pudo capturar la pantalla.';
        return { text: `Captura de ${screen.modelWidth}×${screen.modelHeight} (coordenadas de esta imagen).`, image: `data:${s.mime || 'image/jpeg'};base64,${s.b64}` };
      }
      case 'inspect_screen': await dump(); return `App: ${await focused()}\nControles (id, tipo, texto, x, y):\n${listNodes(a.max || 150) || '(ninguno legible: prueba screenshot)'}`;
      case 'read_text': await dump(); return nodes.filter((n) => n.text || n.desc).map((n) => { const [x, y] = toModel(n.x, n.y); return `«${n.text || n.desc}» (${x}, ${y})`; }).join('\n') || '(sin texto legible)';
      case 'list_windows': return `App en primer plano: ${await focused()}`;
      case 'mouse_move': return 'En el móvil no hay ratón: usa mouse_click (tocar).';
      case 'mouse_click': { const [x, y] = toReal(a.x, a.y); await tap(x, y); if (a.double) await tap(x, y); return `Tocado en (${a.x}, ${a.y}).`; }
      case 'mouse_drag': { const [x, y] = toReal(a.x, a.y); const [x2, y2] = toReal(a.toX, a.toY); await sh(`input swipe ${x} ${y} ${x2} ${y2} 400`); return 'Deslizado.'; }
      case 'scroll': {
        const n = Math.max(-30, Math.min(30, Number(a.clicks) || 0)) || -3;
        const cx = screen.realWidth >> 1, cy = screen.realHeight >> 1, d = Math.round(screen.realHeight * 0.06 * Math.abs(n));
        // clicks positivos = subir el contenido (deslizar hacia abajo)
        if (a.horizontal) await sh(`input swipe ${cx + (n > 0 ? -d : d) / 2} ${cy} ${cx + (n > 0 ? d : -d) / 2} ${cy} 300`);
        else await sh(`input swipe ${cx} ${cy + (n > 0 ? -d : d) / 2} ${cx} ${cy + (n > 0 ? d : -d) / 2} 300`);
        return `Desplazado ${n}.`;
      }
      case 'click_element': case 'click_text': {
        if (!nodes.length || tool === 'click_text') await dump();
        let n = findNode(nodes, tool === 'click_text' ? { name: a.text } : a);
        if (!n && tool === 'click_element') { await dump(); n = findNode(nodes, a); }
        if (!n) return `ERROR: no hay ningún control ${a.name || a.text ? `«${a.name || a.text}»` : `con id ${a.id}`} en pantalla. Usa inspect_screen para ver los que hay.`;
        await tap(n.x, n.y);
        if (a.double) await tap(n.x, n.y);
        return `Tocado «${n.text || n.desc || n.rid}».`;
      }
      case 'type_text': await sh(`input text ${sq(inputText(a.text))}`); return `Escritos ${String(a.text ?? '').length} caracteres.`;
      case 'set_text': {
        await dump();
        const n = findNode(nodes, a.id != null ? { id: a.id } : { name: a.name, type: 'EditText' }) || findNode(nodes, a);
        if (!n) return `ERROR: no encuentro el campo ${a.name ? `«${a.name}»` : a.id}.`;
        await tap(n.x, n.y);
        // selecciona todo y borra lo que hubiera antes de escribir
        await sh('input keyevent --longpress 67 >/dev/null 2>&1; input keycombination 113 29 >/dev/null 2>&1; input keyevent 67');
        await sh(`input text ${sq(inputText(a.text))}`);
        return `Escrito en «${n.text || n.desc || n.rid}».`;
      }
      case 'key_press': {
        const keys = (a.keys || []).map((k) => String(k).toLowerCase());
        const codes = keys.map((k) => KEYCODES[k] ?? (/^[a-z0-9]$/.test(k) ? `KEYCODE_${k.toUpperCase()}` : null));
        if (codes.some((c) => c == null)) return `ERROR: tecla no disponible en el móvil: ${keys.join('+')}. Teclas: ${Object.keys(KEYCODES).join(', ')}.`;
        for (let i = 0; i < Math.min(Number(a.repeat) || 1, 20); i++) await sh(codes.length > 1 ? `input keycombination ${codes.join(' ')}` : `input keyevent ${codes[0]}`);
        return `Pulsado ${keys.join('+')}.`;
      }
      case 'open_application': case 'focus_window': {
        const target = String(a.target || a.title || '').trim();
        if (/^[a-z][\w+.-]*:\/\//i.test(target)) { await sh(`am start -a android.intent.action.VIEW -d ${sq(target)}`); return `Abierto ${target}.`; }
        let pkg = target;
        if (!/^[a-z][\w]*(\.[\w]+)+$/i.test(target)) {
          // por nombre: busca el paquete cuyo nombre contenga el texto
          const r = await sh('pm list packages 2>/dev/null');
          const all = r.out.split('\n').map((l) => l.replace(/^package:/, '').trim()).filter(Boolean);
          pkg = all.find((p) => p.split('.').pop() === norm(target).replace(/\s+/g, '')) || all.find((p) => p.includes(norm(target).replace(/\s+/g, ''))) || '';
          if (!pkg) return `ERROR: no encuentro una app «${target}». Pasa el nombre del paquete (p. ej. com.android.settings).`;
        }
        const r = await sh(`monkey -p ${sq(pkg)} -c android.intent.category.LAUNCHER 1`);
        return /No activities found|Error/.test(r.out + r.err) ? `ERROR: no se pudo abrir ${pkg}.` : `Abierta ${pkg}.`;
      }
      case 'wait': await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(a.ms) || 1000, 100), 15000))); return 'Esperado.';
      case 'wait_for': {
        const until = Date.now() + Math.min(Number(a.timeout_ms) || 10000, 30000);
        while (Date.now() < until) {
          await dump();
          if (findNode(nodes, { name: a.text })) return `Apareció «${a.text}».`;
          await new Promise((r) => setTimeout(r, 800));
        }
        return `ERROR: «${a.text}» no apareció a tiempo.`;
      }
      default: return `ERROR: ${tool} no está disponible en el móvil.`;
    }
  }

  return { vision, screen, permit, act, refresh: size };
}
