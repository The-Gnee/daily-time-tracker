const cacheName = 'daily-time-tracker-v2:' + self.registration.scope;
const assets = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (!assets.some(asset => new URL(asset, self.registration.scope).href === url)) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)));
});
