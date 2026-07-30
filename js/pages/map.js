// Fishing map — zoom-aware zone pins over OpenStreetMap tiles.
//
// Each zone carries a `minZoom`, so broad offshore grounds show when zoomed
// out and small creeks only appear once you zoom in. Tapping a pin opens the
// species found there plus lure and retrieve recommendations.
//
// Leaflet is vendored in vendor/leaflet so the app has no CDN dependency.

import { getLocation, nearestPlace, geolocationSupported } from '../api/geo.js';
import { icon } from '../pixel.js';
import { fetchWeather } from '../api/weather.js';
import { placeName } from '../api/place.js';
import { weatherHtml, forecastHtml, resolveCoords } from '../weather-ui.js';
import { zoneMarkerHtml, zoneSheetHtml } from '../zone-ui.js';
import { esc, openSheet, toast, loadingBlock, errorBlock, round } from '../ui.js';

let leafletPromise = null;

/** Load the vendored Leaflet bundle once, on first visit to this page. */
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      css.dataset.leaflet = '1';
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet loaded but window.L is missing')));
    s.onerror = () => reject(new Error('Could not load vendor/leaflet/leaflet.js'));
    document.body.appendChild(s);
  });

  return leafletPromise;
}

export function render(ctx) {
  const zones = ctx.region.zones || [];

  if (!zones.length) {
    return `
      <section class="band band--cream"><div class="wrap">
        <h1 class="display">Map</h1>
        <div class="notice">
          <h3>No zones defined for ${esc(ctx.region.name)}</h3>
          <p>Add a <code>zones</code> array to <code>js/data/regions/${esc(ctx.region.id)}.js</code> to put pins on the map.</p>
        </div>
      </div></section>`;
  }

  return `
    <div class="map-screen">
      <div class="map-screen__info">
        <div class="map-screen__bar">
          <p class="eyebrow" id="mapSource">${esc(ctx.region.name)}</p>
          <a class="map-screen__link" href="#/conditions">Tides &amp; forecast &rarr;</a>
        </div>
        <!-- Two pages side by side: conditions, then the five-day strip.
             Swiping between them costs no vertical space, which is what the
             stacked version was fighting for on a phone. Scroll-snap does the
             gesture natively — no drag handling, and it keeps momentum. -->
        <div class="wx-deck" id="wxDeck">
          <section class="wx-deck__page" id="mapWeather"
                   aria-label="Current conditions">${loadingBlock('Fetching weather…')}</section>
          <section class="wx-deck__page" id="mapForecast" aria-label="Five day forecast"></section>
        </div>
        <div class="wx-dots" id="wxDots" role="tablist" aria-label="Weather pages">
          <button role="tab" data-page="0" aria-label="Current conditions" aria-selected="true"></button>
          <button role="tab" data-page="1" aria-label="Five day forecast" aria-selected="false"></button>
        </div>

        <!-- Desktop only: a tapped zone renders here instead of in a modal. -->
        <div id="zonePanel" hidden></div>
      </div>

      <div id="mapWrap">
        <div id="fishMap" role="application" aria-label="Fishing zone map"></div>
        <div id="mapHint" class="map-hint"></div>
        ${
          geolocationSupported()
            ? `<button class="map-locate" id="locateBtn" title="Centre on my location"
                       aria-label="Centre the map on my location">
                 <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                   <path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3a9 9 0 0 0-8-8V1h-2v2a9 9 0 0 0-8 8H1v2h2a9 9 0 0 0 8 8v2h2v-2a9 9 0 0 0 8-8h2v-2h-2Zm-9 8a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/>
                 </svg>
               </button>`
            : ''
        }
      </div>
    </div>`;
}

/** Weather panel above the map. Independent of Leaflet — if tiles fail to
 *  load the forecast should still be there, and vice versa. */
async function mountWeather(root, ctx) {
  const pane = root.querySelector('#mapWeather');
  const strip = root.querySelector('#mapForecast');
  const source = root.querySelector('#mapSource');
  if (!pane) return;

  const tz = ctx.region.timezone;
  const { coords, source: kind } = await resolveCoords(ctx);

  // Where the person actually is, not a bearing and not the region name.
  // Coordinates are meaningless to read, and naming the region is wrong when
  // they're somewhere else entirely.
  if (source) {
    source.textContent = kind === 'device' ? 'Locating…' : ctx.region.name;
    placeName(coords).then((name) => {
      if (name) source.textContent = name;
      else if (kind === 'device') source.textContent = 'Your location';
    });
  }

  try {
    const w = await fetchWeather(coords, tz);
    pane.innerHTML = weatherHtml(w, tz);
    if (strip) strip.innerHTML = forecastHtml(w, tz, { compact: true });
  } catch (err) {
    console.error('[map weather]', err);
    pane.innerHTML = errorBlock('Could not load weather', err.message, 'Try again');
    if (strip) strip.innerHTML = '';
    pane.querySelector('[data-retry]')?.addEventListener('click', () => mountWeather(root, ctx));
  }
}

