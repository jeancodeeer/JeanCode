// Transportes del control remoto. Todo viaja cifrado por la sesión de crypto.js; aquí solo se mueven marcos de texto.
//
//   lan    WebSocket directo al PC en la misma Wi-Fi (ws://IP:puerto/r/<sala>): sin terceros
//   p2p    WebRTC (canal de datos) por internet; la señalización (oferta/respuesta/candidatos) va cifrada
//          por el Worker; STUN público solo para descubrir la IP. Los datos van de móvil a PC directamente
//   relay  si el P2P no conecta (redes que lo bloquean): los marcos cifrados pasan por TU Worker de Cloudflare
//
// El móvil prueba lan → relay (+ intento de subir a p2p). El PC escucha en lan y mantiene abierta su sala en el Worker.
// Marcos: { t: 'hello' | 'welcome' | 'msg', iv, ct } (cifrados) y { t: 'peer', state: 'join' | 'leave' } (del Worker).
import { Session, deriveKeys } from './crypto.js';

export const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const MAX_FRAME = 2_000_000;

/** URL del Worker para una sala: wss://<worker>/remote/<sala>?role=host|phone[&k=clave] */
export function relayUrl(worker, room, role, wkey = '') {
  const u = new URL(`/remote/${room}`, String(worker).replace(/^http/, 'ws'));
  u.searchParams.set('role', role);
  if (wkey) u.searchParams.set('k', wkey);
  return u.toString();
}

/* ---------------- tuberías: { kind, send(obj), close(), onmessage, onclose } ---------------- */
export class Pipe {
  constructor(kind) { this.kind = kind; this.onmessage = null; this.onclose = null; this.closed = false; }
  deliver(text) {
    if (typeof text !== 'string' || text.length > MAX_FRAME) return;
    let obj;
    try { obj = JSON.parse(text); } catch { return; }
    if (obj && typeof obj === 'object') this.onmessage?.(obj);
  }
  // onclose lo usa quien lee la tubería; ondead, quien la mantiene viva (reconexión del relay)
  ended() { if (!this.closed) { this.closed = true; this.onclose?.(); this.ondead?.(); } }
}

/** WebSocket (lan o relay). Resuelve al abrir; rechaza si no abre en `timeout` ms. */
export function wsPipe(url, kind, { timeout = 4000, WS = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WS(url); } catch (e) { reject(e); return; }
    const p = new Pipe(kind);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error(`sin respuesta (${kind})`)); }, timeout);
    ws.onopen = () => { clearTimeout(timer); resolve(p); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`no se pudo conectar (${kind})`)); };
    ws.onmessage = (e) => p.deliver(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => { clearTimeout(timer); p.ended(); };
    p.send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
    p.close = () => { try { ws.close(); } catch { /* */ } p.ended(); };
  });
}

