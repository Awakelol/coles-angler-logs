// Zone markup, shared by the map pins and Info › Zones.

import { resolveSpecies, getSpecies, zonesFor } from './data/index.js';
import { tacticsFor, lureSummary, habitatTactics } from './data/tactics.js';
import { speciesArt, icon } from './art.js';
import { speciesDetailHtml, mountSheetPhoto } from './species-ui.js';
import { esc } from './ui.js';

export const ZONE_PALETTE = {
  mangrove: 'emerald',
  estuary: 'emerald',
  flats: 'gold',
  reef: 'crimson',
  channel: 'ocean',
  bay: 'ocean',
  shallows: 'silver',
  offshore: 'violet',
  strait: 'sunset',
  deep: 'slate',
};

export const zonePalette = (zone) => ZONE_PALETTE[zone.type] || 'ocean';

/** Map marker for a zone. */
export function zoneMarkerHtml(zone) {
  const fish = icon('fish', { size: 34, palette: zonePalette(zone) });
  return `<div class="zone-pin" title="${esc(zone.name)}">${fish}</div>`;
}

/** Zone write-up: habitat, possible catches, tactics, what to bring. */
export function zoneSheetHtml(zone) {
  const list = resolveSpecies(zone.species);
  const habitat = habitatTactics(zone.type);
  const lures = lureSummary(list);

  return `
    <p class="card__sub" style="margin-bottom:4px">
      ${esc(habitat?.label || zone.type)} &middot; ${esc(zone.depth || 'depth unknown')}
    </p>
    <p class="card__body" style="margin-bottom:14px">${esc(zone.blurb || '')}</p>

    ${
      zone.best
        ? `<div class="chips" style="margin-bottom:16px">
             <span class="chip chip--target">Best: ${esc(zone.best)}</span>
           </div>`
        : ''
    }

    ${
      habitat
        ? `<div class="notice" style="margin-bottom:18px">
             <h3>Fishing this water</h3>
             <p style="margin:0">${esc(habitat.advice)}</p>
           </div>`
        : ''
    }

    <h3 class="card__title" style="margin-bottom:10px">Possible catches in these waters (${list.length})</h3>
    <div class="grid grid--2" style="margin-bottom:18px">
      ${list
        .map((s) => {
          const t = tacticsFor(s);
          return `
          <div class="card card--tight">
            <div class="species-card__art" style="min-height:70px">${speciesArt(s, { size: 110 })}</div>
            <h4 class="card__title" style="font-size:15px">${esc(s.common)}</h4>
            <p class="card__sub species-card__sci">${esc(s.scientific)}</p>
            ${
              s.local?.war?.[0]
                ? `<div class="chips"><span class="chip chip--local">${esc(s.local.war[0])}</span></div>`
                : ''
            }
            <details>
              <summary style="cursor:pointer;font-weight:800;font-size:13px">Lures &amp; retrieve</summary>
              <div class="chips" style="margin:8px 0">
                ${(t.lures || []).map((l) => `<span class="chip chip--tag">${esc(l)}</span>`).join('')}
              </div>
              <p class="card__body" style="font-size:13px">${esc(t.retrieve)}</p>
            </details>
            <button class="btn btn--sm" data-species-detail="${esc(s.id)}">Species detail</button>
          </div>`;
        })
        .join('')}
    </div>

    <h3 class="card__title" style="margin-bottom:10px">Bring these</h3>
    <div class="chips" style="margin-bottom:18px">
      ${lures.map((l) => `<span class="chip chip--family">${esc(l)}</span>`).join('')}
    </div>

    <a class="btn btn--primary btn--block" href="#/log">Log a catch here</a>`;
}

/**
 * Wire up a zone write-up so tapping a species (or another zone) swaps the
 * contents of the same sheet instead of navigating away. Stacking a second
 * sheet would break openSheet's scroll lock.
 *
 * Used by the phone sheet, the desktop sidebar panel and Info › Zones.
 *
 * @param {Element}  root the sheet backdrop or the sidebar panel
 * @param {object}   zone the zone to open on
 * @param {string}   regionId for "possible in these waters" on the species card
 * @param {object}  [opts]
 * @param {Function} [opts.onZone] called when the sheet moves to another zone,
 *        so the map can swing its weather panel across with it
 */
export function mountZoneSheet(root, zone, regionId, { onZone } = {}) {
  const body = root.querySelector('[data-sheet-body], [data-zone-body]') || root;
  const heading = root.querySelector('.sheet__head h2, .zone-panel__head h2');
  // The scroll container is .sheet, not the body div.
  const scroller = body.closest('.sheet') || body;

  // The zone that Back returns to; changes as the user moves between zones.
  let current = zone;

  const show = (html, title) => {
    body.innerHTML = html;
    if (heading && title) heading.textContent = title;
    scroller.scrollTop = 0;
  };

  const showZone = (z = current) => {
    if (z !== current) {
      current = z;
      onZone?.(z);
    }
    show(zoneSheetHtml(current), current.name);
    for (const btn of body.querySelectorAll('[data-species-detail]')) {
      btn.addEventListener('click', () => showSpecies(btn.dataset.speciesDetail));
    }
  };

  const showSpecies = (id) => {
    const s = getSpecies(id);
    if (!s) return;
    // Back button labelled with the zone name.
    show(
      `<button class="btn btn--sm" data-back-to-zone style="margin-bottom:14px">
         &larr; ${esc(current.name)}
       </button>` + speciesDetailHtml(s, regionId),
      s.common
    );
    body.querySelector('[data-back-to-zone]').addEventListener('click', () => showZone());

    // Zone links on the species card move this sheet instead of navigating.
    for (const a of body.querySelectorAll('a[href*="tab=zones&zone="]')) {
      const id2 = new URLSearchParams(a.getAttribute('href').split('?')[1]).get('zone');
      const z = zonesFor(regionId).find((x) => x.id === id2);
      if (!z) continue;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        showZone(z);
      });
    }

    mountSheetPhoto(s)(body);
  };

  showZone();
}
