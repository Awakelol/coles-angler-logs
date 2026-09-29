// Fuzzy species search for the "did you mean?" prompt. Local names often get
// spelled by ear (sapsap, maya maya, barakuda), so this matches against common,
// scientific, family and local names with plain Levenshtein distance. The
// catalogue is small enough that no index is needed.

/** Lowercase, strip accents and punctuation. */
export function normalise(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Levenshtein distance, two-row variant. */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0..1. Prefix matches score high so "barra" finds Barramundi and Barracuda. */
export function similarity(query, candidate) {
  const q = normalise(query);
  const c = normalise(candidate);
  if (!q || !c) return 0;
  if (c === q) return 1;
  if (c.startsWith(q)) return 0.95 - Math.min(0.2, (c.length - q.length) / 40);
  if (c.includes(q)) return 0.85 - Math.min(0.2, (c.length - q.length) / 40);

  const dist = editDistance(q, c);
  return 1 - dist / Math.max(q.length, c.length);
}

/** All searchable names for a species, tagged by kind. */
function termsFor(species, localNames) {
  const out = [
    { text: species.common, kind: 'name' },
    { text: species.scientific, kind: 'scientific' },
  ];
  if (species.familyCommon) out.push({ text: species.familyCommon, kind: 'family' });
  if (species.family) out.push({ text: species.family, kind: 'family' });
  for (const l of localNames(species)) out.push({ text: l.name, kind: 'local', label: l.label });
  return out.filter((t) => t.text);
}

/**
 * Closest species to a query that matched nothing.
 *
 * @param {number} threshold minimum similarity. 0.45 catches "sapsap"/"sap-sap"
 *        and "barakuda"/"barracuda" without matching gibberish.
 * @returns {Array<{species, term, kind, label, score}>}
 */
export function suggestSpecies(query, speciesList, localNames, { limit = 3, threshold = 0.45 } = {}) {
  const q = normalise(query);
  if (q.length < 2) return [];

  const best = new Map();
  for (const s of speciesList) {
    for (const t of termsFor(s, localNames)) {
      const score = similarity(q, t.text);
      if (score < threshold) continue;
      const prev = best.get(s.id);
      if (!prev || score > prev.score) {
        best.set(s.id, { species: s, term: t.text, kind: t.kind, label: t.label, score });
      }
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.species.common.localeCompare(b.species.common))
    .slice(0, limit);
}
