// Username -> Firebase credentials.
//
// Firebase has no username provider, so a username account is registered with
// Email/Password using values derived from the username and password. Both
// derivations are deterministic so any device gets the same credentials from
// the same input.
//
// Email: <username>@angler.invalid. The .invalid TLD (RFC 2606) never
// resolves; it's an identifier, not a mailbox.
//
// Password: PBKDF2 of the real password, so
//   - the real password is never sent to Google,
//   - it always meets Firebase's 6-char minimum (this app allows 4),
//   - the stored credential is useless anywhere else.
//
// The salt is the username (prefixed with the app name) because another device
// has no way to look up a random salt.

/** Usernames are compared case-insensitively; the derivation must match. */
export const usernameKey = (name) => String(name || '').trim().toLowerCase();

/** The address a username account is registered under. */
export function syntheticEmail(username) {
  return `${usernameKey(username)}@angler.invalid`;
}

/** True for addresses minted by syntheticEmail(). */
export const isSyntheticEmail = (email) => String(email || '').endsWith('@angler.invalid');

/** Recover the username from a synthetic address. Null for real addresses. */
export function usernameFromEmail(email) {
  return isSyntheticEmail(email) ? String(email).split('@')[0] : null;
}

// Runs once per sign-in. Don't change this: every existing cloud account's
// password depends on it.
const ITERATIONS = 210000;
const KEY_BITS = 256;

/**
 * The password actually sent to Firebase.
 * @returns {Promise<string>} 64 hex characters
 */
export async function derivePassword(username, password) {
  if (!crypto?.subtle) {
    // SubtleCrypto needs a secure context (https or localhost).
    throw new Error('This browser cannot derive a secure key. Use https or localhost.');
  }

  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(`coles-angler-log:${usernameKey(username)}`),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    KEY_BITS
  );

  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
