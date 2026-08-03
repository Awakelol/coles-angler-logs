# Cole's Angler Log

A personal fishing companion PWA — species guide, fishing map, tide & weather
dashboard, and a catch log with personal records. Seeded with **Leyte,
Philippines** — 68 species across 21 zones in the seven bodies of water that
surround the island — but built region-agnostic from the start: adding a new
body of water is adding a data file, not rewriting code.

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

The map's weather follows what you tap: press a zone pin and the panel above
the map switches to that zone's forecast, with a **&times;** next to the place
name to hand it back to you. Leyte is 150 km end to end, so the conditions
where you're standing can be no guide to the water you were thinking of running
out to. Forecasts are cached for ten minutes in memory, so browsing the zones
doesn't fire a request per tap.

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

## Species identification (photo → name)

**Info → the camera beside the search box** photographs a fish and names it.
Free to run.

It sits there rather than on Home because it answers the same question the
search box does — *which fish is this* — from a picture instead of a name. It is
**not** a fourth tab: that row is the reference categories you browse, and a
mode that takes a photo isn't one of them. The old `#/identify` link still
resolves, redirecting to `#/info?tab=photo`.

### How it works, and why it's free

**Fishial.AI does the looking** — a model trained specifically on fish, free on
its developer tier for non-commercial use.

**Your own catalogue does the checking.** Fishial is trained mostly on North
American and European sportfish, so on an Indo-Pacific fish its top answer can
be confidently wrong. Catching that needs no AI, only a lookup: *does this
species occur in Leyte's waters?* The app already knows — that is what
`js/data/species/indo-pacific.js` is. So the cross-check costs nothing.

| Fishial says | Result |
|---|---|
| A species in your catalogue, ranked first | **local-match** — take it |
| Its #1 isn't found here but its #3 is | **local-demoted** — take the #3, say why |
| Nothing local, but the same genus as a local species | **related** — offer the relative, low confidence |
| Nothing local at all | **not-local** — report it as a lead, not an answer |

Rules live in `js/identify-verdict.js`, free of network calls so they're
directly testable.

### Where the keys go

Cloudflare dashboard → your Worker → **Settings → Variables and Secrets**.
Add as **Secret** (encrypted), then **redeploy** — variables bake in at deploy
time and an existing deployment won't see them.

| Name | From | Required |
|---|---|---|
| `FISHIAL_API_KEY` | <https://portal.fishial.ai> → *About → for developers* | yes |
| `FISHIAL_API_SECRET` | same page | yes |
| `GEMINI_API_KEY` | optional second opinion — see below | no |
| `GEMINI_MODEL` | overrides the default `gemini-2.5-flash` | no |
| `ANTHROPIC_API_KEY` | optional second opinion, metered | no |

> **"Variables cannot be added to a Worker that only has static assets."**
> That error means the Worker has no code for the keys to attach to.
> `wrangler.jsonc` fixes it by declaring `main: "worker/index.js"`. If you hit
> it again, check that file deployed.

> **Never put these in `js/config.js` or `js/config.local.js`** — those ship to
> the browser. `config.local.js` is gitignored, which protects the repo but not
> the deployed site. The WorldTides key lives there because a leaked tide
> lookup is harmless; these are not.

### Optional: a vision model as second opinion

Set one key and a vision model is handed the photo *and* your catalogue, then
arbitrated against Fishial. It adds the one thing the free pair can't do: read
markings, body shape and fin placement to separate lookalikes — the ponyfish
especially.

| Key | Cost | Notes |
|---|---|---|
| `GEMINI_API_KEY` | **Free tier** | Google AI Studio. Checked first. |
| `ANTHROPIC_API_KEY` | ~2–3¢ per call | Used only if no Gemini key is set. |

