// Pruebas unitarias de JeanCode (node --test). Cubren la lógica que no depende del DOM ni de Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ME from '../web/js/media/engine.js';
import * as MX from '../web/js/media/edit.js';
import * as CAP from '../web/js/capabilities.js';
import * as API from '../web/js/api.js';
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
  assert.equal(A.isRouterUrl('http://127.0.0.1:9899/v1'), true, 'puerto de respaldo de launch.py');
  assert.equal(A.isRouterUrl('http://127.0.0.1:9900/v1'), true);
  assert.equal(A.isRouterUrl('http://127.0.0.1:9898/v1'), false);
  assert.equal(A.isRouterUrl('https://c-8888.app.github.dev/v1'), false);
  assert.ok(A.siblingUrls('https://c-8888.app.github.dev/v1').includes('https://c-8899.app.github.dev/v1'));
  assert.equal(A.sameServer('https://c-8899.app.github.dev/v1', 'https://c-8890.app.github.dev/v1'), true);
});

test('hf: el panel de Hugging Face encuentra el control también desde el router', () => {
  assert.equal(H.controlUrlFrom('https://c-8899.app.github.dev/v1'), 'https://c-8899.app.github.dev');
  assert.equal(H.controlUrlFrom('https://c-8888.app.github.dev/v1'), 'https://c-8899.app.github.dev');
  assert.equal(H.controlUrlFrom('http://localhost:8899/v1'), 'http://localhost:8899');
  assert.equal(H.controlUrlFrom('http://127.0.0.1:9899/v1'), 'http://127.0.0.1:9899');
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

/* ------------------------------------------------------------ control del equipo: riesgos y permisos */
const PC = await import('../web/js/computer.js');
const AG = await import('../web/js/agent.js');

test('control: niveles de riesgo y política', () => {
  assert.equal(PC.riskOf('mouse_click', { x: 1, y: 2 }), 'low');
  assert.equal(PC.riskOf('open_application', { target: 'notepad.exe' }), 'medium');
  assert.equal(PC.riskOf('key_press', { keys: ['ctrl', 's'] }), 'medium');
  assert.equal(PC.riskOf('key_press', { keys: ['win', 'r'] }), 'high');     // puede lanzar programas
  assert.equal(PC.riskOf('key_press', { keys: ['alt', 'f4'] }), 'high');    // cierra ventanas
  // teclear en una terminal = ejecutar comandos (la decisión de "terminal" la da el escritorio)
  assert.equal(PC.riskOf('type_text', { text: 'dir' }, { terminal: true }), 'high');
  assert.equal(PC.riskOf('key_press', { keys: ['enter'] }, { terminal: true }), 'high');
  assert.equal(PC.riskOf('type_text', { text: 'hola' }, { terminal: false }), 'low');
  assert.equal(PC.riskOf('type_text', { text: 'a\nb' }), 'medium');                 // salto de línea = Enter
  assert.equal(PC.needsTerminalApproval('type_text', { terminal: true }), true);
  // abrir shells, intérpretes o con argumentos: riesgo alto
  for (const target of ['powershell', 'cmd.exe', String.raw`C:\Windows\System32\cmd.exe`, 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'mshta.exe', 'python', 'rundll32.exe'])
    assert.equal(PC.riskOf('open_application', { target }), 'high', target);
  assert.equal(PC.riskOf('open_application', { target: 'notepad.exe', args: ['x.txt'] }), 'high');
  assert.equal(PC.riskOf('open_application', { target: 'notepad.exe' }), 'medium');
  // la aprobación "en esta tarea" es por acción exacta, no por herramienta
  assert.notEqual(PC.actionKey('open_application', { target: 'notepad.exe' }), PC.actionKey('open_application', { target: 'calc.exe' }));
  assert.equal(PC.actionKey('key_press', { keys: ['ctrl', 's'], repeat: 1 }), PC.actionKey('key_press', { repeat: 1, keys: ['ctrl', 's'] }));
  assert.equal(PC.riskOf('herramienta-inventada', {}), 'high');
  assert.deepEqual(PC.normalizePolicy({ low: 'ask', medium: 'task', high: 'allow' }), { low: 'ask', medium: 'task', high: 'ask' }); // alto nunca se relaja
  assert.equal(PC.normalizePolicy({ low: 'hack' }).low, 'allow');
  for (const cmd of ['rm -rf /', 'del /s /q tmp', 'Remove-Item tmp -Recurse -Force', 'git reset --hard', 'shutdown /s', 'reg delete HKLM/Software/x', 'format C:', 'git push origin main --force'])
    assert.ok(PC.DESTRUCTIVE_COMMAND.test(cmd), cmd);
  for (const cmd of ['npm test', 'git status', 'node build.js', 'ls -la', 'git push origin main'])
    assert.ok(!PC.DESTRUCTIVE_COMMAND.test(cmd), cmd);
  assert.match(PC.describeAction('type_text', { text: 'hola' }), /escribir 4 caracteres/);
});

/** Agente con un modelo guionizado (solo para probar la lógica de permisos; no es una integración). */
async function runScripted(calls, ctxExtra = {}) {
  const steps = [...calls.map((c) => [c]), []];
  const log = { permits: [], acts: [], confirms: [], ran: [] };
  const ctx = {
    ep: { id: 'x', url: 'http://x/v1', key: 'k', provider: 'custom' }, model: 'm', workspace: 'W', mode: 'ask', agent: 'build',
    sys: {}, native: true, onEvent: () => {},
    chat: async (o) => { const c = steps.shift() || []; if (c.length) o.onToolCalls(c.map((x, i) => ({ id: `c${i}`, name: x.tool, arguments: JSON.stringify(x.args) }))); return ''; },
    confirm: async (o) => { log.confirms.push(o.title); return ctxExtra.answer ?? true; },
    isAllowed: (cmd) => ctxExtra.allowed?.includes(cmd) || false,
    desktop: { shell: { run: async (_w, cmd) => { log.ran.push(cmd); return 'ok'; } }, fs: { peek: async () => null, write: async () => 'escrito', trash: async (_w, p) => `${p} a la papelera`, read: async () => { throw new Error('ENOENT: no existe'); } }, proc: { start: async () => 'p1 iniciado' } },
    computer: ctxExtra.noComputer ? null : {
      vision: false, screen: { modelWidth: 1366, modelHeight: 768 },
      permit: async (tool, args, risk, label) => { log.permits.push(`${tool}:${risk}`); return ctxExtra.permit ?? true; },
      act: async (tool) => { log.acts.push(tool); return 'ok'; },
    },
    ...ctxExtra.ctx,
  };
  const msgs = [{ role: 'system', content: '' }, { role: 'user', content: 'tarea' }];
  await AG.runAgent(ctx, msgs);
  return { log, msgs };
}

test('agente: cada acción de pantalla pasa por el permiso de su nivel', async () => {
  const { log } = await runScripted([{ tool: 'inspect_screen', args: {} }, { tool: 'key_press', args: { keys: ['win', 'r'] } }, { tool: 'mouse_click', args: { x: 1, y: 1 } }]);
  assert.deepEqual(log.permits, ['inspect_screen:low', 'key_press:high', 'mouse_click:low']);
  assert.deepEqual(log.acts, ['inspect_screen', 'key_press', 'mouse_click']);
});

test('agente: si el usuario rechaza, la acción NO se ejecuta', async () => {
  const { log, msgs } = await runScripted([{ tool: 'open_application', args: { target: 'cmd.exe' } }], { permit: false });
  assert.deepEqual(log.acts, []);
  assert.ok(msgs.some((m) => m.role === 'tool' && /RECHAZADO/.test(m.content)));
});

test('agente: sin activar el control, ninguna acción de pantalla llega al equipo', async () => {
  const { msgs } = await runScripted([{ tool: 'mouse_click', args: { x: 1, y: 1 } }], { noComputer: true });
  assert.ok(msgs.some((m) => m.role === 'tool' && /no está activado/.test(m.content)));
});

test('agente: en modo PLAN solo se observa la pantalla', async () => {
  const { log, msgs } = await runScripted([{ tool: 'inspect_screen', args: {} }, { tool: 'type_text', args: { text: 'x' } }], { ctx: { agent: 'plan' } });
  assert.deepEqual(log.acts, ['inspect_screen']);
  assert.ok(msgs.some((m) => m.role === 'tool' && /solo puedes observar/.test(m.content)));
});

test('agente: comando destructivo pide confirmación aunque esté en la lista de permitidos', async () => {
  const { log } = await runScripted([{ tool: 'run_command', args: { command: 'git reset --hard' } }, { tool: 'run_command', args: { command: 'npm test' } }],
    { allowed: ['git reset --hard', 'npm test'] });
  assert.deepEqual(log.confirms, ['COMANDO DESTRUCTIVO']);       // npm test permitido: no pregunta
  assert.deepEqual(log.ran, ['git reset --hard', 'npm test']);
});

test('agente: borrar archivos pide confirmación siempre y va a la papelera', async () => {
  const { log, msgs } = await runScripted([{ tool: 'delete_file', args: { path: 'tmp.log' } }]);
  assert.deepEqual(log.confirms, ['MOVER A LA PAPELERA']);
  assert.ok(msgs.some((m) => m.role === 'tool' && /papelera/.test(m.content)));
});

test('agente: detener (AbortSignal) corta el bucle antes del siguiente paso', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(runScripted([{ tool: 'inspect_screen', args: {} }], { ctx: { signal: ac.signal } }), (e) => e.name === 'AbortError');
});

test('agente: un error repetido es un bucle: avisa y, si insiste, se detiene', async () => {
  const same = { tool: 'read_file', args: { path: 'src/main.ts' } };
  const ac = new AbortController();
  const steps = Array.from({ length: 20 }, () => same);
  const r = await runScripted(steps, { ctx: { signal: ac.signal } }).catch((e) => e);
  const msgs = r.msgs || [];
  const warnings = msgs.filter((m) => m.role === 'user' && /AVISO: estás repitiendo/.test(m.content));
  assert.equal(warnings.length, 2, 'dos avisos antes de detenerse');
  assert.ok(warnings[0].content.includes('tarea'), 'el aviso recuerda la tarea original');
  const toolCalls = msgs.filter((m) => m.role === 'tool').length;
  assert.ok(toolCalls < 12, `se detuvo pronto (${toolCalls} llamadas, no 20)`);
});

test('agente: repetir un clic con éxito NO es un bucle (pulsar 3 veces puede ser la tarea)', async () => {
  const click = { tool: 'click_element', args: { id: 3 } };
  const { log, msgs } = await runScripted([click, click, click, click]);
  assert.equal(log.acts.length, 4);
  assert.ok(!msgs.some((m) => m.role === 'user' && /AVISO/.test(m.content)));
});

/* --------------------------------------- diagnósticos, contexto por modelo, /context, /doctor, subagentes */
const diag = require('../desktop/lib/diagnostics.js');

test('diagnósticos: errores reales de sintaxis con línea, archivos sanos limpios, nada fuera del espacio', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-diag-'));
  writeFileSync(join(root, 'mal.js'), 'const a = 1;\nfunction f( {\n');
  writeFileSync(join(root, 'bien.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'mal.json'), '{\n  "a": 1,\n}\n');
  writeFileSync(join(root, 'mal.py'), 'def f(:\n  pass\n');
  writeFileSync(join(root, 'nota.txt'), 'x');
  const bad = await diag.diagnose(root, 'mal.js');
  assert.match(bad, /node --check.*HAY ERRORES/s);
  assert.match(bad, /SyntaxError/);
  assert.ok(!bad.includes(root), 'el informe usa la ruta relativa');
  assert.match(await diag.diagnose(root, 'bien.js'), /sin errores/, 'un módulo ES correcto no es un error');
  writeFileSync(join(root, 'esm-mal.js'), 'export function suma(a, b {\n  return a + b;\n}\n');
  writeFileSync(join(root, 'cjs-mal.js'), 'const x = require("fs");\nmodule.exports = (x;\n');
  writeFileSync(join(root, 'cjs-bien.cjs'), 'module.exports = 1;\n');
  const esm = await diag.diagnose(root, 'esm-mal.js');
  assert.match(esm, /HAY ERRORES[\s\S]*esm-mal\.js:1/);
  assert.ok(!/\(node:\d+\)/.test(esm), 'sin avisos internos de Node');
  assert.match(await diag.diagnose(root, 'cjs-mal.js'), /HAY ERRORES/);
  assert.match(await diag.diagnose(root, 'cjs-bien.cjs'), /sin errores/);
  assert.match(await diag.diagnose(root, 'mal.json'), /JSON\.parse.*HAY ERRORES[\s\S]*3: /);
  const py = await diag.diagnose(root, 'mal.py');
  assert.match(py, /HAY ERRORES[\s\S]*1:\d+: |no está instalada/);
  assert.match(await diag.diagnose(root, 'nota.txt'), /no hay verificador/);
  assert.equal(await diag.diagnose(root, 'nota.txt', { auto: true }), '', 'tras editar, sin verificador no se añade nada');
  await assert.rejects(diag.diagnose(root, '../fuera.js'), /fuera del espacio/);
  // Python se valida sin escribir __pycache__ en la carpeta del usuario
  assert.ok(!require('node:fs').existsSync(join(root, '__pycache__')));
});

test('agente: tras escribir recibe los diagnósticos; se pueden desactivar; la herramienta es de solo lectura', async () => {
  const seen = [];
  const fsx = { diagnose: async (_w, p, o) => { seen.push([p, o]); return `DIAGNÓSTICOS ${p} (node --check): HAY ERRORES`; } };
  const run = async (calls, ctx) => runScripted(calls, { ctx: { ...ctx, desktop: { fs: { peek: async () => null, write: async () => 'escrito', ...fsx } } } });
  let { msgs } = await run([{ tool: 'write_file', args: { path: 'a.js', content: 'x(' } }], { mode: 'auto-edit' });
  assert.ok(msgs.some((m) => m.role === 'tool' && /escrito\nDIAGNÓSTICOS a\.js.*HAY ERRORES/.test(m.content)));
  assert.deepEqual(seen[0], ['a.js', { auto: true }]);
  ({ msgs } = await run([{ tool: 'write_file', args: { path: 'b.js', content: '' } }], { mode: 'auto-edit', autoDiagnostics: false }));
  assert.ok(msgs.some((m) => m.role === 'tool' && m.content === 'escrito'));
  ({ msgs } = await run([{ tool: 'diagnostics', args: { path: 'c.js' } }], { agent: 'plan' }));
  assert.ok(msgs.some((m) => m.role === 'tool' && /DIAGNÓSTICOS c\.js/.test(m.content)), 'PLAN puede diagnosticar (sin deep)');
  assert.deepEqual(seen.at(-1), ['c.js', { deep: false }]);
  // deep ejecuta código del proyecto: en PLAN se deniega y en BUILD pide permiso como un comando
  const before = seen.length;
  ({ msgs } = await run([{ tool: 'diagnostics', args: { path: 'c.ts', deep: true } }], { agent: 'plan' }));
  assert.ok(msgs.some((m) => m.role === 'tool' && /DENEGADO/.test(m.content)));
  assert.equal(seen.length, before, 'no llegó a ejecutarse');
  const r = await runScripted([{ tool: 'diagnostics', args: { path: 'c.ts', deep: true } }], { answer: false, ctx: { desktop: { fs: fsx } } });
  assert.deepEqual(r.log.confirms, ['EJECUTAR HERRAMIENTAS DEL PROYECTO']);
  assert.equal(seen.length, before, 'rechazado: no se ejecuta');
});

test('diagnósticos: un node_modules malicioso del proyecto NO se ejecuta sin deep', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-evil-'));
  const marker = join(root, 'PWNED');
  mkdirSync(join(root, 'node_modules', 'typescript', 'bin'), { recursive: true });
  const evil = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`;
  writeFileSync(join(root, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript","main":"index.js"}');
  writeFileSync(join(root, 'node_modules', 'typescript', 'index.js'), evil);
  mkdirSync(join(root, 'node_modules', 'eslint', 'bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), evil);
  writeFileSync(join(root, 'a.ts'), 'const x: number = 1;\n');
  writeFileSync(join(root, 'b.js'), 'const y = 1;\n');
  for (const f of ['a.ts', 'b.js']) {
    await diag.diagnose(root, f);
    await diag.diagnose(root, f, { auto: true });
  }
  assert.ok(!require('node:fs').existsSync(marker), 'ni la revisión automática ni la de solo lectura cargan código del proyecto');
  await diag.diagnose(root, 'a.ts', { deep: true });
  assert.ok(require('node:fs').existsSync(marker), 'deep sí usa las herramientas del proyecto (por eso pide permiso)');
});

test('agente: el subagente devuelve su traza (pasos, herramientas, errores y tokens)', async () => {
  const script = [
    [{ tool: 'spawn_subagent', args: { task: 'investiga' } }],
    [{ tool: 'read_file', args: { path: 'no.js' } }, { tool: 'glob', args: { pattern: '*' } }],
    [], [],
  ];
  const events = [];
  const ctx = {
    ep: { id: 'x', url: 'http://x/v1', key: 'k', provider: 'custom' }, model: 'm', workspace: 'W', mode: 'ask', agent: 'build', sys: { skills: [] }, native: true,
    onEvent: (e) => events.push(e),
    chat: async (o) => { const c = script.shift() || []; o.onUsage?.({ prompt: 100, completion: 10 }); if (c.length) o.onToolCalls(c.map((x, i) => ({ id: `c${i}`, name: x.tool, arguments: JSON.stringify(x.args) }))); return ''; },
    confirm: async () => true,
    desktop: { fs: { read: async () => { throw new Error('ENOENT: no existe'); }, glob: async () => ['a.js'] } },
  };
  await AG.runAgent(ctx, [{ role: 'system', content: '' }, { role: 'user', content: 't' }]);
  const end = events.find((e) => e.type === 'subagent-end');
  assert.ok(end?.stats, 'hay traza');
  assert.deepEqual(end.stats.tools, { read_file: 1, glob: 1 });
  assert.equal(end.stats.errors, 1);
  assert.equal(end.stats.steps, 2);
  assert.equal(end.stats.prompt, 200);
});

test('proveedores: los añadidos tienen URL https y el contexto informado por /models se registra', () => {
  for (const id of ['nvidia', 'sambanova', 'deepinfra', 'hyperbolic', 'novita', 'nebius', 'chutes', 'siliconflow', 'inference', 'moonshot', 'zai', 'dashscope', 'minimax', 'cohere', 'scaleway', 'ionos']) {
    const p = providerById(id);
    assert.equal(p.id, id, `${id} existe`);
    assert.match(p.url, /^https:\/\/[^/]+\/.+/);
  }
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length, 'ids únicos');
  const e = { id: 'sn', url: 'https://api.sambanova.ai/v1', key: 'k', provider: 'sambanova' };
  const P = { adapterOf: null };
  return import('../web/js/providers.js').then(({ adapterOf }) => {
    P.adapterOf = adapterOf;
    const ids = adapterOf(e).models({ data: [{ id: 'GLM-5.3', context_length: 1048576 }, { id: 'vllm-x', max_model_len: 32768 }, { id: 'sin-dato' }] }, e);
    assert.deepEqual(ids, ['GLM-5.3', 'vllm-x', 'sin-dato']);
    assert.equal(C.capsOf(e, 'GLM-5.3').context, 1048576);
    assert.equal(C.capsOf(e, 'vllm-x').context, 32768);
    assert.equal(C.capsOf(e, 'sin-dato').context, null, 'lo desconocido queda desconocido');
  });
});

test('comandos: /context y /doctor existen en todos los modos', () => {
  for (const mode of ['chat', 'code', 'agent']) {
    assert.ok(matchCommands('cont', mode).some((c) => c.name === 'context'));
    assert.ok(matchCommands('doc', mode).some((c) => c.name === 'doctor'));
  }
});

test('CORS: proveedores que bloquean la web van por el relay del Generator; el resto, directo', () => {
  const nv = { id: 'nv', url: 'https://integrate.api.nvidia.com/v1', key: 'nvapi-x', provider: 'nvidia' };
  const gq = { id: 'gq', url: 'https://api.groq.com/openai/v1', key: 'gsk_x', provider: 'groq' };
  const ol = { id: 'ol', url: 'http://localhost:11434/v1', key: 'x', provider: 'ollama' };
  A.saveEndpoints([nv, gq, ol]);
  assert.equal(A.routeOf(nv, '/models').via, 'direct', 'sin Generator no hay relay (y se explica el CORS al fallar)');
  const jean = { id: 'j', url: 'https://abc-8899.app.github.dev/v1', key: 'jean_k', provider: 'jean' };
  A.saveEndpoints([nv, gq, ol, jean]);
  const r = A.routeOf(nv, '/chat/completions');
  assert.equal(r.via, 'relay');
  assert.equal(r.url, 'https://abc-8899.app.github.dev/relay/integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(r.headers['X-Jean-Key'], 'jean_k');
  assert.equal(r.headers.Authorization, 'Bearer nvapi-x', 'la clave del proveedor viaja intacta');
  assert.equal(A.routeOf(gq, '/models').via, 'direct', 'Groq acepta la web');
  assert.equal(A.routeOf({ ...gq, corsBlocked: true }, '/models').via, 'relay', 'si se vio bloqueado, relay');
  assert.equal(A.routeOf(ol, '/models').via, 'direct', 'lo local nunca va por el relay');
  assert.equal(A.routeOf(jean, '/models').via, 'direct');
  A.saveEndpoints([]);
});

test('relay Cloudflare: clave obligatoria, solo hosts conocidos, preflight', async () => {
  const W = (await import('../relay/worker.js')).default;
  const env = { RELAY_KEY: 'clave-larga-123' };
  const call = (path, init = {}) => W.fetch(new Request(`https://r.example${path}`, init), env);
  assert.equal((await call('/relay/integrate.api.nvidia.com/v1/models')).status, 401);
  assert.equal((await call('/relay/integrate.api.nvidia.com/v1/models', { headers: { 'X-Jean-Key': 'mala' } })).status, 401);
  assert.equal((await call('/relay/evil.com/v1/models', { headers: { 'X-Jean-Key': 'clave-larga-123' } })).status, 403);
  assert.equal((await call('/relay/169.254.169.254/latest', { headers: { 'X-Jean-Key': 'clave-larga-123' } })).status, 403);
  assert.equal((await call('/otra', { headers: { 'X-Jean-Key': 'clave-larga-123' } })).status, 404);
  const pre = await call('/relay/api.deepseek.com/v1/models', { method: 'OPTIONS', headers: { Origin: 'https://jeancodeeer.github.io' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /x-jean-key/);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://jeancodeeer.github.io');
  assert.equal((await W.fetch(new Request('https://r.example/relay/evil.com/x', { headers: { 'X-Jean-Key': 'k' } }), {})).status, 401, 'sin RELAY_KEY configurada no abre nada');
});

test('agente + apps (MCP): permiso por uso, solo lectura en PLAN, permitir siempre', async () => {
  const calls = [];
  const mcp = [
    { name: 'mcp__github__get_issue', server: 's1', serverName: 'GitHub', tool: 'get_issue', description: 'lee', schema: { type: 'object' }, readOnly: true },
    { name: 'mcp__github__create_issue', server: 's1', serverName: 'GitHub', tool: 'create_issue', description: 'crea', schema: { type: 'object' }, readOnly: false },
  ];
  const desktop = { mcp: { call: async (s, t, a) => { calls.push(t); return `ok ${t}`; } }, fs: {} };
  let r = await runScripted([{ tool: 'mcp__github__create_issue', args: { title: 'x' } }], { ctx: { mcp, desktop } });
  assert.deepEqual(r.log.confirms, ['ACTUAR EN GITHUB']);
  assert.deepEqual(calls, ['create_issue']);
  r = await runScripted([{ tool: 'mcp__github__create_issue', args: {} }], { answer: false, ctx: { mcp, desktop } });
  assert.ok(r.msgs.some((m) => m.role === 'tool' && /RECHAZADO/.test(m.content)));
  assert.equal(calls.length, 1, 'rechazada: no se ejecuta');
  r = await runScripted([{ tool: 'mcp__github__create_issue', args: {} }, { tool: 'mcp__github__get_issue', args: {} }], { ctx: { mcp, desktop, agent: 'plan' } });
  assert.ok(r.msgs.some((m) => m.role === 'tool' && /DENEGADO/.test(m.content)), 'PLAN no escribe en apps');
  assert.deepEqual(calls, ['create_issue', 'get_issue'], 'PLAN sí puede leer');
  r = await runScripted([{ tool: 'mcp__github__get_issue', args: {} }], { allowed: ['mcp:mcp__github__get_issue'], ctx: { mcp, desktop } });
  assert.deepEqual(r.log.confirms, [], 'permitida siempre: no vuelve a preguntar');
  r = await runScripted([{ tool: 'mcp__nada__x', args: {} }], { ctx: { mcp, desktop } });
  assert.ok(r.msgs.some((m) => m.role === 'tool' && /no está disponible/.test(m.content)));
  const names = AG.toolSchemasFor({ mcp }).map((t) => t.function.name);
  assert.ok(names.includes('mcp__github__create_issue'));
});

test('cron: campos, nombres, pasos, @macros, zonas horarias, día del mes O de la semana y cambio de hora', async () => {
  const C = await import('../web/js/cron.js');
  const iso = (ms) => new Date(ms).toISOString();
  const base = Date.UTC(2026, 10, 16, 21, 7); // lunes 16-nov-2026 21:07Z
  assert.equal(iso(C.nextCron('CRON_TZ=UTC */15 * * * *', base)), '2026-11-16T21:15:00.000Z');
  assert.equal(iso(C.nextCron('CRON_TZ=UTC 30 8 * * MON-FRI', base)), '2026-11-17T08:30:00.000Z');
  assert.equal(iso(C.nextCron('CRON_TZ=UTC @daily', base)), '2026-11-17T00:00:00.000Z');
  assert.equal(iso(C.nextCron('CRON_TZ=UTC 0 0 29 2 *', base)), '2028-02-29T00:00:00.000Z', 'el próximo 29 de febrero');
  assert.equal(iso(C.nextCron('CRON_TZ=UTC 0 12 13 * 5', base)), '2026-11-20T12:00:00.000Z', 'día 13 O viernes (Vixie)');
  assert.equal(iso(C.nextCron('CRON_TZ=UTC 0 9 * * 7', base)), '2026-11-22T09:00:00.000Z', '7 = domingo');
  assert.equal(iso(C.nextCron('CRON_TZ=Europe/Madrid 30 3 * * *', Date.UTC(2026, 2, 28, 12))), '2026-03-29T01:30:00.000Z', 'tras el cambio a horario de verano');
  assert.equal(C.nextCron('CRON_TZ=UTC 0 0 31 2 *', base), null, 'fecha imposible: null');
  assert.match(C.cronError('61 * * * *'), /fuera de rango en minuto/);
  assert.match(C.cronError('* * *'), /5 campos/);
  assert.match(C.cronError('CRON_TZ=Marte/Base * * * * *'), /zona horaria/);
  assert.equal(C.cronError('0 9 * * 1-5'), '');
  assert.equal(C.describeCron('30 8 * * 1-5'), 'De lunes a viernes a las 08:30');
  assert.equal(C.describeCron('*/10 * * * *'), 'Cada 10 minutos');
  assert.equal(C.presetCron('hourly', { minute: 17 }), '17 * * * *', 'cada hora anclada al minuto de creación');
  assert.equal(C.presetCron('weekly', { time: '10:05', day: 0 }), '5 10 * * 0');
  const t0 = Date.now(); for (let i = 0; i < 50; i++) C.nextCron('CRON_TZ=UTC 0 0 29 2 *', base);
  assert.ok(Date.now() - t0 < 2000, 'rápido aunque la fecha esté lejos');
});

test('tareas: validar, migrar, una sola vez, historial y pendientes', async () => {
  const A = await import('../web/js/automations.js');
  const now = Date.UTC(2026, 10, 16, 21, 7);
  assert.throws(() => A.validateTask({ prompt: '', folder: 'C:\\p' }, now), /qué debe hacer/);
  assert.throws(() => A.validateTask({ prompt: 'x', folder: '' }, now), /carpeta/);
  assert.throws(() => A.validateTask({ prompt: 'x', folder: 'p', schedule: { type: 'cron', cron: '99 * * * *' } }, now), /cron:/);
  assert.throws(() => A.validateTask({ prompt: 'x', folder: 'p', schedule: { type: 'once', at: now - 1 } }, now), /ya pasó/);
  const cron = A.validateTask({ name: 'Deps', prompt: 'npm outdated', folder: 'p', schedule: { type: 'cron', cron: 'CRON_TZ=UTC 0 9 * * 1-5' } }, now);
  assert.equal(new Date(cron.next).toISOString(), '2026-11-17T09:00:00.000Z');
  assert.deepEqual([cron.perm, cron.target, cron.notify, cron.enabled], ['read', 'new', true, true], 'valores por defecto');
  const manual = A.validateTask({ prompt: 'x', folder: 'p' }, now);
  assert.equal(manual.next, null, 'manual: sin próxima');
  const once = A.validateTask({ prompt: 'x', folder: 'p', schedule: { type: 'once', at: now + 60000 } }, now);
  assert.deepEqual(A.dueTasks([once, cron, manual], now + 61000).map((t) => t.id), [once.id]);
  const done = A.recordRun(once, { status: 'ok', start: now + 61000, trigger: 'schedule' }, now + 62000);
  assert.equal(done.enabled, false, 'una sola vez: queda en pausa al ejecutarse');
  assert.equal(done.next, null);
  const manualRun = A.recordRun(once, { status: 'ok', start: now, trigger: 'manual' }, now);
  assert.equal(manualRun.enabled, true, 'ejecutarla a mano no consume la ejecución programada');
  let t = cron;
  for (let i = 0; i < A.MAX_RUNS + 5; i++) t = A.recordRun(t, { status: 'ok', start: now + i, trigger: 'schedule' }, now + 86400000 * 3);
  assert.equal(t.runs.length, A.MAX_RUNS, 'historial acotado');
  assert.ok(t.next > now + 86400000 * 3, 'la próxima se calcula desde ahora: no se repite lo perdido');
  // tareas de la versión anterior
  const old = A.migrateTask({ id: 'a', name: 'x', prompt: 'p', folder: 'f', schedule: { kind: 'weekdays', time: '08:30' }, perm: 'edit', enabled: true, lastRun: 5, lastOk: false, lastThread: 'th' });
  assert.deepEqual(old.schedule, { type: 'cron', cron: '30 8 * * 1-5' });
  assert.equal(old.runs[0].status, 'error'); assert.equal(old.runs[0].thread, 'th');
  assert.equal(old.lastRun, undefined);
  assert.equal(A.migrateTask({ schedule: { kind: 'every', minutes: 15 } }).schedule.cron, '*/15 * * * *');
  assert.equal(A.migrateTask(old), old, 'ya migrada: igual');
  assert.match(A.taskSummary(cron), /Deps · De lunes a viernes a las 09:00.*\(CRON_TZ=UTC 0 9 \* \* 1-5\).*solo lectura/);
  assert.equal(A.parseInterval('10m'), 600000);
  assert.equal(A.parseInterval('5s'), 60000, 'mínimo 1 minuto');
  assert.equal(A.parseInterval('revisa'), null);
});

test('agente: schedule_task pide permiso para crear y en PLAN solo lista; send_later y schedule_wakeup', async () => {
  const calls = [];
  const scheduler = {
    list: () => 'LISTA', runs: (id) => `RUNS ${id}`,
    act: async (action, a, ask) => { const ok = await ask({ title: 'PROGRAMAR TAREA', command: a.name }); calls.push([action, ok]); return ok ? 'creada' : 'RECHAZADO por el usuario.'; },
    sendLater: (a) => `luego: ${a.message}`, wakeup: (a) => `en ${a.delaySeconds}`,
  };
  const r1 = await runScripted([{ tool: 'schedule_task', args: { action: 'create', name: 'Deps', prompt: 'x', cron: '0 9 * * 1' } }, { tool: 'send_later', args: { message: 'revisa CI', delay_minutes: 30 } }, { tool: 'schedule_wakeup', args: { delaySeconds: 300 } }], { ctx: { scheduler } });
  assert.deepEqual(r1.log.confirms, ['PROGRAMAR TAREA'], 'crear pide permiso');
  assert.deepEqual(calls, [['create', true]]);
  assert.ok(r1.msgs.some((m) => m.role === 'tool' && m.content === 'luego: revisa CI'));
  assert.ok(r1.msgs.some((m) => m.role === 'tool' && m.content === 'en 300'));
  const r2 = await runScripted([{ tool: 'schedule_task', args: { action: 'list' } }, { tool: 'schedule_task', args: { action: 'delete', id: 'a' } }], { ctx: { scheduler, mode: 'plan' } });
  assert.ok(r2.msgs.some((m) => m.role === 'tool' && m.content === 'LISTA'));
  assert.ok(r2.msgs.some((m) => m.role === 'tool' && /DENEGADO: modo PLAN/.test(m.content)), 'en PLAN no se borra');
  const r3 = await runScripted([{ tool: 'schedule_task', args: { action: 'list' } }], {});
  assert.ok(r3.msgs.some((m) => m.role === 'tool' && /solo están en la app de escritorio/.test(m.content)));
});

test('hooks: configuración con el esquema de Claude Code y conversión del formato antiguo', () => {
  const HC = require('../desktop/lib/hookconfig.js');
  const claude = HC.normalize({ permissions: { allow: [] }, hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a', timeout: 9999 }] }],
    Stop: [{ hooks: [{ type: 'prompt', prompt: '¿terminó? $ARGUMENTS' }] }],
  } });
  assert.deepEqual(claude.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a', timeout: 600 }] }], 'timeout acotado a 600 s');
  assert.equal(claude.hooks.Stop[0].hooks[0].type, 'prompt');
  const legacy = HC.normalize({ pre_tool: [{ matcher: 'run_command', command: 'x' }], post_edit: ['fmt {path}'], session_start: ['ctx'] });
  assert.equal(legacy.hooks.PreToolUse[0].matcher, 'run_command');
  assert.equal(legacy.hooks.PostToolUse[0].matcher, 'Write|Edit', 'post_edit = PostToolUse sobre Write|Edit');
  assert.equal(legacy.hooks.SessionStart[0].hooks[0].command, 'ctx');
  assert.equal(HC.normalize({ disableAllHooks: true }).disableAll, true);
  assert.throws(() => HC.normalize({ hooks: { PreToolUze: [] } }), /desconocido/);
  assert.throws(() => HC.normalize({ hooks: { PreToolUse: [{ matcher: '(', hooks: [] }] } }), /matcher inválido/);
  assert.throws(() => HC.normalize({ hooks: { Stop: [{ hooks: [{ type: 'http' }] }] } }), /tipo de hook desconocido/);
});

test('hooks: entrada y salida como Claude Code (nombres, campos, código 2, deny > ask > allow, updatedInput, continue)', async () => {
  const { createHooks, toolInput, fromToolInput, claudeToolName } = await import('../web/js/hooks.js');
  assert.equal(claudeToolName('run_command'), 'Bash');
  assert.deepEqual(toolInput('edit_file', { path: 'src/a.js', old: 'x', new: 'y' }, 'C:\\proj'), { file_path: 'C:\\proj\\src\\a.js', old_string: 'x', new_string: 'y' });
  assert.deepEqual(fromToolInput('edit_file', { file_path: 'C:\\proj\\src\\b.js' }, 'C:\\proj', { path: 'src/a.js', old: 'x', new: 'y' }), { path: 'src\\b.js', old: 'x', new: 'y' });
  const seen = [];
  const out = {
    bloquea: { code: 2, stderr: 'no se toca .env' },
    permite: { code: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }) },
    pregunta: { code: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'revisa' } }) },
    reescribe: { code: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { command: 'npm test -- --ci' } } }) },
    contexto: { code: 0, stdout: 'rama: main' },
    adicional: { code: 0, stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'lint ok' }, systemMessage: 'formateado' }) },
    para: { code: 0, stdout: JSON.stringify({ continue: false, stopReason: 'cuota agotada' }) },
    falla: { code: 1, stderr: 'roto' },
    texto: { code: 0, stdout: 'hecho' },
  };
  const H = createHooks([
    { label: 'usuario', hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'bloquea' }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'permite' }, { type: 'command', command: 'pregunta' }] }],
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'contexto' }] }] } },
    { label: '.claude/settings.json', hooks: { PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'adicional' }, { type: 'command', command: 'texto' }, { type: 'command', command: 'falla' }] }],
      PreToolUse: [{ matcher: 'mcp__github__.*', hooks: [{ type: 'command', command: 'reescribe' }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'permite' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'para' }] }] } },
  ], { exec: async (cmd, input) => { seen.push([cmd, input.hook_event_name, input.tool_name, input.cwd]); return out[cmd]; }, base: () => ({ cwd: 'C:\\proj', session_id: 's1', permission_mode: 'default' }) });

  const w = await H.run('PreToolUse', { tool_name: 'Write', jeancode_tool: 'write_file' });
  assert.equal(w.blocked, true); assert.equal(w.decision, 'deny'); assert.equal(w.reason, 'no se toca .env');
  assert.deepEqual(seen.at(-1), ['bloquea', 'PreToolUse', 'Write', 'C:\\proj'], 'entrada con hook_event_name, tool_name y cwd');
  const b = await H.run('PreToolUse', { tool_name: 'Bash', jeancode_tool: 'run_command' });
  assert.equal(b.decision, 'ask', 'ask gana a allow'); assert.equal(b.decisionReason, 'revisa');
  assert.equal(seen.filter((x) => x[0] === 'permite').length, 1, 'el mismo comando en dos fuentes corre una vez');
  assert.equal((await H.run('PreToolUse', { tool_name: 'Read', jeancode_tool: 'read_file' })).ran, 0, 'matcher exacto: Read no casa con Write|Edit');
  assert.equal((await H.run('PreToolUse', { tool_name: 'x', jeancode_tool: 'edit_file' })).ran, 0);
  const m = await H.run('PreToolUse', { tool_name: 'mcp__github__create_issue' });
  assert.deepEqual(m.updatedInput, { command: 'npm test -- --ci' });
  assert.equal((await H.run('SessionStart', { source: 'startup' })).context, 'rama: main', 'texto de SessionStart = contexto');
  assert.equal((await H.run('SessionStart', { source: 'resume' })).ran, 0, 'matcher de SessionStart sobre source');
  const post = await H.run('PostToolUse', { tool_name: 'Bash' });
  assert.equal(post.context, 'lint ok'); assert.deepEqual(post.messages.slice(0, 1), ['formateado']);
  assert.deepEqual(post.outputs, ['hecho'], 'el texto de PostToolUse va al registro, no al modelo');
  assert.match(post.messages[1], /falló con código 1: roto/);
  const up = await H.run('UserPromptSubmit', { prompt: 'hola' });
  assert.equal(up.stop, true); assert.equal(up.stopReason, 'cuota agotada');
  assert.equal(H.has('SessionEnd'), false);
  assert.equal(H.list().length, 10, 'list() para /hooks: todos los configurados');
});

