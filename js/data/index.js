// Data registry.
//
//   species catalogue  region-independent list of fish (js/data/species/)
//   regions            places, each listing species ids found there
//                      (js/data/regions/)
//
// Species are stored once and referenced by id from any number of regions
// and zones.
//
// Adding a region:
//   1. Copy js/data/regions/leyte.js to js/data/regions/<your-region>.js
//   2. Edit its details and list the species ids that occur there.
//   3. Import it below and add it to REGIONS.
// Adding a species:
//   1. Append it to js/data/species/indo-pacific.js (or a new catalogue file).
//   2. List its id in the regions and zones where it occurs.

import { INDO_PACIFIC_SPECIES } from './species/indo-pacific.js';
import leyte from './regions/leyte.js';
import { GENERAL_TIPS } from './tips.js';

// Catalogue files; ids must be unique across all of them.
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
 * Renamed region ids -> current id. Old catches keep the regionId they were
 * logged with, so keep these entries around.
 */
const RENAMED = {
  'leyte-gulf': 'leyte', // the gulf became the whole island
};

/** Current id for a possibly-renamed one. */
export const currentRegionId = (id) => RENAMED[id] || id;

export function getRegion(id) {
  const wanted = currentRegionId(id);
  return REGIONS.find((r) => r.id === wanted) || REGIONS[0];
}

/** Species by id. */
export function getSpecies(id) {
  return SPECIES.get(id) || null;
}

/** Species ids -> species objects, skipping unknown ids. */
export function resolveSpecies(ids) {
  const out = [];
  for (const id of ids || []) {
    const s = SPECIES.get(id);
    if (s) out.push(s);
    else console.warn(`[data] unknown species id: ${id}`);
  }
  return out;
}

/** Species in a region. Falls back to the union of its zones. */
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
 * Tips for one Info tab (fishes, gear or zones). Tips without a category go
 * under 'zones'.
 */
export function triviaFor(regionId, category) {
  return tipsFor(regionId).filter((t) => (t.category || 'zones') === category);
}

export function zonesFor(regionId) {
  return getRegion(regionId).zones || [];
}

/**
 * Zones grouped by body of water, in first-appearance order. Zones with no
 * `water` go under 'Other'.
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

/** Species grouped by family. */
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

/** Zones in a region where this species occurs. */
export function zonesForSpecies(regionId, speciesId) {
  return (getRegion(regionId).zones || []).filter((z) => (z.species || []).includes(speciesId));
}

/** FishBase summary URL for a species. */
export function fishbaseUrl(species) {
  const [genus, ...rest] = (species.scientific || '').trim().split(/\s+/);
  if (!genus || !rest.length) return 'https://www.fishbase.se/search.php';
  return `https://www.fishbase.se/summary/${genus}-${rest.join('-')}.html`;
}

/**
 * Local names for display. Names shared by Waray and Cebuano (e.g. "sap-sap")
 * are merged, with both languages listed.
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
 * The name to lead a card with: the first local name if there is one,
 * otherwise the common name. (Local names on the species added from FishBase
 * haven't been checked locally yet; see the note in the catalogue.)
 */
export function primaryName(species) {
  const locals = localNames(species);
  if (!locals.length) return { text: species.common, kind: 'common', local: null };
  return { text: locals[0].name, kind: 'local', local: locals[0] };
}
