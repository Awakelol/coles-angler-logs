// Local profiles (provider 'local').
//
// Not real authentication: accounts live in localStorage and anyone with
// devtools can edit them. They exist so people sharing a phone can keep
// separate logs with no setup and no network.
//
// A local record is also the offline mirror of a synced username account
// (see adopt()). Those use the Firebase uid as their id.
//
// Passwords are still salted and hashed so they aren't sitting in plain text.

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
  // Old handles stay reserved so nobody can take over a previous name.
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
    // Optional, unused for now.
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
  // Same message either way; the code tells auth.js whether to try the cloud.
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
 * Store a local mirror of a cloud account under the given id. Replaces any
 * record with the same id or username (the cloud copy wins).
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

/** Look up a local account by id. */
export function getById(id) {
  const user = readUsers().find((u) => u.id === id);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    provider: user.provider || 'local',
    createdAt: user.createdAt,
    handleChangedAt: user.handleChangedAt || null,
    // Oldest first.
    handleHistory: [...(user.handleHistory || [])],
  };
}

// --- changing the handle -----------------------------------------------------
//
// One change per 30 days (checked against the stored timestamp). Previous
// handles are kept in handleHistory and stay reserved (see usernameTaken).

export const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** When the handle can next be changed, or null if it can be now. */
export function handleAvailableAt(userId) {
  const user = readUsers().find((u) => u.id === userId);
  if (!user?.handleChangedAt) return null;
  const next = new Date(user.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS;
  return next > Date.now() ? new Date(next) : null;
}

/** Rename an account. Errors are user-facing messages. */
export async function renameHandle(userId, next) {
  const users = readUsers();
  const target = users.find((u) => u.id === userId);
  if (!target) throw new Error('That account is not on this device.');

  const name = String(next || '').trim();
  const nameError = validateUsername(name);
  if (nameError) throw new Error(nameError);

  // A case-only change doesn't count against the cooldown.
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
