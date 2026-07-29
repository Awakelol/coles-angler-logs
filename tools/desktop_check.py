"""
Desktop-layout checks. The main suite runs at phone width, so the sidebar
behaviour — zone detail in the panel rather than a modal — is invisible to it.
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request, websockets

CHROME = next((p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
] if os.path.exists(p)), None)
BASE = os.environ.get("APP_BASE", "http://127.0.0.1:8777")
PORT = 9922
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_screenshots", "tour")

PASS, FAIL = [], []
def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail and not ok else ''}")

def hj(path, n=40):
    for _ in range(n):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=2) as r:
                return json.load(r)
        except Exception:
            time.sleep(.25)
    raise RuntimeError("no devtools")

async def main():
    prof = tempfile.mkdtemp(prefix="desk")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
         "--window-size=1440,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        hj("/json/version")
        ws_url = [t for t in hj("/json/list") if t["type"] == "page"][0]["webSocketDebuggerUrl"]
        async with websockets.connect(ws_url, max_size=40*1024*1024) as ws:
            n = 0
            async def send(m, **kw):
                nonlocal n; n += 1; mid = n
                await ws.send(json.dumps({"id": mid, "method": m, "params": kw}))
                while True:
                    r = json.loads(await asyncio.wait_for(ws.recv(), timeout=40))
                    if r.get("id") == mid: return r.get("result", {})
            async def ev(expr):
                r = await send("Runtime.evaluate", expression=f"(async()=>{{{expr}}})()",
                               returnByValue=True, awaitPromise=True)
                if r.get("exceptionDetails"):
                    raise RuntimeError(r["exceptionDetails"].get("text"))
                return r["result"].get("value")

            await send("Page.enable"); await send("Runtime.enable")
            await send("Emulation.setDeviceMetricsOverride", width=1440, height=900,
                       deviceScaleFactor=1, mobile=False)
            await send("Page.navigate", url=f"{BASE}/index.html#/map")
            for _ in range(60):
                if await ev("return !!document.querySelector('#mapWeather .now-card__temp');"):
                    break
                await asyncio.sleep(.5)
            await asyncio.sleep(1.2)

            print("\nDesktop map layout")
            layout = await ev("""
                const s = document.querySelector('.map-screen');
                const i = document.querySelector('.map-screen__info').getBoundingClientRect();
                const m = document.getElementById('mapWrap').getBoundingClientRect();
                const deck = getComputedStyle(document.getElementById('wxDeck'));
                const dots = getComputedStyle(document.getElementById('wxDots'));
                return { sideBySide: i.right <= m.left + 2,
                         cols: getComputedStyle(s).gridTemplateColumns.split(' ').length,
                         deckStacked: deck.display === 'block',
                         dotsHidden: dots.display === 'none',
                         mapShare: +(m.width / s.getBoundingClientRect().width).toFixed(2) };
            """)
            check("sidebar sits beside the map", layout["sideBySide"] and layout["cols"] == 2, str(layout))
            check("deck stops being a carousel", layout["deckStacked"], str(layout))
            check("paging dots are hidden", layout["dotsHidden"], str(layout))
            check("map takes the majority", layout["mapShare"] >= 0.6, str(layout["mapShare"]))

            zone = await ev("""
                document.querySelector('.zone-pin').click();
                await new Promise(r => setTimeout(r, 600));
                const panel = document.getElementById('zonePanel');
                const info = document.querySelector('.map-screen__info');
                return { inSidebar: !!panel && !panel.hidden,
                         noModal: !document.querySelector('.sheet-backdrop'),
                         insideInfo: !!panel && info.contains(panel),
                         belowWeather: (() => {
                             const w = document.getElementById('wxDeck');
                             return !!(w.compareDocumentPosition(panel) &
                                       Node.DOCUMENT_POSITION_FOLLOWING);
                         })(),
                         hasSpecies: (panel?.innerText || '').includes('Possible catches'),
                         closable: !!panel?.querySelector('[data-close-zone]') };
            """)
            check("zone opens in the sidebar", zone["inSidebar"] and zone["insideInfo"], str(zone))
            check("no modal on desktop", zone["noModal"], str(zone))
            check("zone sits below the weather", zone["belowWeather"], str(zone))
            check("zone detail is complete", zone["hasSpecies"], str(zone))
            check("zone panel can be closed", zone["closable"], str(zone))

            os.makedirs(OUT, exist_ok=True)
            shot = await send("Page.captureScreenshot", format="png", captureBeyondViewport=False)
            with open(os.path.join(OUT, "desktop-map-zone.png"), "wb") as f:
                f.write(base64.b64decode(shot["data"]))

            closed = await ev("""
                document.querySelector('[data-close-zone]').click();
                await new Promise(r => setTimeout(r, 300));
                const p = document.getElementById('zonePanel');
                return p.hidden && p.innerHTML.trim() === '';
            """)
            check("closing clears the panel", closed)
    finally:
        proc.terminate()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED: " + ", ".join(FAIL))
        sys.exit(1)

asyncio.run(main())
