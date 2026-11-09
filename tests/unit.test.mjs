// Pruebas unitarias de JeanCode (node --test). Cubren la lógica que no depende del DOM ni de Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VERSION, isNewer } from '../web/js/version.js';
import { parseFiles, safePath, buildPreview } from '../web/js/code.js';
import { parseToolCalls, stripToolBlocks } from '../web/js/agent.js';
import { parseCommand, expandCustom, matchCommands } from '../web/js/commands.js';
import { lineDiff, diffStats } from '../web/js/diff.js';
import { renderMarkdown, esc } from '../web/js/md.js';
import { makeZip } from '../web/js/zip.js';
import { providerById, PROVIDERS } from '../web/js/providers.js';

const require = createRequire(import.meta.url);
const tools = require('../desktop/lib/tools.js');

test('versión: semver y comparación de etiquetas', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(isNewer('v1.0.1', '1.0.0'), true);
  assert.equal(isNewer('v1.0.0', '1.0.0'), false);
  assert.equal(isNewer('v0.4.1', '1.0.0'), false);
  assert.equal(isNewer('v1.10.0', '1.9.9'), true);
});

test('CODE: archivos completos, en curso y borrados', () => {
  const r = parseFiles('Hecho.\n<<<FILE index.html>>>\n<h1>x</h1>\n<<<END>>>\n<<<DELETE viejo.txt>>>\n<<<FILE app.js>>>\nconsole.log(1)');
  assert.deepEqual(Object.keys(r.files).sort(), ['app.js', 'index.html']);
  assert.equal(r.files['index.html'], '<h1>x</h1>');
  assert.equal(r.open, 'app.js');
  assert.deepEqual(r.deletes, ['viejo.txt']);
  assert.match(r.prose, /`index.html` · escrito/);
});

test('CODE: rutas inseguras se rechazan', () => {
  assert.equal(safePath('../etc/passwd'), null);
  assert.equal(safePath('a//b'), null);
  assert.equal(safePath('./src' + String.fromCharCode(92) + 'main.js'), 'src/main.js');
  const r = parseFiles('<<<FILE ../x.js>>>\nmal\n<<<END>>>');
  assert.deepEqual(Object.keys(r.files), []);
});

test('CODE: la vista previa incrusta CSS y JS locales', () => {
  const html = buildPreview({ 'index.html': '<link rel="stylesheet" href="s.css"><script src="a.js"></script>', 's.css': 'b{}', 'a.js': 'x()' }, 'index.html');
  assert.match(html, /<style>b\{\}<\/style>/);
  assert.match(html, /<script>x\(\)<\/script>/);
});

test('agente: llamadas a herramientas en ambos formatos', () => {
  const a = parseToolCalls('voy\n```tool\n{"tool":"read_file","args":{"path":"a.txt"}}\n```');
  assert.deepEqual(a, [{ tool: 'read_file', args: { path: 'a.txt' } }]);
  const b = parseToolCalls('<tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call>');
  assert.deepEqual(b, [{ tool: 'list_dir', args: { path: '.' } }]);
  assert.equal(stripToolBlocks('hola <tool_call>{"name":"x"}</tool_call>'), 'hola');
});

test('comandos: parseo y plantillas', () => {
  assert.deepEqual(parseCommand('/Model jean-grey'), { name: 'model', args: 'jean-grey' });
  assert.equal(parseCommand('hola'), null);
  assert.equal(expandCustom('Revisa $ARGUMENTS', 'app.js'), 'Revisa app.js');
  assert.ok(matchCommands('he', 'chat').some((c) => c.name === 'help'));
});

test('diff: cuenta líneas añadidas y borradas', () => {
  const ops = lineDiff('a\nb\nc', 'a\nB\nc\nd');
  assert.deepEqual(diffStats(ops), { add: 2, del: 1 });
});

test('markdown: escapa HTML del modelo', () => {
  assert.equal(esc('<img onerror=x>'), '&lt;img onerror=x&gt;');
  const html = renderMarkdown('<script>alert(1)</script> **ok**');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<strong>ok<\/strong>/);
});

test('zip: cabeceras válidas', async () => {
  const blob = makeZip({ 'a.txt': 'hola' }, 'proj');
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...buf.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(new TextDecoder().decode(buf).includes('proj/a.txt'));
});

test('proveedores: Jean es el predeterminado', () => {
  assert.equal(providerById('no-existe').id, PROVIDERS[0].id);
  assert.equal(PROVIDERS[0].id, 'jean');
});

