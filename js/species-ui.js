// Species detail card. Shared by Info › Fishes and the zone sheet on the map.

import { fishbaseUrl, localNames, zonesForSpecies, primaryName } from './data/index.js';
import { speciesArt, speciesPhotoCredit } from './art.js';
import { fetchPhoto, fetchPhotos } from './api/photos.js';
import { esc } from './ui.js';

export function speciesDetailHtml(s, regionId) {
  const locals = localNames(s);
  const zones = zonesForSpecies(regionId, s.id);
  const size = s.size
    ? `${s.size.typicalCm ? `~${s.size.typicalCm} cm typical` : ''}${
        s.size.typicalCm && s.size.maxCm ? ' · ' : ''
      }${s.size.maxCm ? `${s.size.maxCm} cm max` : ''}`
    : '—';

  const lead = primaryName(s);

  return `
    <div class="species-card__art species-card__art--hero">${speciesArt(s, { size: 300, hero: true })}</div>
    ${speciesPhotoCredit(s)}

    <div class="species-detail__names">
      <h2 class="species-detail__lead">${esc(lead.text)}</h2>
      ${lead.kind === 'local' ? `<p class="species-detail__common">${esc(s.common)}</p>` : ''}
    </div>

    <div class="chips" style="margin-bottom:14px">
      ${lead.kind === 'local' ? `<span class="chip chip--lang">${esc(lead.local.label)}</span>` : ''}
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
             ${zones
               .map((z) => `<a class="chip chip--family" href="#/info?tab=zones&zone=${esc(z.id)}">${esc(z.name)}</a>`)
               .join('')}
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
      FishBase opens in a new tab with more photos and the full biology.
    </p>`;
}

/** Fill the sheet's photo gallery once it's in the DOM. */
export function mountSheetPhoto(s) {
  return async (rootEl) => {
    const section = rootEl.querySelector('[data-gallery]');
    const grid = rootEl.querySelector('[data-gallery-grid]');
    if (!section || !grid) return;

    let photos = await fetchPhotos(s.scientific, 4);

    // Fall back to the Wikipedia summary image if Commons has nothing.
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
