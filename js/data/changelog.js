// ---------------------------------------------------------------------------
// VERSION HISTORY
//
// One entry per released commit, newest first. Shown at the foot of Settings
// so you can tell from the phone in your hand which build it is running —
// which matters on a PWA, where a stale service worker can leave a device a
// week behind the site without saying so.
//
// NUMBERING. Semver, read as: MAJOR when the shape of the app changes for the
// person using it, MINOR for a new capability, PATCH for a fix or a polish
// pass. Dates are the commit dates.
//
// 1.0.0 is the first build that did everything a fishing companion has to do
// on its own — log, map, species, conditions — rather than the first commit.
// Everything before it is 0.x, which is what those builds honestly were: the
// app could not yet keep a catch log behind an account or identify anything.
//
// TO RELEASE: add an entry at the top, set APP_VERSION below to match, and
// bump CACHE_VERSION in sw.js. All three by hand, on purpose — a version that
// changes itself tells you nothing about whether anyone meant it to.
// ---------------------------------------------------------------------------

export const APP_VERSION = '2.0.0';

export const CHANGELOG = [
  {
    version: '2.0.0',
    date: '2026-08-03',
    title: 'A new look, and a secret',
    changes: [
      'Modern weather icons and a redrawn app mark, on the same colours as before.',
      'The pixel art is not gone. It is hidden — find it and it stays until you turn it off.',
      'Nothing else moved: same palette, same layout, same type.',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-08-02',
    title: 'Deeper zoom and satellite imagery',
    changes: [
      'Satellite imagery, switchable from the map. Free, no account needed.',
      'The map zooms in four steps further — close enough to see a reef edge.',
      'Place names stay on top of the imagery, so it can still be navigated.',
      'Fixed satellite going blank at the deepest zoom, where the imagery runs out.',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-08-02',
    title: 'The weather drawer, and map filters',
    changes: [
      'On a phone the weather is now a drawer — pull it down for a bigger map.',
      'Where you left the drawer is remembered.',
      'Zones and Spots filter buttons over the map, on phone and desktop.',
      'The locate button now stays clear of the drawer instead of hiding behind it.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-08-02',
    title: 'Your own spots',
    changes: [
      'Long-press the map (right-click on a desktop) to drop and name a spot.',
      'Tapping a spot shows which water it is off, and offers directions.',
      'Directions open Apple Maps on Apple devices, Google Maps everywhere else.',
      'Spots belong to your account, so a shared phone keeps them separate.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-02',
    title: 'Photo mode, and fish that open where you are',
    changes: [
      'The camera moved to Info, beside the search box, as a photo mode.',
      "A zone's fish now open inside the zone instead of throwing away the map.",
      'The map has room to breathe on its right and top edges.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-01',
    title: 'The map knows where it is',
    changes: [
      'The map is fenced to the Philippines and can no longer be lost at sea.',
      'A location from abroad falls back to Leyte rather than forecasting elsewhere.',
      "Tapping a zone swings the weather panel onto that zone's water.",
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-30',
    title: 'The whole island',
    changes: [
      'Expanded from Leyte Gulf to all seven waters around Leyte.',
      '21 fishing zones, grouped by the water they belong to.',
      '68 species, up from 40, every addition sourced.',
      'Searching Info is no longer slow — sprites draw with a fraction of the work.',
      'Fixed an empty map when zoomed all the way out.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-30',
    title: 'Identify a fish from a photo',
    changes: [
      'Photograph a fish and get a name, checked against what actually swims here.',
      'Local FishBase names added, with BFAR names keeping priority.',
      'Runs free: recognition is proxied so no key ever reaches the phone.',
      'An optional second opinion improves it without being required for it.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-07-29',
    title: 'Accounts, cloud sync, and one Info page',
    changes: [
      'Species and Tips became one Info page, with Gear alongside them.',
      'Username accounts sync to the cloud, and can be linked to Google.',
      'The map became a single screen with the weather on it.',
      'Swipeable weather deck, real place names, zone detail in the sidebar.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-07-29',
    title: 'Signing in, and the feel of the thing',
    changes: [
      'A proper sign-in screen, a separate sign-up page, and username moderation.',
      'Pages cross-fade; sheets animate and can be dragged closed.',
      'Fixed sign-in dropping back to the login screen.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-07-28',
    title: 'Accounts and media',
    changes: [
      'Local username and password profiles, with the catch log behind them.',
      'Attach photos or short clips to a catch.',
      'Google sign-in.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-07-27',
    title: 'Dark mode and better search',
    changes: [
      'Dark mode, with a light / dark / system setting.',
      '"Did you mean?" for species names spelled by ear.',
      'Photo galleries on species, hero art on the home screen.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-07-27',
    title: 'Knowing where you are',
    changes: [
      'Conditions follow your device location.',
      'The map asks on open and falls back to the whole of Leyte if refused.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-27',
    title: 'Updates that actually arrive',
    changes: [
      'Updates reach an already-open app instead of waiting for a restart.',
      'Fixed a stale service worker hiding code updates entirely.',
      'Cache headers for Netlify, Cloudflare Pages and Vercel.',
      'Stopped a destructive test page from being reachable on the live site.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-27',
    title: 'The art',
    changes: [
      'Angled hero art for species, and hero art on the species cards.',
      'A pixel weather icon set mapped from WMO codes.',
      'Real reference photos, freely licensed, on species pages.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-27',
    title: 'First build',
    changes: [
      'Species guide, fishing map, tide and weather dashboard, catch log.',
      'Works offline and installs to the home screen.',
    ],
  },
];
