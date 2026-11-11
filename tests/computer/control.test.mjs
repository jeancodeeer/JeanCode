// Pruebas REALES del control del equipo (Windows, sesión de escritorio interactiva).
// Usan el ratón y el teclado del sistema contra una ventana de prueba propia (test-form.ps1) y comprueban
// cada resultado leyendo el estado real de sus controles. No tocan ninguna otra aplicación.
//   node --test tests/computer/control.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { ComputerControl } = require('../../desktop/lib/computer/control.js');
const tools = require('../../desktop/lib/tools.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const opts = { skip: WIN ? false : 'el driver de ratón y teclado solo existe en Windows', concurrency: false };

let form;
const c = WIN ? new ComputerControl({ logFile: join(mkdtempSync(join(tmpdir(), 'jc-pc-')), 'log.jsonl') }) : null;

async function find(type, name) {
  const r = await c.act('inspect_screen', {});
  return { r, el: r.elements.find((e) => e.type === type && (name == null || e.name === name)) };
}
async function counter() { return (await find('Text')).r.elements.find((e) => /^Clics/.test(e.name))?.name; }
async function editValue() { return (await find('Edit')).r.elements.find((e) => e.type === 'Edit' && !e.password)?.value; }

test('control del equipo (Windows real)', opts, async (t) => {
  form = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'test-form.ps1')], { stdio: 'ignore' });
  const info = await c.begin('pruebas automáticas');
  await wait(2500);
  await c.act('focus_window', { title: 'JeanCode prueba de control' });

  await t.test('captura de pantalla real', async () => {
    const s = await c.act('screenshot', {});
    assert.equal(s.width, info.modelWidth);
    const jpeg = Buffer.from(s.jpeg, 'base64');
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);          // cabecera JPEG
    assert.ok(jpeg.length > 10000, 'la captura tiene contenido');
    assert.equal(s.foreground.title, 'JeanCode prueba de control');
  });

  await t.test('mover el ratón (coordenadas de la captura → píxeles reales)', async () => {
    await c.act('mouse_move', { x: 100, y: 120 });
    const p = await c.driver.call('cursor');
    const want = c.toPhysical(100, 120);
    assert.deepEqual(p, want);
  });

  await t.test('clic por elemento (UI Automation) y por coordenadas', async () => {
    const before = await counter();
    const { el } = await find('Button', 'Sumar');
    await c.act('click_element', { id: el.id });
    assert.equal(await counter(), `Clics: ${Number(before.split(' ')[1]) + 1}`);
    await c.act('mouse_click', { x: el.x, y: el.y });
    assert.equal(await counter(), `Clics: ${Number(before.split(' ')[1]) + 2}`);
  });

  await t.test('por nombre: click_element y set_text sin ids, y "changes" informa el efecto', async () => {
    await c.act('inspect_screen', {}); // activa la comparación de cambios
    const before = Number((await counter()).split(' ')[1]);
    const r = await c.act('click_element', { name: 'sumar' }); // sin mayúscula: se normaliza
    assert.equal(r.clicked, 'Sumar');
    assert.ok(r.changes?.appeared?.some((l) => l.includes(`Clics: ${before + 1}`)), `changes: ${JSON.stringify(r.changes)}`);
    assert.ok(r.changes?.gone?.some((l) => l.includes(`Clics: ${before}`)));
    // campo sin nombre propio, con una etiqueta al lado ("Nombre:" [____]): se encuentra por la etiqueta
    const s = await c.act('set_text', { name: 'Nombre', text: 'por etiqueta' });
    assert.ok(s.changes?.appeared?.some((l) => l.includes('por etiqueta')), JSON.stringify(s.changes));
    const edits = (await find('Edit')).r.elements.filter((e) => e.type === 'Edit' && !e.password);
    assert.ok(edits.some((e) => e.value === 'por etiqueta'), 'el campo junto a la etiqueta tiene el texto');
    await assert.rejects(c.act('click_element', { name: 'Botón que no existe' }), /no hay ningún control llamado .*Algunos que sí hay/);
  });

  await t.test('OCR: read_text lee la ventana, click_text pulsa por texto, wait_for espera', async () => {
    await c.act('focus_window', { title: 'JeanCode prueba de control' });
    const r = await c.act('read_text', {});
    const all = r.lines.map((l) => l.text).join(' | ');
    assert.match(all, /Sumar/, `OCR leyó: ${all}`);
    assert.match(all, /Clics/);
    const before = Number((await counter()).split(' ')[1]);
    await c.act('click_text', { text: 'Sumar' });
    assert.equal(await counter(), `Clics: ${before + 1}`, 'click_text pulsó el botón leído por OCR');
    const w = await c.act('wait_for', { text: `Clics: ${before + 1}`, timeout_ms: 3000 });
    assert.equal(w.found, true);
    const miss = await c.act('wait_for', { text: 'texto que nunca aparece', timeout_ms: 800 });
    assert.equal(miss.found, false);
    await assert.rejects(c.act('click_text', { text: 'texto que nunca aparece' }), /no se ve el texto/);
  });

  await t.test('teclado: escribir, teclas y atajos', async () => {
    const { el } = await find('Edit');
    await c.act('set_text', { id: el.id, text: '' });
    await c.act('click_element', { id: el.id });
    await c.act('type_text', { text: 'hola JeanCode ñ€' });
    assert.equal(await editValue(), 'hola JeanCode ñ€');
    await c.act('key_press', { keys: ['backspace'], repeat: 2 });
    assert.equal(await editValue(), 'hola JeanCode ');
    await c.act('key_press', { keys: ['home'] });
    await c.act('type_text', { text: '>' });
    assert.equal(await editValue(), '>hola JeanCode ');
    await c.act('key_press', { keys: ['ctrl', 'z'] });                        // atajo real: deshacer
    assert.notEqual(await editValue(), '>hola JeanCode ');
  });

  await t.test('nunca escribe en un campo de contraseña', async () => {
    const r = await c.act('inspect_screen', {});
    const pw = r.elements.find((e) => e.password);
    assert.ok(pw, 'la ventana tiene un campo de contraseña');
    assert.equal(pw.value, '(contraseña)');
    await c.act('click_element', { id: pw.id });
    await assert.rejects(c.act('type_text', { text: 'secreto' }), /contrase/);
    await assert.rejects(c.act('set_text', { id: pw.id, text: 'secreto' }), /contrase/);
  });

  await t.test('no puede hacer clic ni teclear sobre la ventana de JeanCode', async () => {
    // el proceso de la ventana de prueba hace de "JeanCode": el sistema dice de quién es la ventana bajo el punto
    const { el } = await find('Button', 'Sumar');
    const before = await counter();
    c.ownPid = form.pid;
    try {
      await assert.rejects(c.act('mouse_click', { x: el.x, y: el.y }), /ventana de JeanCode/);
      await assert.rejects(c.act('click_element', { id: el.id }), /JeanCode/);
      await assert.rejects(c.act('type_text', { text: 'x' }), /JeanCode está en primer plano/);
      await assert.rejects(c.act('inspect_screen', {}), /JeanCode/);
    } finally { c.ownPid = process.pid; }
    assert.equal(await counter(), before, 'no se hizo ningún clic');
    await c.act('mouse_click', { x: el.x, y: el.y });                      // con el dueño real, el clic sí va
  });

  await t.test('fuera de pantalla y ids viejos: error claro y recuperable', async () => {
    await assert.rejects(c.act('mouse_click', { x: 99999, y: 5 }), /fuera de la pantalla/);
    await assert.rejects(c.act('click_element', { id: 4242 }), /no está en la última inspección/);
    const r = await c.act('inspect_screen', {});                              // se recupera: sigue funcionando
    assert.ok(r.elements.length > 2);
  });

  await t.test('pausa: la acción espera hasta seguir', async () => {
    c.pause();
    const t0 = Date.now();
    const p = c.act('mouse_move', { x: 200, y: 200 });
    await wait(600);
    c.resume();
    await p;
    assert.ok(Date.now() - t0 >= 550, 'la acción no se ejecutó durante la pausa');
  });

  await t.test('detener corta la acción en curso y descarta la cola', async () => {
    const { el } = await find('Edit');
    await c.act('set_text', { id: el.id, text: '' });
    await c.act('click_element', { id: el.id });
    const long = c.act('type_text', { text: 'x'.repeat(400) });
    const queued = c.act('mouse_move', { x: 10, y: 10 });
    await wait(500);
    c.stop('prueba');
    await assert.rejects(long, (e) => e.stopped === true);
    await assert.rejects(queued, (e) => e.stopped === true);
    await c.begin('pruebas automáticas (sigue)');
    await c.act('focus_window', { title: 'JeanCode prueba de control' });
    const typed = (await editValue()).length;
    assert.ok(typed > 0 && typed < 400, `se cortó a mitad (${typed} de 400)`);
  });

  await t.test('el registro no guarda el texto escrito', async () => {
    const log = readFileSync(c.logFile, 'utf8');
    assert.match(log, /"name":"type_text"/);
    assert.doesNotMatch(log, /hola JeanCode/);
    assert.match(log, /"chars":/);
  });

  await t.test('teclear en una terminal exige una aprobación explícita de un solo uso', async () => {
    const title = 'JeanCode prueba terminal';
    const term = spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd.exe', '/k', `title ${title}`], { stdio: 'ignore', shell: false, windowsVerbatimArguments: true });
    await wait(2500);
    try {
      await c.act('focus_window', { title });
      const fg = await c.foreground();
      assert.equal(fg.terminal, true, `la consola se reconoce como terminal (${fg.process})`);
      await assert.rejects(c.act('type_text', { text: 'echo hola' }), /terminal/);           // sin aprobación: no
      c.approveTerminal();
      await c.act('type_text', { text: 'echo jeancode' });                                 // aprobada: una vez
      await assert.rejects(c.act('type_text', { text: 'x' }), /terminal/);                   // y solo una
      // un clic (derecho o central pega el portapapeles) sobre la consola también necesita permiso
      // un punto de la consola que NO tape la ventana de prueba (que está siempre encima, en el centro)
      let win = null;
      for (const e of (await c.act('inspect_screen', {})).elements) {
        if ((await c.targetInfo('mouse_click', { x: e.x, y: e.y })).terminal) { win = e; break; }
      }
      assert.ok(win, 'hay un punto visible de la consola');
      await assert.rejects(c.act('mouse_click', { x: win.x, y: win.y, button: 'right' }), /terminal/);
      await assert.rejects(c.act('mouse_click', { x: win.x, y: win.y }), /terminal/);
      assert.equal((await c.targetInfo('mouse_click', { x: win.x, y: win.y })).terminal, true);
      c.approveTerminal();
      await c.act('mouse_click', { x: win.x, y: win.y });                                   // con permiso: sí
      await c.act('focus_window', { title: 'JeanCode prueba de control' });
      assert.equal((await c.foreground()).terminal, false, 'una app gráfica alojada en PowerShell no es una terminal');
    } finally {
      try { execFileSync('taskkill', ['/F', '/FI', `WINDOWTITLE eq ${title}*`], { stdio: 'ignore' }); } catch { /* ya cerrada */ }
      term.kill();
    }
  });

  c.end('fin de pruebas');
  form.kill();
  try { execFileSync('taskkill', ['/F', '/FI', 'WINDOWTITLE eq JeanCode prueba de control'], { stdio: 'ignore' }); } catch { /* ya cerrada */ }
  c.driver.stop();
});

