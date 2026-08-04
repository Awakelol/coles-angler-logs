"""Desktop screenshots at 1440x900.

The tour in screenshots.py runs at phone width, so the rail, the two-column
map and the rounded content panel never appear in it. desktop_check.py proves
those layouts are correct; this is for looking at them.

Run:  python tools/desktop_shots.py   (with the static server up)
Out:  _screenshots/desktop/
"""
import asyncio, base64, json, os, subprocess, tempfile, time, urllib.request, websockets

CHROME = next((p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
] if os.path.exists(p)), None)
BASE = os.environ.get("APP_BASE", "http://127.0.0.1:8777")
PORT = 9933
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_screenshots", "desktop")
SHOTS = [("home", "#/", ".kpi__v, .empty", None),
         ("collapsed", "#/info", ".species-card",
          "document.getElementById('railToggle').click();"
          "await new Promise(r=>setTimeout(r,700))"),
         ("collapsed-home", "#/", ".kpi__v, .empty",
          "await new Promise(r=>setTimeout(r,400))"),
         ("expanded-again", "#/", ".kpi__v, .empty",
          "document.getElementById('railToggle').click();"
          "await new Promise(r=>setTimeout(r,700))"),
         ("info", "#/info", ".species-card", None),
         ("map", "#/map", "#mapWeather .now-card__temp", None),
         ("quick", "#/", ".fab",
          "document.getElementById('quickBtn').click(); await new Promise(r=>setTimeout(r,600))")]

def hj(path, n=40):
    for _ in range(n):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=2) as r:
                return json.load(r)
        except Exception:
            time.sleep(.25)
    raise RuntimeError("no devtools")

async def main():
    os.makedirs(OUT, exist_ok=True)
    prof = tempfile.mkdtemp(prefix="shot")
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
                return r["result"].get("value")
            await send("Page.enable"); await send("Runtime.enable")
            await send("Emulation.setDeviceMetricsOverride", width=1440, height=900,
                       deviceScaleFactor=1, mobile=False)
            for name, route, sel, action in SHOTS:
                await send("Page.navigate", url=f"{BASE}/index.html{route}")
                for _ in range(60):
                    if await ev(f"return !!document.querySelector({sel!r});"): break
                    await asyncio.sleep(.4)
                await asyncio.sleep(1.4)
                if action:
                    await ev(f"{action}; return 1;")
                    await asyncio.sleep(.6)
                s = await send("Page.captureScreenshot", format="png")
                open(os.path.join(OUT, name + ".png"), "wb").write(base64.b64decode(s["data"]))
                print(" ", name)
    finally:
        proc.terminate()

asyncio.run(main())
