// ---------------------------------------------------------------------------
// LOCAL PROFILES  (provider: 'local')
//
// ⚠ THIS IS NOT AUTHENTICATION. There is no server behind it, so nothing is
// verified anywhere. Accounts live in this browser's localStorage and anyone
// with devtools can read or edit them.
//
// It exists for a specific reason: the app must work with zero setup and no
// internet. A local profile keeps each person's catch log separate on a shared
// phone without requiring a Firebase project, a network, or an account with
// anybody. Cloud sign-in (js/auth/cloud.js) sits alongside it, not instead of
// it — see js/auth.js for how the two are chosen between.
//
// A local record is ALSO the offline mirror of a synced username account —
// see adopt(). In that case the id is the Firebase uid rather than a random
// one, so catches written with no signal are already keyed correctly and need
// no rewriting when the connection comes back. The stored hash is then a lock
// on this device, not the credential; the real one is derived at sign-in time
// by js/auth/credentials.js.
//
// Passwords are salted and hashed with SHA-256 rather than stored in plain
// text. That doesn't make this secure, but people reuse passwords and leaving
// them readable would be careless for no reason.
// ---------------------------------------------------------------------------

import { findProfanity } from '../moderation.js';

const USERS_KEY = 'angler.users';

export const USERNAME_RULES = {
  min: 3,
  max: 20,
  pattern: /^[a-zA-Z0-9_-]+$/,
  describe: '3–20 characters: letters, numbers, underscore or hyphen.',
};

