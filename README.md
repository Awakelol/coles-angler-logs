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

## The look

Blue and off-white, one strong colour and a lot of quiet around it. The whole
palette is nine custom properties at the top of
[`css/style.css`](css/style.css):

```css
--blue:    #2B4593;   /* the one strong colour: nav, buttons, links, selection */
--blue-dk: #1E3169;   /* pressed states, headings on pale grounds */
--blue-lt: #E8ECF7;   /* tinted fills — chips, empty avatars, quiet cards */
--sand:    #E6E2C5;   /* the warm counterweight */
--cream:   #F6F4EA;   /* the page itself */
--line:    #E2DFD2;   /* hairline borders */
```

**The token names are historical and deliberately not renamed.** `--yellow`,
`--sky` and `--coral` still exist and now point into the palette above. The
stylesheet is ~1,900 lines; renaming every use would have been a large diff
that changed nothing you can see, and the names are load-bearing in the sense
that they mean "the accent", "the cool ground", "the warning" — which is still
true. Change the six values above and the app follows.

**Contrast is tested, not eyeballed.** When the accents went from gold to dark
blue, `--on-accent` had to flip to white, which left the pale chips at 1.2:1 —
technically coloured, practically invisible. The suite now computes WCAG ratios
for every text-on-fill pair and holds them at 4.5:1.

### The navigation

A floating island: a pill lifted off the bottom edge, with the **+ as its
middle slot**, bulging up out of the row. Five slots — Home, Map, **+**, Info,
Account.

**The + replaced the Log tab, not the Log screen.** `#/log` is still a route
with its own history entry, and "Log a catch" is the first thing the + offers.
A test asserts that link exists, because a route nothing in the chrome can
reach is the failure this arrangement invites.

The swell around it belongs to **the bar**, not the button — it is
`.tabbar::before`, a disc in the bar's colour that paints over the bar's own
hairline where they overlap, so the silhouette comes out as one shape. Built as
a ring on the button instead, it travels with the button and is still there
when the bar rolls away, which reads as the + growing a collar rather than the
nav retracting.

### Two names, and a face

The **handle** is what you signed up as: unique, validated, and what the account
*is*. The **display name** is a label on top of it — anything, including nothing,
in which case the handle shows. Keeping them apart is what lets someone rename
themselves without their sign-in quietly becoming something else.

Avatars are centre-cropped to a square **at the source**, not with `object-fit`.
The same blob is shown at 84px on the account screen and smaller elsewhere, and
cropping in CSS crops a portrait differently at every aspect — cropping once
means every place it appears shows the same face.

**Neither syncs.** They live in IndexedDB (`profiles`, DB v3) per account.
Firestore's rules permit `users/{uid}/catches` and nothing else, so a profile
document would be denied. The shape is ready — one row keyed by the same account
id — but publishing that rule is a console action.

### One sign-in card, three homes

`js/auth-ui.js` owns the sign-in and sign-up form. It used to live inside
`js/pages/log.js`, which meant the only way to get an account was to visit the
catch log — so Account and Settings, the two screens *about* your account, both
had to send you somewhere else to get one.

Extracted, not copied. Three copies of an auth form is three places to fix a bug
in, and the one that gets missed is the one someone is using.

`mountAuthCard(root, { onDone, onSwap, allowGuest })`. The log passes `onSwap`
because its heading lives in a band outside the card and has to follow it;
Account and Settings let the card re-render in place. **Everything bound to an
element the swap replaces lives in `wire()`**, which runs again after each swap —
previously it ran once, because swapping re-navigated and remounted the whole
route, so sharing the card without that would have left the second view inert.

`allowGuest` is false on Account and Settings: choosing to look around without
an account is something you do on the way to the log, not on the screen about
your account.

### The refresh button

**Settings → Version & history → Refresh the app.** Asks for a fresh `sw.js`,
then deletes every `angler-log-*` cache, then reloads.

**Order matters:** `reg.update()` first, so a new worker is in charge before the
caches go — clear them under the old worker and it simply fills them again from
its own shell list, which looks like the button did nothing.

**It refuses when offline,** and that is the important part: with no network the
cache *is* the app, so deleting it leaves nothing to load and the next reload is
a blank screen. A test holds that refusal.

The cog moved out of the top bar and onto **Account**. It was on every screen,
which put a link to configuration in front of someone looking at a fish.

### Guest mode

**Not a fake account.** A catch saved without one gets `userId: null` and is
adopted by the first account made (`store.adoptOrphans`). That behaviour was
always there; the sign-in gate was hiding it, which made “start now, keep it
later” a promise the screen contradicted.

