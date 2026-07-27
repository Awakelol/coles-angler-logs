"""
Drives headless Chrome over the DevTools Protocol to test the app for real.

Headless Chrome's --virtual-time-budget starves IndexedDB callbacks, so the
simpler --dump-dom approach reports empty panes on any page that reads the
database. This attaches to a real page target and waits on wall-clock time.

Usage:
    python -m http.server 8777 --bind 127.0.0.1   (from the project root)
    python tools/browser_test.py
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

CHROME = next(
    (p for p in [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ] if os.path.exists(p)),
    None,
)

BASE = os.environ.get("APP_BASE", "http://127.0.0.1:8777")
PORT = 9333
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_screenshots")


def http_json(path, retries=40):
    for _ in range(retries):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=2) as r:
                return json.load(r)
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"Chrome DevTools endpoint never came up on {PORT}")


class Page:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def send(self, method, **params):
        self.n += 1
        msg_id = self.n
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
        while True:
            raw = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=45))
            if raw.get("id") == msg_id:
                if "error" in raw:
                    raise RuntimeError(f"{method}: {raw['error']}")
                return raw.get("result", {})

    async def goto(self, url):
        await self.send("Page.navigate", url=url)
        await asyncio.sleep(0.4)

    async def eval(self, expr):
        # async wrapper so evaluated snippets can use await / dynamic import
        r = await self.send(
            "Runtime.evaluate",
            expression=f"(async function(){{ {expr} }})()",
            returnByValue=True,
            awaitPromise=True,
        )
        if r.get("exceptionDetails"):
            raise RuntimeError(r["exceptionDetails"].get("text", "js exception"))
        return r["result"].get("value")

    async def wait_for(self, expr, timeout=15, label=""):
        """Poll a JS boolean expression until true, on real wall-clock time."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if await self.eval(f"return !!({expr});"):
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.25)
        raise AssertionError(f"timeout waiting for {label or expr}")

    async def shot(self, name, full=True):
        """full=False captures just the viewport — needed for position:fixed UI
        like the modal sheet, which captureBeyondViewport renders misleadingly."""
        os.makedirs(SHOTS, exist_ok=True)
        r = await self.send("Page.captureScreenshot", format="png", captureBeyondViewport=full)
        import base64
        with open(os.path.join(SHOTS, f"{name}.png"), "wb") as f:
            f.write(base64.b64decode(r["data"]))


PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail and not ok else ''}")


def static_checks():
    """
    Source-level checks the browser can't make.

    A fresh headless profile has no service worker, so the suite is blind to
    caching bugs by construction — a stale-cache regression once hid a whole
    round of sprite work while every test passed. These read the files instead.
    """
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    sw = open(os.path.join(root, "sw.js"), encoding="utf-8").read()

    print("\nService worker")
    # Code must not be served cache-first, or edits won't reach an installed app.
    cache_first_all = "caches.match(request).then((hit) => {\n      if (hit) return hit;" in sw
    check("code is not served cache-first", not cache_first_all,
          "cache-first for code hides updates until CACHE_VERSION is bumped")
    check("images are cache-first", "CACHE_FIRST" in sw)
    # skipWaiting is what makes a push take effect without a force-close.
    check("new worker activates immediately", "skipWaiting" in sw and "clients.claim" in sw)

    upd = open(os.path.join(root, "js", "updates.js"), encoding="utf-8").read()
    check("app watches for new versions", "controllerchange" in upd and "reg.update()" in upd)
    check("update reload waits for open forms", "sheetOpen" in upd)

    # The store test wipes the catch log and is deployed with the app, so it
    # must refuse to run on anything but a local host.
    tst = open(os.path.join(root, "tools", "test-store.html"), encoding="utf-8").read()
    check("destructive test page is localhost-only",
          "location.hostname" in tst and "REFUSED" in tst,
          "test-store.html would clear real data if opened on the live site")

    # CDN headers must not cache the worker or the shell, or deploys go unseen.
    for name in ("_headers", "vercel.json"):
        cfg = open(os.path.join(root, name), encoding="utf-8").read()
        check(f"{name} keeps sw.js uncached", "sw.js" in cfg and "no-cache" in cfg)
    check("offline navigation falls back to the shell", "caches.match('./index.html')" in sw)

    # Every app module must be in the precache list, or offline breaks.
    listed = set(re.findall(r"'\./((?:js|css)/[^']+)'", sw))
    on_disk = set()
    for sub in ("js", "css"):
        for dirpath, _, files in os.walk(os.path.join(root, sub)):
            for f in files:
                # config.local.js holds secrets and config.local.example.js is a
                # template — neither is imported, so neither should be precached.
                if f.endswith((".js", ".css")) and ".local" not in f:
                    rel = os.path.relpath(os.path.join(dirpath, f), root)
                    on_disk.add(rel.replace(os.sep, "/"))
    missing = sorted(on_disk - listed)
    check("every module is precached for offline", not missing, ", ".join(missing))