test('hooks: PermissionRequest y hooks de tipo prompt', async () => {
  const { createHooks } = await import('../web/js/hooks.js');
  const H = createHooks([{ label: 'u', hooks: {
    PermissionRequest: [{ matcher: 'WebFetch', hooks: [{ type: 'command', command: 'pr' }] }],
    Stop: [{ hooks: [{ type: 'prompt', prompt: '¿Están las pruebas en verde? $ARGUMENTS' }] }],
    Notification: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }],
  } }], {
    exec: async () => ({ code: 0, stdout: JSON.stringify({ hookSpecificOutput: { decision: { behavior: 'deny', message: 'sin internet' } } }) }),
    llm: async (prompt) => (prompt.includes('"last_assistant_message": "listo"') ? '```json\n{"ok": false, "reason": "no ejecutaste npm test"}\n```' : '{"ok": true}'),
  });
  const pr = await H.run('PermissionRequest', { tool_name: 'WebFetch' });
  assert.equal(pr.decision, 'deny'); assert.equal(pr.reason, 'sin internet');
  const st = await H.run('Stop', { stop_hook_active: false, last_assistant_message: 'listo' });
  assert.equal(st.blocked, true); assert.equal(st.reason, 'no ejecutaste npm test');
  assert.equal((await H.run('Stop', { last_assistant_message: 'pruebas: 12 ok' })).blocked, false);
  assert.match((await H.run('Notification', {})).messages[0], /no admite hooks de tipo prompt/);
});

