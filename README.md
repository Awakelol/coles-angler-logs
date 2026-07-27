# Cole's Angler Log

A personal fishing companion PWA — species guide, fishing map, tide & weather
dashboard, and a catch log with personal records. Seeded with **Leyte Gulf,
Philippines**, but built region-agnostic from the start: adding a new body of
water is adding a data file, not rewriting code.

No build step, no framework, no npm. Plain ES modules, IndexedDB and SVG.

---

## Running it

It must be served over HTTP — ES modules and service workers don't work from
`file://`.

```bash
cd webapp
python -m http.server 8777
```

Then open <http://127.0.0.1:8777>.

### Installing to your phone

1. Serve it over **HTTPS** (see *Deploying* — service workers need it, except on `localhost`).
2. Open the URL in Chrome (Android) or Safari (iOS).
3. Android: menu → *Install app*. iOS: Share → *Add to Home Screen*.

It then launches fullscreen, keeps working offline, and your catch log lives on
the device.

---

## API keys — what you need and where it goes

| Feature | Provider | Key needed? | Status |
|---|---|---|---|
| Weather (current + 5-day) | Open-Meteo | **No** | Works immediately |
| Weather (alternative) | OpenWeather | Yes | Optional |
| Tides | WorldTides *or* Stormglass | **Yes** | Needs setup |
| Map tiles | OpenStreetMap | **No** | Works immediately |

**Weather and the map work out of the box.** I deliberately defaulted to
Open-Meteo rather than OpenWeather so the dashboard is live the moment you open
it. Only tides need you to sign up.

### Getting a tide key

There is no genuinely free global tide API — all of them want a key. Pick one:

**WorldTides** (recommended — the more generous free tier)
1. Go to <https://www.worldtides.info>
2. Register, then open **Account → API key**
3. Free tier ≈ 100 requests/month

**Stormglass** (alternative)
1. Go to <https://stormglass.io>
2. Register, then open **Dashboard → API key**
3. Free tier ≈ 10 requests/day

### Where to paste it

**Easiest — in the app:** open **Settings** (gear icon, top right) → *Tides* →
choose your provider → paste the key → *Save*. It's stored in your browser's
`localStorage` and never leaves the device except to call that provider.

**Or in code** — edit [`js/config.js`](js/config.js):

```js
tides: {
  provider: 'worldtides',        // 'worldtides' | 'stormglass' | 'none'
  worldTidesKey: 'PASTE_KEY_HERE',
  stormglassKey: '',
},
```

Keys entered in Settings override `config.js`.

> Tide responses are cached for 6 hours, because predictions are astronomical
> and barely move within a day. That keeps normal use well inside the free
> tiers. If you commit this repo publicly, put your key in Settings rather than
> `config.js` so it doesn't end up in git history.

### Optional: OpenWeather instead of Open-Meteo

Only if you specifically prefer it. Get a free key at
<https://openweathermap.org/api> → *API keys*, then set it in Settings →
*Weather*. **New keys take about 10 minutes to activate** — a fresh key
returning 401 usually just means "wait".

---

## Extending it

Everything below is data. None of it requires touching app logic.

### How species and places relate

These are deliberately separate:

- **`js/data/species/indo-pacific.js`** — a flat catalogue of fish. Region-independent.
- **`js/data/regions/*.js`** — places. Each lists the species **ids** that are
  *possible* there, and each map zone lists its own ids.

Nothing is exclusive. Great barracuda is listed in Cancabato Bay, the Guiuan
reefs *and* the Homonhon channel — one catalogue entry, referenced three times.
Adding a second region never means copying species data.

### Add a species

Append it to [`js/data/species/indo-pacific.js`](js/data/species/indo-pacific.js):