test('escritorio: nada fuera del espacio de trabajo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-ws-'));
  const outside = mkdtempSync(join(tmpdir(), 'jc-out-'));
  writeFileSync(join(outside, 'secreto.txt'), 'x');
  mkdirSync(join(root, 'src'));
  await assert.rejects(tools.inside(root, '../secreto.txt'), /fuera del espacio/);
  assert.ok((await tools.inside(root, 'src/nuevo.js')).endsWith('nuevo.js'));
  let linked = true;
  try { symlinkSync(outside, join(root, 'enlace'), 'junction'); } catch { linked = false; }
  if (linked) await assert.rejects(tools.inside(root, 'enlace/secreto.txt'), /fuera del espacio/);
  assert.match(await tools.search(root, 'x'), /sin coincidencias/);
});

/* ------------------------------------------------------------ enrutador */
const R = await import('../web/js/router.js');
const A = await import('../web/js/api.js');
const H = await import('../web/js/hf.js');
const ep = (id, url, provider = 'jean') => ({ id, url, key: 'k', provider });

test('router: validación antes de conectar', () => {
  const ok = R.validateEndpoint({ url: 'https://x-8899.app.github.dev/v1/', key: 'jean_abc', provider: 'jean' }, { pageProtocol: 'https:' });
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://x-8899.app.github.dev/v1');
  const fix = R.validateEndpoint({ url: 'https://api.openai.com/v1', key: 'sk-x', provider: 'jean' });
  assert.equal(fix.provider, 'openai');
  assert.ok(fix.warnings[0].includes('OpenAI'));
  assert.equal(R.validateEndpoint({ url: 'http://1.2.3.4/v1', key: 'k', provider: 'custom' }, { pageProtocol: 'https:' }).ok, false);
  assert.equal(R.validateEndpoint({ url: 'http://1.2.3.4/v1', key: 'k', provider: 'custom' }, { desktop: true }).ok, true);
  assert.equal(R.validateEndpoint({ url: 'https://h/v1?key=abc', key: 'k', provider: 'custom' }).ok, false);
  assert.equal(R.validateEndpoint({ url: 'https://api.groq.com/openai/v1', key: '', provider: 'groq' }).ok, false);
  assert.equal(R.validateEndpoint({ url: 'http://localhost:11434/v1', key: '', provider: 'ollama' }).ok, true);
  assert.equal(R.validateEndpoint({ url: 'https://h/v1', key: 'Bearer abc', provider: 'custom' }).ok, false);
  const dup = R.validateEndpoint({ url: 'https://h/v1', key: 'k', provider: 'custom' }, { existing: [{ url: 'https://h/v1', key: 'k' }] });
  assert.match(dup.errors.join(' '), /ya está agregada/);
});

test('router: el registro nunca guarda claves', () => {
  const s = R.redact('Authorization: Bearer jean_abcdefghijklmnopqrstuvwxyz0123456789 key sk-proj-ABCDEFGHIJ hf_abcdefghijk https://h/v1?api_key=SECRETO');
  assert.doesNotMatch(s, /abcdefghijklmnop|ABCDEFGHIJ|hf_abcdef|SECRETO/);
  assert.match(R.redact('modelo jean-grey en 120 ms'), /jean-grey/);
  R.logRoute({ kind: 'chat-error', msg: 'clave sk-ant-api03-zzzzzzzzzzzz rechazada' });
  assert.doesNotMatch(R.formatLog(), /zzzzzzzz/);
});

test('router: AUTO elige por modo y el respaldo respeta la política', () => {
  const g = ep('a', 'https://c-8899.app.github.dev/v1'), o = ep('b', 'https://api.openai.com/v1', 'openai');
  const models = [{ id: 'jean-grey', ep: g }, { id: 'jean-marvel', ep: g }, { id: 'gpt-4o', ep: o }];
  const eps = [g, o];
  assert.equal(R.pickAuto(models, 'chat', eps).id, 'jean-grey');
  assert.equal(R.pickAuto(models, 'agent', eps).id, 'jean-marvel');
  const port = ep('p', 'https://c-8888.app.github.dev/v1');
  const all = [...models, { id: 'jean-grey', ep: port }];
  assert.deepEqual(R.candidates(all[0], all, 'chat', eps, 'same').map((m) => m.ep.id), ['p']);
  assert.deepEqual(R.candidates(all[0], all, 'chat', eps, 'off'), []);
  assert.equal(R.candidates(all[0], all, 'chat', eps, 'any')[0].ep.id, 'p');
  assert.equal(R.retriable({ status: 503 }), true);
  assert.equal(R.retriable({ status: 401 }), false);
  assert.equal(R.retriable({ status: 400 }), false);
});