Spots stay behind the account — they are filtered by `userId` with no orphan
path, and that gate is deliberate.

Signing in or up clears the flag. It has to: left set, it would keep the gate
hidden after a later sign-out, which is the one moment it must come back.

### Settings is an index

`#/settings` lists grouped rows; `?p=<key>` opens one panel. Same sections, same
ids, one `mount()`.

**Every lookup in that mount must be guarded.** It runs whole for whichever
panel is on screen, and it used to assume all of them were — one unguarded
`querySelector(...).textContent` threw and the router replaced the entire page
with “Something broke on this screen”. A test opens every panel in turn and
fails on an error card, because that is the specific failure splitting a route
like this invites. An unknown `?p=` falls back to the index.

### Info: the folder deck

Below 900px, Info is a line of folders you swipe through. **The line comes from
the top**: the folder you are reading sits at the bottom, and the ones still to
come stack above it, each showing its whole bill — name and picture — so you can
see what is next. **Nothing is ever removed**; swiping moves you ALONG the line,
and a counter says where you are in it. Tap the front card to open it, and the
`×` on its bill to come back. `js/card-deck.js`.

The step is a little more than the bill's height. The slack is for the idle
float: the front folder drifts up to 4px, and at exactly one bill per step it
would clip the name above it at the top of every drift.

**The swipe is inverted.** The folders come from above, so the gesture that
brings the next one down is a downward drag — a scroll *up*. Card 0 rests at the
END of the rail and the line works back from there. Mapped the other way round
you swipe up to fetch something from above, and the hand and the eye disagree
about which way the stack is moving.

**Four example pictures are the body** of the front folder — a family's own
fish, and for a body of water the fish actually caught in it. Gear gets its own
icons; there are no gear photographs, and a stand-in would be a picture of
nothing pretending to be a picture of something. A number says how many, a
photograph says what, and you are choosing between thirty-odd of these.

The count sits **beside the name at half opacity**: the name is what you choose
by, the number is the detail you check once you have.

**Only the front folder drifts.** Every card moving at once read as the page
being unsteady; one moving reads as that card being the live object and the rest
being filed behind it.

Each bill carries a picture: a real photograph for a fish family, an icon for
gear and waters, because there are no photographs of those and a stand-in would
be worse than an honest symbol.

#### Two things make it smooth, and both are about not fighting the browser

**A real scroller does the scrolling.** An invisible rail with one
viewport-height spacer per card and `scroll-snap-type: y mandatory`. Momentum,
rubber-banding at the ends, snap-to-card and the exact feel of the platform come
free. Hand-rolling that on touch means reimplementing a physics engine you
cannot test from a desktop, and getting it 90% right reads as broken.

**The cards follow the scroll continuously, not on release.** `--d` is a card's
distance from the front and it is FRACTIONAL — 2.37, not 2. Every frame
repositions the whole stack, so the card under your thumb tracks it exactly and
the one behind is already rising to meet you. Snapping to an index and animating
between them is what makes a carousel feel like a slideshow.

#### A folder is two rounded boxes, not one clipped one

It was a single element with a `clip-path` polygon, which cuts **square corners**
wherever the path turns — `border-radius` is applied before the clip, so the
bill's corners came out sharp against rounded everything-else, and the
`drop-shadow` traced that mismatch as a hard edge inside the card.

A bill and a body sharing one background, each rounded only on the corners that
are actually outside edges, gives the same silhouette with every corner correct.
Their shared edge is invisible because it is the same colour meeting itself, and
the shadow lives on the **wrapper** so it follows the union rather than
outlining each box.

#### The idle float

A card sitting still looks printed on the screen; a card breathing looks like an
object. A 7s keyframe drifts each card a few pixels and a third of a degree,
staggered by index so the fan breathes rather than pulsing in unison.

**It lives on an inner element** (`.dcard__float`). The card itself carries the
stack transform, rewritten on every frame of a drag; an animation on the same
element would be overwritten sixty times a second. Nesting them means the
browser composes the two instead of one winning.

#### The colours

The first set were pastels on an off-white page: about 4% lightness between a
folder and the paper behind it. The colour was there but it did not read as
colour, it read as a smudge. These sit far enough from `--cream` to be seen
while staying light enough to carry the same dark text at well over 4.5:1.

The three categories are **small pills under the search box**, not stacked
bookmark cards. Three things you switch between are a control, not a table of
contents, and 150px of bookmark to say so was the deck's screen space being
spent on furniture.

#### Opening: the card turns over

