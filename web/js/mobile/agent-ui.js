// Mini agente del móvil: el agente de JeanCode trabajando DENTRO del teléfono (archivos, comandos y pantalla), con el
// modelo que tengas conectado en la app. Mismo motor que el agente del PC (runAgent); el "escritorio" es el ayudante
// del teléfono: Shizuku en Android (modo desarrollador) o jeancode_helper.py en un iPhone con jailbreak.
import { deviceBackend, platformOf } from './device.js';
import { createPhoneDesktop, createPhoneScreen } from './shim.js';

const DEFAULT_ROOT = { android: '/sdcard/JeanCode', ios: '/var/mobile/JeanCode' };

/** Reglas extra para el modelo: dónde está y qué no debe tocar. */
export function phoneRules(kind, screen) {
  const where = kind === 'android'
    ? 'un TELÉFONO ANDROID. Los comandos corren con permisos de shell (como adb shell, gracias a Shizuku): toybox/busybox, pm, am, settings get, dumpsys, input, screencap. No eres root.'
    : 'un iPHONE CON JAILBREAK. Los comandos corren como el usuario mobile (herramientas de Procursus en /var/jb).';
  return [
    `ESTÁS EN ${where}`,
    'La carpeta de trabajo está en el almacenamiento del teléfono; las rutas de archivos son relativas a ella.',
    screen ? 'PANTALLA: no hay ventanas ni ratón. open_application abre una app por paquete (com.android.settings) o una URL; inspect_screen lista los controles con sus coordenadas; mouse_click toca; scroll desliza (negativo = bajar); key_press ["back"], ["home"], ["enter"], ["recents"]; type_text escribe en el campo con el foco. Mientras actúas, JeanCode queda en segundo plano: cuando termines, vuelve con open_application io.github.jeancodeeer.jeancode.' : '',
    'NUNCA desinstales apps, borres datos de apps, cambies ajustes de seguridad, bloqueo o red, ni toques pantallas de pago, contraseñas o códigos: si hace falta, detente y pregúntale al usuario.',
  ].filter(Boolean).join('\n');
}

/**
 * deps: { $, esc, store, toast, renderMarkdown, confirmDialog, model() → { ep, id } | null,
 *         chat(m, opts) → Promise<texto> (enrutador), agentSystem, runAgent, stripToolBlocks, riskOf, describeAction, capsOf }
 */
