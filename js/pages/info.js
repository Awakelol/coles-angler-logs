// Info: the reference section. Three tabs sharing one search box:
//
//   Fishes  species guide
//   Gear    rods, reels, line etc.
//   Zones   the region's waters (same write-up as the map pins)
//
// Tips show up as a "Trivia" section at the bottom of the tab they belong to.
//
// The active tab goes into the hash via replaceState; assigning location.hash
// would fire hashchange, remount the page and clear the search box.

import {
  allSpecies, speciesByFamily, localNames, getSpecies, primaryName,
  triviaFor, zonesFor, zonesByWater,
} from '../data/index.js';
import { GEAR, GEAR_GROUPS, gearByGroup, getGear } from '../data/gear.js';
import { photoFor } from '../data/species-photos.js';
import { deckHtml, mountDeck } from '../card-deck.js';
import { speciesArt, icon } from '../art.js';
import { speciesDetailHtml, mountSheetPhoto } from '../species-ui.js';
import { suggestSpecies } from '../search.js';
import { identifyPanelHtml, mountIdentifyPanel } from './identify.js';
import { zoneSheetHtml, zonePalette, mountZoneSheet } from '../zone-ui.js';
import { habitatTactics } from '../data/tactics.js';
import { esc, openSheet } from '../ui.js';

// Separate icon and palette per tab so they're distinguishable at small sizes.
const TABS = [
  {
    id: 'fishes', label: 'Fishes',
    art: () => icon('fish', { size: 26, palette: 'ocean' }),
    count: (ctx) => `${allSpecies(ctx.regionId).length} species`,
  },
  {
    id: 'gear', label: 'Gear',
    art: () => icon('rod', { size: 26, palette: 'sunset' }),
    count: () => `${GEAR.length} items`,
  },
  {
    id: 'zones', label: 'Zones',
    art: () => icon('wave', { size: 26, palette: 'emerald' }),
    count: (ctx) => `${zonesFor(ctx.regionId).length} waters`,
  },
];

// Photo ID is a mode toggled from beside the search box rather than a tab.
// It's still `tab=photo` in the hash so it can be linked (and /identify
// redirects there).
const PHOTO = 'photo';
const isTab = (v) => v === PHOTO || TABS.some((t) => t.id === v);

// --- Fishes ------------------------------------------------------------------

function speciesCard(s) {
  // Local name first, then English and scientific names smaller.
  const lead = primaryName(s);
  const alsoLocal = localNames(s).slice(1, 2);
  return `
    <button class="card species-card" data-species="${esc(s.id)}">
      <div class="species-card__art">${speciesArt(s, { size: 170 })}</div>
      <div class="species-card__names">
        <h3 class="species-card__lead">${esc(lead.text)}</h3>
        ${
          lead.kind === 'local'
            ? `<p class="species-card__common">${esc(s.common)}</p>`
            : ''
        }
        <p class="species-card__sci">${esc(s.scientific)}</p>
      </div>
      <div class="chips">
        ${
          lead.kind === 'local'
            ? `<span class="chip chip--lang">${esc(lead.local.label)}</span>`
            : ''
        }
        ${alsoLocal.map((l) => `<span class="chip chip--local">${esc(l.name)}</span>`).join('')}
        ${s.target ? '<span class="chip chip--target">Target</span>' : ''}
      </div>
    </button>`;
}

// --- Gear --------------------------------------------------------------------

function gearCard(g) {
  return `
    <button class="card gear-card" data-gear="${esc(g.id)}">
      <div class="gear-card__art">${icon(g.icon, { size: 76, palette: g.palette || 'ocean' })}</div>
      <div>
        <h3 class="card__title">${esc(g.name)}</h3>
        <p class="card__sub">${esc(g.sub || '')}</p>
      </div>
    </button>`;
}

