// Fishing map: zone pins over OpenStreetMap tiles, with the weather panel.
//
// Each zone has a `minZoom`, so offshore grounds show when zoomed out and small
// creeks only appear up close. Tapping a pin opens the zone's species and
// tactics. Leaflet is vendored in vendor/leaflet.

import { getLocation, nearestPlace, geolocationSupported, withinBounds } from '../api/geo.js';
import { icon } from '../art.js';
import { fetchWeather } from '../api/weather.js';
import { placeName } from '../api/place.js';
import { weatherHtml, forecastHtml, resolveCoords } from '../weather-ui.js';
import { zoneMarkerHtml, zoneSheetHtml, mountZoneSheet } from '../zone-ui.js';
import { mountUserSpots } from '../map-spots.js';
import { esc, openSheet, toast, loadingBlock, errorBlock, round } from '../ui.js';
import { prefs } from '../store.js';

let leafletPromise = null;

/** Load the vendored Leaflet bundle once. */
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
      <!-- phone only: the nav bar is hidden on the map -->
      <div class="map-screen__top">
        <a class="map-screen__back" href="#/">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
                  stroke-linejoin="round" d="M15 5l-7 7 7 7"/>
          </svg>
          Home
        </a>
        <p class="map-screen__where">${esc(ctx.region.name)}</p>
      </div>

      <div class="map-screen__info" id="wxDrawer">
        <!-- phone only: drag handle for the weather drawer -->
        <button class="wx-grip" id="wxGrip" aria-expanded="true" aria-controls="wxDeck"
                aria-label="Collapse the weather panel"><span></span></button>
        <div class="map-screen__bar">
          <p class="eyebrow" id="mapSource">${esc(ctx.region.name)}</p>
          <!-- shown while the weather is for a tapped zone -->
          <button class="map-screen__reset" id="wxReset" hidden
                  aria-label="Show the weather where I am again"
                  title="Back to my location">&times;</button>
          <a class="map-screen__link" href="#/conditions">Tides &amp; forecast &rarr;</a>
        </div>
        <!-- conditions and 5-day forecast, side by side with scroll-snap -->
        <div class="wx-deck" id="wxDeck">
          <section class="wx-deck__page" id="mapWeather"
                   aria-label="Current conditions">${loadingBlock('Fetching weather…')}</section>
          <section class="wx-deck__page" id="mapForecast" aria-label="Five day forecast"></section>
        </div>
        <div class="wx-dots" id="wxDots" role="tablist" aria-label="Weather pages">
          <button role="tab" data-page="0" aria-label="Current conditions" aria-selected="true"></button>
          <button role="tab" data-page="1" aria-label="Five day forecast" aria-selected="false"></button>
        </div>

        <!-- desktop: zone details render here -->
        <div id="zonePanel" hidden></div>
      </div>

      <div id="mapWrap">
        <div id="fishMap" role="application" aria-label="Fishing zone map"></div>
        <div class="map-filters" id="mapFilters" role="group" aria-label="What to show on the map">
          <button class="map-filters__btn" data-layer="zones" aria-pressed="true">Zones</button>
          <button class="map-filters__btn" data-layer="spots" aria-pressed="true">Spots</button>
        </div>
        <!-- basemap toggle -->
        <div class="map-filters map-filters--base">
          <button class="map-filters__btn" id="basemapBtn" aria-pressed="false"
                  aria-label="Switch between street map and satellite imagery">Map</button>
        </div>
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

// Ignore responses from earlier requests when zones are tapped quickly.
let weatherSeq = 0;

/**
 * Weather panel above the map (independent of Leaflet).
 *
 * @param {?{coords: object, name: string}} place zone to show weather for, or
 *        null to use the device location (or the region if unavailable)
 */
