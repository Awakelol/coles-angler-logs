// ---------------------------------------------------------------------------
// CLOUD SIGN-IN  (provider: 'google', later 'facebook')
//
// Real authentication, via Firebase Auth. Unlike js/auth/local.js this is
// genuinely verified — the token is checked by Google, not by us — which is
// what makes syncing a shared log safe later.
//
// Two deliberate choices:
//
// LAZY SDK LOAD. The Firebase SDK is ~200 KB and the app is otherwise
// dependency-free. It's imported from the CDN only when someone actually taps
// a cloud sign-in button, so local-only users never download it and the app
// keeps working with no network.
//
// REDIRECT, NOT POPUP. Popups are blocked or badly broken in iOS standalone
// PWAs — the exact place this app runs. signInWithRedirect survives being
// added to the home screen; signInWithPopup does not.
//
// Firebase web config is NOT a secret. apiKey here is a project identifier,
// not a credential; access is controlled by Firebase Security Rules. It is
// safe in the repo.
// ---------------------------------------------------------------------------

import { CONFIG } from '../config.js';

const SDK_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

/** Cached profile, so the facade can answer currentUser() synchronously. */
export const CLOUD_CACHE_KEY = 'angler.cloudUser';

export function cloudConfigured() {
  const f = CONFIG.firebase || {};
  return Boolean(f.apiKey && f.authDomain && f.projectId && f.appId);
}

/** Everything the user must set up before any of this can work. */
export const SETUP_STEPS = [
  'Create a project at console.firebase.google.com (no billing needed).',
  'Build → Authentication → Get started → enable the Google provider.',
  'Authentication → Settings → Authorised domains → add your site\'s domain.',
  'Project settings → General → Your apps → Web → register, then copy the config.',
  'Paste it into js/config.local.js (gitignored) or Settings in the app.',
];

let appPromise = null;

async function firebase() {
  if (!cloudConfigured()) {
    const err = new Error('Cloud sign-in is not set up yet.');
    err.code = 'unconfigured';
    throw err;
  }
  if (appPromise) return appPromise;

  appPromise = (async () => {
    const [{ initializeApp }, auth] = await Promise.all([
      import(/* @vite-ignore */ `${CDN}/firebase-app.js`),
      import(/* @vite-ignore */ `${CDN}/firebase-auth.js`),
    ]);
    const app = initializeApp(CONFIG.firebase);
    return { app, auth: auth.getAuth(app), sdk: auth };
  })().catch((e) => {
    appPromise = null; // let a later attempt retry rather than wedging
    const err = new Error('Could not reach Google sign-in. Check your connection.');
    err.cause = e;
    throw err;
  });

  return appPromise;
}

function toProfile(user) {
  return {
    id: user.uid,
    username: user.displayName || user.email?.split('@')[0] || 'angler',
    email: user.email || null,
    photoURL: user.photoURL || null,
    provider: user.providerData?.[0]?.providerId?.includes('facebook') ? 'facebook' : 'google',
  };
}

function cache(profile) {
  if (profile) localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(profile));
  else localStorage.removeItem(CLOUD_CACHE_KEY);
}

/** The cached cloud profile. Synchronous; may be briefly stale after sign-out
 *  on another device, which `verify()` reconciles. */
export function cachedCloudUser() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY) || 'null');
    return raw && raw.id ? raw : null;
  } catch {
    localStorage.removeItem(CLOUD_CACHE_KEY);
    return null;
  }
}

export async function signInWithGoogle() {
  const { auth, sdk } = await firebase();
  const provider = new sdk.GoogleAuthProvider();
  // Leaves the page and comes back; completeRedirect() picks it up on return.
  await sdk.signInWithRedirect(auth, provider);
}

/**
 * Call once on start-up. If we've just come back from a provider redirect,
 * this resolves the sign-in and caches the profile.
 * @returns {Promise<object|null>} the profile if a sign-in just completed
 */
export async function completeRedirect() {
  if (!cloudConfigured()) return null;
  try {
    const { auth, sdk } = await firebase();
    const result = await sdk.getRedirectResult(auth);
    if (!result?.user) return null;
    const profile = toProfile(result.user);
    cache(profile);
    return profile;
  } catch {
    // A failed or cancelled redirect shouldn't break start-up.
    return null;
  }
}

/** Reconcile the cached profile against Firebase, in the background. */
export async function verify() {
  if (!cloudConfigured() || !cachedCloudUser()) return;
  try {
    const { auth, sdk } = await firebase();
    await new Promise((resolve) => {
      const stop = sdk.onAuthStateChanged(auth, (user) => {
        stop();
        if (user) cache(toProfile(user));
        else cache(null); // signed out elsewhere, or token revoked
        resolve();
      });
    });
  } catch {
    // Offline: keep the cached profile rather than logging the user out for
    // having no signal, which would be the wrong call on a boat.
  }
}

export async function signOutCloud() {
  cache(null);
  if (!cloudConfigured()) return;
  try {
    const { auth, sdk } = await firebase();
    await sdk.signOut(auth);
  } catch {
    // Local cache is already cleared, which is what the UI reads.
  }
}
