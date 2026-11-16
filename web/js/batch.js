// Intérprete de archivos .bat/.cmd para el navegador y el móvil (en el escritorio con Windows se usa
// cmd.exe de verdad). Cubre lo habitual: echo, set (/a /p), if, for (/l /f /d /r), goto, call :etiqueta,
// setlocal enabledelayedexpansion (!var!), %var:~a,b%, %var:a=b%, %~dp0, pause, choice, timeout,
// cls, color, title, type, dir, cd, redirecciones a archivo y a nul.
// Igual que sandbox.js, se inyecta en el iframe con toString(): solo puede usar jcNorm.
import { jcNorm } from './sandbox.js';

export async function jcBatch(FILES, ENTRY, io, LIMIT = 5000000) {
  const ROOT = 'C:\\proyecto';
  const env = new Map();
  const getv = (k) => { const e = env.get(String(k).toUpperCase()); return e ? e.v : undefined; };
  const setv = (k, v) => { const K = String(k).toUpperCase(); if (v == null || v === '') env.delete(K); else env.set(K, { n: String(k), v: String(v) }); };
  [['ALLUSERSPROFILE', 'C:\\ProgramData'], ['APPDATA', 'C:\\Users\\usuario\\AppData\\Roaming'], ['COMPUTERNAME', 'JEANCODE'],
    ['COMSPEC', 'C:\\Windows\\system32\\cmd.exe'], ['HOMEDRIVE', 'C:'], ['HOMEPATH', '\\Users\\usuario'], ['LOCALAPPDATA', 'C:\\Users\\usuario\\AppData\\Local'],
    ['NUMBER_OF_PROCESSORS', '4'], ['OS', 'Windows_NT'], ['PATH', 'C:\\Windows\\system32;C:\\Windows'], ['PATHEXT', '.COM;.EXE;.BAT;.CMD'],
    ['PROCESSOR_ARCHITECTURE', 'AMD64'], ['PROGRAMFILES', 'C:\\Program Files'], ['PROMPT', '$P$G'], ['SYSTEMDRIVE', 'C:'], ['SYSTEMROOT', 'C:\\Windows'],
    ['TEMP', 'C:\\Users\\usuario\\AppData\\Local\\Temp'], ['TMP', 'C:\\Users\\usuario\\AppData\\Local\\Temp'], ['USERDOMAIN', 'JEANCODE'],
    ['USERNAME', 'usuario'], ['USERPROFILE', 'C:\\Users\\usuario'], ['WINDIR', 'C:\\Windows']].forEach(([k, v]) => setv(k, v));
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  let ctxFile = ENTRY;
  const S = { echo: true, delayed: false, errorlevel: 0, ok: true, cwd: dirOf(ENTRY), quit: false, steps: 0, locals: [], dirs: new Set() };
  const has = (p) => p != null && Object.prototype.hasOwnProperty.call(FILES, p);
  const isDir = (p) => p === '' || S.dirs.has(p) || Object.keys(FILES).some((k) => k.startsWith(p + '/'));
  const win = (p) => ROOT + (p ? '\\' + p.replace(/\//g, '\\') : '');
  const prompt = () => `${win(S.cwd)}>`;
  const two = (n) => String(n).padStart(2, '0');
  const dyn = (K) => {
    const d = new Date();
    if (K === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    if (K === 'ERRORLEVEL') return String(S.errorlevel);
    if (K === 'CD') return win(S.cwd);
    if (K === 'DATE') return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
    if (K === 'TIME') return `${String(d.getHours()).padStart(2, ' ')}:${two(d.getMinutes())}:${two(d.getSeconds())},${two(Math.floor(d.getMilliseconds() / 10))}`;
    if (K === 'CMDCMDLINE') return `C:\\Windows\\system32\\cmd.exe /c "${win(ENTRY)}"`;
    if (K === 'CMDEXTVERSION') return '2';
    return undefined;
  };
  const lookup = (name) => { const v = getv(name); return v !== undefined ? v : dyn(String(name).toUpperCase()); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = async () => {
    if (++S.steps > LIMIT) throw new Error(`Detenido: más de ${LIMIT} instrucciones (¿un bucle infinito?).`);
    if (S.steps % 250 === 0) await sleep(0);
  };
  const say = (ctx, text) => ctx.out(text);

  /* ---------- rutas del proyecto (C:\proyecto\...) ---------- */
  function resolve(p) {
    let s = String(p || '').trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (/^c:\/proyecto(\/|$)/i.test(s)) s = '/' + s.slice('c:/proyecto'.length).replace(/^\//, '');
    else if (/^[a-z]:/i.test(s)) return null;
    if (s === '' || s === '.') return S.cwd;
    if (s === '/') return '';
    return jcNorm(S.cwd ? `${S.cwd}/_` : '_', s) ?? '';
  }
  const globRe = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  function glob(pattern, { dirs = false, recursive = false, base = null } = {}) {
    const raw = String(pattern).replace(/^"|"$/g, '').replace(/\\/g, '/');
    const dir = raw.includes('/') ? resolve(raw.slice(0, raw.lastIndexOf('/')) || '/') : (base ?? S.cwd);
    const re = globRe(raw.split('/').pop());
    const pre = dir ? dir + '/' : '';
    const names = new Set();
    for (const k of Object.keys(FILES)) {
      if (!k.startsWith(pre)) continue;
      const rest = k.slice(pre.length).split('/');
      if (dirs) { if (rest.length > 1 && re.test(rest[0])) names.add(pre + rest[0]); }
      else if (recursive ? re.test(rest[rest.length - 1]) : rest.length === 1 && re.test(rest[0])) names.add(k);
    }
    return [...names].sort();
  }

  /* ---------- expansión de %var% ---------- */
  /** %~dpnx…: partes de una ruta (de un argumento o de una variable de FOR). */
  function pathMods(v, mods, relOverride) {
    const clean = String(v).replace(/^"|"$/g, '');
    const m = mods.slice(1).toLowerCase();
    if (!m) return clean;
    const rel = relOverride ?? resolve(clean) ?? clean;
    const full = win(rel);
    const dir = full.slice(0, full.lastIndexOf('\\') + 1);
    const file = full.slice(full.lastIndexOf('\\') + 1);
    const dot = file.lastIndexOf('.');
    const parts = { d: 'C:', p: dir.slice(2), n: dot > 0 ? file.slice(0, dot) : file, x: dot > 0 ? file.slice(dot) : '' };
    if (m.includes('f')) return full;
    if (m.includes('z')) return String((FILES[rel] || '').length);
    return ['d', 'p', 'n', 'x'].filter((k) => m.includes(k)).map((k) => parts[k]).join('');
  }
  function argVal(args, d, mods) {
    if (d === '*') return args.slice(1).join(' ');
    const v = args[Number(d)] ?? '';
    if (!mods) return v;
    return pathMods(v, mods, Number(d) === 0 ? ctxFile : undefined);
  }
  function varOp(body) {
    const k = body.indexOf(':');
    if (k < 0) return lookup(body);
    const v = lookup(body.slice(0, k));
    if (v === undefined) return undefined;
    const op = body.slice(k + 1);
    if (op.startsWith('~')) {
      const [a, b] = op.slice(1).split(',').map((x) => parseInt(x, 10));
      let start = Number.isNaN(a) ? 0 : a;
      if (start < 0) start = Math.max(0, v.length + start);
      let r = v.slice(start);
      if (b !== undefined && !Number.isNaN(b)) r = b < 0 ? r.slice(0, Math.max(0, r.length + b)) : r.slice(0, b);
      return r;
    }
    const eq = op.indexOf('=');
    if (eq < 0) return v;
    const from = op.slice(0, eq);
    const to = op.slice(eq + 1);
    if (!from) return v;
    if (from.startsWith('*')) {
      const i = v.toLowerCase().indexOf(from.slice(1).toLowerCase());
      return i < 0 ? v : to + v.slice(i + from.length - 1);
    }
    return v.split(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join(to);
  }
  function pct(line, args) {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch !== '%') { out += ch; continue; }
      if (line[i + 1] === '%') { out += '%'; i++; continue; }
      const m = /^%(~[fdpnxsatz]*)?([0-9*])/i.exec(line.slice(i));
      if (m && !(m[2] === '*' && m[1])) { out += argVal(args, m[2], m[1]); i += m[0].length - 1; continue; }
      const j = line.indexOf('%', i + 1);
      const nl = line.indexOf('\n', i + 1);
      if (j < 0 || (nl >= 0 && nl < j)) continue; // % suelto: cmd lo quita
      const v = varOp(line.slice(i + 1, j));
      out += v ?? '';
      i = j;
    }
    return out;
  }
  function bang(s) {
    if (!S.delayed || !s.includes('!')) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '^' && s[i + 1] === '!') { out += '!'; i++; continue; }
      if (s[i] !== '!') { out += s[i]; continue; }
      const j = s.indexOf('!', i + 1);
      if (j < 0) continue;
      out += varOp(s.slice(i + 1, j)) ?? '';
      i = j;
    }
    return out;
  }
  function forSub(s, vars) {
    if (!Object.keys(vars).length) return s;
    return s.replace(/%(~[fdpnxsatz]*)?([a-zA-Z])/g, (m, mods, name) => (!(name in vars) ? m : mods ? pathMods(vars[name], mods) : vars[name]));
  }
  const sub = (s, ctx) => bang(forSub(s, ctx.forVars));

  /* ---------- líneas lógicas: los bloques ( … ) ocupan varias líneas ---------- */
  function depth(text) {
    let d = 0;
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (/^(@\s*)?(rem(\s|$)|::)/i.test(t)) continue;
      let q = false;
      let prev = '';
      const isIf = /^(@\s*)?if\s/i.test(t) || /\)\s*else\s*\($/i.test(t);
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '^') { i++; continue; }
        if (c === '"') { q = !q; continue; }
        if (q) continue;
        if (c === '(') {
          const before = raw.slice(0, i).trimEnd();
          if (!before || /[&|(]$/.test(before) || /(^|\s)(do|else)$/i.test(before) || /^@$/.test(before) || (isIf && /\s$/.test(raw.slice(0, i)))) d++;
        } else if (c === ')' && d > 0) d--;
        prev = c;
      }
      void prev;
    }
    return d;
  }
  function logical(lines, pc) {
    let s = lines[pc];
    let n = pc + 1;
    while (/(^|[^^])\^$/.test(s) && n < lines.length) s = s.slice(0, -1) + lines[n++];
    while (depth(s) > 0 && n < lines.length) s += '\n' + lines[n++];
    return [s, n];
  }

  /* ---------- análisis de una línea ---------- */
  const ws = (s, p, nl) => { while (p < s.length && (s[p] === ' ' || s[p] === '\t' || s[p] === ';' || s[p] === ',' || (nl && (s[p] === '\n' || s[p] === '\r')))) p++; return p; };
  const word = (s, p) => (/^[^\s&|()<>"]+/.exec(s.slice(p)) || [''])[0];
  function tok(s, p, inParen) {
    if (s[p] === '"') { const e = s.indexOf('"', p + 1); const end = e < 0 ? s.length : e + 1; return [s.slice(p, end), end]; }
    let i = p;
    while (i < s.length && !/[\s]/.test(s[i]) && !s.startsWith('==', i) && !(inParen && s[i] === ')')) { if (s[i] === '^') i++; i++; }
    return [s.slice(p, i), i];
  }
  function parseSeq(s, p, inParen, stopNl) {
    const list = [];
    let op = null;
    for (;;) {
      p = ws(s, p, !stopNl);
      if (p >= s.length || (stopNl && s[p] === '\n')) break;
      if (s[p] === ')' && inParen) break;
      const r = parseCmd(s, p, inParen);
      p = r.pos;
      list.push({ op, node: r.node });
      p = ws(s, p, false);
      if (s.startsWith('&&', p)) { op = '&&'; p += 2; }
      else if (s.startsWith('||', p)) { op = '||'; p += 2; }
      else if (s[p] === '&' || s[p] === '|') { op = '&'; p += 1; }
      else if (s[p] === '\n') { if (stopNl) break; op = '&'; p += 1; }
      else break;
    }
    return { list, pos: p };
  }
  function body(s, p, inParen) {
    p = ws(s, p, false);
    if (s[p] === '(') {
      const r = parseSeq(s, p + 1, true, false);
      p = r.pos;
      if (s[p] === ')') p++;
      return { list: r.list, pos: p };
    }
    return parseSeq(s, p, inParen, true);
  }
  function parseCmd(s, p, inParen) {
    p = ws(s, p, false);
    let silent = false;
    while (s[p] === '@') { silent = true; p = ws(s, p + 1, false); }
    if (s[p] === '(') {
      const r = parseSeq(s, p + 1, true, false);
      p = r.pos;
      if (s[p] === ')') p++;
      // redirección del bloque completo: ( … ) > archivo
      const m = /^\s*(\d?>>?\s*[^\s&|()]+)/.exec(s.slice(p));
      if (m) p += m[0].length;
      return { node: { t: 'block', body: r.list, redir: m ? m[1] : '' }, pos: p };
    }
    const w = word(s, p).toLowerCase();
    if (/^rem($|[\s.:])/i.test(s.slice(p, p + 4)) || s.startsWith('::', p)) {
      const e = s.indexOf('\n', p);
      return { node: { t: 'nop' }, pos: e < 0 ? s.length : e };
    }
    if (w === 'if') return parseIf(s, p + 2, inParen);
    if (w === 'for') return parseFor(s, p + 3, inParen);
    let i = p;
    let q = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '\n') break;
      if (c === '^' && !q) { i++; continue; }
      if (c === '"') q = !q;
      if (q) continue;
      if (c === '&' && s[i - 1] === '>') continue; // 2>&1
      if (c === '&' || c === '|' || (c === ')' && inParen)) break;
    }
    return { node: { t: 'cmd', text: s.slice(p, i), silent }, pos: i };
  }
  function parseIf(s, p, inParen) {
    let not = false;
    let ci = false;
    for (;;) {
      p = ws(s, p, false);
      const w = word(s, p).toLowerCase();
      if (w === '/i') { ci = true; p += 2; } else if (w === 'not') { not = true; p += 3; } else break;
    }
    let cond;
    const w = word(s, p).toLowerCase();
    if (w === 'defined' || w === 'exist' || w === 'errorlevel' || w === 'cmdextversion') {
      p = ws(s, p + w.length, false);
      const [a, e] = tok(s, p, inParen);
      cond = { k: w, a };
      p = e;
    } else {
      const [a, e] = tok(s, p, inParen);
      p = ws(s, e, false);
      let op;
      if (s.startsWith('==', p)) { op = '=='; p += 2; while (s[p] === '=') p++; }
      else { op = word(s, p).toUpperCase(); p += op.length; }
      p = ws(s, p, false);
      const [b, e2] = tok(s, p, inParen);
      p = e2;
      cond = { k: 'cmp', a, op, b };
    }
    const then = body(s, p, inParen);
    p = then.pos;
    let other = null;
    const q = ws(s, p, false);
    if (/^else(\s|\(|$)/i.test(s.slice(q, q + 5))) { other = body(s, q + 4, inParen); p = other.pos; }
    return { node: { t: 'if', not, ci, cond, then: then.list, other: other ? other.list : null }, pos: p };
  }
  function parseFor(s, p, inParen) {
    let flag = '';
    let opts = '';
    let root = '';
    for (;;) {
      p = ws(s, p, false);
      const w = word(s, p).toLowerCase();
      if (/^\/[lfdr]$/.test(w)) {
        flag = w[1];
        p = ws(s, p + 2, false);
        if (flag === 'f' && s[p] === '"') { const [o, e] = tok(s, p, false); opts = o.slice(1, -1); p = e; }
        if (flag === 'r' && s[p] !== '%') { const [o, e] = tok(s, p, false); root = o; p = e; }
      } else break;
    }
    p = ws(s, p, false);
    const [v, e] = tok(s, p, false);
    p = ws(s, e, false);
    if (word(s, p).toLowerCase() === 'in') p = ws(s, p + 2, false);
    let set = '';
    if (s[p] === '(') {
      let d = 0;
      let i = p;
      let q = false;
      for (; i < s.length; i++) {
        if (s[i] === '"' || s[i] === "'" || s[i] === '`') q = q === s[i] ? false : q || s[i];
        if (q) continue;
        if (s[i] === '(') d++;
        if (s[i] === ')' && --d === 0) break;
      }
      set = s.slice(p + 1, i);
      p = i + 1;
    }
    p = ws(s, p, false);
    if (word(s, p).toLowerCase() === 'do') p += 2;
    const b = body(s, p, inParen);
    return { node: { t: 'for', flag, opts, root, v: v.replace(/^%/, ''), set, body: b.list }, pos: b.pos };
  }

  /* ---------- set /a ---------- */
  function arith(expr) {
    const toks = [];
    const re = /\s*(0x[0-9a-f]+|\d+|[A-Za-z_$#@.][\w$#@.]*|<<=|>>=|<<|>>|[*/%+\-&^|]=|&&|\|\||[-+*/%()!~&|^=,<>])/giy;
    let m;
    let last = 0;
    while ((m = re.exec(expr))) { toks.push(m[1]); last = re.lastIndex; }
    if (expr.slice(last).trim()) throw new Error('Operador u operando que falta.');
    let i = 0;
    const peek = () => toks[i];
    const num = (t) => { const n = /^0x/i.test(t) ? parseInt(t, 16) : /^0\d/.test(t) ? parseInt(t, 8) : parseInt(t, 10); return Number.isNaN(n) ? 0 : n | 0; };
    const val = (name) => num(String(lookup(name) ?? '0').trim() || '0');
    const ASSIGN = new Set(['=', '*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=', '<<=', '>>=']);
    const LEVELS = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    const apply = (op, a, b) => {
      switch (op) {
        case '+': return (a + b) | 0; case '-': return (a - b) | 0; case '*': return Math.imul(a, b);
        case '/': if (!b) throw new Error('Error de división por cero.'); return Math.trunc(a / b) | 0;
        case '%': if (!b) throw new Error('Error de división por cero.'); return (a % b) | 0;
        case '&': return a & b; case '|': return a | b; case '^': return a ^ b; case '<<': return a << b; case '>>': return a >> b;
        default: return 0;
      }
    };
    function unary() {
      const t = peek();
      if (t === '-') { i++; return -unary() | 0; }
      if (t === '+') { i++; return unary(); }
      if (t === '!') { i++; return unary() ? 0 : 1; }
      if (t === '~') { i++; return ~unary(); }
      if (t === '(') { i++; const v = comma(); if (peek() === ')') i++; return v; }
      i++;
      if (t === undefined) throw new Error('Operador u operando que falta.');
      return /^[\d]/.test(t) ? num(t) : val(t);
    }
    function level(n) {
      if (n >= LEVELS.length) return unary();
      let a = level(n + 1);
      while (LEVELS[n].includes(peek())) { const op = toks[i++]; a = apply(op, a, level(n + 1)); }
      return a;
    }
    function assign() {
      const t = peek();
      if (t && /^[A-Za-z_$#@.]/.test(t) && ASSIGN.has(toks[i + 1])) {
        i++;
        const op = toks[i++];
        const r = assign();
        const v = op === '=' ? r : apply(op.slice(0, -1), val(t), r);
        setv(t, String(v));
        return v;
      }
      return level(0);
    }
    function comma() { let v = assign(); while (peek() === ',') { i++; v = assign(); } return v; }
    return comma();
  }

  /* ---------- ejecución ---------- */
  const COLORS = ['#0c0c0c', '#0037da', '#13a10e', '#3a96dd', '#c50f1f', '#881798', '#c19c00', '#cccccc', '#767676', '#3b78ff', '#16c60c', '#61d6d6', '#e74856', '#b4009e', '#f9f1a5', '#f2f2f2'];
  function splitArgs(s) {
    const out = [];
    const re = /"[^"]*"?|[^\s,;=]+/g;
    let m;
    while ((m = re.exec(s))) out.push(m[0]);
    return out;
  }
  const unescape = (s) => { let o = ''; let q = false; for (let i = 0; i < s.length; i++) { if (s[i] === '"') q = !q; if (s[i] === '^' && !q) { i++; if (i < s.length) o += s[i]; continue; } o += s[i]; } return o; };
  function redirections(text) {
    const r = { out: null, append: false, nul: false, errNul: false, input: null };
    let q = false;
    let cut = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '^' && !q) { cut += c + (text[i + 1] ?? ''); i++; continue; }
      if (c === '"') q = !q;
      if (!q && (c === '>' || c === '<')) {
        const fd = /\d$/.test(cut) && /(^|\s)\d$/.test(cut) ? cut.slice(-1) : '';
        if (fd) cut = cut.slice(0, -1);
        let j = i + 1;
        let append = false;
        if (c === '>' && text[j] === '>') { append = true; j++; }
        if (text[j] === '&') { i = j + 1; continue; } // 2>&1: ya va a la misma salida
        while (text[j] === ' ') j++;
        let k = j;
        if (text[k] === '"') { k = text.indexOf('"', k + 1); k = k < 0 ? text.length : k + 1; } else while (k < text.length && !/[\s<>]/.test(text[k])) k++;
        const target = text.slice(j, k).replace(/^"|"$/g, '');
        if (c === '<') r.input = target;
        else if (fd === '2') { if (/^nul$/i.test(target)) r.errNul = true; }
        else if (/^nul$/i.test(target)) r.nul = true;
        else { r.out = target; r.append = append; }
        i = k - 1;
        continue;
      }
      cut += c;
    }
    return { text: cut, r }; // cmd conserva el espacio antes de >: echo hola > a.txt escribe "hola "
  }
  function withOutput(ctx, r) {
    if (r.nul) return { ctx: { ...ctx, out: () => {}, err: r.errNul ? () => {} : ctx.err }, flush: () => {} };
    if (r.out) {
      const path = resolve(r.out);
      let buf = '';
      return {
        ctx: { ...ctx, out: (t) => { buf += t; }, err: r.errNul ? () => {} : ctx.err },
        flush: () => { if (path != null) FILES[path] = (r.append ? FILES[path] || '' : '') + buf.replace(/\r?\n/g, '\r\n'); },
      };
    }
    return { ctx: r.errNul ? { ...ctx, err: () => {} } : ctx, flush: () => {} };
  }
  const fail = (ctx, msg, code = 1) => { ctx.err(msg + '\n'); S.errorlevel = code; S.ok = false; };

  async function runSeq(list, ctx) {
    for (const { op, node } of list) {
      if (S.quit || ctx.ret) return;
      if (op === '&&' && !S.ok) continue;
      if (op === '||' && S.ok) continue;
      await runNode(node, ctx);
    }
  }
  async function runNode(node, ctx) {
    await tick();
    if (node.t === 'nop') return;
    if (node.t === 'block') {
      const { r } = redirections(node.redir || '');
      const o = withOutput(ctx, r);
      await runSeq(node.body, o.ctx);
      o.flush();
      return;
    }
    if (node.t === 'if') {
      const { cond } = node;
      let v;
      const a = sub(cond.a, ctx);
      if (cond.k === 'defined') v = lookup(a) !== undefined;
      else if (cond.k === 'exist') { const p = resolve(a); v = /[*?]/.test(a) ? glob(a).length > 0 : p != null && (has(p) || isDir(p)); }
      else if (cond.k === 'errorlevel') v = S.errorlevel >= parseInt(a, 10);
      else if (cond.k === 'cmdextversion') v = 2 >= parseInt(a, 10);
      else {
        let x = a;
        let y = sub(cond.b, ctx);
        if (node.ci) { x = x.toLowerCase(); y = y.toLowerCase(); }
        const nx = /^\s*-?\d+\s*$/.test(x.replace(/"/g, '')) && /^\s*-?\d+\s*$/.test(y.replace(/"/g, ''));
        const cx = nx ? parseInt(x.replace(/"/g, ''), 10) : x;
        const cy = nx ? parseInt(y.replace(/"/g, ''), 10) : y;
        switch (cond.op) {
          case '==': v = x === y; break;
          case 'EQU': v = cx === cy; break; case 'NEQ': v = cx !== cy; break;
          case 'LSS': v = cx < cy; break; case 'LEQ': v = cx <= cy; break;
          case 'GTR': v = cx > cy; break; case 'GEQ': v = cx >= cy; break;
          default: fail(ctx, `${cond.op} no se esperaba en este momento.`, 255); return;
        }
      }
      if (node.not) v = !v;
      if (v) await runSeq(node.then, ctx);
      else if (node.other) await runSeq(node.other, ctx);
      return;
    }
    if (node.t === 'for') return runFor(node, ctx);
    return runCmd(node, ctx);
  }
  async function runFor(node, ctx) {
    const set = sub(node.set, ctx);
    let items = [];
    if (node.flag === 'l') {
      const [a, st, b] = set.split(/[\s,;=]+/).filter(Boolean).map((x) => parseInt(x, 10) || 0);
      if (st === 0) return;
      for (let i = a; st > 0 ? i <= b : i >= b; i += st) { items.push(String(i)); if (items.length > 100000) break; }
    } else if (node.flag === 'f') {
      const o = Object.fromEntries((node.opts.match(/\w+=(?:[^\s"]*|"[^"]*")|usebackq/gi) || []).map((x) => { const k = x.indexOf('='); return k < 0 ? [x.toLowerCase(), true] : [x.slice(0, k).toLowerCase(), x.slice(k + 1)]; }));
      const dm = /delims=(.*?)(?=\s+(?:tokens|skip|eol|usebackq)=|\s+usebackq|$)/i.exec(node.opts);
      const delims = dm ? dm[1] : ' \t';
      const eol = o.eol ?? ';';
      const skip = parseInt(o.skip, 10) || 0;
      const back = !!o.usebackq;
      const t = set.trim();
      let text = '';
      if ((!back && t.startsWith('"')) || (back && t.startsWith("'"))) text = t.slice(1, -1);
      else if ((!back && t.startsWith("'")) || (back && t.startsWith('`'))) {
        const cmd = t.slice(1, -1);
        let buf = '';
        await runLine(cmd, { ...ctx, out: (x) => { buf += x; }, forVars: { ...ctx.forVars } });
        text = buf;
      } else text = splitArgs(t).map((f) => FILES[resolve(f)] ?? '').join('\n');
      const spec = String(o.tokens ?? '1');
      const star = spec.endsWith('*');
      const want = [];
      spec.replace(/\*$/, '').split(',').filter(Boolean).forEach((part) => {
        const [x, y] = part.split('-').map(Number);
        for (let i = x; i <= (y || x); i++) want.push(i);
      });
      const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const base = letters.indexOf(node.v);
      const lines = text.split(/\r?\n/).slice(skip);
      for (const line of lines) {
        if (!line || (eol && line.startsWith(eol))) continue;
        const parts = delims ? line.split(new RegExp(`[${delims.replace(/[\]\\^-]/g, '\\$&')}]+`)).filter((x, i) => x !== '' || i > 0) : [line];
        if (delims && parts[0] === '') parts.shift();
        const vars = { ...ctx.forVars };
        want.forEach((n, k) => { vars[letters[base + k]] = parts[n - 1] ?? ''; });
        if (star) { const after = Math.max(0, ...want); const re = new RegExp(`^(?:[^${delims.replace(/[\]\\^-]/g, '\\$&')}]+[${delims.replace(/[\]\\^-]/g, '\\$&')}]+){${after}}`); vars[letters[base + want.length]] = line.replace(re, ''); }
        await runSeq(node.body, { ...ctx, forVars: vars });
        if (S.quit || ctx.ret) return;
      }
      return;
    } else {
      for (const t of splitArgs(set)) {
        if (/[*?]/.test(t)) items.push(...glob(t, { dirs: node.flag === 'd', recursive: node.flag === 'r', base: node.flag === 'r' && node.root ? resolve(node.root) : null }).map(win));
        else items.push(t);
      }
    }
    for (const it of items) {
      await runSeq(node.body, { ...ctx, forVars: { ...ctx.forVars, [node.v]: it } });
      if (S.quit || ctx.ret) return;
    }
  }
  async function runLine(text, ctx) {
    const { list } = parseSeq(text, 0, false, false);
    await runSeq(list, ctx);
  }
  async function runCmd(node, ctx) {
    const expanded = sub(node.text, ctx);
    const { text: noRedir, r } = redirections(expanded);
    const o = withOutput(ctx, r);
    try { await builtin(unescape(noRedir), o.ctx, noRedir, r); } finally { o.flush(); }
  }
  async function builtin(text, ctx, raw, redir) {
    const t = text.replace(/^\s+/, '');
    if (!t) return;
    if (/^echo(?=$|[\s.:(;=,/\\+[\]])/i.test(t)) {
      const after = t.slice(4);
      if (/^[.:(;=,/\\+[\]]/.test(after)) say(ctx, after.slice(1) + '\n');
      else if (!after.trim()) say(ctx, `ECHO está ${S.echo ? 'activado' : 'desactivado'}.\n`);
      else if (/^\s+(off|on)\s*$/i.test(after)) S.echo = /on/i.test(after);
      else say(ctx, after.slice(1) + '\n');
      S.ok = true;
      return;
    }
    const m = /^([^\s/=,;]+)(.*)$/s.exec(t);
    const cmd = (m ? m[1] : t).toLowerCase();
    const rest = (m ? m[2] : '').replace(/^\s/, '');
    const restTrim = rest.trim();
    S.ok = true;
    switch (cmd) {
      case 'set': return doSet(rest, ctx, redir);
      case 'goto': {
        const label = restTrim.replace(/^:/, '').split(/\s/)[0].toLowerCase();
        if (label === 'eof') { ctx.ret = true; return; }
        throw { jcGoto: label };
      }
      case 'call': {
        if (restTrim.startsWith(':')) {
          const [label, ...args] = splitArgs(restTrim);
          await runFile(ctx.file, [label, ...args], label.slice(1).toLowerCase());
          return;
        }
        const [first, ...args] = splitArgs(restTrim);
        const p = batchFile(first);
        if (p) { await runFile(p, [first, ...args]); return; }
        await runLine(pct(restTrim, ctx.args), ctx);
        return;
      }
      case 'exit': {
        const bflag = /^\/b\b/i.test(restTrim);
        const code = parseInt(restTrim.replace(/^\/b\s*/i, ''), 10);
        if (!Number.isNaN(code)) S.errorlevel = code;
        if (bflag) ctx.ret = true; else S.quit = true;
        return;
      }
      case 'rem': return;
      case 'pause':
        say(ctx, 'Presione una tecla para continuar . . . ');
        await io.readLine();
        return;
      case 'cls': io.clear(); return;
      case 'title': io.title(rest); return;
      case 'color': {
        const c = restTrim.toLowerCase();
        if (!c) { io.colors('', ''); return; }
        if (!/^[0-9a-f]{1,2}$/.test(c) || (c.length === 2 && c[0] === c[1])) { S.errorlevel = 1; S.ok = false; return; }
        const bg = c.length === 2 ? COLORS[parseInt(c[0], 16)] : COLORS[0];
        io.colors(COLORS[parseInt(c[c.length - 1], 16)], bg);
        return;
      }
      case 'ver': say(ctx, '\nMicrosoft Windows [Versión 10.0.19045] (simulado en JeanCode)\n'); return;
      case 'chcp': say(ctx, 'Página de códigos activa: 65001\n'); return;
      case 'mode': case 'prompt': case 'break': case 'verify': return;
      case 'setlocal': {
        S.locals.push({ env: new Map(env), delayed: S.delayed, cwd: S.cwd });
        if (/enabledelayedexpansion/i.test(rest)) S.delayed = true;
        if (/disabledelayedexpansion/i.test(rest)) S.delayed = false;
        return;
      }
      case 'endlocal': {
        const top = S.locals.pop();
        if (top) { env.clear(); top.env.forEach((v, k) => env.set(k, v)); S.delayed = top.delayed; S.cwd = top.cwd; }
        return;
      }
      case 'shift': ctx.args.splice(/^\/(\d)/.test(restTrim) ? Number(restTrim[1]) : 1, 1); return;
      case 'cd': case 'chdir': {
        const target = restTrim.replace(/^\/d\s*/i, '');
        if (!target) { say(ctx, win(S.cwd) + '\n'); return; }
        const p = resolve(target);
        if (p == null || !isDir(p)) { fail(ctx, 'El sistema no puede encontrar la ruta especificada.'); return; }
        S.cwd = p;
        return;
      }
      case 'md': case 'mkdir': { const p = resolve(restTrim); if (p != null) S.dirs.add(p); return; }
      case 'rd': case 'rmdir': return;
      case 'dir': {
        const bare = /\/b/i.test(rest);
        const target = restTrim.replace(/\/\w+/g, '').trim();
        const base = target && !/[*?]/.test(target) ? resolve(target) : S.cwd;
        const pattern = /[*?]/.test(target) ? target : '*';
        const pre = base ? base + '/' : '';
        const files = glob(pattern, { base });
        const dirs = glob(pattern, { base, dirs: true });
        if (bare) { [...dirs, ...files].forEach((f) => say(ctx, f.slice(pre.length) + '\n')); return; }
        say(ctx, ` El volumen de la unidad C es PROYECTO\n\n Directorio de ${win(base)}\n\n`);
        dirs.forEach((d) => say(ctx, `                 <DIR>          ${d.slice(pre.length)}\n`));
        files.forEach((f) => say(ctx, `${String((FILES[f] || '').length).padStart(32)} ${f.slice(pre.length)}\n`));
        say(ctx, `${String(files.length).padStart(16)} archivos\n${String(dirs.length).padStart(16)} dirs\n`);
        return;
      }
      case 'type': {
        for (const f of splitArgs(restTrim)) {
          const p = resolve(f);
          if (!has(p)) { fail(ctx, 'El sistema no puede encontrar el archivo especificado.'); continue; }
          say(ctx, FILES[p].replace(/\r\n/g, '\n') + (FILES[p].endsWith('\n') ? '' : '\n'));
        }
        return;
      }
      case 'del': case 'erase': {
        for (const f of splitArgs(restTrim).filter((x) => !x.startsWith('/'))) {
          const list = /[*?]/.test(f) ? glob(f) : [resolve(f)];
          list.forEach((p) => { if (has(p)) delete FILES[p]; });
        }
        return;
      }
      case 'copy': case 'move': case 'ren': case 'rename': {
        const [a, b] = splitArgs(restTrim).filter((x) => !x.startsWith('/'));
        const pa = resolve(a);
        if (!has(pa) || !b) { fail(ctx, 'El sistema no puede encontrar el archivo especificado.'); return; }
        let pb = cmd.startsWith('ren') ? (pa.includes('/') ? pa.slice(0, pa.lastIndexOf('/') + 1) : '') + b.replace(/^"|"$/g, '') : resolve(b);
        if (isDir(pb) && !has(pb)) pb = (pb ? pb + '/' : '') + pa.split('/').pop();
        FILES[pb] = FILES[pa];
        if (cmd !== 'copy') delete FILES[pa];
        if (cmd === 'copy') say(ctx, '        1 archivo(s) copiado(s).\n');
        if (cmd === 'move') say(ctx, '        1 archivo(s) movido(s).\n');
        return;
      }
      case 'timeout': {
        const n = parseInt((/\/t\s+(-?\d+)/i.exec(rest) || /(-?\d+)/.exec(rest) || [0, 0])[1], 10);
        if (n < 0) { say(ctx, 'Presione una tecla para continuar ...'); await io.readLine(); return; }
        say(ctx, `\nEsperando ${n} segundos, presione una tecla para continuar ...`);
        await sleep(Math.min(n, 60) * 1000);
        say(ctx, '\n');
        return;
      }
      case 'ping': {
        const n = parseInt((/-n\s+(\d+)/i.exec(rest) || [0, 4])[1], 10);
        const host = splitArgs(restTrim).filter((x) => !/^-/.test(x) && !/^\d+$/.test(x)).pop() || 'localhost';
        say(ctx, `\nHaciendo ping a ${host} con 32 bytes de datos:\n`);
        for (let i = 0; i < n; i++) { if (i) await sleep(1000); say(ctx, `Respuesta desde ${host}: bytes=32 tiempo<1m TTL=128\n`); }
        return;
      }
      case 'choice': {
        const choices = ((/\/c\s+(\S+)/i.exec(rest) || [0, 'SN'])[1]).toUpperCase();
        const msg = (/\/m\s+("[^"]*"|\S+)/i.exec(rest) || [0, ''])[1].replace(/^"|"$/g, '');
        const showList = !/\/n\b/i.test(rest);
        for (;;) {
          say(ctx, `${msg}${msg ? ' ' : ''}${showList ? `[${choices.split('').join(',')}]?` : ''}`);
          const v = (await io.readLine()).trim().toUpperCase()[0];
          const i = v ? choices.indexOf(v) : -1;
          if (i >= 0) { S.errorlevel = i + 1; return; }
        }
      }
      case 'start': say(ctx, '(start abre programas de Windows: no está disponible en el navegador. Usa la app de escritorio.)\n'); return;
      case 'echo.': say(ctx, '\n'); return;
      default: {
        const p = batchFile(m ? m[1] : t);
        if (p) { await runFile(p, [m[1], ...splitArgs(rest)]); S.quit = true; return; }
        fail(ctx, `"${m ? m[1] : t}" no se reconoce como un comando interno o externo,\nprograma o archivo por lotes ejecutable.`, 9009);
      }
    }
  }
  function batchFile(name) {
    if (!name) return null;
    const base = resolve(name);
    return [base, `${base}.bat`, `${base}.cmd`].find((p) => has(p) && /\.(bat|cmd)$/i.test(p)) || null;
  }
  async function doSet(rest, ctx) {
    const r = rest.trim();
    if (!r) { [...env.values()].sort((a, b) => a.n.localeCompare(b.n)).forEach((e) => say(ctx, `${e.n}=${e.v}\n`)); return; }
    if (/^\/a\b/i.test(r)) {
      try { arith(r.slice(2).trim().replace(/"/g, '')); S.errorlevel = 0; }
      catch (e) { fail(ctx, e.message, 1073750993); }
      return;
    }
    if (/^\/p\b/i.test(r)) {
      let spec = rest.replace(/^\s+/, '').slice(2).replace(/^\s+/, '');
      if (spec.startsWith('"')) spec = spec.slice(1, spec.lastIndexOf('"') > 0 ? spec.lastIndexOf('"') : undefined);
      const eq = spec.indexOf('=');
      if (eq < 0) { fail(ctx, 'La sintaxis del comando no es correcta.'); return; }
      say(ctx, spec.slice(eq + 1).replace(/^"|"$/g, ''));
      const v = await io.readLine();
      if (v !== '') setv(spec.slice(0, eq), v); else S.errorlevel = 1;
      return;
    }
    let spec = r;
    if (spec.startsWith('"')) spec = spec.slice(1, spec.lastIndexOf('"') > 0 ? spec.lastIndexOf('"') : undefined);
    else spec = rest.replace(/^\s+/, '');
    const eq = spec.indexOf('=');
    if (eq <= 0) {
      const pre = spec.trim().toUpperCase();
      const found = [...env.values()].filter((e) => e.n.toUpperCase().startsWith(pre));
      if (!found.length) { fail(ctx, `La variable de entorno ${spec.trim()} no está definida`); return; }
      found.forEach((e) => say(ctx, `${e.n}=${e.v}\n`));
      return;
    }
    setv(spec.slice(0, eq), spec.slice(eq + 1));
  }

  async function runFile(path, args, label) {
    const lines = String(FILES[path] ?? '').split(/\r?\n/);
    const labels = Object.create(null);
    lines.forEach((l, i) => { const mm = /^\s*:([^\s:+;,=]+)/.exec(l); if (mm && !/^\s*::/.test(l)) { const k = mm[1].toLowerCase(); if (!(k in labels)) labels[k] = i; } });
    let pc = 0;
    if (label) {
      if (!(label in labels)) { io.write(`El sistema no encuentra la etiqueta por lotes especificada: ${label}\n`, 'err'); S.errorlevel = 1; return; }
      pc = labels[label] + 1;
    }
    const prevFile = ctxFile;
    ctxFile = path;
    const ctx = { args, file: path, forVars: {}, ret: false, out: (x) => io.write(x), err: (x) => io.write(x, 'err') };
    while (pc < lines.length && !S.quit && !ctx.ret) {
      const [raw, next] = logical(lines, pc);
      pc = next;
      const t = raw.trim();
      if (!t || (t.startsWith(':') && !t.startsWith('::'))) continue;
      const line = pct(raw, args);
      if (S.echo && !t.startsWith('@') && !/^rem(\s|$)|^::/i.test(t)) io.write(`\n${prompt()}${line.trim()}\n`);
      try {
        await runLine(line, ctx);
      } catch (e) {
        if (e && e.jcGoto !== undefined) {
          if (!(e.jcGoto in labels)) { io.write(`El sistema no encuentra la etiqueta por lotes especificada: ${e.jcGoto}\n`, 'err'); S.errorlevel = 1; break; }
          pc = labels[e.jcGoto] + 1;
          continue;
        }
        ctxFile = prevFile;
        throw e;
      }
    }
    ctxFile = prevFile;
  }

  await runFile(ENTRY, [ENTRY.split('/').pop()]);
  if (S.echo && !S.quit) io.write(`\n${prompt()}\n`);
  return S.errorlevel;
}
