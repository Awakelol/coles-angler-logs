// Art facade: pages get icons and species pictures from here, and this
// decides between the modern set and the pixel set.

import { icon as pixelIcon, ICONS as PIXEL_ICONS, speciesHero } from './pixel.js';
import { modernIcon, modernBrandMark, MODERN_ICON_NAMES } from './art/modern.js';
import { photoFor } from './data/species-photos.js';
import { isRetro } from './art-mode.js';
import { esc } from './ui.js';

// Re-exported so callers only need this module.
export {
  PALETTES, SPRITES, HEROES, renderSprite, speciesSprite, speciesHero,
  hasHero, usesPlaceholderArt,
} from './pixel.js';

/** An icon from the active set. Falls back to pixel if modern lacks the name. */
export function icon(name, opts = {}) {
  if (isRetro()) return pixelIcon(name, opts);
  return modernIcon(name, opts) || pixelIcon(name, opts);
}

/** Top bar logo. */
export function brandMark({ size = 40 } = {}) {
  if (isRetro()) return pixelIcon('hook', { size, palette: 'sunset' });
  return modernBrandMark({ size });
}

/**
 * Species picture: a photo in modern mode, the sprite in retro mode.
 *
 * Species without a licensed photo get an explicit "no photo" placeholder
 * rather than a lookalike fish, which could be misleading for ID.
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


export function hasSpeciesPhoto(s) {
  return Boolean(photoFor(s.id));
}

/** Attribution line (required by CC BY / BY-SA). */
export function speciesPhotoCredit(s) {
  const photo = photoFor(s.id);
  if (!photo) return '';
  return `
    <p class="photo-credit">
      <a href="${esc(photo.source)}" target="_blank" rel="noopener noreferrer">${esc(photo.credit)}</a>
      &middot; ${esc(photo.licence)}
    </p>`;
}

/** Used by the test that checks both sets have the same icons. */
export const ICON_NAMES = {
  pixel: Object.keys(PIXEL_ICONS),
  modern: MODERN_ICON_NAMES,
};
