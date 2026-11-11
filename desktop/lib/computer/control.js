// Capa de control del equipo (proceso principal). Entre el agente y el driver del sistema:
//   - una tarea a la vez, acciones en serie (nunca dos clics a la vez)
//   - pausa, parada y parada de emergencia: una acción en curso se corta matando el driver
//   - espacio de coordenadas del modelo = la captura escalada; aquí se pasa a píxeles reales
//   - el agente NO puede hacer clic ni teclear sobre la ventana de JeanCode (no puede aprobarse a sí mismo)
//   - todo lo observado pasa por redact() antes de salir de aquí
//   - registro de acciones en disco, sin el texto tecleado
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Driver } = require('./driver');
const { redact } = require('../redact');

const MODEL_WIDTH = 1366;   // ancho máximo de la captura que ve el modelo
// Teclear en una terminal es ejecutar comandos: el escritorio exige una aprobación explícita de un solo uso.
// Se reconoce por la CLASE de la ventana (consola clásica, Windows Terminal, ConEmu...) y por las apps de
// terminal; no por el proceso anfitrión (una app gráfica hecha con PowerShell o Python no es una terminal).
const TERMINAL_CLASS = /^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS|PseudoConsoleWindow|VirtualConsoleClass|mintty|Alacritty|org\.wezfurlong\.wezterm|PuTTY)$/i;
const TERMINAL_APP = /^(windowsterminal|wt|openconsole|conhost|mintty|alacritty|wezterm-gui|hyper|tabby|powershell_ise|putty|kitty)$/i;
const isTerminal = (fg) => TERMINAL_CLASS.test(fg.class || '') || TERMINAL_APP.test(fg.process || '');
const SETTLE_MS = 350;      // espera tras una acción antes de observar el resultado

class Stopped extends Error { constructor(msg = 'tarea detenida por el usuario') { super(msg); this.stopped = true; } }

/** Texto comparable: sin tildes, minúsculas, espacios simples (los modelos escriben "Guardar" o "guardar"). */
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Para comparar con texto leído por OCR, que confunde 0/O y 1/l/I. */
const fuzzy = (s) => norm(s).replace(/o/g, '0').replace(/[il|]/g, '1');
const elLine = (e) => `${e.type} «${e.name}»${e.value ? ` = «${e.value}»` : ''}`;

class ComputerControl extends EventEmitter {
  constructor({ logFile, ownPid = process.pid }) {
    super();
    this.logFile = logFile;
    this.ownPid = ownPid; // proceso dueño de las ventanas de JeanCode: nunca se opera sobre ellas
    this.driver = new Driver();
    this.state = { status: 'idle', task: null, step: 0, action: null, startedAt: null, error: null };
    this.queue = Promise.resolve();
    this.resumeWaiters = [];
    this.epoch = 0;            // cambia al detener: las acciones en cola de una tarea anterior se descartan
    this.screen = null;
  }

  static isSupported() { return Driver.isSupported(); }

  setState(patch) {
    Object.assign(this.state, patch);
    this.emit('state', { ...this.state });
  }

  get scale() { return this.screen ? Math.min(1, MODEL_WIDTH / this.screen.width) : 1; }
  toPhysical(x, y) {
    const s = this.scale;
    return { x: Math.round(Number(x) / s) + (this.screen?.x || 0), y: Math.round(Number(y) / s) + (this.screen?.y || 0) };
  }
  toModel(px, py) {
    const s = this.scale;
    return { x: Math.round((px - (this.screen?.x || 0)) * s), y: Math.round((py - (this.screen?.y || 0)) * s) };
  }

  async begin(task) {
    if (!Driver.isSupported()) throw new Error('El control del equipo solo está disponible en Windows por ahora.');
    const info = await this.driver.start();
    this.screen = info.screen;
    this.epoch++;
    this.setState({ status: 'running', task: String(task || '').slice(0, 200), step: 0, action: null, startedAt: Date.now(), error: null });
    this.log({ event: 'begin', task: redact(this.state.task) });
    return { screen: this.screen, modelWidth: Math.round(this.screen.width * this.scale), modelHeight: Math.round(this.screen.height * this.scale) };
  }

  end(reason = 'terminada') {
    if (this.state.status === 'idle') return;
    this.log({ event: 'end', reason });
    this.setState({ status: 'idle', action: null, task: null });
    this.flushWaiters();
  }

