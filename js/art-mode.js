// ---------------------------------------------------------------------------
// ART MODE — modern by default, retro if you find it
//
// The whole app used to be pixel art. It still can be: nothing was deleted,
// the sprite grids and the nine-slot palettes are exactly where they were.
// What changed is which set is reached for by default.
//
// TWO FLAGS, NOT ONE. `unlocked` says the easter egg has been found, `retro`
// says it is currently on. Keeping them apart means turning retro off doesn't
// re-hide the toggle — having found something and then having to find it again
// is the kind of cleverness that reads as a bug.
//
// Its own localStorage keys rather than `prefs`, matching js/theme.js: this is
// read at first paint to decide which mark to draw, and prefs is a JSON blob
// that would have to be parsed to answer one boolean.
// ---------------------------------------------------------------------------

export const ART_MODES = ['modern', 'retro'];

const MODE_KEY = 'angler.artMode';
const UNLOCK_KEY = 'angler.retroFound';

/** Taps on the version number in Settings. Chosen to match the phone-OS
 *  gesture people already know; low enough to stumble into, high enough that
 *  nobody arrives by accident. */
export const UNLOCK_TAPS = 7;
/** Start telling them something is happening with this many left. */
export const UNLOCK_HINT_AT = 3;

const listeners = new Set();

export function isRetroUnlocked() {
  return localStorage.getItem(UNLOCK_KEY) === '1';
}

export function unlockRetro() {
  localStorage.setItem(UNLOCK_KEY, '1');
}

/** Only for the tests and a "forget it" control — the egg can be re-hidden. */
export function relockRetro() {
  localStorage.removeItem(UNLOCK_KEY);
  setArtMode('modern');
}

export function getArtMode() {
  const saved = localStorage.getItem(MODE_KEY);
  // A locked app is a modern app whatever the stored value says. That matters
  // if site data is cleared while retro is on: without this the art would stay
  // pixel with no visible way to change it back.
  if (!isRetroUnlocked()) return 'modern';
  return ART_MODES.includes(saved) ? saved : 'modern';
}

export function isRetro() {
  return getArtMode() === 'retro';
}

export function setArtMode(mode) {
  const next = ART_MODES.includes(mode) ? mode : 'modern';
  localStorage.setItem(MODE_KEY, next);
  document.documentElement.setAttribute('data-art', next);
  for (const fn of listeners) fn(next);
  return next;
}

/** Called once at boot, and again whenever the mode changes. */
export function applyArtMode() {
  const mode = getArtMode();
  document.documentElement.setAttribute('data-art', mode);
  return mode;
}

/** @returns {Function} an unsubscribe, so a page can stop listening on unmount. */
export function onArtModeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
