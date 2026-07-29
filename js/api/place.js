// ---------------------------------------------------------------------------
// REVERSE GEOCODING — turning coordinates into a place name
//
// "11.24°, 125.00°" tells an angler nothing. "Tacloban City" does.
//
// Uses BigDataCloud's reverse-geocode-client endpoint: no API key, no signup,
// and explicitly intended to be called from a browser. Nominatim would be the
// obvious alternative but its usage policy requires an identifying User-Agent,
// which a page cannot set, so calling it from client JS is off-policy.
//
// Results are cached hard — a coordinate's name does not change — and keyed to
// a rounded grid so drifting a few metres doesn't trigger a fresh lookup.
// ---------------------------------------------------------------------------

const CACHE_KEY = 'angler.placecache';
const ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const GRID = 0.02; // ~2 km — well inside one locality

const snap = (n) => Math.round(n / GRID) * GRID;
const cellKey = ({ lat, lon }) => `${snap(lat).toFixed(2)},${snap(lon).toFixed(2)}`;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return {};
  }
}

function writeCache(all) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}

const inFlight = new Map();

/**
 * Best available name for a position, most specific first.
 * @returns {Promise<string|null>} e.g. "Tacloban City, Leyte" — null if the
 *          lookup fails, so callers can fall back rather than show an error.
 */
export function placeName(coords) {
  if (!coords) return Promise.resolve(null);
  const key = cellKey(coords);

  const cached = readCache()[key];
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight.has(key)) return inFlight.get(key);

  const url = `${ENDPOINT}?latitude=${coords.lat}&longitude=${coords.lon}&localityLanguage=en`;
  const req = fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      if (!d) return null;
      // Offshore positions have no locality at all, only a body of water or a
      // subdivision — worth showing rather than falling back to nothing.
      const local = d.city || d.locality || d.localityInfo?.administrative?.[3]?.name || '';
      const wider = d.principalSubdivision || d.countryName || '';
      // "Eastern Visayas (Region VIII)" is the official form but the bracketed
      // half is noise in a one-line label, and it forces a wrap on a phone.
      const tidy = (v) => String(v || '').replace(/\s*\([^)]*\)/g, '').trim();
      const parts = [tidy(local), tidy(wider)]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
      const name = parts.join(', ') || tidy(d.countryName) || null;

      const all = readCache();
      all[key] = name;
      writeCache(all);
      return name;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(key));

  inFlight.set(key, req);
  return req;
}
