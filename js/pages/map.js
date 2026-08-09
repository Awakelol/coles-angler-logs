// Fishing map — zoom-aware zone pins over OpenStreetMap tiles.
//
// Each zone carries a `minZoom`, so broad offshore grounds show when zoomed
// out and small creeks only appear once you zoom in. Tapping a pin opens the
// species found there plus lure and retrieve recommendations.
//
// Leaflet is vendored in vendor/leaflet so the app has no CDN dependency.

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
      <!-- The nav bar is gone on this screen (app.js), so this row is the only
           way off the map. Phone only — the desktop rail is already visible. -->
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
        <!-- Phone only. The weather sits over the foot of the map as a drawer
             you can pull down for a bigger map, leaving the grip and the place
             name behind so there is something to pull back up. On a wide
             window it is a sidebar and this does nothing. -->
        <button class="wx-grip" id="wxGrip" aria-expanded="true" aria-controls="wxDeck"
                aria-label="Collapse the weather panel"><span></span></button>
        <div class="map-screen__bar">
          <p class="eyebrow" id="mapSource">${esc(ctx.region.name)}</p>
          <!-- Only appears once the weather is showing a tapped zone rather
               than you. It is the only thing on screen saying that what you
               are reading is somewhere you aren't, so it doubles as the
               indicator and the way back. -->
          <button class="map-screen__reset" id="wxReset" hidden
                  aria-label="Show the weather where I am again"
                  title="Back to my location">&times;</button>
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
        <!-- Over the map rather than above it in the layout: this screen is
             one screenful with no page scroll, and a real row would cost the
             height the drawer exists to give back. -->
        <div class="map-filters" id="mapFilters" role="group" aria-label="What to show on the map">
          <button class="map-filters__btn" data-layer="zones" aria-pressed="true">Zones</button>
          <button class="map-filters__btn" data-layer="spots" aria-pressed="true">Spots</button>
        </div>
        <!-- Separate from the filters on purpose: those choose what is drawn
             ON the map, this chooses what the map IS. Same pill styling so it
             is obviously the same class of control, its own group so the two
             questions don't read as one list. -->
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

// Rapid taps across zones start overlapping fetches, and they don't come back
// in the order they were sent. Without this the panel can settle on whichever
// request happened to be slowest rather than the zone you actually tapped.
let weatherSeq = 0;