test('agente + hooks: PreToolUse bloquea, Stop obliga a seguir con stop_hook_active y SubagentStart da contexto', async () => {
  const calls = [];
  const R = (o = {}) => ({ blocked: false, reason: '', decision: null, decisionReason: '', updatedInput: null, context: '', stop: false, stopReason: '', messages: [], outputs: [], ran: 1, ...o });
  const hooks = {
    has: (e) => ['PreToolUse', 'Stop'].includes(e),
    run: async (e, p) => {
      calls.push([e, p.tool_name, p.stop_hook_active, p.tool_input]);
      if (e === 'PreToolUse') return R(p.tool_name === 'Bash' ? { blocked: true, decision: 'deny', reason: 'comandos prohibidos por la política' } : {});
      return R({ blocked: hooks.stops++ === 0, reason: 'falta ejecutar las pruebas' });
    },
    stops: 0,
  };
  const { log, msgs } = await runScripted([{ tool: 'run_command', args: { command: 'npm test' } }], { ctx: { hooks } });
  assert.deepEqual(log.ran, [], 'el comando no se ejecutó');
  assert.deepEqual(calls[0], ['PreToolUse', 'Bash', undefined, { command: 'npm test' }], 'nombre y campos de Claude Code');
  assert.ok(msgs.some((m) => m.role === 'tool' && /BLOQUEADO por un hook: comandos prohibidos/.test(m.content)));
  assert.ok(msgs.some((m) => m.role === 'user' && /PIDE CONTINUAR.*pruebas/.test(m.content)), 'Stop hizo seguir una vez');
  assert.deepEqual(calls.filter((c) => c[0] === 'Stop').map((c) => c[2]), [false, true], 'stop_hook_active la segunda vez');
});

test('hooks del proyecto: .claude/settings.json, .jeancode/settings.local.json y hooks.json antiguo, con huella', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-hooks-'));
  mkdirSync(join(root, '.claude')); mkdirSync(join(root, '.jeancode'));
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] }] } }));
  writeFileSync(join(root, '.jeancode', 'settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'b' }] }] } }));
  writeFileSync(join(root, '.jeancode', 'hooks.json'), JSON.stringify({ post_edit: ['fmt {path}'] }));
  const h = await tools.hooks(root);
  assert.deepEqual(h.sources.map((s) => s.file), ['.claude/settings.json', '.jeancode/settings.local.json', '.jeancode/hooks.json']);
  assert.match(h.hash, /^[0-9a-f]{64}$/);
  writeFileSync(join(root, '.jeancode', 'settings.local.json'), '{ roto');
  assert.match((await tools.hooks(root)).error, /settings\.local\.json no es válido/);
  // disableAllHooks entra en la huella: añadirlo o quitarlo vuelve a pedir confianza
  writeFileSync(join(root, '.jeancode', 'settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'b' }] }] } }));
  const before = (await tools.hooks(root)).hash;
  writeFileSync(join(root, '.jeancode', 'settings.local.json'), JSON.stringify({ disableAllHooks: true, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'b' }] }] } }));
  const after = await tools.hooks(root);
  assert.equal(after.disableAll, true);
  assert.notEqual(after.hash, before, 'activar disableAllHooks cambia la huella');
  const solo = mkdtempSync(join(tmpdir(), 'jc-hooks-off-'));
  mkdirSync(join(solo, '.claude'));
  writeFileSync(join(solo, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }));
  const off = await tools.hooks(solo);
  assert.deepEqual([off.sources.length, off.disableAll, /^[0-9a-f]{64}$/.test(off.hash)], [0, true, true], 'solo disableAllHooks también tiene huella (pide confianza)');
  const r = await tools.execHook(root, process.platform === 'win32' ? 'echo %CLAUDE_PROJECT_DIR%' : 'echo $CLAUDE_PROJECT_DIR', { hook_event_name: 'Stop' }, 10);
  assert.equal(r.stdout.trim().toLowerCase(), require('node:fs').realpathSync(root).toLowerCase(), 'CLAUDE_PROJECT_DIR como en Claude Code');
});

test('control: buscar controles por nombre (sin tildes, por etiqueta vecina) y sugerencias', async () => {
  const { ComputerControl } = require('../desktop/lib/computer/control.js');
  const c = new ComputerControl({ logFile: join(mkdtempSync(join(tmpdir(), 'jc-pcu-')), 'l.jsonl') });
  const R = (x, y, w = 80, h = 24) => ({ x, y, w, h });
  c.lastRaw = { at: Date.now(), elements: [
    { id: 1, type: 'Button', name: 'Guardar como…', automationId: '', value: '', enabled: true, rect: R(10, 10) },
    { id: 2, type: 'Button', name: 'Guardar', automationId: 'save', value: '', enabled: true, rect: R(100, 10) },
    { id: 3, type: 'Text', name: 'Correo electrónico:', automationId: '', value: '', enabled: true, rect: R(10, 60, 120) },
    { id: 4, type: 'Edit', name: '', automationId: '', value: '', enabled: true, rect: R(140, 58, 200) },
    { id: 5, type: 'Edit', name: '', automationId: '', value: '', enabled: true, rect: R(140, 300, 200) },
    { id: 6, type: 'Button', name: 'Cancelar', automationId: '', value: '', enabled: false, rect: R(200, 10) },
  ] };
  assert.equal((await c.elementByName('guardar')).id, 2, 'exacto gana a "empieza por"');
  assert.equal((await c.elementByName('SAVE')).id, 2, 'también por automationId');
  assert.equal((await c.elementByName('correo electronico', 'Edit')).id, 4, 'campo sin nombre junto a su etiqueta');
  await assert.rejects(c.elementByName('Imprimir'), /no hay ningún control llamado «Imprimir».*Guardar/);
});

test('historial: al guardar se quitan capturas, el prompt del sistema y se recortan resultados antiguos', async () => {
  const { compactThread } = await import('../web/js/history.js');
  const agentMessages = [{ role: 'system', content: 'S'.repeat(9000) },
    ...Array.from({ length: 30 }, (_, i) => ({ role: 'tool', tool_call_id: `c${i}`, content: `${i}:` + 'r'.repeat(20000) })),
    { role: 'user', content: [{ type: 'text', text: 'Captura actual' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(100000) } }] }];
  const t = { id: 't', messages: [{ role: 'user', content: 'hola' }], agentMessages };
  const c = compactThread(t);
  assert.equal(c.agentMessages[0].content, '', 'el prompt del sistema se regenera: no se guarda');
  assert.ok(!JSON.stringify(c).includes('data:image'), 'sin capturas');
  assert.match(c.agentMessages.at(-1).content, /Captura actual[\s\S]*captura omitida/);
  assert.ok(c.agentMessages[1].content.length < 4200 && /recortado al guardar/.test(c.agentMessages[1].content), 'resultados antiguos recortados');
  assert.equal(c.agentMessages[29].content.length, 20003, 'los últimos se guardan completos');
  assert.equal(c.agentMessages[1].tool_call_id, 'c0', 'se conserva la relación con su llamada');
  assert.deepEqual(c.messages, t.messages, 'lo que ve el usuario no se toca');
  assert.equal(t.agentMessages[0].content.length, 9000, 'no modifica la conversación en memoria');
  assert.ok(JSON.stringify(c).length < JSON.stringify(t).length / 2);
});

