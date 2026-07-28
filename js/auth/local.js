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
// Local accounts DO NOT SYNC. That is the trade for needing nothing.
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
  return readUsers().some((u) => u.key === key(name));
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
  // Deliberately the same message for both cases — there's no reason to
  // confirm which usernames exist on a shared device.
  const wrong = new Error('Wrong username or password.');
  if (!user) throw wrong;
  if ((await hash(password, user.salt)) !== user.hash) throw wrong;

  return { id: user.id, username: user.username, provider: user.provider || 'local' };
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
  };
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
