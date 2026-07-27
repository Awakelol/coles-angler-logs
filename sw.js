// ---------------------------------------------------------------------------
// Service worker.
//
//   Code (JS/CSS/HTML)  network-first, falling back to cache when offline.
//   Assets (png/svg)    cache-first — they change rarely and are big.
//   API calls           never cached; stale weather and tides are worse
//                       than none.
//
// Code is deliberately network-first. Cache-first meant every edit to a JS or
// CSS file kept serving the old copy until CACHE_VERSION was bumped by hand,
// which is easy to forget and silently shows stale UI — it hid a whole round
// of sprite changes. The cost is one network round-trip per file on a warm
// connection; offline still works, because cache is the fallback.
//
// CACHE_VERSION now only needs bumping to force-evict old assets.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 'v3';
const CACHE_NAME = `angler-log-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/updates.js',
  './js/theme.js',
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
  './js/api/photos.js',
  './js/api/geo.js',
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

// Big, rarely-changing binaries are worth serving straight from cache.
const CACHE_FIRST = /\.(png|jpg|jpeg|gif|svg|webp|woff2?)$/i;

function save(request, response) {
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((c) => c.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch provider responses (weather, tides, map tiles).
  if (url.origin !== self.location.origin) return;

  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => save(request, res)))
    );
    return;
  }

  // Code: network-first so edits land immediately, cache as the offline net.
  event.respondWith(
    fetch(request)
      .then((res) => save(request, res))
      .catch(() =>
        caches.match(request).then((hit) => {
          if (hit) return hit;
          // An offline navigation still gets the shell; the hash router handles the route.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        })
      )
  );
});
