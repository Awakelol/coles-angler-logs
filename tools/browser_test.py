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
            await page.shot("species-detail")

            fb = await page.eval("""
                const a = [...document.querySelectorAll('.sheet a')].find(x => x.href.includes('fishbase'));
                return a ? a.href : '';
            """)
            check("fishbase link built", "fishbase.se/summary/" in fb and "-" in fb, fb)

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


asyncio.run(main())
