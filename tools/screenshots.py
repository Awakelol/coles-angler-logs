"""
Captures a tour of the app as it actually looks on a phone.

Viewport-sized shots (not captureBeyondViewport) so position:fixed elements —
the tab bar, modal sheets, the toast — land where they really do.

Usage:
    python -m http.server 8777 --bind 127.0.0.1   (from the project root)
    python tools/screenshots.py
"""

import asyncio
import base64
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
    ] if os.path.exists(p)),
    None,
)

BASE = os.environ.get("APP_BASE", "http://127.0.0.1:8777")
PORT = 9444
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_screenshots", "tour")

# name -> (hash route, css selector to wait for, optional JS to run first)
SHOTS = [
    ("1-home",       "#/",           ".kpi__v, .empty",              None),
    ("2-info-fishes", "#/info",      ".species-card",                None),
    ("2b-species-cards", "#/info",   ".species-card",
     "window.scrollTo(0, 1150); await new Promise(r => setTimeout(r, 1400))"),
    ("3-species-detail", "#/info",   ".species-card",
     "document.querySelectorAll('.species-card')[4].click()"),
    ("3b-info-gear", "#/info?tab=gear", ".gear-card",                None),
    ("3c-gear-detail", "#/info?tab=gear", ".gear-card",
     "document.querySelectorAll('.gear-card')[1].click();"
     "await new Promise(r=>setTimeout(r,600))"),
    ("3d-info-zones", "#/info?tab=zones", ".zone-card",              None),
    ("4-map",        "#/map",        "#mapWeather .now-card__temp",  None),
    ("4b-map-forecast", "#/map",     "#mapWeather .now-card__temp",
     "const d=document.getElementById('wxDeck');"
     "d.scrollTo({left:d.clientWidth,behavior:'instant'});"
     "d.dispatchEvent(new Event('scroll'));"
     "await new Promise(r=>setTimeout(r,500))"),
    # The bar is rolled away on the map; this is it brought back by the +.
    ("4c-map-nav-open", "#/map",     "#mapWeather .now-card__temp",
     "document.getElementById('quickBtn').click();"
     "await new Promise(r=>setTimeout(r,700))"),
    ("5-map-zone",   "#/map",        "#fishMap .leaflet-tile-pane",
     "document.querySelector('.zone-pin').click()"),
    ("6-conditions", "#/conditions", ".now-card__temp",              None),
    ("7-log",        "#/log",        ".kpi__v, #authForm",           None),
    ("7b-signin",    "#/log",        ".kpi__v, #authForm",
     "const a = await import('./js/auth.js'); await a.signOut(); location.hash='#/';"
     "await new Promise(r=>setTimeout(r,300)); location.hash='#/log';"
     "await new Promise(r=>setTimeout(r,900))"),
    ("7c-signup",    "#/log",        "#authForm",
     "document.querySelector('[data-goto=signup]').click();"
     "await new Promise(r=>setTimeout(r,900))"),
    ("8-trivia",     "#/info?tab=zones", ".tip-card",
     "const t=document.querySelector('.tip-card');"
     "t.scrollIntoView({block:'center'}); await new Promise(r=>setTimeout(r,600))"),
    ("9-settings",   "#/settings",   "#saveTides",                   None),
    ("9b-account",   "#/account",    ".acct-name",                   None),
    ("9d-settings-panel", "#/settings?p=data", ".set-back",           None),
    ("9e-info-gear-folders", "#/info?tab=gear", ".folder",             None),
    ("2c-deck-mid-swipe", "#/info", ".dcard",
     "const c=document.querySelector('.dcard.is-live');"
     "const b=c.getBoundingClientRect(); const x=b.left+b.width/2, y=b.top+40;"
     "const p=(t,yy)=>new PointerEvent(t,{bubbles:true,pointerId:9,clientX:x,clientY:yy});"
     "c.dispatchEvent(p('pointerdown',y));"
     "document.querySelector('[data-deck]').dispatchEvent(p('pointermove',y-70));"
     "await new Promise(r=>setTimeout(r,180))"),
    ("2d-folder-open",  "#/info",      ".dcard",
     # The shot before leaves a finger down on purpose; hash navigation does not
     # reload, so release it or this tap lands during someone else's gesture.
     "document.querySelector('[data-deck]').dispatchEvent("
     "new PointerEvent('pointercancel',{bubbles:true,pointerId:9}));"
     "await new Promise(r=>setTimeout(r,300));"
     "const c=document.querySelector('.dcard.is-live');"
     "const b=c.getBoundingClientRect();"
     "const p=(t)=>new PointerEvent(t,{bubbles:true,pointerId:8,clientX:b.left+b.width/2,clientY:b.top+40});"
     "c.dispatchEvent(p('pointerdown')); c.dispatchEvent(p('pointerup'));"
     "await new Promise(r=>setTimeout(r,700))"),
    ("9f-account-signin", "#/account", "#authForm",                     None),
    # The + open, so the quick actions and the x are in the tour rather than
    # only in the test assertions.
    ("9c-quick-actions", "#/",       ".fab",
     "document.querySelector('.fab').click(); await new Promise(r=>setTimeout(r,600))"),
    # Dark theme sweep — set once, then walk the same screens.
    ("d1-home",      "#/",           ".kpi__v, .empty",
     "const t = await import('./js/theme.js'); t.setTheme('dark')"),
    ("d2-species",   "#/info",       ".species-card",
     "window.scrollTo(0, 1150); await new Promise(r => setTimeout(r, 1400))"),
    ("d2b-gear",     "#/info?tab=gear", ".gear-card",                None),
    ("d3-conditions", "#/conditions", ".now-card__temp",             None),
    ("d4-map",       "#/map",        "#mapWeather .now-card__temp",  None),
    ("d5-settings",  "#/settings",   "#themePicker",                 None),
    ("d6-signin",    "#/log",        "#authForm",                    None),
]


