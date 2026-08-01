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
  allSpecies, speciesByFamily, localNames, getSpecies,
  triviaFor, zonesFor, zonesByWater,
} from '../data/index.js';
import { GEAR, gearByGroup, getGear } from '../data/gear.js';
import { speciesHero, renderSprite, icon, SPRITES } from '../pixel.js';
import { hydratePhotos } from '../api/photos.js';
import { speciesDetailHtml, mountSheetPhoto } from '../species-ui.js';
import { suggestSpecies } from '../search.js';
import { zoneSheetHtml, zonePalette, mountZoneSheet } from '../zone-ui.js';
import { habitatTactics } from '../data/tactics.js';
import { esc, openSheet } from '../ui.js';

// Each tab gets its own art and palette. A shared palette made the three read
// as one grey smear at 30px, which is exactly the size where a pixel icon has
// to work hardest.
const TABS = [
  { id: 'fishes', label: 'Fishes', art: () => renderSprite(SPRITES.perch, 'ocean', { size: 30 }) },
  { id: 'gear', label: 'Gear', art: () => icon('rod', { size: 30, palette: 'sunset' }) },
  { id: 'zones', label: 'Zones', art: () => icon('wave', { size: 30, palette: 'emerald' }) },
];

const isTab = (v) => TABS.some((t) => t.id === v);

// ---------------------------------------------------------------------------
// Fishes
// ---------------------------------------------------------------------------

function speciesCard(s) {
  const locals = localNames(s).slice(0, 2);
  return `
    <button class="card species-card" data-species="${esc(s.id)}">
      <div class="species-card__art">${speciesHero(s, { size: 170 })}</div>
      <div>
        <h3 class="card__title">${esc(s.common)}</h3>
        <p class="card__sub species-card__sci">${esc(s.scientific)}</p>
      </div>
      <div class="chips">
        ${locals.map((l) => `<span class="chip chip--local">${esc(l.name)}</span>`).join('')}
        ${s.target ? '<span class="chip chip--target">Target</span>' : ''}
      </div>
      <figure class="photo" data-photo="${esc(s.scientific)}" hidden>
        <img alt="" loading="lazy" decoding="async">
        <figcaption></figcaption>
      </figure>
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
      <div class="zone-card__art">${renderSprite(SPRITES.perch, zonePalette(z), { size: 130 })}</div>
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
          <div class="segmented" id="infoTabs" role="tablist" aria-label="Information category">
            ${TABS.map(
              (t) => `
              <button class="segmented__btn" role="tab" data-tab="${esc(t.id)}"
                      aria-selected="${t.id === tab}" id="infotab-${esc(t.id)}">
                <span class="segmented__icon">${t.art()}</span>
                <span>${esc(t.label)}</span>
              </button>`
            ).join('')}
          </div>

          <input type="search" id="infoSearch" placeholder="Search fishes, gear and waters…"
                 aria-label="Search information" autocomplete="off">

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

export function mount(root, ctx) {
  const species = allSpecies(ctx.regionId);
  const zones = zonesFor(ctx.regionId);

  const results = root.querySelector('#infoResults');
  const search = root.querySelector('#infoSearch');
  const tabBar = root.querySelector('#infoTabs');
  const filterBar = root.querySelector('#familyFilters');

  let tab = isTab(ctx.params.get('tab')) ? ctx.params.get('tab') : 'fishes';
  let query = '';
  let family = ctx.params.get('family') || '';

  if (family) {
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b.dataset.family === family));
    }
  }

  const openSpecies = (s) => openSheet(s.common, () => speciesDetailHtml(s, ctx.regionId), mountSheetPhoto(s));

  /** Keep the hash honest without remounting the page. */
  function syncHash() {
    const params = new URLSearchParams();
    params.set('tab', tab);
    if (tab === 'fishes' && family) params.set('family', family);
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

  function drawFishes() {
    const shown = species.filter((s) => (!family || s.family === family) && matchesSpecies(s, query));
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
                       <div class="species-card__art">${speciesHero(g.species, { size: 140 })}</div>
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

    hydratePhotos(results);
  }

  function drawGear() {
    const shown = GEAR.filter((g) => matchesGear(g, query));
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
    const shown = zones.filter((z) => matchesZone(z, query));
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
    filterBar.hidden = tab !== 'fishes';
    for (const b of tabBar.querySelectorAll('[data-tab]')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    results.setAttribute('aria-labelledby', `infotab-${tab}`);

    if (tab === 'gear') drawGear();
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
        family = '';
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
    tab = btn.dataset.tab;
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
      draw();
    }, 120);
  });

  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-family]');
    if (!btn) return;
    family = btn.dataset.family;
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b === btn));
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
