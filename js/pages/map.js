// Fishing map — zoom-aware zone pins over OpenStreetMap tiles.
//
// Each zone carries a `minZoom`, so broad offshore grounds show when zoomed
// out and small creeks only appear once you zoom in. Tapping a pin opens the
// species found there plus lure and retrieve recommendations.
//
// Leaflet is vendored in vendor/leaflet so the app has no CDN dependency.

import { resolveSpecies } from '../data/index.js';
import { tacticsFor, lureSummary, habitatTactics } from '../data/tactics.js';
import { getLocation, distanceKm, nearestPlace, geolocationSupported } from '../api/geo.js';
import { speciesSprite, icon, renderSprite, SPRITES } from '../pixel.js';
import { fetchWeather } from '../api/weather.js';
import { weatherHtml, forecastHtml, resolveCoords } from '../weather-ui.js';
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

const ZONE_PALETTE = {
  mangrove: 'emerald',
  estuary: 'emerald',
  flats: 'gold',
  reef: 'crimson',
  channel: 'ocean',
  bay: 'ocean',
  shallows: 'silver',
  offshore: 'violet',
};

/** A pixel fish in a bordered pill, used as the map marker. */
function markerHtml(zone) {
  const palette = ZONE_PALETTE[zone.type] || 'ocean';
  const sprite = renderSprite(SPRITES.perch, palette, { size: 34 });
  return `<div class="zone-pin" title="${esc(zone.name)}">${sprite}</div>`;
}

function zoneSheetHtml(zone) {
  const list = resolveSpecies(zone.species);
  const habitat = habitatTactics(zone.type);
  const lures = lureSummary(list);

  return `
    <p class="card__sub" style="margin-bottom:4px">
      ${esc(habitat?.label || zone.type)} &middot; ${esc(zone.depth || 'depth unknown')}
    </p>
    <p class="card__body" style="margin-bottom:14px">${esc(zone.blurb || '')}</p>

    ${
      zone.best
        ? `<div class="chips" style="margin-bottom:16px">
             <span class="chip chip--target">Best: ${esc(zone.best)}</span>
           </div>`
        : ''
    }

    ${
      habitat
        ? `<div class="notice" style="margin-bottom:18px">
             <h3>Fishing this water</h3>
             <p style="margin:0">${esc(habitat.advice)}</p>
           </div>`
        : ''
    }

    <h3 class="card__title" style="margin-bottom:10px">Possible catches in these waters (${list.length})</h3>
    <div class="grid grid--2" style="margin-bottom:18px">
      ${list
        .map((s) => {
          const t = tacticsFor(s);
          return `
          <div class="card card--tight">
            <div class="species-card__art" style="min-height:70px">${speciesSprite(s, { size: 110 })}</div>
            <h4 class="card__title" style="font-size:15px">${esc(s.common)}</h4>
            <p class="card__sub species-card__sci">${esc(s.scientific)}</p>
            ${
              s.local?.war?.[0]
                ? `<div class="chips"><span class="chip chip--local">${esc(s.local.war[0])}</span></div>`
                : ''
            }
            <details>
              <summary style="cursor:pointer;font-weight:800;font-size:13px">Lures &amp; retrieve</summary>
              <div class="chips" style="margin:8px 0">
                ${(t.lures || []).map((l) => `<span class="chip chip--tag">${esc(l)}</span>`).join('')}
              </div>
              <p class="card__body" style="font-size:13px">${esc(t.retrieve)}</p>
            </details>
            <a class="btn btn--sm" href="#/species?open=${esc(s.id)}">Species detail</a>
          </div>`;
        })
        .join('')}
    </div>

    <h3 class="card__title" style="margin-bottom:10px">Bring these</h3>
    <div class="chips" style="margin-bottom:18px">
      ${lures.map((l) => `<span class="chip chip--family">${esc(l)}</span>`).join('')}
    </div>

    <a class="btn btn--primary btn--block" href="#/log">Log a catch here</a>`;
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
        <div id="mapWeather">${loadingBlock('Fetching weather…')}</div>
        <div id="mapForecast"></div>
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
  const { coords, label } = await resolveCoords(ctx);
  if (source) {
    source.textContent = `${label} · ${round(coords.lat, 2)}°, ${round(coords.lon, 2)}°`;
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

  const openZone = (zone) => openSheet(zone.name, () => zoneSheetHtml(zone));

  for (const btn of root.querySelectorAll('[data-zone]')) {
    btn.addEventListener('click', () => {
      const z = zones.find((x) => x.id === btn.dataset.zone);
      if (z) openZone(z);
    });
  }

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
        html: markerHtml(zone),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      title: zone.name,
      alt: zone.name,
    });
    marker.on('click', () => openZone(zone));
    return { zone, marker };
  });

  // Reveal zones progressively: a pin shows once the map is zoomed in far
  // enough for it to be meaningful, so the view never turns into pin soup.
  function syncMarkers() {
    const zoom = map.getZoom();
    let visible = 0;
    for (const { zone, marker } of markers) {
      const show = zoom >= (zone.minZoom ?? 0);
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
  // The shallowest zone threshold. Fitting the whole region can land below
  // it — especially in a short, wide map pane — and then NOTHING qualifies to
  // show, leaving a map with no pins and no explanation.
  const shallowestZoom = Math.min(...zones.map((z) => z.minZoom ?? 0));

  function showWholeRegion() {
    const b = cfg.bounds;
    if (b) {
      const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
      // Work out the zoom first rather than fitting and correcting afterwards:
      // fitBounds may animate, so getZoom() straight after still reports the
      // old value and the clamp silently does nothing.
      const fitZoom = map.getBoundsZoom(bounds, false, L.point(20, 20));
      map.setView(bounds.getCenter(), Math.max(fitZoom, shallowestZoom), { animate: false });
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
      const near = nearestPlace(ctx.region, fix);
      const away = Math.round(distanceKm(fix, ctx.region.coords));
      if (!near || near.km > 60) {
        hint.textContent = `You're ~${away} km from ${ctx.region.name} — no zones nearby`;
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

  // Ask on open. A browser only shows the prompt once — after that it answers
  // from the stored decision — so this is not a repeated interruption, and a
  // refusal simply leaves the whole-region view already on screen.
  if (geolocationSupported()) locate({ silent: true });

  // Handle for the browser test suite (tools/browser_test.py).
  container._leafletMap = map;
  container._locate = locate;
}
