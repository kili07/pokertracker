/* Service Worker — App offline verfügbar halten.
   Bei jeder Änderung an den Dateien CACHE hochzählen. */
const CACHE = 'pokertracker-v14';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './equity.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './fonts/space-grotesk.woff2',
  './fonts/jetbrains-mono.woff2',
  './fonts/archivo.woff2',
  './fonts/fraunces.woff2',
  './fonts/figtree.woff2',
  './fonts/dm-serif-display.woff2',
  './fonts/public-sans.woff2',
];

self.addEventListener('install', (e) => {
  // cache:'reload' erzwingt frische Dateien vom Server. Ohne das würden die
  // Dateien aus dem HTTP-Cache des Browsers geholt (GitHub Pages sendet
  // max-age=600) — der neue Cache enthielte dann die alte Version.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Stale-while-revalidate: sofort aus dem Cache liefern, im Hintergrund aktualisieren. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
