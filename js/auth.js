// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// AUTH FACADE
//
// The app talks to this and never to a provider directly. Two kinds of account
// coexist deliberately:
//
//   local  (js/auth/local.js)  username + password kept in this browser. Needs
//                              nothing — no network, no Firebase project — and
//                              is the fallback whenever the cloud is not
//                              reachable. Does not sync on its own.
//   cloud  (js/auth/cloud.js)  Firebase Auth. Google, and username accounts
//                              via derived Email/Password credentials.
//                              Genuinely verified, and the basis for sync.
//
// A USERNAME ACCOUNT IS BOTH. It is created in the cloud when the cloud is
// available, and mirrored locally so sign-in still works with no signal. An
// account created offline is local-only until the first successful online
// sign-in, at which point it is upgraded in place — same username, same
// password, same catches — without asking, because the alternative is a
// person's log silently not being backed up.
//
// Keeping both means the app still works with zero setup and no signal, which
// is the normal case on the water, while anyone who wants their log on more
// than one device can have that.
//
// currentUser() is SYNCHRONOUS on purpose — render() calls it while building
// markup. Cloud profiles are therefore cached in localStorage and reconciled
// with Firebase in the background by init(), rather than being awaited.
// ---------------------------------------------------------------------------

import * as local from './auth/local.js';
import * as cloud from './auth/cloud.js';
import { store } from './store.js';

const SESSION_KEY = 'angler.session';

// Re-exported so pages don't need to know which provider owns what.
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
 * Rename the signed-in account's handle.
 *
 * LOCAL ONLY, and that is a real limit rather than an oversight. A cloud
 * account's handle is its Firebase Email/Password identity, and changing that
 * means an updateEmail() call plus a re-auth — neither of which can be done
 * from here without the current password. A synced account is told so instead
 * of being offered a control that would half-work.
 */
export async function renameHandle(next) {
  const session = currentUser();
  if (!session) throw new Error('Sign in first.');
  if (session.syncs) {
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
    // Sessions used to be a bare local user id; keep those working.
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
// One pair of functions for what is really two storage backends, because the
// person typing a username and password should not have to know or care which
// one answered. The rules, in order:
//
//   SIGN UP   cloud first when it's reachable, local otherwise. A local-only
//             sign-up is not a lesser account, just one that hasn't met the
//             network yet.
//   SIGN IN   local first, always. It is instant, it works with no signal, and
//             it is the common case. Only when there is no local record do we
//             go to the cloud — which is exactly the "new device" path, and the
//             thing that makes this sync rather than backup.
//   UPGRADE   a successful local sign-in with the cloud reachable quietly
//             promotes the account and pushes its catches up.

/** Is the network plausibly there? navigator.onLine only ever rules it out. */
const maybeOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const cloudUsable = () => cloud.cloudConfigured() && maybeOnline();

/**
 * Keep a local mirror of a cloud username account.
 *
 * Without this, a synced account could not sign in on its own device with no
 * signal — which is the situation the app was built for. The mirror stores the
 * cloud uid as its id, so catches written offline are already keyed correctly
 * and need no rewriting when the connection comes back.
 */
async function mirrorLocally(username, password, uid) {
  try {
    if (local.getById(uid)) return;
    await local.adopt({ id: uid, username, password, provider: 'username' });
  } catch (err) {
    // A failed mirror costs offline sign-in, not the account. Not worth
    // failing a sign-up that otherwise worked.
    console.warn('[auth] could not mirror account locally', err);
  }
}

export async function signUp(username, password, email = '') {
  // Validate before touching the network so the errors are ours and instant.
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
      // Anything else — offline mid-request, Email/Password not enabled in the
      // Firebase console, quota — falls through to a local account rather than
      // refusing to let someone start logging catches.
      console.warn('[auth] cloud sign-up unavailable, creating a local account', err);
    }
  }

  const user = await local.signUp(username, password, email);
  writeSession({ kind: 'local', id: user.id });
  return { ...user, syncs: false };
}

