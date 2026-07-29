// ---------------------------------------------------------------------------
// SHARED ZONE UI
//
// A zone is described in two places now — as a pin on the map, and as a card
// in Info › Zones — so the markup lives here rather than in either page. Same
// arrangement as weather-ui.js.
// ---------------------------------------------------------------------------

import { resolveSpecies } from './data/index.js';
import { tacticsFor, lureSummary, habitatTactics } from './data/tactics.js';
import { speciesSprite, renderSprite, SPRITES } from './pixel.js';
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
};

export const zonePalette = (zone) => ZONE_PALETTE[zone.type] || 'ocean';

/** A pixel fish in a bordered pill, used as the map marker. */
export function zoneMarkerHtml(zone) {
  const sprite = renderSprite(SPRITES.perch, zonePalette(zone), { size: 34 });
  return `<div class="zone-pin" title="${esc(zone.name)}">${sprite}</div>`;
}

/** The full zone write-up: habitat, possible catches, tactics, what to bring. */
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
            <div class="species-card__art" style="min-height:70px">${speciesSprite(s, { size: 110 })}</div>
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
            <a class="btn btn--sm" href="#/info?open=${esc(s.id)}">Species detail</a>
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
