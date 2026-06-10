/* Service Worker:浏览器/PWA 模式离线缓存(Electron file:// 下不会注册) */
const CACHE = 'daily-checkin-v2';
const ASSETS = [
  './daily-checkin.html',
  './core.js',
  './storage.js',
  './renderer.js',
  './sync.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
