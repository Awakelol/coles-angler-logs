// Device location, used so weather and tides follow the user.
//
// Coordinates are rounded to ~0.05° (~5 km) before being used as a tide cache
// key. WorldTides' free tier is ~100 requests/month, and raw GPS jitter would
// otherwise make every reading a cache miss.

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
 * @throws {Error} with `code` 'unsupported' | 'denied' | 'unavailable' | 'timeout'
 */
export function getLocation() {
  if (!geolocationSupported()) {
    const err = new Error('This browser cannot report a location.');
    err.code = 'unsupported';
    return Promise.reject(err);
  }
  // Needs a secure context (https or localhost).
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

/** Great-circle distance in km. */
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
 * Is a point inside a `{ south, west, north, east }` box? Used with the
 * region's country bounds. Doesn't handle boxes crossing the antimeridian.
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

/** Nearest named zone or spot in a region. */
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