Tapping flips the folder. A card turning over is the one gesture that makes a
card-sized thing becoming a page-sized thing feel like one object rather than
two — and it solves the problem the plain grow had: **stretching a card to fill
a screen distorts everything printed on it**, and here the stretch happens while
the BACK is facing you, which is a flat panel of one colour and cannot look
distorted. By the time it is full-screen you are looking at the back of the
card, and the content fades in onto it.

Standard CSS 3D: two faces, one rotated 180° behind the other, both
`backface-visibility: hidden` so only the one facing you paints. The perspective
is written **into the inner element's own transform** rather than set on a
parent, because the parent is being scaled by six and a scaled perspective is
not the perspective you asked for.

Three things this needs that are easy to miss:

- **The clone goes inside a face, it is not one.** A `.dcard` carries its own
  absolute positioning and height from the deck, and those beat anything the
  face rule says — the front stayed pinned to the bottom of the box and never
  turned, while the back grew over the page on its own.
- **The rest of the deck fades out with it.** The flip is a fixed clone over the
  live deck, so without this the card you tapped turns while its twin and the
  whole line sit there behind it, and the growing panel covers a scene that is
  still moving. Timed to be gone by the halfway point, where the card is
  edge-on and there is nothing to see through anyway.
- **`front` is recomputed at tap time**, not read off the last paint: `paint()`
  runs on a rAF, so a tap landing between a scroll and its frame would open
  whichever folder was in front one frame ago.

`tools/flip_frames.py` renders it. `captureScreenshot` takes longer than the
flip does, so a timed capture always lands after it — that tool pauses the
animation at fixed points and reloads between them instead.

#### Drag the header down to put a folder back

An open folder is a window over the deck, and every other panel in this app
that covers something can be pushed back down. An `×` you had to find was the
odd one out, so the bill is a drag handle too. It moves the whole results pane,
so the content travels with its header rather than sliding out from under it.

`touch-action: none` on that strip only — the browser would otherwise claim the
vertical gesture for scrolling before it reached us, and the body below still
needs to scroll normally.

#### The pictures

**The cell decides the shape, not the photograph.** `.species-photo` carries
`aspect-ratio: 4/3` and `object-fit: contain` for the Info list, where a whole
fish on a tinted ground is right. In the deck that fought the grid cell — the
ratio pinned each image to its own shape while the cell had another, so some
letterboxed, some overflowed, and no two were cropped alike. Resetting the ratio
and covering the cell makes all four consistent.

Cropping top and bottom is the *right* crop for a fish: they are long and
horizontal, and the middle band is the whole animal.

Tiles are washed with `rgb(22 24 29 / .07)`, not white. White at 45% is
invisible on the white *Everything* folder, which left the gear icons floating
in nothing. Icons are sized in percent for the same reason — a 34px glyph in a
160px cell reads as a mistake rather than as a picture.

**Three upcoming bills, not four.** The fourth was 42px the front folder's body
did not have, and its photographs were what got squeezed for it.

**A folder you have passed goes invisible almost at once** rather than fading
across the whole step. Half-transparent, it sat over the folder arriving behind
it and you read both at the same time, which is worse than either.

#### The page is pinned while the deck is up

`deck-locked` on **both `<html>` and `<body>`**. `overflow: hidden` on `<body>`
alone clips the body box but leaves the document scrollable — html's
`scrollHeight` still counts the content — so the page keeps a couple of hundred
pixels of travel and the swipe still fights it. A test measures that there is
nothing left to scroll.

`main` is the flex column, not the first band: the header and the deck are two
sibling `<section>`s, and sizing the first to the viewport just pushes the
second off the bottom.

The pin lifts the moment a folder opens — reading needs the page back.

#### Why no Framer Motion

It was the right suggestion for a React app and this is not one: no build step,
no bundler, no framework. And the physics that matters here is the platform's
own scroller — its momentum, its rubber-band, its snap. No library beats that,
because no library *is* that; they all reimplement it and land somewhere close.

#### Two that bite

- **`scroll-snap-type: y mandatory` corrects a programmatic scroll** to a
  half-position before anything can read it, so the mid-swipe state is
  unobservable with snapping on. The test turns it off for that one
  measurement.
- **`scaleX` only, not `scale`.** A uniform scale pulls the bottom edge back up
  by nearly what the offset pushed it down, and the slivers cancel to nothing.

**Searching bypasses the deck.** A query is a request to see matches, and it
unpins the page. Above 900px the chips return — a wide window has room for
every subcategory at once.

### Installing on an iPhone

Safari → Share → **Add to Home Screen**. Nothing special is needed: the
`apple-touch-icon`, `apple-mobile-web-app-title` and `display: standalone` are
all present. `mobile-web-app-capable` is there too — Chrome warns about a page
carrying only Apple’s prefixed version.