export async function signIn(username, password) {
  // 1. This device already knows them.
  let localUser = null;
  try {
    localUser = await local.signIn(username, password);
  } catch (err) {
    // No local record is not a failure yet — it's the new-device case. A
    // WRONG PASSWORD is, and must not fall through to the cloud, or the error
    // would come back as something confusing about the network.
    if (err?.code !== 'no-such-user') throw err;
  }

  if (localUser) {
    writeSession({ kind: 'local', id: localUser.id });
    const upgraded = await tryUpgrade(username, password, localUser);
    return upgraded || { ...localUser, syncs: false };
  }

  // 2. No local record. Either a new device, or a username that doesn't exist.
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
    // Everything that isn't plainly a connection problem reads as one message.
    //
    // Firebase distinguishes "no such user" from "wrong password", and it also
    // has a dozen setup and quota codes. Passing any of them through would let
    // a shared device be probed for which usernames exist, and would put
    // "auth/operation-not-allowed" in front of someone who only mistyped. None
    // of these codes depend on whether the account exists, so collapsing them
    // loses no information the person could act on. The real code is still
    // recorded by cloud.js for lastAuthError() and the console.
    if (err?.code === 'auth/network-request-failed') {
      throw new Error('No connection — that account is not on this device yet.');
    }
    throw new Error('Wrong username or password.');
  }
}

/**
 * Promote a local-only account to a synced one, in place.
 *
 * Runs after a successful local sign-in, so we hold a password we know is
 * correct — the only moment this is possible without asking for it again.
 * Returns the cloud profile on success, null if it wasn't possible, and never
 * throws: failing to upgrade must not fail the sign-in that already worked.
 */
async function tryUpgrade(username, password, localUser) {
  if (!cloudUsable() || localUser.provider === 'username') return null;

  try {
    let profile;
    try {
      profile = await cloud.signUpWithPassword(username, password);
    } catch (err) {
      if (err?.code !== 'auth/email-already-in-use') throw err;
      // Already registered — this device is just meeting the account for the
      // first time. Signing in reaches the same uid, which is what matters.
      profile = await cloud.signInWithPassword(username, password);
    }

    // The catches were written against the local id. Re-key them to the cloud
    // uid before anything syncs, or they'd belong to nobody. Spots are owned
    // the same way and would be just as orphaned.
    await store.reassignOwner(localUser.id, profile.id);
    await store.reassignSpotOwner(localUser.id, profile.id);
    local.deleteAccount(localUser.id);
    await mirrorLocally(profile.username, password, profile.id);
    writeSession({ kind: 'cloud', id: profile.id });
    return { ...profile, syncs: true, justUpgraded: true };
  } catch (err) {
    // Wrong password against an existing cloud account of the same name is the
    // interesting case: someone else owns that username. Their local account
    // still works, so say nothing and leave it alone.
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
 * Returns the profile when a popup completed, or null when the browser was
 * sent away on a redirect (init() finishes that on the way back) or the user
 * closed the popup.
 */
async function cloudSignIn(name, label) {
  requireCloud(label);
  const profile = await cloud.signInWith(name);
  if (profile) writeSession({ kind: 'cloud', id: profile.id });
  return profile;
}

export const signInWithGoogle = () => cloudSignIn('google', 'Google sign-in');
export const signInWithFacebook = () => cloudSignIn('facebook', 'Facebook sign-in');

/** The last sign-in failure, so the UI can show something concrete. */
export const lastAuthError = cloud.lastAuthError;
export const clearAuthError = cloud.clearAuthError;

// --- account linking --------------------------------------------------------
//
// One person, one account, several ways in. Linking does not change the
// Firebase uid, and the catch log is keyed by uid, so connecting Google to a
// username account is genuinely additive — a second door, not a second room.

/** Attach another provider to the signed-in account. */
export async function linkProvider(name) {
  requireCloud('Account linking');
  const user = currentUser();
  if (!user) throw new Error('Sign in before connecting another account.');
  if (!user.syncs) {
    // A local-only account has no uid to attach anything to. This is now rare
    // — it means the account was made offline and has never been online since
    // — and it fixes itself on the next connected sign-in.
    throw new Error('This account is not synced yet. Sign in again with a connection first.');
  }
  return cloud.linkProvider(name);
}

export async function unlinkProvider(providerId) {
  requireCloud('Account linking');
  await cloud.unlinkProvider(providerId);
}

/** Short provider names linked to the current account, e.g. ['google']. */
export function linkedProviders() {
  return currentUser()?.providers || [];
}

/**
 * A sign-in that collided with an existing account, awaiting a link.
 * Non-null means: this email already has an account via another provider.
 */
export const pendingLink = cloud.pendingLink;
export const clearPendingLink = cloud.clearPendingLink;

/**
 * Run once at start-up, before the first render.
 * Finishes any provider redirect and reconciles the cached cloud profile.
 */
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

/** Whether this account's catches are backed by the cloud. */
export function syncs() {
  return currentUser()?.syncs === true;
}
