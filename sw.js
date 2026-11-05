const VERSION = 'kiosk-v2';
const CACHE_FILES = [
  '/',
  '/LobbyKiosk/',
  '/LobbyKiosk/index.html',
  '/LobbyKiosk/app.css',
  '/LobbyKiosk/app.js',
  '/LobbyKiosk/icons.js',
  '/LobbyKiosk/admin.html',
  '/LobbyKiosk/admin.js',
  '/LobbyKiosk/config.js',
  '/LobbyKiosk/manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CACHE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => k !== VERSION && caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com') || e.request.url.includes('drive.google.com') || e.request.method !== 'GET') return;
  if (e.request.url.includes('admin.html') || e.request.url.includes('admin.js')) return;

  const isMedia = /\.(jpg|jpeg|png|gif|webp|woff2|ttf|otf|svg)$/i.test(e.request.url);
  const cache = isMedia ? 'media' : VERSION;
  const strategy = isMedia ? 'cache' : 'network';

  e.respondWith(
    strategy === 'network'
      ? fetch(e.request).then(r => r.ok && (caches.open(VERSION).then(c => c.put(e.request, r.clone())), r) || cacheMatch())
      : caches.match(e.request).then(r => r || fetch(e.request).then(r => r.ok && (caches.open(cache).then(c => c.put(e.request, r.clone())), r) || cacheMatch()))
  );

  async function cacheMatch() {
    const r = await caches.match(e.request);
    return r || new Response('offline', {status: 503});
  }
});