**One Gemini key can serve several apps.** The key belongs to your Google
project, not to an application, so the same one already powering a Discord bot
works here — they simply share the project's quota. If you'd rather be able to
revoke one without breaking the other, make a second key in the same project;
it's free and takes a minute. Check your actual limits in
[AI Studio](https://aistudio.google.com/rate-limit).

If the model errors, times out, or hits a rate limit, the free path answers
instead — the feature never goes down for want of a second opinion.

The screen always shows which path produced an answer — *"fishial + local
catalogue"*, *"fishial + gemini"* or *"fishial + claude"* — so a free answer is
never mistaken for one with a second opinion behind it.

### Testing it locally

`python -m http.server` doesn't run Workers, so the button will report that it
couldn't identify anything. That's correct, not a bug. For the real path:

```sh
npm install -g wrangler
wrangler dev
```

Put the keys in a gitignored `.dev.vars` file for local runs:

```
FISHIAL_API_KEY=...
FISHIAL_API_SECRET=...
GEMINI_API_KEY=...
```

---

## Accounts and cloud sync

The app runs with no account at all. Everything below is optional, free on
Firebase's Spark plan, and enables one thing: a catch log that follows its
owner between devices.

### How an account works

There are two sign-in methods and one kind of account.

| | What it is |
|---|---|
| **Username & password** | An ordinary Firebase Email/Password account whose address and password are *derived* from what you type — see `js/auth/credentials.js`. The address is synthesised at the reserved `.invalid` domain and receives nothing; the password is a PBKDF2 digest, so your real password never reaches Google and Firebase's 6-character minimum stops being your problem. |
| **Google** | Firebase's Google provider, unchanged. |

Both produce a Firebase uid, and the log is keyed by uid. That is what makes
**linking additive**: connecting Google to a username account keeps the same
uid, so it is a second door into the same room, not a second room.

An account created with no connection is local-only. It is **upgraded in place
on the next sign-in with a connection** — same username, same password, same
catches, no prompt. Nothing is lost and nothing is asked.

### What syncs

Catch **records** — species, date, weight, length, method, bait, notes,
conditions. Stored at `users/{uid}/catches/{catchId}`, one document each.

**Photos and clips do not sync.** They stay on the device that took them, and a
synced catch remembers it had one. Firestore documents cap at 1 MiB and media
belongs in Cloud Storage, which needs a billing account on projects created
recently. The boundary is one function — `stripForCloud` in `js/sync.js` — so
adding media later means writing an uploader, not unpicking the sync.

Deletes propagate as tombstones rather than absences. See the note at the top
of `js/store.js` for why an absence cannot work.

### Setting it up

1. **Firebase project** — <https://console.firebase.google.com>, create one.
   No billing needed.
2. **Web app** — Project settings → *Your apps* → *Web* → register. Copy the
   config object into `js/config.local.js` (gitignored) or `js/config.js`. The
   `apiKey` there is a project identifier, not a secret.
3. **Sign-in methods** — Build → Authentication → *Get started*, then under
   *Sign-in method* enable:
   - **Email/Password** — required for username accounts. Leave *Email link*
     off.
   - **Google** — optional, for the Google button.
4. **Authorised domains** — Authentication → Settings → *Authorised domains* →
   add your live domain. `localhost` is already there.
5. **Account linking** — Authentication → Settings → *User account linking* →
   *Link accounts that use the same email address*.
6. **Firestore** — Build → Firestore Database → *Create database* → start in
   **production mode**, pick a region near you. Then Rules, replace with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // A signed-in person can read and write their own catches, and nothing
       // else exists. Scoping by uid in the path rather than a field means a
       // device cannot even ask for someone else's data.
       match /users/{uid}/catches/{catchId} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   **Publish.** Until you do, sync fails with `permission-denied` and Settings
   says cloud storage isn't set up yet.

### If you skip all of this

The app works. Accounts are local, the log lives in IndexedDB, and Settings
says *This device only*. Use the JSON export to move between phones.

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
  water: 'Sogod Bay',           // groups the zone under a heading in Info
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
grounds use a low value, small creeks a high one. Zoom out past every zone's
`minZoom` and the broadest tier shows anyway, so the map is never blank.

`coords` is also the zone's weather: tapping its pin swings the map's forecast
panel onto that spot. Keep two zones at least 2.5 km apart or their pins
overlap — a test enforces this.

A zone's fish open **inside** the zone's own sheet or sidebar panel, with a
back button naming the water you came from — reading a zone and reading a fish
in it is one task, and it shouldn't cost you the map. The same applies to the
other waters listed on a fish's card: from a zone they move the sheet rather
than navigating to Info. Sheets deliberately do not stack; `openSheet` locks
the body scroll and restores one offset, so a second one over the first
restores the wrong position. `mountZoneSheet` in
[`js/zone-ui.js`](js/zone-ui.js) swaps the contents of the open one instead,
and works unchanged in the phone sheet, the desktop sidebar and Info › Zones.

### The map screen

The map gets the whole screen. On a **phone** the weather is a drawer over the
foot of it: drag the grip down for a bigger map and it leaves the grip and the
place name behind, so there is something to pull back up. Where you left it is
remembered. On a **wide window** it is a sidebar instead — the drawer is a
phone answer to a phone problem, and a wide window has room for both.

The peek height is measured from the real elements rather than hardcoded,
because a long place name wraps the bar and a fixed value would either clip it
or leave a gap. The locate button and the zone hint ride above whatever the
drawer is covering (`--wx-visible`), or the drawer would bury the control you
press to find yourself.

Two filter buttons float over the top of the map on **both** layouts — Zones
and Spots — and are remembered. A **Map / Satellite** switch sits opposite
them, so the top of the map reads left to right as: how close, what is drawn
on it, what it is drawn on.

Esri's imagery over Leyte stops at zoom **18**. Asking for 19 does not 404 —
it returns a real tile reading *"Map data not yet available"*, so the map looks
broken at the last step. `maxNativeZoom: 18` stops the request and upscales
instead. That ceiling was measured, not assumed: the placeholder is
byte-identical wherever it appears, so fetching two tiles at one zoom and
comparing them finds it.

Satellite imagery is **Esri World Imagery**, which is free and needs no key,
unlike Mapbox or Google. It is Esri's service on Esri's terms — fine for
personal use, worth re-reading before anyone makes money from this. A second
Esri layer puts place names back on top: imagery alone has none, and on open
water the names are most of what there is to navigate by. Note Esri addresses
tiles `{z}/{y}/{x}`, row before column — the usual order returns a
plausible-looking map of somewhere else. They are over the map rather than in a row
above it because this screen is one screenful with no page scroll, and a real
row would cost the height the drawer exists to give back.

### Your own spots

Long-press anywhere on the map (right-click on a desktop) to drop a mark, name
it, and get directions to it later. These are **not** `region.spots` — those
ship with a region and are the same for everybody. These belong to one account
and one region, live in their own IndexedDB store, and carry the same
`createdAt` / `updatedAt` / `deleted` shape catches do, so cloud-syncing them
later is a small change rather than a migration. Nothing syncs them yet.

The long press is hand-rolled rather than using Leaflet's `contextmenu`: that
event doesn't fire everywhere on touch, its timing isn't ours to set, and it
can't tell a press from the start of a pan — which is the gesture people
actually make most on a map.

Directions open Apple Maps on Apple devices and Google Maps everywhere else,
both as plain `https://` links so a wrong platform guess degrades to a working
map page rather than a dead scheme URL.

### Where the map may go, and what counts as "here"

`map.bounds` frames the region. `map.panBounds` is a second, much wider box —
the **country** — and does two jobs:

- The map cannot be dragged outside it. Without that you can pan off into empty
  ocean with nothing on screen to say which way back, requesting tiles for
  places the app has nothing to say about.
- It is what counts as being in the area. A fix inside it is used as-is, even
  600 km from the nearest zone — Manila is somewhere this app can sensibly
  answer for. A fix outside it falls back to `coords`, because a five-day
  forecast for another hemisphere next to a map of Leyte helps nobody.

Omit `panBounds` and neither restriction applies.

`coords` is the region's home: where weather and tides point when there's no
usable fix. Make it a **port, not open water** — it is also the tide cache key,
and a named landing is what tide predictions are meaningful for.

### Add a whole new region

1. Copy `js/data/regions/leyte.js` → `js/data/regions/your-region.js`
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
fish feeds) and **habitat** (how you have to present to it), so all 68 species
are covered by a dozen entries. A species can override its family default with its
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

