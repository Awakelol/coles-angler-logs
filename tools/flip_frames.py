"""
Frames of the folder flip, for looking at.

`Page.captureScreenshot` takes longer than the flip does, so a timed capture
always lands after it — every frame comes out showing the finished state. This
pauses the animation at fixed points instead and reloads between them, because
a hash change does not reload and the second shot would start with a folder
already open.

Run:  python tools/flip_frames.py
Out:  _screenshots/tour/flip-frames.png
"""
import asyncio, base64, io, json, os, subprocess, tempfile, time, urllib.request, websockets
from PIL import Image

CHROME = next((p for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
] if os.path.exists(p)), None)
BASE = os.environ.get("APP_BASE", "http://127.0.0.1:8777")
PORT = 9893
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_screenshots", "tour")
STOPS = (0, 130, 230, 330, 480)


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
    prof = tempfile.mkdtemp(prefix="flip")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
         "--window-size=492,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        hj("/json/version")
        ws_url = [t for t in hj("/json/list") if t["type"] == "page"][0]["webSocketDebuggerUrl"]
        async with websockets.connect(ws_url, max_size=40*1024*1024) as ws:
            n = 0

            async def send(m, **kw):
                nonlocal n
                n += 1
                mid = n
                await ws.send(json.dumps({"id": mid, "method": m, "params": kw}))
                while True:
                    r = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                    if r.get("id") == mid:
                        return r.get("result", {})

            await send("Page.enable")
            await send("Runtime.enable")
            await send("Emulation.setDeviceMetricsOverride", width=492, height=900,
                       deviceScaleFactor=2, mobile=True)

            frames = []
            for k, t_ms in enumerate(STOPS):
                # A unique query forces a real load rather than a hash change.
                await send("Page.navigate", url=f"{BASE}/index.html?flip={k}#/info")
                await asyncio.sleep(3.4)
                # Third card along, so the back of it is a colour rather than
                # the white of "Everything".
                await send("Runtime.evaluate", expression="""(() => {
                    const rail = document.querySelector('[data-deck-rail]');
                    if (!rail) return 0;
                    rail.scrollTop = rail.scrollHeight - rail.clientHeight * 3;
                    rail.dispatchEvent(new Event('scroll'));
                    return 1;
                })()""", returnByValue=True)
                await asyncio.sleep(0.6)
                await send("Runtime.evaluate", expression=f"""(() => {{
                    const rail = document.querySelector('[data-deck-rail]');
                    rail.click();
                    const w = document.querySelector('.deck-flip');
                    if (!w) return 0;
                    const all = [...w.getAnimations(),
                                 ...w.querySelector('.deck-flip__inner').getAnimations(),
                                 ...document.getElementById('infoResults').getAnimations()];
                    for (const a of all) {{ a.pause(); a.currentTime = {t_ms}; }}
                    return all.length;
                }})()""", returnByValue=True)
                await asyncio.sleep(0.4)
                shot = await send("Page.captureScreenshot", format="png")
                img = Image.open(io.BytesIO(base64.b64decode(shot["data"])))
                img.thumbnail((300, 560))
                frames.append(img)
                print(f"  {t_ms}ms")

            W = sum(f.width for f in frames) + 8 * (len(frames) - 1)
            sheet = Image.new("RGB", (W, max(f.height for f in frames)), "#888")
            x = 0
            for f in frames:
                sheet.paste(f, (x, 0))
                x += f.width + 8
            sheet.save(os.path.join(OUT, "flip-frames.png"))
            print("-> flip-frames.png")
    finally:
        proc.terminate()


asyncio.run(main())
