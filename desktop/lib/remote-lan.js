// Servidor del control remoto en la red local (misma Wi-Fi): ws://<IP-del-PC>:<puerto>/r/<sala>.
// No descifra nada: pasa los marcos cifrados a la interfaz (que tiene las claves) y devuelve sus respuestas.
// Una conexión cuya sala no conoce la interfaz no recibe nunca respuesta, y se cierra si en 8 s no se identificó
// (la interfaz solo contesta a un saludo cifrado con una clave válida). Límites: 8 móviles identificados, 4 conexiones
// sin identificar y 3 por dirección IP; 2 MB por marco y 300 marcos cada 10 s por conexión.
const os = require('node:os');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 47321;
const MAX_CONNS = 8;        // móviles ya identificados
const MAX_PENDING = 4;      // conexiones que aún no se han identificado
const MAX_PER_IP = 3;       // por dirección (un mismo equipo no acapara las plazas)
const HELLO_MS = 8000;      // tiempo para identificarse antes de que se cierre la conexión
const RATE = { frames: 300, windowMs: 10000 };

/** IPv4 privadas del equipo (Wi-Fi / Ethernet), sin las de máquinas virtuales más típicas al final. */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      // adaptadores de máquinas virtuales (por nombre o por fabricante de la MAC): al final, el móvil no está ahí
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|br-|veth|utun|tailscale/i.test(name)
        || /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:05:69|00:1c:14|00:15:5d|02:42)/i.test(a.mac || '');
      out.push({ address: a.address, virtual });
    }
  }
  return out.sort((x, y) => x.virtual - y.virtual).map((x) => x.address);
}

function create({ onEvent, helloMs = HELLO_MS }) {
  let wss = null;
  let port = 0;
  const conns = new Map();
  let next = 1;

  const listen = (p) => new Promise((resolve, reject) => {
    const s = new WebSocketServer({ host: '0.0.0.0', port: p, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });

  async function start(preferred = DEFAULT_PORT) {
    if (wss) return status();
    try { wss = await listen(preferred); } catch { wss = await listen(0); } // puerto ocupado: uno libre cualquiera
    port = wss.address().port;
    wss.on('connection', (ws, req) => {
      const m = String(req.url || '').match(/^\/r\/([0-9a-f]{32})$/);
      const ip = req.socket.remoteAddress || '';
      const all = [...conns.values()];
      const pendingCount = all.filter((c) => !c.authed).length;
      const fromIp = all.filter((c) => c.ip === ip).length;
      if (!m || pendingCount >= MAX_PENDING || all.filter((c) => c.authed).length >= MAX_CONNS || fromIp >= MAX_PER_IP) { ws.close(1008, 'no'); return; }
      const id = next++;
      const room = m[1];
      const rate = { n: 0, since: Date.now() };
      ws.ip = ip;
      ws.authed = false;
      // sin respuesta de la interfaz (= sin saludo válido) en HELLO_MS, fuera
      ws.helloTimer = setTimeout(() => { if (!ws.authed) ws.close(1008, 'sin identificar'); }, helloMs);
      conns.set(id, ws);
      onEvent({ type: 'open', conn: id, room, from: req.socket.remoteAddress });
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const now = Date.now();
        if (now - rate.since > RATE.windowMs) { rate.n = 0; rate.since = now; }
        if (++rate.n > RATE.frames) { ws.close(1008, 'demasiados mensajes'); return; }
        onEvent({ type: 'msg', conn: id, room, data: data.toString('utf8') });
      });
      ws.on('close', () => { clearTimeout(ws.helloTimer); conns.delete(id); onEvent({ type: 'close', conn: id, room }); });
      ws.on('error', () => {});
    });
    return status();
  }

  function stop() {
    for (const ws of conns.values()) { try { ws.close(1001, 'control remoto desactivado'); } catch { /* */ } }
    conns.clear();
    if (wss) { wss.close(); wss = null; port = 0; }
    return status();
  }

  const status = () => ({ hostname: os.hostname(), running: !!wss, port, urls: wss ? lanAddresses().map((ip) => `ws://${ip}:${port}`) : [], connections: [...conns.values()].filter((c) => c.authed).length });
  // la interfaz solo envía algo tras un saludo cifrado válido: a partir de ahí la conexión cuenta como identificada
  const send = (conn, text) => { const ws = conns.get(conn); if (ws && ws.readyState === 1) { ws.authed = true; clearTimeout(ws.helloTimer); ws.send(String(text)); } };
  const close = (conn) => { const ws = conns.get(conn); if (ws) ws.close(1000); };

  return { start, stop, status, send, close };
}

module.exports = { create, lanAddresses, DEFAULT_PORT };
