// Cloud sign-in via Firebase Auth. Google is live; Facebook is wired up but
// hidden behind a config flag.
//
// The Firebase SDK (~200 KB) is loaded from the CDN only when it's first
// needed, so local-only users never download it.
//
// The Firebase web config isn't a secret: apiKey identifies the project, and
// access is controlled by the security rules.

import { CONFIG } from '../config.js';
import { syntheticEmail, derivePassword, isSyntheticEmail } from './credentials.js';

const SDK_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

/** Cached profile, so the facade can answer currentUser() synchronously. */
export const CLOUD_CACHE_KEY = 'angler.cloudUser';

export function cloudConfigured() {
  const f = CONFIG.firebase || {};
  return Boolean(f.apiKey && f.authDomain && f.projectId && f.appId);
}

export const SETUP_STEPS = [
  'Create a project at console.firebase.google.com (no billing needed).',
  'Build → Authentication → Get started → enable Email/Password AND Google.',
  'Authentication → Settings → Authorised domains → add your site\'s domain.',
  'Project settings → General → Your apps → Web → register, then copy the config.',
  'Paste it into js/config.local.js (gitignored) or Settings in the app.',
  'Build → Firestore Database → create it, then publish the rules from README.',
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
    appPromise = null; // allow a retry
    const err = new Error('Could not reach Google sign-in. Check your connection.');
    err.cause = e;
    throw err;
  });

  return appPromise;
}

/** Firebase provider ids -> the short names used in the app. */
const PROVIDER_NAMES = {
  'google.com': 'google',
  'facebook.com': 'facebook',
  password: 'username',
};

function toProfile(user) {
  const providers = (user.providerData || [])
    .map((p) => PROVIDER_NAMES[p.providerId])
    .filter(Boolean);

  // Username accounts use a made-up address; don't show it.
  const realEmail = user.email && !isSyntheticEmail(user.email) ? user.email : null;

  return {
    id: user.uid,
    username: user.displayName || realEmail?.split('@')[0] || 'angler',
    email: realEmail,
    photoURL: user.photoURL || null,
    // A username account stays a username account even after linking Google.
    provider: providers.includes('username') ? 'username' : providers[0] || 'google',
    providers,
  };
}

function cache(profile) {
  if (profile) localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(profile));
  else localStorage.removeItem(CLOUD_CACHE_KEY);
}

/** The cached cloud profile. Can be briefly stale; verify() reconciles it. */
export function cachedCloudUser() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY) || 'null');
    return raw && raw.id ? raw : null;
  } catch {
    localStorage.removeItem(CLOUD_CACHE_KEY);
    return null;
  }
}

function providerFor(sdk, name) {
  if (name === 'google') return new sdk.GoogleAuthProvider();
  if (name === 'facebook') return new sdk.FacebookAuthProvider();
  throw new Error(`Unknown sign-in provider: ${name}`);
}

/** Last auth failure, so the UI can show what went wrong. */
const LAST_ERROR_KEY = 'angler.authError';