const countProc = (name) => {
  try { return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { encoding: 'utf8' }).split('\n').filter((l) => l.toLowerCase().startsWith(name)).length; } catch { return 0; }
};

test('terminal y procesos: sin zombis', { skip: WIN ? false : 'usa tasklist', concurrency: false }, async (t) => {
  const ws = mkdtempSync(join(tmpdir(), 'jc-ws-'));
  await t.test('comando normal', async () => {
    const r = await tools.run(ws, 'echo jeancode-ok', 20);
    assert.match(r, /jeancode-ok/);
    assert.match(r, /\(salida 0\)/);
  });
  await t.test('tiempo agotado: mata el árbol entero (sin procesos huérfanos)', async () => {
    const before = countProc('ping.exe');
    const r = await tools.run(ws, 'ping -n 30 127.0.0.1', 2);
    assert.match(r, /tiempo agotado/);
    await wait(1500);
    assert.equal(countProc('ping.exe'), before);
  });
  await t.test('cancelar un comando en curso', async () => {
    const before = countProc('ping.exe');
    const p = tools.run(ws, 'ping -n 30 127.0.0.1', 60);
    await wait(800);
    assert.equal(tools.cancelRuns(), 1);
    assert.match(await p, /cancelado/);
    await wait(1500);
    assert.equal(countProc('ping.exe'), before);
  });
  await t.test('proceso en segundo plano: arranca, se lee y se detiene', async () => {
    writeFileSync(join(ws, 'srv.js'), "require('http').createServer((q,s)=>s.end('ok')).listen(18765,()=>console.log('escuchando 18765'))");
    const started = await tools.startProcess(ws, 'node srv.js');
    assert.match(started, /p\d+ iniciado/);
    const id = started.split(' ')[0];
    const res = await fetch('http://127.0.0.1:18765').then((r) => r.text());
    assert.equal(res, 'ok');
    assert.match(tools.processOutput(id), /escuchando 18765/);
    tools.stopProcess(id);
    await wait(1500);
    await assert.rejects(fetch('http://127.0.0.1:18765', { signal: AbortSignal.timeout(2000) }));
  });
  await t.test('mover y renombrar dentro de la carpeta; nunca fuera', async () => {
    writeFileSync(join(ws, 'a.txt'), 'x');
    assert.match(await tools.move(ws, 'a.txt', 'sub/b.txt'), /movido/);
    assert.ok(existsSync(join(ws, 'sub', 'b.txt')));
    await assert.rejects(tools.move(ws, 'sub/b.txt', '../fuera.txt'), /fuera del espacio/);
    writeFileSync(join(ws, 'c.txt'), 'y');
    await assert.rejects(tools.move(ws, 'c.txt', 'sub/b.txt'), /no se sobrescribe/);
  });
});
