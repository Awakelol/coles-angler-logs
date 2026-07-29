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

            # -------------------------------------------------- transitions
            print("\nPage transitions")
            trans = await page.eval("""
                const supported = typeof document.startViewTransition === 'function';

                // Navigating must still land on the right page, transition or not.
                location.hash = '#/tips';
                await new Promise(r => setTimeout(r, 700));
                const onTips = !!document.querySelector('.tip-card');
                location.hash = '#/species';
                await new Promise(r => setTimeout(r, 900));
                const onSpecies = !!document.querySelector('.species-card');

                // Rapid navigation must not strand a half-finished transition.
                location.hash = '#/tips';
                location.hash = '#/species';
                location.hash = '#/tips';
                await new Promise(r => setTimeout(r, 1200));
                const settled = !!document.querySelector('.tip-card');

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
                    location.hash = '#/tips';
                    await new Promise(r => setTimeout(r, 250));
                    location.hash = '#/species';
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
            await page.goto(f"{BASE}/index.html#/tips")
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
            check("both providers are offered",
                  gated["google"] and gated["facebook"], str(gated))
            check("providers sit above the username field", gated["order"], str(gated))
            check("sign-up is a separate action, not a tab", gated["signupBtn"], str(gated))
            check("sign-in screen has no email field", not gated["hasEmail"], str(gated))

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
            check("accounts carry a provider for future OAuth",
                  rules["provider"] == "local", str(rules["provider"]))

            stored = await page.eval("""
                const raw = localStorage.getItem('angler.users');
                return { plaintext: raw.includes('abcd'), hashed: /"hash":"[0-9a-f]{64}"/.test(raw),
                         salted: /"salt":"[0-9a-f]{32}"/.test(raw) };
            """)
            check("passwords are not stored in plain text", not stored["plaintext"], str(stored))
            check("passwords are salted and hashed",
                  stored["hashed"] and stored["salted"], str(stored))

            # Two accounts must not see each other's catches.
            scoped = await page.eval("""
                const a = await import('./js/auth.js');
                const m = await import('./js/store.js');
                const me = a.currentUser();
                await m.store.saveCatch({ userId: me.id, speciesId: 'caranx-ignobilis',
                    regionId: 'leyte-gulf', date: '2026-07-20', weightKg: 5 });
                const mineBefore = (await m.store.allCatches(me.id)).length;

                const other = await a.signUp('friend', 'abcd');
                await m.store.saveCatch({ userId: other.id, speciesId: 'chanos-chanos',
                    regionId: 'leyte-gulf', date: '2026-07-21', weightKg: 2 });

                return {
                    mine: mineBefore,
                    theirs: (await m.store.allCatches(other.id)).length,
                    mineStill: (await m.store.allCatches(me.id)).length,
                    everything: (await m.store.allCatches()).length,
                };
            """)
            check("each account sees only its own catches",
                  scoped["mine"] == 1 and scoped["theirs"] == 1 and scoped["mineStill"] == 1,
                  str(scoped))
            check("both catches exist in storage", scoped["everything"] >= 2, str(scoped))

            await page.goto(f"{BASE}/index.html#/tips")
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
                const a = await import('./js/auth.js');
                const m = await import('./js/store.js');
                await m.store.clearCatches();
                a.signOut();
                localStorage.removeItem('angler.users');
                await a.signUp('tester', 'abcd');
                return 1;
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
                const a = await import('./js/auth.js');
                const out = {};
                out.configured = a.cloudConfigured();
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
            """)
            check("cloud reports configured with a firebase config",
                  facade["configured"] is True, str(facade["configured"]))
            check("setup steps are documented in code", facade["hasSteps"])
            check("Google sign-in is exposed", facade["googleIsFn"] is True,
                  str(facade["googleIsFn"]))
            check("local accounts still work with no cloud setup", facade["localWorks"])
            check("local accounts are marked as not syncing",
                  facade["syncs"] is False and facade["provider"] == "local", str(facade))
            check("startup init is safe when unconfigured", facade["initOk"])
            check("sign out clears the session", facade["signedOut"])

            # A session written by the pre-facade version must still resolve.
            legacy = await page.eval("""
                const a = await import('./js/auth.js');
                const u = await a.signUp('legacyuser', 'abcd');
                // Old format: a bare user id string, not the {kind,id} object.
                localStorage.setItem('angler.session', u.id);
                const who = a.currentUser();
                await a.signOut();
                return who && who.username;
            """)
            check("legacy sessions still resolve", legacy == "legacyuser", str(legacy))

            # --- account linking seam ---
            # No UI yet by design, but the model must support one person with
            # several sign-in methods BEFORE anyone signs up — retrofitting it
            # later means merging real catch logs.
            linking = await page.eval("""
                const a = await import('./js/auth.js');
                const out = {};
                out.configured = a.cloudConfigured();
                out.hasLink = typeof a.linkProvider === 'function';
                out.hasUnlink = typeof a.unlinkProvider === 'function';
                out.hasFacebook = typeof a.signInWithFacebook === 'function';
                out.hasPending = typeof a.pendingLink === 'function';

                // No cloud account signed in -> linking must refuse clearly.
                const u = await a.signUp('linktest', 'abcd');
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
            """)
            check("firebase config is present", linking["configured"] is True,
                  str(linking["configured"]))
            check("linking functions exist",
                  linking["hasLink"] and linking["hasUnlink"] and linking["hasPending"],
                  str(linking))
            check("facebook path exists alongside google", linking["hasFacebook"])
            check("local accounts report no linked providers",
                  linking["localProviders"] == [], str(linking["localProviders"]))
            check("device-only accounts cannot be linked",
                  bool(linking["localRefused"]) and "Device-only" in linking["localRefused"],
                  str(linking["localRefused"]))
            check("linking refuses when signed out",
                  bool(linking["signedOutRefused"]), str(linking["signedOutRefused"]))
            check("no pending link on a clean session", linking["noPending"] is None,
                  str(linking["noPending"]))

            # -------------------------------------------------- routes
            routes = {
                "home": ("#/", ".kpi__v, .empty"),
                "species": ("#/species", ".species-card"),
                "conditions": ("#/conditions", ".now-card__temp, .notice--error"),
                "log": ("#/log", ".kpi__v, #authForm"),
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
            # The log is gated now, so sign in before exercising it.
            await page.eval("""
                const a = await import('./js/auth.js');
                if (!a.isSignedIn()) {
                    try { await a.signIn('tester', 'abcd'); }
                    catch { await a.signUp('tester', 'abcd'); }
                }
                return 1;
            """)
            await page.goto(f"{BASE}/index.html#/tips")
            await page.goto(f"{BASE}/index.html#/log")
            await page.wait_for("document.querySelector('.kpi__v')", label="log stats")

            seeded = await page.eval("""
                const a = await import('./js/auth.js');
                const m = await import('./js/store.js');
                const me = a.currentUser();
                await m.store.clearCatches();
                await m.store.saveCatch({userId: me.id, speciesId:'lutjanus-argentimaculatus',
                    regionId:'leyte-gulf', date:'2026-07-21', weightKg:4.2, lengthCm:61,
                    method:'Casting lure', bait:'live tamban'});
                await m.store.saveCatch({userId: me.id, speciesId:'photopectoralis-bindus',
                    regionId:'leyte-gulf', date:'2026-07-24', weightKg:0.11, lengthCm:9});
                return (await m.store.allCatches(me.id)).length;
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
                    userId: me.id, speciesId: 'caranx-ignobilis', regionId: 'leyte-gulf',
                    date: '2026-07-25', video: blob, poster,
                });
                const back = await s.store.getCatch(saved.id);
                await s.store.deleteCatch(saved.id);
                return { video: back.video instanceof Blob, poster: back.poster instanceof Blob,
                         size: back.video?.size };
            """)
            check("clip survives a storage round-trip",
                  roundtrip["video"] and roundtrip["poster"], str(roundtrip))

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

            # --- "did you mean?" ---
            fuzzy = await page.eval("""
                const { suggestSpecies } = await import('./js/search.js');
                const d = await import('./js/data/index.js');
                const list = d.allSpecies('leyte-gulf');
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
                const i = document.getElementById('speciesSearch');
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
                return { box: document.getElementById('speciesSearch').value,
                         sheet: !!document.querySelector('.sheet') };
            """)
            check("picking a suggestion corrects the box and opens it",
                  picked["sheet"] and "snaper" != picked["box"].lower(), str(picked))

            await page.eval("""
                document.querySelector('.sheet-backdrop')?.remove();
                const i = document.getElementById('speciesSearch');
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
                    const c = d.getRegion('leyte-gulf').coords;
                    const key = `v2:worldtides:${c.lat},${c.lon}`;
                    localStorage.setItem('angler.tidecache', JSON.stringify({
                        [key]: { at: now, data: { provider: 'WorldTides (test)',
                                                  station: 'Tacloban', extremes } },
                    }));
                    return 1;
                """)
                await page.goto(f"{BASE}/index.html#/tips")
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
                    const data = await t.fetchTides(d.getRegion('leyte-gulf').coords);
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

            # -------------------------------------------------- sheet gestures
            print()
            print("Sheet")
            await page.goto(f"{BASE}/index.html#/species")
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
                location.hash = '#/tips';
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