export function lastAuthError() {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_ERROR_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearAuthError() {
  sessionStorage.removeItem(LAST_ERROR_KEY);
}

function recordError(stage, err) {
  const detail = { stage, code: err?.code || null, message: err?.message || String(err) };
  try {
    sessionStorage.setItem(LAST_ERROR_KEY, JSON.stringify(detail));
  } catch {
    /* ignore */
  }
  console.error(`[auth:${stage}]`, err);
  return detail;
}

const POPUP_UNAVAILABLE = [
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
];

/**
 * Sign in with a provider.
 *
 * Popup first: redirect sign-in depends on third-party storage that Chrome's
 * partitioning and Safari's ITP now block, so getRedirectResult() often comes
 * back empty. Redirect is only the fallback for when popups aren't available
 * (mostly installed iOS PWAs).
 */
export async function signInWith(name) {
  clearAuthError();
  const { auth, sdk } = await firebase();
  const provider = providerFor(sdk, name);

  try {
    const result = await sdk.signInWithPopup(auth, provider);
    const profile = toProfile(result.user);
    cache(profile);
    return profile;
  } catch (err) {
    if (err?.code === 'auth/popup-closed-by-user') return null;
    if (!POPUP_UNAVAILABLE.includes(err?.code)) {
      recordError('popup', err);
      throw err;
    }
    await sdk.signInWithRedirect(auth, provider);
    return null; // navigating away
  }
}

export const signInWithGoogle = () => signInWith('google');
export const signInWithFacebook = () => signInWith('facebook');

// --- username accounts ---------------------------------------------------------
//
// A username account is a normal Firebase Email/Password account with the
// address and password derived from what the user typed (see credentials.js).

/** Create the cloud side of a username account. */
export async function signUpWithPassword(username, password) {
  clearAuthError();
  const { auth, sdk } = await firebase();
  const email = syntheticEmail(username);
  const derived = await derivePassword(username, password);

  try {
    const result = await sdk.createUserWithEmailAndPassword(auth, email, derived);
    // The synthetic email is lowercased, so keep the username's casing here.
    const displayName = String(username).trim();
    await sdk.updateProfile(result.user, { displayName });
    // Don't spread result.user: providerData is a getter and would be lost.
    const profile = { ...toProfile(result.user), username: displayName };
    cache(profile);
    return profile;
  } catch (err) {
    recordError('signup-password', err);
    throw err;
  }
}

export async function signInWithPassword(username, password) {
  clearAuthError();
  const { auth, sdk } = await firebase();
  const derived = await derivePassword(username, password);

  try {
    const result = await sdk.signInWithEmailAndPassword(auth, syntheticEmail(username), derived);
    const profile = toProfile(result.user);
    cache(profile);
    return profile;
  } catch (err) {
    recordError('signin-password', err);
    throw err;
  }
}

/** The signed-in Firebase uid, or null. */
export async function currentUid() {
  if (!cloudConfigured()) return null;
  try {
    const { auth } = await firebase();
    return auth.currentUser?.uid || null;
  } catch {
    return null;
  }
}

/** Firebase app/auth handles for sync.js, or null. */
export async function firebaseHandles() {
  if (!cloudConfigured()) return null;
  try {
    return await firebase();
  } catch {
    return null;
  }
}

// --- account linking -------------------------------------------------------------
//
// Linking keeps the same uid, so the catch log stays put. There are two paths:
// linkProvider() when already signed in, and the account-exists collision
// handled in completeRedirect().

/** Attach another provider to the signed-in account (popup first, as above). */
export async function linkProvider(name) {
  clearAuthError();
  const { auth, sdk } = await firebase();
  if (!auth.currentUser) throw new Error('Sign in before connecting another account.');
  const provider = providerFor(sdk, name);

  try {
    const result = await sdk.linkWithPopup(auth.currentUser, provider);
    const profile = toProfile(result.user);
    cache(profile);
    return profile;
  } catch (err) {
    if (err?.code === 'auth/popup-closed-by-user') return null;
    if (!POPUP_UNAVAILABLE.includes(err?.code)) {
      recordError('link', err);
      throw err;
    }
    await sdk.linkWithRedirect(auth.currentUser, provider);
    return null; // navigating away
  }
}

/** Detach a provider. Refuses to remove the last one. */
export async function unlinkProvider(providerId) {
  const { auth, sdk } = await firebase();
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  if ((user.providerData || []).length <= 1) {
    throw new Error('That is the only way into this account — connect another first.');
  }
  await sdk.unlink(user, providerId);
  cache(toProfile(auth.currentUser));
}

export function linkedProviders() {
  return cachedCloudUser()?.providers || [];
}

/** Details of a sign-in that collided with an existing account (per tab). */
const PENDING_KEY = 'angler.pendingLink';

export function pendingLink() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearPendingLink() {
  sessionStorage.removeItem(PENDING_KEY);
}

/**
 * Finish a provider redirect (sign-in or link) if we just came back from one.
 * @returns {Promise<object|null>} the profile if a sign-in just completed
 */
export async function completeRedirect() {
  if (!cloudConfigured()) return null;
  let sdk;
  try {
    const fb = await firebase();
    sdk = fb.sdk;
    const result = await sdk.getRedirectResult(fb.auth);
    if (!result?.user) return null;
    const profile = toProfile(result.user);
    cache(profile);
    clearPendingLink();
    return profile;
  } catch (err) {
    // Email already belongs to another account: remember it so it can be
    // linked after the user signs in the original way.
    if (err?.code === 'auth/account-exists-with-different-credential' && sdk) {
      try {
        const credential = sdk.OAuthProvider.credentialFromError(err);
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({
            email: err.customData?.email || null,
            providerId: credential?.providerId || null,
            at: Date.now(),
          })
        );
      } catch {
        /* not fatal */
      }
      recordError('redirect-collision', err);
      return null;
    }

    recordError('redirect', err);
    return null;
  }
}

/** Check the cached profile against Firebase in the background. */
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
    // Offline: keep the cached profile.
  }
}

export async function signOutCloud() {
  cache(null);
  if (!cloudConfigured()) return;
  try {
    const { auth, sdk } = await firebase();
    await sdk.signOut(auth);
  } catch {
    // The cache is already cleared, which is what the UI reads.
  }
}