function readUsers() {
  try {
    const raw = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

/** Usernames are compared case-insensitively but displayed as typed. */
const key = (name) => String(name || '').trim().toLowerCase();

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hash(password, salt) {
  // SubtleCrypto needs a secure context; localhost and https both qualify.
  if (!crypto?.subtle) {
    throw new Error('This browser cannot hash passwords securely. Use https.');
  }
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateUsername(name) {
  const n = String(name || '').trim();
  if (n.length < USERNAME_RULES.min) return `Username needs at least ${USERNAME_RULES.min} characters.`;
  if (n.length > USERNAME_RULES.max) return `Username can be at most ${USERNAME_RULES.max} characters.`;
  if (!USERNAME_RULES.pattern.test(n)) return USERNAME_RULES.describe;
  // Light-touch: see js/moderation.js for why the list is short.
  if (findProfanity(n)) return 'Please choose a different username.';
  return null;
}

/** Optional on sign-up, so an empty value is valid. */
export function validateEmail(email) {
  const e = String(email || '').trim();
  if (!e) return null;
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
    return "That doesn't look like an email address.";
  }
  return null;
}

export function validatePassword(pw) {
  if (String(pw || '').length < 4) return 'Password needs at least 4 characters.';
  return null;
}

export function usernameTaken(name) {
  const k = key(name);
  // History counts. A released handle could be claimed by someone else and
  // then be mistaken for the person who used to hold it, which is the one
  // outcome keeping a rename trail is supposed to prevent.
  return readUsers().some(
    (u) => u.key === k || (u.handleHistory || []).some((h) => key(h.username) === k)
  );
}

export function listUsers() {
  return readUsers().map((u) => ({
    id: u.id,
    username: u.username,
    provider: u.provider || 'local',
    createdAt: u.createdAt,
  }));
}

export async function signUp(name, password, email = '') {
  const nameError = validateUsername(name);
  if (nameError) throw new Error(nameError);
  const pwError = validatePassword(password);
  if (pwError) throw new Error(pwError);
  const emailError = validateEmail(email);
  if (emailError) throw new Error(emailError);
  if (usernameTaken(name)) throw new Error('That username is already taken on this device.');

  const salt = randomSalt();
  const user = {
    id: crypto.randomUUID(),
    username: String(name).trim(),
    key: key(name),
    salt,
    hash: await hash(password, salt),
    provider: 'local',
    // Optional for now: nothing is sent to it, but it gives a way to link a
    // device-only account to a real one later.
    email: String(email || '').trim() || null,
    createdAt: new Date().toISOString(),
  };

  const users = readUsers();
  users.push(user);
  writeUsers(users);
  return { id: user.id, username: user.username, provider: 'local' };
}

export async function signIn(name, password) {
  const user = readUsers().find((u) => u.key === key(name));
  // Deliberately the same MESSAGE for both cases — there's no reason to
  // confirm which usernames exist on a shared device. The `code` is for the
  // facade, which must tell "not on this device, try the cloud" apart from
  // "wrong password, stop here"; it is never shown.
  if (!user) {
    const missing = new Error('Wrong username or password.');
    missing.code = 'no-such-user';
    throw missing;
  }
  if ((await hash(password, user.salt)) !== user.hash) {
    const wrong = new Error('Wrong username or password.');
    wrong.code = 'wrong-password';
    throw wrong;
  }

  return { id: user.id, username: user.username, provider: user.provider || 'local' };
}

/**
 * Write a local record with an id chosen by the caller.
 *
 * Used to mirror a cloud username account so it can still sign in with no
 * signal. Replaces any existing record with the same id or username, because
 * the cloud is authoritative for a synced account and a stale local copy with
 * an old password would lock someone out of their own phone.
 */
export async function adopt({ id, username, password, provider = 'username' }) {
  if (!id) throw new Error('adopt() needs the account id.');
  const salt = randomSalt();
  const record = {
    id,
    username: String(username).trim(),
    key: key(username),
    salt,
    hash: await hash(password, salt),
    provider,
    email: null,
    createdAt: new Date().toISOString(),
  };

  const users = readUsers().filter((u) => u.id !== id && u.key !== record.key);
  users.push(record);
  writeUsers(users);
  return { id: record.id, username: record.username, provider };
}

/** Look up a stored local account by id. Used by the facade to resolve a session. */
export function getById(id) {
  const user = readUsers().find((u) => u.id === id);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    provider: user.provider || 'local',
    createdAt: user.createdAt,
    handleChangedAt: user.handleChangedAt || null,
    // Oldest first. Read-only to callers — renameHandle owns the writing.
    handleHistory: [...(user.handleHistory || [])],
  };
}

// --- changing the handle -----------------------------------------------------
//
// The handle is what you sign in with, so renaming it is not the same kind of
// edit as a display name. Three rules, and each one exists for a reason:
//
//   ONE CHANGE PER 30 DAYS. A handle other people use to know you is not worth
//   much if it can change hourly, and the cooldown is what makes it worth
//   something. It is checked against the stored timestamp rather than a
//   counter, so clearing app data does not hand out a free change.
//
//   OLD HANDLES ARE KEPT, not discarded. Someone who renames still has a trail
//   back to who they were — which matters for anything that ever refers to an
//   angler by name (shared catches, a leaderboard, a report someone filed).
//   Keeping the trail costs a few bytes; reconstructing it later is impossible.
//
//   AN OLD HANDLE STAYS YOURS. usernameTaken() looks at history as well as
//   current names, so renaming does not release your old handle for someone
//   else to claim and then be mistaken for you.

/** 30 days, in ms. */
export const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * When this account may next change its handle, or null if it may now.
 * A never-renamed account may rename immediately — the clock starts at the
 * first change, not at sign-up.
 */
export function handleAvailableAt(userId) {
  const user = readUsers().find((u) => u.id === userId);
  if (!user?.handleChangedAt) return null;
  const next = new Date(user.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS;
  return next > Date.now() ? new Date(next) : null;
}

/**
 * Rename an account. Returns the updated public record.
 *
 * Throws with a sentence fit to show the user — every failure here is
 * something they can act on.
 */
export async function renameHandle(userId, next) {
  const users = readUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) throw new Error('That account is not on this device.');

  const name = String(next || '').trim();
  const nameError = validateUsername(name);
  if (nameError) throw new Error(nameError);

  // Changing case or nothing at all is not a change, and must not spend the
  // 30 days. Storing the new spelling is still worth doing.
  if (key(name) === target.key) {
    if (name !== target.username) {
      target.username = name;
      writeUsers(users);
    }
    return getById(userId);
  }

  const waitUntil = handleAvailableAt(userId);
  if (waitUntil) {
    const days = Math.ceil((waitUntil.getTime() - Date.now()) / 86400000);
    throw new Error(`You can change your handle again in ${days} day${days === 1 ? '' : 's'}.`);
  }
  if (usernameTaken(name)) throw new Error('That handle is already taken.');

  target.handleHistory = [
    ...(target.handleHistory || []),
    { username: target.username, until: new Date().toISOString() },
  ];
  target.username = name;
  target.key = key(name);
  target.handleChangedAt = new Date().toISOString();
  writeUsers(users);
  return getById(userId);
}

export async function changePassword(name, oldPw, newPw) {
  const user = readUsers().find((u) => u.key === key(name));
  if (!user || (await hash(oldPw, user.salt)) !== user.hash) {
    throw new Error('Wrong current password.');
  }
  const pwError = validatePassword(newPw);
  if (pwError) throw new Error(pwError);

  const users = readUsers();
  const target = users.find((u) => u.id === user.id);
  target.salt = randomSalt();
  target.hash = await hash(newPw, target.salt);
  writeUsers(users);
}

/** Removes the account. Catches are handled by the caller. */
export function deleteAccount(userId) {
  writeUsers(readUsers().filter((u) => u.id !== userId));
}
