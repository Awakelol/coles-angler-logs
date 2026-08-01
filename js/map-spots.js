// ---------------------------------------------------------------------------
// YOUR OWN SPOTS ON THE MAP
//
// Long-press anywhere on the water to drop a mark, name it, and get directions
// to it later. Distinct from the zones and `region.spots` that ship with a
// region: those are the same for everybody, these belong to one account.
//
// LONG-PRESS IS HAND-ROLLED rather than using Leaflet's `contextmenu`. That
// event does fire on some touch browsers, but not all, and where it does the
// timing isn't ours to set. Worse, it gives no way to distinguish a press from
// the start of a pan — which on a map is the gesture people actually make most
// of the time. So: a timer armed on pointerdown, cancelled by movement past a
// few pixels or by the finger lifting early. Right-click is wired separately
// for a desktop mouse, where a long press is not a gesture anyone makes.
// ---------------------------------------------------------------------------

import { store } from './store.js';
import { currentUser } from './auth.js';
import { zonesFor } from './data/index.js';
import { distanceKm } from './api/geo.js';
import { icon } from './pixel.js';
import { esc, toast } from './ui.js';

const LONG_PRESS_MS = 550;
// Fingers wobble. Under this the press still counts; over it the user was
// starting to pan and must not get a popup thrown in their way.
const MOVE_TOLERANCE_PX = 12;

const NAME_MAX = 60;

/**
 * Directions link for a coordinate.
 *
 * Apple devices get Apple Maps, everything else gets Google. Both are plain
 * https links that also work in a desktop browser, so a wrong guess degrades
 * to a working map rather than a dead scheme URL — which is exactly why this
 * doesn't use `maps://`.
 *
 * iPads have reported themselves as Macintosh since iPadOS 13, hence the
 * touch-points check rather than trusting the platform string alone.
 */
export function directionsUrl({ lat, lon }, ua = navigator.userAgent) {
  const apple =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Mac/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) ||
    /Macintosh/.test(ua);
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return apple
    ? `https://maps.apple.com/?daddr=${at}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${at}`;
}

/**
 * The nearest of the region's zones, as a phrase.
 *
 * A spot is somewhere off a landmark, not a pair of decimals. The map screen
 * already refuses to show coordinates as a location for the same reason —
 * "11.2380, 125.0040" tells you nothing you can act on, and "Off Cancabato
 * Bay, ~3 km" tells you where you are about to go.
 */
function nearZone(regionId, at) {
  let best = null;
  for (const z of zonesFor(regionId)) {
    if (!z.coords) continue;
    const km = distanceKm(at, z.coords);
    if (!best || km < best.km) best = { name: z.name, km };
  }
  if (!best) return '';
  const km = best.km < 1 ? '<1' : Math.round(best.km);
  return `Off ${best.name} · ~${km} km`;
}

/** The pin for one of your own spots. Deliberately not a fish. */
function spotMarkerHtml(spot) {
  return `<div class="my-spot-pin" title="${esc(spot.name)}">
            ${icon('hook', { size: 26, palette: 'sunset' })}
          </div>`;
}

/**
 * Attach the whole feature to a live Leaflet map.
 *
 * @param {object} L        the Leaflet namespace
 * @param {object} map      the map instance
 * @param {string} regionId spots are per region as well as per user
 * @returns {{destroy: Function, reload: Function}}
 */
