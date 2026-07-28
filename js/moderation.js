// ---------------------------------------------------------------------------
// USERNAME MODERATION
//
// Deliberately light. The goal is to stop the obvious — someone signing up as
// a slur — not to police language. Over-filtering is its own failure: the
// classic case is "Scunthorpe", a real English town whose name contains a rude
// substring, and there are plenty of ordinary words that do the same.
//
// So:
//   - the blocklist holds only unambiguous terms, mostly slurs
//   - leet-speak is normalised, because b1tch and b!tch are the same intent
//   - an allowlist rescues real words that happen to contain a blocked
//     substring (assassin, class, Scunthorpe, shiitake, and so on)
//   - matching is on the normalised string, since usernames have no spaces to
//     give word boundaries
//
// This will miss things. That's the intended trade — a false accusation against
// someone's actual name is worse than a rude username slipping through, which
// can be dealt with by hand.
// ---------------------------------------------------------------------------

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

// Unambiguous terms only. Kept short on purpose — every addition raises the
// chance of catching an innocent name.
const BLOCKED = [
  'nigger', 'nigga', 'faggot', 'retard', 'chink', 'spic', 'wetback',
  'kike', 'tranny', 'paki', 'coon', 'gook',
  'cunt', 'fuck', 'shit', 'bitch', 'whore', 'slut', 'rape', 'pedo',
  'wank', 'bastard', 'dick', 'cock', 'penis', 'vagina', 'porn',
  'nazi', 'hitler', 'kkk',
];

// Ordinary words that contain a blocked substring. Checked first.
const ALLOWED = [
  'assassin', 'assess', 'assets', 'assign', 'assist', 'associate', 'assume',
  'bass', 'brass', 'class', 'compass', 'cutlass', 'glass', 'grass', 'mass',
  'pass', 'sassy', 'wrasse', // wrasse is a fish — this app will see it
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

  // A name that IS an ordinary word gets through untouched.
  if (ALLOWED.some((w) => folded === w || folded.includes(w))) return null;

  return BLOCKED.find((word) => folded.includes(word)) || null;
}

export function isClean(name) {
  return findProfanity(name) === null;
}