/** Canal de datos WebRTC como tubería. */
export function dcPipe(dc, pc) {
  const p = new Pipe('p2p');
  dc.onmessage = (e) => p.deliver(typeof e.data === 'string' ? e.data : '');
  dc.onclose = () => { try { pc.close(); } catch { /* */ } p.ended(); };
  pc.addEventListener?.('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) p.ended(); });
  p.send = (obj) => { if (dc.readyState === 'open') dc.send(JSON.stringify(obj)); };
  p.close = () => { try { dc.close(); } catch { /* */ } try { pc.close(); } catch { /* */ } p.ended(); };
  return p;
}

/**
 * Una conexión abierta: tubería + sesión cifrada. on('message' | 'close' | 'kind', fn).
 * intercept(m) → true para consumir un mensaje antes de la interfaz (señalización WebRTC).
 * onHello(frame): saludo nuevo por la misma tubería (el móvil se reconectó por el relay).
 */
export class Link {
  constructor(pipe, session) {
    this.pipe = pipe; this.session = session; this.handlers = {}; this.intercept = null; this.onHello = null; this.closed = false;
    this.attach(pipe, session);
  }
  get kind() { return this.pipe.kind; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  emit(ev, x) { this.handlers[ev]?.(x); }
  end() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  attach(pipe, session) {
    pipe.onmessage = async (frame) => {
      if (pipe !== this.pipe) return;
      if (frame.t === 'hello') { this.onHello?.(frame); return; }
      if (frame.t === 'peer' && frame.state === 'leave') { this.end(); return; } // el móvil se fue del relay
      if (frame.t !== 'msg') return;
      let obj;
      try { obj = await session.unwrap(frame); } catch { return; } // ajeno, repetido o manipulado: se ignora
      if (this.intercept && (await this.intercept(obj))) return;
      this.emit('message', obj);
    };
    pipe.onclose = () => { if (pipe === this.pipe) this.end(); };
  }
  /** Cambia a otra tubería ya saludada (de relay a p2p) sin perder la conexión. */
  swap(pipe, session) {
    const old = this.pipe;
    this.pipe = pipe; this.session = session;
    this.attach(pipe, session);
    old.onclose = null;
    old.close();
    this.emit('kind', pipe.kind);
  }
  async send(obj) { if (!this.closed && !this.pipe.closed) this.pipe.send(await this.session.wrap(obj)); }
  close() { this.pipe.close(); this.end(); }
}

/** Saludo del móvil sobre una tubería: devuelve la sesión abierta. */
async function greet(pipe, key, extra, timeout = 6000) {
  const s = new Session(key, 'phone');
  const got = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el PC no respondió (¿está JeanCode abierto con el control remoto activado?)')), timeout);
    pipe.onmessage = async (f) => {
      // el PC entró en la sala del Worker después que nosotros: el primer saludo se perdió, se repite
      if (f.t === 'peer' && f.role === 'host' && f.state === 'join') { pipe.send(await s.hello(extra)); return; }
      if (f.t !== 'welcome') return;
      try { await s.welcome(f); clearTimeout(timer); resolve(s); } catch { /* no es para nosotros */ }
    };
    pipe.onclose = () => { clearTimeout(timer); reject(new Error('conexión cerrada')); };
  });
  pipe.send(await s.hello(extra));
  return got;
}

/**
 * Móvil: conecta con el PC. target: { secret, lan[], worker, wkey }. Devuelve un Link.
 * onStatus(texto) informa del intento en curso. p2p = false desactiva la subida a WebRTC.
 */
export async function phoneConnect(target, { hello = {}, onStatus = () => {}, p2p = true, WS, RTC = globalThis.RTCPeerConnection } = {}) {
  const { key, room } = await deriveKeys(target.secret);
  const errors = [];
  const lan = (target.lan || []).slice(0, 6);
  if (lan.length) {
    // todas las IPs del PC a la vez (Wi-Fi, cable, adaptadores virtuales…): gana la primera que salude
    onStatus('Buscando el PC en la Wi-Fi…');
    const tries = lan.map(async (base) => {
      const pipe = await wsPipe(`${base.replace(/\/+$/, '')}/r/${room}`, 'lan', { timeout: 2500, WS });
      try { return new Link(pipe, await greet(pipe, key, hello, 4000)); } catch (e) { pipe.close(); throw e; }
    });
    try {
      const winner = await Promise.any(tries);
      for (const t of tries) t.then((l) => { if (l !== winner) l.close(); }, () => {}); // si saludaron varias, sobra el resto
      return winner;
    } catch (e) { errors.push(...(e.errors || [e]).map((x) => x.message)); }
  }
  if (!target.worker) throw new Error(`No se encontró el PC en esta Wi-Fi${errors.length ? ` (${errors[0]})` : ''}. Para conectar desde fuera hace falta configurar el Worker en el PC.`);
  onStatus('Conectando por internet…');
  const pipe = await wsPipe(relayUrl(target.worker, room, 'phone', target.wkey), 'relay', { timeout: 8000, WS });
  const link = new Link(pipe, await greet(pipe, key, hello, 10000));
  if (p2p && RTC) upgradeToP2P(link, key, hello, RTC).catch(() => { /* se queda en relay */ });
  return link;
}

