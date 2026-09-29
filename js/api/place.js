// Reverse geocoding (coordinates -> place name).
//
// Uses BigDataCloud's client endpoint, which needs no key and is meant for
// browser use. (Nominatim's policy requires a User-Agent a page can't set.)
// Results are cached per rounded coordinate.

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
 * Most specific available name for a position.
 * @returns {Promise<string|null>} e.g. "Tacloban City, Leyte", or null on failure
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
      // Offshore there's no locality, only a water body or subdivision.
      const local = d.city || d.locality || d.localityInfo?.administrative?.[3]?.name || '';
      const wider = d.principalSubdivision || d.countryName || '';
      // Drop the "(Region VIII)" suffix.
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