### The desktop rail

At **900px and up** the bar becomes a rail down the left: a dark panel with the
brand at the top, a full-width **New entry** button, and the links grouped under
*Explore* and *You*.

**It is the same `<nav>`.** A phone bar and a desktop rail built as two elements
would mean two sets of links, two active states, and a route that highlights in
one and not the other the first time someone adds a page. What differs is which
children show and how they flow — `.rail__head`, `.rail__group` and `.rail-only`
sit out below 900px, and the `+` is hoisted with `order` rather than moved.

That also settles the argument the phone bar could not: **Log and Settings get
their own rows up here**, because a rail has as many slots as it wants.

Two things worth knowing before editing it:

- **The rail's rules come after the base `.tabbar` rules on purpose.** A media
  query does not raise specificity — `.tabbar a[aria-current]` inside one and
  outside one are both `(0,1,1)`, so source order decides. Placed above, the
  rail's white-on-blue active row lost its colour to the phone bar's `--ink`
  and rendered near-black on blue at about 2:1.
- **Rail-only rules are scoped through `.tabbar`.** `.tabbar a` is `(0,1,1)` and
  beats a bare `.rail-only` `(0,1,0)`, which left the rail's links visible in the
  phone bar the first time.

**It collapses.** The button at the foot narrows the rail to a 74px strip of
icons and the page slides over with it; the choice is stored in `prefs` under
`railCollapsed`, because narrowing it is a decision about how you want to work
rather than a response to the window.

Two things that look optional and are not:

- **The labels give up their `max-width`, not just their opacity.** An invisible
  label still takes its full width, so the icons centred around empty space and
  sat hard against the rail's edge with the text clipped off it. `max-width`
  rather than `width` because it animates from a real number to zero.
- **`:not(.rail__mark)`** on that rule. The brand mark is a `<span>` inside an
  `<a>`, so it matched and the logo collapsed along with the words.

Collapsed, the icons carry a native `title`. Not a styled tooltip: the rail
scrolls, so anything drawn inside it is clipped at the panel's edge — which is
the one place a tooltip must not be.

The toggle sits at the **foot** rather than on the panel's edge like the
reference, for the same clipping reason — and it fills the empty bottom the rail
otherwise had.

The rail is the app's one dark surface, so it is the one place `--ink` can land
on a dark ground without anyone noticing. `desktop_check.py` composites the
alpha text against the panel and holds every rail label to 4.5:1.

There is **no right-hand rail**, unlike the reference. The map already puts its
weather panel beside the map on desktop; a second permanent column on every
other screen would be furniture looking for content.

### The nav rolls away on the map

On **/map** the bar retracts **to the bottom-right** and hands its space back;
pressing the + brings it out again. The pill is anchored on its right edge
rather than centred — the same position either way, but it decides which way it
goes when it shrinks. Centred it collapsed about its own middle and left the +
floating in the void; pinned right it rolls to the edge and parks where a thumb
already is. Only the map: it is the one screen where the content is
the whole viewport and every pixel of chrome is taken from it. Phone only, too
— above 900px the map is already a two-column layout with room to spare, and
hiding the primary navigation to buy space that isn't scarce is a trade in the
wrong direction.

The state is a class on `<body>`, not a style on the bar, because
`--tab-space` is what every screen leaves clear for the nav. The map's height
and margin both derive from it, so shrinking that one token is what actually
gives the room away — and Leaflet notices through the `ResizeObserver` in
`js/pages/map.js`.

While rolled, the **+ does one job only: bring the bar back.** Opening the
quick actions on the same press would put a menu over a bar still unrolling
behind it. Press it again once you can see the bar and it opens the actions as
usual. Touching the map puts it away again, and leaving the map restores it.

**The roll is phone-only in behaviour, not just in CSS.** Its rules are behind
a media query, but `tabindex` is not a rule — applied at desktop width it left
every link in a fully visible rail unreachable by keyboard on the map. The
toggle re-checks the media query, and re-runs when the window crosses it.

Rolled, the bar becomes **one grid cell with everything stacked in it**. Left
as five columns, each column still claims its min-content — the tabs' labels —
so the track total stayed near 260px inside a 58px box, the grid overflowed, and
the + went clean off the right edge of the screen. Fading a thing does not stop
it taking up room.

The tabs get `tabindex="-1"` while rolled. Faded out is not gone: without it,
five links stay in the tab order behind a transparent bar and keyboard focus
disappears into a strip of nothing.

