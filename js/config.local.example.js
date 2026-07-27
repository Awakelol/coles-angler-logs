// ---------------------------------------------------------------------------
// Template for js/config.local.js — copy this file, rename it, add your keys.
// The real config.local.js is gitignored so keys stay out of version control.
//
//   Tides   worldtides.info  (Account -> API key)  ~100 requests/month free
//           stormglass.io    (Dashboard -> API key) ~10 requests/day free
//   Weather works with no key by default (Open-Meteo).
//
// Alternatively, skip this file entirely and paste keys into the app's
// Settings screen — they're stored per-device in localStorage.
// ---------------------------------------------------------------------------

export const LOCAL_CONFIG = {
  tides: {
    provider: 'worldtides',       // 'worldtides' | 'stormglass' | 'none'
    worldTidesKey: '',
    stormglassKey: '',
  },
  // weather: {
  //   provider: 'openweather',
  //   openWeatherKey: '',
  // },
};