async def main():
    if not CHROME:
        sys.exit("No Chrome or Edge found.")

    profile = tempfile.mkdtemp(prefix="anglertest")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
         "--window-size=430,932", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    try:
        http_json("/json/version")
        targets = [t for t in http_json("/json/list") if t["type"] == "page"]
        ws_url = targets[0]["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=40 * 1024 * 1024) as ws:
            page = Page(ws)
            await page.send("Page.enable")
            await page.send("Runtime.enable")

            # -------------------------------------------------- store layer
            print("\nIndexedDB store")
            await page.goto(f"{BASE}/tools/test-store.html")
            await page.wait_for("document.getElementById('out').textContent.includes('RESULT:')",
                                timeout=25, label="store test to finish")
            out = await page.eval("return document.getElementById('out').textContent;")
            check("store round-trip", "RESULT: PASS" in out, out)
            if "RESULT: PASS" not in out:
                print("\n".join("    " + l for l in out.splitlines()))

            # -------------------------------------------------- pixel art
            print("\nPixel art")
            await page.goto(f"{BASE}/index.html#/")
            art = await page.eval("""
                const m = await import('./js/pixel.js');
                const bad = [];
                for (const [name, p] of Object.entries(m.PALETTES)) {
                    if (p.length !== 9) bad.push(`${name}: ${p.length} slots`);
                    if (new Set(p).size < 7) bad.push(`${name}: only ${new Set(p).size} distinct tones`);
                    p.forEach((c, i) => {
                        if (!/^#[0-9a-fA-F]{6}$/.test(c)) bad.push(`${name}[${i}]="${c}"`);
                    });
                }
                const ragged = [];
                for (const set of [m.SPRITES, m.ICONS]) {
                    for (const [name, g] of Object.entries(set)) {
                        if (new Set(g.map(r => r.length)).size !== 1) ragged.push(name);
                    }
                }
                return { bad, ragged, sprites: Object.keys(m.SPRITES).length };
            """)
            hero = await page.eval("""
                const p = await import('./js/pixel.js');
                const d = await import('./js/data/index.js');
                const species = d.allSpecies('leyte-gulf');
                const missing = [], ragged = [];
                for (const [n, g] of Object.entries(p.HEROES)) {
                    if (new Set(g.map(r => r.length)).size !== 1) ragged.push(n);
                }
                // Every species must render a hero (real or fallback) without throwing.
                let withHero = 0;
                for (const s of species) {
                    const svg = p.speciesHero(s, { size: 200 });
                    if (!svg.startsWith('<svg')) missing.push(s.id);
                    if (p.hasHero(s)) withHero++;
                }
                return { count: Object.keys(p.HEROES).length, ragged, missing,
                         withHero, total: species.length };
            """)
            check("hero art present for every archetype", hero["count"] >= 13, str(hero["count"]))
            check("no hero has ragged rows", not hero["ragged"], ", ".join(hero["ragged"]))
            check("every species renders a hero", not hero["missing"], ", ".join(hero["missing"][:5]))
            check("most species have real angled art",
                  hero["withHero"] >= hero["total"] - 5,
                  f"{hero['withHero']}/{hero['total']} (rest fall back)")

            check("all palettes are 9 valid hex slots", not art["bad"], "; ".join(art["bad"]))
            check("no sprite has ragged rows", not art["ragged"], ", ".join(art["ragged"]))

            # Every WMO code the providers can return must resolve to a real icon.
            wmo = await page.eval("""
                const p = await import('./js/pixel.js');
                const w = await import('./js/api/weather.js');
                const codes = [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,
                               71,73,75,77,80,81,82,85,86,95,96,99];
                const missing = [], unlabelled = [];
                for (const c of codes) {
                    const [label, key] = w.describeCode(c);
                    if (!p.ICONS[key]) missing.push(`${c}->${key}`);
                    if (!label || label === '—') unlabelled.push(String(c));
                }
                // Night variant must swap clear/partly for the moon.
                const nightClear = w.describeCode(0, true)[1];
                const nightRain = w.describeCode(63, true)[1];
                return { missing, unlabelled, nightClear, nightRain,
                         unknown: w.describeCode(12345)[1] };
            """)
            check("every WMO code maps to a real icon", not wmo["missing"],
                  ", ".join(wmo["missing"]))
            check("every WMO code has a label", not wmo["unlabelled"],
                  ", ".join(wmo["unlabelled"]))
            check("night swaps clear sky for the moon", wmo["nightClear"] == "moon",
                  wmo["nightClear"])
            check("night leaves rain alone", wmo["nightRain"] == "rain", wmo["nightRain"])
            check("unknown code falls back safely",
                  bool(wmo["unknown"]) and wmo["unknown"] != "sun", wmo["unknown"])

            # -------------------------------------------------- data integrity
            print("\nData model")
            data = await page.eval("""
                const d = await import('./js/data/index.js');
                const region = d.getRegion('leyte-gulf');
                const known = new Set(d.SPECIES.keys());

                // Every id referenced by the region or its zones must exist.
                const dangling = [];
                for (const id of region.species || []) {
                    if (!known.has(id)) dangling.push(`region:${id}`);
                }
                for (const z of region.zones || []) {
                    for (const id of z.species || []) {
                        if (!known.has(id)) dangling.push(`${z.id}:${id}`);
                    }
                }
                // A species in a zone but missing from the region list would be
                // invisible in the guide.
                const inRegion = new Set(region.species || []);
                const orphans = [];
                for (const z of region.zones || []) {
                    for (const id of z.species || []) {
                        if (!inRegion.has(id)) orphans.push(`${z.id}:${id}`);
                    }
                }
                const barracudaZones = d.zonesForSpecies('leyte-gulf', 'sphyraena-barracuda')
                    .map(z => z.id);
                const cancabato = (region.zones || []).find(z => z.id === 'z-cancabato');
                // How many zones list each species — proves sharing works.
                const counts = {};
                for (const z of region.zones || []) {
                    for (const id of z.species || []) counts[id] = (counts[id] || 0) + 1;
                }
                const shared = Object.values(counts).filter(n => n > 1).length;

                return {
                    catalogue: known.size,
                    regionSpecies: (region.species || []).length,
                    dangling, orphans, barracudaZones, shared,
                    cancabatoCount: (cancabato?.species || []).length,
                    cancabatoHasBarracuda: (cancabato?.species || []).includes('sphyraena-barracuda'),
                };
            """)
            check("no dangling species ids", not data["dangling"], ", ".join(data["dangling"][:5]))
            check("no zone species missing from region", not data["orphans"], ", ".join(data["orphans"][:5]))
            check("catalogue has 40+ species", data["catalogue"] >= 40, str(data["catalogue"]))
            check("species shared across multiple zones", data["shared"] >= 10,
                  f"only {data['shared']} appear in >1 zone")
            check("barracuda listed in Cancabato Bay", data["cancabatoHasBarracuda"],
                  f"zones: {data['barracudaZones']}")
            check("Cancabato Bay has a full species list", data["cancabatoCount"] >= 15,
                  str(data["cancabatoCount"]))

            # -------------------------------------------------- routes
            routes = {
                "home": ("#/", ".kpi__v, .empty"),
                "species": ("#/species", ".species-card"),
                "conditions": ("#/conditions", ".now-card__temp, .notice--error"),
                "log": ("#/log", ".kpi__v"),
                "tips": ("#/tips", ".tip-card"),
                "settings": ("#/settings", "#saveTides"),
            }
            print("\nRoutes")
            for name, (hash_, sel) in routes.items():
                await page.goto(f"{BASE}/index.html{hash_}")
                try:
                    await page.wait_for(f"document.querySelector('{sel}')", timeout=20, label=name)
                    ok = True
                    detail = ""
                except AssertionError as e:
                    ok, detail = False, str(e)
                err = await page.eval("return document.body.getAttribute('data-js-error');")
                broke = await page.eval(
                    "return document.body.innerText.includes('Something broke on this screen');")
                check(f"{name} renders", ok and not err and not broke, detail or err or "render error")
                await page.shot(name)

            # -------------------------------------------------- log flow
            print("\nCatch log flow")
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelector('.kpi__v')", label="log stats")

            seeded = await page.eval("""
                const m = await import('./js/store.js');
                await m.store.clearCatches();
                await m.store.saveCatch({speciesId:'lutjanus-argentimaculatus', regionId:'leyte-gulf',
                    date:'2026-07-21', weightKg:4.2, lengthCm:61, method:'Casting lure', bait:'live tamban'});
                await m.store.saveCatch({speciesId:'photopectoralis-bindus', regionId:'leyte-gulf',
                    date:'2026-07-24', weightKg:0.11, lengthCm:9});
                return (await m.store.allCatches()).length;
            """)
            check("seed two catches", seeded == 2, f"got {seeded}")

            await page.goto(f"{BASE}/index.html#/tips")
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelectorAll('.catch-row').length === 2",
                                timeout=20, label="catch rows to appear")
            check("catches listed after reload", True)

            stats = await page.eval("""
                return [...document.querySelectorAll('.kpi__v')].map(e => e.textContent.trim());
            """)
            check("stats: 2 catches / 2 species", stats[0] == "2" and stats[1] == "2", str(stats))
            check("stats: heaviest 4.2 kg", stats[2] == "4.2", str(stats))
            check("stats: longest 61 cm", stats[3] == "61", str(stats))

            records = await page.eval("return document.querySelectorAll('#recordsPane .card').length;")
            check("personal bests rendered", records == 2, f"got {records}")
            await page.shot("log-with-data")

            # -------------------------------------------------- species UI
            print("\nSpecies guide")
            await page.goto(f"{BASE}/index.html#/species")
            await page.wait_for("document.querySelector('.species-card')", label="species cards")
            total = await page.eval("return document.querySelectorAll('.species-card').length;")
            check("all species listed", total >= 25, f"got {total}")

            await page.eval("""
                const i = document.getElementById('speciesSearch');
                i.value = 'sap-sap';
                i.dispatchEvent(new Event('input', {bubbles:true}));
            """)
            await asyncio.sleep(0.4)
            found = await page.eval("return document.querySelectorAll('.species-card').length;")
            check("local-name search works", 0 < found < total, f"{found} of {total}")

            dupes = await page.eval("""
                const d = await import('./js/data/index.js');
                const bad = [];
                for (const s of d.allSpecies('leyte-gulf')) {
                    const names = d.localNames(s).map(l => l.name.toLowerCase());
                    if (new Set(names).size !== names.length) bad.push(s.id);
                }
                const merged = d.localNames(d.getSpecies('photopectoralis-bindus'));
                return { bad, sapsap: merged.find(l => l.name === 'sap-sap')?.label };
            """)
            check("local names are deduped", not dupes["bad"], ", ".join(dupes["bad"][:5]))
            check("shared names merge their languages",
                  dupes["sapsap"] == "Waray / Cebuano", str(dupes["sapsap"]))

            await page.eval("""
                const i = document.getElementById('speciesSearch');
                i.value = '';
                i.dispatchEvent(new Event('input', {bubbles:true}));
                document.querySelector('.species-card').click();
            """)
            await asyncio.sleep(0.5)
            sheet = await page.eval("""
                const s = document.querySelector('.sheet');
                return s ? s.innerText.includes('FishBase') : false;
            """)
            check("species detail sheet opens", sheet)

            # The sheet must show the big angled hero; the cards behind it must
            # keep the small horizontal sprite.
            # Aspect ratio can't tell these apart (a 'deep' body is near-square
            # either way), so compare each rendered viewBox against the actual
            # grid dimensions in HEROES vs SPRITES.
            art_split = await page.eval("""
                const p = await import('./js/pixel.js');
                const vb = (el) => {
                    if (!el) return null;
                    const v = el.getAttribute('viewBox').split(' ');
                    return `${v[2]}x${v[3]}`;
                };
                const dims = (g) => `${g[0].length}x${g.length}`;

                const openId = document.querySelector('.sheet a[href*="#/log?species="]')
                    ?.getAttribute('href').split('=')[1];
                const d = await import('./js/data/index.js');
                const s = d.getSpecies(openId);
                const heroGrid = p.HEROES[s.hero] || p.HEROES[s.sprite];
                const spriteGrid = p.SPRITES[s.sprite];

                return {
                    id: openId,
                    sheet: vb(document.querySelector('.species-card__art--hero svg')),
                    card: vb(document.querySelector('.species-card:not(.sheet *) .species-card__art svg')),
                    expectHero: heroGrid ? dims(heroGrid) : null,
                    expectSprite: spriteGrid ? dims(spriteGrid) : null,
                };
            """)
            check("detail sheet renders the angled hero grid",
                  art_split["sheet"] == art_split["expectHero"],
                  f"{art_split['id']}: got {art_split['sheet']}, hero is {art_split['expectHero']}")
            check("hero grid differs from the horizontal sprite",
                  art_split["expectHero"] != art_split["expectSprite"],
                  f"both {art_split['expectHero']}")
            # Cards now use the angled art too; only small UI keeps horizontal.
            check("species cards use the angled hero",
                  art_split["card"] == art_split["expectHero"],
                  f"got {art_split['card']}, hero is {art_split['expectHero']}")
            await page.shot("species-detail", full=False)

            fb = await page.eval("""
                const a = [...document.querySelectorAll('.sheet a')].find(x => x.href.includes('fishbase'));
                return a ? a.href : '';
            """)
            check("fishbase link built", "fishbase.se/summary/" in fb and "-" in fb, fb)

            # Real photos come from Wikipedia (free licences); FishBase photos
            # are copyrighted and must stay as outbound links only.
            photo = await page.eval("""
                const p = await import('./js/api/photos.js');
                const hit = await p.fetchPhoto('Lutjanus argentimaculatus');
                const miss = await p.fetchPhoto('Notarealfish madeupii');
                return { hit, miss };
            """)
            check("species photo fetched from Wikimedia",
                  bool(photo["hit"] and photo["hit"]["src"].startswith("https://")),
                  str(photo["hit"]))
            check("unknown species returns no photo", photo["miss"] is None, str(photo["miss"]))

            await asyncio.sleep(1.5)  # gallery loads after the sheet opens
            shown = await page.eval("""
                const sec = document.querySelector('.sheet [data-gallery]');
                const imgs = sec ? sec.querySelectorAll('.gallery__item img').length : 0;
                // The gallery must sit BELOW the written information, not
                // directly under the hero sprite.
                const hero = document.querySelector('.sheet .species-card__art--hero');
                const facts = document.querySelector('.sheet .meta-list');
                const order = sec && hero && facts
                    ? (hero.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING) &&
                      (facts.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING)
                    : false;
                return { present: !!sec, hidden: sec ? sec.hidden : null, imgs,
                         belowFacts: !!order,
                         credited: sec ? /wikimedia\\.org|wikipedia\\.org/.test(sec.innerHTML) : false };
            """)
            check("gallery sits below the information", shown["belowFacts"], str(shown))
            check("gallery renders several images", shown["imgs"] >= 2, str(shown))
            gallery = await page.eval("""
                const p = await import('./js/api/photos.js');
                const many = await p.fetchPhotos('Lutjanus argentimaculatus', 4);
                const junk = many.filter(x => /map|distribution|chart/i.test(x.title));
                return { n: many.length, junk: junk.length,
                         allHttps: many.every(x => x.src.startsWith('https://')),
                         credited: many.every(x => !!x.credit) };
            """)
            check("gallery returns multiple photos", gallery["n"] >= 2, str(gallery))
            check("range maps are filtered out", gallery["junk"] == 0, str(gallery))
            check("gallery photos are https and credited",
                  gallery["allHttps"] and gallery["credited"], str(gallery))

            check("detail sheet shows the photo", shown["present"] and not shown["hidden"],
                  str(shown))
            check("photo is attributed with a link back", shown["credited"], str(shown))

            # -------------------------------------------------- tides
            print("\nTides")
            await page.goto(f"{BASE}/index.html#/conditions")
            configured = await page.eval("""
                const t = await import('./js/api/tides.js');
                return t.tidesConfigured();
            """)
            if not configured:
                check("tide provider configured", False, "no key set — skipping live check")
            else:
                await page.wait_for(
                    "document.querySelector('.tide-row, .notice--error, .notice--warn')",
                    timeout=30, label="tide panel")
                tide = await page.eval("""
                    const pane = document.getElementById('tidePane');
                    return {
                        rows: pane.querySelectorAll('.tide-row').length,
                        err: !!pane.querySelector('.notice--error'),
                        warn: !!pane.querySelector('.notice--warn'),
                        text: pane.innerText.slice(0, 200),
                    };
                """)
                check("tide extremes render", tide["rows"] > 0 and not tide["err"],
                      tide["text"])
                check("no tide setup warning shown", not tide["warn"], tide["text"])
                state = await page.eval("""
                    const t = await import('./js/api/tides.js');
                    const d = await import('./js/data/index.js');
                    const data = await t.fetchTides(d.getRegion('leyte-gulf').coords);
                    const s = t.currentTideState(data.extremes);
                    return { provider: data.provider, station: data.station,
                             n: data.extremes.length, dir: s && s.direction };
                """)
                check("tide state interpolates", bool(state["dir"]), str(state))
                print(f"    provider={state['provider']} station={state['station']} "
                      f"extremes={state['n']} now={state['dir']}")
                await page.shot("conditions-tides")

            # -------------------------------------------------- geolocation
            print("\nLocation")
            geo = await page.eval("""
                const g = await import('./js/api/geo.js');
                const d = await import('./js/data/index.js');
                const region = d.getRegion('leyte-gulf');

                // Nearby GPS readings must snap to the same grid cell, or every
                // few metres of drift burns a tide-API request.
                const a = g.roundCoords({ lat: 11.2381234, lon: 125.0043210 });
                const b = g.roundCoords({ lat: 11.2401111, lon: 125.0061111 });
                const far = g.roundCoords({ lat: 11.9000000, lon: 125.9000000 });

                const near = g.nearestPlace(region, { lat: 11.238, lon: 125.004 });
                const dist = g.distanceKm({lat:11.238,lon:125.004}, {lat:11.03,lon:125.72});
                return {
                    same: JSON.stringify(a) === JSON.stringify(b),
                    differs: JSON.stringify(a) !== JSON.stringify(far),
                    snapped: a,
                    nearest: near && near.name,
                    distOk: dist > 70 && dist < 90,
                    supported: g.geolocationSupported(),
                };
            """)
            check("nearby fixes share one tide-cache cell", geo["same"], str(geo["snapped"]))
            check("distant fixes do not collide", geo["differs"], str(geo["snapped"]))
            check("nearest named place resolves", geo["nearest"] == "Cancabato Bay", str(geo["nearest"]))
            check("distance maths is sane", geo["distOk"])

            # Denying permission must fall back to the region, not break the page.
            denied = await page.eval("""
                const g = await import('./js/api/geo.js');
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 1 });
                let code = null, msg = '';
                try { await g.getLocation(); } catch (e) { code = e.code; msg = e.message; }
                navigator.geolocation.getCurrentPosition = real;
                return { code, msg };
            """)
            check("refused permission reports 'denied'", denied["code"] == "denied", str(denied))

            await page.goto(f"{BASE}/index.html#/conditions")
            await page.wait_for(
                "document.querySelector('.now-card__temp, .notice--error')",
                timeout=30, label="conditions")
            toggled = await page.eval("""
                const t = document.getElementById('sourceToggle');
                return t ? [...t.querySelectorAll('[data-source]')].map(b => b.dataset.source) : null;
            """)
            check("conditions offers a location toggle",
                  toggled == ["region", "device"], str(toggled))

            # First visit should prompt automatically, like the map does.
            first = await page.eval("""
                const m = await import('./js/store.js');
                const all = m.prefs.all();
                delete all.useMyLocation;
                localStorage.setItem('angler.prefs', JSON.stringify(all));
                return m.prefs.get('useMyLocation', null);
            """)
            check("location choice starts unset", first is None, str(first))

            asked = await page.eval("""
                let prompted = false;
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok) => {
                    prompted = true;
                    ok({ coords: { latitude: 11.238, longitude: 125.004, accuracy: 20 } });
                };
                // Must navigate AWAY first — setting the hash to its current
                // value fires no hashchange, so the page would never re-render.
                location.hash = '#/tips';
                await new Promise(r => setTimeout(r, 400));
                location.hash = '#/conditions';
                await new Promise(r => setTimeout(r, 2500));
                navigator.geolocation.getCurrentPosition = real;
                const m = await import('./js/store.js');
                return { prompted, stored: m.prefs.get('useMyLocation', null),
                         label: document.getElementById('condSource')?.textContent || '' };
            """)
            check("tides ask for location on first visit", asked["prompted"], str(asked))
            check("granting location is remembered", asked["stored"] is True, str(asked))
            check("readout names where you are",
                  "Cancabato" in asked["label"] or "Your location" in asked["label"],
                  asked["label"])

            # An explicit "region" choice must stop it asking again.
            quiet = await page.eval("""
                const m = await import('./js/store.js');
                m.prefs.set('useMyLocation', false);
                let prompted = false;
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok) => { prompted = true; ok({
                    coords: { latitude: 11.238, longitude: 125.004, accuracy: 20 } }); };
                location.hash = '#/tips'; await new Promise(r => setTimeout(r, 400));
                location.hash = '#/conditions'; await new Promise(r => setTimeout(r, 2000));
                navigator.geolocation.getCurrentPosition = real;
                return prompted;
            """)
            check("choosing the region stops the prompting", quiet is False, str(quiet))

            # -------------------------------------------------- map
            print("\nFishing map")
            await page.goto(f"{BASE}/index.html#/map")
            await page.wait_for("document.querySelector('#fishMap .leaflet-tile-pane')",
                                timeout=25, label="leaflet to initialise")
            check("leaflet map initialises", True)

            await asyncio.sleep(1.0)  # let fitBounds settle
            zoomed_out = await page.eval("return document.querySelectorAll('.zone-pin').length;")
            check("pins render at default zoom", zoomed_out > 0, f"got {zoomed_out}")

            # Pins must actually be inside the visible map, not off-screen.
            in_view = await page.eval("""
                const box = document.querySelector('#fishMap').getBoundingClientRect();
                return [...document.querySelectorAll('.zone-pin')].filter(p => {
                    const r = p.getBoundingClientRect();
                    return r.top >= box.top && r.bottom <= box.bottom
                        && r.left >= box.left && r.right <= box.right;
                }).length;
            """)
            check("pins are within the viewport", in_view > 0, f"{in_view} of {zoomed_out} in view")
            await page.shot("map-default")

            # Zooming in must reveal additional zones.
            await page.eval("""
                document.querySelector('#fishMap')._leafletMap.setZoom(12);
                return 1;
            """)
            await asyncio.sleep(1.2)
            zoomed_in = await page.eval("return document.querySelectorAll('.zone-pin').length;")
            check("zooming in reveals more zones", zoomed_in > zoomed_out,
                  f"{zoomed_out} at z9 -> {zoomed_in} at z12")
            await page.shot("map")

            listed = await page.eval("return document.querySelectorAll('[data-zone]').length;")
            check("zone list rendered", listed == 10, f"got {listed}")

            # --- centre-on-me ---
            has_btn = await page.eval("return !!document.getElementById('locateBtn');")
            check("map has a locate button", has_btn)

            # Pretend to be in Cancabato Bay.
            located = await page.eval("""
                const el = document.querySelector('#fishMap');
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok) => ok({
                    coords: { latitude: 11.238, longitude: 125.004, accuracy: 30 }
                });
                await el._locate();
                navigator.geolocation.getCurrentPosition = real;
                const c = el._leafletMap.getCenter();
                return {
                    lat: +c.lat.toFixed(2), lon: +c.lng.toFixed(2),
                    zoom: el._leafletMap.getZoom(),
                    pin: document.querySelectorAll('.you-pin').length,
                    hint: document.getElementById('mapHint').textContent,
                };
            """)
            check("map centres on the reported position",
                  abs(located["lat"] - 11.238) < 0.05 and abs(located["lon"] - 125.004) < 0.05,
                  str(located))
            check("map zooms in when locating", located["zoom"] >= 13, str(located["zoom"]))
            check("your position is marked", located["pin"] == 1, str(located["pin"]))
            check("hint names the nearest zone", "Cancabato" in located["hint"], located["hint"])

            # Far outside the region the map must say so, not look broken.
            far = await page.eval("""
                const el = document.querySelector('#fishMap');
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok) => ok({
                    coords: { latitude: 14.60, longitude: 120.98, accuracy: 40 }
                });
                await el._locate();
                navigator.geolocation.getCurrentPosition = real;
                return document.getElementById('mapHint').textContent;
            """)
            check("far-away position is explained", "no zones nearby" in far, far)

            # Refusing must fall back to the whole of Leyte, not leave the map
            # wherever it happened to be sitting.
            refused = await page.eval("""
                const el = document.querySelector('#fishMap');
                const d = await import('./js/data/index.js');
                const b = d.getRegion('leyte-gulf').map.bounds;
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 1 });
                await el._locate();
                navigator.geolocation.getCurrentPosition = real;
                const m = el._leafletMap;
                const v = m.getBounds();
                return {
                    usable: !!m && document.querySelectorAll('.zone-pin').length > 0,
                    // The view must span the island, not a 5km box.
                    coversWest: v.getWest() <= b.west + 0.4,
                    coversEast: v.getEast() >= b.east - 0.4,
                    coversNorth: v.getNorth() >= b.north - 0.4,
                    coversSouth: v.getSouth() <= b.south + 0.4,
                    zoom: m.getZoom(),
                };
            """)
            check("refused location leaves the map usable", refused["usable"])
            check("refused location shows the whole of Leyte",
                  all(refused[k] for k in ("coversWest", "coversEast", "coversNorth", "coversSouth")),
                  str(refused))

            # Map pins must stay horizontal — angled art aliases badly at 34px.
            pin = await page.eval("""
                const p = await import('./js/pixel.js');
                const svg = document.querySelector('.zone-pin svg');
                if (!svg) return null;
                const v = svg.getAttribute('viewBox').split(' ');
                const g = p.SPRITES.perch;
                return { pin: `${v[2]}x${v[3]}`, sprite: `${g[0].length}x${g.length}` };
            """)
            check("map pins use the horizontal sprite",
                  pin and pin["pin"] == pin["sprite"], str(pin))

            await page.eval("return document.querySelector('[data-zone]').click(), 1;")
            await asyncio.sleep(0.5)
            sheet_txt = await page.eval("""
                const s = document.querySelector('.sheet');
                return s ? s.innerText : '';
            """)
            check("zone sheet shows species",
                  "Possible catches in these waters" in sheet_txt, sheet_txt[:120])
            check("zone sheet shows lures", "Bring these" in sheet_txt, sheet_txt[:120])
            check("zone sheet shows habitat advice",
                  "Fishing this water" in sheet_txt, sheet_txt[:120])
            # The sheet must actually sit above the map. Leaflet's panes reach
            # z-index 1000, so a hit-test is the only honest check here.
            on_top = await page.eval("""
                const sheet = document.querySelector('.sheet');
                const r = sheet.getBoundingClientRect();
                const pts = [[r.left + r.width/2, r.top + 30],
                             [r.left + r.width/2, r.top + r.height/2],
                             [r.left + 20,        r.top + r.height - 30]];
                return pts.every(([x, y]) => {
                    const el = document.elementFromPoint(x, y);
                    return el && (el.closest('.sheet-backdrop') !== null);
                });
            """)
            check("sheet renders above the map", on_top,
                  "map panes are painting over the modal")

            tabbar_ok = await page.eval("""
                const t = document.querySelector('.tabbar a');
                const r = t.getBoundingClientRect();
                const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
                return el ? (el.closest('.tabbar') !== null
                          || el.closest('.sheet-backdrop') !== null) : false;
            """)
            check("tab bar not covered by map", tabbar_ok)

            await page.shot("map-zone-sheet", full=False)
            await page.eval("""
                document.querySelector('.sheet').scrollTop = 420;
                return 1;
            """)
            await asyncio.sleep(0.3)
            await page.shot("map-zone-sheet-scrolled", full=False)

            # -------------------------------------------------- cleanup
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelector('.kpi__v')", label="log")
            await page.eval("const m = await import('./js/store.js'); await m.store.clearCatches(); return 1;")

    finally:
        proc.terminate()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED: " + ", ".join(FAIL))
        sys.exit(1)


static_checks()
asyncio.run(main())