test('calidad: datos sensibles, tablas, texto, enlaces, búsqueda y proxy con buffering', async () => {
  const Q = await import('../web/js/quality.js');
  const kinds = (t) => Q.detectSensitive(t).map((x) => x.kind);
  assert.deepEqual(kinds('mi clave es sk-proj-abcdefghijklmnopqrstu y ya'), ['clave de API']);
  assert.ok(kinds('ghp_' + 'a'.repeat(36)).includes('token de GitHub'));
  assert.ok(kinds('tarjeta 4111 1111 1111 1111').includes('número de tarjeta'));
  assert.deepEqual(kinds('pedido 1234 5678 9012 3456'), [], 'sin Luhn no es tarjeta');
  assert.ok(kinds('postgres://admin:secreta123@db.local/x').includes('cadena de conexión con contraseña'));
  assert.ok(kinds('IBAN ES91 2100 0418 4502 0005 1332').includes('IBAN'));
  assert.deepEqual(kinds('¿cómo hago un bucle for en JS?'), []);
  assert.ok(!Q.detectSensitive('sk-proj-abcdefghijklmnopqrstu')[0].sample.includes('abcdefghij'), 'la muestra va enmascarada');
  assert.equal(Q.rowsToCsv([['a', 'b,c'], ['x "y"', '1']]), 'a,"b,c"\n"x ""y""",1');
  assert.deepEqual(Q.rowsToMarkdown([['A', 'B'], ['1', '2|3']]).split('\n'), ['| A | B |', '| --- | --- |', String.raw`| 1 | 2\|3 |`]);
  assert.equal(Q.markdownToText('## T\n**n** y `c` [doc](https://x.dev)'), 'T\nn y c doc (https://x.dev)');
  assert.deepEqual(Q.extractLinks('ver [a](https://a.dev/x) y https://b.dev/y. también https://a.dev/x'), ['https://a.dev/x', 'https://b.dev/y']);
  const th = [{ id: 1, title: 'Bug de React', updated: 1, messages: [{ content: 'useEffect se ejecuta dos veces' }] }, { id: 2, title: 'Recetas', updated: 2, messages: [{ content: 'efecto' }] }];
  assert.deepEqual(Q.searchThreads(th, 'react useeffect').map((r) => r.thread.id), [1]);
  assert.match(Q.searchThreads(th, 'dos veces')[0].snippet, /dos veces/);
  assert.equal(Q.searchThreads(th, '').length, 2);
  assert.equal(Q.looksBuffered({ firstByteMs: 9000, totalMs: 9500, reads: 1, chars: 3000 }), true);
  assert.equal(Q.looksBuffered({ firstByteMs: 400, totalMs: 9500, reads: 120, chars: 3000 }), false);
  assert.match(Q.qualityPrompt({ directness: 'direct', length: 'short' }), /no lo sé[\s\S]*FRANQUEZA: muy directa[\s\S]*LONGITUD: respuestas cortas/);
  const j = JSON.parse(Q.threadToJson({ title: 'T', mode: 'chat', messages: [{ role: 'user', content: 'hola' }], agentMessages: [{ role: 'system', content: 'secreto' }] }, '1.2.0'));
  assert.equal(j.messages.length, 1);
  assert.ok(!JSON.stringify(j).includes('secreto'), 'sin historial interno del agente');
});

test('enlaces: DNS validado, nada de red local aunque el nombre parezca público', async () => {
  const L = require('../desktop/lib/linkcheck.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) assert.equal(L.isPublicIp(ip), false, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(L.isPublicIp(ip), true, ip);
  // nombres que RESUELVEN a la red local: el texto engaña, el DNS no
  for (const href of ['http://localtest.me:8080/x', 'http://localhost./x', 'http://127.0.0.1/', 'http://[::1]/']) {
    const r = await L.checkLink(href, { timeout: 3000 });
    assert.equal(r.ok, false, href);
    assert.ok(r.local || /no existe/.test(r.reason), `${href}: ${JSON.stringify(r)}`);
  }
  assert.equal((await L.checkLink('ftp://example.com/')).ok, false);
  assert.equal((await L.checkLink('https://u:p@example.com/')).ok, false);
});

test('Jean API: el nombre del Codespace o cualquier URL suya lleva al router 8899', () => {
  assert.equal(R.jeanRouterUrl('jeancode-api-7vrvr96vw54x3wpq5'), 'https://jeancode-api-7vrvr96vw54x3wpq5-8899.app.github.dev/v1');
  assert.equal(R.jeanRouterUrl('https://Fluffy-Space-abc123.github.dev/'), 'https://fluffy-space-abc123-8899.app.github.dev/v1', 'URL del editor');
  assert.equal(R.jeanRouterUrl('https://my-cs-8888.app.github.dev/v1'), 'https://my-cs-8899.app.github.dev/v1', 'puerto de Grey');
  assert.equal(R.jeanRouterUrl('my-cs-8890.app.github.dev'), 'https://my-cs-8899.app.github.dev/v1', 'sin https');
  assert.equal(R.jeanRouterUrl('https://my-cs-8899.app.github.dev/v1'), null, 'ya es el router');
  assert.equal(R.jeanRouterUrl('https://api.groq.com/openai/v1'), null);
  const v = R.validateEndpoint({ url: 'jeancode-api-7vrvr96vw54x3wpq5', key: 'k', provider: 'jean' });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.url, 'https://jeancode-api-7vrvr96vw54x3wpq5-8899.app.github.dev/v1');
  assert.ok(v.warnings.some((w) => /router/.test(w)));
});

