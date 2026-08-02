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
//   1. Copy js/data/regions/leyte.js to js/data/regions/<your-region>.js
//   2. Edit its details and list the species ids that occur there.
//   3. Import it below and add it to REGIONS.
// TO ADD A SPECIES:
//   1. Append it to js/data/species/indo-pacific.js (or a new catalogue file).
//   2. List its id under whichever regions and zones it turns up in.
// ---------------------------------------------------------------------------

import { INDO_PACIFIC_SPECIES } from './species/indo-pacific.js';
import leyte from './regions/leyte.js';
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

export const REGIONS = [leyte];
export const DEFAULT_REGION_ID = 'leyte';

/**
 * Region ids that have been renamed, mapped to their current id.
 *
 * Catches are stored with the `regionId` that was current when they were
 * logged, and those records outlive a rename. Right now getRegion() falls back
 * to REGIONS[0] for anything unknown, so a legacy id LOOKS fine — until a
 * second region exists, at which point every old catch silently attaches to
 * whichever region happens to be first in the array.
 *
 * Translating on read costs one lookup and closes that off permanently. Keep
 * entries here forever; they are tiny and someone's log depends on them.
 */
const RENAMED = {
  'leyte-gulf': 'leyte', // the gulf became the whole island
};

/** The current id for a possibly-legacy one. */
export const currentRegionId = (id) => RENAMED[id] || id;

export function getRegion(id) {
  const wanted = currentRegionId(id);
  return REGIONS.find((r) => r.id === wanted) || REGIONS[0];
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

/**
 * Tips filed under one Info tab — the "Trivia" section of Fishes, Gear or
 * Zones. An uncategorised tip falls back to 'zones' rather than vanishing,
 * so adding a tip without a category still shows up somewhere.
 */
export function triviaFor(regionId, category) {
  return tipsFor(regionId).filter((t) => (t.category || 'zones') === category);
}

/** A region's zones, in declaration order. */
export function zonesFor(regionId) {
  return getRegion(regionId).zones || [];
}

/**
 * Zones grouped by the body of water they sit in, in first-appearance order.
 *
 * Leyte is not surrounded by one sea — the Pacific-facing gulf and the deeper
 * Bohol Sea side behave differently enough that a flat list of twenty zones
 * would read as noise. Grouping restores the shape of the place.
 *
 * A zone with no `water` lands in 'Other' rather than vanishing, so forgetting
 * the field degrades instead of losing data.
 */
export function zonesByWater(regionId) {
  const groups = new Map();
  for (const z of zonesFor(regionId)) {
    const key = z.water || 'Other';
    if (!groups.has(key)) groups.set(key, { water: key, zones: [] });
    groups.get(key).zones.push(z);
  }
  return [...groups.values()];
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

/**
 * The name to lead a card with, and what it is.
 *
 * Local first. Somebody here is far more likely to recognise "maya-maya" than
 * "mangrove red snapper", and a guide that leads with the English is a guide
 * written for a visitor. Falls back to the common name when there is no local
 * one at all, rather than leading with a blank.
 *
 * Note the caveat at the top of the species catalogue: the names on the 28
 * species added with the island expansion come from FishBase and have not
 * been checked locally. Promoting them to the headline makes getting them
 * right matter more, not less.
 */
export function primaryName(species) {
  const locals = localNames(species);
  if (!locals.length) return { text: species.common, kind: 'common', local: null };
  return { text: locals[0].name, kind: 'local', local: locals[0] };
}
