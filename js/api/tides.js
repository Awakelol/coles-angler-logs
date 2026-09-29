// Tides. There's no free keyless tide API, so the default provider is 'none'
// and the dashboard shows a setup card.
//
//   worldtides  worldtides.info, free tier ~100 requests/month
//   stormglass  stormglass.io, free tier ~10 requests/day
//   none        default
//
// Responses are cached in localStorage for 6 hours; predictions barely change
// within a day and the free quotas are small.

import { CONFIG } from '../config.js';

const CACHE_KEY = 'angler.tidecache';
const CACHE_MS = 6 * 60 * 60 * 1000;

function readCache(key) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const hit = all[key];
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
  return null;
}

function writeCache(key, data) {
  let all = {};
  try {
    all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    all = {};
  }
  all[key] = { at: Date.now(), data };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ [key]: all[key] }));
  }
}

export function tidesConfigured() {
  const { provider, worldTidesKey, stormglassKey } = CONFIG.tides;
  if (provider === 'worldtides') return Boolean(worldTidesKey);
  if (provider === 'stormglass') return Boolean(stormglassKey);
  return false;
}

// Start the window a bit in the past so there's an extreme before "now" to
// interpolate from (otherwise we can't say rising/falling).
const LOOKBACK_MS = 8 * 60 * 60 * 1000;

async function fetchWorldTides({ lat, lon }) {
  const key = CONFIG.tides.worldTidesKey;
  const start = Math.floor((Date.now() - LOOKBACK_MS) / 1000);
  const url =
    `https://www.worldtides.info/api/v3?extremes&days=3&start=${start}` +
    `&lat=${lat}&lon=${lon}&key=${key}`;
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new Error('WorldTides rejected the key — check it in Settings.');

  // WorldTides returns the real error as JSON even on a 400 (e.g. "Not enough
  // credits"), so read the body first.
  let d = null;
  try {
    d = await res.json();
  } catch {
    /* non-JSON body */
  }
  const apiError = d?.error || '';
  if (/credit/i.test(apiError)) {
    throw new Error(
      'Tide credits used up for this billing period. The free tier is about ' +
      '100 requests a month; it resets monthly, or you can add a different key in Settings.'
    );
  }
  if (!res.ok) throw new Error(apiError || `WorldTides returned ${res.status}`);
  if (apiError) throw new Error(apiError);

  return {
    provider: 'WorldTides',
    station: d.station || null,
    extremes: (d.extremes || []).map((e) => ({
      time: new Date(e.dt * 1000).toISOString(),
      type: e.type.toLowerCase() === 'high' ? 'high' : 'low',
      heightM: Number(e.height.toFixed(2)),
    })),
  };
}

async function fetchStormglass({ lat, lon }) {
  const key = CONFIG.tides.stormglassKey;
  const start = new Date(Date.now() - LOOKBACK_MS);
  const end = new Date(Date.now() + 3 * 864e5);
  const url =
    `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lon}` +
    `&start=${start.toISOString()}&end=${end.toISOString()}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (res.status === 401 || res.status === 402) throw new Error('Stormglass rejected the key or the daily quota is used up.');
  if (!res.ok) throw new Error(`Stormglass returned ${res.status}`);
  const d = await res.json();

  return {
    provider: 'Stormglass',
    station: d.meta?.station?.name || null,
    extremes: (d.data || []).map((e) => ({
      time: new Date(e.time).toISOString(),
      type: e.type === 'high' ? 'high' : 'low',
      heightM: Number(Number(e.height).toFixed(2)),
    })),
  };
}

export async function fetchTides(coords) {
  if (!tidesConfigured()) {
    return { unconfigured: true, provider: CONFIG.tides.provider, extremes: [] };
  }

  // v2: entries from before the lookback window was added are unusable.
  const cacheKey = `v2:${CONFIG.tides.provider}:${coords.lat},${coords.lon}`;
  const cached = readCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  const data =
    CONFIG.tides.provider === 'stormglass'
      ? await fetchStormglass(coords)
      : await fetchWorldTides(coords);

  writeCache(cacheKey, data);
  return data;
}

/**
 * Current tide state, interpolated from the surrounding extremes.
 * Returns null when the window doesn't bracket the current time.
 */
export function currentTideState(extremes, now = new Date()) {
  if (!extremes || extremes.length < 2) return null;
  const t = now.getTime();
  const sorted = [...extremes].sort((a, b) => new Date(a.time) - new Date(b.time));

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const ta = new Date(a.time).getTime();
    const tb = new Date(b.time).getTime();
    if (t >= ta && t <= tb) {
      const progress = (t - ta) / (tb - ta);
      const rising = b.type === 'high';
      return {
        rising,
        direction: rising ? 'Rising' : 'Falling',
        progress,
        from: a,
        to: b,
        minutesToNext: Math.round((tb - t) / 60000),
        // Mid-tide has the strongest flow, often the best bite.
        movingFast: progress > 0.25 && progress < 0.75,
      };
    }
  }

  // No bracketing pair (stale cache, or forward-only data): the direction is
  // known from the next extreme, the progress isn't.
  const next = sorted.find((e) => new Date(e.time).getTime() > t);
  if (next) {
    const rising = next.type === 'high';
    return {
      rising,
      direction: rising ? 'Rising' : 'Falling',
      progress: null,
      from: null,
      to: next,
      minutesToNext: Math.round((new Date(next.time).getTime() - t) / 60000),
      movingFast: false,
      approximate: true,
    };
  }
  return null;
}

export function nextExtremes(extremes, count = 4, now = new Date()) {
  return (extremes || [])
    .filter((e) => new Date(e.time) >= now)
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .slice(0, count);
}
