// ---------------------------------------------------------------------------
// MODERN ICON SET
//
// The default look. Clean flat/line marks of the kind any weather app uses —
// deliberately generic, because an icon for "rain" earns nothing by being
// distinctive. The pixel set is still there and still complete; it moved
// behind the retro toggle (js/art-mode.js).
//
// WHY THESE TAKE A PALETTE. The pixel engine renders a character grid through
// a nine-slot palette, and every call site already passes a palette name —
// `icon('rain', { palette: 'weather' })`. Keeping that signature means the
// swap is a swap and not a rewrite of eleven modules, and it keeps the two
// sets tied to one colour system, so nothing looks imported from another app.
//
// Slots used here, from the nine:
//   p[0] outline   the stroke
//   p[3] body      the main fill
//   p[5] belly     the light fill
//   p[8] accent    the one thing that should catch the eye
//
// Authored on a 24x24 grid with a 2px round stroke. Both are deliberate: 24
// is the size every icon set agrees on, so shapes borrowed from muscle memory
// read correctly, and a round join survives being drawn at 26px on a map pin
// as well as 120px in an empty state.
// ---------------------------------------------------------------------------

import { PALETTES } from '../pixel.js';

/**
 * Each entry is a function of the palette, returning the inside of an SVG.
 * Written as data rather than markup so the palette is applied once, here,
 * instead of every icon repeating the lookup.
 */