`--fab-crown` is the nav's true high point, the top of the + with its ring.
Everything that has to clear the bar clears the bulge too because it is derived
from that one token: the page's bottom padding, the map's height, and where the
quick-action stack starts. The map screen is the reason it matters — the
weather drawer's grip sits centre-bottom, exactly under the +, and a hardcoded
number would have put a button on top of the handle you pull.

Pressing it rotates two bars into an ×. Both bars are the same shape rotating,
not one glyph swapped for another — a swap reads as a flicker at this size.
The three quick actions rise in sequence behind a veil, and close on the ×, the
veil, Escape, or any navigation.

### Dark mode is off

`THEME_LOCKED` in [`js/theme.js`](js/theme.js) forces light and hides the theme
picker while the light palette settles. **The dark rules are untouched**, and a
test reads them out of the stylesheet so they cannot rot while unreachable.
Set `THEME_LOCKED = false` to bring the picker back — then retune the dark
palette, because it still answers to the old gold.

### Retro mode

The pixel art is not gone; it is an easter egg. **Tap the version number at the
foot of Settings seven times.** A hint appears at three taps so it is findable
by someone poking at it, and not before.

The switch is one module — [`js/art.js`](js/art.js) is a façade over
[`js/art/modern.js`](js/art/modern.js) and the pixel renderer, so pages ask for
`icon('hook')` and get whichever mode is on. The mode lives in `localStorage`
and re-renders in place.

Species **photographs** are unaffected: those show in both modes, and retro
mode only changes icons and the fish that still have no photograph.

---

## Testing

```bash
python -m http.server 8777          # terminal 1
python tools/browser_test.py        # terminal 2 — 512 checks, phone width
python tools/desktop_check.py       # terminal 2 — 30 checks, 1440x900
```

**Both, always.** The main suite runs at phone width, so the desktop rail, the
two-column map and the rounded content panel are invisible to it — and a phone
layout that passes tells you nothing about the width where the navigation is a
completely different element. `tools/desktop_shots.py` writes screenshots of
those layouts for looking at.

Drives real headless Chrome over the DevTools Protocol — checks covering
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

Bump `CACHE_VERSION` in [`sw.js`](sw.js) when you change an **image in place** —
same filename, different pixels. Images are cache-first, so a device keeps the
copy it already has however many times you redeploy. `tools/fish_photos.py
build` now bumps it automatically whenever it writes a photo, because
regenerating photos and evicting them must not be two things you can do
separately: forgetting the second means the fix you just made is invisible on
every device that already loaded the old one.

> This used to be cache-first for everything, which meant every JS/CSS edit kept
> serving the stale copy until `CACHE_VERSION` was bumped by hand. It silently
> hid a whole round of sprite work — and headless tests never caught it, because
> each run uses a fresh browser profile with no service worker. If you ever do
> see stale UI, hard-reload (Ctrl+Shift+R) or unregister the worker under
> DevTools → Application → Service Workers.

---

## How it's built

```
index.html            app shell, floating nav, quick-action menu
css/style.css         all styling, palette tokens at the top
js/
  app.js              hash router, region switching, quick actions
  config.js           API keys + provider settings
  store.js            IndexedDB (catches + spots) + localStorage (prefs) + stats
  theme.js            light/dark, and the lock that pins it to light
  art.js              icon façade — hands off to modern or pixel
  art-mode.js         which mode is on, and the seven-tap unlock
  art/modern.js       the line icons and the brand mark
  pixel.js            sprite grids, palettes, SVG renderer (retro mode)
  map-spots.js        long-press to drop a spot, per account
  ui.js               esc/format/toast/modal-sheet helpers
  api/weather.js      Open-Meteo + OpenWeather, one normalised shape
  api/tides.js        WorldTides + Stormglass, 6-hour cache
  data/
    index.js          catalogue + region registry  <- register new regions here
    tips.js           general tips
    tactics.js        lure + retrieve advice by family and habitat
    species/          the fish themselves, region-independent
    regions/          places; reference species by id
  pages/              home, map, conditions, log, info, identify, account, settings
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

**Your data is local to the device by default.** An account is optional, and a
device-only one is a real choice rather than a lesser one — see
[Accounts and cloud sync](#accounts-and-cloud-sync). Without cloud sync,
clearing site data or uninstalling the PWA deletes your log, so use
**Settings → Export JSON** to back up. Export omits photos, since JSON can't
carry image data.

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
that no 4:3 window can hold it inside the photo, the whole frame is kept and
padded out to the card's shape with a *blurred, dimmed copy of the photo
itself*, so the frame is filled without losing a fin. A flat colour would still
be a bar; cropping would take the tail. Seven of 67 land there.

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
