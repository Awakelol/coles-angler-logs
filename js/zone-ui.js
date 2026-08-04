// ---------------------------------------------------------------------------
// SHARED ZONE UI
//
// A zone is described in two places now — as a pin on the map, and as a card
// in Info › Zones — so the markup lives here rather than in either page. Same
// arrangement as weather-ui.js.
// ---------------------------------------------------------------------------

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
  // The last two unused palettes, so two new water types cost no art.
  strait: 'sunset',
  deep: 'slate',
};

export const zonePalette = (zone) => ZONE_PALETTE[zone.type] || 'ocean';

/** A fish in a bordered pill, used as the map marker.
 *
 * Through the façade, so the pin follows the art mode like everything else.
 * It called renderSprite directly and stayed pixel while the rest of the app
 * went modern — a row of retro fish on a modern map, which is the one place
 * you cannot miss them. */
export function zoneMarkerHtml(zone) {
  const fish = icon('fish', { size: 34, palette: zonePalette(zone) });
  return `<div class="zone-pin" title="${esc(zone.name)}">${fish}</div>`;
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
 * Wire a zone write-up so its species open in place instead of navigating.
 *
 * Reading a zone and reading a fish in it is one task, and it used to cost the
 * whole screen: "Species detail" was a link to #/info?open=<id>, which threw
 * away the map, the zone and your place in the list to show a card that fits
 * in the sheet already open. Getting back meant the Map tab, the pin, and
 * scrolling to where you were.
 *
 * A second sheet on top would have been the obvious fix and is a trap —
 * openSheet stores the scroll position and locks the body, so closing the
 * inner one restores the wrong offset and unlocks the page behind the outer
 * one. This swaps the contents of the sheet that is already open instead.
 *
 * Works unchanged in all three places a zone is shown: the phone sheet, the
 * desktop sidebar panel, and Info › Zones.
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
  // The sheet scrolls on .sheet, not on the body div it contains.
  const scroller = body.closest('.sheet') || body;

  // The sheet can walk from zone to fish to another zone, so which zone we are
  // "in" is not fixed for its lifetime — it is what Back returns you to.
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
    // Back first, so it's under your thumb before the card you have to scroll.
    // It names the zone rather than saying "Back": by the time you have read
    // a fish, which of twenty-one waters you came from is not obvious.
    show(
      `<button class="btn btn--sm" data-back-to-zone style="margin-bottom:14px">
         &larr; ${esc(current.name)}
       </button>` + speciesDetailHtml(s, regionId),
      s.common
    );
    body.querySelector('[data-back-to-zone]').addEventListener('click', () => showZone());

    // "Possible in these waters" lists the other zones this fish turns up in,
    // as links to Info › Zones. That is right from Info, and from here it is
    // the same redirect we just removed one level up — you would tap a fish on
    // the map and be thrown off the map by the card that opened. Inside a zone
    // sheet they move the sheet instead. Only for zones of this region: a link
    // to anywhere else still has to navigate.
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