`renderSprite` merges runs of one colour along a row into a single `<rect>`
instead of emitting one per pixel. It cuts a fish from ~430 nodes to ~184,
which is what makes an Info tab of 68 fish quick to search. It is meant to be
invisible, and four tests hold it to that — same painted cells, no overlap, no
two touching rects sharing a fill. If you change the emitter, they will tell
you whether you changed the picture.

### The pixel art backlog

28 of the 68 species have no art of their own. They borrow the silhouette of a
fish roughly their shape and declare it:

```js
art: 'placeholder',
```

That flag is **declared, not inferred**. `hasHero()` returns true for a
borrowed sprite, so anything based on it would have quietly hidden this backlog
exactly as it grew. `usesPlaceholderArt()` reads the flag instead, and
`ART_DEBT_MAX` in the test suite pins the count at 28.

That number may only ever go **down**. Draw real art, clear the flag, lower the
ceiling. Adding a 29th placeholder fails the suite on purpose — the backlog is
allowed to be paid off, never to grow.

To find them:

```bash
grep -n "art: 'placeholder'" js/data/species/indo-pacific.js
```

---

## Testing

```bash
python -m http.server 8777          # terminal 1
python tools/browser_test.py        # terminal 2
```

Drives real headless Chrome over the DevTools Protocol — 448 checks covering
the IndexedDB round-trip, sprite/palette integrity, the species-to-zone data
model (dangling ids, orphaned ids, cross-zone sharing), all seven routes, the
catch-log flow and stats maths, the species search, the map's zoom-reveal and
z-order, and the auth and sync paths. Screenshots land in `_screenshots/`.

