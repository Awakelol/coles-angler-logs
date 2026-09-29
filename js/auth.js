// Auth facade. Pages talk to this, never to a provider directly.
//
// Two kinds of account:
//   local  (auth/local.js)  username + password stored in this browser. Works
//                           offline with no Firebase project. Doesn't sync.
//   cloud  (auth/cloud.js)  Firebase Auth: Google, plus username accounts via
//                           derived email/password credentials. Syncs.
//
// Username accounts are created in the cloud when possible and mirrored
// locally so sign-in still works offline. An account created offline stays
// local until the next online sign-in, which upgrades it in place.
//
// currentUser() is synchronous because render() calls it, so cloud profiles
// are cached in localStorage and refreshed in the background by init().

import * as local from './auth/local.js';
import * as cloud from './auth/cloud.js';
import { store } from './store.js';

const SESSION_KEY = 'angler.session';

// Re-exported so pages don't need to import from auth/ directly.
export const {
  USERNAME_RULES,
  validateUsername,
  validatePassword,
  validateEmail,
  usernameTaken,
  listUsers,
  changePassword,
  handleAvailableAt,
  HANDLE_COOLDOWN_MS,
} = local;

/**
 * Rename the signed-in account's handle. Local accounts only: for synced ones
 * the handle is the Firebase email, which would need updateEmail() + re-auth.
 */
export async function renameHandle(next) {
  const session = currentUser();
  if (!session) throw new Error('Sign in first.');
  // provider 'username' is an offline mirror of a synced account.
  if (session.syncs || session.provider === 'username') {
    throw new Error('Handles on synced accounts cannot be changed here yet.');
  }
  return local.renameHandle(session.id, next);
}

export const cloudConfigured = cloud.cloudConfigured;
export const CLOUD_SETUP_STEPS = cloud.SETUP_STEPS;

/** { kind: 'local' | 'cloud', id } */
function readSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (raw && raw.kind && raw.id) return raw;
    // Older sessions were stored as a bare local user id.
    if (typeof raw === 'string') return { kind: 'local', id: raw };
    const legacy = localStorage.getItem(SESSION_KEY);
    return legacy ? { kind: 'local', id: legacy } : null;
  } catch {
    const legacy = localStorage.getItem(SESSION_KEY);
    return legacy ? { kind: 'local', id: legacy } : null;
  }
}

function writeSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

/**
 * The signed-in user, or null.
 * @returns {{id, username, provider, syncs}|null}
 */
export function currentUser() {
  const session = readSession();
  if (!session) return null;

  if (session.kind === 'cloud') {
    const profile = cloud.cachedCloudUser();
    if (!profile || profile.id !== session.id) {
      writeSession(null);
      return null;
    }
    return { ...profile, providers: profile.providers || [], syncs: true };
  }

  const user = local.getById(session.id);
  if (!user) {
    writeSession(null); // account deleted
    return null;
  }
  return { ...user, syncs: false };
}

export function isSignedIn() {
  return currentUser() !== null;
}

// --- username accounts -------------------------------------------------------
//
//   sign up   cloud if reachable, otherwise local.
//   sign in   local first (instant, works offline). Falls back to the cloud
//             when this device has no record of the user (new device).
//   upgrade   after a local sign-in, if online, connect the account to the
//             cloud so it starts syncing.

// navigator.onLine can only tell us we're definitely offline.
const maybeOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const cloudUsable = () => cloud.cloudConfigured() && maybeOnline();

/**
 * Keep a local copy of a cloud username account so it can sign in offline.
 * Uses the cloud uid as its id so offline catches are already keyed right.
 */
async function mirrorLocally(username, password, uid) {
  try {
    if (local.getById(uid)) return;
    await local.adopt({ id: uid, username, password, provider: 'username' });
  } catch (err) {
    // Only costs offline sign-in; don't fail the sign-up over it.
    console.warn('[auth] could not mirror account locally', err);
  }
}

export async function signUp(username, password, email = '') {
  // Validate locally first so errors are immediate.
  const nameError = local.validateUsername(username);
  if (nameError) throw new Error(nameError);
  const pwError = local.validatePassword(password);
  if (pwError) throw new Error(pwError);
  const emailError = local.validateEmail(email);
  if (emailError) throw new Error(emailError);
  if (local.usernameTaken(username)) throw new Error('That username is already taken on this device.');

  if (cloudUsable()) {
    try {
      const profile = await cloud.signUpWithPassword(username, password);
      await mirrorLocally(profile.username, password, profile.id);
      writeSession({ kind: 'cloud', id: profile.id });
      return { ...profile, syncs: true };
    } catch (err) {
      if (err?.code === 'auth/email-already-in-use') {
        throw new Error('That username is already taken. Try signing in instead.');
      }
      // Network, config or quota problems: fall back to a local account.
      console.warn('[auth] cloud sign-up unavailable, creating a local account', err);
    }
  }

  const user = await local.signUp(username, password, email);
  writeSession({ kind: 'local', id: user.id });
  return { ...user, syncs: false };
}