test('router: sin duplicados del mismo Codespace y migración del modelo guardado', () => {
  const router = ep('r', 'https://c-8899.app.github.dev/v1'), port = ep('p', 'https://c-8888.app.github.dev/v1'), other = ep('o', 'https://d-8888.app.github.dev/v1');
  const models = [{ id: 'jean-grey', ep: router }, { id: 'jean-grey', ep: port }, { id: 'jean-grey', ep: other }];
  assert.deepEqual(R.visibleModels(models).map((m) => m.ep.id), ['r', 'o']);
  assert.equal(R.resolveSaved('JEAN-GREY', models).ep.id, 'r');
  assert.equal(R.resolveSaved('p|jean-grey', models).ep.id, 'p');
  assert.equal(R.resolveSaved('auto', models), null);
});

test('api: errores por proveedor y router del Codespace', () => {
  assert.match(A.explain(401, '', { provider: 'openai' }), /OpenAI rechazó la clave/);
  assert.match(A.explain(401, '', { provider: 'jean' }), /JEAN_API_KEY/);
  assert.match(A.explain(503, '{"error":{"message":"Fenix no cabe en esta maquina"}}', { provider: 'jean' }), /Fenix no cabe/);
  assert.equal(A.serverMessage('<html>bad gateway</html>'), '');
  assert.equal(A.isRouterUrl('https://c-8899.app.github.dev/v1'), true);
  assert.equal(A.isRouterUrl('http://localhost:8899/v1'), true);
  assert.equal(A.isRouterUrl('https://c-8888.app.github.dev/v1'), false);
  assert.ok(A.siblingUrls('https://c-8888.app.github.dev/v1').includes('https://c-8899.app.github.dev/v1'));
  assert.equal(A.sameServer('https://c-8899.app.github.dev/v1', 'https://c-8890.app.github.dev/v1'), true);
});

test('hf: el panel de Hugging Face encuentra el control también desde el router', () => {
  assert.equal(H.controlUrlFrom('https://c-8899.app.github.dev/v1'), 'https://c-8899.app.github.dev');
  assert.equal(H.controlUrlFrom('https://c-8888.app.github.dev/v1'), 'https://c-8899.app.github.dev');
  assert.equal(H.controlUrlFrom('http://localhost:8899/v1'), 'http://localhost:8899');
});

/* ------------------------------------------------------------ fase 3: capacidades, decisión, coste */
const C = await import('../web/js/capabilities.js');
const P = await import('../web/js/providers.js');

