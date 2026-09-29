# Cole's Angler Log

A fishing companion PWA: species guide, fishing map, tide and weather
dashboard, and a catch log with personal records. It ships with data for
**Leyte, Philippines** (111 species, 21 zones across the waters around the
island), but regions are just data files, so adding another area doesn't need
code changes.

No build step, no framework, no npm. Plain ES modules, IndexedDB and SVG.

## Running it

ES modules and service workers don't work from `file://`, so serve it:

```bash
python -m http.server 8777
```

Then open <http://127.0.0.1:8777>.

To install it on a phone, serve it over HTTPS (see [Deploying](#deploying)),
open it in Chrome or Safari and use *Install app* / *Add to Home Screen*. It
runs fullscreen, works offline, and the catch log is stored on the device.

## API keys

| Feature | Provider | Key? |
|---|---|---|
| Weather | Open-Meteo (default) | no |
| Weather (alternative) | OpenWeather | yes |
| Tides | WorldTides or Stormglass | yes |
| Map tiles | OpenStreetMap, Esri World Imagery | no |
| Photo ID | Fishial (+ optional Gemini / Claude) | yes, server-side |

Weather and the map work straight away. Tides need a key from one of:

- **WorldTides** (<https://www.worldtides.info>, Account → API key), ~100
  requests/month free
- **Stormglass** (<https://stormglass.io>, Dashboard → API key), ~10
  requests/day free

Paste it in the app under **Settings → Tides** (saved in `localStorage` on that
device), or copy `js/config.local.example.js` to `js/config.local.js`
(gitignored) and put it there. Don't put keys in `js/config.js`; it's
committed. Tide responses are cached for 6 hours, which keeps normal use well
inside the free tiers.

OpenWeather is optional: get a key at <https://openweathermap.org/api> and set
it in Settings → Weather. New keys can take ~10 minutes to start working.

## Photo identification

The camera button next to the search box on the Info screen identifies a fish
from a photo. It shows a live viewfinder but sends a single still, so a photo
taken offline can be identified later. If the camera isn't available (no
HTTPS, no permission, no camera) you can still upload a photo.

How it works:

1. The photo goes to `/api/identify`, a Cloudflare Worker in `worker/`, so the
   API keys never reach the browser.
2. [Fishial](https://portal.fishial.ai) returns a ranked list of species.
3. The ranking is checked against the local catalogue
   (`js/identify-verdict.js`). Fishial is mostly trained on North American and
   European fish, so a top answer that doesn't occur around Leyte gets
   demoted in favour of a local candidate further down the list, or a local
   relative from the same genus.
4. Optionally, a vision model (Gemini, or Claude if no Gemini key is set) gets
   the photo and the catalogue, and its answer is reconciled with Fishial's.
   If it fails or is rate-limited the Fishial + catalogue answer is used.

The result says which path produced it.

### Worker secrets

Cloudflare dashboard → your Worker → **Settings → Variables and Secrets**. Add
them as secrets, then redeploy.

| Name | Required | Notes |
|---|---|---|
| `FISHIAL_API_KEY` | yes | portal.fishial.ai → developers |
| `FISHIAL_API_SECRET` | yes | same page |
| `GEMINI_API_KEY` | no | has a free tier, checked first |
| `GEMINI_MODEL` | no | defaults to `gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | no | paid per call, used if there's no Gemini key |

If Cloudflare says *"Variables cannot be added to a Worker that only has static
assets"*, the Worker was deployed without `main`; check that `wrangler.jsonc`
went up with it.

`python -m http.server` doesn't run the Worker, so identification will just
report a failure locally. To test it for real:

```sh
npm install -g wrangler
wrangler dev
```

with the keys in a gitignored `.dev.vars` file:

```
FISHIAL_API_KEY=...
FISHIAL_API_SECRET=...
GEMINI_API_KEY=...
```

## Accounts and sync

Accounts are optional. Without one you can use the app in guest mode and the
log stays on the device (use **Settings → Export JSON** to back it up or move
it; photos aren't included in the export).

With Firebase set up, an account syncs the catch log between devices. Sign-in
is either:

- **Username + password**: a normal Firebase Email/Password account whose
  email and password are derived from what you type (`js/auth/credentials.js`).
  The email is `<username>@angler.invalid` and the password sent to Firebase is
  a PBKDF2 hash, so your real password never leaves the device.
- **Google**.

Both give a Firebase uid and the log is stored by uid, so linking Google to a
username account keeps the same log. Accounts are also mirrored locally so you
can sign in offline; an account created offline gets connected to Firebase the
next time you sign in with a connection.

Catch records sync to `users/{uid}/catches/{catchId}`. Photos and videos stay
on the device that took them (Firestore documents cap at 1 MiB and Cloud
Storage needs billing). Deletes sync as tombstones. Profiles (display name,
avatar) and map spots are device-only for now.

### Firebase setup

1. Create a project at <https://console.firebase.google.com> (no billing
   needed).
2. Project settings → Your apps → Web → register, and copy the config into
   `js/config.js` or `js/config.local.js`. The `apiKey` is a public identifier,
   not a secret.
3. Authentication → Sign-in method: enable **Email/Password** (required) and
   **Google** (optional).
4. Authentication → Settings → Authorised domains: add your domain.
5. Authentication → Settings → User account linking: *Link accounts that use
   the same email address*.
6. Firestore Database → Create database (production mode), then set the rules
   and publish:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/catches/{catchId} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

Until the rules are published, sync fails with `permission-denied` and Settings
says cloud storage isn't set up.

Facebook sign-in is implemented but turned off (`CONFIG.auth.facebook`), since
Meta requires business verification for the login permissions.

## Extending it

### Species

Species live in [`js/data/species/indo-pacific.js`](js/data/species/indo-pacific.js),
independent of any region:

```js
{
  id: 'lutjanus-gibbus',              // unique, kebab-case
  common: 'Humpback red snapper',
  scientific: 'Lutjanus gibbus',      // also used to build the FishBase link
  family: 'Lutjanidae',
  familyCommon: 'Snapper',
  local: { war: ['maya-maya'], ceb: ['maya-maya'] },
  habitat: 'Coral reefs and lagoons.',
  size: { typicalCm: 35, maxCm: 50 },
  target: true,
  sprite: 'perch',                    // SPRITES key in js/pixel.js
  palette: 'crimson',                 // PALETTES key in js/pixel.js
  notes: 'Anything worth remembering.',
}
```

Only `id`, `common` and `scientific` are required. Then add the id to the
region's `species` list and to the zones where it occurs. The test suite flags
ids that are referenced but missing, or defined but never used.

Local names: `war` is Waray, `ceb` Cebuano, `tl` Tagalog. Names from BFAR
Region VIII come first, then FishBase's; cards show the first two.

### Zones (map pins)

Zones are in the region file (`js/data/regions/leyte.js`):

```js
{
  id: 'z-my-spot',
  name: 'My spot',
  water: 'Sogod Bay',           // groups zones under a heading
  type: 'reef',                 // HABITAT_TACTICS key in js/data/tactics.js
  coords: { lat: 11.0, lon: 125.5 },
  minZoom: 11,                  // pin shows at this zoom and closer
  depth: '3–15 m',
  blurb: 'What makes this spot worth fishing.',
  species: ['lutjanus-fulviflamma', 'caranx-ignobilis'],
  best: 'Run-out tide, early morning',
}
```

Use a low `minZoom` for broad offshore grounds and a high one for small spots.
Tapping a pin also switches the weather panel to that zone. Keep zones at
least 2.5 km apart or the pins overlap (there's a test for it).

### A new region

1. Copy `js/data/regions/leyte.js` to `js/data/regions/<name>.js`.
2. Edit `id`, `name`, `coords`, `map`, `spots`, `zones`, `tips` and the
   `species` list (reusing catalogue entries where possible).
3. Register it in [`js/data/index.js`](js/data/index.js):

   ```js
   import yourRegion from './regions/your-region.js';
   export const REGIONS = [leyte, yourRegion];
   ```

The region picker appears once there's more than one region.

A few region fields worth knowing about:

- `coords` is where weather and tides point when there's no usable location.
  It's also the tide cache key, so use a port rather than open water.
- `map.bounds` is the default map view.
- `map.panBounds` is a larger box (the whole country for Leyte). The map can't
  be panned outside it, and a device location outside it falls back to
  `coords` for weather.

### Tips and tactics

- General tips: [`js/data/tips.js`](js/data/tips.js). Region tips go in the
  region's `tips` array. `category` decides which Info tab they appear under.
- Lure and retrieve advice: [`js/data/tactics.js`](js/data/tactics.js), keyed
  by family and by habitat type. A species can override it with its own
  `tactics: { lures, retrieve }`.

### Pixel art

The default look uses line icons (`js/art/modern.js`). The original pixel art
is still there as a hidden "retro" mode: tap the version number at the bottom
of Settings seven times.

Fish sprites are generated by [`tools/author_sprites.py`](tools/author_sprites.py);
don't edit the grids in `js/pixel.js` by hand:

```bash
python tools/author_sprites.py   # writes tools/sprite-preview.png + sprites.generated.js
python tools/make_icons.py       # regenerate the app icons
```

Species without their own art are marked `art: 'placeholder'` and borrow a
similar fish's sprite. `ART_DEBT_MAX` in the test suite caps how many there
can be (currently 71).

## Species photos

Species photos come from iNaturalist, Wikimedia Commons and GBIF, filtered to
CC0, CC BY, CC BY-SA and public domain. The credit is shown on each card.
[`tools/fish_photos.py`](tools/fish_photos.py) handles the whole process:

```bash
python -m pip install "rembg[cpu]" onnxruntime pillow

python tools/fish_photos.py fetch     # find licensed candidates
python tools/fish_photos.py review    # pick one per species in the browser
python tools/fish_photos.py verify    # check picks (duplicates, licences, IDs)
python tools/fish_photos.py build     # crop around the fish, write the manifest
python tools/fish_photos.py crops     # review the finished crops
python tools/fish_photos.py status
```

`score` and `verify --gemini` optionally use Gemini (put `GEMINI_API_KEY` in
`.dev.vars`). `review` runs on `127.0.0.1:8123` and saves each choice to
`tools/_photo_work/picks.json` as you click.

`build` doesn't edit the photo: it fixes the EXIF rotation, finds the fish
with rembg's u2net model, crops a 4:3 window around it and scales it down. If
the fish is too long to fit, the whole photo is kept and padded with a blurred
copy of itself. Your own photos can go in `tools/_photo_work/manual/` as
`<species-id>.jpg` (with an optional `<species-id>.json` for credit/licence).

`build` also bumps `CACHE_VERSION` in `sw.js`, since images are served
cache-first. Species without a photo show "photo not yet available" rather
than a lookalike.

## Testing

```bash
python -m http.server 8777 --bind 127.0.0.1   # terminal 1
python tools/browser_test.py                  # terminal 2, phone width
python tools/desktop_check.py                 # desktop layout, 1440x900
```

Both drive headless Chrome over the DevTools Protocol (they need the
`websockets` package). They look for Chrome in the usual Windows locations, or
set `CHROME=/path/to/chrome`. Screenshots go to `_screenshots/`, and
`tools/screenshots.py` / `tools/desktop_shots.py` take a tour of each layout.

A handful of checks call the live weather, geocoding and photo APIs and fail
without network access.

## Deploying

It's a static site, so any static host works (Netlify, Vercel, Cloudflare,
GitHub Pages). HTTPS is required for the service worker. Cache headers are in
`_headers` (Netlify/Cloudflare) and `vercel.json`.

Photo ID needs the Cloudflare Worker: `wrangler.jsonc` deploys the whole repo
as static assets with `worker/index.js` handling `/api/*`.

The service worker is network-first for JS/CSS/HTML, so deploys show up on the
next load, and cache-first for images. If you replace an image in place, bump
`CACHE_VERSION` in [`sw.js`](sw.js). The installed app also checks for updates
when it regains focus, and Settings has a "Refresh the app" button.

To release a version: add an entry to `js/data/changelog.js`, update
`APP_VERSION` there, and bump `CACHE_VERSION`.

## Project layout

```
index.html            app shell and navigation
css/style.css         all styles; palette tokens at the top
sw.js                 service worker
js/
  app.js              hash router, region switching, nav
  config.js           provider settings (keys go in config.local.js / Settings)
  store.js            IndexedDB (catches, spots, profiles) + prefs + stats
  sync.js             Firestore sync
  auth.js, auth/      local and Firebase accounts
  art.js, art/, pixel.js   icons: modern set and pixel set
  api/                weather, tides, geolocation, place names, photos
  data/               species catalogue, regions, gear, tips, tactics, changelog
  pages/              home, map, conditions, log, info, identify, account, settings
worker/               Cloudflare Worker for /api/identify
vendor/leaflet/       Leaflet 1.9.4
tools/                tests, screenshots, sprite/icon/photo tools
docs/                 sourcing notes for the Leyte data
```

## Data sources

- [Demersal stock assessment in Leyte Gulf](https://palawanscientist.org/tps/article/view/112)
  (The Palawan Scientist): 2020 trawl survey, 19 stations, 230 species from 74
  families. Catch was 39.45% Leiognathidae, 8.05% Lutjanidae and 7.07%
  Gerreidae (*Photopectoralis bindus* alone 25.49%), which is why those
  families are well represented.
- [FishBase](https://www.fishbase.se/) ecosystem checklists for Leyte Gulf
  (288), Sogod Bay (289), Ormoc Bay (316), San Pedro Bay (337), Carigara Bay
  (338) and the Camotes Sea (765). The species added from these are the ones
  that are commercially or subsistence fished and reach 15 cm. FishBase also
  supplies names, families, habitat and sizes. CC BY-NC 4.0.
- [SeaLifeBase](https://www.sealifebase.se/) for the invertebrates (prawns,
  shrimp, cuttlefish). CC BY-NC 4.0.
- [Stock assessment of small pelagics in the Camotes Sea](https://nsap.nfrdi.da.gov.ph/publications)
  (NFRDI), for *Decapterus kurroides*.
- [BFAR Region VIII](https://region8.bfar.da.gov.ph/) regional fisheries
  profile and provincial pages.
- [Province of Southern Leyte, Marine and Coastal Resources](https://southernleyte.gov.ph/marine-resources),
  matched against SeaLifeBase/FishBase records.
- [`docs/leyte-waters-research.md`](docs/leyte-waters-research.md) has the
  sourcing for each body of water, marked as sourced, to verify, or gap.

Caveats:

- The trawl survey covered open gulf bottom, so estuary, mangrove, seagrass and
  harbour species are included on habitat grounds.
- There's no published species list for Cancabato Bay or Ormoc Bay; those
  zones are based on habitat and should be corrected from local knowledge.
- Local names vary from town to town. The species added after the original 68
  only have FishBase names, none checked locally yet.
- Tide state (rising/falling) is interpolated between highs and lows. Fine for
  planning a trip, not for navigation.