function gearDetailHtml(g) {
  const rows = [
    ['What it is', g.what],
    ['When to use it', g.when],
    ['Where it belongs', g.where],
  ];
  return `
    <div class="gear-card__art gear-card__art--hero">${icon(g.icon, { size: 150, palette: g.palette || 'ocean' })}</div>
    ${g.sub ? `<p class="card__sub" style="margin-bottom:16px">${esc(g.sub)}</p>` : ''}
    ${rows
      .map(
        ([label, body]) => `
        <section class="gear-fact">
          <h3 class="gear-fact__label">${esc(label)}</h3>
          <p class="card__body">${esc(body)}</p>
        </section>`
      )
      .join('')}
    <a class="btn btn--primary btn--block" style="margin-top:18px" href="#/log">Log a catch with it</a>`;
}

// --- Zones -------------------------------------------------------------------

function zoneCard(z) {
  return `
    <button class="card zone-card" data-zone="${esc(z.id)}">
      <div class="zone-card__art">${icon('fish', { size: 130, palette: zonePalette(z) })}</div>
      <div>
        <h3 class="card__title">${esc(z.name)}</h3>
        <p class="card__sub"><span class="zone-card__type">${esc(
        habitatTactics(z.type)?.label || z.type
      )}</span> &middot; ${esc(z.depth || 'depth unknown')}</p>
      </div>
      <p class="card__body zone-card__blurb">${esc(z.blurb || '')}</p>
      <div class="chips">
        <span class="chip chip--family">${(z.species || []).length} possible catches</span>
      </div>
    </button>`;
}

// --- Trivia (tips filed by category) -----------------------------------------

function triviaHtml(tips) {
  if (!tips.length) return '';
  return `
    <div class="section-head" style="margin-top:8px">
      <h2>Trivia</h2>
      <p>${tips.length} tip${tips.length === 1 ? '' : 's'} worth knowing</p>
    </div>
    <div class="grid grid--2" style="margin-bottom:30px">
      ${tips
        .map(
          (t) => `
        <article class="card tip-card${t.scope === 'General' ? ' tip-card--general' : ''}">
          <div class="chips">
            <span class="chip ${t.scope === 'General' ? 'chip--family' : 'chip--local'}">${esc(t.scope)}</span>
          </div>
          <h3 class="card__title">${esc(t.title)}</h3>
          <p class="card__body">${esc(t.body)}</p>
          <div class="chips">
            ${(t.tags || []).map((x) => `<span class="chip chip--tag">${esc(x)}</span>`).join('')}
          </div>
        </article>`
        )
        .join('')}
    </div>`;
}

const norm = (v) => String(v || '').toLowerCase();

