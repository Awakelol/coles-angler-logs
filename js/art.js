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

import { icon as pixelIcon, ICONS as PIXEL_ICONS } from './pixel.js';
import { modernIcon, modernBrandMark, MODERN_ICON_NAMES } from './art/modern.js';
import { isRetro } from './art-mode.js';

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

/** Names present in each set — the test that keeps them in step reads this. */
export const ICON_NAMES = {
  pixel: Object.keys(PIXEL_ICONS),
  modern: MODERN_ICON_NAMES,
};
