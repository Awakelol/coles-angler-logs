// ---------------------------------------------------------------------------
// INFO — the reference half of the app, in one place.
//
// Three tabs over one search box:
//
//   FISHES  the species guide (families, local names, sprites, photos)
//   GEAR    rods, reels, line and the rest, each answering what / when / where
//   ZONES   the region's waters, the same write-up the map pins open
//
// Tips are not a tab. Each one is filed under a category and surfaces as a
// "Trivia" section at the foot of the tab it belongs to, so advice about drag
// settings sits with the reels instead of in a list nobody opens.
//
// The active tab is mirrored into the hash with replaceState rather than by
// assigning location.hash: assigning it would fire hashchange, remount the
// page and wipe whatever is in the search box.
// ---------------------------------------------------------------------------

import {
  allSpecies, speciesByFamily, localNames, getSpecies, primaryName,
  triviaFor, zonesFor, zonesByWater,
} from '../data/index.js';
import { GEAR, GEAR_GROUPS, gearByGroup, getGear } from '../data/gear.js';
import { speciesArt, icon } from '../art.js';
import { speciesDetailHtml, mountSheetPhoto } from '../species-ui.js';
import { suggestSpecies } from '../search.js';
import { identifyPanelHtml, mountIdentifyPanel } from './identify.js';
import { zoneSheetHtml, zonePalette, mountZoneSheet } from '../zone-ui.js';
import { habitatTactics } from '../data/tactics.js';
import { esc, openSheet } from '../ui.js';

// Each tab gets its own art and palette. A shared palette made the three read
// as one grey smear at 30px, which is exactly the size where an icon has
// to work hardest.
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

// Photo is a MODE, not a tab. It sits beside the search box rather than in
// the segmented control because it answers the same question the search box
// does — which fish is this — just from a picture instead of a name. Putting
// it in the row of reference categories would have implied it was a fourth
// body of content to browse, which it isn't.
//
// It still travels in the hash as `tab=photo`, so it can be linked to and so
// the old /identify route has somewhere to redirect.
const PHOTO = 'photo';
const isTab = (v) => v === PHOTO || TABS.some((t) => t.id === v);

// ---------------------------------------------------------------------------
// Fishes
// ---------------------------------------------------------------------------