  pause() { if (this.state.status === 'running') { this.setState({ status: 'paused' }); this.log({ event: 'pause' }); } }
  resume() { if (this.state.status === 'paused') { this.setState({ status: 'running' }); this.log({ event: 'resume' }); this.flushWaiters(); } }

  /** Parada: descarta lo que esté en cola y corta la acción en curso (matando el driver: deja de teclear ya). */
  stop(reason = 'detenida por el usuario') {
    this.epoch++;
    this.driver.stop();
    this.log({ event: 'stop', reason });
    this.setState({ status: 'stopped', action: null, error: reason });
    this.flushWaiters();
  }

  flushWaiters() { const w = this.resumeWaiters; this.resumeWaiters = []; w.forEach((fn) => fn()); }

  async gate(epoch) {
    while (this.state.status === 'paused') await new Promise((r) => this.resumeWaiters.push(r));
    if (epoch !== this.epoch || this.state.status === 'stopped' || this.state.status === 'idle') throw new Stopped();
  }

  /** ¿La ventana que hay REALMENTE bajo el punto (píxeles reales) es de JeanCode? (pregunta al sistema, no a rectángulos) */
  async hitsOwnWindow(px, py) {
    const { pid } = await this.driver.call('owner_at', { x: px, y: py });
    return pid === this.ownPid;
  }

  /** Consume la aprobación de un solo uso para operar una terminal, o falla. */
  takeTerminalApproval(what) {
    const ok = this.terminalApproval && this.terminalApproval > Date.now();
    this.terminalApproval = 0;
    if (!ok) throw new Error(`${what}: escribir, pegar o hacer clic en una terminal necesita tu permiso explícito`);
  }

  /**
   * Qué hay en el destino de una acción (para el permiso): la ventana bajo el punto en clics y arrastres,
   * la ventana activa en teclado. Un clic derecho/central en una consola PEGA el portapapeles: también cuenta.
   */
  async targetInfo(tool, a = {}) {
    let w;
    if (['mouse_click', 'mouse_drag'].includes(tool) && a.x != null && a.y != null) {
      const p = this.toPhysical(a.x, a.y);
      w = await this.driver.call('owner_at', p);
    } else if (tool === 'click_element' && this.lastElements?.get(Math.trunc(Number(a.id)))) {
      const c = this.lastElements.get(Math.trunc(Number(a.id)));
      w = await this.driver.call('owner_at', { x: Math.round(c.x), y: Math.round(c.y) });
    } else if (tool === 'click_text' && a.text) {
      const hit = await this.findText(String(a.text), a.nth).catch(() => null);
      w = await this.driver.call(hit ? 'owner_at' : 'foreground', hit ? { x: hit.x, y: hit.y } : {});
    } else {
      w = await this.driver.call('foreground');
    }
    return { process: w.process || '', terminal: isTerminal(w) };
  }
  async ownWindowFocused() {
    const fg = await this.driver.call('foreground');
    return fg.pid === this.ownPid;
  }

