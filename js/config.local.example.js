// Copy to js/config.local.js (gitignored) and fill in your keys.
//
//   Tides   worldtides.info  (Account -> API key)  ~100 requests/month free
//           stormglass.io    (Dashboard -> API key) ~10 requests/day free
//   Weather works with no key by default (Open-Meteo).
//
// Or skip this and paste keys into Settings in the app (saved per device).

export const LOCAL_CONFIG = {
  // Firebase web config, from console.firebase.google.com →
  // Project settings → Your apps → Web.
  // firebase: {
  //   apiKey: '', authDomain: '', projectId: '',
  //   appId: '', storageBucket: '', messagingSenderId: '',
  // },

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
