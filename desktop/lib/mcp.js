// Conexiones con otras apps vía MCP (Model Context Protocol), como en Claude Code.
// Un servidor MCP da herramientas al agente: GitHub, Gmail, Drive, Calendar, Notion, Linear...
//   http   servidor remoto (Streamable HTTP); con OAuth 2.1 si lo pide (se abre el navegador)
//   stdio  programa local (npx/uvx/...): lo configura el usuario, nunca un archivo del proyecto
// Las herramientas se ofrecen al modelo como mcp__<servidor>__<herramienta>.
// Lo que devuelve un servidor son DATOS para el modelo, no órdenes (lo dice el prompt del agente).
const http = require('node:http');
const crypto = require('node:crypto');
// El SDK tarda ~0,5 s en caliente y varios segundos en frío: se carga la primera vez que se usa una app,
// no al abrir JeanCode.
let SDK = null;
function sdk() {
  if (!SDK) {
    SDK = {
      ...require('@modelcontextprotocol/sdk/client/index.js'),
      ...require('@modelcontextprotocol/sdk/client/stdio.js'),
      ...require('@modelcontextprotocol/sdk/client/streamableHttp.js'),
      ...require('@modelcontextprotocol/sdk/client/auth.js'),
    };
  }
  return SDK;
}

const CLIENT_INFO = { name: 'JeanCode', version: '1' };
const OAUTH_PORT = 33418;                   // fijo: el registro OAuth guarda esta redirección exacta
const OAUTH_PATH = '/oauth/callback';
const REDIRECT = `http://127.0.0.1:${OAUTH_PORT}${OAUTH_PATH}`;
const CALL_TIMEOUT = 120000;
const MAX_TEXT = 20000;

/** Nombre corto y seguro para el prefijo de las herramientas (mcp__github__create_issue). */
const slug = (s) => String(s || 'mcp').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'mcp';

/** En Windows, npx/uvx/npm son .cmd y no se pueden lanzar sin shell: se envuelven en cmd /c. */
function spawnSpec(command, args) {
  if (process.platform === 'win32' && /^(npx|npm|uvx|uv|pnpm|bunx|yarn)$/i.test(command)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
  }
  return { command, args };
}

/** Proveedor OAuth del SDK: guarda tokens y registro del cliente en el almacén cifrado. */
class OAuthProvider {
  constructor(server, persist, open) {
    this.server = server;        // definición del servidor (con .oauth = estado guardado)
    this.persist = persist;      // () => Promise: guarda las definiciones cifradas
    this.open = open;            // (url) => abre el navegador del sistema
    this._state = null;
  }

  get redirectUrl() { return REDIRECT; }

  get clientMetadata() {
    return { client_name: 'JeanCode', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: this.server.clientSecret ? 'client_secret_post' : 'none' };
  }

  state() { this._state = crypto.randomBytes(16).toString('hex'); return this._state; }

  // cliente preregistrado (Google: ID y secreto de un cliente "app de escritorio" del usuario) o el registrado solo (DCR)
  clientInformation() {
    if (this.server.clientId) return { client_id: this.server.clientId, ...(this.server.clientSecret ? { client_secret: this.server.clientSecret } : {}) };
    return this.server.oauth?.client;
  }

  async saveClientInformation(info) { this.server.oauth = { ...this.server.oauth, client: info }; await this.persist(); }
  tokens() { return this.server.oauth?.tokens; }
  async saveTokens(tokens) { this.server.oauth = { ...this.server.oauth, tokens }; await this.persist(); }
  async redirectToAuthorization(url) { this.pendingUrl = url; }
  async saveCodeVerifier(v) { this.verifier = v; }
  codeVerifier() { if (!this.verifier) throw new Error('falta el verificador PKCE'); return this.verifier; }
  async invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') this.server.oauth = { ...this.server.oauth, tokens: undefined };
    if (scope === 'all' || scope === 'client') this.server.oauth = { ...this.server.oauth, client: undefined };
    await this.persist();
  }
}

