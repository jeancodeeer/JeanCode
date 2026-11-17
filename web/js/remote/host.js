// Control remoto, lado PC (como Remote Control de Claude Code): el agente sigue corriendo en el PC y un móvil
// emparejado lo maneja: ve las conversaciones en vivo, escribe, para, cambia permisos y aprueba los diálogos.
//
// Emparejar: el PC genera un código de un solo uso (QR + enlace, 10 min). El móvil saluda con él y pide emparejarse;
// tú lo apruebas en el PC; el PC le da una clave propia (revocable en Ajustes) y el código deja de valer.
//
// Protocolo (ya dentro de la sesión cifrada):
//   móvil → PC   pair · state · threads · open {id} · send {text, thread?} · stop · new · perm {value} · agent {value}
//                answer {id, value} (respuesta a un diálogo de permiso)
//   PC → móvil   paired · state · threads · thread · event {ev} · confirm {id, …} · confirm-done {id} · error {message}
import { deriveKeys, randomBytes, randomId, b64u, encodePairing, PAIR_TTL, WORKER_URL } from './crypto.js';
import { HostAcceptor, Pipe, wsPipe, relayUrl } from './link.js';

export const PAIR_WEB_URL = 'https://jeancodeeer.github.io/JeanCode/';
const MAX_DEVICES = 10;

/**
 * app: { snapshot(), threads(), thread(id), send(text, threadId), stop(), newThread(), setPerm(v), setAgent(v),
 *        confirmPair({ name, platform }) → bool, toast(text), hostName() }
 */