Some of those checks are **ratchets** rather than assertions — they pin a
number that is allowed to improve but not to regress, so a shortcut has to be
taken deliberately:

| Ratchet | Now | Rule |
|---|---|---|
| `ART_DEBT_MAX` | 28 placeholder sprites | may only go **down**; draw art and clear the flag |
| rects per hero sprite | 184 | must stay **under 250**, or the Info tab gets heavy again |
| zone pin separation | 2.5 km | no two zones may sit closer |

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

**Updates land automatically.** The service worker is *network-first for code*
(JS/CSS/HTML) and cache-first only for images and fonts, so a deploy shows up on
the next load without any manual step. Offline still works — the cache is the
fallback when the network fails.

Bump `CACHE_VERSION` in [`sw.js`](sw.js) only when you want to force-evict old
**images** (renamed icons, regenerated sprites saved as PNG).

> This used to be cache-first for everything, which meant every JS/CSS edit kept
> serving the stale copy until `CACHE_VERSION` was bumped by hand. It silently
> hid a whole round of sprite work — and headless tests never caught it, because
> each run uses a fresh browser profile with no service worker. If you ever do
> see stale UI, hard-reload (Ctrl+Shift+R) or unregister the worker under
> DevTools → Application → Service Workers.

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
  pages/              home, map, conditions, log, info, identify, settings
  auth/               sign-in, and the PBKDF2 derivation behind username accounts
