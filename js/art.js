// ---------------------------------------------------------------------------
// ART FAÇADE
//
// One place the rest of the app asks for a picture, so which SET it gets is a
// decision made here rather than in eleven modules. Before this, every page
// imported `icon` straight from pixel.js, which made "use the pixel set" a
// fact spread across the codebase instead of a setting.
//
// Species art is NOT dispatched here yet — `speciesHero` and `speciesSprite`
// are re-exported unchanged. Photographs replace them in their own step, and
// the retro toggle will pick up the sprites for free when it does, because
// the call sites will already be pointing at this file.
// ---------------------------------------------------------------------------

import { icon as pixelIcon, ICONS as PIXEL_ICONS, speciesHero } from './pixel.js';
import { modernIcon, modernBrandMark, MODERN_ICON_NAMES } from './art/modern.js';
import { photoFor } from './data/species-photos.js';
import { isRetro } from './art-mode.js';
import { esc } from './ui.js';

// Re-exported so a call site needs one import, not two.
export {
  PALETTES, SPRITES, HEROES, renderSprite, speciesSprite, speciesHero,
  hasHero, usesPlaceholderArt,
} from './pixel.js';

/**
 * An icon in whichever set is in force.
 *
 * Falls back to the pixel set rather than rendering nothing if a name is
 * missing from the modern one — an icon that silently disappears is worse
 * than one that looks out of place, because only the second gets noticed.
 * A test asserts the sets match, so the fallback should stay unreachable.
 */
export function icon(name, opts = {}) {
  if (isRetro()) return pixelIcon(name, opts);
  return modernIcon(name, opts) || pixelIcon(name, opts);
}

/** The mark in the top bar. Pixel hook, or the drawn one. */
export function brandMark({ size = 40 } = {}) {
  if (isRetro()) return pixelIcon('hook', { size, palette: 'sunset' });
  return modernBrandMark({ size });
}

/**
 * The picture of a fish, for a card or a sheet.
 *
 * Modern mode shows a real photograph, because a photograph is what you hold
 * a fish up against. Retro shows the sprite that used to be the only option.
 *
 * A species with no licensed photo gets a plainly-labelled gap, NOT a stand-in
 * fish. A borrowed silhouette on a card that otherwise carries photographs
 * would read as "this is what it looks like", and being confidently wrong
 * about which fish you are holding is the one failure this app must not have.
 */
export function speciesArt(s, { size = 170, hero = false } = {}) {
  if (isRetro()) return speciesHero(s, { size });

  const photo = photoFor(s.id);
  if (!photo) {
    return `
      <div class="species-photo species-photo--none" style="--art-size:${size}px"
           role="img" aria-label="No photograph available for ${esc(s.common)}">
        ${modernIcon('camera', { size: Math.round(size * 0.34), palette: 'slate' })}
        <span>Photo not yet available</span>
      </div>`;
  }
  return `
    <img class="species-photo${hero ? ' species-photo--hero' : ''}"
         src="${esc(photo.file)}" alt="Photograph of ${esc(s.common)}"
         loading="lazy" decoding="async">`;
}

/** True when the species has a photo — callers that need to know, ask. */
export function hasSpeciesPhoto(s) {
  return Boolean(photoFor(s.id));
}

/**
 * The credit line the licence requires. CC BY and CC BY-SA both oblige us to
 * name the photographer, so this is not optional decoration — the card that
 * shows the photo shows this.
 */
export function speciesPhotoCredit(s) {
  const photo = photoFor(s.id);
  if (!photo) return '';
  return `
    <p class="photo-credit">
      <a href="${esc(photo.source)}" target="_blank" rel="noopener noreferrer">${esc(photo.credit)}</a>
      &middot; ${esc(photo.licence)}
    </p>`;
}

/** Names present in each set — the test that keeps them in step reads this. */
export const ICON_NAMES = {
  pixel: Object.keys(PIXEL_ICONS),
  modern: MODERN_ICON_NAMES,
};
