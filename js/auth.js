// ---------------------------------------------------------------------------
// LOCAL PROFILES
//
// ⚠ THIS IS NOT AUTHENTICATION. There is no server, so nothing is verified
// anywhere. Accounts live in this browser's localStorage and anyone with
// devtools can read or edit them. It gates nothing from a determined person
// and protects nothing on an unlocked phone.
//
// What it IS: a "who is using the app" switch, so each person's catch log is
// their own. That is what makes the future move to real accounts (Firebase
// Auth) a swap of this module rather than a rewrite — everything downstream
// already keys off `userId`.
//
// Passwords are salted and hashed with SHA-256 rather than stored in plain
// text. That doesn't make this secure, but people reuse passwords, and
// leaving them readable in localStorage would be careless for no reason.
//
// ADDING GOOGLE / FACEBOOK LATER
// Every user object carries a `provider` ('local' today). The rest of the app
// only ever touches currentUser().id and isSignedIn(), so a real provider is
// additive rather than a rewrite:
//
//   1. Add js/auth/providers/google.js exposing signInWithGoogle(), returning
//      the same { id, username, provider } shape. Use the Firebase Auth uid
//      as `id`.
//   2. Add a button to the gate in js/pages/log.js that calls it.
//   3. Keep setSession()/currentUser() as the single source of truth.
//
// The one thing to plan for: catches are keyed by the local user id, so when
// someone links a real account their existing entries need re-pointing at the
// new uid — the same mechanism as store.adoptOrphans().
// ---------------------------------------------------------------------------

const USERS_KEY = 'angler.users';
const SESSION_KEY = 'angler.session';

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

export async function signUp(name, password) {
  const nameError = validateUsername(name);
  if (nameError) throw new Error(nameError);
  const pwError = validatePassword(password);
  if (pwError) throw new Error(pwError);
  if (usernameTaken(name)) throw new Error('That username is already taken on this device.');

  const salt = randomSalt();
  const user = {
    id: crypto.randomUUID(),
    username: String(name).trim(),
    key: key(name),
    salt,
    hash: await hash(password, salt),
    provider: 'local',
    createdAt: new Date().toISOString(),
  };

  const users = readUsers();
  users.push(user);
  writeUsers(users);
  setSession(user.id);
  return { id: user.id, username: user.username, provider: 'local' };
}

export async function signIn(name, password) {
  const user = readUsers().find((u) => u.key === key(name));
  // Deliberately the same message for both cases — there's no reason to
  // confirm which usernames exist on a shared device.
  const wrong = new Error('Wrong username or password.');
  if (!user) throw wrong;
  if ((await hash(password, user.salt)) !== user.hash) throw wrong;

  setSession(user.id);
  return { id: user.id, username: user.username, provider: user.provider || 'local' };
}

export function setSession(userId) {
  localStorage.setItem(SESSION_KEY, userId);
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

/** The signed-in user, or null. */
export function currentUser() {
  const id = localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const user = readUsers().find((u) => u.id === id);
  if (!user) {
    signOut(); // stale session, e.g. account deleted
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    provider: user.provider || 'local',
    createdAt: user.createdAt,
  };
}

export function isSignedIn() {
  return currentUser() !== null;
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
  if (localStorage.getItem(SESSION_KEY) === userId) signOut();
}