```js
{
  id: 'lutjanus-gibbus',              // unique, kebab-case
  common: 'Humpback red snapper',
  scientific: 'Lutjanus gibbus',      // drives the FishBase link automatically
  family: 'Lutjanidae',
  familyCommon: 'Snapper',
  local: { war: ['maya-maya'], ceb: ['maya-maya'] },
  habitat: 'Coral reefs and lagoons.',
  size: { typicalCm: 35, maxCm: 50 },
  target: true,
  sprite: 'perch',                    // key from SPRITES in js/pixel.js
  palette: 'crimson',                 // key from PALETTES in js/pixel.js
  notes: 'Anything worth remembering.',
}
```

Only `id`, `common` and `scientific` are required — the UI degrades gracefully
without the rest. FishBase links are built from the scientific name, so there's
no URL to maintain.

Then list its `id` under the regions and zones where it's a possible catch. A
species in the catalogue that no region references simply won't appear anywhere;
`python tools/browser_test.py` checks for dangling and orphaned ids.

### Add a fishing zone (map pin)

In the same file, add to the `zones` array:

```js
{
  id: 'z-my-spot',
  name: 'My spot',
  type: 'reef',                 // key from HABITAT_TACTICS in js/data/tactics.js
  coords: { lat: 11.0, lon: 125.5 },
  minZoom: 11,                  // pin appears at this zoom and closer
  depth: '3–15 m',
  blurb: 'What makes this spot worth fishing.',
  species: ['lutjanus-fulviflamma', 'caranx-ignobilis'],   // species ids
  best: 'Run-out tide, early morning',
}
```

`minZoom` is what makes the map reveal detail as you zoom in — broad offshore
grounds use a low value, small creeks a high one.

### Add a whole new region

1. Copy `js/data/regions/leyte-gulf.js` → `js/data/regions/your-region.js`
2. Edit `id`, `name`, `coords`, `map`, `spots`, `zones`, `tips`, and list the
   species ids that occur there — reusing catalogue entries freely; add new
   species to the catalogue only if they aren't there yet
3. Register it in [`js/data/index.js`](js/data/index.js):

```js
import yourRegion from './regions/your-region.js';
export const REGIONS = [leyteGulf, yourRegion];
```

That's it. The region picker appears in the header automatically once there's
more than one, and weather, tides, the map and the catch log all follow the
selection.

### Add tips

General tips (shown in every region) live in
[`js/data/tips.js`](js/data/tips.js). Region-specific tips go in that region's
`tips` array. `tags` drive the filter chips.

### Add lure / retrieve advice

[`js/data/tactics.js`](js/data/tactics.js) keys advice by **family** (how the
fish feeds) and **habitat** (how you have to present to it), so ~27 species are
covered by a dozen entries. A species can override its family default with its
own `tactics: { lures, retrieve }` block.

### Add or edit pixel art

Sprites are character grids in [`js/pixel.js`](js/pixel.js), but **don't
hand-edit the fish** — bodies are drawn in
[`tools/author_sprites.py`](tools/author_sprites.py) and their forked tails are
generated:

```bash
python tools/author_sprites.py     # writes tools/sprite-preview.png + sprites.generated.js
```

Check the preview PNG, then paste `sprites.generated.js` into `SPRITES`.
Regenerate the app icons after changing the art:

```bash
python tools/make_icons.py
```

---

## Testing

```bash
python -m http.server 8777          # terminal 1
python tools/browser_test.py        # terminal 2
```

Drives real headless Chrome over the DevTools Protocol — 35 checks covering the
IndexedDB round-trip, sprite/palette integrity, the species-to-zone data model
(dangling ids, orphaned ids, cross-zone sharing), all seven routes, the
catch-log flow and stats maths, the species search, and the map's zoom-reveal
and z-order. Screenshots land in `_screenshots/`.

> It uses CDP rather than Chrome's simpler `--dump-dom`, because
> `--virtual-time-budget` starves IndexedDB callbacks and makes every
> database-backed page look empty.

---

## Deploying

It's a static site — no server code. Any static host works:

- **Netlify / Vercel / Cloudflare Pages** — drag the folder in, or point it at a
  git repo. Zero config.