/**
 * Weather panel above the map. Independent of Leaflet — if tiles fail to
 * load the forecast should still be there, and vice versa.
 *
 * @param {?{coords: object, name: string}} place a zone to show the weather
 *        for instead of the device location. Null means work it out: device
 *        fix if we have one and it's in the country, otherwise the region.
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

  // Where the person actually is, not a bearing and not the region name.
  // Coordinates are meaningless to read, and naming the region is wrong when
  // they're somewhere else entirely.
  //
  // A zone needs no lookup at all: its name is the one the user just tapped,
  // which beats whatever the reverse geocoder calls that patch of water.
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
  // Weather is not tied to zones — show it even for a region with none.
  mountWeather(root, ctx);
  if (!zones.length) return;

  const panel = root.querySelector('#zonePanel');
  const wideScreen = () => matchMedia('(min-width: 900px)').matches;

  // Tapping a zone also swings the weather panel onto it. Leyte is 150 km
  // end to end with an 8-knot strait at one end, so "the weather" is not one
  // thing across it — the conditions where you are standing can be no guide
  // at all to the water you were thinking of running out to.
  //
  // It stays on that zone until you dismiss it, deliberately: closing the
  // sheet is how you get a clear look at the weather you just asked for, so
  // reverting there would undo the thing you tapped for.
  root.querySelector('#wxReset')?.addEventListener('click', () => mountWeather(root, ctx));

  // On a wide window the zone belongs in the sidebar under the weather —
  // a modal over a map you're still reading is the wrong shape there. On a
  // phone there's no sidebar to put it in, so it stays a sheet.
  // The sheet can walk on to another zone from a fish's "possible in these
  // waters" list, so the weather follows the sheet rather than only the pin.
  const followWeather = (z) => mountWeather(root, ctx, { coords: z.coords, name: z.name });

  const openZone = (zone) => {
    followWeather(zone);
    if (!wideScreen() || !panel) {
      // mountZoneSheet fills the body itself, so the render callback only has
      // to hand openSheet something non-empty to size the sheet from.
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

  // Panning is fenced to the country the region belongs to. Without it you can
  // drag off into empty ocean and lose the map entirely, with nothing on screen
  // to tell you which way back — and every tile you drag through is a request
  // to OpenStreetMap for somewhere this app has nothing to say about.
  // Viscosity 1 makes it a wall rather than a rubber band; a soft edge on a
  // touchscreen just feels like the map is fighting you.
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
  // Street tiles are the better default: they name the towns and draw the
  // roads you use to reach the water. Satellite is what you want once you are
  // close in, where the drawn coastline is a generalisation and the imagery
  // shows the actual reef edge, the sandbar and the channel through it.
  //
  // Esri's World Imagery is free and needs no key, unlike Mapbox or Google.
  // It is their service on their terms, which are fine for personal use and
  // worth re-reading before anyone makes money from this.
  const basemaps = {
    map: () =>
      // No maxNativeZoom needed: OSM renders to 19 everywhere and simply
      // refuses beyond it, which the map's own maxZoom already prevents.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }),
    satellite: () =>
      L.layerGroup([
        // NOTE the {z}/{y}/{x} order — Esri serves row before column, and
        // getting it the usual way round yields a plausible-looking map of
        // somewhere else entirely.
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution:
              'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
            maxZoom: 19,
            // Esri's imagery over Leyte stops at 18. Ask for 19 and it does
            // NOT 404 — it returns a real tile reading "Map data not yet
            // available", so the map appears to break at the last zoom step.
            // maxNativeZoom stops the request and upscales the 18 tile
            // instead: soft, but continuous and still the right place.
            //
            // Measured, not assumed. The placeholder is byte-identical
            // wherever it appears, so fetching two tiles at one zoom and
            // comparing them finds the ceiling; over Leyte 18 is the last
            // level with real imagery everywhere.
            maxNativeZoom: 18,
          }
        ),
        // Imagery alone has no names on it. On open water that is most of the
        // screen, and a map you cannot read place names off is hard to use for
        // the one thing this is for — working out where you are going.
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

  // The broadest tier of pins — the ones that ask for the least zoom. Used as
  // the floor below, so there is always something on the map.
  const broadestZoom = Math.min(...zones.map((z) => z.minZoom ?? 0));

  // Reveal zones progressively: a pin shows once the map is zoomed in far
  // enough for it to be meaningful, so the view never turns into pin soup.
  // Filter state. Persisted: someone who fishes by their own marks shouldn't
  // have to switch the region's zones off on every visit.
  let showZones = prefs.get('mapShowZones', true) !== false;
  let showSpots = prefs.get('mapShowSpots', true) !== false;

  function syncMarkers() {
    const zoom = map.getZoom();

    if (!showZones) {
      for (const { marker } of markers) if (map.hasLayer(marker)) map.removeLayer(marker);
      hint.textContent = `Zones hidden — ${markers.length} in this region`;
      return;
    }

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

      // Outside the country, flying to the fix would be pointless twice over:
      // maxBounds would drag the view back to the border anyway, and the
      // "you are here" dot would be left somewhere off screen implying the
      // map had simply broken. Say where they are instead, and keep the
      // region on screen — which is the thing they opened the app to see.
      if (!withinBounds(fix, cfg.panBounds)) {
        showWholeRegion();
        hint.textContent =
          `You're outside ${ctx.region.country || ctx.region.name} — showing ${ctx.region.name}`;
        return true;
      }

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

  // Pressing "centre on me" means me — including in the weather panel, if a
  // zone had taken it over. Only on a deliberate press: the silent attempt on
  // open happens before any zone can have been tapped.
  root.querySelector('#locateBtn')?.addEventListener('click', () => {
    mountWeather(root, ctx);
    locate();
  });

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

  // Your own marks, on top of the region's zones.
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

  // --- the weather drawer (phone only) -------------------------------------
  //
  // On a phone the weather sits over the foot of the map and pulls down out of
  // the way, leaving its grip and the place name behind. The map is the reason
  // this screen exists; the forecast is what you glance at before deciding to
  // look at it. A fixed split made both worse on a short phone.
  //
  // The drag is hand-rolled for the same reason the long-press is: a finger on
  // the grip has to be told apart from a finger scrolling the panel's own
  // contents, and no built-in gesture knows the difference.

  const drawer = root.querySelector('#wxDrawer');
  const grip = root.querySelector('#wxGrip');

  if (drawer && grip) {
    // How much stays on screen when it is down. Measured rather than guessed:
    // a long place name wraps the bar and a hardcoded value would clip it.
    const measurePeek = () => {
      const bar = root.querySelector('.map-screen__bar');
      if (!bar) return 56;
      const top = drawer.getBoundingClientRect().top;
      return Math.ceil(bar.getBoundingClientRect().bottom - top + 8);
    };
    const screen = root.querySelector('.map-screen');
    const applyPeek = () => drawer.style.setProperty('--wx-peek', `${measurePeek()}px`);

    // How much of the map the drawer is covering right now, so the locate
    // button and the zone hint can sit above it instead of behind it.
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
      // Leaflet caches its size; the map's visible area just changed.
      setTimeout(() => map.invalidateSize(), 260);
    };

    // The bar's height isn't final until the place name has resolved.
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
      // Clamped both ways: dragging past either end should feel like the end,
      // not detach the panel from the bottom of the screen.
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
      // A tap toggles; a drag settles wherever it passed halfway.
      setCollapsed(moved ? dy > travel() / 2 : !collapsed);
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);

    grip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); }
    });

    // Crossing the desktop breakpoint changes what the panel even is.
    const wide = matchMedia('(min-width: 900px)');
    wide.addEventListener('change', () => {
      drawer.style.transform = '';
      applyPeek();
    });

    container._wxDrawer = { setCollapsed, isCollapsed: () => collapsed, measurePeek };
  }

  // Handle for the browser test suite (tools/browser_test.py).
  container._leafletMap = map;
  container._locate = locate;
  container._userSpots = userSpots;
}
