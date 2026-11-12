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

test('automatizaciones: calendario, tareas pendientes y /loop', async () => {
  const AU = await import('../web/js/automations.js');
  const lunes9 = new Date(2026, 10, 9, 9, 0).getTime(); // lunes 9 nov 2026, 09:00
  assert.equal(AU.nextRun({ kind: 'every', minutes: 30 }, lunes9), lunes9 + 30 * 60000);
  assert.equal(AU.nextRun({ kind: 'every', minutes: 1 }, lunes9), lunes9 + 5 * 60000, 'mínimo 5 minutos');
  assert.equal(new Date(AU.nextRun({ kind: 'daily', time: '08:30' }, lunes9)).getDate(), 10, 'las 08:30 ya pasaron: mañana');
  assert.equal(new Date(AU.nextRun({ kind: 'daily', time: '18:00' }, lunes9)).getHours(), 18);
  const viernes20 = new Date(2026, 10, 13, 20, 0).getTime();
  assert.equal(new Date(AU.nextRun({ kind: 'weekdays', time: '09:00' }, viernes20)).getDay(), 1, 'después del viernes, el lunes');
  assert.equal(new Date(AU.nextRun({ kind: 'weekly', time: '09:00' }, lunes9 + 60000)).getDate(), 16, 'el lunes siguiente');
  assert.deepEqual(AU.dueTasks([{ id: 'a', next: 1 }, { id: 'b', next: Date.now() + 1e6 }, { id: 'c', next: 1, enabled: false }]).map((t) => t.id), ['a']);
  assert.equal(AU.parseInterval('10m'), 600000);
  assert.equal(AU.parseInterval('5s'), 60000, 'mínimo 1 minuto');
  assert.equal(AU.parseInterval('mañana'), null);
  assert.throws(() => AU.parseSchedule('daily', ''), /hora/);
});

test('hooks: bloquear con salida 2, aprobar con JSON, contexto, matcher y post_tool', async () => {
  const { createHooks } = await import('../web/js/hooks.js');
  const ran = [];
  const fake = async (command, input) => {
    ran.push([command, input.event, input.tool]);
    if (command === 'bloquea') return { code: 2, stdout: '', stderr: 'no se puede tocar .env' };
    if (command === 'aprueba') return { code: 0, stdout: '{"decision":"allow"}', stderr: '' };
    if (command === 'contexto') return { code: 0, stdout: 'rama: main', stderr: '' };
    if (command === 'falla') return { code: 1, stdout: '', stderr: 'roto' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const H = createHooks([
    { label: 'globales', hooks: { pre_tool: [{ matcher: 'write_file|edit_file', command: 'bloquea' }, { matcher: 'run_command', command: 'aprueba' }], session_start: [{ command: 'contexto' }] } },
    { label: 'proyecto', hooks: { post_tool: [{ command: 'falla' }], post_edit: [{ command: 'fmt {path}' }] } },
  ], fake);
  const b = await H.run('pre_tool', { tool: 'write_file', args: {} });
  assert.equal(b.blocked, true);
  assert.equal(b.reason, 'no se puede tocar .env');
  assert.equal((await H.run('pre_tool', { tool: 'run_command' })).allow, true);
  assert.equal((await H.run('pre_tool', { tool: 'read_file' })).blocked, false, 'el matcher no coincide');
  assert.equal((await H.run('pre_tool', { tool: 'xwrite_file' })).blocked, false, 'el matcher es exacto');
  assert.equal((await H.run('session_start', {})).context, 'rama: main');
  assert.match((await H.run('post_tool', { tool: 'x' })).notes[0], /salida 1/);
  assert.match((await H.run('post_edit', { path: 'a; rm -rf /' })).notes[0], /omitido/);
  await H.run('post_edit', { path: 'src/a.js' });
  assert.deepEqual(ran.at(-1), ['fmt src/a.js', 'post_edit', undefined]);
  assert.equal(H.has('stop'), false);
});

test('agente + hooks: pre_tool bloquea la herramienta, stop obliga a seguir', async () => {
  const blocked = [];
  const hooks = {
    has: (e) => e === 'pre_tool' || e === 'stop',
    run: async (e, p) => {
      if (e === 'pre_tool') { blocked.push(p.tool); return { blocked: p.tool === 'run_command', reason: 'comandos prohibidos por la política', allow: false, context: '', notes: [] }; }
      return { blocked: hooks.stops++ === 0, reason: 'falta ejecutar las pruebas', allow: false, context: '', notes: [] };
    },
    stops: 0,
  };
  const { log, msgs } = await runScripted([{ tool: 'run_command', args: { command: 'npm test' } }], { ctx: { hooks } });
  assert.deepEqual(log.ran, [], 'el comando no se ejecutó');
  assert.ok(msgs.some((m) => m.role === 'tool' && /BLOQUEADO por un hook: comandos prohibidos/.test(m.content)));
  assert.ok(msgs.some((m) => m.role === 'user' && /UN HOOK PIDE CONTINUAR.*pruebas/.test(m.content)), 'stop hizo seguir una vez');
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