export function initPhoneAgent(deps) {
  const { $, esc, store, toast, renderMarkdown, confirmDialog } = deps;
  const view = $('#view-device');
  const kind = platformOf();
  if (!view || !['android', 'ios'].includes(kind)) return null;
  const st = { busy: false, abort: null, messages: store.get('deviceThread', []), info: '', ready: false };
  const backend = () => deviceBackend({ iosToken: store.get('iosHelperToken', ''), iosUrl: store.get('iosHelperUrl', '') || undefined });
  const root = () => ($('#dv-root').value.trim() || DEFAULT_ROOT[kind]).replace(/\/+$/, '');

  /* ---------------- estado del ayudante ---------------- */
  async function check() {
    const dev = backend();
    const box = $('#dv-setup');
    let s;
    try { s = await dev.status(); } catch (e) { s = { ready: false, reason: e.message }; }
    st.ready = !!s.ready;
    $('#dv-ready').textContent = st.ready ? `LISTO · ${dev.label}${s.uid === 2000 ? ' · shell' : s.uid === 0 ? ' · root' : ''}` : 'SIN CONFIGURAR';
    $('#dv-ready').dataset.kind = st.ready ? 'on' : 'off';
    $('#dv-main').hidden = !st.ready;
    box.hidden = st.ready;
    if (kind === 'android') {
      $('#dv-steps').innerHTML = [
        ['Activa el modo desarrollador (Ajustes → Información → toca 7 veces «Número de compilación») y la depuración inalámbrica.', true],
        [`Instala Shizuku (Google Play o github.com/RikkaApps/Shizuku)${s.installed ? ' — instalado' : ''}.`, s.installed],
        [`Abre Shizuku y pulsa «Iniciar» con la depuración inalámbrica (una vez tras cada reinicio)${s.running ? ' — en marcha' : ''}.`, s.running],
        [`Da permiso a JeanCode en Shizuku${s.granted ? ' — concedido' : ''}.`, s.granted],
      ].map(([t, ok]) => `<li class="${ok ? 'done' : ''}">${ok ? '■' : '□'} ${esc(t)}</li>`).join('');
      $('#dv-grant').hidden = !s.running || s.granted;
    } else {
      $('#dv-steps').innerHTML = [
        'Con el jailbreak, instala python3 desde Sileo o Zebra.',
        'Copia la carpeta ios-helper de JeanCode al iPhone y ejecuta como root: sudo sh install.sh',
        'Pega aquí abajo el token que imprime el instalador.',
      ].map((t) => `<li>□ ${esc(t)}</li>`).join('') + (s.reason ? `<li class="fine">Último intento: ${esc(s.reason)}</li>` : '');
      $('#dv-grant').hidden = true;
    }
    $('#dv-ios').hidden = kind !== 'ios';
    $('#dv-screen-row').hidden = !dev.screen;
    if (st.ready && !st.info) st.info = await createPhoneDesktop(dev).system.info().catch(() => '');
    // una línea (modelo y versión); el resto (batería, id…) al pasar por encima
    $('#dv-info').textContent = String(st.info || '').split('\n')[0];
    $('#dv-info').title = st.info || '';
    return st.ready;
  }

  /* ---------------- conversación ---------------- */
  function addRow(role, text) {
    const row = document.createElement('div');
    row.className = `rm-row rm-${role}`;
    row.innerHTML = `<div class="rm-who">${{ user: 'TÚ', assistant: 'JEAN' }[role] || ''}</div><div class="rm-body"></div>`;
    const body = $('.rm-body', row);
    if (role === 'user' || role === 'assistant') body.innerHTML = renderMarkdown(text || ''); else body.textContent = text || '';
    $('#dv-stream').appendChild(row);
    $('#dv-stream').scrollTop = $('#dv-stream').scrollHeight;
    return row;
  }
  const renderAll = () => { $('#dv-stream').innerHTML = ''; for (const m of st.messages) addRow(m.role, m.content); };
  const save = () => store.set('deviceThread', st.messages.slice(-60));
  const busy = (on) => { st.busy = on; $('#dv-send').disabled = on; $('#dv-stop').hidden = !on; $('#dv-busy').hidden = !on; };

  /** Mientras el agente maneja otras apps, JeanCode queda detrás: antes de preguntar algo, se trae al frente. */
  let front = null;
  async function ask(opts) {
    await front?.();
    return confirmDialog(opts);
  }
  /**
   * Permiso de cada acción de pantalla. Activar «Controlar la pantalla» ya autoriza lo de riesgo bajo y medio en el
   * teléfono (tocar, deslizar, abrir apps, atrás/inicio); lo de riesgo alto pregunta siempre.
   */
  async function permit(tool, args, risk, label) {
    if (risk !== 'high') return true;
    return (await ask({ title: 'ACCIÓN DE RIESGO EN EL MÓVIL', command: label, where: '' })) === true;
  }

  async function send(text) {
    if (st.busy || !text.trim()) return;
    const m = deps.model();
    if (!m) { toast('CONECTA UNA API EN AJUSTES PARA USAR EL AGENTE'); return; }
    if (!(await check())) { toast('EL AYUDANTE DEL TELÉFONO NO ESTÁ LISTO'); return; }
    const dev = backend();
    const d = createPhoneDesktop(dev);
    const ws = root();
    store.set('deviceRoot', ws);
    await d.shell.run(ws, 'true').catch(() => {}); // crea la carpeta de trabajo si no existe
    const vision = deps.capsOf(m.ep, m.id)?.vision !== false;
    const computer = dev.screen && $('#dv-screen').checked ? createPhoneScreen(dev, { permit, vision }) : null;
    if (computer) await computer.refresh().catch(() => {});
    // con la pantalla bajo control, JeanCode puede quedar detrás de otra app: se vuelve a él para preguntar
    front = computer && kind === 'android'
      ? async () => { if (document.hidden) { await dev.exec('am start -n io.github.jeancodeeer.jeancode/.MainActivity', 8000).catch(() => {}); await new Promise((r) => setTimeout(r, 800)); } }
      : null;
    const perm = $('#dv-perm').value;
    const allow = store.get(`allow:device:${ws}`, []);
    const sys = {
      workspace: ws, os: st.info || kind, skills: [], mode: perm, agent: 'build', memory: '', agents: [], style: 'concise',
      rules: `${store.get('rules', '')}\n\n${phoneRules(kind, !!computer)}`.trim(), computer: computer ? { vision: computer.vision, screen: computer.screen } : null, mcp: [], quality: '',
    };
    st.messages.push({ role: 'user', content: text });
    addRow('user', text);
    save();
    const messages = [{ role: 'system', content: deps.agentSystem(sys) },
      ...st.messages.slice(-21, -1).map(({ role, content }) => ({ role, content })), { role: 'user', content: text }];
    st.abort = new AbortController();
    busy(true);
    let live = null;
    const rows = new Map();
    const ctx = {
      ep: m.ep, model: m.id, desktop: d, workspace: ws, mode: perm, agent: 'build', sys, think: false, signal: st.abort.signal,
      chat: (o) => deps.chat({ id: o.model, ep: o.ep }, o), computer, mcp: [], autoDiagnostics: false,
      confirm: (o) => ask({ ...o, where: ws }),
      isAllowed: (cmd) => allow.includes(cmd.trim()),
      allowCommand: (cmd) => { if (!allow.includes(cmd)) { allow.push(cmd); store.set(`allow:device:${ws}`, allow); } },
      onEvent: (ev) => {
        if (ev.nested) return;
        if (ev.type === 'assistant-start') live = addRow('assistant', '');
        if (ev.type === 'assistant-delta' && live) {
          $('.rm-body', live).innerHTML = renderMarkdown(deps.stripToolBlocks(ev.text || ''));
          $('#dv-stream').scrollTop = $('#dv-stream').scrollHeight;
        }
        if (ev.type === 'assistant-end' && live) { if (!deps.stripToolBlocks(ev.text || '').trim()) live.remove(); live = null; }
        if (ev.type === 'tool-start' || ev.type === 'tool-end') {
          const row = rows.get(ev.call) || addRow('tool', '');
          rows.set(ev.call, row);
          const bad = ev.type === 'tool-end' && /^(ERROR|DENEGADO|RECHAZADO|BLOQUEADO)/.test(String(ev.result ?? ''));
          $('.rm-body', row).textContent = `${ev.type === 'tool-start' ? '…' : bad ? '✕' : '✓'} ${ev.call.tool} ${JSON.stringify(ev.call.args || {}).slice(0, 140)}`;
          row.classList.toggle('bad', bad);
        }
        if (ev.type === 'todos') { $('#dv-todos').hidden = !ev.todos?.length; $('#dv-todos').innerHTML = (ev.todos || []).map((t) => `<li>${t.status === 'done' ? '■' : t.status === 'in_progress' ? '▶' : '□'} ${esc(t.content)}</li>`).join(''); }
      },
    };
    try {
      const final = await deps.runAgent(ctx, messages);
      const answer = deps.stripToolBlocks(final) || final;
      st.messages.push({ role: 'assistant', content: answer });
      if (!$('#dv-stream .rm-assistant:last-child')) addRow('assistant', answer);
    } catch (e) {
      addRow('system', e.name === 'AbortError' ? 'Detenido.' : `Error: ${e.message}`);
    } finally {
      busy(false);
      st.abort = null;
      save();
    }
  }

  $('#dv-check').addEventListener('click', () => check());
  $('#dv-grant').addEventListener('click', async () => {
    try { const r = await backend().request(); toast(r.granted ? 'PERMISO CONCEDIDO' : 'PERMISO DENEGADO'); } catch (e) { toast(String(e.message).toUpperCase()); }
    check();
  });
  $('#dv-ios-save').addEventListener('click', () => { store.set('iosHelperToken', $('#dv-token').value.trim()); check().then((ok) => toast(ok ? 'AYUDANTE CONECTADO' : 'NO RESPONDE: REVISA EL TOKEN')); });
  $('#dv-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#dv-input').value; $('#dv-input').value = ''; send(t); });
  $('#dv-stop').addEventListener('click', () => st.abort?.abort());
  $('#dv-clear').addEventListener('click', () => { st.messages = []; save(); renderAll(); });
  $('#dv-root').value = store.get('deviceRoot', DEFAULT_ROOT[kind]);
  $('#dv-token').value = store.get('iosHelperToken', '');
  renderAll();
  return { view, check, send, kind };
}