test('Jean API en Kaggle: el túnel es el router y el registro no muestra la URL', async () => {
  const A = await import('../web/js/api.js');
  const H = await import('../web/js/hf.js');
  const R = await import('../web/js/router.js');
  const url = 'https://brave-lion-1234.trycloudflare.com/v1';
  assert.equal(A.isRouterUrl(url), true, 'el túnel apunta al router');
  assert.equal(A.isRouterUrl('https://api.groq.com/openai/v1'), false);
  assert.equal(H.controlUrlFrom(url), 'https://brave-lion-1234.trycloudflare.com', 'control = el propio túnel');
  assert.equal(R.where({ url }), '….trycloudflare.com/v1');
  const v = R.validateEndpoint({ url, key: 'k', provider: 'jean' });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('proveedores: CORS según lo comprobado en vivo y cabecera de Anthropic', async () => {
  const P = await import('../web/js/providers.js');
  const by = (id) => P.providerById(id);
  for (const id of ['deepseek', 'mistral', 'xai', 'scaleway', 'anthropic']) assert.equal(by(id).browser, true, id);
  for (const id of ['zai', 'nvidia', 'sambanova']) assert.equal(by(id).browser, false, id);
  assert.equal(P.adapterOf({ provider: 'anthropic' }).headers()['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(P.adapterOf({ provider: 'groq' }).headers(), {}, 'nadie más recibe esa cabecera');
});

/* ---------------- EJECUTAR (run.js, sandbox.js, batch.js, desktop/lib/runner.js) ---------------- */
import { langOf, entryFor, runnableFiles, dependencies, buildRunDoc } from '../web/js/run.js';
import { jcNorm, jcCss, jcImports } from '../web/js/sandbox.js';
import { jcBatch } from '../web/js/batch.js';
const runner = require('../desktop/lib/runner.js');

test('EJECUTAR: rutas, CSS e imports se resuelven dentro del proyecto', () => {
  assert.equal(jcNorm('js/app.js', '../css/a.css?v=1'), 'css/a.css');
  assert.equal(jcNorm('a/b.html', '/img/x.svg'), 'img/x.svg');
  assert.equal(jcNorm('index.html', 'https://x.com/a.js'), null);
  assert.equal(jcNorm('index.html', '#top'), null);
  const link = (p, k) => (p ? `blob:${k}:${p}` : null);
  assert.equal(jcCss('@import "b.css"; a{background:url(../img/x.svg)}', 'css/a.css', link), '@import url("blob:css:css/b.css"); a{background:url("blob:raw:img/x.svg")}');
  assert.equal(jcImports("import { a } from './u.js'; import 'lodash'; const m = import('../m.js');", 'js/app.js', link),
    "import { a } from 'blob:module:js/u.js'; import 'lodash'; const m = import('blob:module:m.js');");
});

test('EJECUTAR: el archivo de entrada y sus dependencias', () => {
  const f = {
    'index.html': '<link rel="stylesheet" href="css/s.css"><script type="module" src="js/a.js"></script>',
    'css/s.css': 'body{}', 'js/a.js': "import './b.js'; fetch('data.json')", 'js/b.js': '', 'data.json': '{}',
    'tools/build.py': 'print(1)', 'README.md': '# hola',
  };
  assert.deepEqual(dependencies(f, 'index.html').sort(), ['css/s.css', 'data.json', 'index.html', 'js/a.js', 'js/b.js']);
  assert.equal(entryFor(f, 'js/b.js'), 'index.html', 'una dependencia ejecuta la página que la usa');
  assert.equal(entryFor(f, 'tools/build.py'), 'tools/build.py');
  assert.equal(entryFor(f, 'README.md'), 'index.html', 'un README abierto no quita el sitio a la página');
  assert.equal(entryFor(f, 'README.md', { explicit: true }), 'README.md');
  assert.equal(runnableFiles({ 'a.rb': '', 'b.md': '' })[0], 'b.md', 'sin escritorio Ruby no se ejecuta');
  assert.equal(runnableFiles({ 'a.rb': '', 'b.md': '' }, { desktop: true })[0], 'a.rb');
  assert.equal(langOf('x.BAT').id, 'batch');
  const doc = buildRunDoc({ 'index.html': '</script><script>alert(1)</script>' }, 'index.html', { token: 't' });
  assert.equal(doc.mode, 'html');
  assert.equal(doc.srcdoc.match(/<\/script/g).length, 1, 'el contenido del proyecto no puede cerrar el script de arranque');
  assert.equal(buildRunDoc({ 'a.rb': '' }, 'a.rb', { token: 't' }), null);
});

test('EJECUTAR: intérprete Batch', async () => {
  let out = '';
  const io = { write: (t) => { out += t; }, readLine: async () => 'Ana', clear() {}, title() {}, colors() {} };
  const files = {
    'main.bat': '@echo off\nsetlocal enabledelayedexpansion\nset /a t=0\nfor /l %%i in (1,1,4) do (\n  set /a t+=%%i\n)\necho total=!t!\ncall :doble 21\necho doble=%r%\nset /p n=Nombre: \nif /i "%n%"=="ana" (echo hola Ana) else (echo quien)\necho guardado > out.txt\ntype out.txt\ncall sub\\otro.bat x\nexit /b 4\n:doble\nset /a r=%1*2\ngoto :eof',
    'sub/otro.bat': '@echo otro %1 %~n0',
  };
  const code = await jcBatch(files, 'main.bat', io);
  assert.equal(code, 4);
  assert.equal(out, 'total=10\ndoble=42\nNombre: hola Ana\nguardado \notro x otro\n');
});

test('EJECUTAR en el PC: comandos según el lenguaje, dentro de la copia', () => {
  const p = runner.plan({ files: { 'src/main.c': '', 'src/u.c': '', 'x.c': '' }, entry: 'src/main.c', lang: 'c' });
  assert.equal(p.ok, true);
  assert.match(p.command, /main\.c u\.c -o/, 'compila todos los .c de la carpeta');
  assert.equal(p.cwd, 'src');
  assert.equal(runner.plan({ files: {}, entry: 'a.xyz', lang: 'nada' }).ok, false);
  const java = runner.stepsFor('java', 'Main.java', { 'Main.java': 'package app.demo;\nclass Main {}' });
  assert.deepEqual(java[1][0].args.slice(-1), ['app.demo.Main']);
});

/* ---------------- razonamiento por modelo y aviso de versión nueva ---------------- */
import { reasoningOf, resolveMode, applyReasoning } from '../web/js/reasoning.js';
import { platformOf, pickAsset, changeKind, updateFrom } from '../web/js/update.js';

test('razonamiento: cada modelo ofrece lo suyo y se pide a su manera', () => {
  const ep = (provider) => ({ id: provider, provider, url: 'x' });
  assert.deepEqual(reasoningOf(ep('jean'), 'jean-grey').modes, ['normal', 'think']);
  assert.deepEqual(reasoningOf(ep('openai'), 'o3-mini').modes, ['low', 'medium', 'high']);
  assert.deepEqual(reasoningOf(ep('openai'), 'gpt-5').modes, ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(reasoningOf(ep('openai'), 'gpt-4o').modes, [], 'sin razonamiento regulable');
  assert.equal(reasoningOf(ep('deepseek'), 'deepseek-reasoner').always, true);
  const body = { model: 'x', temperature: 0.2 };
  assert.deepEqual(applyReasoning(body, ep('jean'), 'jean-grey', 'think'), { model: 'x', temperature: 0.2, chat_template_kwargs: { enable_thinking: true } });
  assert.deepEqual(applyReasoning(body, ep('openai'), 'o3-mini', 'high'), { model: 'x', reasoning_effort: 'high' }, 'sin temperature');
  assert.deepEqual(applyReasoning(body, ep('openrouter'), 'openai/gpt-oss-120b', 'low').reasoning, { effort: 'low' });
  const a = applyReasoning(body, ep('anthropic'), 'claude-sonnet-4-5', 'medium');
  assert.equal(a.thinking.budget_tokens, 8192);
  assert.ok(a.max_tokens > 8192 && !('temperature' in a));
  assert.deepEqual(applyReasoning(body, ep('groq'), 'gpt-4o', 'high'), body, 'un modelo sin razonamiento no cambia');
  assert.equal(resolveMode('think', { modes: ['low', 'medium', 'high'] }), 'medium', 'PENSAR → esfuerzo medio');
  assert.equal(resolveMode('high', { modes: ['normal', 'think'] }), 'think');
  assert.equal(resolveMode('normal', { modes: ['low', 'high'] }), 'low');
});

test('versión nueva: plataforma, descarga y tipo de salto', () => {
  assert.equal(platformOf({ desktop: false }), null, 'la web se actualiza sola');
  assert.equal(platformOf({ capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }), 'android');
  assert.equal(platformOf({ desktop: true, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38' }), 'win');
  const assets = [{ name: 'JeanCode-1.3.0-android.apk', size: 1 }, { name: 'JeanCode-Setup-1.3.0.exe', size: 2, browser_download_url: 'https://dl/JeanCode-Setup-1.3.0.exe' }, { name: 'JeanCode-1.3.0-arm64.dmg', size: 3 }];
  assert.equal(pickAsset(assets, 'android').name, 'JeanCode-1.3.0-android.apk');
  assert.equal(pickAsset(assets, 'linux'), null);
  assert.equal(changeKind('1.2.2', '1.2.3'), 'parche');
  assert.equal(changeKind('1.2.2', '1.3.0'), 'menor');
  assert.equal(changeKind('1.2.2', '2.0.0'), 'mayor');
  const rel = { tag_name: 'v1.3.0', assets, body: '## Novedades', html_url: 'https://github.com/x/releases/tag/v1.3.0' };
  const u = updateFrom(rel, { platform: 'win', current: '1.2.2' });
  assert.equal(u.version, '1.3.0');
  assert.match(u.url, /\.exe$/);
  assert.equal(updateFrom(rel, { platform: 'win', current: '1.3.0' }), null, 'misma versión');
  assert.equal(updateFrom(rel, { platform: 'win', current: '1.2.2', skipped: '1.3.0' }), null, 'omitida');
  assert.equal(updateFrom({ ...rel, prerelease: true }, { platform: 'win', current: '1.2.2' }), null);
});

/* ---------------- plugins (formato de Claude Code) ---------------- */
const pluginsLib = require('../desktop/lib/plugins.js');
const { catalogLines, PLUGIN_INLINE_MAX } = await import('../web/js/agent.js');

function fakePlugin(skills = 2) {
  const src = mkdtempSync(join(tmpdir(), 'jc-plugin-src-'));
  const w = (rel, text) => { mkdirSync(join(src, rel, '..'), { recursive: true }); writeFileSync(join(src, rel), text); };
  w('.claude-plugin/plugin.json', JSON.stringify({ name: 'demo', displayName: 'Demo', version: '1.0.0', license: 'MIT', agents: ['./.claude-plugin/agents/critic.md'] }));
  for (let i = 0; i < skills; i++) w(`skills/s${i}/SKILL.md`, `---\nname: s${i}\ndescription: skill ${i}\n---\nCuerpo ${i}. Ver \${CLAUDE_PLUGIN_ROOT}/docs/guia.md`);
  w('skills/s0/resources/extra.md', 'EXTRA');
  w('.claude-plugin/agents/critic.md', '---\nname: demo-critic\ndescription: Crítico\ntools: [Read, Grep]\n---\nLee `${CLAUDE_PLUGIN_ROOT}/docs/persona.md`.');
  w('commands/plan.md', '---\ndescription: Planifica\n---\nPlan para: $ARGUMENTS');
  w('docs/persona.md', 'PERSONA COMPLETA');
  w('docs/guia.md', 'GUIA');
  w('hooks/hooks.json', '{}');
  w('node_modules/x/index.js', 'malo');
  return src;
}

test('plugins: instala solo el texto útil y expone skills, subagentes y comandos', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-plugins-'));
  const p = pluginsLib.create(dir);
  const r = await p.installFrom(fakePlugin(), 'https://example.test/demo.git');
  assert.deepEqual(r.counts, { skills: 2, agents: 1, commands: 1 });
  const fsx = require('node:fs');
  assert.ok(!fsx.existsSync(join(dir, 'demo', 'hooks')), 'los hooks no se copian');
  assert.ok(!fsx.existsSync(join(dir, 'demo', 'node_modules')), 'node_modules no se copia');

  const [agent] = await p.agents();
  assert.equal(agent.name, 'demo-critic');
  assert.equal(agent.write, false, 'tools [Read, Grep] = solo lectura');
  assert.match(agent.prompt, /PERSONA COMPLETA/, 'la persona citada con ${CLAUDE_PLUGIN_ROOT} va dentro del prompt');
  assert.doesNotMatch(agent.prompt, /CLAUDE_PLUGIN_ROOT/);

  const [cmd] = await p.commands();
  assert.equal(cmd.name, 'demo:plan');
  assert.equal(expandCustom(cmd.body, 'login'), 'Plan para: login');

  assert.match(await p.read('s0'), /Cuerpo 0[\s\S]*GUIA/);
  assert.equal(await p.read('s0', 'resources/extra.md'), 'EXTRA', 'archivo relativo a la skill');
  assert.equal(await p.read('demo', 'docs/guia.md'), 'GUIA', 'archivo relativo al plugin');
  await assert.rejects(p.read('demo', '../../secreto.txt'), /no existe en el plugin/);
  assert.match(await p.read('demo'), /SKILLS \(2\)[\s\S]*SUBAGENTES \(1\)[\s\S]*\/demo:plan/);
  assert.equal(await p.read('otra-cosa'), null);

  await p.setEnabled('demo', false);
  assert.equal((await p.skills()).length, 0, 'desactivado = no aporta nada');
  assert.equal(await p.read('s0'), null);
  await p.setEnabled('demo', true);
  await p.installFrom(fakePlugin(), 'x');
  assert.equal((await p.list())[0].enabled, true, 'reinstalar conserva el estado');
  await p.remove('demo');
  assert.deepEqual(await p.list(), []);
});

test('plugins: rechaza carpetas sin manifiesto y tools ausente = todas', async () => {
  const p = pluginsLib.create(mkdtempSync(join(tmpdir(), 'jc-plugins-')));
  await assert.rejects(p.installFrom(mkdtempSync(join(tmpdir(), 'jc-vacio-'))), /no es un plugin/);
  assert.equal(pluginsLib.canWrite(undefined), true);
  assert.equal(pluginsLib.canWrite('Read, Grep, Glob'), false);
  assert.equal(pluginsLib.canWrite('Read, Edit, Bash'), true);
});

test('plugins: los grandes se resumen en el prompt y los comandos llevan prefijo', () => {
  const many = Array.from({ length: PLUGIN_INLINE_MAX + 5 }, (_, i) => ({ name: `k${i}`, description: 'd', plugin: 'big' }));
  const text = catalogLines([{ name: 'propia', description: 'mía' }, ...many, { name: 'e1', description: 'x', plugin: 'egm' }], 'skills');
  assert.match(text, /- propia: mía/);
  assert.match(text, /PLUGIN big: 30 skills[\s\S]*load_skill \{"name": "big"\}/);
  assert.doesNotMatch(text, /- k29/);
  assert.match(text, /PLUGIN egm:\n- e1: x/);
  assert.deepEqual(parseCommand('/ecc:plan añadir login'), { name: 'ecc:plan', args: 'añadir login' });
  assert.deepEqual(matchCommands('pla', 'agent', [{ name: 'ecc:plan', description: 'p' }]).filter((c) => c.custom).map((c) => c.name), ['ecc:plan']);
});

test('plugins: un "name" malicioso no sale de la carpeta de plugins', async () => {
  const fsx = require('node:fs');
  const parent = mkdtempSync(join(tmpdir(), 'jc-padre-'));
  const dir = join(parent, 'plugins');
  writeFileSync(join(parent, 'centinela.txt'), 'no me borres');
  const p = pluginsLib.create(dir);
  for (const name of ['..', '.', '../..', '.git', '-..']) {
    const src = mkdtempSync(join(tmpdir(), 'jc-evil-'));
    mkdirSync(join(src, '.claude-plugin'));
    writeFileSync(join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
    const r = await p.installFrom(src).catch((e) => e);
    if (!(r instanceof Error)) assert.equal(require('node:path').dirname(join(dir, r.id)), dir, `id ${r.id} queda dentro`);
    assert.ok(fsx.existsSync(join(parent, 'centinela.txt')), `"${name}" no borra la carpeta padre`);
  }
  await p.remove('..'); // slug('..') = 'plugin': nunca la carpeta padre
  assert.ok(fsx.existsSync(join(parent, 'centinela.txt')));
});
/* ---------------- control remoto: cifrado, sesión y transportes ---------------- */
const RC = await import('../web/js/remote/crypto.js');
const RL = await import('../web/js/remote/link.js');

test('remoto: cifrado E2E, saludo, secuencia, manipulación y otra sala', async () => {
  const secret = RC.b64u(RC.randomBytes(32));
  const a = await RC.deriveKeys(secret);
  const b = await RC.deriveKeys(RC.unb64u(secret));
  assert.equal(a.room, b.room); assert.match(a.room, /^[0-9a-f]{32}$/);
  assert.notEqual(a.room, (await RC.deriveKeys(RC.randomBytes(32))).room);
  const phone = new RC.Session(a.key, 'phone');
  const host = new RC.Session(b.key, 'host');
  const [h, welcome] = await host.accept(await phone.hello({ name: 'Pixel' }));
  assert.equal(h.name, 'Pixel');
  await phone.welcome(welcome);
  const f1 = await phone.wrap({ type: 'send', text: 'hola' });
  assert.ok(!JSON.stringify(f1).includes('hola'), 'el contenido no viaja en claro');
  assert.deepEqual(await host.unwrap(f1), { type: 'send', text: 'hola' });
  await assert.rejects(host.unwrap(f1), /repetido/, 'un marco grabado no se puede repetir');
  await assert.rejects(phone.unwrap(f1), /./, 'ni devolverse en sentido contrario');
  const f2 = await phone.wrap({ type: 'stop' });
  const tampered = { ...f2, ct: f2.ct.slice(0, -4) + (f2.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(host.unwrap(tampered), /./, 'manipulado: se rechaza');
  // otra conexión con la misma clave no acepta marcos de esta
  const host2 = new RC.Session(b.key, 'host');
  const phone2 = new RC.Session(a.key, 'phone');
  await phone2.welcome((await host2.accept(await phone2.hello()))[1]);
  await assert.rejects(host2.unwrap(await phone.wrap({ type: 'x' })), /./, 'marcos de otra sesión: rechazados');
  // saludo caducado
  const old = new RC.Session(a.key, 'phone');
  const realNow = Date.now; Date.now = () => realNow() - 10 * 60000;
  const stale = await old.hello();
  Date.now = realNow;
  await assert.rejects(new RC.Session(b.key, 'host').accept(stale), /caducado/);
  // emparejamiento
  const code = RC.encodePairing({ host: 'h1', name: 'PC', secret, lan: ['ws://192.168.1.5:47321', 'javascript:alert(1)'], worker: 'https://x.workers.dev', exp: Date.now() + 60000 });
  const p = RC.decodePairing(`https://jeancodeeer.github.io/JeanCode/#pair=${code}`);
  assert.deepEqual(p.lan, ['ws://192.168.1.5:47321'], 'solo URLs ws(s) válidas');
  assert.equal(p.worker, 'https://x.workers.dev');
  assert.throws(() => RC.decodePairing(RC.encodePairing({ host: 'h', secret, exp: Date.now() - 1 })), /caducó/);
  assert.throws(() => RC.decodePairing('basura'), /no es válido/);
});

/** WebSocket simulado: las URLs se resuelven contra `servers` (url → (serverPipe) => void). */
function fakeNet(servers) {
  return class FakeWS {
    constructor(url) {
      this.readyState = 0;
      const route = Object.keys(servers).find((k) => url.startsWith(k));
      setTimeout(() => {
        if (!route) { this.onerror?.(); this.onclose?.(); return; }
        const server = new RL.Pipe('lan');
        server.send = (obj) => setTimeout(() => this.onmessage?.({ data: JSON.stringify(obj) }), 0);
        server.close = () => { this.readyState = 3; this.onclose?.(); server.ended(); };
        this.toServer = (text) => setTimeout(() => server.deliver(text), 0);
        this.serverPipe = server;
        this.readyState = 1;
        servers[route](server, url);
        this.onopen?.();
      }, 1);
    }
    send(text) { this.toServer(text); }
    close() { this.readyState = 3; this.serverPipe?.ended(); this.onclose?.(); }
  };
}

test('remoto: el móvil prueba la Wi-Fi y si no, el relay; mensajes en los dos sentidos y reconexión', async () => {
  const secret = RC.randomBytes(32);
  const { key, room } = await RC.deriveKeys(secret);
  const got = [];
  const acceptor = new RL.HostAcceptor({
    rooms: async (r) => (r === room ? { key, id: 'dev1' } : null),
    onLink: (link, hello) => { got.push(['link', link.kind, hello.name]); link.on('message', (m) => { got.push(['msg', m.type]); link.send({ type: 'echo', of: m.type }); }); },
    RTC: null,
  });
  const lanWS = fakeNet({ 'ws://192.168.1.5:1/r/': (pipe, url) => acceptor.accept(pipe, url.split('/r/')[1]) });
  const link = await RL.phoneConnect({ secret: RC.b64u(secret), lan: ['ws://192.168.1.9:1', 'ws://192.168.1.5:1'] }, { hello: { name: 'Pixel' }, WS: lanWS, p2p: false });
  assert.equal(link.kind, 'lan');
  const echo = new Promise((r) => link.on('message', r));
  await link.send({ type: 'ping' });
  assert.deepEqual(await echo, { type: 'echo', of: 'ping' });
  assert.deepEqual(got.slice(0, 2), [['link', 'lan', 'Pixel'], ['msg', 'ping']]);
  // sala equivocada: el PC no responde
  const wrong = await RC.deriveKeys(RC.randomBytes(32));
  await assert.rejects(RL.phoneConnect({ secret: RC.b64u(RC.randomBytes(32)), lan: ['ws://192.168.1.5:1'] }, { WS: lanWS, p2p: false }).catch((e) => { throw e; }), /./);
  void wrong;
  // sin Wi-Fi: relay por el Worker (una sala con un único tubo hacia el PC, como el Durable Object)
  let hostPipe = null;
  const relayWS = fakeNet({ 'wss://w.example/remote/': (pipe) => { hostPipe = pipe; acceptor.accept(pipe, room); } });
  const r1 = await RL.phoneConnect({ secret: RC.b64u(secret), lan: [], worker: 'https://w.example' }, { hello: { name: 'Pixel' }, WS: relayWS, p2p: false });
  assert.equal(r1.kind, 'relay');
  const e1 = new Promise((r) => r1.on('message', r));
  await r1.send({ type: 'state' });
  assert.equal((await e1).of, 'state');
  assert.ok(hostPipe);
  // aviso del Worker: el móvil se fue → la conexión del PC se cierra
  const closed = new Promise((r) => [...acceptor.links].at(-1).on('close', r));
  hostPipe.deliver(JSON.stringify({ t: 'peer', state: 'leave' }));
  await closed;
  assert.equal(RL.relayUrl('https://w.example', 'abc', 'host', 'k1'), 'wss://w.example/remote/abc?role=host&k=k1');
  await assert.rejects(RL.phoneConnect({ secret: RC.b64u(secret), lan: [] }, { WS: relayWS }), /Worker/);
});

test('remoto: el servidor de la Wi-Fi cierra lo que no se identifica y limita las conexiones por dirección', async () => {
  const lanLib = require('../desktop/lib/remote-lan.js');
  const WS = require('../desktop/node_modules/ws');
  const events = [];
  const lan = lanLib.create({ onEvent: (e) => events.push(e), helloMs: 400 });
  const st = await lan.start(0);
  const url = `ws://127.0.0.1:${st.port}/r/${'a'.repeat(32)}`;
  const open = (u) => new Promise((resolve) => { const ws = new WS(u); ws.on('open', () => resolve(ws)); ws.on('error', () => resolve(ws)); });
  const closedIn = (ws, ms) => new Promise((resolve) => { if (ws.readyState === 3) return resolve(true); const t = setTimeout(() => resolve(false), ms); ws.on('close', () => { clearTimeout(t); resolve(true); }); });
  try {
    const bad = await open(`ws://127.0.0.1:${st.port}/otra-cosa`);
    assert.equal(await closedIn(bad, 1000), true, 'ruta no válida: fuera');
    const a = await open(url), b = await open(url), c = await open(url);
    const d = await open(url);
    assert.equal(await closedIn(d, 1000), true, 'cuarta conexión desde la misma dirección: fuera');
    // la interfaz responde a "a" (saludo válido): queda identificada; b y c no dicen nada y caen solas
    const aOpen = events.find((e) => e.type === 'open');
    lan.send(aOpen.conn, '{"t":"welcome"}');
    assert.equal(await closedIn(b, 1500), true, 'sin identificarse en el plazo: fuera');
    assert.equal(await closedIn(c, 1500), true);
    assert.equal(await closedIn(a, 800), false, 'la identificada sigue abierta');
    assert.equal(lan.status().connections, 1);
    a.close();
  } finally { lan.stop(); }
});

/* ---------------- mini agente del móvil ---------------- */
const MD = await import('../web/js/mobile/device.js');
const MS = await import('../web/js/mobile/shim.js');

test('móvil: rutas confinadas, glob, texto de input y volcado de uiautomator', () => {
  assert.equal(MS.insidePath('/sdcard/JeanCode', 'a/b.txt'), '/sdcard/JeanCode/a/b.txt');
  assert.equal(MS.insidePath('/sdcard/JeanCode', './a/../b'), '/sdcard/JeanCode/b');
  assert.throws(() => MS.insidePath('/sdcard/JeanCode', '../secreto'), /fuera/);
  assert.throws(() => MS.insidePath('/sdcard/JeanCode', '/data/data/x'), /fuera/);
  assert.equal(MS.insidePath('/sdcard/JeanCode', '/sdcard/JeanCode/x'), '/sdcard/JeanCode/x');
  assert.ok(MS.globToRegex('src/**/*.js').test('src/a/b/c.js') && MS.globToRegex('src/**/*.js').test('src/c.js') && !MS.globToRegex('*.js').test('a/b.js'));
  assert.equal(MD.sq("it's $(rm -rf /)"), "'it'\\''s $(rm -rf /)'");
  assert.equal(MS.inputText('hola mundo & $x'), 'hola%smundo%s\\&%s\\$x');
  const xml = '<hierarchy><node text="" content-desc="Ajustes" class="android.widget.ImageView" package="p" clickable="true" bounds="[0,0][100,100]"/><node text="Wi&#39;Fi &amp; red" resource-id="android:id/title" class="android.widget.TextView" clickable="false" bounds="[10,200][310,260]"/><node class="android.widget.EditText" text="" clickable="true" bounds="[0,300][1080,400]"/><node class="x" bounds="[5,5][5,5]"/></hierarchy>';
  const nodes = MS.parseUiDump(xml);
  assert.equal(nodes.length, 3);
  assert.deepEqual([nodes[0].desc, nodes[0].x, nodes[0].y], ['Ajustes', 50, 50]);
  assert.equal(nodes[1].text, "Wi'Fi & red");
  assert.equal(MS.findNode(nodes, { name: 'ajustes' }).id, 1);
  assert.equal(MS.findNode(nodes, { name: 'wi' }).id, 2, 'empieza por');
  assert.equal(MS.findNode(nodes, { name: 'title' }).id, 2, 'por resource-id');
  assert.equal(MS.findNode(nodes, { id: 3 }).editable, true);
});

test('móvil: el agente usa el ayudante del iPhone (Python real) para archivos y comandos, sin inyección', async (t) => {
  const { spawn, execFileSync } = require('node:child_process');
  const fsx = require('node:fs');
  const tmp = mkdtempSync(join(tmpdir(), 'jc-ioshelper-'));
  const port = 47400 + Math.floor(Math.random() * 500);
  const win = process.platform === 'win32';
  const env = { ...process.env, JEANCODE_HELPER_PORT: String(port), JEANCODE_HELPER_TOKEN_FILE: join(tmp, 'token'), JEANCODE_HELPER_SHELL: win ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/sh' };
  const py = win ? 'python' : 'python3';
  const token = execFileSync(py, ['mobile/ios-helper/jeancode_helper.py', '--token'], { env }).toString().trim();
  const proc = spawn(py, ['mobile/ios-helper/jeancode_helper.py'], { env });
  t.after(() => proc.kill());
  await new Promise((r) => proc.stdout.once('data', r));
  const http = (url, body, headers) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => (r.status === 401 ? { error: 'token' } : r.json()));
  const bad = MD.iosBackend({ url: `http://127.0.0.1:${port}`, token: 'x'.repeat(43), http });
  assert.equal((await bad.status()).ready, false, 'sin el token no hay nada');
  const evil = await fetch(`http://127.0.0.1:${port}/exec`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://atacante.example' }, body: '{"cmd":"echo hola"}' });
  assert.equal(evil.status, 403, 'una página web ajena no puede usarlo aunque tuviera el token');
  const dev = MD.iosBackend({ url: `http://127.0.0.1:${port}`, token, http });
  assert.equal((await dev.status()).ready, true);
  // en Windows, Git Bash usa rutas /c/... y Python C:/...: en un iPhone son la misma ruta
  const root = win ? tmp.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, c) => `/${c.toLowerCase()}`) : tmp;
  const sys = (p) => (win ? p.replace(/^\/([a-z])\//, (m, c) => `${c.toUpperCase()}:/`) : p);
  const d = MS.createPhoneDesktop({ ...dev, readFile: (p) => dev.readFile(sys(p)), writeFile: (p, b) => dev.writeFile(sys(p), b) });
  const name = "nota 'rara' $(touch PWNED).txt";
  assert.match(await d.fs.write(root, `docs/${name}`, 'línea 1\nlínea dos'), /Creado/);
  assert.ok(!fsx.existsSync(join(tmp, 'docs', 'PWNED')) && !fsx.existsSync(join(tmp, 'PWNED')), 'el nombre no se ejecutó');
  assert.match(await d.fs.read(root, `docs/${name}`), /2 líneas\)\n {4}1 {2}línea 1\n {4}2 {2}línea dos/);
  assert.match(await d.fs.list(root, 'docs'), /nota 'rara' \$\(touch PWNED\)\.txt {2}\(\d+ B\)/);
  await d.fs.edit(root, `docs/${name}`, 'dos', '2');
  assert.equal(await d.fs.peek(root, `docs/${name}`), 'línea 1\nlínea 2');
  assert.deepEqual(await d.fs.glob(root, '**/*.txt'), [`docs/${name}`]);
  assert.match(await d.fs.search(root, 'línea 2'), /docs\/nota 'rara'.*:2:línea 2/);
  assert.match(await d.shell.run(root, 'echo "$((6*7))"; pwd'), /^\$ echo[^\n]*\n\(salida 0\)\n42\n/);
  await assert.rejects(d.fs.read(root, '../fuera.txt'), /fuera de la carpeta/);
  assert.match(await d.fs.trash(root, `docs/${name}`), /papelera/);
  assert.equal(fsx.readdirSync(join(tmp, '.papelera')).length, 1);
});

test('móvil: webfetch con la red nativa, como el del escritorio, sin direcciones privadas', async () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '[::1]', 'fd00::1', 'impresora.local', '100.64.0.1']) assert.equal(MS.isPrivateHost(h), true, h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'docs.python.org']) assert.equal(MS.isPrivateHost(h), false, h);
  const html = '<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Título</h1><p>Uno &amp; dos</p></body></html>';
  const pages = {
    'https://docs.example.com/x': { status: 200, type: 'text/html', text: html },
    'https://corto.example/r': { status: 302, location: 'http://192.168.1.1/admin' },
    'https://salto.example/a': { status: 301, location: '/b' },
    'https://salto.example/b': { status: 302, location: 'https://docs.example.com/x' },
    'https://bucle.example/': { status: 302, location: 'https://bucle.example/' },
    'https://cuela.example/r': { status: 302, location: 'https://interno.example/' },
  };
  const asked = [];
  const pinned = [];
  const fetchText = async (u, addrs) => { asked.push(u); pinned.push(addrs); return pages[u]; };
  // DNS: interno.example y rebind.nip.io apuntan a direcciones privadas
  const dns = { 'docs.example.com': ['93.184.215.14'], 'corto.example': ['93.184.215.15'], 'salto.example': ['93.184.215.16'], 'bucle.example': ['93.184.215.17'],
    'cuela.example': ['93.184.215.18'], 'interno.example': ['8.8.8.8', '10.0.0.5'], '127.0.0.1.nip.io': ['127.0.0.1'] };
  const resolve = async (h) => dns[h] || [];
  assert.equal(await MS.webfetch('https://docs.example.com/x', fetchText, resolve), '200 https://docs.example.com/x\n\nTítulo\n Uno & dos');
  assert.match(await MS.webfetch('http://192.168.1.1/admin', fetchText, resolve), /redes privadas/);
  assert.match(await MS.webfetch('https://127.0.0.1.nip.io/', fetchText, resolve), /redes privadas: 127\.0\.0\.1\.nip\.io apunta a 127\.0\.0\.1\./, 'un nombre que resuelve a una IP local');
  asked.length = 0;
  assert.match(await MS.webfetch('https://corto.example/r', fetchText, resolve), /redirigió a una dirección privada/);
  assert.deepEqual(asked, ['https://corto.example/r'], 'la dirección privada de la redirección NO se llega a pedir');
  asked.length = 0;
  assert.match(await MS.webfetch('https://cuela.example/r', fetchText, resolve), /interno\.example apunta a 10\.0\.0\.5/, 'basta con UNA dirección privada');
  assert.deepEqual(asked, ['https://cuela.example/r']);
  assert.equal(await MS.webfetch('https://salto.example/a', fetchText, resolve), '200 https://docs.example.com/x\n\nTítulo\n Uno & dos', 'redirecciones públicas: se siguen');
  assert.match(await MS.webfetch('https://bucle.example/', fetchText, resolve), /demasiadas redirecciones/);
  assert.match(await MS.webfetch('https://no-existe.example/', fetchText, resolve), /no existe/);
  assert.match(await MS.webfetch('file:///etc/passwd', fetchText, resolve), /solo http/);
  assert.match(await MS.webfetch('https://x.example', null, resolve), /no está disponible/);
  assert.match(await MS.webfetch('https://yo:clave@docs.example.com/x', fetchText, resolve), /usuario o contraseña/);
  for (const h of ['ff02::1', '64:ff9b::a00:1', '2002:a00:1::1', '198.18.0.1', '192.0.0.8']) assert.equal(MS.isPrivateHost(h), true, h);
  // DNS rebinding: el DNS responde una IP pública al comprobar y una privada después. La petición se conecta a la
  // dirección COMPROBADA (no vuelve a resolver), así que la segunda respuesta nunca se usa.
  let calls = 0;
  const rebind = async () => (calls++ ? ['127.0.0.1'] : ['93.184.215.14']);
  pinned.length = 0;
  pages['https://rebind.example/'] = { status: 200, type: 'text/plain', text: 'pública' };
  assert.equal(await MS.webfetch('https://rebind.example/', fetchText, rebind), '200 https://rebind.example/\n\npública');
  assert.deepEqual(pinned, [['93.184.215.14']], 'la conexión va a la IP comprobada');
  assert.equal(calls, 1, 'el nombre se resuelve una sola vez');
  pinned.length = 0;
  pages['https://8.8.8.8/'] = { status: 200, type: 'text/plain', text: 'ip' };
  await MS.webfetch('https://8.8.8.8/', fetchText, resolve);
  assert.deepEqual(pinned, [['8.8.8.8']], 'una IP escrita en la URL se fija a sí misma');
  assert.match(await MS.webfetch('https://docs.example.com/x', async () => { throw new Error('certificado no válido'); }, resolve), /^ERROR: certificado no válido/);
});

test('escritorio: webfetch se conecta a la IP comprobada (sin DNS rebinding), sin seguir solo las redirecciones', async (t) => {
  const http = require('node:http');
  const zlib = require('node:zlib');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.headers.host} ${req.url}`);
    if (req.url === '/r') { res.writeHead(302, { Location: 'http://127.0.0.1/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync('<p>hola &amp; adiós</p>'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = server.address().port;
  // rebind.invalid no existe en ningún DNS: si llega al servidor, es que la conexión usó la IP fijada
  const r = await tools.pinnedGet(new URL(`http://rebind.invalid:${port}/p?q=1`), [{ address: '127.0.0.1', family: 4 }]);
  assert.equal(r.status, 200);
  assert.equal(r.text, '<p>hola &amp; adiós</p>', 'gzip descomprimido');
  assert.deepEqual(seen, [`rebind.invalid:${port} /p?q=1`], 'Host con el nombre real, conexión a la IP fijada');
  const red = await tools.pinnedGet(new URL(`http://rebind.invalid:${port}/r`), [{ address: '127.0.0.1', family: 4 }]);
  assert.equal(red.status, 302);
  assert.equal(red.location, 'http://127.0.0.1/', 'las redirecciones no se siguen solas');
  // webfetch: un nombre que resuelve a una IP privada (o con UNA privada entre varias) no se abre
  const lookup = async (h) => ({ 'interno.example': [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }] })[h] || [{ address: '127.0.0.1', family: 4 }];
  await assert.rejects(tools.webfetch(`http://local.example:${port}/p`, { lookup }), /red local o privada/);
  await assert.rejects(tools.webfetch('http://interno.example/', { lookup }), /red local o privada/);
  await assert.rejects(tools.webfetch(`http://127.0.0.1:${port}/p`), /red local o privada/);
  await assert.rejects(tools.webfetch('http://yo:clave@example.com/'), /usuario o contraseña/);
});

test('móvil: procesos en segundo plano (arrancar, salida, código de salida y parar el grupo)', async (t) => {
  const { spawn, execFileSync } = require('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'jc-proc-'));
  const port = 47900 + Math.floor(Math.random() * 90);
  const win = process.platform === 'win32';
  const env = { ...process.env, JEANCODE_HELPER_PORT: String(port), JEANCODE_HELPER_TOKEN_FILE: join(tmp, 'token'), JEANCODE_HELPER_SHELL: win ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/sh' };
  const py = win ? 'python' : 'python3';
  const token = execFileSync(py, ['mobile/ios-helper/jeancode_helper.py', '--token'], { env }).toString().trim();
  const helper = spawn(py, ['mobile/ios-helper/jeancode_helper.py'], { env });
  t.after(() => helper.kill());
  await new Promise((r) => helper.stdout.once('data', r));
  const http = (url, body, headers) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
  const dev = MD.iosBackend({ url: `http://127.0.0.1:${port}`, token, http });
  const d = MS.createPhoneDesktop(dev);
  const root = win ? tmp.replace(/\\/g, '/') : tmp; // C:/… vale para bash (Git) y para Python
  const started = await d.proc.start(root, 'i=0; while true; do echo "tick$i"; i=$((i+1)); sleep 0.3; done');
  assert.match(started, /^p1 iniciado: .*\ntick0/);
  await new Promise((r) => setTimeout(r, 1200));
  const out = await d.proc.output('p1');
  assert.match(out, /^p1 \(en marcha\)/);
  assert.ok((out.match(/tick\d+/g) || []).length >= 5, 'la salida sigue llegando');
  assert.match(await d.proc.stop('p1'), /^p1 detenido\./);
  assert.match(await d.proc.output('p1'), /^ERROR: no hay ningún proceso p1/);
  const quick = await d.proc.start(root, 'echo listo; exit 3');
  assert.match(quick, /^p2 iniciado: .*\n\(terminó enseguida, salida 3\)\nlisto$/);
  assert.match(await d.proc.output('p2'), /^p2 \(terminado, salida 3\)/);
  // DNS real a través del ayudante (webfetch comprueba cada dirección antes de pedir)
  assert.ok((await dev.resolve('localhost')).some((a) => a === '127.0.0.1' || a === '::1'));
  await assert.rejects(dev.resolve('no-existe.invalid'), /no se pudo resolver/);
  // /fetch del ayudante: se conecta a la IP fijada (rebind.invalid no existe en el DNS) y no sigue redirecciones
  const seen = [];
  const web = require('node:http').createServer((req, res) => {
    seen.push(`${req.headers.host} ${req.url}`);
    if (req.url === '/r') { res.writeHead(302, { Location: 'http://10.0.0.1/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Encoding': 'gzip' });
    res.end(require('node:zlib').gzipSync('página fijada'));
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  t.after(() => web.close());
  const wp = web.address().port;
  const got = await dev.fetch(`http://rebind.invalid:${wp}/x?a=1`, ['127.0.0.1']);
  assert.deepEqual([got.status, got.text, got.type], [200, 'página fijada', 'text/plain; charset=utf-8']);
  assert.deepEqual(seen, [`rebind.invalid:${wp} /x?a=1`]);
  const moved = await dev.fetch(`http://rebind.invalid:${wp}/r`, ['127.0.0.1']);
  assert.deepEqual([moved.status, moved.location], [302, 'http://10.0.0.1/']);
  await assert.rejects(dev.fetch(`http://rebind.invalid:${wp}/x`, ['localhost']), /dirección no válida/, 'solo IP, nunca nombres');
  await assert.rejects(dev.fetch(`http://rebind.invalid:${wp}/x`, []), /sin direcciones/);
  // el flujo completo: webfetch resuelve, comprueba y fija; localhost se rechaza antes de pedir
  assert.match(await d.web.fetch(`http://localhost:${wp}/x`), /redes privadas/);
});

test('móvil: pantalla del iPhone (jeancode-hid y uiopen): coordenadas, escapes y apps', async () => {
  const cmds = [];
  const dev = {
    exec: async (cmd) => {
      cmds.push(cmd);
      if (cmd === 'jeancode-hid size') return { code: 0, out: '390 844 3\n', err: '' };
      if (cmd.startsWith('uicache -l')) return { code: 0, out: 'com.apple.Preferences : /Applications/Preferences.app\ncom.apple.mobilesafari : /Applications/MobileSafari.app\n', err: '' };
      return { code: 0, out: '', err: '' };
    },
    screenshot: async () => ({ b64: 'AAAA', mime: 'image/jpeg', width: 540, height: 1169 }),
  };
  const s = MS.createIosScreen(dev, { permit: async () => true });
  await s.refresh();
  assert.equal(s.screen.modelHeight, 1169, '390×844 puntos → 540×1169 en el modelo');
  assert.equal((await s.act('screenshot')).image, 'data:image/jpeg;base64,AAAA');
  await s.act('mouse_click', { x: 270, y: 584 });
  assert.equal(cmds.at(-1), 'jeancode-hid tap 195.0 421.6', 'el centro de la captura es el centro de la pantalla en puntos');
  await s.act('type_text', { text: "hola 'mundo' $(reboot)" });
  assert.equal(cmds.at(-1), `jeancode-hid text 'hola '\\''mundo'\\'' $(reboot)'`, 'el texto va entre comillas: no se ejecuta');
  await s.act('key_press', { keys: ['home'] });
  assert.equal(cmds.at(-1), 'jeancode-hid key home');
  assert.match(await s.act('key_press', { keys: ['ctrl', 'c'] }), /solo hay teclas sueltas/);
  await s.act('open_application', { target: 'Safari' });
  assert.equal(cmds.at(-1), "uiopen --bundleid 'com.apple.mobilesafari'", 'por nombre, con la lista de uicache');
  await s.act('open_application', { target: 'https://example.com' });
  assert.equal(cmds.at(-1), "uiopen 'https://example.com'");
  assert.match(await s.act('inspect_screen'), /no se pueden leer los controles/);
  const broken = MS.createIosScreen({ exec: async () => ({ code: 4, out: '', err: 'falta IOHIDEventSystemClientCreate en esta versión de iOS' }), screenshot: async () => null }, {});
  assert.match(await broken.act('mouse_click', { x: 1, y: 1 }), /ERROR: jeancode-hid: falta IOHIDEventSystemClientCreate/, 'si el binario falla, el agente recibe el motivo');
});

/* ------------------------------------------------------------------ imagen y vídeo */
test('imagen y vídeo: qué modelos sirven y no se cuelan en el chat', () => {
  const ep = (provider) => ({ id: provider, url: 'https://x.example/v1', key: 'k', provider });
  for (const id of ['gpt-image-2', 'black-forest-labs/FLUX.1-schnell', 'grok-imagine-image-2.0', 'gemini-3.1-flash-image', 'Qwen/Qwen-Image', 'image-01']) {
    assert.equal(ME.mediaKindOf(ep('openai'), id), 'image', id);
    assert.equal(CAP.capsOf(ep('openai'), id).chat, false, id);
  }
  for (const id of ['MiniMax-H3', 'grok-imagine-video-1.5', 'Wan-AI/Wan2.2-T2V-A14B', 'bytedance/seedance-2.5', 'kling-v2']) assert.equal(ME.mediaKindOf(ep('together'), id), 'video', id);
  for (const id of ['gpt-5', 'claude-sonnet', 'gemini-2.5-pro', 'jean-marvel', 'qwen3-coder', 'wandb-helper']) { assert.equal(ME.mediaKindOf(ep('openai'), id), null, id); assert.notEqual(CAP.capsOf(ep('openai'), id).chat, false, id); }
  assert.equal(ME.protocolOf(ep('openai'), 'video'), 'openai');
  assert.equal(ME.protocolOf(ep('deepinfra'), 'video'), 'generic', 'lo no catalogado usa el formato de OpenAI');
  assert.equal(ME.protocolOf(ep('anthropic'), 'image'), null);
  assert.equal(ME.protocolOf(ep('custom'), 'image'), 'generic');
  assert.deepEqual(ME.controlsFor(ep('openai'), 'gpt-image-1.5', 'image').ratios, ['1:1', '3:2', '2:3']);
  assert.ok(ME.controlsFor(ep('openai'), 'gpt-image-2.6-sunburst', 'image').ratios.includes('16:9'), 'la familia nueva admite medidas libres');
  assert.equal(ME.controlsFor(ep('openai'), 'gpt-image-2', 'image').mask, true);
  assert.equal(ME.controlsFor(ep('together'), 'x', 'image').negative, true);
  assert.equal(ME.controlsFor(ep('xai'), 'grok-imagine-video', 'video').resolutions.includes('1080p'), false);
  assert.deepEqual(ME.sizeFor('16:9'), { width: 1360, height: 768 });
});

test('imagen: cada proveedor recibe su formato y se entiende su respuesta', async () => {
  const run = async (provider, req, reply, url = 'https://api.example/v1') => {
    const calls = [];
    const net = { ep: { id: 'e', url, key: 'K', provider }, call: async (path, o = {}) => { calls.push({ path, ...o }); return reply; } };
    return { items: await ME.generateImage({ kind: 'image', model: 'm', prompt: 'gato', ratio: '16:9', count: 1, ...req }, net), call: calls[0] };
  };
  const png = 'iVBORw0KGgo=';
  let r = await run('openai', { ratio: '3:2', quality: 'high' }, { data: [{ b64_json: png }] });
  assert.equal(r.call.path, '/images/generations');
  assert.deepEqual([r.call.body.size, r.call.body.quality, r.items[0].b64], ['1536x1024', 'high', png]);
  r = await run('openai', { ratio: '1:1', refs: ['data:image/png;base64,AA'], mask: 'data:image/png;base64,BB' }, { data: [{ b64_json: png }] });
  assert.equal(r.call.path, '/images/edits');
  assert.deepEqual(r.call.body.images, [{ image_url: 'data:image/png;base64,AA' }]);
  assert.deepEqual(r.call.body.mask, { image_url: 'data:image/png;base64,BB' });
  r = await run('openrouter', { resolution: '2K', seed: '7', refs: ['data:image/png;base64,AA'] }, { data: [{ b64_json: png }] });
  assert.equal(r.call.path, '/images');
  assert.deepEqual([r.call.body.aspect_ratio, r.call.body.resolution, r.call.body.seed], ['16:9', '2K', 7]);
  assert.equal(r.call.body.input_references[0].image_url.url, 'data:image/png;base64,AA');
  r = await run('together', { negative: 'borroso', steps: '20' }, { data: [{ index: 0, url: 'https://cdn.example/a.png', type: 'url' }] });
  assert.deepEqual([r.call.body.width, r.call.body.height, r.call.body.negative_prompt, r.call.body.steps], [1360, 768, 'borroso', 20]);
  assert.equal(r.items[0].url, 'https://cdn.example/a.png');
  r = await run('siliconflow', {}, { images: [{ url: 'https://cdn.example/b.png' }] });
  assert.equal(r.call.body.image_size, '1360x768');
  assert.equal(r.items[0].url, 'https://cdn.example/b.png');
  r = await run('minimax', {}, { data: { image_base64: [png] }, base_resp: { status_code: 0 } });
  assert.deepEqual([r.call.path, r.call.body.response_format, r.items[0].b64], ['/image_generation', 'base64', png]);
  await assert.rejects(run('minimax', {}, { base_resp: { status_code: 1026, status_msg: 'contenido sensible' } }), /contenido sensible/);
  r = await run('gemini', { resolution: '2K' }, { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }, { type: 'image', data: png }] }] }, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(r.call.base, 'https://generativelanguage.googleapis.com/v1beta');
  assert.deepEqual(r.call.auth, { 'x-goog-api-key': 'K' });
  assert.deepEqual(r.call.body.response_format, { type: 'image', aspect_ratio: '16:9', image_size: '2K' });
  assert.equal(r.items[0].b64, png);
  await assert.rejects(run('openai', {}, { data: [] }), /filtro de contenido/);
  // una API genérica que rechaza un parámetro opcional: se repite sin él
  const seen = [];
  const net = { ep: { id: 'e', url: 'http://localhost:9/v1', key: 'k', provider: 'custom' }, call: async (_p, o) => {
    seen.push(Object.keys(o.body));
    if ('negative_prompt' in o.body) throw Object.assign(new Error('unknown field negative_prompt'), { status: 400 });
    return { data: [{ b64_json: png }] };
  } };
  await ME.generateImage({ kind: 'image', model: 'm', prompt: 'x', ratio: '1:1', count: 1, negative: 'y' }, net);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].includes('negative_prompt'), false);
});

test('vídeo: crear y seguir el trabajo en cada proveedor', async () => {
  const flow = async (provider, url, submitReply, polls, req = {}) => {
    const calls = [];
    let i = 0;
    const net = { ep: { id: 'e', url, key: 'K', provider }, call: async (path, o = {}) => { calls.push({ path, ...o }); return calls.length === 1 ? submitReply : polls[Math.min(i++, polls.length - 1)]; } };
    const ref = await ME.submitVideo({ kind: 'video', model: 'm', prompt: 'olas', ratio: '16:9', duration: 6, resolution: '720p', ...req }, net);
    let st = await ME.pollVideo(ref, net);
    while (!st.done) st = await ME.pollVideo(ref, net);
    return { ref, st, calls };
  };
  let f = await flow('openrouter', 'https://openrouter.ai/api/v1', { id: 'j1', status: 'pending' }, [{ status: 'in_progress' }, { status: 'completed', unsigned_urls: ['https://openrouter.ai/api/v1/videos/j1/content?index=0'] }], { start: 'data:image/png;base64,AA', audio: false });
  assert.deepEqual(f.calls[0].body.frame_images[0].frame_type, 'first_frame');
  assert.equal(f.calls[0].body.generate_audio, false);
  assert.deepEqual(f.st.items[0], { url: 'https://openrouter.ai/api/v1/videos/j1/content?index=0', auth: true, mime: 'video/mp4' });
  f = await flow('xai', 'https://api.x.ai/v1', { request_id: 'r1' }, [{ status: 'pending' }, { status: 'done', video: { url: 'https://vidgen.x.ai/a.mp4' } }]);
  assert.equal(f.calls[0].path, '/videos/generations');
  assert.equal(f.st.items[0].url, 'https://vidgen.x.ai/a.mp4');
  f = await flow('together', 'https://api.together.xyz/v1', { id: 't1' }, [{ status: 'in_progress' }, { status: 'completed', outputs: { video_url: 'https://cdn/t.mp4' } }]);
  assert.equal(f.calls[0].base, 'https://api.together.xyz/v2');
  assert.equal(f.calls[0].body.seconds, '6');
  f = await flow('siliconflow', 'https://api.siliconflow.com/v1', { requestId: 's1' }, [{ status: 'InQueue' }, { status: 'Succeed', results: { videos: [{ url: 'https://cdn/s.mp4' }] } }]);
  assert.deepEqual(f.calls[1].body, { requestId: 's1' });
  f = await flow('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', { name: 'models/veo/operations/o1' }, [{ done: false }, { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/a:download' } }] } } }]);
  assert.equal(f.calls[0].path, '/models/m:predictLongRunning');
  assert.equal(f.calls[0].body.parameters.durationSeconds, '6');
  assert.equal(f.calls[1].path, '/models/veo/operations/o1');
  assert.deepEqual(f.st.items[0].auth, { 'x-goog-api-key': true });
  f = await flow('minimax', 'https://api.minimax.io/v1', { task_id: 'm1' }, [{ task: { status: 'running' } }, { task: { status: 'succeeded', content: { url: 'https://cdn/m.mp4' } } }], { resolution: '768P' });
  assert.equal(f.calls[0].base, 'https://api.minimax.io/v2');
  assert.deepEqual(f.calls[0].body.content[0], { type: 'text', text: 'olas' });
  f = await flow('xai', 'https://api.x.ai/v1', { request_id: 'r2' }, [{ status: 'failed', error: 'bloqueado' }]);
  assert.equal(f.st.error, 'bloqueado');
  const gone = Object.assign(new Error('gone'), { status: 410 });
  await assert.rejects(ME.submitVideo({ model: 'sora-2', prompt: 'x' }, { ep: { id: 'e', url: 'https://api.openai.com/v1', key: 'k', provider: 'openai' }, call: async () => { throw gone; } }), /cerró su API de vídeo/);
  f = await flow('openai', 'https://pasarela.example/v1', { id: 'v9' }, [{ status: 'in_progress' }, { status: 'completed' }], { model: 'sora-2' });
  assert.deepEqual(f.st.items[0], { url: 'https://pasarela.example/v1/videos/v9/content', auth: true, mime: 'video/mp4' }, 'las pasarelas compatibles siguen funcionando');
});

test('imagen y vídeo: pedirlo en el chat sin confundir preguntas de programación', () => {
  const yes = [
    ['genera una imagen de un faro al amanecer', 'image', 'un faro al amanecer'],
    ['Por favor, créame una foto de un gato con gafas', 'image', 'un gato con gafas'],
    ['hazme un logo de una cafetería minimalista', 'image', 'logo de una cafetería minimalista'],
    ['Dibuja un retrato de una astronauta', 'image', 'retrato de una astronauta'],
    ['create an image of a red fox', 'image', 'a red fox'],
    ['genera un vídeo de olas a cámara lenta', 'video', 'olas a cámara lenta'],
    ['¿me puedes crear una animación de un cohete despegando?', 'video', 'un cohete despegando'],
  ];
  for (const [t, kind, prompt] of yes) assert.deepEqual(ME.detectMediaIntent(t), { kind, prompt }, t);
  for (const t of ['crea una imagen de docker para node', 'genera una imagen en base64 con python', '¿cómo creo una imagen de disco?', 'explica cómo generar un vídeo con ffmpeg', 'haz un script que descargue imágenes', 'qué modelo genera imágenes', 'crea un componente de video en react', '/imagen hola'])
    assert.equal(ME.detectMediaIntent(t), null, t);
  const last = { kind: 'image' };
  assert.deepEqual(ME.detectMediaIntent('hazla más azul', { last }), { kind: 'image', prompt: 'hazla más azul', from: 'edit' });
  assert.deepEqual(ME.detectMediaIntent('ahora anímala', { last }), { kind: 'video', prompt: 'ahora anímala', from: 'animate' });
  assert.equal(ME.detectMediaIntent('hazla más azul'), null, 'sin imagen previa no hay nada que editar');
});

test('imagen: prompts guiados, variantes y retoque local', () => {
  assert.deepEqual(ME.expandPrompt('un coche {rojo|azul} en {París|Lima}'), ['un coche rojo en París', 'un coche rojo en Lima', 'un coche azul en París', 'un coche azul en Lima']);
  assert.deepEqual(ME.expandPrompt('sin variantes'), ['sin variantes']);
  assert.equal(ME.expandPrompt('{a|b|c} {d|e|f} {g|h|i}').length, 8, 'con tope: cada variante cuesta');
  assert.equal(ME.composePrompt({ subject: 'un zorro', action: 'corriendo', place: 'en la nieve', style: 'óleo', light: 'hora dorada' }), 'un zorro, corriendo. en la nieve. Estilo: óleo. Luz: hora dorada');
  assert.equal(ME.composePrompt({}), '');
  const px = new Uint8ClampedArray([100, 150, 200, 255]);
  MX.applyAdjust(px, {});
  assert.deepEqual([...px], [100, 150, 200, 255], 'sin cambios: los píxeles quedan igual');
  const gray = new Uint8ClampedArray([100, 150, 200, 128]);
  MX.applyAdjust(gray, { saturation: -100 });
  assert.equal(gray[0], gray[1]);
  assert.equal(gray[1], gray[2]);
  assert.equal(gray[3], 128, 'el alfa no se toca');
  const light = new Uint8ClampedArray([100, 100, 100, 255]);
  MX.applyAdjust(light, { brightness: 50 });
  assert.ok(light[0] > 150);
  assert.deepEqual(MX.cropRect({ x: 10, y: 10 }, { x: 210, y: 110 }, 400, 400, 'free'), { x: 10, y: 10, width: 200, height: 100 });
  assert.deepEqual(MX.cropRect({ x: 210, y: 110 }, { x: 10, y: 10 }, 400, 400, '1:1'), { x: 10, y: 10, width: 100, height: 100 });
  assert.deepEqual(MX.cropRect({ x: -50, y: 0 }, { x: 999, y: 999 }, 300, 200, 'free'), { x: 0, y: 0, width: 300, height: 200 });
});

test('imagen: la clave solo viaja al origen de la API', async (t) => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => { seen.push([String(url), o.headers]); return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); };
  t.after(() => { globalThis.fetch = realFetch; });
  const ep = { id: 'e', url: 'https://openrouter.ai/api/v1', key: 'SECRETA', provider: 'openrouter' };
  await API.fetchMediaBlob(ep, 'https://openrouter.ai/api/v1/videos/j/content', { auth: true });
  assert.equal(seen[0][1].Authorization, 'Bearer SECRETA');
  await API.fetchMediaBlob(ep, 'https://cdn.ajeno.example/v.mp4', { auth: true });
  assert.deepEqual(seen[1][1], {}, 'una URL de otro dominio no recibe la clave');
  for (const x of ['http://192.168.1.1/x.png', 'http://169.254.169.254/latest', 'http://[::1]/x', 'http://[fd00::1]/x', 'http://2130706433/x', 'http://0x7f.1/x', 'http://impresora.local/x', 'http://localhost./x', 'http://[::ffff:127.0.0.1]/x']) await assert.rejects(API.fetchMediaBlob(ep, x), /red local/, x);
  for (const x of ['http://usuario@127.0.0.1/x', 'http://a:b@192.168.1.1/x', 'https://a:b@cdn.example/x']) await assert.rejects(API.fetchMediaBlob(ep, x), /no válida/, x);
  assert.equal(API.isPrivateTarget('https://cdn.example/v.mp4'), false);
  assert.equal(API.isPrivateTarget('http://8.8.8.8/'), false);
  await assert.rejects(API.fetchMediaBlob(ep, 'file:///etc/passwd'), /no válida/);
  await assert.rejects(API.fetchMediaBlob(ep, 'javascript:alert(1)'), /no válida/);
});

test('escritorio: writeBinary guarda dentro de la carpeta y nunca pisa un archivo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-bin-'));
  const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  assert.match(await tools.writeBinary(root, 'generated/a.png', b64), /generated\/a\.png/);
  assert.deepEqual([...require('node:fs').readFileSync(join(root, 'generated', 'a.png'))], [0x89, 0x50, 0x4e, 0x47]);
  await assert.rejects(tools.writeBinary(root, 'generated/a.png', b64), /EEXIST/);
  await assert.rejects(tools.writeBinary(root, '../fuera.png', b64), /fuera/);
});

test('escritorio: una carpeta enlazada no saca las escrituras de la carpeta de trabajo', async (t) => {
  const fsx = require('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'jc-link-'));
  const out = mkdtempSync(join(tmpdir(), 'jc-out-'));
  try { symlinkSync(out, join(root, 'salida'), 'junction'); symlinkSync(join(out, 'nada.png'), join(root, 'roto.png')); } catch { t.skip('este sistema no permite crear enlaces'); return; }
  const b64 = Buffer.from('x').toString('base64');
  await assert.rejects(tools.writeBinary(root, 'salida/nueva/a.png', b64), /enlace fuera/);
  await assert.rejects(tools.write(root, 'salida/b.txt', 'x'), /enlace fuera/);
  await assert.rejects(tools.writeBinary(root, 'roto.png', b64), /enlace fuera/);
  assert.deepEqual(fsx.readdirSync(out), []);
  assert.match(await tools.writeBinary(root, 'bien/c.png', b64), /c\.png/);
});

test('escritorio: la descarga de resultados comprueba cada salto y corta al pasar del tope', async (t) => {
  const http = require('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push([req.url, req.headers.host, req.headers.authorization]);
    if (req.url === '/mismo') { res.writeHead(302, { Location: '/fin' }); return res.end(); }
    if (req.url === '/fuera') { res.writeHead(302, { Location: `http://ajeno.invalid:${server.address().port}/fin` }); return res.end(); }
    if (req.url === '/interno') { res.writeHead(302, { Location: 'http://interno.invalid/secreto' }); return res.end(); }
    if (req.url === '/grande') { res.writeHead(200); res.write(Buffer.alloc(4096)); res.write(Buffer.alloc(4096)); return; } // sin cabecera de tamaño y sin terminar
    res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const check = async (u) => { if (u.hostname === 'interno.invalid') throw new Error('destino no permitido'); return [{ address: '127.0.0.1', family: 4 }]; };
  const headers = { Authorization: 'Bearer SECRETA' };
  let r = await tools.downloadBinary(`http://api.invalid:${port}/mismo`, { headers, check });
  assert.equal(r.data.toString(), 'ok');
  assert.equal(seen.at(-1)[2], 'Bearer SECRETA', 'mismo origen: conserva la clave');
  r = await tools.downloadBinary(`http://api.invalid:${port}/fuera`, { headers, check });
  assert.equal(seen.at(-1)[2], undefined, 'otro origen: la clave no viaja');
  await assert.rejects(tools.downloadBinary(`http://api.invalid:${port}/interno`, { check }), /no permitido/);
  await assert.rejects(tools.downloadBinary(`http://api.invalid:${port}/grande`, { check, max: 1024 }), /pasa de/);
  await assert.rejects(tools.downloadBinary(`http://127.0.0.1:${port}/fin`), /red local o privada/);
  assert.equal((await tools.downloadBinary(`http://127.0.0.1:${port}/fin`, { publicOnly: false })).status, 200);
});

test('imagen: NVIDIA, Hugging Face, Alibaba, Z.ai y la familia nueva de OpenAI', async () => {
  const run = async (provider, req, reply, url = 'https://api.example/v1') => {
    const calls = [];
    const net = { ep: { id: 'e', url, key: 'K', provider }, call: async (path, o = {}) => { calls.push({ path, ...o }); return reply; }, bytes: async (path, o = {}) => { calls.push({ path, ...o }); return reply; } };
    return { items: await ME.generateImage({ kind: 'image', model: 'm', prompt: 'gato', ratio: '16:9', count: 1, ...req }, net), call: calls[0], calls };
  };
  const nv = { id: 'nv', url: 'https://integrate.api.nvidia.com/v1', key: 'k', provider: 'nvidia' };
  assert.ok(ME.knownModels(nv).some((m) => m.id === 'black-forest-labs/flux.1-dev' && m.kind === 'image'), 'su /models no los lista');
  assert.equal(ME.mediaKindOf(nv, 'black-forest-labs/flux.1-dev'), 'image');
  let r = await run('nvidia', { model: 'black-forest-labs/flux.1-dev', steps: '30', guidance: '4' }, { artifacts: [{ base64: 'QUJD', finishReason: 'SUCCESS' }] });
  assert.equal(r.call.base, 'https://ai.api.nvidia.com/v1/genai');
  assert.equal(r.call.path, '/black-forest-labs/flux.1-dev');
  assert.deepEqual(r.call.body, { prompt: 'gato', width: 1344, height: 768, steps: 30, cfg_scale: 4 });
  assert.deepEqual(r.items[0], { b64: 'QUJD', mime: 'image/jpeg' });
  await assert.rejects(run('nvidia', { model: 'x/flux.1-dev' }, { artifacts: [{ base64: '', finishReason: 'CONTENT_FILTERED' }] }), /filtro de contenido/);
  await assert.rejects(run('nvidia', { model: 'x/flux.1-kontext-dev' }, {}), /imagen de referencia/);
  r = await run('nvidia', { model: 'x/flux.2-klein-4b', refs: ['data:image/png;base64,AA'] }, { artifacts: [{ base64: 'QUJD' }] });
  assert.equal(r.call.body.mode, 'Image Editing');
  // NVIDIA rechaza con 422 los campos que no conoce: se repite sin ellos
  const seen = [];
  await ME.generateImage({ kind: 'image', model: 'x/nuevo', prompt: 'p', ratio: '1:1', seed: '5' }, { ep: nv, call: async (_p, o) => {
    seen.push(o.body);
    if ('seed' in o.body) throw Object.assign(new Error('extra field seed not permitted'), { status: 422 });
    return { artifacts: [{ base64: 'QUJD' }] };
  } });
  assert.equal(seen.length, 2);
  const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
  r = await run('huggingface', { model: 'org/modelo', negative: 'n' }, blob);
  assert.equal(r.call.base, 'https://router.huggingface.co/hf-inference');
  assert.deepEqual([r.call.path, r.call.body.inputs, r.call.body.parameters.negative_prompt], ['/models/org/modelo', 'gato', 'n']);
  assert.equal(r.items[0].blob, blob);
  r = await run('dashscope', {}, { output: { choices: [{ message: { content: [{ image: 'https://oss.example/a.png' }] } }] } }, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  assert.equal(r.call.base, 'https://dashscope-intl.aliyuncs.com/api/v1');
  assert.match(r.call.body.parameters.size, /^\d+\*\d+$/);
  assert.equal(r.items[0].url, 'https://oss.example/a.png');
  r = await run('zai', { quality: 'hd' }, { data: [{ url: 'https://cdn.example/z.png' }] });
  assert.deepEqual([r.call.body.size, r.call.body.quality], ['1728x960', 'hd']);
  r = await run('openai', { model: 'gpt-image-2.6-sunburst', resolution: '2K', quality: 'xhigh' }, { data: [{ b64_json: 'QUJD' }] });
  assert.deepEqual([r.call.body.size, r.call.body.quality], ['2736x1536', 'xhigh']);
  r = await run('xai', { resolution: '2k' }, { data: [{ b64_json: 'QUJD' }] });
  assert.equal(r.call.body.resolution, '2k');
  await assert.rejects(ME.generateImage({ kind: 'image', model: 'm', prompt: 'p', ratio: '1:1' }, { ep: { id: 'e', url: 'https://x.example/v1', key: 'k', provider: 'fireworks' }, call: async () => { throw Object.assign(new Error('404'), { status: 404, detail: '' }); } }), /no tiene una API de imágenes/);
});

test('vídeo: Alibaba y Z.ai', async () => {
  let calls = [];
  let replies = [{ output: { task_id: 't1' } }, { output: { task_status: 'RUNNING' } }, { output: { task_status: 'SUCCEEDED', video_url: 'https://oss.example/v.mp4' } }];
  let net = { ep: { id: 'e', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', key: 'K', provider: 'dashscope' }, call: async (p, o = {}) => { calls.push({ p, ...o }); return replies.shift(); } };
  const ref = await ME.submitVideo({ model: 'wan2.7-t2v', prompt: 'mar', ratio: '16:9', resolution: '720P', duration: 5 }, net);
  assert.deepEqual(calls[0].headers, { 'X-DashScope-Async': 'enable' });
  assert.deepEqual(calls[0].body.parameters, { resolution: '720P', ratio: '16:9', duration: 5 });
  assert.equal((await ME.pollVideo(ref, net)).done, false);
  assert.equal((await ME.pollVideo(ref, net)).items[0].url, 'https://oss.example/v.mp4');
  calls = [];
  replies = [{ id: 'z1', task_status: 'PROCESSING' }, { task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.example/z.mp4' }] }];
  net = { ep: { id: 'e', url: 'https://api.z.ai/api/paas/v4', key: 'K', provider: 'zai' }, call: async (p, o = {}) => { calls.push({ p, ...o }); return replies.shift(); } };
  const z = await ME.submitVideo({ model: 'cogvideox-3', prompt: 'mar', ratio: '9:16', duration: 5, start: 'data:image/png;base64,AA' }, net);
  assert.deepEqual([calls[0].body.size, calls[0].body.image_url], ['1080x1920', 'data:image/png;base64,AA']);
  assert.equal((await ME.pollVideo(z, net)).items[0].url, 'https://cdn.example/z.mp4');
  assert.equal(calls[1].p, '/async-result/z1');
});

test('vídeo HTML: contrato de la composición, aislamiento y MP4', async () => {
  const HV = await import('../web/js/media/htmlvideo.js');
  const { muxMp4 } = await import('../web/js/media/mp4.js');
  const good = '<div id="stage" data-composition-id="main" data-start="0" data-duration="5" data-width="1920" data-height="1080"><h1 class="clip" data-start="0" data-duration="5">Hola</h1></div><script>const tl = gsap.timeline({ paused: true }); tl.from("h1", { opacity: 0 }); window.__timelines["main"] = tl;</script>';
  assert.deepEqual(HV.lintComposition(good), []);
  const codes = (h) => HV.lintComposition(h).map((x) => x.code);
  assert.ok(codes('<div>hola</div>').includes('root'));
  for (const [snippet, code] of [['<script>Date.now()</script>', 'clock'], ['<script>Math.random()</script>', 'random'], ['<script>setTimeout(f, 1)</script>', 'timers'], ['<script>tl.to("a",{repeat:-1})</script>', 'infinite'], ['<script src="https://cdn.example/x.js"></script>', 'script-src'], ['<link rel="stylesheet" href="x.css">', 'link'], ['<img src="https://x.example/a.png">', 'remote'], ['<video></video>', 'media']])
    assert.ok(codes(good + snippet).includes(code), code);
  assert.equal(HV.extractHtml('Aquí va:\n```html\n<div>x</div>\n```\nListo'), '<div>x</div>');
  assert.equal(HV.extractHtml('no hay nada'), '');
  const doc = HV.buildCompositionDoc(`${good}<script src="https://mal.example/x.js"></script><meta http-equiv="refresh" content="0;url=https://mal.example"><iframe src="https://mal.example"></iframe><base href="https://mal.example/">`, { width: 1920, height: 1080, duration: 5, token: 'tok' });
  assert.match(doc, /default-src 'none'/);
  assert.doesNotMatch(doc, /mal\.example/, 'lo externo se elimina aunque el modelo lo escriba');
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script'), 'la política va antes de cualquier script');
  assert.deepEqual(ME.detectMediaIntent('crea un vídeo en HTML de mi cafetería'), { kind: 'html', prompt: 'crea un vídeo en HTML de mi cafetería' });
  assert.equal(ME.detectMediaIntent('crea una página HTML con un vídeo'), null);
  const samples = [{ data: new Uint8Array([1, 2, 3]), key: true }, { data: new Uint8Array([4, 5]), key: false }];
  const file = muxMp4({ codec: 'avc1', width: 640, height: 360, fps: 30, description: new Uint8Array([1, 100, 0, 40]), samples });
  const text = Buffer.from(file).toString('latin1');
  for (const b of ['ftyp', 'moov', 'mvhd', 'trak', 'avcC', 'stts', 'stss', 'stsz', 'stco', 'mdat']) assert.ok(text.includes(b), b);
  const view = new DataView(file.buffer);
  const stco = text.indexOf('stco');
  const offset = view.getUint32(stco + 12);
  assert.deepEqual([...file.subarray(offset, offset + 5)], [1, 2, 3, 4, 5], 'el índice apunta a los datos');
  assert.throws(() => muxMp4({ codec: 'avc1', width: 2, height: 2, fps: 30, samples: [] }), /no hay fotogramas/);
});

test('android: cada salto de una descarga se resuelve, se comprueba y se fija a su IP', async (t) => {
  const calls = [];
  const dns = { 'cdn.example': ['93.184.215.14'], 'otro.example': ['93.184.215.15'], 'trampa.example': ['8.8.8.8', '10.0.0.7'] };
  const pages = {
    'https://api.example/v1/ok': { status: 302, location: 'https://cdn.example/a.mp4' },
    'https://cdn.example/a.mp4': { status: 200, b64: 'QUJD', type: 'video/mp4' },
    'https://cdn.example/lan': { status: 302, location: 'http://192.168.1.1/secreto' },
    'https://cdn.example/nombre': { status: 302, location: 'https://trampa.example/x' },
  };
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { CapacitorHttp: {}, JeanDevice: {
    resolve: async ({ host }) => ({ addresses: dns[host] || [] }),
    fetch: async (o) => { calls.push(o); return pages[o.url]; },
  } } } };
  t.after(() => { delete globalThis.window; });
  const ep = { id: 'e', url: 'https://api.example/v1', key: 'SECRETA', provider: 'custom' };
  dns['api.example'] = ['93.184.215.20'];
  const blob = await API.fetchMediaBlob(ep, 'https://api.example/v1/ok', { auth: true });
  assert.equal(await blob.text(), 'ABC');
  assert.deepEqual(calls.map((c) => c.addresses), [['93.184.215.20'], ['93.184.215.14']], 'cada salto va a la IP comprobada');
  assert.equal(calls[0].headers.Authorization, 'Bearer SECRETA');
  assert.deepEqual(calls[1].headers, {}, 'la clave no cambia de origen');
  calls.length = 0;
  await assert.rejects(API.fetchMediaBlob(ep, 'https://cdn.example/lan'), /red local/);
  assert.equal(calls.length, 1, 'la dirección privada no se llega a pedir');
  calls.length = 0;
  await assert.rejects(API.fetchMediaBlob(ep, 'https://cdn.example/nombre'), /red local/);
  assert.equal(calls.length, 1, 'basta con UNA dirección privada entre las que resuelve');
});
