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
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
    storageBucket: '',
    messagingSenderId: '',
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