/** Espera la redirección OAuth en 127.0.0.1 (solo loopback) y devuelve el código. */
function waitForCode(expectedState, timeoutMs = 300000) {
  let close = () => {};
  const promise = new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== OAUTH_PATH) { res.writeHead(404).end(); return; }
      const code = u.searchParams.get('code');
      const ok = code && u.searchParams.get('state') === expectedState;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>JeanCode</title><body style="background:#000;color:#f2f1ec;font:16px system-ui;padding:40px">${ok ? 'Conexión autorizada. Puedes volver a JeanCode.' : 'La autorización no es válida. Vuelve a JeanCode e inténtalo de nuevo.'}</body>`);
      clearTimeout(timer);
      srv.close();
      if (ok) resolve(code);
      else reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error') || 'respuesta OAuth inválida (state distinto)'));
    });
    const timer = setTimeout(() => { srv.close(); reject(new Error('no se completó la autorización en 5 minutos')); }, timeoutMs);
    srv.on('error', (e) => { clearTimeout(timer); reject(new Error(`el puerto ${OAUTH_PORT} está ocupado (${e.code})`)); });
    srv.listen(OAUTH_PORT, '127.0.0.1');
    close = () => { clearTimeout(timer); srv.close(); reject(new Error('autorización cancelada')); };
  });
  promise.catch(() => {});
  return { promise, close: () => close() };
}

/** Contenido MCP → texto para el modelo (texto, recursos, y un aviso por cada imagen o audio). */
function contentToText(result) {
  const parts = [];
  for (const c of result?.content || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'resource') parts.push(c.resource?.text ?? `[recurso ${c.resource?.uri || ''}]`);
    else if (c.type === 'resource_link') parts.push(`[enlace a recurso: ${c.uri}${c.name ? ` (${c.name})` : ''}]`);
    else parts.push(`[${c.type} omitido]`);
  }
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  let text = parts.join('\n\n') || '(sin contenido)';
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n…(recortado, ${text.length} caracteres en total)`;
  return (result?.isError ? 'ERROR del servidor MCP: ' : '') + text;
}

class McpManager {
  /**
   * store: { load() => Promise<servers[]>, save(servers) => Promise }  (cifrado lo hace main.js)
   * open: (url) => abre el navegador del sistema (shell.openExternal)
   */
  constructor({ store, open }) {
    this.store = store;
    this.open = open;
    this.servers = [];
    this.live = new Map();   // id -> { client, transport, tools, error, status }
    this.loaded = null;
  }

  async load() {
    if (!this.loaded) this.loaded = this.store.load().then((s) => { this.servers = Array.isArray(s) ? s : []; });
    return this.loaded;
  }

  persist() { return this.store.save(this.servers); }

  /** Vista para la interfaz: sin secretos ni tokens. */
  async list() {
    await this.load();
    return this.servers.map((s) => {
      const l = this.live.get(s.id);
      return {
        id: s.id, name: s.name, prefix: slug(s.name), type: s.type, url: s.url, command: s.command, args: s.args || [],
        enabled: s.enabled !== false, preset: s.preset || null, authorized: !!s.oauth?.tokens,
        hasHeaders: !!Object.keys(s.headers || {}).length, hasEnv: !!Object.keys(s.env || {}).length, google: !!s.clientId,
        status: l?.status || 'off', error: l?.error || null, tools: (l?.tools || []).map((t) => ({ name: t.name, description: t.description || '', readOnly: !!t.annotations?.readOnlyHint })),
      };
    });
  }

  async save(def) {
    await this.load();
    const clean = {
      id: def.id || crypto.randomUUID(), name: String(def.name || 'mcp').slice(0, 40), type: def.type === 'stdio' ? 'stdio' : 'http',
      enabled: def.enabled !== false, preset: def.preset || null,
    };
    if (clean.type === 'http') {
      const u = new URL(String(def.url));
      if (u.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) throw new Error('un servidor MCP remoto debe usar https');
      clean.url = u.toString();
      clean.headers = Object.fromEntries(Object.entries(def.headers || {}).filter(([k, v]) => /^[\w-]+$/.test(k) && v));
      if (def.clientId) { clean.clientId = String(def.clientId); clean.clientSecret = def.clientSecret ? String(def.clientSecret) : undefined; }
    } else {
      if (!def.command || /[\r\n]/.test(def.command)) throw new Error('falta el comando');
      clean.command = String(def.command);
      clean.args = (Array.isArray(def.args) ? def.args : []).map(String);
      clean.env = Object.fromEntries(Object.entries(def.env || {}).filter(([k, v]) => /^[A-Z_][A-Z0-9_]*$/i.test(k) && v != null).map(([k, v]) => [k, String(v)]));
    }
    const prev = this.servers.find((s) => s.id === clean.id);
    if (prev) {
      // los secretos que no se reenvían se conservan
      if (clean.type === 'http' && !Object.keys(clean.headers).length) clean.headers = prev.headers || {};
      if (clean.type === 'stdio' && !Object.keys(clean.env).length) clean.env = prev.env || {};
      if (prev.url === clean.url && prev.clientId === clean.clientId) clean.oauth = prev.oauth;
      await this.disconnect(clean.id);
      this.servers = this.servers.map((s) => (s.id === clean.id ? clean : s));
    } else {
      if (this.servers.some((s) => slug(s.name) === slug(clean.name))) throw new Error(`ya hay una conexión llamada «${clean.name}»`);
      this.servers.push(clean);
    }
    await this.persist();
    return clean.id;
  }

