// Comprobación de enlaces (¿existe esta URL?) sin poder usarse contra la red local.
// Los enlaces vienen del modelo o de contenido que leyó: se resuelve el DNS, se rechaza si CUALQUIER
// dirección es local/privada, y se conecta exactamente a la IP validada (un rebind de DNS no la cambia).
// Solo origen + ruta, sin parámetros, sin seguir redirecciones y sin descargar el cuerpo.
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

/** ¿Dirección IP pública? (no loopback, privada, enlace local, CGNAT, multicast, reservada ni IPv4 dentro de IPv6) */
function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    if (/^::ffff:/.test(v) || /^(fc|fd)/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || /^64:ff9b:/.test(v) || /^2001:db8:/.test(v)) return false;
    return true;
  }
  return false;
}

/** URL comprobable o motivo del rechazo. */
function parseTarget(href) {
  let u;
  try { u = new URL(String(href)); } catch { return { error: 'URL inválida' }; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { error: 'solo http(s) sin credenciales' };
  const host = u.hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) return { error: 'sin host' };
  return { u, host };
}

/** { ok: true|false, status?, reason? } — nunca lanza. */
async function checkLink(href, { timeout = 7000 } = {}) {
  const t = parseTarget(href);
  if (t.error) return { ok: false, local: false, reason: t.error };
  let addrs;
  try { addrs = net.isIP(t.host) ? [{ address: t.host, family: net.isIP(t.host) }] : await dns.lookup(t.host, { all: true, verbatim: true }); } catch { return { ok: false, reason: 'el dominio no existe' }; }
  if (!addrs.length || addrs.some((a) => !isPublicIp(a.address))) return { ok: false, local: true, reason: 'apunta a la red local o privada: no se comprueba' };
  const pinned = addrs[0];
  const lib = t.u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = lib.request({
      protocol: t.u.protocol, hostname: t.host, port: t.u.port || undefined, path: t.u.pathname || '/', method: 'GET',
      headers: { 'User-Agent': 'JeanCode link check', Accept: '*/*' }, servername: net.isIP(t.host) ? undefined : t.host,
      // la conexión va a la IP ya validada (no se vuelve a resolver)
      lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)),
      timeout,
    }, (res) => {
      const status = res.statusCode || 0;
      res.destroy();
      // 3xx = existe (no se sigue); 401/403/405/429 = existe pero no deja ver
      resolve({ ok: status < 400 || [401, 403, 405, 429].includes(status), status });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'sin respuesta a tiempo' }); });
    req.on('error', (e) => resolve({ ok: false, reason: e.code || e.message }));
    req.end();
  });
}

module.exports = { checkLink, isPublicIp, parseTarget };
