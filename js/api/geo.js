// ---------------------------------------------------------------------------
// DEVICE LOCATION
//
// Used by the Conditions screen so weather and tides can follow you rather
// than being pinned to the region's centre point.
//
// Coordinates are deliberately ROUNDED before being handed to the tide API.
// WorldTides' free tier is roughly 100 requests/month and responses are cached
// per coordinate pair — with raw GPS, every few metres of drift would be a
// fresh cache key and a fresh request, draining the month's quota in an
// afternoon. Rounding to ~0.05 degrees (about 5 km) means everywhere within a
// few kilometres shares one cached response, which is well inside the
// catchment of any tide station anyway.
// ---------------------------------------------------------------------------

const GRID_DEG = 0.05;      // ~5.5 km
const TIMEOUT_MS = 12000;
const MAX_AGE_MS = 5 * 60 * 1000;

export function roundCoords({ lat, lon }, step = GRID_DEG) {
  const snap = (n) => Math.round(n / step) * step;
  return { lat: Number(snap(lat).toFixed(3)), lon: Number(snap(lon).toFixed(3)) };
}

export function geolocationSupported() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * @returns {Promise<{lat:number, lon:number, accuracyM:number}>}
 * @throws {Error} with a `code` of 'unsupported' | 'denied' | 'unavailable' |
 *         'timeout' so callers can explain the failure rather than guess.
 */
export function getLocation() {
  if (!geolocationSupported()) {
    const err = new Error('This browser cannot report a location.');
    err.code = 'unsupported';
    return Promise.reject(err);
  }
  // Geolocation needs a secure context; localhost counts as secure.
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    const err = new Error('Location needs a secure (https) connection.');
    err.code = 'unavailable';
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy || 0),
        }),
      (e) => {
        const map = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
        const messages = {
          denied: 'Location permission was refused. Allow it in your browser settings, or stay on the region.',
          unavailable: 'Your device could not get a fix. Try again outdoors.',
          timeout: 'Getting a location took too long. Try again with a clearer view of the sky.',
        };
        const code = map[e.code] || 'unavailable';
        const err = new Error(messages[code]);
        err.code = code;
        reject(err);
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS }
    );
  });
}

const EARTH_KM = 6371;

/** Great-circle distance in km — used to say how far you are from the region. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Is a point inside a `{ south, west, north, east }` box?
 *
 * Used for the country a region belongs to, not the region itself: a fix in
 * Manila is far from any Leyte zone but is somewhere this app can sensibly
 * show weather for, while a fix in Tokyo is not.
 *
 * No antimeridian handling — a box that wraps 180° would need west > east and
 * an OR here instead. Nothing this app ships is anywhere near it, and guessing
 * at the intent of an inverted box would hide a typo rather than catch it.
 */
export function withinBounds(coords, bounds) {
  if (!bounds || !coords) return true; // no box declared means no restriction
  return (
    coords.lat >= bounds.south &&
    coords.lat <= bounds.north &&
    coords.lon >= bounds.west &&
    coords.lon <= bounds.east
  );
}

/** Nearest named zone or spot in a region, so the readout has a place name. */
export function nearestPlace(region, coords) {
  const candidates = [...(region.zones || []), ...(region.spots || [])];
  let best = null;
  for (const c of candidates) {
    if (!c.coords) continue;
    const km = distanceKm(coords, c.coords);
    if (!best || km < best.km) best = { name: c.name, km };
  }
  return best;
}