const ICONS = {
  // --- weather -------------------------------------------------------------

  sunny: (p) => `
    <circle cx="12" cy="12" r="4.6" fill="${p[8]}"/>
    <g stroke="${p[8]}" stroke-width="2" stroke-linecap="round">
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2"/>
      <path d="M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>
    </g>`,

  // A crescent cut from a disc rather than drawn as a lune: the cut edge stays
  // a true circle at every size, which a hand-drawn curve does not.
  moon: (p) => `
    <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z"
          fill="${p[8]}"/>`,

  cloudy: (p) => `
    <path d="M7.2 18.5h9.9a4.1 4.1 0 0 0 .5-8.2 5.9 5.9 0 0 0-11.2-1.2 3.9 3.9 0 0 0 .8 7.7Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>`,

  partly: (p) => `
    <circle cx="8.4" cy="7.6" r="3.3" fill="${p[8]}"/>
    <g stroke="${p[8]}" stroke-width="1.7" stroke-linecap="round">
      <path d="M8.4 1.6v1.6M2.4 7.6h1.6M4.2 3.4l1.1 1.1M12.6 3.4l-1.1 1.1"/>
    </g>
    <path d="M10.4 19.6h7.8a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-9.9-1 3.5 3.5 0 0 0 .7 6.8Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>`,

  drizzle: (p) => `
    <path d="M7.4 15.4h9.4a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.6-1.1 3.7 3.7 0 0 0 .8 7.3Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>
    <g stroke="${p[3]}" stroke-width="2" stroke-linecap="round">
      <path d="M9.4 18.4v1.6M14.6 18.4v1.6"/>
    </g>`,

  rain: (p) => `
    <path d="M7.4 15.4h9.4a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.6-1.1 3.7 3.7 0 0 0 .8 7.3Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>
    <g stroke="${p[3]}" stroke-width="2" stroke-linecap="round">
      <path d="M8.4 18v2.6M12 18.4v3M15.6 18v2.6"/>
    </g>`,

  // Slanted and longer than `rain` — the difference has to be legible at 28px
  // in the forecast strip, where the two sit side by side.
  showers: (p) => `
    <path d="M7.4 14.6h9.4a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.6-1.1 3.7 3.7 0 0 0 .8 7.3Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>
    <g stroke="${p[3]}" stroke-width="2.1" stroke-linecap="round">
      <path d="M9.2 17.2l-1.4 3.4M13 17.2l-1.4 3.4M16.8 17.2l-1.4 3.4"/>
    </g>`,

  storm: (p) => `
    <path d="M7.4 13.2h9.4a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.6-1.1 3.7 3.7 0 0 0 .8 7.3Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M13.4 14.4 8.8 19.8h3l-1.2 3.4 5-5.6h-3.2Z"
          fill="${p[8]}" stroke="${p[0]}" stroke-width="1.3" stroke-linejoin="round"/>`,

  fog: (p) => `
    <path d="M7.4 13.4h9.4a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.6-1.1 3.7 3.7 0 0 0 .8 7.3Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>
    <g stroke="${p[3]}" stroke-width="2" stroke-linecap="round">
      <path d="M4.6 17h14.8M6.8 20.4h11.2"/>
    </g>`,

  // --- gear ----------------------------------------------------------------

  rod: (p) => `
    <path d="M3.6 20.4 18.6 5.4" stroke="${p[0]}" stroke-width="2" stroke-linecap="round"/>
    <path d="M3 21l3.4-1.6-1.8-1.8L3 21Z" fill="${p[8]}"/>
    <g stroke="${p[3]}" stroke-width="1.6" stroke-linecap="round">
      <path d="M9.6 12.2l1.6 1.6M12.8 9l1.6 1.6M16 5.8l1.6 1.6"/>
    </g>
    <circle cx="19.4" cy="4.6" r="1.9" fill="none" stroke="${p[8]}" stroke-width="1.8"/>`,

  reel: (p) => `
    <circle cx="12" cy="12" r="7.4" fill="${p[5]}" stroke="${p[0]}" stroke-width="1.8"/>
    <circle cx="12" cy="12" r="2.6" fill="${p[8]}"/>
    <path d="M12 4.6v3M12 16.4v3M4.6 12h3M16.4 12h3"
          stroke="${p[3]}" stroke-width="1.7" stroke-linecap="round"/>`,

  spool: (p) => `
    <rect x="8.4" y="7.4" width="7.2" height="9.2" fill="${p[3]}"/>
    <g stroke="${p[5]}" stroke-width="1.1">
      <path d="M8.4 9.4h7.2M8.4 12h7.2M8.4 14.6h7.2"/>
    </g>
    <rect x="4.6" y="4" width="3.8" height="16" rx="1.6"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.7"/>
    <rect x="15.6" y="4" width="3.8" height="16" rx="1.6"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.7"/>
    <path d="M19.4 6.6c1.8.6 2.4 1.6 1.4 2.4" fill="none" stroke="${p[8]}"
          stroke-width="1.6" stroke-linecap="round"/>`,

  lure: (p) => `
    <path d="M13.6 3.6c3.4 2.4 4.8 5.4 4.8 8.4s-1.4 6-4.8 8.4c-3.4-2.4-4.8-5.4-4.8-8.4s1.4-6 4.8-8.4Z"
          fill="${p[3]}" stroke="${p[0]}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="13.6" cy="8.4" r="1.5" fill="${p[8]}"/>
    <path d="M6 15.6c-1.8 0-2.6 1.4-2.6 2.6a2.2 2.2 0 0 0 4.4 0"
          fill="none" stroke="${p[0]}" stroke-width="1.7" stroke-linecap="round"/>`,

  net: (p) => `
    <path d="M3.2 20.8 8.4 15.6" stroke="${p[0]}" stroke-width="2.2" stroke-linecap="round"/>
    <ellipse cx="14" cy="10" rx="6.8" ry="6.8" transform="rotate(-45 14 10)"
             fill="${p[5]}" stroke="${p[0]}" stroke-width="1.8"/>
    <g stroke="${p[3]}" stroke-width="1.2" stroke-linecap="round">
      <path d="M9.4 6.6 17.4 14.6M11.6 4.8 19.2 12.4M7.6 8.8 15.2 16.4"/>
      <path d="M17.4 5.4 9.4 13.4M19.2 7.6 12.4 14.4M15.2 3.6 8.2 10.6"/>
    </g>`,

  box: (p) => `
    <rect x="3.2" y="8" width="17.6" height="11.4" rx="2"
          fill="${p[3]}" stroke="${p[0]}" stroke-width="1.8"/>
    <path d="M3.2 12.6h17.6" stroke="${p[0]}" stroke-width="1.6"/>
    <path d="M8.6 8V6.2a1.8 1.8 0 0 1 1.8-1.8h3.2a1.8 1.8 0 0 1 1.8 1.8V8"
          fill="none" stroke="${p[0]}" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="10.4" y="10.6" width="3.2" height="4" rx="1" fill="${p[8]}"/>`,

  camera: (p) => `
    <rect x="2.6" y="6.6" width="18.8" height="13.2" rx="2.6"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.8"/>
    <path d="M8.6 6.6l1.4-2.4h4l1.4 2.4" fill="none" stroke="${p[0]}"
          stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="12" cy="13.2" r="3.8" fill="${p[3]}" stroke="${p[0]}" stroke-width="1.6"/>
    <circle cx="18.2" cy="9.6" r="1" fill="${p[8]}"/>`,

  wave: (p) => `
    <g fill="none" stroke="${p[3]}" stroke-width="2.1" stroke-linecap="round">
      <path d="M2.4 9.4c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 4.8-2.6 5.2 0"/>
    </g>
    <g fill="none" stroke="${p[8]}" stroke-width="2.1" stroke-linecap="round">
      <path d="M2.4 15.4c2.4-2.6 4.8-2.6 7.2 0s4.8 2.6 7.2 0 4.8-2.6 5.2 0"/>
    </g>`,

  hook: (p) => `
    <path d="M15.4 3.4v8.2a5.2 5.2 0 0 1-10.4 0"
          fill="none" stroke="${p[8]}" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M5 11.6a2 2 0 0 0 3.4 1.4" fill="none" stroke="${p[8]}"
          stroke-width="2.4" stroke-linecap="round"/>
    <path d="M12.6 3.4h5.6" stroke="${p[0]}" stroke-width="2" stroke-linecap="round"/>`,

  trophy: (p) => `
    <path d="M7.6 3.6h8.8v5.2a4.4 4.4 0 0 1-8.8 0Z"
          fill="${p[8]}" stroke="${p[0]}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M7.6 5.2H5.2a2.6 2.6 0 0 0 2.6 4.4M16.4 5.2h2.4a2.6 2.6 0 0 1-2.6 4.4"
          fill="none" stroke="${p[0]}" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M12 13.4v3.6M8.6 20.4h6.8" stroke="${p[0]}" stroke-width="2" stroke-linecap="round"/>
    <rect x="8.6" y="17" width="6.8" height="1.6" fill="${p[3]}"/>`,

  boat: (p) => `
    <path d="M12 3.4 18 12h-6Z" fill="${p[5]}" stroke="${p[0]}"
          stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M10.4 5.6 6 12h4.4Z" fill="${p[8]}" stroke="${p[0]}"
          stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M2.8 14.6h18.4l-2.6 5.2a1.6 1.6 0 0 1-1.4.8H6.8a1.6 1.6 0 0 1-1.4-.8Z"
          fill="${p[3]}" stroke="${p[0]}" stroke-width="1.8" stroke-linejoin="round"/>`,

  // Faces left, like every species photograph and every sprite in the app.
  // A fish icon pointing the other way to the fish beside it is the kind of
  // thing nobody names but everybody feels.
  fish: (p) => `
    <path d="M15.6 12c0 4-3.6 6.6-7 6.6S2 16 2 12s3.2-6.6 6.6-6.6 7 2.6 7 6.6Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M15 8.2 21.6 4.8a.8.8 0 0 1 1.2.8L21.4 12l1.4 6.4a.8.8 0 0 1-1.2.8L15 15.8Z"
          fill="${p[8]}" stroke="${p[0]}" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M9 5.6c1.4-2 3.2-2.6 4.6-2.2-.4 1.6-1.2 2.6-2.4 3.2"
          fill="${p[3]}" stroke="${p[0]}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="6.4" cy="10.6" r="1.25" fill="${p[0]}"/>`,

  book: (p) => `
    <path d="M3.4 5.2A13 13 0 0 1 12 7.4a13 13 0 0 1 8.6-2.2v12.6A13 13 0 0 0 12 20a13 13 0 0 0-8.6-2.2Z"
          fill="${p[5]}" stroke="${p[0]}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12 7.4V20" stroke="${p[0]}" stroke-width="1.7"/>
    <path d="M5.8 9.2a10 10 0 0 1 4 1M14.2 9.2a10 10 0 0 1 4-1"
          fill="none" stroke="${p[3]}" stroke-width="1.5" stroke-linecap="round"/>`,
};