function speciesCard(s) {
  // Local name leads. Someone here knows "maya-maya"; "mangrove red snapper"
  // is the name in the book. The English and the Latin stay, smaller, because
  // they are what you need to look it up — just not what you need to know it.
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

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Trivia (tips, filed by category)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

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
        <p class="eyebrow">${esc(ctx.region.name)} &middot; ${species.length} fish &middot; ${GEAR.length} gear &middot; ${zones.length} zones</p>
        <h1 class="display">Info</h1>
        <p class="subtitle">Everything worth knowing before you go: what swims here, what to bring, and where to stand.</p>

        <div class="card card--tight" style="gap:12px">
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

          <div class="search-row">
            <input type="search" id="infoSearch" placeholder="Search fishes, gear and waters…"
                   aria-label="Search information" autocomplete="off">
            <button class="search-row__cam" id="infoPhoto" aria-pressed="${tab === PHOTO}"
                    aria-label="Identify a fish from a photo" title="Identify from a photo">
              ${icon('camera', { size: 26, palette: 'slate' })}
            </button>
          </div>

          <!-- Folders on a phone, chips on a desktop. Same state, same click
               handler, one shown at a time by a media query — the folder
               metaphor is a phone answer, and a wide window has room to show
               every subcategory at once, which is what chips are for. -->
          <div class="folders" id="infoFolders"></div>

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
 * The subcategories of a tab, as folders.
 *
 * Fishes are filed by family, gear by the group it already declares, and
 * waters by the body of water they sit in — all three already exist in the
 * data, so this names them rather than inventing a taxonomy.
 */
function foldersFor(tab, ctx, species, zones) {
  if (tab === 'gear') {
    const counts = new Map();
    for (const g of GEAR) counts.set(g.group, (counts.get(g.group) || 0) + 1);
    return GEAR_GROUPS
      .filter((g) => counts.get(g.id))
      .map((g) => ({ key: g.id, label: g.name, count: counts.get(g.id) }));
  }

  if (tab === 'zones') {
    const counts = new Map();
    for (const z of zones) counts.set(z.water, (counts.get(z.water) || 0) + 1);
    return [...counts.entries()].map(([water, count]) => ({ key: water, label: water, count }));
  }

  return speciesByFamily(ctx.regionId).map((g) => ({
    key: g.family,
    label: g.familyCommon || g.family,
    count: g.species.length,
  }));
}

function foldersHtml(items, active, allCount) {
  return (
    `<button class="folder${active ? '' : ' is-open'}" data-folder="" aria-pressed="${!active}">
       <span class="folder__k">All</span>
       <span class="folder__n">${allCount}</span>
     </button>` +
    items
      .map(
        (f) => `
      <button class="folder${f.key === active ? ' is-open' : ''}" data-folder="${esc(f.key)}"
              aria-pressed="${f.key === active}">
        <span class="folder__k">${esc(f.label)}</span>
        <span class="folder__n">${f.count}</span>
      </button>`
      )
      .join('')
  );
}

export function mount(root, ctx) {
  const species = allSpecies(ctx.regionId);
  const zones = zonesFor(ctx.regionId);

  const results = root.querySelector('#infoResults');
  const search = root.querySelector('#infoSearch');
  const tabBar = root.querySelector('#infoTabs');
  const filterBar = root.querySelector('#familyFilters');

  const folderBar = root.querySelector('#infoFolders');

  let tab = isTab(ctx.params.get('tab')) ? ctx.params.get('tab') : 'fishes';
  let query = '';
  // One open folder PER TAB, not one shared. Switching to Gear and back should
  // return you to the family you were reading, not to everything.
  const open = { fishes: ctx.params.get('family') || '', gear: '', zones: '' };

  if (open.fishes) {
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b.dataset.family === open.fishes));
    }
  }

  const photoBtn = root.querySelector('#infoPhoto');
  // Leaving photo mode has to revoke the blob URL of whatever was shot, and
  // mode changes use replaceState, so no hashchange comes to do it for us.
  let releasePhoto = null;
  // Where the camera returns you to. Photo is a detour, not a destination.
  let lastTab = tab === PHOTO ? 'fishes' : tab;

  const openSpecies = (s) => openSheet(s.common, () => speciesDetailHtml(s, ctx.regionId), mountSheetPhoto(s));

  /** Keep the hash honest without remounting the page. */
  function syncHash() {
    const params = new URLSearchParams();
    params.set('tab', tab);
    if (tab === 'fishes' && open.fishes) params.set('family', open.fishes);
    const next = `#/info?${params}`;
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  /** How many results the other two tabs hold, so a search never dead-ends. */
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

  function drawFishes() {
    const shown = species.filter((s) => (!open.fishes || s.family === open.fishes) && matchesSpecies(s, query));
    const trivia = triviaFor(ctx.regionId, 'fishes').filter((t) => matchesTip(t, query));

    if (!shown.length) {
      // Local names get spelled by ear, so an empty result is usually a
      // near-miss rather than a species we don't have.
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

    // Group the visible set by family so headings reflect the filter.
    const groups = new Map();
    for (const s of shown) {
      const key = s.family || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    results.innerHTML =
      elsewhereHtml() +
      [...groups.entries()]
        .map(
          ([fam, items]) => `
          <div class="section-head" style="margin-top:8px">
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
    const shown = GEAR.filter((g) => (!open.gear || g.group === open.gear) && matchesGear(g, query));
    const trivia = triviaFor(ctx.regionId, 'gear').filter((t) => matchesTip(t, query));

    if (!shown.length) {
      results.innerHTML =
        emptyHtml(`No gear matches &ldquo;${esc(search.value.trim())}&rdquo;.`) + triviaHtml(trivia);
      return;
    }

    results.innerHTML =
      elsewhereHtml() +
      gearByGroup(shown)
        .map(
          (g) => `
          <div class="section-head" style="margin-top:8px">
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
    const shown = zones.filter((z) => (!open.zones || z.water === open.zones) && matchesZone(z, query));
    const trivia = triviaFor(ctx.regionId, 'zones').filter((t) => matchesTip(t, query));

    if (!shown.length) {
      results.innerHTML =
        emptyHtml(`No waters match &ldquo;${esc(search.value.trim())}&rdquo;.`) + triviaHtml(trivia);
      return;
    }

    // Grouped by body of water. Leyte is not surrounded by one sea, and a flat
    // list of twenty spots reads as noise — the headings restore the shape of
    // the place. Filtered zones keep their groups, so searching narrows within
    // each water rather than collapsing them together.
    const visible = new Set(shown.map((z) => z.id));
    const groups = zonesByWater(ctx.regionId)
      .map((g) => ({ ...g, zones: g.zones.filter((z) => visible.has(z.id)) }))
      .filter((g) => g.zones.length);

    results.innerHTML =
      elsewhereHtml() +
      groups
        .map(
          (g) => `
          <div class="section-head" style="margin-top:8px">
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

  function draw() {
    const photo = tab === PHOTO;

    // The family chips filter fishes, so they go while the camera is up. The
    // SEARCH BOX STAYS. Hiding it left the camera as an orphaned lozenge in an
    // empty row, and worse, took away the obvious way out — typing a name is
    // how you leave photo mode, which only works if the box is still there.
    filterBar.hidden = photo || tab !== 'fishes';

    // Rebuilt rather than pre-rendered: the folders belong to the tab, and
    // every tab has a different set of them.
    if (folderBar) {
      folderBar.hidden = photo;
      if (!photo) {
        const items = foldersFor(tab, ctx, species, zones);
        const all = tab === 'gear' ? GEAR.length : tab === 'zones' ? zones.length : species.length;
        folderBar.innerHTML = foldersHtml(items, open[tab] || '', all);
      }
    }
    for (const b of tabBar.querySelectorAll('[data-tab]')) {
      b.setAttribute('aria-selected', String(!photo && b.dataset.tab === tab));
    }
    if (photoBtn) photoBtn.setAttribute('aria-pressed', String(photo));
    results.setAttribute('aria-labelledby', photo ? 'infoPhoto' : `infotab-${tab}`);

    // Whatever was photographed is gone the moment we render over it.
    if (!photo && releasePhoto) {
      releasePhoto();
      releasePhoto = null;
    }

    if (photo) drawPhoto();
    else if (tab === 'gear') drawGear();
    else if (tab === 'zones') drawZones();
    else drawFishes();

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
    syncHash();
    draw();
  });

  // A toggle, not a one-way door: pressing it again puts you back where you
  // were rather than dumping you on the default tab.
  photoBtn?.addEventListener('click', () => {
    clearTimeout(typing);
    tab = tab === PHOTO ? lastTab : PHOTO;
    syncHash();
    draw();
  });

  // Redrawing on every keystroke means a typist outruns the render and the
  // characters visibly queue. One frame's grace is below the threshold where
  // a pause reads as lag, and it collapses a whole typed word into one draw.
  let typing = 0;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      query = norm(search.value.trim());
      // Typing is a request to browse, which photo mode can't answer — so it
      // hands you back to the tab you came from rather than swallowing it.
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
    open.fishes = btn.dataset.family;
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    syncHash();
    draw();
  });

  // Pressing the open folder again closes it, which is the only way back to
  // "all" without hunting for a separate reset.
  folderBar?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    const key = btn.dataset.folder;
    open[tab] = open[tab] === key ? '' : key;
    if (tab === 'fishes') {
      for (const b of filterBar.querySelectorAll('[data-family]')) {
        b.setAttribute('aria-pressed', String(b.dataset.family === open.fishes));
      }
    }
    syncHash();
    draw();
  });

  draw();

  // Deep links. #/info?open=<id> is what the map's zone sheets link to, and
  // the old #/species?open=<id> redirects onto it, so it has to keep working.
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
