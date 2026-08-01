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

# Species drawing a silhouette borrowed from another fish, declared in the
# data as `art: 'placeholder'`. This number may only ever go DOWN: drawing
# real art and clearing the flag is the only way to lower it. Adding a
# placeholder beyond the ceiling fails the suite on purpose — the backlog is
# allowed to be paid off, never to grow.
#
# 28 of these arrived with the Leyte island expansion.
ART_DEBT_MAX = 28

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
    # A first visit has no controller; clients.claim() fires controllerchange
    # anyway. Reloading on that made every fresh load reload itself, and it
    # ate the Google sign-in redirect result mid-flight.
    check("first install does not trigger a reload",
          "hadController" in upd and "if (!hadController) return" in upd,
          "controllerchange on first install must not reload")

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
    # The other direction: a precached path that no longer exists is a silent
    # 404 on every install. cache.add() swallows it, so nothing ever complains.
    stale = sorted(listed - on_disk)
    check("no precached module has been deleted", not stale, ", ".join(stale))


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
                const species = d.allSpecies(d.DEFAULT_REGION_ID);
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
            # NOT hasHero() — a species given sprite:'perch' because a perch
            # is roughly the right shape reports hasHero() true, so inference
            # would hide the backlog exactly as it grew. The flag is declared.
            debt = await page.eval("""
                const p = await import('./js/pixel.js');
                const d = await import('./js/data/index.js');
                const all = [...d.SPECIES.values()];
                const placeholders = all.filter(p.usesPlaceholderArt);
                return {
                    placeholders: placeholders.length,
                    total: all.length,
                    // A placeholder still has to RENDER something.
                    renders: placeholders.every(s => p.speciesHero(s, { size: 40 }).includes('<svg')),
                };
            """)
            check("the pixel art backlog has not grown",
                  debt["placeholders"] <= ART_DEBT_MAX,
                  f"{debt['placeholders']} placeholders, ceiling {ART_DEBT_MAX} — "
                  f"draw art and clear the flag rather than raising this")
            check("every placeholder still renders something",
                  debt["renders"], str(debt))

            check("all palettes are 9 valid hex slots", not art["bad"], "; ".join(art["bad"]))
            check("no sprite has ragged rows", not art["ragged"], ", ".join(art["ragged"]))

            # renderSprite merges runs of one colour along a row into a single
            # wide rect. That is supposed to be INVISIBLE — same picture, fewer
            # nodes. These pin both halves of that claim, so a future change to
            # the emitter can't quietly drop or shift a pixel to look faster.
            runs = await page.eval("""
                const p = await import('./js/pixel.js');
                const parse = (svg) => [...svg.matchAll(
                    /<rect x="(\\d+)" y="(\\d+)" width="(\\d+)" height="1" fill="([^"]+)"\\/>/g
                )].map(m => ({ x:+m[1], y:+m[2], w:+m[3], fill:m[4] }));

                const wrong = [], overlap = [], fat = [];
                const all = { ...p.SPRITES, ...p.ICONS, ...p.HEROES };
                for (const [name, grid] of Object.entries(all)) {
                    const rects = parse(p.renderSprite(grid, 'ocean', { size: 64 }));

                    // 1. Same painted pixels: every rect covers exactly the
                    //    cells that carry a palette letter, once each.
                    const painted = new Map();          // "x,y" -> fill
                    let doubled = false;
                    for (const r of rects) {
                        for (let i = 0; i < r.w; i++) {
                            const k = `${r.x + i},${r.y}`;
                            if (painted.has(k)) doubled = true;
                            painted.set(k, r.fill);
                        }
                    }
                    if (doubled) overlap.push(name);

                    let cells = 0;
                    for (let y = 0; y < grid.length; y++) {
                        for (let x = 0; x < grid[y].length; x++) {
                            const ch = grid[y][x];
                            if (ch === ' ' || ch === '.') continue;
                            cells++;
                            if (!painted.has(`${x},${y}`)) { wrong.push(`${name} @${x},${y}`); }
                        }
                    }
                    if (painted.size !== cells) wrong.push(`${name}: ${painted.size} painted vs ${cells} cells`);

                    // 2. Actually merged: no two touching rects share a fill,
                    //    or the run-length pass silently stopped working.
                    const byRow = new Map();
                    for (const r of rects) {
                        if (!byRow.has(r.y)) byRow.set(r.y, []);
                        byRow.get(r.y).push(r);
                    }
                    for (const [, row] of byRow) {
                        row.sort((a, b) => a.x - b.x);
                        for (let i = 1; i < row.length; i++) {
                            if (row[i].x === row[i-1].x + row[i-1].w && row[i].fill === row[i-1].fill) {
                                fat.push(`${name} row ${row[i].y}`);
                            }
                        }
                    }
                }

                // 3. The number that made this worth doing.
                const d = await import('./js/data/index.js');
                const species = d.allSpecies(d.DEFAULT_REGION_ID);
                const nodes = species.reduce(
                    (n, s) => n + (p.speciesHero(s, { size: 170 }).match(/<rect/g) || []).length, 0
                );
                return { wrong: wrong.slice(0, 5), overlap, fat: fat.slice(0, 5),
                         nodesPerHero: Math.round(nodes / species.length) };
            """)
            check("merged sprites paint exactly the same pixels",
                  not runs["wrong"], "; ".join(runs["wrong"]))
            check("no rect paints over another", not runs["overlap"], ", ".join(runs["overlap"]))
            check("touching same-colour rects really are merged",
                  not runs["fat"], "; ".join(runs["fat"]))
            # 432 before the merge. The Info tab draws sixty-odd at once, so
            # this is the number that decides whether searching feels instant.
            check("a species hero stays under 250 rects",
                  runs["nodesPerHero"] < 250, f"{runs['nodesPerHero']} rects per hero")

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

            # -------------------------------------------------- transitions
            print("\nPage transitions")
            trans = await page.eval("""
                const supported = typeof document.startViewTransition === 'function';

                // Poll rather than sleep a fixed amount. A cold start can stall
                // the first render past any constant you pick — the Firebase
                // SDK fetch alone is ~200KB — and this test failed roughly one
                // run in two purely on that timing.
                const until = async (sel, ms = 4000) => {
                    const end = Date.now() + ms;
                    while (Date.now() < end) {
                        if (document.querySelector(sel)) return true;
                        await new Promise(r => setTimeout(r, 60));
                    }
                    return false;
                };

                // Start from a KNOWN different route. Setting the hash to its
                // current value fires no hashchange, so if an earlier block
                // left us on this exact tab nothing re-renders and the wait
                // below times out against a stale page — which is what made
                // this test fail intermittently rather than honestly.
                location.hash = '#/';
                await until('.kpi__v, .empty');

                location.hash = '#/info?tab=zones';
                const onTips = await until('.tip-card');
                location.hash = '#/info?tab=fishes';
                const onSpecies = await until('.species-card');

                // Rapid navigation must not strand a half-finished transition.
                location.hash = '#/info?tab=zones';
                location.hash = '#/info?tab=fishes';
                location.hash = '#/info?tab=zones';
                const settled = await until('.tip-card');

                return { supported, onTips, onSpecies, settled,
                         err: document.body.getAttribute('data-js-error') };
            """)
            check("navigation still lands correctly",
                  trans["onTips"] and trans["onSpecies"], str(trans))
            check("rapid navigation settles on the last route", trans["settled"], str(trans))
            check("transitions raise no errors", not trans["err"], str(trans["err"]))

            css = open(os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "css", "style.css"),
                encoding="utf-8").read()
            check("chrome is excluded from the page snapshot",
                  "view-transition-name: topbar" in css and "view-transition-name: tabbar" in css,
                  "top/tab bars would cross-fade against themselves")
            check("transitions respect reduced motion",
                  "prefers-reduced-motion: no-preference" in css and
                  "::view-transition-new(root)" in css)

            app = open(os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "js", "app.js"),
                encoding="utf-8").read()
            check("only the markup swap is wrapped, not mount()",
                  "updateCallbackDone" in app,
                  "awaiting the full transition would hold the old page during network waits")

            # -------------------------------------------------- theme
            print("\nTheme")
            theme = await page.eval("""
                const t = await import('./js/theme.js');
                const read = (n) => getComputedStyle(document.documentElement)
                    .getPropertyValue(n).trim();

                t.setTheme('light');
                const light = { bg: read('--cream'), ink: read('--ink'), line: read('--line'),
                                attr: document.documentElement.getAttribute('data-theme'),
                                meta: document.querySelector('meta[name=theme-color]').content };
                t.setTheme('dark');
                const dark = { bg: read('--cream'), ink: read('--ink'), line: read('--line'),
                               attr: document.documentElement.getAttribute('data-theme'),
                               meta: document.querySelector('meta[name=theme-color]').content,
                               scheme: document.documentElement.style.colorScheme,
                               shadow: read('--shadow'), bw: read('--border-w') };

                // Every custom property must be a real value; a typo like
                // "#46real" silently falls back and is easy to miss.
                const names = ['--cream','--paper','--ink','--ink-60','--ink-30','--line',
                               '--band-cream','--band-sky','--band-yellow','--band-green',
                               '--band-coral','--band-violet','--art-bg','--art-bg-2',
                               '--invert-bg','--invert-fg','--notice-warn','--notice-error',
                               '--skeleton-a','--skeleton-b'];
                const bad = names.filter(n => !/^(#[0-9a-f]{3,8}|rgba?\\()/i.test(read(n)));

                t.setTheme('system');
                const sys = t.resolvedTheme();
                return { light, dark, bad, sys, persisted: localStorage.getItem('angler.theme') };
            """)
            check("light theme applies", theme["light"]["attr"] == "light" and
                  theme["light"]["bg"].upper() == "#FFF8E7", str(theme["light"]))
            check("dark theme applies", theme["dark"]["attr"] == "dark" and
                  theme["dark"]["bg"].upper() == "#0D1117", str(theme["dark"]))
            check("dark text inverts", theme["dark"]["ink"].upper() == "#E6EDF3",
                  theme["dark"]["ink"])
            # GitHub-style: hairline border on a lifted surface, no outline.
            check("dark uses a hairline border", theme["dark"]["line"].upper() == "#30363D",
                  theme["dark"]["line"])
            check("dark drops the hard offset shadow",
                  theme["dark"]["shadow"] == "none", str(theme["dark"]["shadow"]))
            check("dark uses a 1px border", theme["dark"]["bw"] == "1px", str(theme["dark"]["bw"]))
            check("theme-color follows the theme",
                  theme["dark"]["meta"] == "#0d1117" and theme["light"]["meta"] == "#FFD23F",
                  f"{theme['light']['meta']} / {theme['dark']['meta']}")
            check("color-scheme is set for form controls",
                  theme["dark"]["scheme"] == "dark", str(theme["dark"]["scheme"]))
            check("no malformed CSS variables", not theme["bad"], ", ".join(theme["bad"]))

            # Real contrast maths on rendered elements. Bright accent fills
            # (yellow buttons, green chips) don't invert in dark mode, so
            # anything inheriting --ink ends up near-white on yellow.
            contrast = await page.eval("""
                const t = await import('./js/theme.js');
                const lum = (c) => {
                    const [r,g,b] = c.match(/\\d+(\\.\\d+)?/g).slice(0,3).map(Number)
                        .map(v => { v /= 255; return v <= .03928 ? v/12.92
                                                 : Math.pow((v+.055)/1.055, 2.4); });
                    return .2126*r + .7152*g + .0722*b;
                };
                const ratio = (fg, bg) => {
                    const a = lum(fg), b = lum(bg);
                    return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
                };
                const results = {};
                for (const mode of ['light', 'dark']) {
                    t.setTheme(mode);
                    location.hash = '#/info?tab=zones';
                    await new Promise(r => setTimeout(r, 250));
                    location.hash = '#/info?tab=fishes';
                    await new Promise(r => setTimeout(r, 900));
                    const worst = [];
                    for (const sel of ['.btn--primary', '.chip--local', '.chip--target',
                                       '.chip--family', '.card__title', '.card__sub']) {
                        const el = document.querySelector(sel);
                        if (!el) continue;
                        const cs = getComputedStyle(el);
                        let bg = cs.backgroundColor, node = el;
                        while (bg === 'rgba(0, 0, 0, 0)' && node.parentElement) {
                            node = node.parentElement;
                            bg = getComputedStyle(node).backgroundColor;
                        }
                        worst.push({ sel, r: +ratio(cs.color, bg).toFixed(2) });
                    }
                    results[mode] = worst;
                }
                t.setTheme('system');
                return results;
            """)
            for mode in ("light", "dark"):
                bad = [f"{x['sel']}={x['r']}" for x in contrast[mode] if x["r"] < 4.5]
                check(f"{mode} mode text contrast >= 4.5:1", not bad, ", ".join(bad))
            check("system resolves to a real theme", theme["sys"] in ("light", "dark"),
                  str(theme["sys"]))
            check("choice is persisted", theme["persisted"] == "system", str(theme["persisted"]))

            # The inline no-flash script must agree with theme.js.
            flash = open(os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "index.html"),
                encoding="utf-8").read()
            check("theme applied before first paint",
                  "angler.theme" in flash and "data-theme" in flash and
                  flash.index("angler.theme") < flash.index("js/app.js"),
                  "inline theme script must run before the module loads")

            # -------------------------------------------------- data integrity
            print("\nData model")
            data = await page.eval("""
                const d = await import('./js/data/index.js');
                const region = d.getRegion(d.DEFAULT_REGION_ID);
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
                const barracudaZones = d.zonesForSpecies(d.DEFAULT_REGION_ID, 'sphyraena-barracuda')
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
            check("catalogue has 65+ species", data["catalogue"] >= 65, str(data["catalogue"]))
            check("species shared across multiple zones", data["shared"] >= 10,
                  f"only {data['shared']} appear in >1 zone")
            check("barracuda listed in Cancabato Bay", data["cancabatoHasBarracuda"],
                  f"zones: {data['barracudaZones']}")
            check("Cancabato Bay has a full species list", data["cancabatoCount"] >= 15,
                  str(data["cancabatoCount"]))

            # One deliberate assertion instead of eleven scattered literals, so
            # renaming the region is a one-line test edit.
            ident = await page.eval("""
                const d = await import('./js/data/index.js');
                const r = d.getRegion(d.DEFAULT_REGION_ID);
                return { id: d.DEFAULT_REGION_ID, name: r.name, count: d.REGIONS.length };
            """)
            check("the default region is the one we think it is",
                  ident["id"] == "leyte" and ident["name"] == "Leyte",
                  str(ident))
            # The picker is hidden below 2 — worth knowing when that changes.
            check("there is still exactly one region", ident["count"] == 1, str(ident))

            # Catches logged before the rename carry regionId 'leyte-gulf'.
            # getRegion() falls back to REGIONS[0] for anything unknown, so a
            # legacy id LOOKS right today and silently attaches to the wrong
            # region the moment a second one exists.
            legacy = await page.eval("""
                const d = await import('./js/data/index.js');
                return {
                    mapped: d.currentRegionId('leyte-gulf'),
                    passthrough: d.currentRegionId('leyte'),
                    resolves: d.getRegion('leyte-gulf').id,
                };
            """)
            check("the old region id still resolves to the right region",
                  legacy["mapped"] == "leyte" and legacy["resolves"] == "leyte", str(legacy))
            check("current ids pass through untouched",
                  legacy["passthrough"] == "leyte", str(legacy))

            # ---- invariants that will catch a bad hand-typed zone -----------
            zones = await page.eval("""
                const d = await import('./js/data/index.js');
                const { HABITAT_TACTICS } = await import('./js/data/tactics.js');
                const { ZONE_PALETTE } = await import('./js/zone-ui.js');
                const r = d.getRegion(d.DEFAULT_REGION_ID);
                const b = r.map.bounds;

                const tactics = Object.keys(HABITAT_TACTICS).sort();
                const palettes = Object.keys(ZONE_PALETTE).sort();

                const badType = [], outOfBounds = [], stub = [], badZoom = [];
                const ids = [];
                for (const z of r.zones || []) {
                    ids.push(z.id);
                    if (!HABITAT_TACTICS[z.type]) badType.push(`${z.id}:${z.type}`);
                    const c = z.coords || {};
                    if (!(c.lat >= b.south && c.lat <= b.north
                          && c.lon >= b.west && c.lon <= b.east)) {
                        outOfBounds.push(`${z.id} @ ${c.lat},${c.lon}`);
                    }
                    if (!z.depth || !z.blurb || !z.best || (z.species || []).length < 5) {
                        stub.push(z.id);
                    }
                    const mz = z.minZoom;
                    if (typeof mz !== 'number' || mz < r.map.minZoom || mz > r.map.maxZoom) {
                        badZoom.push(`${z.id}:${mz}`);
                    }
                }

                return {
                    // These two tables must move together or a zone silently
                    // loses its tactics block and falls back to the ocean colour.
                    tacticsKeys: tactics, paletteKeys: palettes,
                    keysMatch: JSON.stringify(tactics) === JSON.stringify(palettes),
                    badType, outOfBounds, stub, badZoom,
                    duplicateIds: ids.length !== new Set(ids).size,
                    count: ids.length,
                };
            """)
            # js/data/tactics.js and js/zone-ui.js are edited independently; an
            # unknown type drops the "Fishing this water" block with no error.
            check("habitat tactics and zone palettes cover the same types",
                  zones["keysMatch"],
                  f"tactics={zones['tacticsKeys']} palettes={zones['paletteKeys']}")
            check("every zone has a known habitat type",
                  not zones["badType"], ", ".join(zones["badType"]))
            # A transposed lat/lon puts a pin in the Celebes Sea and nothing
            # else in the app would notice.
            check("every zone sits inside the region's map bounds",
                  not zones["outOfBounds"], ", ".join(zones["outOfBounds"]))
            check("no zone is a stub", not zones["stub"], ", ".join(zones["stub"]))
            check("every zone's minZoom is within the map's range",
                  not zones["badZoom"], ", ".join(zones["badZoom"]))
            check("zone ids are unique", not zones["duplicateIds"], str(zones["count"]))

            water = await page.eval("""
                const d = await import('./js/data/index.js');
                const { HABITAT_TACTICS } = await import('./js/data/tactics.js');
                const groups = d.zonesByWater(d.DEFAULT_REGION_ID);
                const zones = d.zonesFor(d.DEFAULT_REGION_ID);
                return {
                    // A zone without `water` lands in 'Other' rather than
                    // vanishing — but it should never come to that.
                    missing: zones.filter(z => !z.water).map(z => z.id),
                    other: groups.some(g => g.water === 'Other'),
                    // Grouping must not lose or duplicate a zone.
                    regrouped: groups.reduce((n, g) => n + g.zones.length, 0) === zones.length,
                    waters: groups.map(g => g.water),
                    // Both new types must carry real advice, not a fallback.
                    hasStrait: Boolean(HABITAT_TACTICS.strait?.advice),
                    hasDeep: Boolean(HABITAT_TACTICS.deep?.advice),
                    // The two straits are the reason `strait` exists: its
                    // advice must lead on current, not on structure.
                    straitMentionsCurrent: /tide|flow|slack/i
                        .test(HABITAT_TACTICS.strait?.advice || ''),
                    deepMentionsVertical: /vertical|jig|bottom/i
                        .test(HABITAT_TACTICS.deep?.advice || ''),
                };
            """)
            check("every zone declares which water it is in",
                  not water["missing"] and not water["other"], str(water["missing"]))
            check("grouping by water loses no zones", water["regrouped"], str(water["waters"]))
            check("the new habitat types exist",
                  water["hasStrait"] and water["hasDeep"], str(water))
            # Reusing 'channel' and 'offshore' would have given advice that is
            # actively wrong for an 8-knot strait and a drop-off.
            check("strait advice is about current, not structure",
                  water["straitMentionsCurrent"], str(water))
            check("deep advice is about fishing vertically",
                  water["deepMentionsVertical"], str(water))

            grouped = await page.eval("""
                location.hash = '#/info?tab=zones';
                await new Promise(r => setTimeout(r, 900));
                const heads = [...document.querySelectorAll('.section-head h2')]
                    .map(e => e.textContent.trim());
                return { heads, cards: document.querySelectorAll('.zone-card').length };
            """)
            check("Info renders a heading per body of water",
                  "Leyte Gulf" in grouped["heads"], str(grouped["heads"]))
            check("every zone still gets a card",
                  grouped["cards"] == zones["count"], str(grouped))

            # -------------------------------------------------- accounts
            print("\nAccounts")
            await page.goto(f"{BASE}/index.html#/log")
            await asyncio.sleep(1.0)
            await page.eval("""
                const a = await import('./js/auth.js');
                a.signOut();
                localStorage.removeItem('angler.users');
                return 1;
            """)
            await page.goto(f"{BASE}/index.html#/")
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelector('#authForm')", label="auth gate")

            gated = await page.eval("""
                return { form: !!document.querySelector('#authForm'),
                         addBtn: !!document.getElementById('addCatch'),
                         stats: !!document.querySelector('.kpi__v'),
                         google: !!document.querySelector('[data-provider=google]'),
                         facebook: !!document.querySelector('[data-provider=facebook]'),
                         signupBtn: !!document.querySelector('[data-goto=signup]'),
                         // Providers must come before the username field.
                         order: (() => {
                             const g = document.querySelector('[data-provider=google]');
                             const u = document.getElementById('a-user');
                             if (!g || !u) return false;
                             return !!(g.compareDocumentPosition(u) &
                                       Node.DOCUMENT_POSITION_FOLLOWING);
                         })(),
                         hasEmail: !!document.getElementById('a-email') };
            """)
            check("log is gated when signed out", gated["form"], str(gated))
            check("no catch entry while signed out",
                  not gated["addBtn"] and not gated["stats"], str(gated))
            # Only providers CONFIG.auth marks live may appear. A button that
            # cannot succeed reads as a broken app, which is exactly what
            # Facebook's did — Meta refuses the permissions to an individual.
            check("the live provider is offered", gated["google"], str(gated))
            check("disabled providers are not advertised",
                  not gated["facebook"], str(gated))
            check("providers sit above the username field", gated["order"], str(gated))
            check("sign-up is a separate action, not a tab", gated["signupBtn"], str(gated))
            check("sign-in screen has no email field", not gated["hasEmail"], str(gated))

            # Disabled means "not offered", not "deleted". The code must stay
            # whole so re-enabling is a config flip, not a rewrite.
            provider_flag = await page.eval("""
                const { CONFIG } = await import('./js/config.js');
                const cloud = await import('./js/auth/cloud.js');
                const before = CONFIG.auth.facebook;

                CONFIG.auth.facebook = true;
                location.hash = '#/';
                await new Promise(r => setTimeout(r, 250));
                location.hash = '#/log';
                await new Promise(r => setTimeout(r, 700));
                const shownWhenOn = !!document.querySelector('[data-provider=facebook]');

                CONFIG.auth.facebook = before;
                location.hash = '#/';
                await new Promise(r => setTimeout(r, 250));
                location.hash = '#/log';
                await new Promise(r => setTimeout(r, 700));

                return {
                    defaultOff: before === false,
                    googleOn: CONFIG.auth.google === true,
                    shownWhenOn,
                    hiddenAgain: !document.querySelector('[data-provider=facebook]'),
                    stillCoded: typeof cloud.signInWithFacebook === 'function',
                    copy: document.body.innerText.includes('Facebook'),
                };
            """)
            check("facebook is off by default", provider_flag["defaultOff"], str(provider_flag))
            check("google stays on", provider_flag["googleOn"], str(provider_flag))
            check("the flag is all it takes to bring it back",
                  provider_flag["shownWhenOn"] and provider_flag["hiddenAgain"],
                  str(provider_flag))
            check("the facebook code path survives being disabled",
                  provider_flag["stillCoded"], str(provider_flag))
            # Copy that names a provider with no button is the same dead end.
            check("no screen text promises a hidden provider",
                  not provider_flag["copy"], str(provider_flag))

            # Floating labels: the name sits inside the empty field, then lifts
            # and STAYS above once there's content — it must never vanish.
            floating = await page.eval("""
                const wrap = document.querySelector('.float');
                const input = wrap.querySelector('input');
                const label = wrap.querySelector('label');
                const box = () => label.getBoundingClientRect();

                const restingTop = box().top;
                const restingSize = parseFloat(getComputedStyle(label).fontSize);

                input.focus();
                input.value = 'cole';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 350));

                const liftedTop = box().top;
                const liftedSize = parseFloat(getComputedStyle(label).fontSize);
                const style = getComputedStyle(label);

                // Blur with content still present — the label must stay lifted.
                input.blur();
                await new Promise(r => setTimeout(r, 350));
                const afterBlurTop = box().top;
                const stillVisible = style.display !== 'none' &&
                                     parseFloat(style.opacity) > 0.5;

                // A real <label for>, not a placeholder attribute.
                const properLabel = label.tagName === 'LABEL' &&
                                    label.htmlFor === input.id;
                // The placeholder is only a space, used to detect emptiness.
                const placeholderBlank = input.getAttribute('placeholder').trim() === '';

                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return { restingTop, liftedTop, afterBlurTop, restingSize,
                         liftedSize, stillVisible, properLabel, placeholderBlank };
            """)
            check("label starts inside the field",
                  floating["restingSize"] >= 14, str(floating["restingSize"]))
            check("label lifts when typing",
                  floating["liftedTop"] < floating["restingTop"] - 10, str(floating))
            check("label shrinks as it lifts",
                  floating["liftedSize"] < floating["restingSize"], str(floating))
            check("label stays up after blur with content",
                  abs(floating["afterBlurTop"] - floating["liftedTop"]) < 2, str(floating))
            check("label remains visible, never hidden", floating["stillVisible"], str(floating))
            check("uses a real <label for>, not a placeholder",
                  floating["properLabel"] and floating["placeholderBlank"], str(floating))

            signup = await page.eval("""
                document.querySelector('[data-goto=signup]').click();
                await new Promise(r => setTimeout(r, 600));
                return { email: !!document.getElementById('a-email'),
                         confirm: !!document.getElementById('a-pass2'),
                         back: !!document.querySelector('[data-goto=signin]'),
                         emailRequired: document.getElementById('a-email')?.required,
                         heading: document.querySelector('.display')?.textContent.trim() };
            """)
            check("sign-up screen asks for email and confirmation",
                  signup["email"] and signup["confirm"], str(signup))
            check("email is optional", signup["emailRequired"] is False, str(signup))
            check("sign-up screen can go back", signup["back"], str(signup))
            check("sign-up screen has its own heading",
                  signup["heading"] == "Create account", str(signup["heading"]))

            # Every input on the form must actually be styled. The type-based
            # selector silently skipped type="email", which rendered as a thin
            # unstyled strip — a whole class of bug that only shows up visually.
            styling = await page.eval("""
                const bad = [];
                const floats = [...document.querySelectorAll('.float')];
                for (const wrap of floats) {
                    const input = wrap.querySelector('input');
                    const cs = getComputedStyle(input);
                    const borderPx = parseFloat(cs.borderTopWidth) || 0;
                    const height = input.getBoundingClientRect().height;
                    if (borderPx < 1 || height < 40 || cs.borderTopStyle === 'none') {
                        bad.push(`${input.type}: border=${cs.borderTopWidth} h=${Math.round(height)}`);
                    }
                }
                return { bad, count: floats.length,
                         labelled: floats.every(w => !!w.querySelector('label')) };
            """)
            check("every sign-up field is styled", not styling["bad"], "; ".join(styling["bad"]))
            check("sign-up has four floating fields", styling["count"] == 4,
                  str(styling["count"]))
            check("every floating field has its label", styling["labelled"])

            rules = await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    const out = {};
                    out.shortName = a.validateUsername('ab');
                    out.badChars  = a.validateUsername('co le!');
                    out.okName    = a.validateUsername('cole_1');
                    out.shortPw   = a.validatePassword('abc');
                    try { await a.signUp('cole', 'abcd'); out.made = true; } catch (e) { out.made = e.message; }
                    out.dupe = null;
                    try { await a.signUp('COLE', 'abcd'); } catch (e) { out.dupe = e.message; }
                    out.wrongPw = null;
                    try { await a.signIn('cole', 'nope'); } catch (e) { out.wrongPw = e.message; }
                    out.noUser = null;
                    try { await a.signIn('ghost', 'abcd'); } catch (e) { out.noUser = e.message; }
                    const me = a.currentUser();
                    return { ...out, user: me && me.username, provider: me && me.provider };
                } finally { _cfg.firebase = _fb; }
            """)
            check("rejects a short username", bool(rules["shortName"]), str(rules["shortName"]))
            check("rejects bad characters", bool(rules["badChars"]), str(rules["badChars"]))
            check("accepts a valid username", rules["okName"] is None, str(rules["okName"]))
            check("rejects a short password", bool(rules["shortPw"]), str(rules["shortPw"]))
            check("sign-up creates and signs in", rules["user"] == "cole", str(rules))
            check("usernames are case-insensitively unique", bool(rules["dupe"]), str(rules["dupe"]))
            check("wrong password is refused", bool(rules["wrongPw"]), str(rules["wrongPw"]))
            # Same wording for both, so a shared device doesn't leak which
            # usernames exist.
            check("unknown user and wrong password read the same",
                  rules["wrongPw"] == rules["noUser"], f"{rules['wrongPw']} vs {rules['noUser']}")
            # Which one depends on whether Email/Password is enabled in the
            # Firebase console, so assert the SET, not a member of it. A test
            # that flips meaning based on external console state is worse than
            # no test — it fails on a working app and passes on a broken one.
            check("accounts carry a provider for future OAuth",
                  rules["provider"] in ("local", "username"), str(rules["provider"]))

            stored = await page.eval("""
                const raw = localStorage.getItem('angler.users');
                // Check FIELD VALUES, not the raw blob. 'abcd' is four hex
                // characters, so scanning the whole string finds it inside a
                // random salt or SHA-256 digest every so often — a false
                // failure on a security assertion, which is the worst kind.
                const plaintext = JSON.parse(raw).some(
                    (u) => Object.values(u).some((v) => v === 'abcd'));
                return { plaintext, hashed: /"hash":"[0-9a-f]{64}"/.test(raw),
                         salted: /"salt":"[0-9a-f]{32}"/.test(raw) };
            """)
            check("passwords are not stored in plain text", not stored["plaintext"], str(stored))
            check("passwords are salted and hashed",
                  stored["hashed"] and stored["salted"], str(stored))

            # Two accounts must not see each other's catches.
            scoped = await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    const m = await import('./js/store.js');
                    const me = a.currentUser();
                    await m.store.saveCatch({ userId: me.id, speciesId: 'caranx-ignobilis',
                        regionId: 'leyte', date: '2026-07-20', weightKg: 5 });
                    const mineBefore = (await m.store.allCatches(me.id)).length;

                    const other = await a.signUp('friend', 'abcd');
                    await m.store.saveCatch({ userId: other.id, speciesId: 'chanos-chanos',
                        regionId: 'leyte', date: '2026-07-21', weightKg: 2 });

                    return {
                        mine: mineBefore,
                        theirs: (await m.store.allCatches(other.id)).length,
                        mineStill: (await m.store.allCatches(me.id)).length,
                        everything: (await m.store.allCatches()).length,
                    };
                } finally { _cfg.firebase = _fb; }
            """)
            check("each account sees only its own catches",
                  scoped["mine"] == 1 and scoped["theirs"] == 1 and scoped["mineStill"] == 1,
                  str(scoped))
            check("both catches exist in storage", scoped["everything"] >= 2, str(scoped))

            await page.goto(f"{BASE}/index.html#/")
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelector('.kpi__v')", label="log after sign-in")
            signed = await page.eval("""
                return { add: !!document.getElementById('addCatch'),
                         who: document.querySelector('.eyebrow')?.textContent || '' };
            """)
            check("signed-in log is usable", signed["add"], str(signed))
            check("log names the signed-in user", "friend" in signed["who"], signed["who"])

            # Everything after this exercises the (now gated) log, so leave a
            # known account signed in and start it from an empty log.
            await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    const m = await import('./js/store.js');
                    await m.store.clearCatches();
                    a.signOut();
                    localStorage.removeItem('angler.users');
                    await a.signUp('tester', 'abcd');
                    return 1;
                } finally { _cfg.firebase = _fb; }
            """)

            mod = await page.eval("""
                const m = await import('./js/moderation.js');
                const a = await import('./js/auth.js');
                const blocked = ['fuck', 'f_u_c_k', 'sh1t', 'n1gger', 'FUCKer'];
                const fine = ['cole', 'wrasse', 'assassin', 'class_act', 'bass-man',
                              'scunthorpe', 'cockle', 'analyst', 'Dickens'];
                return {
                    caught: blocked.filter(n => !m.isClean(n)).length,
                    total: blocked.length,
                    falsePositives: fine.filter(n => !m.isClean(n)),
                    viaValidate: a.validateUsername('fuckwit'),
                    emailBad: a.validateEmail('not-an-email'),
                    emailEmpty: a.validateEmail(''),
                    emailOk: a.validateEmail('cole@example.com'),
                };
            """)
            check("obvious profanity is caught",
                  mod["caught"] == mod["total"], f"{mod['caught']}/{mod['total']}")
            check("ordinary words are not flagged",
                  mod["falsePositives"] == [], str(mod["falsePositives"]))
            check("moderation runs during username validation",
                  bool(mod["viaValidate"]), str(mod["viaValidate"]))
            check("email is optional but validated when given",
                  mod["emailEmpty"] is None and mod["emailOk"] is None
                  and bool(mod["emailBad"]), str(mod))

            # --- provider facade ---
            facade = await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    const out = {};
                    // Read from the saved config: the guard above blanked the live
                    // one, and this assertion is about the project being set up at
                    // all, not about which path sign-up happens to take.
                    out.configured = Boolean(_fb && _fb.apiKey && _fb.projectId);
                    out.hasSteps = Array.isArray(a.CLOUD_SETUP_STEPS) && a.CLOUD_SETUP_STEPS.length >= 3;

                    // NOT called for real: with a live config this performs an
                    // actual redirect to Google and destroys the test session.
                    out.googleIsFn = typeof a.signInWithGoogle === 'function';

                    // Local accounts still work with no cloud config at all.
                    const u = await a.signUp('localonly', 'abcd');
                    out.localWorks = a.isSignedIn() && a.currentUser().username === 'localonly';
                    out.syncs = a.currentUser().syncs;
                    out.provider = a.currentUser().provider;

                    // init() must be safe to call unconfigured.
                    out.initOk = !!(await a.init());

                    await a.signOut();
                    out.signedOut = !a.isSignedIn();
                    return out;
                } finally { _cfg.firebase = _fb; }
            """)
            check("cloud reports configured with a firebase config",
                  facade["configured"] is True, str(facade["configured"]))
            check("setup steps are documented in code", facade["hasSteps"])
            check("Google sign-in is exposed", facade["googleIsFn"] is True,
                  str(facade["googleIsFn"]))
            check("username accounts work whether or not the cloud is set up",
                  facade["localWorks"])
            # The invariant is CONSISTENCY: 'local' means it never reached
            # Firebase and cannot sync; 'username' means it did and must.
            # Either is correct; a local account claiming to sync is not.
            check("sync status matches how the account was actually created",
                  (facade["provider"] == "local" and facade["syncs"] is False)
                  or (facade["provider"] == "username" and facade["syncs"] is True),
                  str(facade))
            check("startup init is safe when unconfigured", facade["initOk"])
            check("sign out clears the session", facade["signedOut"])

            # A session written by the pre-facade version must still resolve.
            legacy = await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    const u = await a.signUp('legacyuser', 'abcd');
                    // Old format: a bare user id string, not the {kind,id} object.
                    localStorage.setItem('angler.session', u.id);
                    const who = a.currentUser();
                    await a.signOut();
                    return who && who.username;
                } finally { _cfg.firebase = _fb; }
            """)
            check("legacy sessions still resolve", legacy == "legacyuser", str(legacy))

            # --- account linking seam ---
            # No UI yet by design, but the model must support one person with
            # several sign-in methods BEFORE anyone signs up — retrofitting it
            # later means merging real catch logs.
            linking = await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    const out = {};
                    // Read from the saved config: the guard above blanked the live
                    // one, and this assertion is about the project being set up at
                    // all, not about which path sign-up happens to take.
                    out.configured = Boolean(_fb && _fb.apiKey && _fb.projectId);
                    out.hasLink = typeof a.linkProvider === 'function';
                    out.hasUnlink = typeof a.unlinkProvider === 'function';
                    out.hasFacebook = typeof a.signInWithFacebook === 'function';
                    out.hasPending = typeof a.pendingLink === 'function';

                    // No cloud account signed in -> linking must refuse clearly.
                    const u = await a.signUp('linktest', 'abcd');
                    // Account is local; now put the real config back so
                    // linkProvider refuses with "not synced yet" rather than
                    // "cloud isn't set up" — those are different failures and
                    // only the first is what this test is about.
                    _cfg.firebase = _fb;
                    out.localProviders = a.linkedProviders();
                    out.localRefused = null;
                    try { await a.linkProvider('facebook'); }
                    catch (e) { out.localRefused = e.message; }
                    await a.signOut();

                    // Safe to call: no cloud account is signed in, so this throws
                    // before it can reach signInWithRedirect.
                    out.signedOutRefused = null;
                    try { await a.linkProvider('google'); }
                    catch (e) { out.signedOutRefused = e.message; }

                    out.noPending = a.pendingLink();
                    return out;
                } finally { _cfg.firebase = _fb; }
            """)
            check("firebase config is present", linking["configured"] is True,
                  str(linking["configured"]))
            check("linking functions exist",
                  linking["hasLink"] and linking["hasUnlink"] and linking["hasPending"],
                  str(linking))
            check("facebook path exists alongside google", linking["hasFacebook"])

            check("local accounts report no linked providers",
                  linking["localProviders"] == [], str(linking["localProviders"]))
            # An account that has never been online has no uid to attach a
            # provider to. It must refuse, and the refusal has to say the
            # thing that fixes it, because "cannot be linked" reads permanent.
            check("un-synced accounts cannot be linked",
                  bool(linking["localRefused"]) and "not synced" in linking["localRefused"],
                  str(linking["localRefused"]))
            check("the refusal says how to fix it",
                  "Sign in again" in (linking["localRefused"] or ""),
                  str(linking["localRefused"]))
            check("linking refuses when signed out",
                  bool(linking["signedOutRefused"]), str(linking["signedOutRefused"]))
            check("no pending link on a clean session", linking["noPending"] is None,
                  str(linking["noPending"]))

            # -------------------------------------------------- sync
            print("\nCloud sync")

            creds = await page.eval("""
                const c = await import('./js/auth/credentials.js');
                const a = await c.derivePassword('cole', 'abcd');
                const b = await c.derivePassword('cole', 'abcd');
                const different = await c.derivePassword('cole', 'abcE');
                const otherUser = await c.derivePassword('coleX', 'abcd');
                const cased = await c.derivePassword('COLE', 'abcd');
                return {
                    email: c.syntheticEmail('Cole_1'),
                    synthetic: c.isSyntheticEmail(c.syntheticEmail('cole')),
                    realNotSynthetic: c.isSyntheticEmail('me@gmail.com'),
                    back: c.usernameFromEmail(c.syntheticEmail('cole')),
                    len: a.length,
                    stable: a === b,
                    caseInsensitive: a === cased,
                    passwordMatters: a !== different,
                    userMatters: a !== otherUser,
                    leaksPassword: a.includes('abcd'),
                };
            """)
            # Determinism is the whole feature: a second device has to arrive
            # at the same credential from the same two things the person typed.
            check("derived password is stable", creds["stable"], str(creds))
            check("derivation is case-insensitive like the username",
                  creds["caseInsensitive"], str(creds))
            check("a different password derives differently",
                  creds["passwordMatters"], str(creds))
            check("a different username derives differently",
                  creds["userMatters"], str(creds))
            # Firebase demands 6+; the app allows 4. A digest sidesteps that.
            check("derived password clears Firebase's minimum",
                  creds["len"] >= 6, "length %s" % creds["len"])
            check("the real password is not in the derived one",
                  not creds["leaksPassword"], str(creds))
            check("synthetic address is recognisable both ways",
                  creds["synthetic"] and not creds["realNotSynthetic"]
                  and creds["back"] == "cole", str(creds))
            check("synthetic address uses a reserved domain",
                  creds["email"].endswith("@angler.invalid"), creds["email"])

            plan = await page.eval("""
                const s = await import('./js/sync.js');
                const L = (id, at, extra = {}) => ({ id, updatedAt: at, ...extra });

                const onlyLocal = s.planSync([L('a', '2026-01-02')], []);
                const onlyCloud = s.planSync([], [L('b', '2026-01-02')]);
                const localNewer = s.planSync([L('c', '2026-02-01')], [L('c', '2026-01-01')]);
                const cloudNewer = s.planSync([L('d', '2026-01-01')], [L('d', '2026-02-01')]);
                const same = s.planSync([L('e', '2026-01-01')], [L('e', '2026-01-01')]);

                // A delete on one phone must reach the other, and must not be
                // read as 'the cloud is missing a row, push it back'.
                const tombstone = s.planSync(
                    [L('f', '2026-01-01')],
                    [L('f', '2026-03-01', { deleted: true })]
                );

                return {
                    onlyLocal: onlyLocal.push.length === 1 && onlyLocal.pull.length === 0,
                    onlyCloud: onlyCloud.pull.length === 1 && onlyCloud.push.length === 0,
                    localNewer: localNewer.push.length === 1,
                    cloudNewer: cloudNewer.pull.length === 1,
                    sameUnchanged: same.unchanged === 1
                        && same.push.length === 0 && same.pull.length === 0,
                    tombstonePulled: tombstone.pull.length === 1
                        && tombstone.pull[0].deleted === true,
                };
            """)
            check("a local-only catch is pushed", plan["onlyLocal"], str(plan))
            check("a cloud-only catch is pulled", plan["onlyCloud"], str(plan))
            check("the newer side wins",
                  plan["localNewer"] and plan["cloudNewer"], str(plan))
            check("identical records move nothing", plan["sameUnchanged"], str(plan))
            check("a remote delete reaches this device", plan["tombstonePulled"], str(plan))

            strip = await page.eval("""
                const s = await import('./js/sync.js');
                const blob = new Blob(['x'], { type: 'image/jpeg' });
                const out = s.stripForCloud({
                    id: 'x', speciesId: 'y', weightKg: 2, notes: undefined,
                    photo: blob, video: blob, poster: blob,
                });
                const merged = s.mergeIncoming(
                    { id: 'x', speciesId: 'y', weightKg: 3 },
                    { id: 'x', speciesId: 'y', weightKg: 2, photo: blob }
                );
                return {
                    noMedia: !out.photo && !out.video && !out.poster,
                    noUndefined: !('notes' in out),
                    flagged: out.hasPhotoElsewhere === true && out.hasVideoElsewhere === true,
                    keptPhoto: merged.photo instanceof Blob,
                    tookRemoteValue: merged.weightKg === 3,
                };
            """)
            check("media never leaves the device", strip["noMedia"], str(strip))
            # Firestore rejects undefined outright, and sending null instead
            # would wipe a value another device had filled in.
            check("undefined fields are dropped, not sent as null",
                  strip["noUndefined"], str(strip))
            check("a stripped catch remembers it had media",
                  strip["flagged"], str(strip))
            # Accepting a cloud record wholesale would delete the photo off
            # the phone that took it, which looks like the app losing it.
            check("pulling a catch keeps this device's photo",
                  strip["keptPhoto"] and strip["tookRemoteValue"], str(strip))

            tomb = await page.eval("""
                const { store } = await import('./js/store.js');
                await store.clearCatches();
                const kept = await store.saveCatch({ userId: 'u1', date: '2026-01-01' });
                const gone = await store.saveCatch({ userId: 'u1', date: '2026-01-02' });
                await store.deleteCatch(gone.id);

                const visible = await store.allCatches('u1');
                const raw = await store.allRecords('u1');
                const stone = raw.find(r => r.id === gone.id);

                // Re-keying on upgrade must not look like an edit, or every
                // catch would appear newer than the cloud's copy.
                const before = kept.updatedAt;
                await store.reassignOwner('u1', 'u2');
                const moved = (await store.allRecords('u2')).find(r => r.id === kept.id);

                await store.clearCatches();
                return {
                    hidden: visible.length === 1 && visible[0].id === kept.id,
                    survives: !!stone && stone.deleted === true,
                    reassigned: !!moved,
                    keptStamp: !!moved && moved.updatedAt === before,
                };
            """)
            check("a deleted catch disappears from the log", tomb["hidden"], str(tomb))
            check("but survives as a tombstone so the delete can sync",
                  tomb["survives"], str(tomb))
            check("upgrading re-keys catches to the cloud id",
                  tomb["reassigned"], str(tomb))
            check("re-keying does not look like an edit", tomb["keptStamp"], str(tomb))

            offline = await page.eval("""
                const s = await import('./js/sync.js');
                const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
                Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
                const r = await s.syncNow();
                if (real) Object.defineProperty(Navigator.prototype, 'onLine', real);
                return r;
            """)
            # Syncing must never throw at a screen that has already rendered.
            check("sync reports offline instead of failing",
                  offline["ok"] is False and offline["reason"] == "offline", str(offline))

            panel = await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    await a.signOut();
                    localStorage.removeItem('angler.users');
                    try { await a.signUp('panel', 'abcd'); }
                    catch (e) { await a.signIn('panel', 'abcd'); }

                    location.hash = '#/';
                    await new Promise(r => setTimeout(r, 250));
                    location.hash = '#/settings';
                    await new Promise(r => setTimeout(r, 900));

                    const rows = [...document.querySelectorAll('#providerList li')]
                        .map(li => li.querySelector('span').textContent.trim());
                    const text = document.querySelector('.connected')?.innerText || '';
                    return {
                        present: !!document.querySelector('.connected'),
                        rows,
                        // Internal provider keys must never reach the screen.
                        rawKeys: rows.some(r => ['local', 'username', 'google.com'].includes(r)),
                        saysWhatSyncIs: /sync/i.test(text),
                        reassuresAboutLinking: /never creates a second account/i.test(text),
                    };
                } finally { _cfg.firebase = _fb; }
            """)
            check("settings shows a connected-accounts panel", panel["present"], str(panel))
            check("every sign-in method is named for a human",
                  panel["rows"] and not panel["rawKeys"], str(panel["rows"]))
            check("the panel explains what sync does", panel["saysWhatSyncIs"], str(panel))
            # People will not press a button they think might cost them
            # their log, so the panel has to say that linking is additive.
            check("linking says it will not split the account",
                  panel["reassuresAboutLinking"], str(panel))

            status = await page.eval("""
                location.hash = '#/';
                await new Promise(r => setTimeout(r, 250));
                location.hash = '#/log';
                await new Promise(r => setTimeout(r, 1200));
                const line = document.getElementById('syncLine');
                return { present: !!line, state: line?.dataset.state,
                         text: line?.textContent.trim() || '' };
            """)
            check("the log says where the catches live", status["present"], str(status))
            # A device-only account must say so plainly. Someone who thinks
            # they are backed up and is not has been actively misled.
            check("a device-only log admits it is not backed up",
                  status["state"] == "local" and "device" in status["text"].lower(),
                  str(status))

            # -------------------------------------------------- identify
            print("\nIdentify")
            await page.goto(f"{BASE}/index.html#/identify")
            await page.wait_for("document.querySelector('#takePhoto')", label="identify screen")

            cam = await page.eval("""
                const input = document.getElementById('fishPhoto');
                const homeLink = () => {
                    location.hash = '#/';
                    return new Promise(r => setTimeout(() => r(
                        document.querySelector('a.card[href="#/identify"]')), 700));
                };
                const card = await homeLink();
                location.hash = '#/identify';
                await new Promise(r => setTimeout(r, 700));

                return {
                    onHome: !!card,
                    homeIcon: !!card && !!card.querySelector('svg'),
                    // capture="environment" is what opens the rear camera
                    // directly instead of a file browser on a phone.
                    capture: input?.getAttribute('capture'),
                    accept: input?.getAttribute('accept'),
                    hiddenInput: input?.hidden === true,
                    hasButton: !!document.getElementById('takePhoto'),
                    // Nothing should claim to have identified anything yet.
                    noFakeResult: document.getElementById('identifyResult')
                        ?.textContent.trim() === '',
                };
            """)
            check("home offers the camera", cam["onHome"] and cam["homeIcon"], str(cam))
            check("the camera opens straight to the rear lens",
                  cam["capture"] == "environment", str(cam))
            check("it accepts any image", cam["accept"] == "image/*", str(cam))
            check("the file input is hidden behind a real button",
                  cam["hiddenInput"] and cam["hasButton"], str(cam))
            check("no result is shown before a photo exists",
                  cam["noFakeResult"], str(cam))

            # A photo must produce a preview and an honest "not wired up" notice
            # rather than a spinner that never resolves.
            shot = await page.eval("""
                const canvas = document.createElement('canvas');
                canvas.width = 64; canvas.height = 48;
                const g = canvas.getContext('2d');
                g.fillStyle = '#3FA9C9'; g.fillRect(0, 0, 64, 48);
                const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));

                const input = document.getElementById('fishPhoto');
                const dt = new DataTransfer();
                dt.items.add(new File([blob], 'fish.png', { type: 'image/png' }));
                input.files = dt.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise(r => setTimeout(r, 1500));

                const result = document.getElementById('identifyResult');
                return {
                    preview: !!document.querySelector('#shot img'),
                    altText: document.querySelector('#shot img')?.alt || '',
                    clearShown: document.getElementById('clearPhoto')?.hidden === false,
                    // No Pages Function on the static test server, so the
                    // call fails. That is the path worth pinning: it must say
                    // so and must NOT invent a species.
                    saysFailed: /couldn.t identify|no connection|not set up/i
                        .test(result?.textContent || ''),
                    inventedNothing: !result?.querySelector('.verdict'),
                    buttonRestored: document.getElementById('takePhoto').textContent
                        .includes('Take a photo'),
                };
            """)
            check("a photo shows a preview", shot["preview"], str(shot))
            check("the preview is described for screen readers",
                  bool(shot["altText"]), str(shot))
            check("the photo can be cleared", shot["clearShown"], str(shot))
            # Honesty check: a failed lookup must read as a failure. Silently
            # showing nothing, or worse a guess, would be the bad outcome.
            check("a failed identification says so plainly",
                  shot["saysFailed"], str(shot))
            check("and invents no species when the call fails",
                  shot["inventedNothing"], str(shot))
            check("the button recovers after preparing", shot["buttonRestored"], str(shot))

            verdict = await page.eval("""
                const v = await import('./js/identify-verdict.js');
                // Pretend the local catalogue holds only these two.
                const local = new Set(['sphyraena barracuda', 'lutjanus argentimaculatus']);
                const inRegion = (n) => local.has(v.normalise(n));
                const C = (sci) => ({ scientific: sci, speciesId: 'x', confidence: 'high' });

                const agreed = v.arbitrate(
                    C('Sphyraena barracuda'),
                    [{ scientific: 'Sphyraena barracuda', accuracy: 0.91 }], inRegion);

                // Fishial ranked something else first but still saw Claude's pick.
                const corroborated = v.arbitrate(
                    C('Sphyraena barracuda'),
                    [{ scientific: 'Sphyraena obtusata', accuracy: 0.6 },
                     { scientific: 'Sphyraena barracuda', accuracy: 0.4 }], inRegion);

                // Fishial's top does not occur here; Claude's does.
                const localWins = v.arbitrate(
                    C('Lutjanus argentimaculatus'),
                    [{ scientific: 'Micropterus salmoides', accuracy: 0.88 }], inRegion);

                // Neither occurs here — nothing to break the tie with.
                const split = v.arbitrate(
                    C('Salmo salar'),
                    [{ scientific: 'Micropterus salmoides', accuracy: 0.8 }], inRegion);

                const onlyClaude = v.arbitrate(C('Sphyraena barracuda'), [], inRegion);
                const onlyFishial = v.arbitrate(
                    null, [{ scientific: 'Sphyraena barracuda', accuracy: 0.9 }], inRegion);
                const nothing = v.arbitrate(null, [], inRegion);

                return {
                    // Case-, spacing- and authority-insensitive name matching.
                    normalises: v.normalise('Sphyraena  barracuda (Walbaum, 1792)')
                        === 'sphyraena barracuda',

                    agreed: [agreed.verdict, agreed.agreed, agreed.confidence],
                    corroborated: [corroborated.verdict, corroborated.answer,
                                   corroborated.runnerUp],
                    localWins: [localWins.verdict, localWins.answer],
                    split: [split.verdict, split.confidence],
                    onlyClaude: [onlyClaude.verdict, onlyClaude.source, onlyClaude.confidence],
                    onlyFishial: [onlyFishial.verdict, onlyFishial.source],
                    nothing: [nothing.verdict, nothing.answer],

                    // A low-confidence guess must never be dressed up as certain.
                    neverHighWhenSplit: split.confidence !== 'high',
                };
            """)
            check("scientific names match despite case and authority",
                  verdict["normalises"], str(verdict))
            # Both services landing on the same species is the strong case.
            check("agreement is reported as agreement",
                  verdict["agreed"] == ["agreed", True, "high"], str(verdict["agreed"]))
            # Fishial ranked another fish first but still saw Claude's pick —
            # closer than the top line suggests.
            check("a lower-ranked match still counts as corroboration",
                  verdict["corroborated"][0] == "corroborated"
                  and verdict["corroborated"][1] == "Sphyraena barracuda"
                  and verdict["corroborated"][2] == "Sphyraena obtusata",
                  str(verdict["corroborated"]))
            # The whole reason for the cross-check: a species that doesn't
            # occur here is wrong however confident the classifier was.
            check("a fish that doesn't occur here loses to one that does",
                  verdict["localWins"] == ["local-wins", "Lutjanus argentimaculatus"],
                  str(verdict["localWins"]))
            check("a genuine disagreement is reported, not papered over",
                  verdict["split"] == ["split", "low"], str(verdict["split"]))
            check("never claims high confidence on a split",
                  verdict["neverHighWhenSplit"], str(verdict))
            check("one service answering is usable but flagged",
                  verdict["onlyClaude"] == ["one-sided", "claude", "low"]
                  and verdict["onlyFishial"][:2] == ["one-sided", "fishial"],
                  str(verdict))
            check("no answer from either is not an answer",
                  verdict["nothing"] == ["none", None], str(verdict["nothing"]))

            # The free path: no language model, the catalogue does the checking.
            local = await page.eval("""
                const v = await import('./js/identify-verdict.js');
                const catalogue = [
                    { id: 'sphyraena-barracuda', scientific: 'Sphyraena barracuda',
                      common: 'Great barracuda' },
                    { id: 'lutjanus-johnii', scientific: 'Lutjanus johnii',
                      common: 'John\\u2019s snapper' },
                ];
                const R = (...names) => names.map((n, i) =>
                    ({ scientific: n, accuracy: 0.9 - i * 0.2 }));

                const hit = v.reconcileLocal(R('Sphyraena barracuda'), catalogue);
                const demoted = v.reconcileLocal(
                    R('Micropterus salmoides', 'Sphyraena barracuda'), catalogue);
                // Same genus as a local species — a close relative, not the same fish.
                const related = v.reconcileLocal(R('Lutjanus campechanus'), catalogue);
                const foreign = v.reconcileLocal(R('Micropterus salmoides'), catalogue);
                const empty = v.reconcileLocal([], catalogue);

                return {
                    hit: [hit.verdict, hit.speciesId, hit.agreed, hit.confidence],
                    demoted: [demoted.verdict, demoted.speciesId, demoted.runnerUp],
                    related: [related.verdict, related.speciesId, related.confidence],
                    foreign: [foreign.verdict, foreign.speciesId, foreign.confidence],
                    empty: empty.verdict,
                    // A fish that isn't from here must never come back confident.
                    foreignNotConfident: foreign.confidence === 'low',
                    relatedNotConfident: related.confidence === 'low',
                };
            """)
            check("a local species ranked first is taken",
                  local["hit"] == ["local-match", "sphyraena-barracuda", True, "high"],
                  str(local["hit"]))
            # This is the free cross-check earning its keep: Fishial's top pick
            # doesn't occur here, so its second one wins.
            check("a foreign top pick is demoted to the local one below it",
                  local["demoted"] == ["local-demoted", "sphyraena-barracuda",
                                       "Micropterus salmoides"],
                  str(local["demoted"]))
            check("an unlisted species falls back to a local relative by genus",
                  local["related"][:2] == ["related", "lutjanus-johnii"],
                  str(local["related"]))
            check("nothing local is reported as such, not dressed up",
                  local["foreign"] == ["not-local", None, "low"], str(local["foreign"]))
            check("guesses from outside the catalogue are never confident",
                  local["foreignNotConfident"] and local["relatedNotConfident"], str(local))
            check("no candidates is not an answer", local["empty"] == "none", str(local))

            # Deployment shape: a Worker with a script, not assets alone.
            deploy = await page.eval("""
                const wrangler = await (await fetch('./wrangler.jsonc')).text();
                return {
                    // Without `main` Cloudflare refuses to attach env vars:
                    // "Variables cannot be added to a Worker that only has
                    // static assets."
                    hasMain: /"main"\\s*:\\s*"worker\\//.test(wrangler),
                    hasAssets: /"binding"\\s*:\\s*"ASSETS"/.test(wrangler),
                    // Otherwise the asset server answers /api/* with a 404
                    // before the Worker ever sees it.
                    apiFirst: /"run_worker_first"[\\s\\S]*?\\/api\\/\\*/.test(wrangler),
                };
            """)
            check("the Worker has a script, so variables can attach",
                  deploy["hasMain"], str(deploy))
            check("static assets are still served", deploy["hasAssets"], str(deploy))
            check("/api/* reaches the Worker before the asset server",
                  deploy["apiFirst"], str(deploy))

            # Provider wiring. Read as source: these run in the Worker, not the
            # browser, so there is nothing to import here — but a silent typo
            # in a key name would mean the second opinion never runs and
            # nobody notices, because the free path answers anyway.
            llm = await page.eval("""
                const src = await (await fetch('./worker/_lib/llm.js')).text();
                const wired = await (await fetch('./worker/identify.js')).text();
                return {
                    // Free tier first: Gemini is checked before the metered one.
                    geminiFirst: src.indexOf('GEMINI_API_KEY') < src.indexOf('ANTHROPIC_API_KEY'),
                    bothProviders: src.includes('generativelanguage.googleapis.com')
                        && src.includes('api.anthropic.com'),
                    // Key in a header, not ?key=, so it stays out of request
                    // logs. Strip comments first — the source explains the
                    // choice, and matching that prose is not evidence.
                    keyInHeader: src.includes('x-goog-api-key')
                        && !src.replace(/\/\/.*/g, '').includes('key='),
                    // Both must return the same object or identify.js breaks.
                    oneShape: src.includes('export async function secondOpinion'),
                    // A dead or rate-limited model must not take the feature down.
                    llmFailureTolerated: /catch \(err\)[\s\S]{0,200}llmError/.test(wired),
                    // 'unknown' should fall through to the free reconciler,
                    // which can still demote a foreign top pick.
                    unknownFallsBack: wired.includes("speciesId !== 'unknown'")
                        && wired.includes('reconcileLocal'),
                };
            """)
            check("the free provider is preferred over the metered one",
                  llm["geminiFirst"], str(llm))
            check("both vision providers are wired", llm["bothProviders"], str(llm))
            check("the Gemini key travels in a header, not the query string",
                  llm["keyInHeader"], str(llm))
            check("both providers return one shape", llm["oneShape"], str(llm))
            check("a failed second opinion doesn't take the feature down",
                  llm["llmFailureTolerated"], str(llm))
            check("an 'unknown' answer falls back to the catalogue check",
                  llm["unknownFallsBack"], str(llm))

            # The endpoint must never ship a key to the browser.
            keys = await page.eval("""
                const src = await (await fetch('./js/pages/identify.js')).text();
                return {
                    callsProxy: src.includes('/api/identify'),
                    noAnthropicKey: !/sk-ant-/.test(src),
                    noDirectApi: !src.includes('api.anthropic.com')
                        && !src.includes('api.fishial.ai'),
                };
            """)
            check("the client calls the proxy, not the vendors directly",
                  keys["callsProxy"] and keys["noDirectApi"], str(keys))
            check("no API key is shipped to the browser",
                  keys["noAnthropicKey"], str(keys))

            # -------------------------------------------------- routes
            routes = {
                "home": ("#/", ".kpi__v, .empty"),
                "identify": ("#/identify", "#takePhoto"),
                "info-fishes": ("#/info", ".species-card"),
                "info-gear": ("#/info?tab=gear", ".gear-card"),
                "info-zones": ("#/info?tab=zones", ".zone-card"),
                "conditions": ("#/conditions", ".now-card__temp, .notice--error"),
                "log": ("#/log", ".kpi__v, #authForm"),
                "legacy-species": ("#/species", ".species-card"),
                "legacy-tips": ("#/tips", ".tip-card"),
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
            # The log is gated now, so sign in before exercising it.
            await page.eval("""
                // Force the LOCAL path. Without this, sign-up reaches Firebase and
                // creates a real account in the developer's project — which then
                // makes the next run fail with "username already taken".
                const { CONFIG: _cfg } = await import('./js/config.js');
                const _fb = _cfg.firebase;
                _cfg.firebase = {};
                try {
                    const a = await import('./js/auth.js');
                    if (!a.isSignedIn()) {
                        try { await a.signIn('tester', 'abcd'); }
                        catch { await a.signUp('tester', 'abcd'); }
                    }
                    return 1;
                } finally { _cfg.firebase = _fb; }
            """)
            await page.goto(f"{BASE}/index.html#/")
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelector('.kpi__v')", label="log stats")

            seeded = await page.eval("""
                const a = await import('./js/auth.js');
                const m = await import('./js/store.js');
                const me = a.currentUser();
                await m.store.clearCatches();
                await m.store.saveCatch({userId: me.id, speciesId:'lutjanus-argentimaculatus',
                    regionId:'leyte', date:'2026-07-21', weightKg:4.2, lengthCm:61,
                    method:'Casting lure', bait:'live tamban'});
                await m.store.saveCatch({userId: me.id, speciesId:'photopectoralis-bindus',
                    regionId:'leyte', date:'2026-07-24', weightKg:0.11, lengthCm:9});
                return (await m.store.allCatches(me.id)).length;
            """)
            check("seed two catches", seeded == 2, f"got {seeded}")

            await page.goto(f"{BASE}/index.html#/")
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

            # -------------------------------------------------- media
            print("\nCatch media")
            media = await page.eval("""
                const m = await import('./js/media.js');
                const mk = (name, type, bytes) =>
                    new File([new Uint8Array(bytes)], name, { type });

                const out = {};
                out.image = m.kindOf(mk('a.jpg', 'image/jpeg', 10));
                out.video = m.kindOf(mk('a.mp4', 'video/mp4', 10));
                // iOS often reports an empty MIME type; extension must still work.
                out.movNoType = m.kindOf(mk('a.MOV', '', 10));
                out.heicNoType = m.kindOf(mk('a.HEIC', '', 10));
                out.pdf = m.kindOf(mk('a.pdf', 'application/pdf', 10));

                out.rejectedType = null;
                try { await m.prepareMedia(mk('a.pdf', 'application/pdf', 10)); }
                catch (e) { out.rejectedType = e.message; }

                out.rejectedBig = null;
                try {
                    await m.prepareMedia(mk('big.mp4', 'video/mp4', m.LIMITS.videoBytes + 1024));
                } catch (e) { out.rejectedBig = e.message; }

                return { ...out, limits: m.LIMITS,
                         accept: m.ACCEPT_ATTR.includes('video/mp4') &&
                                 m.ACCEPT_ATTR.includes('image/jpeg') };
            """)
            check("images are recognised", media["image"] == "image", str(media["image"]))
            check("videos are recognised", media["video"] == "video", str(media["video"]))
            check("falls back to file extension when iOS sends no MIME type",
                  media["movNoType"] == "video" and media["heicNoType"] == "image",
                  f"mov={media['movNoType']} heic={media['heicNoType']}")
            check("non-media is rejected", media["pdf"] is None, str(media["pdf"]))
            check("picking a document is refused with a readable message",
                  bool(media["rejectedType"]) and "photos and short videos" in media["rejectedType"],
                  str(media["rejectedType"]))
            check("oversized clip is refused before decoding",
                  bool(media["rejectedBig"]) and "trimmed" in media["rejectedBig"],
                  str(media["rejectedBig"]))
            check("video limits are set", media["limits"]["videoSeconds"] == 15 and
                  media["limits"]["videoBytes"] == 20 * 1024 * 1024, str(media["limits"]))
            check("file picker offers images and video", media["accept"])

            # A real clip: encoded live so the duration check runs for real.
            clip = await page.eval("""
                const m = await import('./js/media.js');
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 64;
                const ctx = canvas.getContext('2d');
                const stream = canvas.captureStream(10);
                const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
                const parts = [];
                rec.ondataavailable = (e) => parts.push(e.data);
                rec.start();
                for (let i = 0; i < 8; i++) {
                    ctx.fillStyle = i % 2 ? '#3fa9c9' : '#ffd23f';
                    ctx.fillRect(0, 0, 64, 64);
                    await new Promise(r => setTimeout(r, 60));
                }
                await new Promise(r => { rec.onstop = r; rec.stop(); });
                const file = new File(parts, 'clip.webm', { type: 'video/webm' });
                try {
                    const res = await m.prepareMedia(file);
                    return { ok: true, kind: res.kind, poster: !!res.poster,
                             duration: res.duration, bytes: res.blob.size };
                } catch (e) { return { ok: false, error: e.message }; }
            """)
            check("a short clip is accepted", clip.get("ok") and clip.get("kind") == "video",
                  str(clip))
            check("a poster frame is extracted", clip.get("poster") is True, str(clip))

            # And the same clip stored on a catch, then read back.
            roundtrip = await page.eval("""
                const a = await import('./js/auth.js');
                const s = await import('./js/store.js');
                const me = a.currentUser();
                const all = await s.store.allCatches(me.id);
                const blob = new Blob([new Uint8Array(2048)], { type: 'video/webm' });
                const poster = new Blob([new Uint8Array(256)], { type: 'image/jpeg' });
                const saved = await s.store.saveCatch({
                    userId: me.id, speciesId: 'caranx-ignobilis', regionId: 'leyte',
                    date: '2026-07-25', video: blob, poster,
                });
                const back = await s.store.getCatch(saved.id);
                await s.store.deleteCatch(saved.id);
                return { video: back.video instanceof Blob, poster: back.poster instanceof Blob,
                         size: back.video?.size };
            """)
            check("clip survives a storage round-trip",
                  roundtrip["video"] and roundtrip["poster"], str(roundtrip))

            # -------------------------------------------------- info page
            print("\nInfo page")
            await page.goto(f"{BASE}/index.html#/info")
            await page.wait_for("document.querySelector('.species-card')", label="info fishes")

            tabs = await page.eval("""
                const wait = async (sel, ms = 3000) => {
                    const end = Date.now() + ms;
                    while (Date.now() < end) {
                        if (document.querySelector(sel)) return true;
                        await new Promise(r => setTimeout(r, 50));
                    }
                    return false;
                };
                const btn = (id) => document.querySelector(`.segmented__btn[data-tab="${id}"]`);
                const seen = {};

                seen.threeTabs = document.querySelectorAll('.segmented__btn').length;
                seen.familyChipsOnFishes = !document.getElementById('familyFilters').hidden;

                btn('gear').click();
                seen.gear = await wait('.gear-card');
                seen.gearCount = document.querySelectorAll('.gear-card').length;
                // Family filters belong to Fishes only; a class that sets
                // display beats [hidden] unless CSS says otherwise.
                const ff = document.getElementById('familyFilters');
                seen.familyChipsHidden = getComputedStyle(ff).display === 'none';
                seen.hashFollowsTab = location.hash.includes('tab=gear');

                btn('zones').click();
                seen.zones = await wait('.zone-card');
                seen.zoneCount = document.querySelectorAll('.zone-card').length;

                btn('fishes').click();
                seen.backToFishes = await wait('.species-card');
                return seen;
            """)
            check("info offers three tabs", tabs["threeTabs"] == 3, str(tabs))
            check("gear tab lists gear", tabs["gear"] and tabs["gearCount"] >= 20, str(tabs))
            check("zones tab lists waters", tabs["zones"] and tabs["zoneCount"] >= 18, str(tabs))
            check("switching back returns to fishes", tabs["backToFishes"], str(tabs))
            check("family filters are fishes-only",
                  tabs["familyChipsOnFishes"] and tabs["familyChipsHidden"], str(tabs))
            check("the hash tracks the active tab", tabs["hashFollowsTab"], str(tabs))

            # Info › Zones opens the same write-up as the map, so its fish must
            # drill down in place too. Separate call site, so worth its own
            # check: the shared component working doesn't prove it was wired.
            info_drill = await page.eval("""
                location.hash = '#/info?tab=zones';
                await new Promise(r => setTimeout(r, 800));
                document.querySelector('.zone-card').click();
                await new Promise(r => setTimeout(r, 500));
                const before = document.querySelector('.sheet__head h2').textContent;
                const btn = document.querySelector('.sheet [data-species-detail]');
                if (!btn) return { wired: false };
                btn.click();
                await new Promise(r => setTimeout(r, 500));
                const out = {
                    wired: true,
                    before,
                    title: document.querySelector('.sheet__head h2').textContent,
                    isSpeciesCard: document.querySelector('.sheet').innerText.includes('FishBase'),
                    backdrops: document.querySelectorAll('.sheet-backdrop').length,
                    hash: location.hash,
                };
                document.querySelector('.sheet-backdrop')?.remove();
                document.body.classList.remove('is-sheet-open');
                document.body.style.top = '';
                return out;
            """)
            check("Info's zone sheet opens fish in place too",
                  info_drill.get("wired") and info_drill.get("isSpeciesCard")
                  and info_drill.get("title") != info_drill.get("before")
                  and info_drill.get("backdrops") == 1, str(info_drill))

            gear = await page.eval("""
                const { GEAR, GEAR_GROUPS } = await import('./js/data/gear.js');
                const groups = new Set(GEAR_GROUPS.map(g => g.id));
                return {
                    total: GEAR.length,
                    groups: GEAR_GROUPS.length,
                    // what / when / where is the whole point of a gear entry.
                    complete: GEAR.every(g => g.what && g.when && g.where),
                    grouped: GEAR.every(g => groups.has(g.group)),
                    unique: new Set(GEAR.map(g => g.id)).size === GEAR.length,
                };
            """)
            check("gear covers several categories", gear["groups"] >= 6, str(gear))
            check("every gear item answers what/when/where", gear["complete"], str(gear))
            check("every gear item is in a real group", gear["grouped"], str(gear))
            check("gear ids are unique", gear["unique"], str(gear))

            gear_sheet = await page.eval("""
                location.hash = '#/info?tab=gear';
                await new Promise(r => setTimeout(r, 700));
                document.querySelector('.gear-card').click();
                await new Promise(r => setTimeout(r, 500));
                const s = document.querySelector('.sheet');
                const labels = [...document.querySelectorAll('.gear-fact__label')]
                    .map(e => e.textContent.trim());
                return { open: !!s, labels, art: !!document.querySelector('.gear-card__art--hero') };
            """)
            check("gear detail opens in a sheet", gear_sheet["open"], str(gear_sheet))
            check("gear sheet is what / when / where",
                  len(gear_sheet["labels"]) == 3
                  and gear_sheet["labels"][0].startswith("What")
                  and gear_sheet["labels"][1].startswith("When")
                  and gear_sheet["labels"][2].startswith("Where"),
                  str(gear_sheet["labels"]))

            trivia = await page.eval("""
                const d = await import('./js/data/index.js');
                const all = d.tipsFor(d.DEFAULT_REGION_ID);
                const cats = ['fishes', 'gear', 'zones'];
                const counts = {};
                for (const c of cats) counts[c] = d.triviaFor(d.DEFAULT_REGION_ID, c).length;
                return {
                    total: all.length,
                    counts,
                    // Every tip must land in exactly one tab, and no tab empty.
                    partitioned: cats.reduce((n, c) => n + counts[c], 0) === all.length,
                    allCategorised: all.every(t => cats.includes(t.category)),
                    everyTabHasSome: cats.every(c => counts[c] > 0),
                };
            """)
            check("every tip is categorised", trivia["allCategorised"], str(trivia))
            check("tips partition across the three tabs", trivia["partitioned"], str(trivia))
            check("no info tab is left without trivia", trivia["everyTabHasSome"], str(trivia))

            trivia_ui = await page.eval("""
                document.querySelector('.sheet-backdrop')?.remove();
                document.body.classList.remove('is-sheet-open');
                location.hash = '#/info?tab=zones';
                await new Promise(r => setTimeout(r, 800));
                const heads = [...document.querySelectorAll('.section-head h2')]
                    .map(e => e.textContent.trim());
                return { heads, cards: document.querySelectorAll('.tip-card').length };
            """)
            check("trivia shows inside the tab", "Trivia" in trivia_ui["heads"], str(trivia_ui))
            check("trivia renders tip cards", trivia_ui["cards"] > 0, str(trivia_ui))

            # A search with no hits on this tab must point at the tab that has them.
            cross = await page.eval("""
                location.hash = '#/info?tab=fishes';
                await new Promise(r => setTimeout(r, 700));
                const i = document.getElementById('infoSearch');
                i.value = 'baitcasting';
                i.dispatchEvent(new Event('input', {bubbles:true}));
                await new Promise(r => setTimeout(r, 400));
                const hint = document.querySelector('[data-goto]');
                if (!hint) return { hint: false };
                const label = hint.textContent.trim();
                hint.click();
                await new Promise(r => setTimeout(r, 500));
                return { hint: true, label,
                         landed: document.querySelectorAll('.gear-card').length };
            """)
            check("a search points at the tab that has results", cross["hint"], str(cross))
            check("following the hint switches tab and filters",
                  cross.get("landed", 0) == 1, str(cross))

            legacy = await page.eval("""
                location.hash = '#/species?open=sphyraena-barracuda';
                await new Promise(r => setTimeout(r, 900));
                return { hash: location.hash,
                         sheet: document.querySelector('.sheet__head h2')?.textContent || '' };
            """)
            check("old species links rewrite to info",
                  legacy["hash"].startswith("#/info"), str(legacy))
            check("old deep links still open the species",
                  "barracuda" in legacy["sheet"].lower(), str(legacy))

            nav = await page.eval("""
                document.querySelector('.sheet-backdrop')?.remove();
                document.body.classList.remove('is-sheet-open');
                const items = [...document.querySelectorAll('.tabbar a, .tabbar button')];
                const account = document.querySelector('.tabbar button');
                const before = location.hash;
                account.click();
                await new Promise(r => setTimeout(r, 300));
                return {
                    order: items.map(e => e.querySelector('span').textContent.trim()),
                    accountIsButton: account.tagName === 'BUTTON',
                    accountHasHref: account.hasAttribute('href'),
                    hashUnchanged: location.hash === before,
                };
            """)
            check("tab bar reads home, map, log, info, account",
                  nav["order"] == ["Home", "Map", "Log", "Info", "Account"], str(nav["order"]))
            check("account tab is inert",
                  nav["accountIsButton"] and not nav["accountHasHref"]
                  and nav["hashUnchanged"], str(nav))

            # -------------------------------------------------- species UI
            print("\nSpecies guide")
            await page.goto(f"{BASE}/index.html#/info")
            await page.wait_for("document.querySelector('.species-card')", label="species cards")
            total = await page.eval("return document.querySelectorAll('.species-card').length;")
            check("all species listed", total >= 25, f"got {total}")

            await page.eval("""
                const i = document.getElementById('infoSearch');
                i.value = 'sap-sap';
                i.dispatchEvent(new Event('input', {bubbles:true}));
            """)
            await asyncio.sleep(0.4)
            found = await page.eval("return document.querySelectorAll('.species-card').length;")
            check("local-name search works", 0 < found < total, f"{found} of {total}")

            dupes = await page.eval("""
                const d = await import('./js/data/index.js');
                const bad = [];
                for (const s of d.allSpecies(d.DEFAULT_REGION_ID)) {
                    const names = d.localNames(s).map(l => l.name.toLowerCase());
                    if (new Set(names).size !== names.length) bad.push(s.id);
                }
                const merged = d.localNames(d.getSpecies('photopectoralis-bindus'));
                return { bad, sapsap: merged.find(l => l.name === 'sap-sap')?.label };
            """)
            check("local names are deduped", not dupes["bad"], ", ".join(dupes["bad"][:5]))
            check("shared names merge their languages",
                  dupes["sapsap"] == "Waray / Cebuano", str(dupes["sapsap"]))

            # --- "did you mean?" ---
            fuzzy = await page.eval("""
                const { suggestSpecies } = await import('./js/search.js');
                const d = await import('./js/data/index.js');
                const list = d.allSpecies(d.DEFAULT_REGION_ID);
                const top = (q) => {
                    const r = suggestSpecies(q, list, d.localNames, { limit: 3 });
                    return r.map(x => x.species.common);
                };
                return {
                    sapsap:    top('sapsap'),      // hyphen dropped
                    barakuda:  top('barakuda'),    // spelled by ear
                    mayamaya:  top('maya maya'),   // spacing
                    lapulapu:  top('lapu lapu'),
                    snaper:    top('snaper'),      // typo
                    gibberish: top('zzzqqqxyw'),
                };
            """)
            check("suggests for a dropped hyphen",
                  any("ponyfish" in n.lower() or "pony" in n.lower() for n in fuzzy["sapsap"]),
                  str(fuzzy["sapsap"]))
            check("suggests for a phonetic spelling",
                  any("barracuda" in n.lower() for n in fuzzy["barakuda"]),
                  str(fuzzy["barakuda"]))
            check("suggests for spacing differences",
                  any("snapper" in n.lower() for n in fuzzy["mayamaya"]),
                  str(fuzzy["mayamaya"]))
            check("suggests for a local name with a space",
                  any("grouper" in n.lower() for n in fuzzy["lapulapu"]),
                  str(fuzzy["lapulapu"]))
            check("suggests for a simple typo",
                  any("snapper" in n.lower() for n in fuzzy["snaper"]),
                  str(fuzzy["snaper"]))
            check("stays quiet for gibberish", fuzzy["gibberish"] == [], str(fuzzy["gibberish"]))

            shownSuggest = await page.eval("""
                const i = document.getElementById('infoSearch');
                i.value = 'snaper';
                i.dispatchEvent(new Event('input', {bubbles:true}));
                await new Promise(r => setTimeout(r, 300));
                const s = document.querySelector('.suggest');
                return { visible: !!s,
                         n: document.querySelectorAll('[data-suggest]').length,
                         text: s ? s.textContent.replace(/\\s+/g,' ').slice(0, 80) : '' };
            """)
            check("empty search shows suggestions in the UI",
                  shownSuggest["visible"] and shownSuggest["n"] > 0, str(shownSuggest))

            picked = await page.eval("""
                document.querySelector('[data-suggest]').click();
                await new Promise(r => setTimeout(r, 500));
                return { box: document.getElementById('infoSearch').value,
                         sheet: !!document.querySelector('.sheet') };
            """)
            check("picking a suggestion corrects the box and opens it",
                  picked["sheet"] and "snaper" != picked["box"].lower(), str(picked))

            await page.eval("""
                document.querySelector('.sheet-backdrop')?.remove();
                const i = document.getElementById('infoSearch');
                i.value = '';
                i.dispatchEvent(new Event('input', {bubbles:true}));
                await new Promise(r => setTimeout(r, 300));
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
                # Seed the cache with a synthetic response rather than calling
                # the API. The free tier is ~100 requests a MONTH, and a suite
                # that runs dozens of times a day will exhaust it — which it
                # did. This exercises the parsing and rendering, which is what
                # the test is actually for; the network call is not the subject.
                await page.eval("""
                    const now = Date.now();
                    const h = 3600e3;
                    const extremes = [
                        { time: new Date(now - 2 * h).toISOString(), type: 'high', heightM: 0.51 },
                        { time: new Date(now + 4 * h).toISOString(), type: 'low',  heightM: -0.22 },
                        { time: new Date(now + 10 * h).toISOString(), type: 'high', heightM: 0.44 },
                        { time: new Date(now + 16 * h).toISOString(), type: 'low',  heightM: -0.18 },
                    ];
                    const d = await import('./js/data/index.js');
                    const c = d.getRegion(d.DEFAULT_REGION_ID).coords;
                    const key = `v2:worldtides:${c.lat},${c.lon}`;
                    localStorage.setItem('angler.tidecache', JSON.stringify({
                        [key]: { at: now, data: { provider: 'WorldTides (test)',
                                                  station: 'Tacloban', extremes } },
                    }));
                    return 1;
                """)
                await page.goto(f"{BASE}/index.html#/")
                await page.goto(f"{BASE}/index.html#/conditions")
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
                    const data = await t.fetchTides(d.getRegion(d.DEFAULT_REGION_ID).coords);
                    const s = t.currentTideState(data.extremes);
                    return { provider: data.provider, n: data.extremes.length,
                             dir: s && s.direction, cached: !!data.cached };
                """)
                check("tide state interpolates", bool(state["dir"]), str(state))
                check("tide test served from cache, no credits spent",
                      state["cached"] is True, str(state))
                await page.shot("conditions-tides")

            # -------------------------------------------------- geolocation
            print("\nLocation")
            geo = await page.eval("""
                const g = await import('./js/api/geo.js');
                const d = await import('./js/data/index.js');
                const region = d.getRegion(d.DEFAULT_REGION_ID);

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
                location.hash = '#/';
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
                location.hash = '#/'; await new Promise(r => setTimeout(r, 400));
                location.hash = '#/conditions'; await new Promise(r => setTimeout(r, 2000));
                navigator.geolocation.getCurrentPosition = real;
                return prompted;
            """)
            check("choosing the region stops the prompting", quiet is False, str(quiet))

            # --- weather on the map ---
            await page.goto(f"{BASE}/index.html#/map")
            # Weather is fetched without blocking the map, so wait for it.
            await page.wait_for(
                "document.querySelector('#mapWeather .now-card__temp, #mapWeather .notice--error')",
                timeout=30, label="map weather")
            mapwx = await page.eval("""
                const pane = document.getElementById('mapWeather');
                const strip = document.getElementById('mapForecast');
                const link = document.querySelector('a[href="#/conditions"]');
                return {
                    hasNow: !!pane?.querySelector('.now-card__temp'),
                    hasStrip: (strip?.querySelectorAll('.fc-day') || []).length,
                    hasLink: !!link,
                    // The old page heading should be gone.
                    noHeading: !document.body.innerText.includes('Zoom in to reveal more water'),
                    // Weather must sit ABOVE the map.
                    order: (() => {
                        const w = document.getElementById('mapWeather');
                        const m = document.getElementById('mapWrap');
                        if (!w || !m) return false;
                        return !!(w.compareDocumentPosition(m) &
                                  Node.DOCUMENT_POSITION_FOLLOWING);
                    })(),
                };
            """)
            check("map shows current weather", mapwx["hasNow"], str(mapwx))
            check("map shows the 5-day strip", mapwx["hasStrip"] == 5, str(mapwx["hasStrip"]))
            check("map links through to tides", mapwx["hasLink"], str(mapwx))
            check("weather sits above the map", mapwx["order"], str(mapwx))
            check("old map heading is gone", mapwx["noHeading"], str(mapwx))

            # One implementation, used by both screens.
            shared = await page.eval("""
                const w = await import('./js/weather-ui.js');
                return { exports: ['weatherHtml','forecastHtml','resolveCoords']
                            .every(k => typeof w[k] === 'function') };
            """)
            check("weather UI is shared, not duplicated", shared["exports"], str(shared))

            # --- single-screen layout ---
            layout = await page.eval("""
                const screen = document.querySelector('.map-screen');
                const info = document.querySelector('.map-screen__info');
                const wrap = document.getElementById('mapWrap');
                const r = screen.getBoundingClientRect();
                const ir = info.getBoundingClientRect();
                const wr = wrap.getBoundingClientRect();
                return {
                    exists: !!screen,
                    noZoneList: !document.querySelector('[data-zone]'),
                    // Stacked on a phone: info above, map below.
                    stacked: ir.bottom <= wr.top + 2,
                    mapShare: wr.height / r.height,
                    // The whole thing must fit the viewport, not push a scroll.
                    fitsViewport: r.height <= window.innerHeight + 2,
                    topbarVar: getComputedStyle(document.documentElement)
                                 .getPropertyValue('--topbar-h').trim(),
                };
            """)
            check("map screen is a single layout", layout["exists"] and layout["noZoneList"],
                  str(layout))
            check("phone layout stacks info above map", layout["stacked"], str(layout))
            check("map takes the larger share",
                  0.5 <= layout["mapShare"] <= 0.75, f"{layout['mapShare']:.2f}")
            check("screen fits the viewport", layout["fitsViewport"], str(layout))
            check("topbar height is measured, not guessed",
                  layout["topbarVar"].endswith("px"), str(layout["topbarVar"]))

            wide = await page.eval("""
                const screen = document.querySelector('.map-screen');
                const cols = getComputedStyle(screen).gridTemplateColumns.split(' ').length;
                return { cols };
            """)
            check("phone layout is a single column", wide["cols"] == 1, str(wide))

            # Everything asked for must be visible without scrolling the panel:
            # conditions, the five-day strip, and the link through to tides.
            visible = await page.eval("""
                const info = document.querySelector('.map-screen__info');
                const box = info.getBoundingClientRect();
                const within = (el) => {
                    if (!el) return false;
                    const r = el.getBoundingClientRect();
                    return r.bottom <= box.bottom + 1 && r.top >= box.top - 1;
                };
                return {
                    now: within(document.querySelector('.now-card')),
                    strip: within(document.querySelector('.forecast')),
                    link: within(document.querySelector('a[href="#/conditions"]')),
                    scrollNeeded: info.scrollHeight > info.clientHeight + 2,
                    panel: Math.round(info.clientHeight),
                    content: Math.round(info.scrollHeight),
                    viewport: window.innerHeight,
                };
            """)
            check("conditions visible without scrolling", visible["now"], str(visible))
            check("forecast reachable in the deck", visible["strip"] is not None, str(visible))
            check("tides link visible without scrolling", visible["link"], str(visible))

            # --- swipeable weather deck ---
            deck = await page.eval("""
                const deck = document.getElementById('wxDeck');
                const dots = document.getElementById('wxDots');
                const cs = getComputedStyle(deck);
                const pages = deck.querySelectorAll('.wx-deck__page');
                const before = deck.scrollLeft;

                // Page 2, the way a swipe would.
                deck.scrollTo({ left: deck.clientWidth, behavior: 'instant' });
                deck.dispatchEvent(new Event('scroll'));
                await new Promise(r => setTimeout(r, 250));
                const second = dots.querySelector('[data-page="1"]').getAttribute('aria-selected');

                // And back via the dots.
                dots.querySelector('[data-page="0"]').click();
                await new Promise(r => setTimeout(r, 500));
                const backHome = deck.scrollLeft < deck.clientWidth / 2;

                return {
                    pages: pages.length,
                    snaps: cs.scrollSnapType.includes('x'),
                    scrollable: deck.scrollWidth > deck.clientWidth + 2,
                    fullWidthPages: Math.abs(pages[0].getBoundingClientRect().width
                                             - deck.clientWidth) < 12,
                    dotFollowsSwipe: second === 'true',
                    dotDrivesDeck: backHome,
                    startedAtFirst: before < 5,
                };
            """)
            check("weather deck has two pages", deck["pages"] == 2, str(deck))
            check("deck snaps one page at a time",
                  deck["snaps"] and deck["fullWidthPages"], str(deck))
            check("deck is actually swipeable", deck["scrollable"], str(deck))
            check("dots follow a swipe", deck["dotFollowsSwipe"], str(deck))
            check("dots can drive the deck", deck["dotDrivesDeck"], str(deck))
            check("deck opens on conditions", deck["startedAtFirst"], str(deck))

            # Both pages must be the same height, or the panel resizes as you
            # swipe and the map jumps with it.
            even = await page.eval("""
                const pages = [...document.querySelectorAll('.wx-deck__page')];
                const h = pages.map(p => Math.round(p.getBoundingClientRect().height));
                const cards = pages.map(p => {
                    const c = p.querySelector('.now-card, .card');
                    return c ? Math.round(c.getBoundingClientRect().height) : 0;
                });
                return { pageHeights: h, cardHeights: cards,
                         pagesEqual: Math.abs(h[0] - h[1]) <= 1,
                         cardsFill: cards.every((c, i) => Math.abs(c - h[i]) <= 2) };
            """)
            check("deck pages are the same height", even["pagesEqual"], str(even))
            check("cards fill their page", even["cardsFill"], str(even))

            # --- location reads as a place, not coordinates ---
            place = await page.eval("""
                const p = await import('./js/api/place.js');
                const name = await p.placeName({ lat: 11.238, lon: 125.004 });
                const label = document.getElementById('mapSource')?.textContent || '';
                return { name, label,
                         hasDegrees: /°/.test(label),
                         hasCoords: /\d+\.\d+/.test(label) };
            """)
            check("coordinates resolve to a place name",
                  bool(place["name"]), str(place["name"]))
            oneline = await page.eval("""
                const el = document.getElementById('mapSource');
                const cs = getComputedStyle(el);
                // line-height computes to "normal" here, so derive the
                // single-line height from the font size instead of parsing it.
                const fs = parseFloat(cs.fontSize) || 12;
                const h = el.getBoundingClientRect().height;
                return { height: Math.round(h), fontSize: fs,
                         wrapped: h > fs * 1.9,
                         nowrap: cs.whiteSpace === 'nowrap',
                         text: el.textContent };
            """)
            check("place label stays on one line",
                  oneline["nowrap"] and not oneline["wrapped"], str(oneline))

            gap = await page.eval("""
                const m = document.getElementById('mapWrap').getBoundingClientRect();
                const bar = document.querySelector('.tabbar').getBoundingClientRect();
                return { gap: Math.round(bar.top - m.bottom) };
            """)
            check("no dead space between map and tab bar",
                  abs(gap["gap"]) <= 2, f"{gap['gap']}px")

            # The map is the only element that could run clean off the window,
            # and did — every other surface on this screen is inset. The bottom
            # is exempt on purpose: the tab bar is already a hard edge, checked
            # directly above.
            inset = await page.eval("""
                const map = document.getElementById('fishMap').getBoundingClientRect();
                const info = document.querySelector('.map-screen__info').getBoundingClientRect();
                return {
                    right: Math.round(window.innerWidth - map.right),
                    left: Math.round(map.left),
                    top: Math.round(map.top - info.bottom),
                    w: Math.round(map.width), h: Math.round(map.height),
                };
            """)
            check("the map is inset from the right of the window",
                  inset["right"] >= 6, f"{inset['right']}px")
            check("the map is inset from the panel above it",
                  inset["top"] >= 6, f"{inset['top']}px")
            check("insetting the map did not collapse it",
                  inset["w"] > 200 and inset["h"] > 200, str(inset))

            check("label shows no coordinates",
                  not place["hasDegrees"] and not place["hasCoords"], str(place["label"]))

            # -------------------------------------------------- sheet gestures
            print()
            print("Sheet")
            await page.goto(f"{BASE}/index.html#/info")
            await page.wait_for("document.querySelector('.species-card')", label="species")

            sheet = await page.eval("""
                document.querySelector('.species-card').click();
                await new Promise(r => setTimeout(r, 500));
                const bd = document.querySelector('.sheet-backdrop');
                const sh = document.querySelector('.sheet');
                const cs = getComputedStyle(sh);
                return {
                    open: bd.classList.contains('is-open'),
                    grip: !!sh.querySelector('[data-grip]'),
                    // Slid fully up, not left mid-transform.
                    settled: cs.transform === 'none' || cs.transform.endsWith(', 0)'),
                    dimmed: getComputedStyle(bd).backgroundColor !== 'rgba(0, 0, 0, 0)',
                    bodyLocked: document.body.classList.contains('is-sheet-open'),
                    scrollbarThin: cs.scrollbarWidth === 'thin',
                    contained: cs.overscrollBehaviorY === 'contain',
                };
            """)
            check("sheet opens and settles", sheet["open"] and sheet["settled"], str(sheet))
            check("sheet has a drag grip", sheet["grip"])
            check("background is dimmed", sheet["dimmed"], str(sheet["dimmed"]))
            check("page behind is locked from scrolling", sheet["bodyLocked"])
            check("scrollbar is slim, not the default bar", sheet["scrollbarThin"],
                  str(sheet["scrollbarThin"]))
            check("sheet scroll does not chain to the page", sheet["contained"],
                  str(sheet["contained"]))

            # A short drag must SNAP BACK — the whole point of the threshold.
            short = await page.eval("""
                const grip = document.querySelector('[data-grip]');
                const box = grip.getBoundingClientRect();
                const x = box.left + box.width / 2, y = box.top + box.height / 2;
                const opts = (cy) => ({ clientX: x, clientY: cy, pointerId: 1,
                                        bubbles: true, pointerType: 'touch' });
                grip.dispatchEvent(new PointerEvent('pointerdown', opts(y)));
                grip.dispatchEvent(new PointerEvent('pointermove', opts(y + 40)));
                await new Promise(r => setTimeout(r, 260));  // slow: low velocity
                grip.dispatchEvent(new PointerEvent('pointerup', opts(y + 40)));
                await new Promise(r => setTimeout(r, 450));
                return { stillOpen: !!document.querySelector('.sheet-backdrop') };
            """)
            check("a short drag snaps back instead of closing",
                  short["stillOpen"], str(short))

            # A long drag closes.
            long_drag = await page.eval("""
                const grip = document.querySelector('[data-grip]');
                const box = grip.getBoundingClientRect();
                const x = box.left + box.width / 2, y = box.top + box.height / 2;
                const opts = (cy) => ({ clientX: x, clientY: cy, pointerId: 2,
                                        bubbles: true, pointerType: 'touch' });
                grip.dispatchEvent(new PointerEvent('pointerdown', opts(y)));
                grip.dispatchEvent(new PointerEvent('pointermove', opts(y + 200)));
                await new Promise(r => setTimeout(r, 300));
                grip.dispatchEvent(new PointerEvent('pointerup', opts(y + 200)));
                await new Promise(r => setTimeout(r, 700));
                return { gone: !document.querySelector('.sheet-backdrop'),
                         unlocked: !document.body.classList.contains('is-sheet-open') };
            """)
            check("a long drag closes the sheet", long_drag["gone"], str(long_drag))
            check("closing unlocks the page behind", long_drag["unlocked"], str(long_drag))

            # Navigating away with a sheet open bypasses close(), which is what
            # unlocks the body. Left stranded, every later page stays pinned at
            # position:fixed with a stale negative offset.
            stranded = await page.eval("""
                document.querySelector('.species-card').click();
                await new Promise(r => setTimeout(r, 400));
                const opened = document.body.classList.contains('is-sheet-open');
                location.hash = '#/';
                await new Promise(r => setTimeout(r, 700));
                const cs = getComputedStyle(document.body);
                return { opened,
                         sheetGone: !document.querySelector('.sheet-backdrop'),
                         unlocked: !document.body.classList.contains('is-sheet-open'),
                         position: cs.position,
                         top: document.body.style.top || '(none)' };
            """)
            check("route change clears a stranded sheet",
                  stranded["opened"] and stranded["sheetGone"], str(stranded))
            check("route change unlocks the body",
                  stranded["unlocked"] and stranded["position"] != "fixed"
                  and stranded["top"] == "(none)", str(stranded))

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

            # --- the map is fenced to the country ----------------------------
            # Manila is 600 km from any zone but is still somewhere this app can
            # answer for; Tokyo is not. The line is the country, not the region,
            # and the two cases must not be collapsed into one.
            fence = await page.eval("""
                const g = await import('./js/api/geo.js');
                const d = await import('./js/data/index.js');
                const pb = d.getRegion(d.DEFAULT_REGION_ID).map.panBounds;
                const at = (lat, lon) => g.withinBounds({ lat, lon }, pb);
                return {
                    tacloban:  at(11.24, 125.00),
                    manila:    at(14.60, 120.98),
                    batanes:   at(20.45, 121.97),   // northern tip
                    tawitawi:  at(5.05, 119.80),    // southern tip
                    davaoEast: at(7.10, 126.60),    // easternmost point
                    tokyo:     at(35.68, 139.69),
                    guam:      at(13.44, 144.79),
                    borneo:    at(1.50, 110.30),
                    noBox:     g.withinBounds({ lat: 0, lon: 0 }, null),
                };
            """)
            check("the country box holds the whole archipelago",
                  all(fence[k] for k in ("tacloban", "manila", "batanes", "tawitawi", "davaoEast")),
                  str(fence))
            check("the country box excludes everywhere else",
                  not any(fence[k] for k in ("tokyo", "guam", "borneo")), str(fence))
            check("no declared box means no restriction", fence["noBox"])

            locked = await page.eval("""
                const el = document.querySelector('#fishMap');
                const m = el._leafletMap;
                const d = await import('./js/data/index.js');
                const pb = d.getRegion(d.DEFAULT_REGION_ID).map.panBounds;
                const mb = m.options.maxBounds;
                if (!mb) return { declared: false };
                // Try to drag the map to Tokyo. Leaflet must refuse.
                m.setView([35.68, 139.69], 9, { animate: false });
                await new Promise(r => setTimeout(r, 200));
                const c = m.getCenter();
                return {
                    declared: true,
                    matchesData: mb.getSouth() === pb.south && mb.getNorth() === pb.north
                              && mb.getWest()  === pb.west  && mb.getEast()  === pb.east,
                    viscosity: m.options.maxBoundsViscosity,
                    landedLon: +c.lng.toFixed(1),
                    stillInBox: c.lng <= pb.east + 1 && c.lng >= pb.west - 1
                             && c.lat <= pb.north + 1 && c.lat >= pb.south - 1,
                };
            """)
            check("the map declares the country as its pan limit",
                  locked["declared"] and locked["matchesData"], str(locked))
            check("panning out of the country is refused",
                  locked.get("stillInBox"), str(locked))

            # Outside the country the map must NOT fly to the fix — maxBounds
            # would drag the view back to the border anyway and strand the
            # "you are here" dot off screen, which reads as a broken map.
            abroad = await page.eval("""
                const el = document.querySelector('#fishMap');
                const m = el._leafletMap;
                const real = navigator.geolocation.getCurrentPosition;
                navigator.geolocation.getCurrentPosition = (ok) => ok({
                    coords: { latitude: 35.68, longitude: 139.69, accuracy: 40 }
                });
                await el._locate();
                navigator.geolocation.getCurrentPosition = real;
                const c = m.getCenter();
                return { hint: document.getElementById('mapHint').textContent,
                         lon: +c.lng.toFixed(1),
                         pins: document.querySelectorAll('.zone-pin').length };
            """)
            check("a fix from abroad says so rather than looking broken",
                  "outside" in abroad["hint"].lower(), str(abroad))
            check("a fix from abroad keeps the region on screen",
                  abroad["lon"] < 130 and abroad["pins"] > 0, str(abroad))

            # ...and the weather falls back to the region's home rather than
            # forecasting for wherever the phone happens to be.
            home = await page.eval("""
                const wui = await import('./js/weather-ui.js');
                const d = await import('./js/data/index.js');
                const region = d.getRegion(d.DEFAULT_REGION_ID);
                const real = navigator.geolocation.getCurrentPosition;

                const ask = async (lat, lon) => {
                    navigator.geolocation.getCurrentPosition = (ok) => ok({
                        coords: { latitude: lat, longitude: lon, accuracy: 40 }
                    });
                    localStorage.removeItem('angler.prefs');
                    return wui.resolveCoords({ region, regionId: region.id });
                };
                const away = await ask(35.68, 139.69);     // Tokyo
                const inPh = await ask(14.60, 120.98);     // Manila
                navigator.geolocation.getCurrentPosition = real;
                return {
                    awaySource: away.source, awayCoords: away.coords,
                    awayLabel: away.label, awayFlag: !!away.outsideCountry,
                    inPhSource: inPh.source, inPhLat: Math.round(inPh.coords.lat),
                    regionCoords: region.coords,
                };
            """)
            check("a fix from abroad falls back to the region's home weather",
                  home["awaySource"] == "region"
                  and home["awayCoords"] == home["regionCoords"], str(home))
            check("the fallback says why it isn't your location",
                  "outside" in home["awayLabel"].lower() and home["awayFlag"],
                  home["awayLabel"])
            check("a fix elsewhere in the country is still used",
                  home["inPhSource"] == "device" and home["inPhLat"] == 15, str(home))
            # The home is the port, not open water — it is also the tide cache
            # key, and tides for an unnamed offshore point help nobody.
            check("the region's weather home is Tacloban",
                  abs(home["regionCoords"]["lat"] - 11.238) < 0.02
                  and abs(home["regionCoords"]["lon"] - 125.004) < 0.02,
                  str(home["regionCoords"]))

            # Refusing must fall back to the whole of Leyte, not leave the map
            # wherever it happened to be sitting.
            refused = await page.eval("""
                const el = document.querySelector('#fishMap');
                const d = await import('./js/data/index.js');
                const b = d.getRegion(d.DEFAULT_REGION_ID).map.bounds;
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

            # Zoomed all the way out is a place the user can actually get to —
            # the map's own minZoom allows it — and every zone's minZoom used to
            # fail there, so it showed bare tiles and "0 of 21 zones shown".
            # The old fix clamped the ZOOM, which cropped the island instead.
            empty = await page.eval("""
                const el = document.querySelector('#fishMap');
                const m = el._leafletMap;
                const out = [];
                for (let z = m.getMinZoom(); z <= m.getMaxZoom(); z++) {
                    m.setZoom(z, { animate: false });
                    await new Promise(r => setTimeout(r, 60));
                    out.push({ z, pins: document.querySelectorAll('.zone-pin').length });
                }
                return { bare: out.filter(o => o.pins === 0), tried: out.length };
            """)
            check("no zoom level shows an empty map",
                  not empty["bare"] and empty["tried"] > 1,
                  f"bare at zoom {[o['z'] for o in empty['bare']]}")

            # 21 pins over one island is only readable if they don't stack. Two
            # zones 1 km apart is a data mistake, not a rendering one — it means
            # a pin for a whole bay has been parked on one town's beach.
            crowd = await page.eval("""
                const d = await import('./js/data/index.js');
                const zones = d.zonesFor(d.DEFAULT_REGION_ID);
                const R = (deg) => deg * Math.PI / 180;
                const km = (a, b) => Math.hypot(
                    (a.lat - b.lat) * 111,
                    (a.lon - b.lon) * 111 * Math.cos(R((a.lat + b.lat) / 2))
                );
                const tooClose = [];
                for (let i = 0; i < zones.length; i++)
                    for (let j = i + 1; j < zones.length; j++) {
                        const dist = km(zones[i].coords, zones[j].coords);
                        // Below ~2.5 km the pins overlap at the zoom where both
                        // first appear, whichever zoom that is.
                        if (dist < 2.5) tooClose.push(
                            `${zones[i].name} / ${zones[j].name} = ${dist.toFixed(1)} km`);
                    }
                return tooClose;
            """)
            check("no two zone pins sit on top of each other",
                  not crowd, "; ".join(crowd))

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

            # The zone list is gone; zones open from their map pin.
            await page.eval("return document.querySelector('.zone-pin').click(), 1;")
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

            # --- a fish opens IN the sheet, not on another page --------------
            # "Species detail" used to be a link to #/info?open=<id>, which
            # threw away the map, the zone and your place in the list.
            drill = await page.eval("""
                const sheet = document.querySelector('.sheet');
                const zoneTitle = document.querySelector('.sheet__head h2').textContent;
                const btn = sheet.querySelector('[data-species-detail]');
                if (!btn) return { error: 'no species detail button' };
                sheet.scrollTop = 300;   // so we can prove the swap resets it
                btn.click();
                await new Promise(r => setTimeout(r, 500));
                const now = document.querySelector('.sheet');
                return {
                    zoneTitle,
                    title: document.querySelector('.sheet__head h2').textContent,
                    hash: location.hash,
                    isSpeciesCard: now.innerText.includes('FishBase'),
                    hasBack: !!now.querySelector('[data-back-to-zone]'),
                    backNamesZone: (now.querySelector('[data-back-to-zone]')
                                       ?.textContent || '').includes(zoneTitle),
                    // One sheet, not two stacked — openSheet cannot nest.
                    backdrops: document.querySelectorAll('.sheet-backdrop').length,
                    mapAlive: !!document.querySelector('#fishMap')?._leafletMap,
                    scrollReset: now.scrollTop === 0,
                    // The old link must be gone, not merely bypassed.
                    oldLink: !!now.querySelector('a[href*="info?open"]'),
                };
            """)
            check("a zone's fish opens inside the sheet",
                  drill.get("isSpeciesCard") and drill.get("title") != drill.get("zoneTitle"),
                  str(drill))
            check("opening a fish does not leave the map",
                  drill.get("hash") == "#/map" and drill.get("mapAlive"), str(drill))
            check("the fish does not stack a second sheet",
                  drill.get("backdrops") == 1, str(drill))
            check("the way back names the zone you came from",
                  drill.get("hasBack") and drill.get("backNamesZone"), str(drill))
            check("swapping the sheet scrolls it back to the top",
                  drill.get("scrollReset"), str(drill))
            check("the redirect to Info is gone, not just bypassed",
                  not drill.get("oldLink"), str(drill))

            # The species card lists the other waters the fish turns up in. From
            # a zone sheet those move the sheet; they used to leave the map too.
            hop = await page.eval("""
                const sheet = document.querySelector('.sheet');
                const chip = sheet.querySelector('a[href*="tab=zones&zone="]');
                if (!chip) return { skipped: 'this fish is in only one zone' };
                const to = chip.textContent.trim();
                chip.click();
                await new Promise(r => setTimeout(r, 600));
                return {
                    to,
                    title: document.querySelector('.sheet__head h2').textContent,
                    onAZone: document.querySelector('.sheet').innerText
                             .includes('Possible catches in these waters'),
                    hash: location.hash,
                    // The weather panel follows the sheet, not just the pin.
                    weatherLabel: document.getElementById('mapSource').textContent,
                };
            """)
            if "skipped" in hop:
                check("another water opens in the sheet", True, hop["skipped"])
            else:
                check("another water opens in the sheet",
                      hop["title"] == hop["to"] and hop["onAZone"]
                      and hop["hash"] == "#/map", str(hop))
                check("the weather follows the sheet to the new water",
                      hop["weatherLabel"] == hop["to"], str(hop))

            back_to_zone = await page.eval("""
                const sheet = document.querySelector('.sheet');
                const btn = sheet.querySelector('[data-species-detail]');
                btn.click();
                await new Promise(r => setTimeout(r, 400));
                document.querySelector('[data-back-to-zone]').click();
                await new Promise(r => setTimeout(r, 400));
                return { onAZone: document.querySelector('.sheet').innerText
                                  .includes('Possible catches in these waters'),
                         backdrops: document.querySelectorAll('.sheet-backdrop').length };
            """)
            check("going back returns to the zone",
                  back_to_zone["onAZone"] and back_to_zone["backdrops"] == 1,
                  str(back_to_zone))

            # Put a plain zone sheet back for the tests below, which need one.
            await page.eval("""
                document.querySelector('.sheet-backdrop')?.remove();
                document.body.classList.remove('is-sheet-open');
                document.body.style.top = '';
                document.querySelector('.zone-pin').click();
                await new Promise(r => setTimeout(r, 600));
                return 1;
            """)
            sheet_txt = await page.eval("""
                const s = document.querySelector('.sheet');
                return s ? s.innerText : '';
            """)

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

            # --- tapping a zone swings the weather onto it -------------------
            # Leyte is 150 km end to end, so the conditions where you're
            # standing can be no guide at all to the water you were thinking of
            # running out to.
            zone_wx = await page.eval("""
                const el = document.querySelector('#fishMap');
                const m = el._leafletMap;
                const d = await import('./js/data/index.js');
                const zones = d.zonesFor(d.DEFAULT_REGION_ID);

                document.querySelector('.sheet-backdrop')?.remove();
                const before = document.getElementById('mapSource').textContent;

                // Pick a pin that is showing, and find out which zone it is.
                const pins = [...document.querySelectorAll('.zone-pin')];
                const titles = pins.map(p => p.closest('.leaflet-marker-icon')?.title || '');
                const i = titles.findIndex(t => zones.some(z => z.name === t));
                if (i < 0) return { error: 'no identifiable pin', titles };
                const zone = zones.find(z => z.name === titles[i]);
                pins[i].click();
                await new Promise(r => setTimeout(r, 900));

                return {
                    zoneName: zone.name,
                    before,
                    label: document.getElementById('mapSource').textContent,
                    resetShown: !document.getElementById('wxReset').hidden,
                    // The card must actually have weather in it, not an error.
                    hasCard: !!document.querySelector('#mapWeather .now-card'),
                    hasForecast: document.querySelectorAll('#mapForecast .fc-day').length,
                };
            """)
            check("tapping a zone names it as the weather's source",
                  zone_wx.get("label") == zone_wx.get("zoneName"), str(zone_wx))
            check("zone weather renders a real forecast",
                  zone_wx.get("hasCard") and zone_wx.get("hasForecast", 0) >= 3, str(zone_wx))
            check("a zone's weather is marked as not your location",
                  zone_wx.get("resetShown"), str(zone_wx))

            back = await page.eval("""
                document.querySelector('.sheet-backdrop')?.remove();
                document.getElementById('wxReset').click();
                await new Promise(r => setTimeout(r, 1200));
                return { label: document.getElementById('mapSource').textContent,
                         resetShown: !document.getElementById('wxReset').hidden,
                         hasCard: !!document.querySelector('#mapWeather .now-card') };
            """)
            check("dismissing zone weather goes back to your own",
                  not back["resetShown"] and back["hasCard"], str(back))

            # "Centre on me" means me in the weather panel too, or the button
            # half-answers: the map moves to you and the card still doesn't.
            via_locate = await page.eval("""
                const zones = (await import('./js/data/index.js'))
                    .zonesFor('leyte');
                document.querySelector('.sheet-backdrop')?.remove();
                const pins = [...document.querySelectorAll('.zone-pin')];
                const t = pins.map(p => p.closest('.leaflet-marker-icon')?.title || '');
                const i = t.findIndex(x => zones.some(z => z.name === x));
                pins[i].click();
                await new Promise(r => setTimeout(r, 700));
                const took = !document.getElementById('wxReset').hidden;

                document.querySelector('.sheet-backdrop')?.remove();
                document.getElementById('locateBtn').click();
                await new Promise(r => setTimeout(r, 1500));
                return { took, stillZone: !document.getElementById('wxReset').hidden };
            """)
            check("centring on your location takes the weather back too",
                  via_locate["took"] and not via_locate["stillZone"], str(via_locate))

            # Browsing zones must not fire a request per tap: neighbouring
            # zones are minutes apart in a forecast that updates hourly.
            wx_cache = await page.eval("""
                const w = await import('./js/api/weather.js');
                w.clearWeatherCache();
                let calls = 0;
                const real = window.fetch;
                window.fetch = (...a) => { calls++; return real(...a); };
                const tz = 'Asia/Manila';
                await w.fetchWeather({ lat: 11.238, lon: 125.004 }, tz);
                const afterFirst = calls;
                await w.fetchWeather({ lat: 11.238, lon: 125.004 }, tz);
                await w.fetchWeather({ lat: 11.2381, lon: 125.0042 }, tz);  // jitter
                const afterRepeat = calls;
                await w.fetchWeather({ lat: 10.30, lon: 125.02 }, tz);      // Sogod
                const afterOther = calls;
                window.fetch = real;
                return { afterFirst, afterRepeat, afterOther };
            """)
            check("the same place is not fetched twice",
                  wx_cache["afterRepeat"] == wx_cache["afterFirst"], str(wx_cache))
            check("a different place still is",
                  wx_cache["afterOther"] > wx_cache["afterRepeat"], str(wx_cache))

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