- **GitHub Pages** — push, then Settings → Pages → deploy from branch.

All three give you HTTPS, which the service worker requires.

**After deploying an update:** bump `CACHE_VERSION` in [`sw.js`](sw.js).
Otherwise returning visitors keep the cached old version.

---

## How it's built

```
index.html            app shell, tab bar
css/style.css         all styling
js/
  app.js              hash router, region switching
  config.js           API keys + provider settings
  store.js            IndexedDB (catches) + localStorage (prefs) + stats
  pixel.js            sprite grids, palettes, SVG renderer
  ui.js               esc/format/toast/modal-sheet helpers
  api/weather.js      Open-Meteo + OpenWeather, one normalised shape
  api/tides.js        WorldTides + Stormglass, 6-hour cache
  data/
    index.js          catalogue + region registry  <- register new regions here
    tips.js           general tips
    tactics.js        lure + retrieve advice by family and habitat
    species/          the fish themselves, region-independent
    regions/          places; reference species by id
  pages/              home, species, map, conditions, log, tips, settings
vendor/leaflet/       Leaflet 1.9.4, vendored so there's no CDN dependency
tools/                sprite authoring, icon generation, browser tests
```

**Storage.** Catches go in IndexedDB, not `localStorage` — photos are stored as
Blobs, and `localStorage` is strings-only with a ~5 MB cap that one phone photo
would eat. Photos are downscaled to 1280px on save.

**Your data is local to the device.** There's no account and no server. Clearing
site data or uninstalling the PWA deletes your log — use **Settings → Export
JSON** to back up. Export omits photos, since JSON can't carry image data.

---

## Data sources

Species data was assembled from:

- **[Demersal stock assessment in Leyte Gulf](https://palawanscientist.org/tps/article/view/112)**
  (The Palawan Scientist) — a 2020 bottom-trawl survey across 19 stations that
  recorded 230 species from 74 families. Catch composition was **39.45%
  Leiognathidae, 8.05% Lutjanidae, 7.07% Gerreidae**, with *Photopectoralis
  bindus* alone making up 25.49%. This is the basis for how the catalogue is
  weighted.
- **[BFAR Region VIII](https://region8.bfar.da.gov.ph/)** — the
  [regional fisheries profile](https://region8.bfar.da.gov.ph/fisheries-profile/)
  and [Provincial Fishery Office – Leyte](https://region8.bfar.da.gov.ph/provincial-fishery-office-leyte/)
  pages. Note these are office/production/commodity pages rather than species
  lists, and the site currently serves an **incomplete TLS certificate chain**,
  so automated tools may refuse it — open it in a browser.
- **[FishBase](https://www.fishbase.se/)** — scientific names, families,
  habitat and size ranges. Every species card links to its FishBase page.

Two caveats worth stating plainly:

- **The trawl survey under-samples inshore habitat by design.** It sampled open
  gulf bottom, so estuary, mangrove, seagrass and harbour species (barracuda,
  barramundi, tarpon, mullet, scat, grunter) are included here on habitat
  grounds rather than because they appear in that survey's catch composition.
- **No public species list exists for Cancabato Bay specifically.** Its zone
  list is built from the bay's known habitat — roughly 54 ha of seagrass plus
  wharf structure — not from a published inventory. Correct it from experience.

## Notes and caveats

- **Local names should be checked locally.** Waray and Cebuano fish names vary
  town to town across Leyte and Samar. Treat the `local` fields as a starting
  point and correct them against what fishers around you actually say.
- **No photos are embedded.** Every species card links out to its FishBase page
  instead, because FishBase photos are copyrighted by their contributors.
- **Species data** follows BFAR Region VIII survey emphasis — Leiognathidae,
  Lutjanidae and Gerreidae dominate, alongside the small pelagics that drive
  municipal landings.
- **Tide state ("Rising / Falling", "moving fast")** is interpolated between the
  surrounding high and low, which is good enough to plan around but is not a
  substitute for an official tide table for navigation.
