// Service worker.
//
//   Code (JS/CSS/HTML)  network-first, cache as offline fallback
//   Assets (png/svg)    cache-first
//   API calls           never cached
//
// Code is network-first so deploys show up on the next load without bumping
// CACHE_VERSION. Bump it only when an image changes in place.

const CACHE_VERSION = 'v52';
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
  './js/search.js',
  './js/moderation.js',
  './js/weather-ui.js',
  './js/zone-ui.js',
  './js/map-spots.js',
  './js/species-ui.js',
  './js/identify-verdict.js',
  './js/sync.js',
  './js/auth.js',
  './js/auth/local.js',
  './js/auth/cloud.js',
  './js/auth/credentials.js',
  './js/avatar-crop.js',
  './js/media.js',
  './js/store.js',
  './js/pixel.js',
  './js/art.js',
  './js/art-mode.js',
  './js/art/modern.js',
  './js/config.js',
  './js/data/index.js',
  './js/data/tips.js',
  './js/data/changelog.js',
  './js/data/species-photos.js',
  './js/data/gear.js',
  './js/data/tactics.js',
  './js/data/species/indo-pacific.js',
  './js/data/regions/leyte.js',
  './js/api/weather.js',
  './js/api/tides.js',
  './js/api/photos.js',
  './js/api/geo.js',
  './js/api/place.js',
  './js/pages/home.js',
  './js/pages/info.js',
  './js/pages/identify.js',
  './js/pages/map.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './js/pages/conditions.js',
  './js/pages/log.js',
  './js/auth-ui.js',
  './js/card-deck.js',
  './js/pages/account.js',
  './js/pages/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Cache one at a time so a single 404 doesn't fail the install.
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

// Lets Settings' refresh button activate a waiting worker immediately.
// (install already calls skipWaiting; this is a fallback.)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

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

  // Don't touch third-party responses (weather, tides, map tiles).
  if (url.origin !== self.location.origin) return;

  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => save(request, res)))
    );
    return;
  }

  // Code: network-first, cache as offline fallback.
  event.respondWith(
    fetch(request)
      .then((res) => save(request, res))
      .catch(() =>
        caches.match(request).then((hit) => {
          if (hit) return hit;
          // Offline navigation gets the app shell; the hash router does the rest.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        })
      )
  );
});