async function mountWeather(root, ctx, place = null) {
  const pane = root.querySelector('#mapWeather');
  const strip = root.querySelector('#mapForecast');
  const source = root.querySelector('#mapSource');
  const reset = root.querySelector('#wxReset');
  if (!pane) return;

  const mine = ++weatherSeq;
  const stale = () => mine !== weatherSeq;

  const tz = ctx.region.timezone;
  const resolved = place ? { coords: place.coords, source: 'zone' } : await resolveCoords(ctx);
  if (stale()) return;
  const { coords, source: kind } = resolved;

  if (reset) reset.hidden = !place;

  // Label: the zone's name if one was tapped, otherwise a reverse-geocoded
  // place name for the device location.
  if (source) {
    if (place) {
      source.textContent = place.name;
    } else {
      source.textContent = kind === 'device' ? 'Locating…' : ctx.region.name;
      placeName(coords).then((name) => {
        if (stale()) return;
        if (name) source.textContent = name;
        else if (kind === 'device') source.textContent = 'Your location';
      });
    }
  }

  try {
    const w = await fetchWeather(coords, tz);
    if (stale()) return;
    pane.innerHTML = weatherHtml(w, tz);
    if (strip) strip.innerHTML = forecastHtml(w, tz, { compact: true });
  } catch (err) {
    if (stale()) return;
    console.error('[map weather]', err);
    pane.innerHTML = errorBlock('Could not load weather', err.message, 'Try again');
    if (strip) strip.innerHTML = '';
    pane.querySelector('[data-retry]')?.addEventListener('click', () => mountWeather(root, ctx, place));
  }
}