/** Móvil: intenta pasar la conexión del relay a WebRTC directo; la señalización va por la sesión cifrada. */
async function upgradeToP2P(link, key, hello, RTC) {
  const pc = new RTC({ iceServers: ICE_SERVERS });
  const dc = pc.createDataChannel('jeancode', { ordered: true });
  const open = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('p2p no conectó')), 12000);
    dc.onopen = () => { clearTimeout(timer); resolve(); };
  });
  link.intercept = async (m) => {
    if (m.type === 'rtc-answer') { try { await pc.setRemoteDescription(m.sdp); } catch { /* */ } return true; }
    if (m.type === 'rtc-ice') { try { await pc.addIceCandidate(m.candidate); } catch { /* */ } return true; }
    return false;
  };
  pc.onicecandidate = (e) => { if (e.candidate) link.send({ type: 'rtc-ice', candidate: e.candidate.toJSON() }); };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await link.send({ type: 'rtc-offer', sdp: pc.localDescription.toJSON() });
    await open;
    const dp = dcPipe(dc, pc);
    const s = await greet(dp, key, { ...hello, upgrade: true });
    link.swap(dp, s);
  } catch (e) {
    try { pc.close(); } catch { /* */ }
    throw e;
  } finally { link.intercept = null; }
}

/**
 * PC: recibe tuberías (LAN, relay, p2p) y abre sesiones. rooms(room) → { key, ... } | null.
 * onLink(link, helloData, entry) cuando un móvil saluda. RTC: RTCPeerConnection (para responder a la subida a p2p).
 */
export class HostAcceptor {
  constructor({ rooms, onLink, RTC = globalThis.RTCPeerConnection }) {
    this.rooms = rooms; this.onLink = onLink; this.RTC = RTC;
    this.links = new Set();
  }
  /** Una tubería nueva para la sala `room`. Cada "hello" abre una sesión nueva sobre ella. */
  accept(pipe, room, upgradeOf = null) {
    let current = null;
    const onHello = async (frame) => {
      const entry = await this.rooms(room);
      if (!entry) return;
      const s = new Session(entry.key, 'host');
      let h, welcome;
      try { [h, welcome] = await s.accept(frame); } catch { return; }
      pipe.send(welcome);
      if (h.upgrade && upgradeOf && !upgradeOf.closed) { upgradeOf.swap(pipe, s); return; }
      current?.end(); // el móvil volvió a saludar por la misma tubería: la conexión anterior termina
      const link = new Link(pipe, s);
      current = link;
      link.onHello = onHello;
      this.links.add(link);
      link.on('close', () => this.links.delete(link));
      this.wireRtc(link, room);
      this.onLink(link, h, entry);
    };
    pipe.onmessage = (frame) => { if (frame.t === 'hello') onHello(frame); };
  }
  /** Responde a la oferta WebRTC del móvil y, cuando abre el canal, lo acepta como mejora de ese Link. */
  wireRtc(link, room) {
    let pc = null;
    link.intercept = async (m) => {
      if (m.type === 'rtc-offer') {
        if (!this.RTC) return true;
        try { pc?.close(); } catch { /* */ }
        pc = new this.RTC({ iceServers: ICE_SERVERS });
        const mine = pc;
        mine.onicecandidate = (e) => { if (e.candidate) link.send({ type: 'rtc-ice', candidate: e.candidate.toJSON() }); };
        mine.ondatachannel = (e) => {
          const dc = e.channel;
          const go = () => this.accept(dcPipe(dc, mine), room, link);
          if (dc.readyState === 'open') go(); else dc.onopen = go;
        };
        try {
          await mine.setRemoteDescription(m.sdp);
          await mine.setLocalDescription(await mine.createAnswer());
          await link.send({ type: 'rtc-answer', sdp: mine.localDescription.toJSON() });
        } catch { /* sin p2p: sigue por relay */ }
        return true;
      }
      if (m.type === 'rtc-ice') { if (pc) { try { await pc.addIceCandidate(m.candidate); } catch { /* */ } } return true; }
      return false;
    };
  }
}

export { deriveKeys };
