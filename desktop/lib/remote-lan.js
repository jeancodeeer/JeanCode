// Servidor del control remoto en la red local (misma Wi-Fi): ws://<IP-del-PC>:<puerto>/r/<sala>.
// No descifra nada: pasa los marcos cifrados a la interfaz (que tiene las claves) y devuelve sus respuestas.
// Una conexión cuya sala no conoce la interfaz no recibe nunca respuesta. Límites: 8 conexiones, 2 MB por marco,
// 300 marcos cada 10 s por conexión.
const os = require('node:os');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 47321;
const MAX_CONNS = 8;
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

function create({ onEvent }) {
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
      if (!m || conns.size >= MAX_CONNS) { ws.close(1008, 'no'); return; }
      const id = next++;
      const room = m[1];
      const rate = { n: 0, since: Date.now() };
      conns.set(id, ws);
      onEvent({ type: 'open', conn: id, room, from: req.socket.remoteAddress });
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const now = Date.now();
        if (now - rate.since > RATE.windowMs) { rate.n = 0; rate.since = now; }
        if (++rate.n > RATE.frames) { ws.close(1008, 'demasiados mensajes'); return; }
        onEvent({ type: 'msg', conn: id, room, data: data.toString('utf8') });
      });
      ws.on('close', () => { conns.delete(id); onEvent({ type: 'close', conn: id, room }); });
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

  const status = () => ({ hostname: os.hostname(), running: !!wss, port, urls: wss ? lanAddresses().map((ip) => `ws://${ip}:${port}`) : [], connections: conns.size });
  const send = (conn, text) => { const ws = conns.get(conn); if (ws && ws.readyState === 1) ws.send(String(text)); };
  const close = (conn) => { const ws = conns.get(conn); if (ws) ws.close(1000); };

  return { start, stop, status, send, close };
}

module.exports = { create, lanAddresses, DEFAULT_PORT };
