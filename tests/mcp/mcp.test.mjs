// Pruebas reales del cliente MCP del escritorio contra servidores MCP hechos con el SDK oficial.
//   node --test tests/mcp/mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const require = createRequire(import.meta.url);
const { McpManager, slug, spawnSpec, contentToText } = require('../../desktop/lib/mcp.js');
const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, 'echo-server.cjs');

const memStore = () => { let data = []; return { load: async () => data, save: async (s) => { data = JSON.parse(JSON.stringify(s)); }, peek: () => data }; };
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('MCP stdio: conecta, lista herramientas con prefijo y las ejecuta', async () => {
  const m = new McpManager({ store: memStore(), open: async () => {} });
  const id = await m.save({ name: 'Eco Local', type: 'stdio', command: process.execPath, args: [SERVER] });
  const st = await m.connect(id);
  assert.equal(st.status, 'ready', st.error);
  assert.deepEqual(st.tools.map((t) => t.name).sort(), ['add_issue', 'boom', 'echo']);
  const tools = await m.tools();
  const echo = tools.find((t) => t.tool === 'echo');
  assert.equal(echo.name, 'mcp__eco_local__echo');
  assert.equal(echo.readOnly, true);
  assert.equal(tools.find((t) => t.tool === 'add_issue').readOnly, false);
  assert.equal(echo.schema.type, 'object');
  assert.equal(await m.call(id, 'echo', { text: 'hola' }), 'eco: hola');
  assert.match(await m.call(id, 'boom', {}), /^ERROR del servidor MCP: algo salió mal/);
  await m.closeAll();
});

test('MCP http: con cabecera de autorización (estilo GitHub con token) y sin ella', async () => {
  const port = await freePort();
  const srv = spawn(process.execPath, [SERVER, 'http', String(port)], { env: { ...process.env, ECO_TOKEN: 'tok-123' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    const store = memStore();
    const m = new McpManager({ store, open: async () => {} });
    const bad = await m.save({ name: 'sin token', type: 'http', url: `http://127.0.0.1:${port}/mcp` });
    const st1 = await m.connect(bad, { interactive: false });
    assert.equal(st1.status, 'error');
    const good = await m.save({ name: 'GitHub de prueba', type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer tok-123' } });
    const st2 = await m.connect(good);
    assert.equal(st2.status, 'ready', st2.error);
    assert.equal(await m.call(good, 'add_issue', { title: 'x' }), 'creada: x');
    const listed = await m.list();
    assert.ok(listed.every((s) => !('headers' in s) && !('oauth' in s)), 'la interfaz nunca recibe secretos');
    assert.equal(store.peek().find((s) => s.id === good).headers.Authorization, 'Bearer tok-123', 'el secreto se guarda (cifrado por main.js)');
    await m.closeAll();
  } finally { srv.kill(); }
});

test('MCP: validaciones (https remoto, nombres únicos, cmd en Windows, contenido)', async () => {
  const m = new McpManager({ store: memStore(), open: async () => {} });
  await assert.rejects(m.save({ name: 'x', type: 'http', url: 'http://ejemplo.com/mcp' }), /https/);
  await m.save({ name: 'GitHub', type: 'http', url: 'https://api.githubcopilot.com/mcp/' });
  await assert.rejects(m.save({ name: 'github', type: 'http', url: 'https://otra.com/mcp' }), /ya hay/);
  assert.equal(slug('Google Drive!'), 'google_drive');
  if (process.platform === 'win32') assert.deepEqual(spawnSpec('npx', ['-y', 'pkg']).args.slice(-3), ['npx', '-y', 'pkg']);
  assert.equal(spawnSpec('node', ['a']).command, 'node');
  assert.match(contentToText({ content: [{ type: 'image', data: '..' }, { type: 'text', text: 'hola' }] }), /\[image omitido\][\s\S]*hola/);
});
