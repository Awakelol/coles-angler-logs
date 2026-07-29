// ---------------------------------------------------------------------------
// USERNAME → FIREBASE CREDENTIALS
//
// Firebase Auth has no username provider. To give a username account a real,
// server-verified identity — which is what Firestore's security rules need
// before they'll trust a write — the account is created against the
// Email/Password provider using values DERIVED from the username and password.
//
// Two derivations, both deterministic, because a different device must arrive
// at exactly the same credentials from the same two things the person typed.
// That determinism is the whole feature: it is what makes "sign in on your
// friend's phone and your log is there" work without a server of our own.
//
// EMAIL is synthesised from the username at a .invalid domain. RFC 2606
// reserves .invalid precisely so software can mint addresses that are
// guaranteed never to resolve, which is the honest thing to do here — the
// address is an identifier, not a mailbox, and nothing will ever be sent to it.
//
// PASSWORD is PBKDF2 over the real password, never the password itself. Three
// reasons, in order of how much they matter:
//
//   1. The person's actual password is never transmitted to Google. They are
//      going to reuse it — everyone does — and a fishing log is not worth
//      handing that to a third party.
//   2. Firebase enforces a 6-character minimum. This app allows 4, and there
//      are already accounts using 4. A hex digest is always long enough, so
//      existing accounts upgrade silently instead of being told to pick a new
//      password for reasons they'd have to care about Firebase to understand.
//   3. It makes the stored credential useless anywhere else, even if Firebase
//      were breached and the hashes broken.
//
// The salt is the username rather than random bytes. A random salt cannot work
// here — a second device has nowhere to read it from — and the usual reason for
// per-user salts (stopping one rainbow table cracking a whole leaked table at
// once) is Firebase's problem to solve on its side, not ours. Prefixing the
// app name keeps the derived value from colliding with any other system that
// happens to salt by username.
// ---------------------------------------------------------------------------

/** Usernames are compared case-insensitively; the derivation must match. */
export const usernameKey = (name) => String(name || '').trim().toLowerCase();

/**
 * The address a username account is registered under.
 * Never receives mail — see the .invalid note above.
 */
export function syntheticEmail(username) {
  return `${usernameKey(username)}@angler.invalid`;
}

/** True for an address this app minted, rather than one a person typed. */
export const isSyntheticEmail = (email) => String(email || '').endsWith('@angler.invalid');

/** Recover the username from a synthetic address. Null for real addresses. */
export function usernameFromEmail(email) {
  return isSyntheticEmail(email) ? String(email).split('@')[0] : null;
}

// Chosen to cost a noticeable but tolerable amount on a mid-range phone —
// this runs once per sign-in, not per request. Raising it later would lock
// everyone out of their cloud account, so it is deliberately not a knob.
const ITERATIONS = 210000;
const KEY_BITS = 256;

/**
 * The password actually sent to Firebase.
 *
 * @returns {Promise<string>} 64 hex characters — comfortably past Firebase's
 *          6-character minimum regardless of what the person chose.
 */
export async function derivePassword(username, password) {
  if (!crypto?.subtle) {
    // SubtleCrypto needs a secure context. localhost and https both qualify;
    // plain http on a LAN address does not, and that is worth saying plainly
    // rather than failing inside the Firebase SDK with something cryptic.
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
