// Barra flotante: estado de la tarea y botones PAUSAR / DETENER. Solo usa el puente de overlay-preload.js.
const bar = document.getElementById('bar');
const txt = document.getElementById('txt');
const pause = document.getElementById('pause');
const LABEL = {
  screenshot: 'MIRANDO LA PANTALLA', inspect_screen: 'LEYENDO LA VENTANA', list_windows: 'LISTANDO VENTANAS',
  mouse_move: 'MOVIENDO EL RATÓN', mouse_click: 'HACIENDO CLIC', mouse_drag: 'ARRASTRANDO', scroll: 'DESPLAZANDO',
  click_element: 'HACIENDO CLIC', set_text: 'ESCRIBIENDO', type_text: 'ESCRIBIENDO', key_press: 'PULSANDO TECLAS',
  hotkey: 'PULSANDO ATAJO', focus_window: 'CAMBIANDO DE VENTANA', open_application: 'ABRIENDO', wait: 'ESPERANDO',
};
window.jcOverlay.onState((s) => {
  bar.classList.toggle('paused', s.status === 'paused');
  pause.textContent = s.status === 'paused' ? 'SEGUIR' : 'PAUSAR';
  const act = s.action ? LABEL[s.action.name] || s.action.name.toUpperCase() : (s.status === 'paused' ? 'EN PAUSA' : s.note || 'PENSANDO');
  txt.textContent = `JEANCODE · PASO ${s.step} · ${act}`;
});
pause.addEventListener('click', () => window.jcOverlay.send('pause'));
document.getElementById('stop').addEventListener('click', () => window.jcOverlay.send('stop'));
// La barra deja pasar los clics salvo sobre sus botones: no tapa la app que se está usando
for (const b of document.querySelectorAll('button')) {
  b.addEventListener('mouseenter', () => window.jcOverlay.send('hover', true));
  b.addEventListener('mouseleave', () => window.jcOverlay.send('hover', false));
}
