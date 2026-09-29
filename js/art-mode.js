// Art mode: modern icons by default, pixel art ("retro") as an easter egg.
//
// Two flags: `unlocked` (egg found) and the mode itself, so switching retro off
// doesn't hide the toggle again. Own localStorage keys, like theme.js, since
// this is read at first paint.

export const ART_MODES = ['modern', 'retro'];

const MODE_KEY = 'angler.artMode';
const UNLOCK_KEY = 'angler.retroFound';

/** Taps on the version number in Settings (like Android's build number). */
export const UNLOCK_TAPS = 7;
/** Start showing a hint with this many taps left. */
export const UNLOCK_HINT_AT = 3;

const listeners = new Set();

export function isRetroUnlocked() {
  return localStorage.getItem(UNLOCK_KEY) === '1';
}

export function unlockRetro() {
  localStorage.setItem(UNLOCK_KEY, '1');
}

/** Hide the retro option again. */
export function relockRetro() {
  localStorage.removeItem(UNLOCK_KEY);
  setArtMode('modern');
}

export function getArtMode() {
  const saved = localStorage.getItem(MODE_KEY);
  // Ignore a stored 'retro' if the toggle isn't unlocked, or there'd be no way back.
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


export function applyArtMode() {
  const mode = getArtMode();
  document.documentElement.setAttribute('data-art', mode);
  return mode;
}

/** @returns {Function} unsubscribe */
export function onArtModeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