  async remove(id) {
    await this.disconnect(id);
    this.servers = this.servers.filter((s) => s.id !== id);
    await this.persist();
  }

  async disconnect(id) {
    const l = this.live.get(id);
    this.live.delete(id);
    if (l?.client) await l.client.close().catch(() => {});
  }

  async closeAll() { await Promise.all([...this.live.keys()].map((id) => this.disconnect(id))); }

  /** Conecta (y autoriza con OAuth si hace falta, abriendo el navegador). Devuelve el estado. */
  async connect(id, { interactive = true } = {}) {
    await this.load();
    const s = this.servers.find((x) => x.id === id);
    if (!s) throw new Error('conexión desconocida');
    await this.disconnect(id);
    const entry = { status: 'connecting', tools: [], error: null };
    this.live.set(id, entry);
    try {
      const { client, transport } = await this.open_(s, interactive);
      entry.client = client;
      entry.transport = transport;
      entry.tools = await this.listAllTools(client);
      entry.status = 'ready';
    } catch (e) {
      entry.status = 'error';
      entry.error = String(e.message || e).slice(0, 300);
    }
    return (await this.list()).find((x) => x.id === id);
  }

  async open_(s, interactive) {
    const { Client, StdioClientTransport, getDefaultEnvironment, StreamableHTTPClientTransport, UnauthorizedError } = sdk();
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    if (s.type === 'stdio') {
      const spec = spawnSpec(s.command, s.args || []);
      const transport = new StdioClientTransport({ ...spec, env: { ...getDefaultEnvironment(), ...(s.env || {}) }, stderr: 'ignore' });
      await client.connect(transport);
      return { client, transport };
    }
    const provider = new OAuthProvider(s, () => this.persist(), this.open);
    const make = () => new StreamableHTTPClientTransport(new URL(s.url), { authProvider: provider, requestInit: { headers: { ...(s.headers || {}) } } });
    let transport = make();
    try {
      await client.connect(transport);
      return { client, transport };
    } catch (e) {
      if (!(e instanceof UnauthorizedError) && !/unauthori[sz]ed|401/i.test(String(e.message))) throw e;
      if (!interactive || !provider.pendingUrl) throw new Error('necesita autorización: pulsa Conectar');
      // OAuth: el navegador del sistema abre la página del servicio; la respuesta llega a 127.0.0.1
      const url = new URL(provider.pendingUrl);
      const wait = waitForCode(url.searchParams.get('state'));
      try { await this.open(url.toString()); } catch (err) { wait.close(); throw err; }
      const code = await wait.promise;
      await transport.finishAuth(code);
      const client2 = new Client(CLIENT_INFO, { capabilities: {} });
      transport = make();
      await client2.connect(transport);
      return { client: client2, transport };
    }
  }

  async listAllTools(client) {
    const out = [];
    let cursor;
    for (let i = 0; i < 20; i++) {
      const r = await client.listTools(cursor ? { cursor } : undefined);
      out.push(...(r.tools || []));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return out;
  }

  /** Conecta en segundo plano las conexiones activas que no necesitan abrir el navegador. */
  async connectAll() {
    await this.load();
    await Promise.all(this.servers.filter((s) => s.enabled !== false && !this.live.has(s.id)).map((s) => this.connect(s.id, { interactive: false }).catch(() => {})));
    return this.list();
  }

  /** Herramientas listas para el agente: nombre con prefijo, descripción, esquema y si solo lee. */
  async tools() {
    await this.load();
    const out = [];
    for (const s of this.servers) {
      const l = this.live.get(s.id);
      if (l?.status !== 'ready') continue;
      for (const t of l.tools) {
        out.push({
          name: `mcp__${slug(s.name)}__${t.name}`.slice(0, 64), server: s.id, serverName: s.name, tool: t.name,
          description: `[${s.name}] ${t.description || t.title || t.name}`.slice(0, 1000),
          schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
          readOnly: !!t.annotations?.readOnlyHint, destructive: t.annotations?.destructiveHint !== false && !t.annotations?.readOnlyHint,
        });
      }
    }
    return out;
  }

  /** Ejecuta una herramienta. Devuelve texto para el modelo. */
  async call(serverId, tool, args = {}) {
    const l = this.live.get(serverId);
    if (l?.status !== 'ready') throw new Error('la conexión no está activa (Ajustes → Apps)');
    const r = await l.client.callTool({ name: tool, arguments: args && typeof args === 'object' ? args : {} }, undefined, { timeout: CALL_TIMEOUT });
    return contentToText(r);
  }
}

module.exports = { McpManager, slug, spawnSpec, contentToText, REDIRECT, OAUTH_PORT };