  log(entry) {
    try { fs.appendFileSync(this.logFile, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n'); } catch { /* sin disco: no bloquea */ }
  }

  /** Resumen seguro de los argumentos para el registro: nunca el texto tecleado. */
  static summarize(name, a = {}) {
    if (name === 'type_text' || name === 'set_text') return { chars: String(a.text ?? '').length, id: a.id, name: a.name ? redact(String(a.name)).slice(0, 60) : undefined };
    if (name === 'click_text' || name === 'wait_for') return { text: redact(String(a.text ?? '')).slice(0, 60) };
    if (name === 'open_application') return { target: redact(a.target) };
    return Object.fromEntries(Object.entries(a).filter(([k]) => ['x', 'y', 'toX', 'toY', 'id', 'name', 'button', 'double', 'keys', 'clicks', 'title', 'ms', 'scope'].includes(k)));
  }

  /** Ejecuta una acción del catálogo en serie. Devuelve un resultado ya redactado y en coordenadas del modelo. */
  act(name, args = {}) {
    const epoch = this.epoch;
    const run = async () => {
      await this.gate(epoch);
      if (this.state.status !== 'running') throw new Error('no hay una tarea de control activa');
      const t0 = Date.now();
      this.setState({ step: this.state.step + 1, action: { name, args: ComputerControl.summarize(name, args) } });
      try {
        const result = await this.execute(name, args);
        await this.gate(epoch);
        this.log({ event: 'action', name, args: ComputerControl.summarize(name, args), ok: true, ms: Date.now() - t0 });
        return result;
      } catch (e) {
        if (e.stopped || epoch !== this.epoch) throw new Stopped();
        const msg = redact(e.message);
        this.log({ event: 'action', name, args: ComputerControl.summarize(name, args), ok: false, error: msg, ms: Date.now() - t0 });
        throw new Error(msg);
      } finally {
        if (this.state.status === 'running') this.setState({ action: null });
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async observeAfter() {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const fg = await this.driver.call('foreground');
    return { title: redact(fg.title), process: fg.process };
  }

  async guardPoint(x, y, what, { input = true } = {}) {
    const p = this.toPhysical(x, y);
    if (!this.screen || p.x < this.screen.x || p.y < this.screen.y || p.x >= this.screen.x + this.screen.width || p.y >= this.screen.y + this.screen.height) {
      throw new Error(`(${x}, ${y}) está fuera de la pantalla: usa coordenadas de la última captura (0..${Math.round(this.screen.width * this.scale) - 1}, 0..${Math.round(this.screen.height * this.scale) - 1})`);
    }
    const w = await this.driver.call('owner_at', p);
    if (w.pid === this.ownPid) throw new Error(`no se permite ${what} sobre la ventana de JeanCode`);
    if (input && isTerminal(w)) this.takeTerminalApproval(`${what} en una terminal (${w.process})`);
    return p;
  }
  async guardKeyboard() {
    const fg = await this.driver.call('foreground');
    if (fg.pid === this.ownPid) throw new Error('JeanCode está en primer plano: enfoca la ventana de destino (focus_window) antes de teclear');
    if (isTerminal(fg)) this.takeTerminalApproval(`la ventana activa es una terminal (${fg.process})`);
  }

  /** La interfaz llama a esto tras una confirmación del usuario; vale para la siguiente acción y 30 s como máximo. */
  approveTerminal() { this.terminalApproval = Date.now() + 30000; }

  async foreground() { const f = await this.driver.call('foreground'); return { process: f.process, title: redact(f.title), terminal: isTerminal(f) }; }

  /** Inspección cruda + caché (centros físicos, lista para buscar por nombre y para comparar después). */
  async inspectRaw(max = 150) {
    const fg = await this.driver.call('foreground');
    if (fg.pid === this.ownPid) throw new Error('la ventana activa es JeanCode: enfoca primero la aplicación (focus_window)');
    const r = await this.driver.call('inspect', { max });
    this.lastElements = new Map(r.elements.map((e) => [e.id, { x: e.rect.x + e.rect.w / 2, y: e.rect.y + e.rect.h / 2 }]));
    this.lastRaw = { at: Date.now(), elements: r.elements };
    this.snap = { key: `${fg.pid}|${fg.title}`, lines: new Set(r.elements.map((e) => elLine({ type: e.type, name: redact(e.name), value: e.password ? '' : redact(e.value) }))) };
    return { fg, r };
  }

  /** Busca un control por su nombre (o el texto de su valor). Lanza con sugerencias si no lo encuentra. */
  async elementByName(name, type) {
    if (!this.lastRaw || Date.now() - this.lastRaw.at > 3000) await this.inspectRaw();
    const want = norm(name);
    const list = this.lastRaw.elements.filter((e) => !type || norm(e.type) === norm(type));
    const score = (e) => {
      const n = norm(e.name), id = norm(e.automationId);
      if (n === want || id === want) return 3;
      if (n.startsWith(want)) return 2;
      if (n.includes(want) || (!e.password && norm(e.value).includes(want))) return 1;
      return 0;
    };
    const ranked = list.map((e) => [score(e) + (e.enabled ? 0.5 : 0), e]).filter(([s]) => s >= 1).sort((x, y) => y[0] - x[0]);
    // campos sin nombre propio: muchas apps ponen una etiqueta al lado ("Nombre:" [_____]); se toma el campo más cercano
    const label = ranked.find(([, e]) => e.type === 'Text')
      || this.lastRaw.elements.filter((e) => e.type === 'Text').map((e) => [score(e), e]).filter(([sc]) => sc >= 1).sort((x, y) => y[0] - x[0])[0];
    const wantsField = !type || /^(edit|combobox|document)$/i.test(type);
    if (wantsField && label && !ranked.some(([, e]) => /^(Edit|ComboBox|Document)$/.test(e.type))) {
      const L = label[1].rect;
      const field = this.lastRaw.elements
        .filter((e) => /^(Edit|ComboBox|Document)$/.test(e.type) && e.rect)
        .map((e) => {
          const sameRow = Math.abs((e.rect.y + e.rect.h / 2) - (L.y + L.h / 2)) <= Math.max(L.h, e.rect.h) && e.rect.x >= L.x + L.w * 0.5;
          const below = e.rect.y >= L.y + L.h * 0.5 && e.rect.y - (L.y + L.h) <= 80 && Math.abs(e.rect.x - L.x) <= 120;
          const dist = Math.hypot(e.rect.x - (L.x + L.w), (e.rect.y + e.rect.h / 2) - (L.y + L.h / 2));
          return { e, ok: sameRow || below, dist };
        })
        .filter((x) => x.ok).sort((x, y) => x.dist - y.dist)[0];
      if (field) return field.e;
    }
    if (!ranked.length) {
      const names = list.filter((e) => e.name).slice(0, 12).map((e) => `${e.type} «${redact(e.name)}»`).join(', ');
      throw new Error(`no hay ningún control llamado «${name}» en la ventana activa. Algunos que sí hay: ${names || '(ninguno con nombre)'}`);
    }
    return ranked[0][1];
  }

  /** OCR de la ventana activa (o la pantalla) con caché corta. Devuelve líneas con rect físico. */
  async ocr(scope = 'window', fresh = false) {
    if (!fresh && this.lastText && this.lastText.scope === scope && Date.now() - this.lastText.at < 4000) return this.lastText;
    const fg = await this.driver.call('foreground');
    if (fg.pid === this.ownPid && scope === 'window') throw new Error('la ventana activa es JeanCode: enfoca primero la aplicación');
    const r = await this.driver.call('ocr', scope === 'screen' ? { screen: true } : {}, 30000);
    this.lastText = { at: Date.now(), scope, lines: r.lines, language: r.language, fg };
    return this.lastText;
  }

  /** Punto físico donde está un texto visible (OCR). nth = cuál de las coincidencias (1 = la primera). */
  async findText(text, nth = 1) {
    const want = fuzzy(text);
    if (!want) throw new Error('indica el texto a buscar');
    const { lines } = await this.ocr('window');
    const hits = [];
    for (const l of lines) {
      const t = fuzzy(l.text);
      const i = t.indexOf(want);
      if (i < 0) continue;
      // posición aproximada del fragmento dentro de la línea (proporcional a los caracteres)
      const frac = t.length ? (i + want.length / 2) / t.length : 0.5;
      hits.push({ exact: t === want, x: Math.round(l.rect.x + l.rect.w * frac), y: Math.round(l.rect.y + l.rect.h / 2), line: l.text });
    }
    hits.sort((p, q) => Number(q.exact) - Number(p.exact) || p.y - q.y || p.x - q.x);
    const k = Math.max(1, Math.trunc(Number(nth) || 1));
    if (!hits[k - 1]) {
      const sample = lines.slice(0, 15).map((l) => `«${redact(l.text).slice(0, 40)}»`).join(', ');
      throw new Error(hits.length ? `solo hay ${hits.length} coincidencia(s) de «${text}»` : `no se ve el texto «${text}» en la ventana activa. Texto visible: ${sample || '(nada legible)'}`);
    }
    return hits[k - 1];
  }

  /** Qué cambió en la ventana tras una acción (si antes se inspeccionó): ayuda a verificar sin adivinar. */
  async changes() {
    if (!this.snap) return undefined;
    try {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const prev = this.snap;
      const fg = await this.driver.call('foreground');
      if (fg.pid === this.ownPid) return undefined;
      if (`${fg.pid}|${fg.title}` !== prev.key) { this.snap = null; return { window: `la ventana activa ahora es «${redact(fg.title)}» (${fg.process}): vuelve a inspeccionar` }; }
      await this.inspectRaw();
      const added = [...this.snap.lines].filter((l) => !prev.lines.has(l));
      const removed = [...prev.lines].filter((l) => !this.snap.lines.has(l));
      if (!added.length && !removed.length) return { none: 'la ventana no cambió (¿la acción no tuvo efecto?)' };
      return { appeared: added.slice(0, 8), gone: removed.slice(0, 8) };
    } catch { return undefined; }
  }

  async execute(name, a) {
    const d = this.driver;
    const num = (v, label) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${label} debe ser un número`); return n; };
    switch (name) {
      case 'screenshot': {
        const r = await d.call('screenshot', { maxWidth: MODEL_WIDTH });
        this.screen = r.screen;
        return { jpeg: r.jpeg, width: r.width, height: r.height, foreground: { title: redact(r.foreground.title), process: r.foreground.process } };
      }
      case 'inspect_screen': {
        const { fg, r } = await this.inspectRaw(Math.min(Number(a.max) || 150, 300));
        const elements = r.elements.map((e) => {
          const c = this.toModel(e.rect.x + e.rect.w / 2, e.rect.y + e.rect.h / 2);
          return { id: e.id, type: e.type, name: redact(e.name), value: e.password ? '(contraseña)' : redact(e.value), enabled: e.enabled, focused: e.focused, password: e.password, x: c.x, y: c.y, depth: e.depth };
        });
        return { window: { title: redact(fg.title), process: fg.process }, elements, truncated: r.truncated };
      }
      case 'list_windows': return (await d.call('windows')).map((w) => ({ title: redact(w.title), process: w.process }));
      case 'mouse_move': { const p = await this.guardPoint(num(a.x, 'x'), num(a.y, 'y'), 'mover el ratón', { input: false }); await d.call('move', p); return { ok: true }; }
      case 'mouse_click': {
        const p = await this.guardPoint(num(a.x, 'x'), num(a.y, 'y'), 'hacer clic');
        await d.call('click', { ...p, button: ['left', 'right', 'middle'].includes(a.button) ? a.button : 'left', double: !!a.double });
        return { after: await this.observeAfter(), changes: await this.changes() };
      }
      case 'mouse_drag': {
        const p = await this.guardPoint(num(a.x, 'x'), num(a.y, 'y'), 'arrastrar');
        const q = await this.guardPoint(num(a.toX, 'toX'), num(a.toY, 'toY'), 'arrastrar');
        await d.call('drag', { x: p.x, y: p.y, toX: q.x, toY: q.y });
        return { after: await this.observeAfter() };
      }
      case 'scroll': {
        const args = { clicks: Math.max(-30, Math.min(30, Math.trunc(num(a.clicks, 'clicks')))), horizontal: !!a.horizontal };
        if (a.x != null && a.y != null) Object.assign(args, await this.guardPoint(num(a.x, 'x'), num(a.y, 'y'), 'desplazar', { input: false }));
        await d.call('scroll', args);
        return { after: await this.observeAfter() };
      }
      case 'click_element': {
        const fg = await d.call('foreground');
        if (fg.pid === this.ownPid) throw new Error('la ventana activa es JeanCode');
        if (a.id == null && a.name) a = { ...a, id: (await this.elementByName(String(a.name), a.type)).id };
        const c = this.lastElements?.get(Math.trunc(num(a.id, 'id')));
        if (!c) throw new Error(`el elemento ${a.id} no está en la última inspección: vuelve a usar inspect_screen`);
        const w = await d.call('owner_at', { x: Math.round(c.x), y: Math.round(c.y) });
        if (w.pid === this.ownPid) throw new Error('ese elemento queda debajo de la ventana de JeanCode');
        if (isTerminal(w)) this.takeTerminalApproval(`clic en una terminal (${w.process})`);
        const r = await d.call('click_element', { id: Math.trunc(num(a.id, 'id')), button: a.button, double: !!a.double });
        this.lastText = null;
        return { clicked: redact(r.name), method: r.method, before: redact(fg.title), after: await this.observeAfter(), changes: await this.changes() };
      }
      case 'set_text': {
        await this.guardKeyboard();
        const sid = a.id != null ? Math.trunc(num(a.id, 'id')) : a.name ? (await this.elementByName(String(a.name), a.type || 'Edit').catch(() => this.elementByName(String(a.name)))).id : num(a.id, 'id');
        const r = await d.call('set_text', { id: sid, text: String(a.text ?? '') });
        return { field: redact(r.name), method: r.method, after: await this.observeAfter(), changes: await this.changes() };
      }
      case 'type_text': {
        await this.guardKeyboard();
        const text = String(a.text ?? '');
        if (text.length > 5000) throw new Error('texto demasiado largo para teclear (máx. 5000): usa write_file para archivos');
        await d.call('type', { text }, 20000 + text.length * 30);
        return { typed: text.length, after: await this.observeAfter(), changes: await this.changes() };
      }
      case 'key_press':
      case 'hotkey': {
        await this.guardKeyboard();
        const keys = (Array.isArray(a.keys) ? a.keys : String(a.keys || a.key || '').split('+')).map((k) => String(k).trim()).filter(Boolean);
        if (!keys.length || keys.length > 4) throw new Error('indica de 1 a 4 teclas, p. ej. ["ctrl","s"]');
        const repeat = Math.max(1, Math.min(20, Math.trunc(Number(a.repeat) || 1)));
        for (let i = 0; i < repeat; i++) await d.call('keys', { keys });
        return { keys, repeat, after: await this.observeAfter(), changes: await this.changes() };
      }
      case 'focus_window': return { focused: await d.call('focus', { title: String(a.title || '') }).then((f) => ({ title: redact(f.title), process: f.process })) };
      case 'open_application': {
        const target = String(a.target || '').trim();
        if (!target) throw new Error('indica la aplicación o archivo a abrir');
        const r = await d.call('open', { target, args: Array.isArray(a.args) ? a.args.map(String) : undefined }, 30000);
        return { opened: redact(target), foreground: { title: redact(r.foreground.title), process: r.foreground.process } };
      }
      case 'read_text': {
        // OCR: texto visible de cualquier app, aunque no exponga controles (lienzos, PDF, juegos, web)
        const scope = a.scope === 'screen' ? 'screen' : 'window';
        const r = await this.ocr(scope, true);
        const lines = r.lines.map((l) => { const c = this.toModel(l.rect.x + l.rect.w / 2, l.rect.y + l.rect.h / 2); return { text: redact(l.text), x: c.x, y: c.y }; });
        return { scope, language: r.language, window: { title: redact(r.fg.title), process: r.fg.process }, lines };
      }
      case 'click_text': {
        const hit = await this.findText(String(a.text ?? ''), a.nth);
        const m = this.toModel(hit.x, hit.y);
        const p = await this.guardPoint(m.x, m.y, 'hacer clic');
        await d.call('click', { ...p, button: ['left', 'right'].includes(a.button) ? a.button : 'left', double: !!a.double });
        this.lastText = null;
        return { clicked: redact(hit.line).slice(0, 80), at: m, after: await this.observeAfter(), changes: await this.changes() };
      }
      case 'wait_for': {
        // espera hasta que aparezca un texto (en los controles o, si no, en pantalla con OCR)
        const want = norm(a.text);
        if (!want) throw new Error('indica el texto que esperas');
        const until = Date.now() + Math.max(500, Math.min(30000, Math.trunc(Number(a.timeout_ms) || 10000)));
        for (;;) {
          const fg = await d.call('foreground');
          if (fg.pid !== this.ownPid) {
            const r = await d.call('inspect', { max: 200 }).catch(() => null);
            const el = r?.elements.find((e) => norm(e.name).includes(want) || (!e.password && norm(e.value).includes(want)));
            if (el) return { found: true, in: 'controles', element: elLine({ type: el.type, name: redact(el.name), value: el.password ? '' : redact(el.value) }), window: redact(fg.title) };
            const o = await this.ocr('window', true).catch(() => null);
            const line = o?.lines.find((l) => fuzzy(l.text).includes(fuzzy(a.text)));
            if (line) return { found: true, in: 'pantalla', line: redact(line.text), window: redact(fg.title) };
          }
          if (Date.now() > until) return { found: false, window: redact(fg.title), note: `«${a.text}» no apareció a tiempo` };
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      case 'wait': {
        const ms = Math.max(100, Math.min(15000, Math.trunc(num(a.ms ?? 1000, 'ms'))));
        await new Promise((r) => setTimeout(r, ms));
        return { waited: ms, after: await this.observeAfter() };
      }
      default: throw new Error(`acción desconocida: ${name}`);
    }
  }

  /** Últimas acciones del registro (para la interfaz). */
  recent(n = 60) {
    try {
      const lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n');
      return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
}

module.exports = { ComputerControl, Stopped, MODEL_WIDTH };