export function mountUserSpots(L, map, regionId) {
  const layer = L.layerGroup().addTo(map);
  const container = map.getContainer();

  const userId = () => currentUser()?.id || null;

  // --- rendering -----------------------------------------------------------

  function popupFor(spot) {
    const el = document.createElement('div');
    el.className = 'spot-pop';
    el.innerHTML = `
      <h3 class="spot-pop__name">${esc(spot.name)}</h3>
      <p class="spot-pop__at">${esc(nearZone(regionId, { lat: spot.lat, lon: spot.lon }))}</p>
      <div class="spot-pop__row">
        <a class="btn btn--sm btn--primary" data-directions
           href="${esc(directionsUrl(spot))}" target="_blank" rel="noopener noreferrer">Directions</a>
        <button class="btn btn--sm" data-remove>Remove</button>
      </div>`;

    el.querySelector('[data-remove]').addEventListener('click', async () => {
      await store.deleteSpot(spot.id);
      map.closePopup();
      await reload();
      toast(`Removed ${spot.name}`);
    });

    // Without this a tap inside the popup reaches the map underneath.
    L.DomEvent.disableClickPropagation(el);
    return el;
  }

  async function reload() {
    layer.clearLayers();
    const spots = await store.allSpots(userId(), regionId);
    for (const spot of spots) {
      const marker = L.marker([spot.lat, spot.lon], {
        icon: L.divIcon({
          className: 'my-spot-wrap',
          html: spotMarkerHtml(spot),
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
        title: spot.name,
        alt: spot.name,
      });
      // Built fresh each open, so the nearest-zone line is right even if the
      // region's zones have changed since the spot was dropped.
      marker.bindPopup(() => popupFor(spot), { className: 'spot-popup' });
      marker.addTo(layer);
    }
    return spots.length;
  }

  // --- adding --------------------------------------------------------------

  function askToAdd(latlng) {
    const el = document.createElement('div');
    el.className = 'spot-pop';
    el.innerHTML = `
      <h3 class="spot-pop__name">Add spot?</h3>
      <p class="spot-pop__at">${esc(nearZone(regionId, { lat: latlng.lat, lon: latlng.lng }))}</p>
      <input type="text" data-name maxlength="${NAME_MAX}" placeholder="Name it — e.g. the deep hole"
             aria-label="Name for this spot" autocomplete="off">
      <div class="spot-pop__row">
        <button class="btn btn--sm btn--primary" data-save>Add spot</button>
        <button class="btn btn--sm" data-cancel>Cancel</button>
      </div>`;

    const input = el.querySelector('[data-name]');
    const save = async () => {
      const name = input.value.trim().slice(0, NAME_MAX);
      if (!name) {
        input.focus();
        toast('Give the spot a name first');
        return;
      }
      await store.saveSpot({
        userId: userId(),
        regionId,
        name,
        lat: latlng.lat,
        lon: latlng.lng,
      });
      map.closePopup();
      await reload();
      toast(`Saved ${name}`);
    };

    el.querySelector('[data-save]').addEventListener('click', save);
    el.querySelector('[data-cancel]').addEventListener('click', () => map.closePopup());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') map.closePopup();
    });

    // Leaflet treats keystrokes over the map as shortcuts (+/- zoom) and a
    // drag inside the popup as a pan, so the field needs both stopped or you
    // cannot type a name containing a minus, or select text in it.
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    L.DomEvent.on(el, 'keydown keypress keyup', L.DomEvent.stopPropagation);

    L.popup({ className: 'spot-popup', closeButton: false, autoPan: true })
      .setLatLng(latlng)
      .setContent(el)
      .openOn(map);

    // Deferred: opening the popup moves focus about, and on a phone raising
    // the keyboard immediately fights the map's auto-pan.
    setTimeout(() => input.focus(), 120);
  }

  // --- the gesture ---------------------------------------------------------

  let timer = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  const onDown = (e) => {
    // Only a primary press, and never on something already on the map — a long
    // press on a zone pin is someone hesitating over it, not asking for a
    // second pin on top.
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control')) return;

    startX = e.clientX;
    startY = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      const rect = container.getBoundingClientRect();
      const point = L.point(startX - rect.left, startY - rect.top);
      askToAdd(map.containerPointToLatLng(point));
    }, LONG_PRESS_MS);
  };

  const onMove = (e) => {
    if (!timer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) cancel();
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', cancel);
  container.addEventListener('pointercancel', cancel);
  container.addEventListener('pointerleave', cancel);
  // The map moving under a still finger is also not a press.
  map.on('movestart zoomstart', cancel);

  // iOS raises its own callout on a long press and would cover the popup.
  const onContextMenu = (e) => e.preventDefault();
  container.addEventListener('contextmenu', onContextMenu);
  // A mouse has no long press worth making; right-click is the same intent.
  map.on('contextmenu', (e) => askToAdd(e.latlng));

  reload();

  return {
    reload,
    destroy() {
      cancel();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', cancel);
      container.removeEventListener('pointercancel', cancel);
      container.removeEventListener('pointerleave', cancel);
      container.removeEventListener('contextmenu', onContextMenu);
      map.off('movestart zoomstart', cancel);
      layer.clearLayers();
    },
  };
}