function matchesSpecies(s, q) {
  if (!q) return true;
  return [s.common, s.scientific, s.family, s.familyCommon, ...localNames(s).map((l) => l.name)]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function matchesGear(g, q) {
  if (!q) return true;
  return [g.name, g.sub, g.what, g.when, g.where].join(' ').toLowerCase().includes(q);
}

function matchesZone(z, q) {
  if (!q) return true;
  return [z.name, z.type, z.depth, z.blurb, z.best].join(' ').toLowerCase().includes(q);
}

function matchesTip(t, q) {
  if (!q) return true;
  return [t.title, t.body, ...(t.tags || [])].join(' ').toLowerCase().includes(q);
}

export function render(ctx) {
  const species = allSpecies(ctx.regionId);
  const zones = zonesFor(ctx.regionId);
  const groups = speciesByFamily(ctx.regionId);
  const tab = isTab(ctx.params.get('tab')) ? ctx.params.get('tab') : 'fishes';

  return `
    <section class="band band--yellow">
      <div class="wrap">
        <div class="card card--tight" style="gap:12px">
          <div class="info-head">
            <h1 class="display">Info</h1>
            <p class="eyebrow">${esc(ctx.region.name)} &middot; ${species.length} fish &middot; ${GEAR.length} gear &middot; ${zones.length} zones</p>
          </div>

          <div class="search-row">
            <input type="search" id="infoSearch" placeholder="Search fishes, gear and waters…"
                   aria-label="Search information" autocomplete="off">
            <button class="search-row__cam" id="infoPhoto" aria-pressed="${tab === PHOTO}"
                    aria-label="Identify a fish from a photo" title="Identify from a photo">
              ${icon('camera', { size: 26, palette: 'slate' })}
            </button>
          </div>

          <div class="bookmarks" id="infoTabs" role="tablist" aria-label="Information category">
            ${TABS.map(
              (t) => `
              <button class="bookmark bookmark--${esc(t.id)}" role="tab" data-tab="${esc(t.id)}"
                      aria-selected="${t.id === tab}" id="infotab-${esc(t.id)}">
                <span class="bookmark__icon">${t.art()}</span>
                <span class="bookmark__label">${esc(t.label)}</span>
                <span class="bookmark__count">${esc(t.count ? t.count(ctx) : '')}</span>
              </button>`
            ).join('')}
          </div>

          <div class="chips" id="familyFilters">
            <button class="chip" data-family="" aria-pressed="true">All</button>
            ${groups
              .map(
                (g) =>
                  `<button class="chip" data-family="${esc(g.family)}" aria-pressed="false">${esc(
                    g.familyCommon || g.family
                  )} (${g.species.length})</button>`
              )
              .join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div id="infoResults" role="tabpanel" aria-labelledby="infotab-${esc(tab)}"></div>
      </div>
    </section>`;
}

/**
 * Folders for a tab: fishes by family, gear by group, zones by body of water.
 */
function foldersFor(tab, ctx, species, zones) {
  if (tab === 'gear') {
    const counts = new Map();
    for (const g of GEAR) counts.set(g.group, (counts.get(g.group) || 0) + 1);
    return GEAR_GROUPS
      .filter((g) => counts.get(g.id))
      .map((g) => ({ key: g.id, label: g.name, count: counts.get(g.id), blurb: g.blurb }));
  }

  if (tab === 'zones') {
    const counts = new Map();
    const example = new Map();
    for (const z of zones) {
      counts.set(z.water, (counts.get(z.water) || 0) + 1);
      if (!example.has(z.water)) example.set(z.water, z.name);
    }
    return [...counts.entries()].map(([water, count]) => ({
      key: water, label: water, count,
      blurb: `${example.get(water)} and other spots`,
    }));
  }

  return speciesByFamily(ctx.regionId).map((g) => ({
    key: g.family,
    label: g.familyCommon || g.family,
    count: g.species.length,
    // Scientific family name.
    blurb: g.family,
  }));
}

// Folder tints, cycled. Light enough for dark text on all of them.
const FOLDER_TINTS = 6;

/** Key for the "everything" folder. */
const ALL = '*';

/**
 * Up to four preview pictures for a folder: photos of the family's fish, or
 * of fish caught in that water. Gear uses icons.
 */
function folderArts(tab, key, species, zones) {
  const shot = (sp) => speciesArt(sp, { size: 150 });

  if (tab === 'gear') {
    const items = key ? GEAR.filter((g) => g.group === key) : GEAR;
    return items.slice(0, 4).map(
      (g) => icon(g.icon || 'box', { size: 46, palette: g.palette || 'slate' })
    );
  }

  if (tab === 'zones') {
    // Species from all zones in this water, deduplicated.
    const inWater = key ? zones.filter((z) => z.water === key) : zones;
    const ids = [];
    for (const z of inWater) {
      for (const id of z.species || []) if (!ids.includes(id)) ids.push(id);
    }
    const withPhotos = ids.map(getSpecies).filter((sp) => sp && photoFor(sp.id));
    if (withPhotos.length) return withPhotos.slice(0, 4).map(shot);
    return inWater.slice(0, 4).map(() => icon('wave', { size: 46, palette: 'ocean' }));
  }

  const pool = key ? species.filter((sp) => sp.family === key) : species;
  const withPhotos = pool.filter((sp) => photoFor(sp.id));
  if (withPhotos.length) return withPhotos.slice(0, 4).map(shot);
  return pool.slice(0, 4).map(() => icon('fish', { size: 46, palette: 'ocean' }));
}

/** Header for an open folder, matching the tapped card, with a close button. */
function folderHeadHtml(label, count, tint) {
  return `
    <div class="folder-head" ${tint == null ? '' : `data-tint="${tint}"`}>
      <div class="folder-head__bill">
        <p class="folder-head__k">${esc(label)}</p>
        <button class="folder-head__x" data-close-folder aria-label="Back to all folders">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
                  d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>
      <p class="folder-head__n">${esc(count)}</p>
    </div>`;
}

export function mount(root, ctx) {
  const species = allSpecies(ctx.regionId);
  const zones = zonesFor(ctx.regionId);

  const results = root.querySelector('#infoResults');
  const search = root.querySelector('#infoSearch');
  const tabBar = root.querySelector('#infoTabs');
  const filterBar = root.querySelector('#familyFilters');

  let tab = isTab(ctx.params.get('tab')) ? ctx.params.get('tab') : 'fishes';
  let query = '';
  // Open folder per tab, so switching tabs and back keeps your place.
  // '' = folder pile, ALL = everything, anything else = one folder.
  const open = { fishes: ctx.params.get('family') || '', gear: '', zones: '' };

  if (open.fishes) {
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String((b.dataset.family || ALL) === (open.fishes || ALL)));
    }
  }

  const photoBtn = root.querySelector('#infoPhoto');
  // Revoke the photo's blob URL when leaving photo mode (replaceState means
  // no hashchange will do it).
  let releasePhoto = null;
  // Tab to return to when leaving photo mode.
  let lastTab = tab === PHOTO ? 'fishes' : tab;

  const openSpecies = (s) => openSheet(s.common, () => speciesDetailHtml(s, ctx.regionId), mountSheetPhoto(s));

  /** Update the hash without remounting. */
  function syncHash() {
    const params = new URLSearchParams();
    params.set('tab', tab);
    if (tab === 'fishes' && open.fishes && open.fishes !== ALL) params.set('family', open.fishes);
    const next = `#/info?${params}`;
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  /** Result counts for the other tabs, to point at when a search is empty. */
  function crossTabCounts() {
    return {
      fishes: species.filter((s) => matchesSpecies(s, query)).length,
      gear: GEAR.filter((g) => matchesGear(g, query)).length,
      zones: zones.filter((z) => matchesZone(z, query)).length,
    };
  }

  function elsewhereHtml() {
    if (!query) return '';
    const counts = crossTabCounts();
    const others = TABS.filter((t) => t.id !== tab && counts[t.id] > 0);
    if (!others.length) return '';
    return `
      <p class="info-elsewhere">
        Also matching:
        ${others
          .map(
            (t) =>
              `<button class="chip chip--target" data-goto="${esc(t.id)}">${counts[t.id]} in ${esc(
                t.label
              )}</button>`
          )
          .join(' ')}
      </p>`;
  }

  function emptyHtml(message, extra = '') {
    return `
      <div class="empty">
        ${icon('book', { size: 96, palette: 'slate' })}
        <p>${message}</p>
        ${extra}
        ${elsewhereHtml()}
        <button class="btn btn--sm" data-clear>Clear search</button>
      </div>`;
  }

  // --- per-tab renderers ---------------------------------------------------

  function drawPhoto() {
    results.innerHTML = identifyPanelHtml();
    releasePhoto = mountIdentifyPanel(results);
  }

  const noun = () => (tab === 'gear' ? 'items' : tab === 'zones' ? 'waters' : 'species');

  /** True when a single folder (not the pile or Everything) is open. */
  const soloFolder = () => phone() && open[tab] && open[tab] !== ALL;

  function drawFishes() {
    const shown = species.filter((s) => (!open.fishes || open.fishes === ALL || s.family === open.fishes) && matchesSpecies(s, query));
    const trivia = triviaFor(ctx.regionId, 'fishes').filter((t) => matchesTip(t, query));

    if (!shown.length) {
      // Empty result: probably a misspelled local name.
      const guesses = query ? suggestSpecies(query, species, localNames) : [];
      results.innerHTML =
        emptyHtml(
          `Nothing matches &ldquo;${esc(search.value.trim())}&rdquo;.`,
          guesses.length
            ? `<div class="suggest">
                 <p class="suggest__lead">Did you mean&hellip;</p>
                 <div class="grid grid--3">
                   ${guesses
                     .map(
                       (g) => `
                     <button class="card suggest__item" data-suggest="${esc(g.species.id)}">
                       <div class="species-card__art">${speciesArt(g.species, { size: 140 })}</div>
                       <div>
                         <h3 class="card__title">${esc(g.species.common)}</h3>
                         <p class="card__sub species-card__sci">${esc(g.species.scientific)}</p>
                       </div>
                       ${
                         g.kind === 'local'
                           ? `<div class="chips"><span class="chip chip--local">${esc(g.term)}${
                               g.label ? ` · ${esc(g.label)}` : ''
                             }</span></div>`
                           : ''
                       }
                     </button>`
                     )
                     .join('')}
                 </div>
               </div>`
            : ''
        ) + triviaHtml(trivia);

      for (const btn of results.querySelectorAll('[data-suggest]')) {
        btn.addEventListener('click', () => {
          const s = getSpecies(btn.dataset.suggest);
          if (!s) return;
          // Put the corrected name in the box so the next search works.
          search.value = s.common;
          query = norm(s.common);
          draw();
          openSpecies(s);
        });
      }
      return;
    }

    // Group by family.
    const groups = new Map();
    for (const s of shown) {
      const key = s.family || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    results.innerHTML =
      headHtml(shown.length) +
      elsewhereHtml() +
      [...groups.entries()]
        .map(
          ([fam, items]) => `
          <div class="section-head" style="margin-top:8px" ${soloFolder() ? 'hidden' : ''}>
            <h2>${esc(items[0].familyCommon || fam)}</h2>
            <p><em>${esc(fam)}</em> &middot; ${items.length} species</p>
          </div>
          <div class="grid grid--3" style="margin-bottom:30px">
            ${items.map(speciesCard).join('')}
          </div>`
        )
        .join('') +
      triviaHtml(trivia);

    for (const btn of results.querySelectorAll('[data-species]')) {
      btn.addEventListener('click', () => {
        const s = getSpecies(btn.dataset.species);
        if (s) openSpecies(s);
      });
    }
  }

  function drawGear() {
    const shown = GEAR.filter((g) => (!open.gear || open.gear === ALL || g.group === open.gear) && matchesGear(g, query));
    const trivia = triviaFor(ctx.regionId, 'gear').filter((t) => matchesTip(t, query));

    if (!shown.length) {
      results.innerHTML =
        emptyHtml(`No gear matches &ldquo;${esc(search.value.trim())}&rdquo;.`) + triviaHtml(trivia);
      return;
    }

    results.innerHTML =
      headHtml(shown.length) +
      elsewhereHtml() +
      gearByGroup(shown)
        .map(
          (g) => `
          <div class="section-head" style="margin-top:8px" ${soloFolder() ? 'hidden' : ''}>
            <h2>${esc(g.name)}</h2>
            <p>${esc(g.blurb)}</p>
          </div>
          <div class="grid grid--3" style="margin-bottom:30px">
            ${g.items.map(gearCard).join('')}
          </div>`
        )
        .join('') +
      triviaHtml(trivia);

    for (const btn of results.querySelectorAll('[data-gear]')) {
      btn.addEventListener('click', () => {
        const g = getGear(btn.dataset.gear);
        if (g) openSheet(g.name, () => gearDetailHtml(g));
      });
    }
  }

  function drawZones() {
    const shown = zones.filter((z) => (!open.zones || open.zones === ALL || z.water === open.zones) && matchesZone(z, query));
    const trivia = triviaFor(ctx.regionId, 'zones').filter((t) => matchesTip(t, query));

    if (!shown.length) {
      results.innerHTML =
        emptyHtml(`No waters match &ldquo;${esc(search.value.trim())}&rdquo;.`) + triviaHtml(trivia);
      return;
    }

    // Group by body of water; filtering narrows within each group.
    const visible = new Set(shown.map((z) => z.id));
    const groups = zonesByWater(ctx.regionId)
      .map((g) => ({ ...g, zones: g.zones.filter((z) => visible.has(z.id)) }))
      .filter((g) => g.zones.length);

    results.innerHTML =
      headHtml(shown.length) +
      elsewhereHtml() +
      groups
        .map(
          (g) => `
          <div class="section-head" style="margin-top:8px" ${soloFolder() ? 'hidden' : ''}>
            <h2>${esc(g.water)}</h2>
            <p>${g.zones.length} spot${g.zones.length === 1 ? '' : 's'} &middot; tap for tactics</p>
          </div>
          <div class="grid grid--3" style="margin-bottom:20px">
            ${g.zones.map(zoneCard).join('')}
          </div>`
        )
        .join('') +
      `<a class="btn btn--dark" style="margin-bottom:30px" href="#/map">Open the map</a>` +
      triviaHtml(trivia);

    for (const btn of results.querySelectorAll('[data-zone]')) {
      btn.addEventListener('click', () => {
        const z = zones.find((x) => x.id === btn.dataset.zone);
        if (z) openSheet(z.name, () => zoneSheetHtml(z), (sheetRoot) =>
          mountZoneSheet(sheetRoot, z, ctx.regionId));
      });
    }
  }

  const phone = () => matchMedia('(max-width: 899px)').matches;

  let deckApi = null;
  // Card to open the deck on, so closing a folder returns to it.
  let lastOpened = '';

  /** Label and tint of the open folder. */
  function openFolderMeta() {
    if (open[tab] === ALL) return { label: 'Everything', tint: null };
    const items = foldersFor(tab, ctx, species, zones);
    const i = items.findIndex((f) => f.key === open[tab]);
    if (i < 0) return null;
    return { label: items[i].label, tint: i % FOLDER_TINTS };
  }

  function headHtml(count) {
    if (!phone() || !open[tab]) return '';
    const meta = openFolderMeta();
    return meta ? folderHeadHtml(meta.label, `${count} ${noun()}`, meta.tint) : '';
  }

  function drawDeck() {
    const items = foldersFor(tab, ctx, species, zones);
    const all = tab === 'gear' ? GEAR.length : tab === 'zones' ? zones.length : species.length;

    // "Everything" comes first.
    const cards = [
      { key: ALL, label: 'Everything', blurb: `All ${all} ${noun()}, ungrouped`,
        count: all, noun: noun(), tint: null,
        images: folderArts(tab, null, species, zones) },
      ...items.map((f, i) => ({
        key: f.key,
        label: f.label,
        blurb: f.blurb || '',
        count: f.count,
        noun: noun(),
        tint: i % FOLDER_TINTS,
        images: folderArts(tab, f.key, species, zones),
      })),
    ];

    results.innerHTML = deckHtml(cards);
    deckApi?.destroy?.();
    deckApi = mountDeck(results, { onOpen: openFolder, startKey: lastOpened });
  }

  function openFolder(key) {
    if (!key) return;
    lastOpened = key;
    open[tab] = key;
    if (tab === 'fishes') {
      for (const b of filterBar.querySelectorAll('[data-family]')) {
        b.setAttribute('aria-pressed', String((b.dataset.family || ALL) === (open.fishes || ALL)));
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    syncHash();
    draw();
  }

  function fill() {
    if (tab === 'gear') drawGear();
    else if (tab === 'zones') drawZones();
    else drawFishes();
  }

  function draw() {
    const photo = tab === PHOTO;

    // Hide family chips in photo mode but keep the search box: typing a name
    // is how you leave photo mode.
    filterBar.hidden = photo || tab !== 'fishes';
    for (const b of tabBar.querySelectorAll('[data-tab]')) {
      b.setAttribute('aria-selected', String(!photo && b.dataset.tab === tab));
    }
    if (photoBtn) photoBtn.setAttribute('aria-pressed', String(photo));
    results.setAttribute('aria-labelledby', photo ? 'infoPhoto' : `infotab-${tab}`);

    if (!photo && releasePhoto) {
      releasePhoto();
      releasePhoto = null;
    }

    // The deck locks page scroll while shown so the page doesn't steal the
    // swipe. A search skips the deck and lists matches directly.
    const deckShowing = !photo && phone() && !open[tab] && !query;
    document.body.classList.toggle('deck-locked', deckShowing);
    document.documentElement.classList.toggle('deck-locked', deckShowing);
    if (deckShowing) {
      drawDeck();
      return;
    }

    if (photo) drawPhoto();
    else fill();

    for (const btn of results.querySelectorAll('[data-goto]')) {
      btn.addEventListener('click', () => {
        tab = btn.dataset.goto;
        syncHash();
        draw();
      });
    }

    const clear = results.querySelector('[data-clear]');
    if (clear) {
      clear.addEventListener('click', () => {
        clearTimeout(typing); // don't let a half-typed word redraw over the reset
        query = '';
        open[tab] = '';
        search.value = '';
        for (const b of filterBar.querySelectorAll('[data-family]')) {
          b.setAttribute('aria-pressed', String(!b.dataset.family));
        }
        syncHash();
        draw();
      });
    }
  }

  // --- wiring --------------------------------------------------------------

  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn || btn.dataset.tab === tab) return;
    clearTimeout(typing); // a half-typed word must not redraw over the new tab
    tab = btn.dataset.tab;
    lastTab = tab;
    lastOpened = '';
    syncHash();
    draw();
  });

  // Toggle: pressing again returns to the previous tab.
  photoBtn?.addEventListener('click', () => {
    clearTimeout(typing);
    tab = tab === PHOTO ? lastTab : PHOTO;
    syncHash();
    draw();
  });

  // Debounce to one frame so fast typing doesn't queue renders.
  let typing = 0;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      query = norm(search.value.trim());
      // Typing leaves photo mode and returns to the previous tab.
      if (tab === PHOTO) {
        tab = lastTab;
        syncHash();
      }
      draw();
    }, 120);
  });

  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-family]');
    if (!btn) return;
    open.fishes = btn.dataset.family || ALL;
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    syncHash();
    draw();
  });

  /** Close the open folder and return to the deck. */
  function closeFolder() {
    open[tab] = '';
    if (tab === 'fishes') {
      for (const b of filterBar.querySelectorAll('[data-family]')) {
        b.setAttribute('aria-pressed', String(!b.dataset.family));
      }
    }
    syncHash();
    draw();
  }

  // Close button on the folder header (delegated; the header is re-rendered).
  results.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-folder]')) closeFolder();
  });

  // Drag the folder header down to close it. Moves the whole results pane.
  let drag = null;
  results.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.folder-head');
    if (!head || e.target.closest('[data-close-folder]')) return;
    drag = { id: e.pointerId, y0: e.clientY, moved: false };
  });
  results.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 8) return;
    drag.moved = true;
    // Rubber-band upward drags.
    const y = dy > 0 ? dy : dy * 0.2;
    results.style.transition = '';
    results.style.transform = `translate3d(0,${y.toFixed(1)}px,0)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    const moved = drag.moved;
    drag = null;
    results.style.transition = 'transform .32s cubic-bezier(.2,.7,.3,1)';
    results.style.transform = '';
    if (moved && dy > 110) {
      results.style.transform = 'translate3d(0,100%,0)';
      setTimeout(() => {
        results.style.transition = '';
        results.style.transform = '';
        closeFolder();
      }, 200);
    }
  };
  results.addEventListener('pointerup', endDrag);
  results.addEventListener('pointercancel', () => { drag = null; results.style.transform = ''; });

  draw();

  // Deep links: #/info?open=<id> (old #/species?open=<id> redirects here).
  const openSpeciesId = ctx.params.get('open');
  if (openSpeciesId) {
    const s = getSpecies(openSpeciesId);
    if (s) openSpecies(s);
  }

  const openGearId = ctx.params.get('gear');
  if (openGearId) {
    const g = getGear(openGearId);
    if (g) openSheet(g.name, () => gearDetailHtml(g));
  }

  const openZoneId = ctx.params.get('zone');
  if (openZoneId) {
    const z = zones.find((x) => x.id === openZoneId);
    if (z) openSheet(z.name, () => zoneSheetHtml(z), (sheetRoot) =>
      mountZoneSheet(sheetRoot, z, ctx.regionId));
  }
}