/**
 * The app mark.
 *
 * Still a hook, still gold, because that is what the app has always been —
 * but drawn as one continuous rounded stroke instead of a stair-stepped grid,
 * with the line and the eye at the top reading as a "J" the way the pixel
 * version did. Kept as its own export rather than an ICONS entry: it has a
 * different aspect and is never asked for at icon sizes.
 */
export function modernBrandMark({ size = 40 } = {}) {
  // Reads the palette off the page rather than hardcoding, so the mark follows
  // the theme instead of being the one gold thing left on a blue app.
  const css = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement) : null;
  const gold = css?.getPropertyValue('--blue').trim() || PALETTES.ocean[3];
  const ink = css?.getPropertyValue('--ink').trim() || PALETTES.ocean[0];
  return `
    <svg class="ico brand-mark" viewBox="0 0 40 48" width="${size}"
         height="${Math.round((size * 48) / 40)}"
         xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cole's Angler Log">
      <path d="M27 6v22a11 11 0 0 1-22 0" fill="none" stroke="${gold}"
            stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M5 28a4.4 4.4 0 0 0 7.6 3" fill="none" stroke="${gold}"
            stroke-width="5.4" stroke-linecap="round"/>
      <path d="M20 6h10" stroke="${gold}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="33.6" cy="6" r="4.2" fill="none" stroke="${gold}" stroke-width="3.4"/>
      <circle cx="27" cy="6" r="2.1" fill="${ink}" opacity=".28"/>
    </svg>`;
}

export const MODERN_ICON_NAMES = Object.keys(ICONS);

/** Same call signature as the pixel `icon()`, so no call site changes. */
export function modernIcon(name, { size = 64, palette = 'ocean', className = '' } = {}) {
  const draw = ICONS[name];
  if (!draw) return '';
  const p = PALETTES[palette] || PALETTES.ocean;
  return (
    `<svg class="ico ${className}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${draw(p)}</svg>`
  );
}
