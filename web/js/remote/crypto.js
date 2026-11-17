// Cifrado de extremo a extremo del control remoto (móvil → PC). Funciona igual en el navegador, en el móvil
// (Capacitor), en Electron y en Node (WebCrypto). Nadie entre medias (la Wi-Fi, el Worker, un servidor TURN)
// puede leer ni falsificar mensajes: todo va en AES-256-GCM con una clave que solo tienen el PC y ese móvil.
//
//   secreto (32 bytes, del QR o del emparejamiento)
//     ├─ HKDF "jeancode-remote/key"  → clave AES-GCM
//     └─ HKDF "jeancode-remote/room" → id de sala (hex): el Worker y el servidor LAN solo ven esto
//
// Cada conexión empieza con un saludo que intercambia dos nonces; los demás mensajes llevan como datos
// asociados (AAD) esos nonces y la dirección, y un número de secuencia creciente: un mensaje grabado no se puede
// reenviar en otra conexión, ni repetir, ni devolver en sentido contrario.

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const randomId = (n = 12) => b64u(randomBytes(n));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hkdf(secret, info, length) {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('jeancode-remote-v1'), info: enc.encode(info) }, base, length * 8);
  return new Uint8Array(bits);
}

/** Clave AES-GCM y sala a partir de un secreto (Uint8Array de 32 bytes o texto base64url). */
export async function deriveKeys(secret) {
  const raw = typeof secret === 'string' ? unb64u(secret) : secret;
  if (!(raw instanceof Uint8Array) || raw.length < 32) throw new Error('secreto de emparejamiento no válido');
  const key = await subtle().importKey('raw', await hkdf(raw, 'jeancode-remote/key', 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const room = hex(await hkdf(raw, 'jeancode-remote/room', 16));
  return { key, room };
}

/** Cifra un objeto: { iv, ct } (texto base64url). aad = texto que debe coincidir al descifrar. */
export async function seal(key, obj, aad = '') {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64u(iv), ct: b64u(new Uint8Array(ct)) };
}

/** Descifra { iv, ct }; lanza si la clave, los datos asociados o el contenido no cuadran. */
export async function open(key, box, aad = '') {
  if (!box || typeof box.iv !== 'string' || typeof box.ct !== 'string' || box.ct.length > 4_000_000) throw new Error('mensaje no válido');
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(box.iv), additionalData: enc.encode(aad) }, key, unb64u(box.ct));
  return JSON.parse(dec.decode(pt));
}

/**
 * Sesión cifrada sobre cualquier transporte que mueva texto. role: 'host' (PC) | 'phone'.
 *   hello():   (móvil) primer mensaje, con su nonce
 *   accept():  (PC) responde al hello con el suyo
 * Después, wrap(obj) / unwrap(frame) con AAD = nonces + dirección y secuencia estrictamente creciente.
 */
export class Session {
  constructor(key, role) {
    this.key = key;
    this.role = role;
    this.mine = randomId(16);
    this.theirs = null;
    this.sendSeq = 0;
    this.recvSeq = 0;
  }
  get ready() { return !!this.theirs; }
  aad(dir) { const [p, h] = this.role === 'phone' ? [this.mine, this.theirs] : [this.theirs, this.mine]; return `jc1|${p}|${h}|${dir}`; }

  /** Saludo del móvil: { t: 'hello', ...sealed } con su nonce y lo que quiera presentar (nombre, dispositivo). */
  async hello(extra = {}) {
    return { t: 'hello', ...(await seal(this.key, { nonce: this.mine, at: Date.now(), ...extra }, 'jc1|hello')) };
  }
  /** El PC abre el saludo (rechaza saludos de hace más de 2 minutos) y devuelve [datos del saludo, respuesta]. */
  async accept(frame) {
    const h = await open(this.key, frame, 'jc1|hello');
    if (typeof h.nonce !== 'string' || h.nonce.length < 16) throw new Error('saludo no válido');
    if (Math.abs(Date.now() - Number(h.at)) > 120000) throw new Error('saludo caducado (¿la hora del móvil o del PC está mal?)');
    this.theirs = h.nonce;
    return [h, { t: 'welcome', ...(await seal(this.key, { nonce: this.mine, phone: h.nonce }, 'jc1|welcome')) }];
  }
  /** El móvil abre la respuesta del PC: comprueba que contesta a SU saludo. */
  async welcome(frame) {
    const w = await open(this.key, frame, 'jc1|welcome');
    if (w.phone !== this.mine || typeof w.nonce !== 'string') throw new Error('respuesta de saludo no válida');
    this.theirs = w.nonce;
    return w;
  }
  async wrap(obj) {
    if (!this.ready) throw new Error('la sesión aún no está abierta');
    const dir = this.role === 'phone' ? 'p2h' : 'h2p';
    return { t: 'msg', ...(await seal(this.key, { ...obj, seq: ++this.sendSeq }, this.aad(dir))) };
  }
  async unwrap(frame) {
    if (!this.ready || frame?.t !== 'msg') throw new Error('mensaje fuera de sesión');
    const dir = this.role === 'phone' ? 'h2p' : 'p2h';
    const m = await open(this.key, frame, this.aad(dir));
    if (!(m.seq > this.recvSeq)) throw new Error('mensaje repetido');
    this.recvSeq = m.seq;
    delete m.seq;
    return m;
  }
}

/* ---------------- emparejamiento ---------------- */
export const PAIR_TTL = 10 * 60000;
/** URL del Worker: https, o http solo en este equipo (wrangler dev, para probarlo sin desplegar). */
export const WORKER_URL = /^(https:\/\/[\w.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?)(\/[\w./-]*)?$/;

/** Lo que va en el QR / enlace: { v, host, name, secret, lan[], worker, wkey, exp }. */
export function encodePairing(p) {
  return b64u(enc.encode(JSON.stringify({ v: 1, ...p })));
}
export function decodePairing(text) {
  let s = String(text || '').trim();
  const m = s.match(/[#&?]pair=([\w-]+)/);
  if (m) s = m[1];
  let p;
  try { p = JSON.parse(dec.decode(unb64u(s))); } catch { throw new Error('el código de emparejamiento no es válido'); }
  if (p?.v !== 1 || typeof p.secret !== 'string' || typeof p.host !== 'string') throw new Error('el código de emparejamiento no es válido');
  if (p.exp && Date.now() > p.exp) throw new Error('el código caducó: genera otro en el PC');
  p.lan = (Array.isArray(p.lan) ? p.lan : []).filter((u) => /^wss?:\/\/[\w.:[\]-]+(\/[\w./-]*)?$/.test(u)).slice(0, 6);
  if (p.worker && !WORKER_URL.test(p.worker)) p.worker = '';
  return p;
}