export function createRemoteHost({ desktop, app }) {
  let data = { hostId: '', enabled: false, lan: true, worker: '', wkey: '', devices: [] };
  let pairing = null;               // { secret, room, key, exp }
  const keys = new Map();           // sala → { key, kind: 'device' | 'pair', device? }
  const clients = new Set();        // Links abiertos de móviles emparejados
  const relays = new Map();         // sala → { pipe, timer, backoff }
  const lanPipes = new Map();       // conexión LAN → Pipe
  const pending = new Map();        // id de diálogo → { resolve, opts }
  let lan = { running: false, urls: [], port: 0 };
  let listeners = [];
  const changed = () => listeners.forEach((fn) => fn(status()));

  const acceptor = new HostAcceptor({ rooms: async (room) => keys.get(room) || null, onLink });

  const save = () => desktop.remote.save(data);
  async function load() {
    data = { ...data, ...(await desktop.remote.load().catch(() => ({}))) };
    data.devices = Array.isArray(data.devices) ? data.devices : [];
    if (!data.hostId) { data.hostId = randomId(9); await save(); }
    await rebuildKeys();
    desktop.remote.onLan(onLanEvent);
    if (data.enabled) await start();
    changed();
  }

  async function rebuildKeys() {
    for (const [room, e] of [...keys]) if (e.kind === 'device') keys.delete(room);
    for (const d of data.devices) {
      const { key, room } = await deriveKeys(d.secret);
      keys.set(room, { key, kind: 'device', device: d });
    }
  }

  /* ---------------- transportes ---------------- */
  async function start() {
    if (data.lan !== false) lan = await desktop.remote.lanStart().catch((e) => { app.toast(`CONTROL REMOTO: NO SE PUDO ESCUCHAR EN LA WI-FI (${e.message})`); return { running: false, urls: [] }; });
    syncRelays();
    changed();
  }
  async function stop() {
    lan = await desktop.remote.lanStop().catch(() => ({ running: false, urls: [] }));
    for (const room of [...relays.keys()]) dropRelay(room);
    for (const l of [...clients]) l.close();
    changed();
  }

  function onLanEvent(ev) {
    if (ev.type === 'open') {
      const p = new Pipe('lan');
      p.send = (obj) => desktop.remote.lanSend(ev.conn, JSON.stringify(obj));
      p.close = () => { desktop.remote.lanClose(ev.conn); p.ended(); };
      lanPipes.set(ev.conn, p);
      acceptor.accept(p, ev.room);
    } else if (ev.type === 'msg') lanPipes.get(ev.conn)?.deliver(ev.data);
    else if (ev.type === 'close') { lanPipes.get(ev.conn)?.ended(); lanPipes.delete(ev.conn); }
  }

  /** Una conexión al Worker por sala (cada móvil emparejado + el código de emparejamiento activo). */
  function syncRelays(keep = new Set()) {
    const want = data.enabled && data.worker ? new Set(keys.keys()) : new Set();
    for (const room of [...relays.keys()]) if (!want.has(room) && !keep.has(room)) dropRelay(room);
    for (const room of want) if (!relays.has(room)) openRelay(room);
  }
  function openRelay(room) {
    const r = { pipe: null, timer: null, backoff: 3000 };
    relays.set(room, r);
    const go = async () => {
      if (relays.get(room) !== r) return;
      try {
        const pipe = await wsPipe(relayUrl(data.worker, room, 'host', data.wkey), 'relay', { timeout: 10000 });
        if (relays.get(room) !== r) { pipe.close(); return; }
        r.pipe = pipe; r.backoff = 3000;
        acceptor.accept(pipe, room);
        pipe.ondead = () => { r.pipe = null; retry(); changed(); };
        changed();
      } catch { retry(); }
    };
    const retry = () => {
      if (relays.get(room) !== r) return;
      clearTimeout(r.timer);
      r.timer = setTimeout(go, r.backoff);
      r.backoff = Math.min(r.backoff * 2, 60000);
    };
    go();
  }
  function dropRelay(room) {
    const r = relays.get(room);
    relays.delete(room);
    if (!r) return;
    clearTimeout(r.timer);
    r.pipe?.close();
  }

  /* ---------------- emparejamiento ---------------- */
  async function startPairing() {
    if (!data.enabled) throw new Error('activa primero el control remoto');
    if (data.devices.length >= MAX_DEVICES) throw new Error(`ya hay ${MAX_DEVICES} móviles emparejados: quita alguno`);
    cancelPairing();
    const secret = b64u(randomBytes(32));
    const { key, room } = await deriveKeys(secret);
    pairing = { secret, room, key, exp: Date.now() + PAIR_TTL };
    keys.set(room, { key, kind: 'pair' });
    syncRelays();
    setTimeout(() => { if (pairing?.room === room) { cancelPairing(); changed(); } }, PAIR_TTL + 1000);
    const code = encodePairing({ host: data.hostId, name: app.hostName(), secret, lan: lan.urls || [], worker: data.worker || '', wkey: data.wkey || '', exp: pairing.exp });
    const url = `${PAIR_WEB_URL}#pair=${code}`;
    changed();
    return { code, url, exp: pairing.exp, qr: await desktop.remote.qr(url).catch(() => '') };
  }
  function cancelPairing() {
    if (!pairing) return;
    keys.delete(pairing.room);
    dropRelay(pairing.room);
    pairing = null;
  }

  /* ---------------- conexiones ---------------- */
  function onLink(link, hello, entry) {
    if (entry.kind === 'pair') return pairLink(link, hello);
    const dev = entry.device;
    if (!data.devices.some((d) => d.id === dev.id)) { link.close(); return; } // revocado
    dev.lastSeen = Date.now();
    save();
    link.device = dev;
    clients.add(link);
    link.on('close', () => { clients.delete(link); changed(); });
    link.on('kind', () => changed());
    link.on('message', (m) => handle(link, m).catch((e) => link.send({ type: 'error', message: String(e.message || e) })));
    changed();
    app.toast(`MÓVIL CONECTADO: ${String(dev.name).toUpperCase()} (${link.kind === 'lan' ? 'WI-FI' : link.kind === 'p2p' ? 'P2P' : 'RELAY'})`);
    link.send({ type: 'state', ...app.snapshot() });
    for (const [id, p] of pending) link.send({ type: 'confirm', id, ...p.opts });
  }

  function pairLink(link, hello) {
    link.on('message', async (m) => {
      if (m.type !== 'pair' || !pairing) return;
      const name = String(m.name || hello.name || 'Móvil').slice(0, 40);
      const platform = String(m.platform || '').slice(0, 20);
      const ok = await app.confirmPair({ name, platform });
      if (!ok || !pairing) { await link.send({ type: 'error', message: 'El PC rechazó el emparejamiento.' }); link.close(); return; }
      const device = { id: randomId(9), name, platform, secret: b64u(randomBytes(32)), created: Date.now(), lastSeen: 0 };
      data.devices.push(device);
      await save();
      await rebuildKeys();
      // el código deja de valer YA (nadie más puede usarlo), pero su sala en el Worker se cierra después de
      // entregar la clave: si se cerrara antes, el Worker avisaría al móvil de que el PC se fue y no la recibiría
      const used = pairing;
      pairing = null;
      keys.delete(used.room);
      syncRelays(new Set([used.room])); // abre ya la sala del móvil nuevo y conserva un momento la del código
      await link.send({ type: 'paired', device: { id: device.id, secret: device.secret }, host: { id: data.hostId, name: app.hostName() } });
      setTimeout(() => { link.close(); dropRelay(used.room); }, 1500);
      app.toast(`MÓVIL EMPAREJADO: ${name.toUpperCase()}`);
      changed();
    });
  }

  async function handle(link, m) {
    switch (m.type) {
      case 'state': return link.send({ type: 'state', ...app.snapshot() });
      case 'threads': return link.send({ type: 'threads', list: app.threads() });
      case 'open': return link.send({ type: 'thread', ...(app.thread(String(m.id)) || { id: null, title: '', messages: [] }) });
      case 'send': {
        const text = String(m.text || '').slice(0, 100000).trim();
        if (!text) return undefined;
        await app.send(text, m.thread ? String(m.thread) : null, link.device);
        return undefined;
      }
      case 'stop': app.stop(); return undefined;
      case 'new': app.newThread(); return link.send({ type: 'state', ...app.snapshot() });
      case 'perm': app.setPerm(String(m.value)); return broadcast({ type: 'state', ...app.snapshot() });
      case 'agent': app.setAgent(String(m.value)); return broadcast({ type: 'state', ...app.snapshot() });
      case 'answer': {
        const p = pending.get(String(m.id));
        if (p) p.resolve(m.value === 'always' ? (p.opts.allowAlways ? 'always' : true) : m.value === true);
        return undefined;
      }
      default: return link.send({ type: 'error', message: `orden desconocida: ${m.type}` });
    }
  }

  function broadcast(obj) { for (const l of clients) l.send(obj); }

  /**
   * Un diálogo de permiso del agente: se envía a los móviles conectados. Devuelve { promise, cancel }.
   * El primero que responda (el PC o un móvil) gana; cancel() avisa a los móviles de que ya se resolvió.
   */
  function ask(opts) {
    if (!clients.size) return null;
    const id = randomId(8);
    const shown = { title: opts.title, command: opts.command ?? null, path: opts.path ?? null,
      before: opts.before != null ? String(opts.before).slice(0, 20000) : null, after: opts.after != null ? String(opts.after).slice(0, 20000) : null,
      allowAlways: !!opts.allowAlways, where: opts.where ?? null };
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    pending.set(id, { resolve, opts: shown });
    broadcast({ type: 'confirm', id, ...shown });
    const cancel = () => { if (pending.delete(id)) broadcast({ type: 'confirm-done', id }); };
    promise.then(cancel);
    return { promise, cancel };
  }

  /* ---------------- ajustes ---------------- */
  async function configure(patch) {
    const wasOn = data.enabled;
    data = { ...data, ...patch };
    if (patch.worker !== undefined) data.worker = String(patch.worker || '').trim().replace(/\/+$/, '');
    if (data.worker && !WORKER_URL.test(data.worker)) throw new Error('la URL del Worker debe empezar por https://');
    await save();
    if (data.enabled && !wasOn) await start();
    else if (!data.enabled && wasOn) { cancelPairing(); await stop(); }
    else if (data.enabled) {
      if (patch.lan === false) lan = await desktop.remote.lanStop();
      if (patch.lan === true && !lan.running) lan = await desktop.remote.lanStart().catch(() => lan);
      for (const room of [...relays.keys()]) dropRelay(room);
      syncRelays();
    }
    changed();
  }
  async function revoke(id) {
    data.devices = data.devices.filter((d) => d.id !== id);
    await save();
    await rebuildKeys();
    for (const l of [...clients]) if (l.device?.id === id) l.close();
    syncRelays();
    changed();
  }

  function status() {
    return {
      enabled: !!data.enabled, lan: data.lan !== false, worker: data.worker, wkey: data.wkey, lanUrls: lan.urls || [],
      lanRunning: !!lan.running, pairing: pairing ? { exp: pairing.exp } : null,
      relayRooms: [...relays.values()].filter((r) => r.pipe).length,
      devices: data.devices.map((d) => ({ id: d.id, name: d.name, platform: d.platform, created: d.created, lastSeen: d.lastSeen,
        online: [...clients].filter((l) => l.device?.id === d.id).map((l) => l.kind) })),
    };
  }

  return {
    load, configure, revoke, startPairing, cancelPairing, status, ask,
    connected: () => clients.size > 0,
    emit: (ev) => broadcast({ type: 'event', ev }),
    pushState: () => broadcast({ type: 'state', ...app.snapshot() }),
    pushThreads: () => broadcast({ type: 'threads', list: app.threads() }),
    onChange: (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((x) => x !== fn); }; },
  };
}