export async function mount(root, ctx) {
  const zones = ctx.region.zones || [];
  // Weather is not tied to zones — show it even for a region with none.
  mountWeather(root, ctx);
  if (!zones.length) return;

  const panel = root.querySelector('#zonePanel');
  const wideScreen = () => matchMedia('(min-width: 900px)').matches;

  // On a wide window the zone belongs in the sidebar under the weather —
  // a modal over a map you're still reading is the wrong shape there. On a
  // phone there's no sidebar to put it in, so it stays a sheet.
  const openZone = (zone) => {
    if (!wideScreen() || !panel) {
      openSheet(zone.name, () => zoneSheetHtml(zone));
      return;
    }
    panel.innerHTML = `
      <div class="zone-panel__head">
        <h2>${esc(zone.name)}</h2>
        <button class="icon-btn" data-close-zone aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
        </button>
      </div>
      ${zoneSheetHtml(zone)}`;
    panel.hidden = false;
    panel.scrollTop = 0;
    panel.querySelector('[data-close-zone]').addEventListener('click', () => {
      panel.hidden = true;
      panel.innerHTML = '';
    });
  };

  const container = root.querySelector('#fishMap');
  const hint = root.querySelector('#mapHint');

  let L;
  try {
    L = await loadLeaflet();
  } catch (err) {
    console.error('[map]', err);
    container.innerHTML = `
      <div class="notice notice--error" style="margin:16px">
        <h3>Map library did not load</h3>
        <p>${esc(err.message)}</p>
        <p>The zone list below still works.</p>
      </div>`;
    return;
  }

  const cfg = ctx.region.map || {};
  const center = cfg.center || ctx.region.coords;

  const map = L.map(container, {
    center: [center.lat, center.lon],
    zoom: cfg.zoom || 9,
    minZoom: cfg.minZoom || 6,
    maxZoom: cfg.maxZoom || 15,
    scrollWheelZoom: true,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  const markers = zones.map((zone) => {
    const marker = L.marker([zone.coords.lat, zone.coords.lon], {
      icon: L.divIcon({
        className: 'zone-pin-wrap',
        html: zoneMarkerHtml(zone),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      title: zone.name,
      alt: zone.name,
    });
    marker.on('click', () => openZone(zone));
    return { zone, marker };
  });

  // The broadest tier of pins — the ones that ask for the least zoom. Used as
  // the floor below, so there is always something on the map.
  const broadestZoom = Math.min(...zones.map((z) => z.minZoom ?? 0));

  // Reveal zones progressively: a pin shows once the map is zoomed in far
  // enough for it to be meaningful, so the view never turns into pin soup.
  function syncMarkers() {
    const zoom = map.getZoom();

    // Zoomed out further than any zone asks for, which the map's own minZoom
    // allows: every pin would fail its test and you'd get bare tiles with
    // "0 of 21 zones shown". Show the broadest tier instead. Clamping the
    // ZOOM to fix this was the old approach and it was worse — it cropped the
    // region to force a pin into view, so "the whole of Leyte" wasn't.
    //
    // At that last step out the broad gulf pins do touch, ~25px apart against
    // a 44px pin. Raising the map's minZoom would separate them, but it would
    // also crop the island on a landscape phone, where the pane is short
    // enough to need the wider zoom to fit. Overlap at the extreme beats
    // cutting the region off at a size people actually use.
    const floor = zoom < broadestZoom;

    let visible = 0;
    for (const { zone, marker } of markers) {
      const show = floor ? (zone.minZoom ?? 0) === broadestZoom : zoom >= (zone.minZoom ?? 0);
      if (show) {
        if (!map.hasLayer(marker)) marker.addTo(map);
        visible++;
      } else if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    }
    const hidden = markers.length - visible;
    hint.textContent = hidden
      ? `${visible} of ${markers.length} zones shown — zoom in for ${hidden} more`
      : `All ${markers.length} zones shown — tap a fish`;
  }

  map.on('zoomend', syncMarkers);
  syncMarkers();

  /**
   * The fallback view: the whole region. Used before a location is known and
   * whenever the device won't give one, so the map always shows something
   * useful rather than an arbitrary point of empty water.
   */
  function showWholeRegion() {
    const b = cfg.bounds;
    if (b) {
      const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
      // Whatever zoom actually fits the region, unclamped. If that lands
      // wider than any pin asks for, syncMarkers shows the broadest tier
      // rather than the view zooming in and cutting the island off.
      const fitZoom = map.getBoundsZoom(bounds, false, L.point(20, 20));
      map.setView(bounds.getCenter(), fitZoom, { animate: false });
    } else {
      const visible = markers.filter(({ zone }) => map.getZoom() >= (zone.minZoom ?? 0));
      if (visible.length) {
        map.fitBounds(
          L.latLngBounds(visible.map(({ zone }) => [zone.coords.lat, zone.coords.lon])),
          { padding: [50, 50], maxZoom: cfg.zoom || 9 }
        );
      }
    }
    syncMarkers();
  }

  showWholeRegion();

  // The container is sized by CSS after render, and again whenever the split
  // changes — rotating the phone, or the window crossing the desktop
  // breakpoint. Leaflet caches its size and renders half a map otherwise.
  setTimeout(() => map.invalidateSize(), 60);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
  }

  // --- follow the angler ---------------------------------------------------

  const LOCATE_ZOOM = 13;
  let youLayer = null;

  function showYouAreHere(fix) {
    if (youLayer) map.removeLayer(youLayer);
    youLayer = L.layerGroup([
      // Accuracy halo, so a poor fix doesn't look like false precision.
      L.circle([fix.lat, fix.lon], {
        radius: Math.max(fix.accuracyM, 25),
        color: '#F26430',
        weight: 2,
        fillColor: '#F26430',
        fillOpacity: 0.12,
      }),
      L.marker([fix.lat, fix.lon], {
        icon: L.divIcon({ className: 'you-pin-wrap', html: '<div class="you-pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        title: 'You are here',
        zIndexOffset: 1000,
      }),
    ]).addTo(map);
  }

  async function locate({ silent = false } = {}) {
    const btn = root.querySelector('#locateBtn');
    btn?.classList.add('is-busy');
    try {
      const fix = await getLocation();
      showYouAreHere(fix);
      map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), LOCATE_ZOOM));
      syncMarkers();

      // Being far outside the region is worth saying — otherwise the map just
      // looks empty and broken.
      //
      // The distance quoted is to the nearest ZONE, not to the region centre.
      // Those used to disagree: the centre is a single point kept fixed as the
      // tide-cache key, so once the region grew from one gulf to the whole
      // island it could be a hundred kilometres from the water nearest you,
      // and the message put that number next to a claim about zones.
      const near = nearestPlace(ctx.region, fix);
      if (!near) {
        hint.textContent = `No ${ctx.region.name} zones to compare against`;
      } else if (near.km > 60) {
        hint.textContent = `Nearest is ${near.name}, ~${Math.round(near.km)} km — no zones nearby`;
      } else {
        hint.textContent = `Nearest: ${near.name}, ~${Math.round(near.km)} km`;
      }
      return true;
    } catch (err) {
      // Any refusal or failure drops back to the whole region rather than
      // leaving the map wherever it happened to be.
      showWholeRegion();
      if (!silent) toast(err.message);
      return false;
    } finally {
      btn?.classList.remove('is-busy');
    }
  }

  root.querySelector('#locateBtn')?.addEventListener('click', () => locate());

  // --- weather deck paging -------------------------------------------------
  const deck = root.querySelector('#wxDeck');
  const dots = root.querySelector('#wxDots');
  if (deck && dots) {
    const syncDots = () => {
      // Round rather than floor: a snap can settle a pixel short of exact.
      const page = Math.round(deck.scrollLeft / Math.max(1, deck.clientWidth));
      for (const b of dots.querySelectorAll('[data-page]')) {
        b.setAttribute('aria-selected', String(Number(b.dataset.page) === page));
      }
    };
    deck.addEventListener('scroll', syncDots, { passive: true });
    dots.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn) return;
      deck.scrollTo({ left: Number(btn.dataset.page) * deck.clientWidth, behavior: 'smooth' });
    });
    syncDots();
  }

  // Ask on open. A browser only shows the prompt once — after that it answers
  // from the stored decision — so this is not a repeated interruption, and a
  // refusal simply leaves the whole-region view already on screen.
  if (geolocationSupported()) locate({ silent: true });

  // Handle for the browser test suite (tools/browser_test.py).
  container._leafletMap = map;
  container._locate = locate;
}
