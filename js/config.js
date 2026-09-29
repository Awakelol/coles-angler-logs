// API keys and provider settings.
//
// Weather works without a key (Open-Meteo). Tides need one; see the README.

export const CONFIG = {
  weather: {
    // 'open-meteo' (no key, default) | 'openweather' (needs key below)
    provider: 'open-meteo',
    openWeatherKey: '',
  },
  // Firebase web config (public; access is controlled by security rules).
  // console.firebase.google.com → Project settings → Your apps → Web
  firebase: {
    apiKey: 'AIzaSyCyCe9mt3mMBPC7TagWz66FhR7MMzLUuB8',
    authDomain: 'coles-angler-logs.firebaseapp.com',
    projectId: 'coles-angler-logs',
    appId: '1:97558361469:web:0a513147d8053ce1da4814',
    storageBucket: 'coles-angler-logs.firebasestorage.app',
    messagingSenderId: '97558361469',
    // no measurementId: the app doesn't use Analytics
  },

  // Sign-in buttons to show. Each provider also has to be enabled in the
  // Firebase console. Facebook is off because Meta requires business
  // verification for the login permissions; the code path is there if needed.
  auth: {
    google: true,
    facebook: false,
  },

  tides: {
    // 'worldtides' (needs key) | 'stormglass' (needs key) | 'none'
    provider: 'worldtides',
    // Don't put keys here (this file is committed). Use js/config.local.js
    // or the Settings screen.
    worldTidesKey: '',
    stormglassKey: '',
  },
};

const OVERRIDE_KEY = 'angler.config.overrides';

function merge(source) {
  for (const group of Object.keys(source || {})) {
    if (CONFIG[group]) Object.assign(CONFIG[group], source[group]);
  }
}

/** Load js/config.local.js (gitignored) if it exists. */
export async function loadLocalConfig() {
  try {
    const mod = await import('./config.local.js');
    merge(mod.LOCAL_CONFIG);
  } catch {
    // not present
  }
}

// Values saved from the Settings screen override everything above.
export function loadOverrides() {
  try {
    merge(JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}'));
  } catch {
    localStorage.removeItem(OVERRIDE_KEY);
  }
  return CONFIG;
}

export function saveOverrides(partial) {
  const saved = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}');
  for (const group of Object.keys(partial)) {
    saved[group] = { ...(saved[group] || {}), ...partial[group] };
    Object.assign(CONFIG[group], partial[group]);
  }
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(saved));
}
