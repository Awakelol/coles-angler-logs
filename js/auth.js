// ---------------------------------------------------------------------------
// AUTH FACADE
//
// The app talks to this and never to a provider directly. Two kinds of account
// coexist deliberately:
//
//   local  (js/auth/local.js)  username + password, this device only, needs
//                              nothing — no network, no Firebase project.
//                              Does not sync.
//   cloud  (js/auth/cloud.js)  Google (later Facebook) via Firebase Auth.
//                              Genuinely verified, and the basis for sync.
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

const SESSION_KEY = 'angler.session';

// Re-exported so pages don't need to know which provider owns what.
export const {
  USERNAME_RULES,
  validateUsername,
  validatePassword,
  usernameTaken,
  listUsers,
  changePassword,
} = local;

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
    return { ...profile, syncs: true };
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

// --- local ------------------------------------------------------------------

export async function signUp(username, password) {
  const user = await local.signUp(username, password);
  writeSession({ kind: 'local', id: user.id });
  return { ...user, syncs: false };
}

export async function signIn(username, password) {
  const user = await local.signIn(username, password);
  writeSession({ kind: 'local', id: user.id });
  return { ...user, syncs: false };
}

// --- cloud ------------------------------------------------------------------

export async function signInWithGoogle() {
  if (!cloud.cloudConfigured()) {
    const err = new Error('Google sign-in is not set up yet — see Settings.');
    err.code = 'unconfigured';
    throw err;
  }
  // Leaves the page; init() finishes the job when the browser comes back.
  await cloud.signInWithGoogle();
}

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