worker/               Cloudflare Worker — /api/* only; keys live here, not in js/
vendor/leaflet/       Leaflet 1.9.4, vendored so there's no CDN dependency
tools/                sprite authoring, icon generation, browser tests
docs/                 sourcing notes, with every claim marked cited or inferred
```

Species and Tips used to be their own pages; they are now tabs of **Info**.
`/species` and `/tips` still resolve — old bookmarks and cached shells exist —
and redirect to the matching tab.

**Storage.** Catches go in IndexedDB, not `localStorage` — photos are stored as
Blobs, and `localStorage` is strings-only with a ~5 MB cap that one phone photo
would eat. Photos are downscaled to 1280px on save.

**Your data is local to the device.** There's no account and no server. Clearing
site data or uninstalling the PWA deletes your log — use **Settings → Export
JSON** to back up. Export omits photos, since JSON can't carry image data.

---

## Species photographs

`tools/fish_photos.py` sources them. Four stages, each re-runnable and each
skipping work already done, so adding a species later costs only that species:

```bash
python -m pip install "rembg[cpu]" onnxruntime pillow   # once; ~176 MB model on first build

python tools/fish_photos.py fetch     # licensed candidates from iNaturalist + GBIF
python tools/fish_photos.py score     # optional: Gemini rates the doubtful ones
python tools/fish_photos.py review    # contact sheet — you pick one per species
python tools/fish_photos.py verify    # check the picks before committing to them
python tools/fish_photos.py build     # crop centred on the fish → manifest
python tools/fish_photos.py crops     # pass or fail each finished crop
python tools/fish_photos.py status    # what is done, what is missing
```

`verify` runs four checks that need **no key**: every species accounted for;
no photo picked twice (which would mean one card shows the wrong fish); licence
allowed and attribution present where the licence demands it; and an
**identity cross-check** — it asks iNaturalist what each photo's observation is
actually identified as and compares that to the species. That last one catches
a photo taken from the wrong species' page, which no amount of looking would
reveal if the two fish resemble each other.

**Photos ship as they were taken.** No cut-outs, no background removal, no
compositing. `build` downloads the original, fixes its EXIF rotation, finds the
fish, crops the *picture* to 4:3 centred on it, and scales it down. The pixels
are the photographer's throughout — the detector only decides where to cut the
frame, never what to erase from it.

Finding the fish uses `rembg`'s u2net, but only for its mask's bounding box;
the matting is thrown away. **The fish is never cropped.** If a fish is so long
that no 4:3 window can hold it inside the photo, the whole frame ships instead
and the card letterboxes it — 4 of 43 land there. Cutting a tail off to make
the shape work is the one outcome worth avoiding.

Cut-outs were tried first and dropped: they looked consistent in principle and
were not in practice — halos on some, a fin lost to the matting on others, and
an underwater shot with the water removed stops looking like a fish in the sea.

`crops` is the last look, and the only one that can catch a bad crop: the
framing is decided by a saliency model, and a saliency model sometimes locks
onto the diver, a hand, or the brightest rock. Each photo is shown exactly as
the card shows it — same ratio, same fit, same backing — with four controls:

| | |
|---|---|
| **Crop is good** | keep it |
| **Bad crop — use whole photo** | keeps the photo, ships the uncropped frame |
| **Bad photo — replace it** | pulls it; the card says "photo not yet available" |
| **Rotate ↺ / ↻** | straightens a sideways photo, independent of the verdict |

Plus a remarks box. "Bad crop" is the one that earns its keep — most bad crops
are a good photograph framed badly, and re-picking a fine photo to fix a crop
would be wasted work. Rotation is separate from the verdict because a photo can
be good *and* on its side, and it is applied before the detector looks at the
image, since a sideways fish reads as a tall thin subject and gets framed
badly. Species carrying a verdict that changes the file rebuild automatically;
you do not have to remember `--refresh`.

**A photo no API will serve** — or one of your own — goes in
`tools/_photo_work/manual/` as `<species-id>.jpg`, and `build` prefers it over
anything fetched. An optional `<species-id>.json` beside it records
`credit` / `licence` / `source`; without one the card reads *"supplied by hand
— provenance not recorded"*, which is deliberate, because an unattributed
image is worse than an honest gap. Some hosts refuse programmatic downloads
outright (the French museum's media server 403s whatever you send); those
candidates are marked unavailable and greyed out rather than routed around.

`verify --gemini` adds a vision pass over the picks: does it look like the
species, is it one fish, side-on, whole, and what is the setting. Only a
species mismatch is raised as a *problem* — that is the one that makes a card
actively lie. The rest are warnings.

**No API keys for the stages that matter.** iNaturalist, Wikimedia Commons and GBIF are all open.
`score` is the only stage that wants a key and the only optional one; put
`GEMINI_API_KEY=...` in **`.dev.vars`** in the project root — already
gitignored, and the same file wrangler reads for local Worker runs, so the key
has one home rather than one per tool.

`review` serves the contact sheet on `127.0.0.1:8123` and writes every decision
to `picks.json` the moment you make it. Each species takes one of five states:

| | |
|---|---|
| **a chosen photo** | click it — click again to unchoose |
| **No good ones** | ships the honest "photo not yet available" card |
| **Give me more** | `python tools/fish_photos.py more` digs deeper for these |
| **Unsure** | `python tools/fish_photos.py score --unsure` asks Gemini; may still name a favourite |
| **nothing** | undecided, comes back next time |

Every species also has a **remarks** box — free text, saved on a pause, for
anything the verdict can't carry: what's wrong with the candidates, what to
look for instead, a name that needs correcting. Remarks show in `status` and
when `build` runs, and they survive clearing a pick, because changing your mind
about a photo isn't retracting what you said about it.

Thumbnails are **uncropped** (`object-fit: contain`) with the pixel dimensions
and a full-size link under each. Cover-cropping hid exactly the tails and fins
you need to judge a fish by.

Three sources, and they are genuinely different pools: iNaturalist is field
observations with voted identifications, **Wikimedia Commons** is files curated
onto species pages (searched by `Category:<Scientific name>` first, then by
plain search), and GBIF is the backstop. Commons ranks slightly below
research-grade iNaturalist — well organised, but nobody voted on the ID — and
its range maps and cladograms are filtered out by title.

**What it decides and what it doesn't.** Licensing it decides completely: only
CC0, CC BY, CC BY-SA and public domain are ever downloaded, and the credit the licence
requires is carried into the app and shown on the card. Whether a photo is a
clean side-profile of a whole fish out of water, it *cannot* — no API exposes
that. It ranks on the proxies it can read (iNaturalist's "Alive or Dead"
annotation, which is the strongest single signal since a landed fish is laid
out in air; research-grade status; Philippine locality; image proportions) and
scores its own confidence. The last call is yours in `review`, or Gemini's in
`score` for the doubtful ones.

Species with no entry in `js/data/species-photos.js` show **"photo not yet
available"**. That is deliberate and not a bug: a borrowed silhouette on a card
that otherwise carries photographs would read as *this is what it looks like*,
and being confidently wrong about the fish in your hand is the one failure this
app must not have.

---

## Versions

`js/data/changelog.js` holds `APP_VERSION` and one entry per release, shown at
the foot of **Settings**. Semver, read as: MAJOR when the shape of the app
changes for the person using it, MINOR for a new capability, PATCH for a fix.
`1.0.0` is the first build that did everything a fishing companion has to do on
its own rather than the first commit — everything before it is `0.x`, which is
what those builds honestly were.

Settings also reports the **cache name read from the browser**, not printed
from a constant. On a PWA a stale service worker can leave a phone a week
behind the site without saying so, and the two disagreeing is exactly the
situation worth being able to see.

**To release:** add a changelog entry, set `APP_VERSION` to match, bump
`CACHE_VERSION` in `sw.js`. All three by hand, on purpose — a version that
changes itself tells you nothing about whether anyone meant it to. A test
fails if `APP_VERSION` and the newest entry disagree.

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
  habitat and size ranges, and the local-name lists for the species added with
  the island expansion. Every species card links to its FishBase page.
  FishBase data is **CC BY-NC 4.0** — fine for personal use, not for commercial
  use without the FishBase team's agreement.
- **[`docs/leyte-waters-research.md`](docs/leyte-waters-research.md)** — the
  sourcing for the expansion from the gulf to the whole island, water by water.
  Every claim in it is marked **Sourced**, **Verify** or **Gap**, so what is
  cited and what is inference are separated rather than blended.

Caveats worth stating plainly:

- **The trawl survey under-samples inshore habitat by design.** It sampled open
  gulf bottom, so estuary, mangrove, seagrass and harbour species (barracuda,
  barramundi, tarpon, mullet, scat, grunter) are included here on habitat
  grounds rather than because they appear in that survey's catch composition.
- **No public species list exists for Cancabato Bay specifically.** Its zone
  list is built from the bay's known habitat — roughly 54 ha of seagrass plus
  wharf structure — not from a published inventory. Correct it from experience.
- **BFAR outranks FishBase, always.** BFAR Region VIII is regional data about
  these waters; FishBase is a global database. Where they disagree, BFAR wins.
- **The 28 species added with the island expansion have no BFAR names.** Every
  local name on them is FishBase's, and *none* has been checked against what
  fishers here actually say. They are the least trustworthy strings in the app.
  Correcting one means putting the local name **first** in the list, not
  appending it — the first name is the one the cards show.
- **Ormoc Bay is a gap.** No usable public species data was found for it at all.
  Its zone is habitat inference, and it is the first thing worth correcting
  from experience.

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
