// Species guide — searchable, filterable, grouped by family.

import {
  allSpecies, speciesByFamily, fishbaseUrl, localNames, getSpecies, zonesForSpecies,
} from '../data/index.js';
import { speciesSprite, speciesHero, icon } from '../pixel.js';
import { hydratePhotos, fetchPhoto, fetchPhotos } from '../api/photos.js';
import { esc, el, openSheet } from '../ui.js';

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

function detailHtml(s, regionId) {
  const locals = localNames(s);
  const zones = zonesForSpecies(regionId, s.id);
  const size = s.size
    ? `${s.size.typicalCm ? `~${s.size.typicalCm} cm typical` : ''}${
        s.size.typicalCm && s.size.maxCm ? ' · ' : ''
      }${s.size.maxCm ? `${s.size.maxCm} cm max` : ''}`
    : '—';

  return `
    <div class="species-card__art species-card__art--hero">${speciesHero(s, { size: 300 })}</div>

    <div class="chips" style="margin-bottom:14px">
      <span class="chip chip--family">${esc(s.familyCommon || s.family)}</span>
      ${s.target ? '<span class="chip chip--target">Common target</span>' : ''}
    </div>

    <dl class="meta-list" style="margin-bottom:16px">
      <div><dt>Scientific</dt><dd><em>${esc(s.scientific)}</em></dd></div>
      <div><dt>Family</dt><dd>${esc(s.family)}</dd></div>
      ${
        locals.length
          ? `<div><dt>Local</dt><dd>${locals
              .map((l) => `${esc(l.name)} <span style="color:var(--ink-30)">(${esc(l.label)})</span>`)
              .join(', ')}</dd></div>`
          : ''
      }
      <div><dt>Size</dt><dd>${esc(size)}</dd></div>
      ${s.habitat ? `<div><dt>Habitat</dt><dd>${esc(s.habitat)}</dd></div>` : ''}
    </dl>

    ${s.notes ? `<p class="card__body" style="margin-bottom:16px">${esc(s.notes)}</p>` : ''}

    ${
      zones.length
        ? `<h3 class="card__title" style="font-size:15px;margin-bottom:8px">Possible in these waters</h3>
           <div class="chips" style="margin-bottom:16px">
             ${zones.map((z) => `<a class="chip chip--family" href="#/map">${esc(z.name)}</a>`).join('')}
           </div>`
        : ''
    }

    <section data-gallery hidden style="margin-bottom:18px">
      <h3 class="card__title" style="font-size:15px;margin-bottom:8px">In the flesh</h3>
      <div class="gallery" data-gallery-grid></div>
      <p class="field__hint" style="margin-top:8px">
        Photos from Wikimedia Commons, freely licensed. Tap one for the source and full credit.
      </p>
    </section>

    <div class="btn-row">
      <a class="btn btn--primary" href="${esc(fishbaseUrl(s))}" target="_blank" rel="noopener noreferrer">
        FishBase reference &nearr;
      </a>
      <a class="btn btn--sm" href="#/log?species=${esc(s.id)}">Log a catch</a>
    </div>
    <p class="field__hint" style="margin-top:10px">
      FishBase opens in a new tab for photos and full biology. Photos aren't embedded here — they're copyrighted by their contributors.
    </p>`;
}

/**
 * Fills the sheet's photo gallery once it's in the DOM.
 *
 * Sits below the written information rather than under the hero art: the
 * pixel sprite establishes what the app thinks the fish is, the facts explain
 * it, and the photos are the reference you check afterwards.
 */
function mountSheetPhoto(s) {
  return async (rootEl) => {
    const section = rootEl.querySelector('[data-gallery]');
    const grid = rootEl.querySelector('[data-gallery-grid]');
    if (!section || !grid) return;

    let photos = await fetchPhotos(s.scientific, 4);

    // Commons search can come back empty for less-documented species; the
    // Wikipedia summary image is a reliable single fallback.
    if (!photos.length) {
      const one = await fetchPhoto(s.scientific);
      if (one) photos = [one];
    }
    if (!photos.length || !section.isConnected) return;

    grid.innerHTML = photos
      .map(
        (p) => `
        <a class="gallery__item" href="${esc(p.page)}" target="_blank" rel="noopener noreferrer"
           title="${esc(p.title || s.common)} — ${esc(p.credit)}">
          <img src="${esc(p.src)}" alt="Photograph of ${esc(s.common)}" loading="lazy" decoding="async">
          <span>${esc(p.credit)}</span>
        </a>`
      )
      .join('');
    section.hidden = false;
  };
}

export function render(ctx) {
  const total = allSpecies(ctx.regionId).length;
  const groups = speciesByFamily(ctx.regionId);

  return `
    <section class="band band--yellow">
      <div class="wrap">
        <p class="eyebrow">${esc(ctx.region.name)} &middot; ${total} species</p>
        <h1 class="display">Species guide</h1>
        <p class="subtitle">${esc(ctx.region.blurb || '')}</p>

        <div class="card card--tight" style="gap:12px">
          <input type="search" id="speciesSearch" placeholder="Search name, local name or family…"
                 aria-label="Search species" autocomplete="off">
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
        <div id="speciesResults"></div>
      </div>
    </section>`;
}

export function mount(root, ctx) {
  const list = allSpecies(ctx.regionId);
  const results = root.querySelector('#speciesResults');
  const search = root.querySelector('#speciesSearch');
  const filterBar = root.querySelector('#familyFilters');

  let query = '';
  let family = ctx.params.get('family') || '';

  if (family) {
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b.dataset.family === family));
    }
  }

  function matches(s) {
    if (family && s.family !== family) return false;
    if (!query) return true;
    const haystack = [
      s.common,
      s.scientific,
      s.family,
      s.familyCommon,
      ...localNames(s).map((l) => l.name),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function draw() {
    const shown = list.filter(matches);

    if (!shown.length) {
      results.innerHTML = `
        <div class="empty">
          ${icon('book', { size: 96, palette: 'slate' })}
          <p>No species match that search.</p>
          <button class="btn btn--sm" data-clear>Clear filters</button>
        </div>`;
      results.querySelector('[data-clear]').addEventListener('click', () => {
        query = '';
        family = '';
        search.value = '';
        for (const b of filterBar.querySelectorAll('[data-family]')) {
          b.setAttribute('aria-pressed', String(!b.dataset.family));
        }
        draw();
      });
      return;
    }

    // Group the visible set by family so headings reflect the filter.
    const groups = new Map();
    for (const s of shown) {
      const key = s.family || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    results.innerHTML = [...groups.entries()]
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
      .join('');

    for (const btn of results.querySelectorAll('[data-species]')) {
      btn.addEventListener('click', () => {
        const s = getSpecies(btn.dataset.species);
        if (s) openSheet(s.common, () => detailHtml(s, ctx.regionId), mountSheetPhoto(s));
      });
    }

    hydratePhotos(results);
  }

  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    draw();
  });

  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-family]');
    if (!btn) return;
    family = btn.dataset.family;
    for (const b of filterBar.querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    draw();
  });

  draw();

  // Deep link: #/species?open=<id>
  const open = ctx.params.get('open');
  if (open) {
    const s = getSpecies(open);
    if (s) openSheet(s.common, () => detailHtml(s, ctx.regionId), mountSheetPhoto(s));
  }
}