export async function signIn(username, password) {
  let localUser = null;
  try {
    localUser = await local.signIn(username, password);
  } catch (err) {
    // No local record means try the cloud. A wrong password stops here.
    if (err?.code !== 'no-such-user') throw err;
  }

  if (localUser) {
    writeSession({ kind: 'local', id: localUser.id });
    const upgraded = await tryUpgrade(username, password, localUser);
    return upgraded || { ...localUser, syncs: false };
  }

  // No local record: a new device, or an unknown username.
  if (!cloud.cloudConfigured()) throw new Error('Wrong username or password.');
  if (!maybeOnline()) {
    throw new Error('That account is not on this device yet — connect to the internet to sign in.');
  }

  try {
    const profile = await cloud.signInWithPassword(username, password);
    await mirrorLocally(profile.username, password, profile.id);
    writeSession({ kind: 'cloud', id: profile.id });
    return { ...profile, syncs: true };
  } catch (err) {
    // Collapse everything but network errors into one message so the form
    // doesn't reveal which usernames exist. cloud.js still records the real
    // error for lastAuthError().
    if (err?.code === 'auth/network-request-failed') {
      throw new Error('No connection — that account is not on this device yet.');
    }
    throw new Error('Wrong username or password.');
  }
}

/**
 * After a successful local sign-in, connect the account to the cloud: either
 * sign a mirrored account back in, or promote a local-only one in place.
 * Returns the cloud profile, or null if that wasn't possible. Never throws.
 */
async function tryUpgrade(username, password, localUser) {
  if (!cloudUsable()) return null;

  if (localUser.provider === 'username') {
    // Local mirror of a cloud account (same id as the uid).
    try {
      const profile = await cloud.signInWithPassword(username, password);
      if (profile.id !== localUser.id) return null;
      writeSession({ kind: 'cloud', id: profile.id });
      return { ...profile, syncs: true };
    } catch (err) {
      console.warn('[auth] could not reconnect this account to sync', err);
      return null;
    }
  }

  try {
    let profile;
    try {
      profile = await cloud.signUpWithPassword(username, password);
    } catch (err) {
      if (err?.code !== 'auth/email-already-in-use') throw err;
      // Already registered elsewhere; sign in instead.
      profile = await cloud.signInWithPassword(username, password);
    }

    // Re-key catches and spots from the local id to the uid before syncing.
    await store.reassignOwner(localUser.id, profile.id);
    await store.reassignSpotOwner(localUser.id, profile.id);
    local.deleteAccount(localUser.id);
    await mirrorLocally(profile.username, password, profile.id);
    writeSession({ kind: 'cloud', id: profile.id });
    return { ...profile, syncs: true, justUpgraded: true };
  } catch (err) {
    // e.g. someone else owns this username in the cloud. The local account
    // still works, so leave it as is.
    console.warn('[auth] could not upgrade this account to sync', err);
    return null;
  }
}

// --- cloud ------------------------------------------------------------------

function requireCloud(what) {
  if (!cloud.cloudConfigured()) {
    const err = new Error(`${what} is not set up yet — see Settings.`);
    err.code = 'unconfigured';
    throw err;
  }
}

/**
 * Returns the profile, or null if the popup was closed or we fell back to a
 * redirect (init() finishes that on return).
 */
async function cloudSignIn(name, label) {
  requireCloud(label);
  const profile = await cloud.signInWith(name);
  if (profile) writeSession({ kind: 'cloud', id: profile.id });
  return profile;
}

export const signInWithGoogle = () => cloudSignIn('google', 'Google sign-in');
export const signInWithFacebook = () => cloudSignIn('facebook', 'Facebook sign-in');

export const lastAuthError = cloud.lastAuthError;
export const clearAuthError = cloud.clearAuthError;

// --- account linking --------------------------------------------------------
// Linking keeps the Firebase uid, so the catch log is unaffected.

export async function linkProvider(name) {
  requireCloud('Account linking');
  const user = currentUser();
  if (!user) throw new Error('Sign in before connecting another account.');
  if (!user.syncs) {
    // Local-only (created offline); fixed by the next online sign-in.
    throw new Error('This account is not synced yet. Sign in again with a connection first.');
  }
  return cloud.linkProvider(name);
}

export async function unlinkProvider(providerId) {
  requireCloud('Account linking');
  await cloud.unlinkProvider(providerId);
}

/** e.g. ['username', 'google'] */
export function linkedProviders() {
  return currentUser()?.providers || [];
}

export const pendingLink = cloud.pendingLink;
export const clearPendingLink = cloud.clearPendingLink;

/** Run once before the first render: finish redirects, refresh the cache. */
export async function init() {
  const justSignedIn = await cloud.completeRedirect();
  if (justSignedIn) {
    writeSession({ kind: 'cloud', id: justSignedIn.id });
    return { signedIn: true, user: justSignedIn };
  }
  // Don't block start-up on the network.
  if (readSession()?.kind === 'cloud') cloud.verify();
  return { signedIn: false };
}

// --- shared -----------------------------------------------------------------

export async function signOut() {
  if (readSession()?.kind === 'cloud') await cloud.signOutCloud();
  writeSession(null);
}

export function deleteAccount(userId) {
  local.deleteAccount(userId);
  if (readSession()?.id === userId) writeSession(null);
}

export function syncs() {
  return currentUser()?.syncs === true;
}
