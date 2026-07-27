// ---------------------------------------------------------------------------
// Service worker.
//
// App shell: cache-first, so the app opens instantly and works offline.
// API calls:  network-only — stale weather and tides are worse than none.
//
// Bump CACHE_VERSION whenever you change a file in SHELL, otherwise returning
// visitors keep the old cached copy.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 'v2';
const CACHE_NAME = `angler-log-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/pixel.js',
  './js/config.js',
  './js/data/index.js',
  './js/data/tips.js',
  './js/data/tactics.js',
  './js/data/species/indo-pacific.js',
  './js/data/regions/leyte-gulf.js',
  './js/api/weather.js',
  './js/api/tides.js',
  './js/pages/home.js',
  './js/pages/species.js',
  './js/pages/map.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './js/pages/conditions.js',
  './js/pages/log.js',
  './js/pages/tips.js',
  './js/pages/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll is all-or-nothing; cache individually so one 404 can't fail install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache provider responses.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => {
          // An offline navigation still gets the shell; the hash router does the rest.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
