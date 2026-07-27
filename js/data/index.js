// ---------------------------------------------------------------------------
// DATA REGISTRY
//
// Two independent things, deliberately kept apart:
//
//   SPECIES CATALOGUE  a flat, region-independent list of fish (js/data/species/)
//   REGIONS            places, each listing the species ids that are POSSIBLE
//                      there (js/data/regions/)
//
// Species are not owned by a region. The same great barracuda appears in a
// Tacloban harbour, off a reef and in a channel — listed by id in each, stored
// once. Adding a region never means copying species data.
//
// TO ADD A REGION:
//   1. Copy js/data/regions/leyte-gulf.js to js/data/regions/<your-region>.js
//   2. Edit its details and list the species ids that occur there.
//   3. Import it below and add it to REGIONS.
// TO ADD A SPECIES:
//   1. Append it to js/data/species/indo-pacific.js (or a new catalogue file).
//   2. List its id under whichever regions and zones it turns up in.
// ---------------------------------------------------------------------------

import { INDO_PACIFIC_SPECIES } from './species/indo-pacific.js';
import leyteGulf from './regions/leyte-gulf.js';
import { GENERAL_TIPS } from './tips.js';

// Add further catalogue files here; ids must stay unique across all of them.
const CATALOGUES = [INDO_PACIFIC_SPECIES];

export const SPECIES = new Map();
for (const list of CATALOGUES) {
  for (const s of list) {
    if (SPECIES.has(s.id)) console.warn(`[data] duplicate species id: ${s.id}`);
    SPECIES.set(s.id, s);
  }
}

export const REGIONS = [leyteGulf];
export const DEFAULT_REGION_ID = 'leyte-gulf';

export function getRegion(id) {
  return REGIONS.find((r) => r.id === id) || REGIONS[0];
}

/** Look up a species by id, from anywhere in the catalogue. */
export function getSpecies(id) {
  return SPECIES.get(id) || null;
}

/** Resolve a list of species ids to species objects, dropping unknown ids. */
export function resolveSpecies(ids) {
  const out = [];
  for (const id of ids || []) {
    const s = SPECIES.get(id);
    if (s) out.push(s);
    else console.warn(`[data] unknown species id: ${id}`);
  }
  return out;
}

/** Species possible in a region. Falls back to the union of its zones. */
export function allSpecies(regionId) {
  const region = getRegion(regionId);
  if (region.species?.length) return resolveSpecies(region.species);
  const ids = new Set((region.zones || []).flatMap((z) => z.species || []));
  return resolveSpecies([...ids]);
}

/** General tips plus this region's own. */
export function tipsFor(regionId) {
  const region = getRegion(regionId);
  return [
    ...(region.tips || []).map((t) => ({ ...t, scope: region.name })),
    ...GENERAL_TIPS.map((t) => ({ ...t, scope: 'General' })),
  ];
}

/** Group a region's species by family, for the guide's section headers. */
export function speciesByFamily(regionId) {
  const groups = new Map();
  for (const s of allSpecies(regionId)) {
    const key = s.family || 'Other';
    if (!groups.has(key)) {
      groups.set(key, { family: key, familyCommon: s.familyCommon || '', species: [] });
    }
    groups.get(key).species.push(s);
  }
  return [...groups.values()].sort((a, b) => b.species.length - a.species.length);
}

/** Every zone across a region in which this species is a possible catch. */
export function zonesForSpecies(regionId, speciesId) {
  return (getRegion(regionId).zones || []).filter((z) => (z.species || []).includes(speciesId));
}

/** FishBase summary URL, derived from the scientific name. */
export function fishbaseUrl(species) {
  const [genus, ...rest] = (species.scientific || '').trim().split(/\s+/);
  if (!genus || !rest.length) return 'https://www.fishbase.se/search.php';
  return `https://www.fishbase.se/summary/${genus}-${rest.join('-')}.html`;
}

/**
 * Local names flattened for display. The same word is often used in both
 * Waray and Cebuano ("sap-sap", "maya-maya"), so identical names are merged
 * and their languages joined rather than listed twice.
 */
export function localNames(species) {
  const byName = new Map();
  for (const [lang, names] of Object.entries(species.local || {})) {
    const label = { war: 'Waray', ceb: 'Cebuano', tl: 'Tagalog' }[lang] || lang;
    for (const n of names) {
      const key = n.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: n.trim(), langs: [] });
      const entry = byName.get(key);
      if (!entry.langs.includes(label)) entry.langs.push(label);
    }
  }
  return [...byName.values()].map((e) => ({ name: e.name, label: e.langs.join(' / ') }));
}
