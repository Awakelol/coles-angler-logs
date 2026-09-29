// Username moderation. Intentionally light: block slurs and obvious
// profanity without tripping on real words (the Scunthorpe problem).
//
//   - blocklist of unambiguous terms only
//   - leet-speak folded (b1tch, b!tch)
//   - allowlist for real words containing a blocked substring
//   - substring matching, since usernames have no spaces
//
// It will miss things; a rude name can be handled by hand, a false positive on
// someone's real name is worse.

// Characters commonly swapped in to dodge filters.
const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g',
  '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '+': 't',
};

/** Fold to bare lowercase letters, with leet-speak resolved. */
export function normalise(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

// Unambiguous terms only; every addition risks catching a real name.
const BLOCKED = [
  'nigger', 'nigga', 'faggot', 'retard', 'chink', 'spic', 'wetback',
  'kike', 'tranny', 'paki', 'coon', 'gook',
  'cunt', 'fuck', 'shit', 'bitch', 'whore', 'slut', 'rape', 'pedo',
  'wank', 'bastard', 'dick', 'cock', 'penis', 'vagina', 'porn',
  'nazi', 'hitler', 'kkk',
];

// Ordinary words that contain a blocked substring.
const ALLOWED = [
  'assassin', 'assess', 'assets', 'assign', 'assist', 'associate', 'assume',
  'bass', 'brass', 'class', 'compass', 'cutlass', 'glass', 'grass', 'mass',
  'pass', 'sassy', 'wrasse',
  'scunthorpe', 'penistone', 'lightwater', 'clitheroe',
  'shiitake', 'shitake',
  'cockle', 'cockpit', 'cocktail', 'peacock', 'shuttlecock', 'woodcock',
  'dickens', 'dickinson',
  'analysis', 'analyst', 'canal', 'banal',
  'therapist', 'therapy',
  'titan', 'titanium', 'constitution', 'substitute',
];

/**
 * @returns {string|null} the offending term, or null if the name is fine.
 */
export function findProfanity(name) {
  const folded = normalise(name);
  if (!folded) return null;

  // Blank out allowed words first, rather than letting any name that contains
  // one through ("bass" + a slur should still be caught).
  let rest = folded;
  for (const w of ALLOWED) rest = rest.split(w).join(' ');

  return BLOCKED.find((word) => rest.includes(word)) || null;
}

export function isClean(name) {
  return findProfanity(name) === null;
}
