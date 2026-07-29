// ---------------------------------------------------------------------------
// API KEYS & PROVIDER SETTINGS
//
// Weather works out of the box (Open-Meteo needs no key).
// Tides require a key — see README.md "Getting API keys".
// ---------------------------------------------------------------------------

export const CONFIG = {
  weather: {
    // 'open-meteo' (no key, default) | 'openweather' (needs key below)
    provider: 'open-meteo',
    openWeatherKey: '',
  },
  // Firebase web config for Google/Facebook sign-in. NOT a secret — apiKey
  // here is a project identifier, not a credential, and access is controlled
  // by Firebase Security Rules. Safe to commit; kept in config.local.js only
  // for convenience alongside the tide key.
  //   console.firebase.google.com → Project settings → Your apps → Web
  firebase: {
    apiKey: 'AIzaSyCyCe9mt3mMBPC7TagWz66FhR7MMzLUuB8',
    authDomain: 'coles-angler-logs.firebaseapp.com',
    projectId: 'coles-angler-logs',
    appId: '1:97558361469:web:0a513147d8053ce1da4814',
    storageBucket: 'coles-angler-logs.firebasestorage.app',
    messagingSenderId: '97558361469',
    // measurementId is deliberately omitted — that's Google Analytics, which
    // the app doesn't load and doesn't need.
  },

  // Which cloud providers the sign-in screen offers. A provider being coded
  // is not the same as it being usable: it also has to be enabled in the
  // Firebase console AND set up with the provider itself.
  //
  // FACEBOOK IS OFF. The code path is complete and tested — see
  // js/auth/cloud.js — but Meta gates the permissions behind a Business
  // Portfolio and, for public users, business verification with company
  // documents. That's not available to an individual running a personal app.
  // Flip this to true if that ever changes; nothing else needs editing.
  auth: {
    google: true,
    facebook: false,
  },

  tides: {
    // 'worldtides' (needs key) | 'stormglass' (needs key) | 'none'
    provider: 'worldtides',
    // Keys are NOT stored here — this file is committed. Put them in
    // js/config.local.js (gitignored) or paste them into the app's Settings.
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

/**
 * Load js/config.local.js if it exists. That file is gitignored, so real API
 * keys live there and never enter version control. Absent it, the app falls
 * back to whatever was entered in Settings.
 */
export async function loadLocalConfig() {
  try {
    const mod = await import('./config.local.js');
    merge(mod.LOCAL_CONFIG);
  } catch {
    // No local config file — expected on a fresh clone.
  }
}

// Keys pasted into the in-app Settings screen win over the values above,
// so the app is usable without editing source.
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
