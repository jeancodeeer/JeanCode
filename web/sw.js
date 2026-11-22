// JeanCode offline: primero la red (las actualizaciones llegan siempre), la caché solo como respaldo
// sin conexión. Solo archivos propios: las llamadas a APIs de modelos nunca pasan por aquí.
const CACHE = 'jeancode-1.3.0'; // la fija scripts/version.mjs
const SHELL = [
  './', 'index.html', 'favicon.svg', 'icons/mascot.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest',
  'css/fonts.css', 'css/jeancode.css',
  'js/app.js', 'js/api.js', 'js/agent.js', 'js/code.js', 'js/reasoning.js', 'js/update.js', 'js/run.js', 'js/sandbox.js', 'js/batch.js', 'js/commands.js', 'js/computer.js', 'js/connectors.js', 'js/apps.js', 'js/skills-catalog.js', 'js/plugins-catalog.js', 'js/cron.js', 'js/remote/crypto.js', 'js/remote/link.js', 'js/remote/host.js', 'js/remote/phone.js', 'js/mobile/device.js', 'js/mobile/shim.js', 'js/mobile/agent-ui.js', 'js/mascot.js', 'js/attachments.js', 'js/documents.js', 'js/media/engine.js', 'js/media/service.js', 'js/media/edit.js', 'js/media/studio.js', 'js/media/htmlstudio.js', 'js/media/htmlvideo.js', 'js/media/htmlrender.js', 'js/media/htmlscenes.js', 'js/media/htmlaudio.js', 'fonts/video/anton.woff2', 'fonts/video/bebas-neue.woff2', 'fonts/video/archivo-black.woff2', 'fonts/video/playfair-800.woff2', 'fonts/video/dm-serif.woff2', 'fonts/video/space-grotesk-700.woff2', 'js/media/mp4.js', 'js/hooks.js', 'js/automations.js', 'js/history.js', 'js/quality.js', 'js/config.js', 'js/diff.js',
  'js/hf.js', 'js/md.js', 'js/capabilities.js', 'js/providers.js', 'js/router.js', 'js/store.js', 'js/version.js', 'js/zip.js',
  'fonts/IBMPlexMono-400.woff2', 'fonts/IBMPlexMono-500.woff2', 'fonts/IBMPlexMono-700.woff2',
  'fonts/IBMPlexSans-400.woff2', 'fonts/IBMPlexSans-500.woff2', 'fonts/IBMPlexSans-700.woff2',
  'fonts/IBMPlexSansCondensed-500.woff2', 'fonts/IBMPlexSansCondensed-700.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: siempre se revalida (ETag) con el servidor. Sin esto, la caché HTTP de Pages (10 min)
    // podía servir módulos de dos versiones mezcladas justo después de publicar una nueva.
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