test('capacidades: lo informado por el proveedor manda; lo desconocido queda null', () => {
  const or = ep('or1', 'https://openrouter.ai/api/v1', 'openrouter');
  P.adapterOf(or).models({ data: [
    { id: 'x/vision-model', context_length: 200000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools', 'response_format'], pricing: { prompt: '0.000001', completion: '0.000002' } },
    { id: 'x/free-model:free', context_length: 8192, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['temperature'] },
  ] }, or);
  const v = C.capsOf(or, 'x/vision-model');
  assert.equal(v.vision, true); assert.equal(v.tools, true); assert.equal(v.structured, true); assert.equal(v.context, 200000);
  assert.equal(C.billingOf(or, 'x/vision-model'), 'paid');
  assert.equal(C.billingOf(or, 'x/free-model:free'), 'free');
  assert.equal(C.capsOf(or, 'x/free-model:free').tools, false);
  const custom = ep('c1', 'https://mi-servidor.example/v1', 'custom');
  assert.equal(C.capsOf(custom, 'algo-raro').tools, null);           // no se inventa
  assert.equal(C.capsOf(custom, 'text-embedding-3-small').chat, false); // se oculta del selector
  assert.equal(C.billingOf(ep('l', 'http://localhost:11434/v1', 'ollama')), 'local');
  assert.equal(C.billingOf(ep('j', 'https://c-8899.app.github.dev/v1')), 'own');
});

test('capacidades: el contexto real del router de Jean y lo aprendido en uso', () => {
  const j = ep('jr', 'https://c-8899.app.github.dev/v1');
  P.adapterOf(j).models({ data: [{ id: 'jean-fenix', jean: { port: 8890, context_length: 8192 } }] }, j);
  assert.equal(C.capsOf(j, 'jean-fenix').context, 8192);
  const port = ep('jp', 'https://c-8888.app.github.dev/v1');
  P.adapterOf(port).models({ data: [{ id: 'jean-marvel' }] }, port);     // puerto suelto sin /props: no se supone
  assert.equal(C.capsOf(port, 'jean-marvel').context, null);              // (en vivo Marvel tiene 32768, no 131072)
  const oll = ep('ol', 'http://localhost:11434/v1', 'ollama');
  P.adapterOf(oll).models({ data: [{ id: 'jean-grey:v0.7-basic' }] }, oll);
  assert.equal(C.capsOf(oll, 'jean-grey:v0.7-basic').context, null);     // Ollama usa su propio num_ctx: desconocido
  assert.equal(C.capsOf(oll, 'jean-grey:v0.7-basic').tools, true);
  C.learnCap(j, 'jean-fenix', { tools: false });
  assert.match(C.unfitReason(C.capsOf(j, 'jean-fenix'), { tools: true }), /herramientas/);
  assert.match(C.unfitReason(C.capsOf(j, 'jean-fenix'), { tokens: 50000 }), /contexto/);
});

test('router: decisión explicable, conexión fija y descartes', () => {
  const j = ep('jd', 'https://d-8899.app.github.dev/v1'), l = ep('ld', 'http://localhost:11434/v1', 'ollama'), o = ep('od', 'https://api.openai.com/v1', 'openai');
  P.adapterOf(j).models({ data: [{ id: 'jean-grey' }, { id: 'jean-marvel' }, { id: 'jean-fenix', jean: { context_length: 4096 } }] }, j);
  const models = [{ id: 'jean-grey', ep: j }, { id: 'jean-marvel', ep: j }, { id: 'jean-fenix', ep: j }, { id: 'qwen2.5-coder:7b', ep: l }, { id: 'gpt-4o', ep: o }];
  const eps = [j, l, o];
  const auto = R.decide({ routing: 'auto' }, { models, mode: 'chat', endpoints: eps, need: { tokens: 20000 } });
  assert.equal(auto.model.id, 'jean-grey');
  assert.ok(auto.skipped.some((s) => s.model === 'jean-fenix' && /contexto/.test(s.why)));
  assert.ok(auto.skipped.some((s) => s.model === 'gpt-4o' && /pago/.test(s.why)));   // sin permiso, AUTO no usa pago
  const pinned = R.decide({ routing: 'endpoint', target: 'ld' }, { models, mode: 'chat', endpoints: eps });
  assert.equal(pinned.model.id, 'qwen2.5-coder:7b');
  assert.equal(pinned.routing, 'conexión fija');
  const fixed = R.decide({ routing: 'model', target: 'od|gpt-4o' }, { models, mode: 'chat', endpoints: eps });
  assert.equal(fixed.model.id, 'gpt-4o');                                               // elegido por el usuario: se respeta
});

test('router: el respaldo nunca pasa solo a un modelo de pago', () => {
  const j = ep('jf', 'https://f-8899.app.github.dev/v1'), l = ep('lf', 'http://localhost:1234/v1', 'lmstudio'), o = ep('of', 'https://api.groq.com/openai/v1', 'groq');
  const models = [{ id: 'jean-grey', ep: j }, { id: 'llama-3-local', ep: l }, { id: 'llama-3.3-70b', ep: o }];
  const free = R.candidates(models[0], models, 'chat', [j, l, o], 'free');
  assert.deepEqual(free.map((m) => m.ep.id), ['lf']);
  globalThis.localStorage?.setItem?.('jeancode.fallbackChain', JSON.stringify(['of|llama-3.3-70b', 'lf|llama-3-local']));
});

test('api: tipos de error y formatos incompatibles', () => {
  assert.equal(A.kindOf(401), 'auth');
  assert.equal(A.kindOf(429), 'rate');
  assert.equal(A.kindOf(503), 'down');
  assert.equal(A.kindOf(0), 'network');
  assert.equal(A.kindOf(404, 'The model `gpt-9` does not exist'), 'model');
  assert.equal(A.kindOf(400, 'model "x" not found'), 'model');
  assert.equal(A.kindOf(400, 'invalid temperature'), 'request');
  assert.equal(R.validateEndpoint({ url: 'https://x.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=1', key: 'k', provider: 'custom' }).ok, false);
  const g = R.validateEndpoint({ url: 'https://generativelanguage.googleapis.com/v1beta', key: 'AIzaX', provider: 'gemini' });
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(R.validateEndpoint({ url: 'http://localhost:11434', key: '', provider: 'ollama' }).url, 'http://localhost:11434/v1');
  assert.equal(R.validateEndpoint({ url: 'https://api.anthropic.com', key: 'sk-ant-x', provider: 'anthropic' }).url, 'https://api.anthropic.com/v1');
});

test('seguridad: exportar configuración y trazas sin claves ni nombre de Codespace', () => {
  const e = { id: 'x', url: 'https://mi-codespace-8899.app.github.dev/v1', key: 'jean_SECRETO123456789', provider: 'jean' };
  const c = R.exportConfig(e, 'jean-grey');
  assert.doesNotMatch(c.curl + c.opencode, /SECRETO/);
  assert.match(c.curl, /\$JEAN_API_KEY/);
  assert.match(c.opencode, /\{env:JEAN_API_KEY\}/);
  assert.equal(R.where(e), '…-8899.app.github.dev/v1');
});
