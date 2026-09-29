// User map spots: long-press the map to drop a named mark and get directions
// to it later. Unlike the region's zones and spots these belong to one account.
//
// Long-press is done by hand (timer on pointerdown, cancelled by movement or
// release) because Leaflet's contextmenu doesn't fire on every touch browser
// and can't tell a press from the start of a pan. Right-click covers desktop.

import { store } from './store.js';
import { currentUser, isSignedIn } from './auth.js';
import { zonesFor } from './data/index.js';
import { distanceKm } from './api/geo.js';
import { icon } from './art.js';
import { esc, toast } from './ui.js';

const LONG_PRESS_MS = 550;
// Movement allowed before a press turns into a pan.
const MOVE_TOLERANCE_PX = 12;

const NAME_MAX = 60;

/**
 * Directions link: Apple Maps on Apple devices, Google Maps elsewhere. Both
 * are https links, so a wrong guess still opens a working map. (iPadOS
 * reports itself as Macintosh.)
 */
export function directionsUrl({ lat, lon }, ua = navigator.userAgent) {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(ua);
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return apple
    ? `https://maps.apple.com/?daddr=${at}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${at}`;
}

/** Nearest zone as a phrase, e.g. "Off Cancabato Bay · ~3 km". */
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

/** Marker for a user spot (a hook, not a fish, to tell it from zones). */
function spotMarkerHtml(spot) {
  return `<div class="my-spot-pin" title="${esc(spot.name)}">
            ${icon('hook', { size: 26, palette: 'sunset' })}
          </div>`;
}

/**
 * Add user spots to a Leaflet map.
 *
 * @param {object} L        the Leaflet namespace
 * @param {object} map      the map instance
 * @param {string} regionId spots are per region as well as per user
 * @returns {{destroy: Function, reload: Function}}
 */
export function mountUserSpots(L, map, regionId, { visible = true } = {}) {
  const layer = L.layerGroup();
  let shown = visible;
  if (shown) layer.addTo(map);
  const container = map.getContainer();

  const userId = () => currentUser()?.id || null;

  // Spots need an account. allSpots(null) would return every user's spots.
  const signedIn = () => isSignedIn();

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

    // Keep taps in the popup from reaching the map.
    L.DomEvent.disableClickPropagation(el);
    return el;
  }

  async function reload() {
    layer.clearLayers();
    if (!signedIn()) return 0;
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
      marker.bindPopup(() => popupFor(spot), { className: 'spot-popup' });
      marker.addTo(layer);
    }
    return spots.length;
  }

  // --- adding --------------------------------------------------------------

  /** Long press while signed out: explain that spots need an account. */
  function askToSignIn(latlng) {
    const el = document.createElement('div');
    el.className = 'spot-pop';
    el.innerHTML = `
      <h3 class="spot-pop__name">Save this spot?</h3>
      <p class="spot-pop__at">${esc(nearZone(regionId, { lat: latlng.lat, lon: latlng.lng }))}</p>
      <p class="spot-pop__why">
        Spots are saved to your account, so they follow you between devices and
        stay yours on a shared phone.
      </p>
      <div class="spot-pop__row">
        <a class="btn btn--sm btn--primary" href="#/log">Sign in or sign up</a>
        <button class="btn btn--sm" data-cancel>Not now</button>
      </div>`;
    el.querySelector('[data-cancel]').addEventListener('click', () => map.closePopup());
    L.DomEvent.disableClickPropagation(el);
    L.popup({ className: 'spot-popup', closeButton: false, autoPan: true })
      .setLatLng(latlng)
      .setContent(el)
      .openOn(map);
  }

  function askToAdd(latlng) {
    if (!signedIn()) return askToSignIn(latlng);

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

    // Stop Leaflet treating typing and dragging in the field as map shortcuts/pans.
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    L.DomEvent.on(el, 'keydown keypress keyup', L.DomEvent.stopPropagation);

    L.popup({ className: 'spot-popup', closeButton: false, autoPan: true })
      .setLatLng(latlng)
      .setContent(el)
      .openOn(map);

    // Delay focus so the keyboard doesn't fight the popup's auto-pan.
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
    // Don't add pins while spots are hidden.
    if (!shown) return;
    // Primary button only, and not on existing markers/popups/controls.
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
  // Panning or zooming cancels the press.
  map.on('movestart zoomstart', cancel);

  // Suppress the iOS long-press callout.
  const onContextMenu = (e) => e.preventDefault();
  container.addEventListener('contextmenu', onContextMenu);
  // Right-click on desktop.
  map.on('contextmenu', (e) => { if (shown) askToAdd(e.latlng); });

  reload();

  return {
    reload,
    /** Hide/show without unloading. */
    setVisible(next) {
      shown = !!next;
      if (shown) layer.addTo(map);
      else {
        map.closePopup();
        layer.remove();
      }
    },
    count: () => layer.getLayers().length,
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