def http_json(path, retries=40):
    for _ in range(retries):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=2) as r:
                return json.load(r)
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("Chrome DevTools endpoint never came up")


class Page:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def send(self, method, **params):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            raw = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=45))
            if raw.get("id") == mid:
                if "error" in raw:
                    raise RuntimeError(f"{method}: {raw['error']}")
                return raw.get("result", {})

    async def eval(self, expr):
        r = await self.send("Runtime.evaluate", expression=f"(async function(){{ {expr} }})()",
                            returnByValue=True, awaitPromise=True)
        return r["result"].get("value")

    async def wait_for(self, sel, timeout=25):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if await self.eval(f"return !!document.querySelector({json.dumps(sel)});"):
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.25)
        return False

    async def shot(self, name):
        os.makedirs(OUT, exist_ok=True)
        r = await self.send("Page.captureScreenshot", format="png", captureBeyondViewport=False)
        path = os.path.join(OUT, f"{name}.png")
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return path


async def main():
    if not CHROME:
        sys.exit("No Chrome or Edge found.")
    profile = tempfile.mkdtemp(prefix="anglershot")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
         "--force-device-scale-factor=2", "--window-size=420,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        http_json("/json/version")
        ws_url = [t for t in http_json("/json/list") if t["type"] == "page"][0]["webSocketDebuggerUrl"]
        async with websockets.connect(ws_url, max_size=40 * 1024 * 1024) as ws:
            page = Page(ws)
            await page.send("Page.enable")
            await page.send("Runtime.enable")
            # NOT setting Emulation.setDeviceMetricsOverride on purpose. It
            # changes the layout viewport but not the visual viewport that
            # 100dvh resolves against, so anything sized in dvh — the map
            # screen — comes out short and the shot shows a false gap above
            # the tab bar. --window-size plus --force-device-scale-factor
            # gives a consistent viewport.

            # Seed a couple of catches so the log and stats aren't empty.
            await page.send("Page.navigate", url=f"{BASE}/index.html#/log")
            await asyncio.sleep(1.2)
            await page.eval("""
                const a = await import('./js/auth.js');
                const m = await import('./js/store.js');
                // Tour shows a populated log, so make sure someone is signed in.
                a.signOut();
                localStorage.removeItem('angler.users');
                const me = await a.signUp('cole', 'demo1234');
                await m.store.clearCatches();
                await m.store.saveCatch({userId: me.id, speciesId:'lutjanus-argentimaculatus', regionId:'leyte',
                    date:'2026-07-21', weightKg:4.2, lengthCm:61, method:'Casting lure',
                    bait:'live tamban', notes:'Run-out tide at the creek mouth.'});
                await m.store.saveCatch({userId: me.id, speciesId:'caranx-ignobilis', regionId:'leyte',
                    date:'2026-07-24', weightKg:7.8, lengthCm:83, method:'Casting lure', bait:'popper'});
                await m.store.saveCatch({userId: me.id, speciesId:'photopectoralis-bindus', regionId:'leyte',
                    date:'2026-07-26', weightKg:0.11, lengthCm:9, method:'Hand line', bait:'cut shrimp'});
                return 1;
            """)

            locked = await page.eval(
                "const t = await import('./js/theme.js'); return !!t.THEME_LOCKED;")
            shots = SHOTS
            if locked:
                shots = [x for x in SHOTS if not x[0].startswith("d")]
                print("  (dark sweep skipped — THEME_LOCKED is on; those screens"
                      " would come out light under dark names)")

            made = []
            for name, route, sel, action in shots:
                await page.send("Page.navigate", url=f"{BASE}/index.html{route}")
                await asyncio.sleep(0.5)
                ok = await page.wait_for(sel)
                if not ok:
                    print(f"  !! {name}: never saw {sel}")
                if action:
                    await page.eval(f"{action}; return 1;")
                    await asyncio.sleep(0.8)
                await asyncio.sleep(0.5)
                made.append(await page.shot(name))
                print(f"  {name}")

            await page.send("Page.navigate", url=f"{BASE}/index.html#/log")
            await asyncio.sleep(1.0)
            await page.eval("const m = await import('./js/store.js'); await m.store.clearCatches(); return 1;")
    finally:
        proc.terminate()
    print(f"\n{len(made)} shots -> {os.path.normpath(OUT)}")


asyncio.run(main())
