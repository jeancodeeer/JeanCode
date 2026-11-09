// JeanCode offline: primero la red (las actualizaciones llegan siempre), la caché solo como respaldo
// sin conexión. Solo archivos propios: las llamadas a APIs de modelos nunca pasan por aquí.
const CACHE = 'jeancode-v0.4.0';
const SHELL = [
  './', 'index.html', 'favicon.svg', 'manifest.webmanifest',
  'css/fonts.css', 'css/jeancode.css',
  'js/app.js', 'js/api.js', 'js/agent.js', 'js/code.js', 'js/commands.js', 'js/config.js', 'js/diff.js',
  'js/hf.js', 'js/md.js', 'js/providers.js', 'js/store.js', 'js/zip.js',
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
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
