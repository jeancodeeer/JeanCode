// Acceso al propio teléfono para el mini agente del móvil. Una app normal no puede ejecutar comandos ni tocar la
// pantalla; hace falta un ayudante con privilegios que corre en el mismo teléfono:
//
//   Android (modo desarrollador)  Shizuku: el plugin nativo JeanDevice abre, con permiso de Shizuku, un proceso con
//                                 permisos de shell (como `adb shell`): comandos, archivos, input, screencap, uiautomator.
//   iPhone (jailbreak)            jeancode_helper.py (mobile/ios-helper): servicio local en 127.0.0.1:47322 con un token.
//
// Interfaz común: status(), exec(cmd, timeoutMs) → { code, out, err }, readFile(path) → texto base64,
// writeFile(path, b64), screenshot(maxWidth) → { b64, mime, width, height } | null (sin pantalla).

export const IOS_HELPER_URL = 'http://127.0.0.1:47322';
const MAX_READ = 4 * 1024 * 1024;

const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
export const platformOf = () => cap()?.getPlatform?.() || 'web';

/** Android: plugin nativo JeanDevice (Shizuku). */
function androidBackend() {
  const P = cap()?.Plugins?.JeanDevice;
  if (!P) return null;
  return {
    kind: 'android',
    label: 'Android (Shizuku)',
    status: () => P.status(),
    request: () => P.requestPermission(),
    exec: (cmd, timeoutMs = 120000) => P.exec({ cmd, timeout: timeoutMs }),
    readFile: async (path) => (await P.readFile({ path, maxBytes: MAX_READ })).b64,
    writeFile: (path, b64) => P.writeFile({ path, b64 }),
    screenshot: (maxWidth = 720) => P.screenshot({ maxWidth }),
    screen: true,
  };
}

/** iPhone con jailbreak: el ayudante de Python en localhost. http = (url, body, headers) → objeto JSON. */
export function iosBackend({ url = IOS_HELPER_URL, token, http }) {
  const call = async (path, body = {}) => {
    const r = await http(`${url}${path}`, body, { Authorization: `Bearer ${token}` });
    if (r?.error) throw new Error(r.error);
    return r;
  };
  return {
    kind: 'ios',
    label: 'iPhone (ayudante de Python)',
    status: async () => {
      try { const s = await call('/status'); return { ready: true, ...s }; } catch (e) { return { ready: false, reason: String(e.message || e) }; }
    },
    request: async () => ({ granted: true }),
    exec: (cmd, timeoutMs = 120000) => call('/exec', { cmd, timeout: timeoutMs }),
    readFile: async (path) => (await call('/read', { path, maxBytes: MAX_READ })).b64,
    writeFile: (path, b64) => call('/write', { path, b64 }),
    screenshot: async () => null, // la pantalla de iOS necesita un tweak aparte: aún no
    screen: false,
  };
}

/** POST JSON por la red nativa (sin CORS ni contenido mixto) o, en el navegador, con fetch. */
export async function nativePost(url, body, headers = {}) {
  const H = cap()?.Plugins?.CapacitorHttp;
  if (H) {
    const r = await H.request({ url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, data: body, connectTimeout: 5000, readTimeout: 180000 });
    if (r.status === 401) throw new Error('token del ayudante incorrecto');
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (r.status === 401) throw new Error('token del ayudante incorrecto');
  return r.json();
}

/** El backend de este teléfono, o null si la app no corre en Android/iOS. */
export function deviceBackend({ iosToken = '', iosUrl = IOS_HELPER_URL } = {}) {
  const p = platformOf();
  if (p === 'android') return androidBackend();
  if (p === 'ios') return iosBackend({ url: iosUrl, token: iosToken, http: nativePost });
  return null;
}

/* ---------------- utilidades de texto ---------------- */
export const b64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64 || ''), (c) => c.charCodeAt(0)));
export function textToB64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Comillas simples de shell POSIX: el texto nunca se interpreta. */
export const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