export async function mount(root, ctx) {
  const zones = ctx.region.zones || [];
  // Show weather even for a region with no zones.
  mountWeather(root, ctx);
  if (!zones.length) return;

  const panel = root.querySelector('#zonePanel');
  const wideScreen = () => matchMedia('(min-width: 900px)').matches;

  // Tapping a zone switches the weather panel to that zone (conditions vary a
  // lot across Leyte). It stays until dismissed, even after the sheet closes.
  root.querySelector('#wxReset')?.addEventListener('click', () => mountWeather(root, ctx));

  // Desktop: zone details go in the sidebar. Phone: a bottom sheet. The
  // weather follows when the sheet moves on to another zone.
  const followWeather = (z) => mountWeather(root, ctx, { coords: z.coords, name: z.name });

  const openZone = (zone) => {
    followWeather(zone);
    if (!wideScreen() || !panel) {
      // mountZoneSheet fills the body; openSheet just needs something to size from.
      openSheet(zone.name, () => zoneSheetHtml(zone), (sheetRoot) =>
        mountZoneSheet(sheetRoot, zone, ctx.regionId, { onZone: followWeather })
      );
      return;
    }
    panel.innerHTML = `
      <div class="zone-panel__head">
        <h2>${esc(zone.name)}</h2>
        <button class="icon-btn" data-close-zone aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
        </button>
      </div>
      <div data-zone-body></div>`;
    mountZoneSheet(panel, zone, ctx.regionId, { onZone: followWeather });
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

  // Keep panning inside the country (hard edge, no rubber band).
  const pb = cfg.panBounds;
  const map = L.map(container, {
    center: [center.lat, center.lon],
    zoom: cfg.zoom || 9,
    minZoom: cfg.minZoom || 6,
    maxZoom: cfg.maxZoom || 15,
    scrollWheelZoom: true,
    ...(pb
      ? {
          maxBounds: L.latLngBounds([pb.south, pb.west], [pb.north, pb.east]),
          maxBoundsViscosity: 1.0,
        }
      : {}),
  });

  // --- basemaps ------------------------------------------------------------
  //
  // Street map by default; satellite (Esri World Imagery, free, no key) for
  // close-in detail like reef edges and channels. Check Esri's terms before
  // any commercial use.
  const basemaps = {
    map: () =>
      // OSM goes to 19, same as the map's maxZoom.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }),
    satellite: () =>
      L.layerGroup([
        // Esri uses {z}/{y}/{x} (row before column).
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution:
              'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
            maxZoom: 19,
            // Esri imagery over Leyte stops at 18. Past that it returns a
            // "Map data not yet available" tile instead of a 404, so cap the
            // native zoom and let Leaflet upscale.
            maxNativeZoom: 18,
          }
        ),
        // Place-name labels on top of the imagery.
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 19, maxNativeZoom: 18, pane: 'shadowPane' }
        ),
      ]),
  };

  let baseName = prefs.get('mapBasemap', 'map') === 'satellite' ? 'satellite' : 'map';
  let baseLayer = basemaps[baseName]().addTo(map);

  function setBasemap(name) {
    if (!basemaps[name] || name === baseName) return;
    map.removeLayer(baseLayer);
    baseName = name;
    baseLayer = basemaps[name]().addTo(map);
    prefs.set('mapBasemap', name);
    const btn = root.querySelector('#basemapBtn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(name === 'satellite'));
      btn.textContent = name === 'satellite' ? 'Satellite' : 'Map';
    }
  }

  root.querySelector('#basemapBtn')?.addEventListener('click', () => {
    setBasemap(baseName === 'satellite' ? 'map' : 'satellite');
  });
  {
    const btn = root.querySelector('#basemapBtn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(baseName === 'satellite'));
      btn.textContent = baseName === 'satellite' ? 'Satellite' : 'Map';
    }
  }

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

  // Lowest minZoom of any zone; used as a floor so the map is never empty.
  const broadestZoom = Math.min(...zones.map((z) => z.minZoom ?? 0));

  // Filters, remembered between visits.
  let showZones = prefs.get('mapShowZones', true) !== false;
  let showSpots = prefs.get('mapShowSpots', true) !== false;

  function syncMarkers() {
    const zoom = map.getZoom();

    if (!showZones) {
      for (const { marker } of markers) if (map.hasLayer(marker)) map.removeLayer(marker);
      hint.textContent = `Zones hidden — ${markers.length} in this region`;
      return;
    }

    // Zoomed out past every zone's minZoom: show the broadest tier instead
    // of an empty map. (Clamping the zoom would crop the island on small
    // screens, so some overlap at the widest zoom is accepted.)
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

  /** Fit the whole region. Used until a location is known, or without one. */
  function showWholeRegion() {
    const b = cfg.bounds;
    if (b) {
      const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
      // Don't clamp; syncMarkers handles zooms wider than any pin.
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

  // Leaflet caches its container size, so tell it when the layout changes.
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
      // Accuracy circle.
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

      // Outside the country: keep the region in view and say where they are.
      if (!withinBounds(fix, cfg.panBounds)) {
        showWholeRegion();
        hint.textContent =
          `You're outside ${ctx.region.country || ctx.region.name} — showing ${ctx.region.name}`;
        return true;
      }

      showYouAreHere(fix);
      map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), LOCATE_ZOOM));
      syncMarkers();

      // Far from the region: say so, with the distance to the nearest zone
      // (the region centre can be far from any water).
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
      // On failure, fall back to the whole-region view.
      showWholeRegion();
      if (!silent) toast(err.message);
      return false;
    } finally {
      btn?.classList.remove('is-busy');
    }
  }

  // An explicit "centre on me" also takes the weather back from a zone.
  root.querySelector('#locateBtn')?.addEventListener('click', () => {
    mountWeather(root, ctx);
    locate();
  });

  // --- weather deck paging -------------------------------------------------
  const deck = root.querySelector('#wxDeck');
  const dots = root.querySelector('#wxDots');
  if (deck && dots) {
    const syncDots = () => {
      // Round, since snapping can land a pixel short.
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

  // Ask for location on open. Browsers only prompt once; a refusal just
  // leaves the region view.
  if (geolocationSupported()) locate({ silent: true });

  // User spots on top of the zones.
  const userSpots = mountUserSpots(L, map, ctx.regionId, { visible: showSpots });

  // --- layer filters -------------------------------------------------------

  const filters = root.querySelector('#mapFilters');
  filters?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layer]');
    if (!btn) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    if (btn.dataset.layer === 'zones') {
      showZones = on;
      prefs.set('mapShowZones', on);
      syncMarkers();
    } else {
      showSpots = on;
      prefs.set('mapShowSpots', on);
      userSpots.setVisible(on);
    }
  });
  for (const btn of filters?.querySelectorAll('[data-layer]') || []) {
    btn.setAttribute('aria-pressed',
      String(btn.dataset.layer === 'zones' ? showZones : showSpots));
  }

  // --- weather drawer (phone only) -----------------------------------------
  //
  // The weather panel sits over the bottom of the map and can be dragged down
  // out of the way, leaving the grip and place name visible. Dragging is done
  // by hand so it doesn't interfere with scrolling inside the panel.

  const drawer = root.querySelector('#wxDrawer');
  const grip = root.querySelector('#wxGrip');

  if (drawer && grip) {
    // Height left showing when collapsed (measured; long names wrap).
    const measurePeek = () => {
      const bar = root.querySelector('.map-screen__bar');
      if (!bar) return 56;
      const top = drawer.getBoundingClientRect().top;
      return Math.ceil(bar.getBoundingClientRect().bottom - top + 8);
    };
    const screen = root.querySelector('.map-screen');
    const applyPeek = () => drawer.style.setProperty('--wx-peek', `${measurePeek()}px`);

    // Expose how much map is covered so the locate button can sit above it.
    const applyVisible = () => {
      const px = collapsed ? measurePeek() : Math.round(drawer.getBoundingClientRect().height);
      screen?.style.setProperty('--wx-visible', `${px}px`);
    };

    let collapsed = prefs.get('mapDrawerDown', false) === true;
    const setCollapsed = (next, remember = true) => {
      collapsed = next;
      applyPeek();
      drawer.classList.toggle('is-collapsed', collapsed);
      grip.setAttribute('aria-expanded', String(!collapsed));
      grip.setAttribute('aria-label',
        collapsed ? 'Expand the weather panel' : 'Collapse the weather panel');
      applyVisible();
      if (remember) prefs.set('mapDrawerDown', collapsed);
      // Leaflet caches its size.
      setTimeout(() => map.invalidateSize(), 260);
    };

    // Re-measure once the place name has loaded.
    applyPeek();
    setTimeout(() => { applyPeek(); applyVisible(); }, 800);
    setCollapsed(collapsed, false);

    let dragging = false;
    let startY = 0;
    let startCollapsed = false;
    let dy = 0;
    let moved = false;

    const travel = () => Math.max(1, drawer.getBoundingClientRect().height - measurePeek());

    grip.addEventListener('pointerdown', (e) => {
      if (wideScreen()) return;
      dragging = true;
      moved = false;
      startY = e.clientY;
      startCollapsed = collapsed;
      dy = 0;
      grip.setPointerCapture(e.pointerId);
      drawer.classList.add('is-dragging');
    });

    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const max = travel();
      // Clamp at both ends.
      dy = Math.min(max, Math.max(0, (startCollapsed ? max : 0) + (e.clientY - startY)));
      if (Math.abs(e.clientY - startY) > 4) moved = true;
      drawer.style.transform = `translateY(${dy}px)`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { grip.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      drawer.classList.remove('is-dragging');
      drawer.style.transform = '';
      // Tap toggles; a drag snaps to the nearer end.
      setCollapsed(moved ? dy > travel() / 2 : !collapsed);
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);

    grip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); }
    });

    // Re-evaluate when crossing the desktop breakpoint.
    const wide = matchMedia('(min-width: 900px)');
    wide.addEventListener('change', () => {
      drawer.style.transform = '';
      applyPeek();
    });

    container._wxDrawer = { setCollapsed, isCollapsed: () => collapsed, measurePeek };
  }

  // Exposed for tools/browser_test.py.
  container._leafletMap = map;
  container._locate = locate;
  container._userSpots = userSpots;
}
