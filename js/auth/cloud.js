// ---------------------------------------------------------------------------
// CLOUD SIGN-IN  (providers: 'google' live, 'facebook' coded but disabled)
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

/** Firebase provider ids -> the short names used through the app. */
const PROVIDER_NAMES = {
  'google.com': 'google',
  'facebook.com': 'facebook',
};

function toProfile(user) {
  // Every linked provider, not just the one used to sign in — the whole point
  // of linking is that a person is one account with several ways in.
  const providers = (user.providerData || [])
    .map((p) => PROVIDER_NAMES[p.providerId])
    .filter(Boolean);

  return {
    id: user.uid,
    username: user.displayName || user.email?.split('@')[0] || 'angler',
    email: user.email || null,
    photoURL: user.photoURL || null,
    // The provider used for THIS session; `providers` is what's linked.
    provider: providers[0] || 'google',
    providers,
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

function providerFor(sdk, name) {
  if (name === 'google') return new sdk.GoogleAuthProvider();
  if (name === 'facebook') return new sdk.FacebookAuthProvider();
  throw new Error(`Unknown sign-in provider: ${name}`);
}

/** Last auth failure, surfaced to the UI. Silent failure is worse than ugly. */
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

/**
 * Sign in with a provider.
 *
 * POPUP FIRST, redirect as fallback — and this order matters more than it
 * looks. signInWithRedirect relies on cross-origin storage between the app and
 * the `*.firebaseapp.com` auth handler. Chrome's storage partitioning and
 * Safari's ITP now block exactly that, so the user completes sign-in at Google,
 * gets sent back, and getRedirectResult() returns null — landing them on the
 * login screen as though nothing happened. Popup keeps the flow in one
 * browsing context and is unaffected.
 *
 * Redirect stays as the fallback for the case popup was originally chosen for:
 * iOS standalone PWAs, where popups may be blocked outright.
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
    const popupFailed = [
      'auth/popup-blocked',
      'auth/operation-not-supported-in-this-environment',
      'auth/cancelled-popup-request',
    ].includes(err?.code);

    if (err?.code === 'auth/popup-closed-by-user') {
      // Deliberate cancellation — not an error worth shouting about.
      return null;
    }
    if (!popupFailed) {
      recordError('popup', err);
      throw err;
    }
    // Popup unavailable (usually an installed iOS PWA): fall back.
    await sdk.signInWithRedirect(auth, provider);
    return null; // navigating away
  }
}

export const signInWithGoogle = () => signInWith('google');
export const signInWithFacebook = () => signInWith('facebook');

// ---------------------------------------------------------------------------
// ACCOUNT LINKING
//
// One person, one account, several ways in. Without this, signing in with
// Google and later with Facebook creates two unrelated uids — and since the
// catch log is keyed by uid, that reads to the user as "my log vanished".
//
// Two halves, and both are needed:
//
//   1. Deliberate linking, below: signed in already, tap "connect Facebook",
//      and the credential is attached to the SAME uid.
//   2. Collision handling, in completeRedirect(): someone signs in with a
//      provider whose email already belongs to another account. Firebase can
//      resolve this itself — see the console setting noted in the README —
//      but when it can't, it raises account-exists-with-different-credential
//      and hands back a credential to link once the user proves the original
//      account is theirs.
//
// The UI for (1) isn't built yet, by design. These functions are the seam it
// will attach to.
// ---------------------------------------------------------------------------

/** Attach another provider to the account that is already signed in. */
export async function linkProvider(name) {
  const { auth, sdk } = await firebase();
  if (!auth.currentUser) throw new Error('Sign in before connecting another account.');
  await sdk.linkWithRedirect(auth.currentUser, providerFor(sdk, name));
}

/** Detach a provider. Refuses to remove the last one, which would orphan the account. */
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

/** Short names of everything linked, from the cached profile. Synchronous. */
export function linkedProviders() {
  return cachedCloudUser()?.providers || [];
}

/**
 * A credential kept aside when a sign-in collided with an existing account.
 * Stored in sessionStorage, not localStorage: it's short-lived and should not
 * outlive the tab.
 */
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
 * Call once on start-up. If we've just come back from a provider redirect,
 * this resolves the sign-in and caches the profile.
 * @returns {Promise<object|null>} the profile if a sign-in just completed
 */
export async function completeRedirect() {
  if (!cloudConfigured()) return null;
  let sdk;
  try {
    const fb = await firebase();
    sdk = fb.sdk;
    // Also resolves a linkWithRedirect, so connecting an account lands here too.
    const result = await sdk.getRedirectResult(fb.auth);
    if (!result?.user) return null;
    const profile = toProfile(result.user);
    cache(profile);
    clearPendingLink();
    return profile;
  } catch (err) {
    // The collision case: this provider's email already belongs to another
    // account. Hold the credential so the app can link it once the user has
    // signed in the original way, instead of silently creating a second
    // account and appearing to lose their log.
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
        // Non-fatal: worst case the user just signs in normally.
      }
      recordError('redirect-collision', err);
      return null;
    }

    // Everything else gets recorded. Returning null silently here is what made
    // a failed sign-in look like "nothing happened" — the UI now has something
    // to show instead.
    recordError('redirect', err);
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
