"""
Desktop-layout checks. The main suite runs at phone width, so the sidebar
behaviour - zone detail in the panel rather than a modal - is invisible to it.
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request, websockets

CHROME = next((p for p in [
    os.environ.get("CHROME", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
] if os.path.exists(p)), None)
BASE = os.environ.get("APP_BASE", "http://127.0.0.1:8777")
PORT = 9922
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_screenshots", "tour")

PASS, FAIL = [], []
def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' - ' + detail) if detail and not ok else ''}")

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

            print("\nThe desktop rail")
            rail = await ev("""
                const bar = document.querySelector(".tabbar");
                const box = bar.getBoundingClientRect();
                const shown = (el) => getComputedStyle(el).display !== "none";
                const links = [...bar.querySelectorAll("a[data-tab]")].filter(shown);
                const fabBox = document.getElementById("quickBtn").getBoundingClientRect();
                return {
                    vertical: box.height > box.width * 2,
                    onTheLeft: box.left < 40 && box.top < 40,
                    labels: links.map(a => a.querySelector("span").textContent.trim()),
                    brandShown: shown(document.querySelector(".rail__head")),
                    brandDrawn: document.getElementById("railMark").innerHTML.includes("<svg"),
                    groups: [...bar.querySelectorAll(".rail__group")]
                        .filter(shown).map(e => e.textContent.trim()),
                    fabWide: fabBox.width > 150 && fabBox.width >= box.width - 40,
                    fabLabelled: shown(bar.querySelector(".fab__label")),
                    noBump: getComputedStyle(bar, "::before").display === "none",
                    contentClear: document.querySelector("main").getBoundingClientRect().left
                                  >= box.right,
                };
            """)
            check("the nav is a rail down the left",
                  rail["vertical"] and rail["onTheLeft"], str(rail))
            # All destinations are in the rail, including the phone-only-hidden ones.
            check("the rail lists every destination",
                  rail["labels"] == ["Home", "Map", "Log", "Info", "Account", "Settings"],
                  str(rail["labels"]))
            check("the rail carries the brand",
                  rail["brandShown"] and rail["brandDrawn"], str(rail))
            check("the rail groups its links", rail["groups"] == ["Explore", "You"],
                  str(rail["groups"]))
            check("the create button is a full-width labelled action",
                  rail["fabWide"] and rail["fabLabelled"], str(rail))
            check("the phone bar swell is gone", rail["noBump"], str(rail))
            check("content clears the rail", rail["contentClear"], str(rail))

            # Active rail item contrast (a later rule outside the media query
            # once made it near-black on blue).
            contrast = await ev("""
                const lum = (c) => {
                    const [r,g,b] = c.match(/[0-9.]+/g).slice(0,3).map(Number)
                        .map(v => { v /= 255; return v <= .03928 ? v/12.92
                                                 : Math.pow((v+.055)/1.055, 2.4); });
                    return .2126*r + .7152*g + .0722*b;
                };
                const ratio = (fg, bg) => {
                    const a = lum(fg), b = lum(bg);
                    return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
                };
                // Alpha text on the rail resolves against the rail, so it has
                // to be composited rather than measured from the rgba string.
                const over = (fg, bg) => {
                    const f = fg.match(/[0-9.]+/g).map(Number);
                    const b = bg.match(/[0-9.]+/g).map(Number);
                    const a = f.length > 3 ? f[3] : 1;
                    return "rgb(" + [0,1,2].map(i => Math.round(f[i]*a + b[i]*(1-a))).join(",") + ")";
                };
                const bar = document.querySelector(".tabbar");
                const railBg = getComputedStyle(bar).backgroundColor;
                const out = [];
                const add = (name, el, bg) => {
                    if (!el) return;
                    const cs = getComputedStyle(el);
                    const ground = bg || railBg;
                    out.push({ name, r: +ratio(over(cs.color, ground), ground).toFixed(2) });
                };
                add("rail brand", document.querySelector(".rail__name"));
                add("rail group heading", document.querySelector(".rail__group"));
                add("rail idle link", [...bar.querySelectorAll("a[data-tab]")]
                    .find(a => !a.hasAttribute("aria-current")));
                const on = bar.querySelector("a[aria-current='page']");
                add("rail active link", on, on && getComputedStyle(on).backgroundColor);
                const fab = document.getElementById("quickBtn");
                add("rail create button", fab, getComputedStyle(fab).backgroundColor);
                return out;
            """)
            bad = [x["name"] + "=" + str(x["r"]) for x in contrast if x["r"] < 4.5]
            check("every rail text clears 4.5:1", not bad,
                  ", ".join(bad) or str(contrast))

            # --- collapsing -------------------------------------------------
            collapse = await ev("""
                const bar = document.querySelector(".tabbar");
                const main = document.querySelector("main");
                const btn = document.getElementById("railToggle");
                const label = () => bar.querySelector("a[data-tab] span");
                const wide = { rail: Math.round(bar.getBoundingClientRect().width),
                               main: Math.round(main.getBoundingClientRect().left),
                               label: Math.round(label().getBoundingClientRect().width),
                               titled: bar.querySelector("a[data-tab]").hasAttribute("title") };
                btn.click();
                await new Promise(r => setTimeout(r, 800));
                const icon = bar.querySelector("a[data-tab] svg").getBoundingClientRect();
                const railBox = bar.getBoundingClientRect();
                const narrow = {
                    rail: Math.round(railBox.width),
                    main: Math.round(main.getBoundingClientRect().left),
                    label: Math.round(label().getBoundingClientRect().width),
                    // The icons must sit in the MIDDLE of the narrowed rail.
                    // Fading the labels without taking their width back left
                    // them centred around invisible text, hard against the edge.
                    iconOffCentre: Math.abs((icon.left + icon.right) / 2
                                            - (railBox.left + railBox.right) / 2),
                    iconDrawn: icon.width > 12,
                    markShown: document.querySelector(".rail__mark svg")
                                   .getBoundingClientRect().width > 20,
                    titled: bar.querySelector("a[data-tab]").getAttribute("title"),
                    expanded: btn.getAttribute("aria-expanded"),
                    stored: JSON.parse(localStorage.getItem("angler.prefs") || "{}").railCollapsed,
                };
                return { wide, narrow };
            """)
            w, narrow = collapse["wide"], collapse["narrow"]
            check("the rail collapses to a strip", narrow["rail"] < w["rail"] / 2.5,
                  str(collapse))
            check("the page follows it across", narrow["main"] < w["main"] - 100, str(collapse))
            check("the labels give up their width, not just their opacity",
                  w["label"] > 20 and narrow["label"] == 0, str(collapse))
            check("the icons centre in the collapsed rail",
                  narrow["iconDrawn"] and narrow["iconOffCentre"] <= 2, str(narrow))
            # The brand mark is a span inside a link; it must not collapse
            # with the labels.
            check("the brand mark survives the collapse", narrow["markShown"], str(narrow))
            check("collapsed icons get a title to read",
                  not w["titled"] and narrow["titled"] == "Home", str(collapse))
            check("the choice is remembered", narrow["stored"] is True, str(narrow))

            # Collapsed state persists across reloads.
            await send("Page.navigate", url=f"{BASE}/index.html#/info")
            for _ in range(40):
                if await ev("return !!document.querySelector('.species-card');"): break
                await asyncio.sleep(.4)
            await asyncio.sleep(.8)
            kept = await ev("""
                const bar = document.querySelector(".tabbar");
                return { collapsed: document.body.classList.contains("rail-collapsed"),
                         width: Math.round(bar.getBoundingClientRect().width) };
            """)
            check("it is still collapsed after a reload",
                  kept["collapsed"] and kept["width"] < 110, str(kept))

            restored = await ev("""
                document.getElementById("railToggle").click();
                await new Promise(r => setTimeout(r, 800));
                const bar = document.querySelector(".tabbar");
                return { width: Math.round(bar.getBoundingClientRect().width),
                         titled: bar.querySelector("a[data-tab]").hasAttribute("title"),
                         label: Math.round(bar.querySelector("a[data-tab] span")
                                    .getBoundingClientRect().width) };
            """)
            check("and expands again cleanly",
                  restored["width"] > 200 and restored["label"] > 20
                  and not restored["titled"], str(restored))

            # The phone nav-hiding must not leave rail links unfocusable.
            await send("Page.navigate", url=f"{BASE}/index.html#/map")
            for _ in range(60):
                if await ev("return !!document.querySelector('#mapWeather .now-card__temp');"): break
                await asyncio.sleep(.4)
            await asyncio.sleep(1.0)
            onmap = await ev("""
                const bar = document.querySelector(".tabbar");
                const links = [...bar.querySelectorAll("a[data-tab]")];
                const strip = document.querySelector(".map-screen__top");
                return { hidden: document.body.classList.contains("is-nav-hidden"),
                         shown: getComputedStyle(bar).display !== "none",
                         inert: bar.hasAttribute("inert"),
                         width: Math.round(bar.getBoundingClientRect().width),
                         // The phone's back-to-home strip would be redundant
                         // chrome here: the rail is already on screen.
                         stripHidden: !!strip && getComputedStyle(strip).display === "none",
                         focusable: links.every(a => a.getAttribute("tabindex") !== "-1") };
            """)
            check("the map does not hide the rail",
                  not onmap["hidden"] and onmap["shown"] and not onmap["inert"]
                  and onmap["width"] > 200, str(onmap))
            check("no back-to-home strip where the rail is already visible",
                  onmap["stripHidden"], str(onmap))
            check("the rail stays keyboard-reachable on the map",
                  onmap["focusable"], str(onmap))

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


            # Desktop: the map's left edge is flush with the sidebar; only the
            # window-facing sides are inset.
            inset = await ev("""
                const map = document.getElementById('fishMap').getBoundingClientRect();
                const side = document.querySelector('.map-screen__info').getBoundingClientRect();
                return {
                    right: Math.round(window.innerWidth - map.right),
                    top: Math.round(map.top),
                    fromSidebar: Math.round(map.left - side.right),
                    w: Math.round(map.width),
                };
            """)
            check("the map is inset from the right of the window",
                  inset["right"] >= 8, f"{inset['right']}px")
            check("the map is inset from the top", inset["top"] >= 8, f"{inset['top']}px")
            check("the map still meets the sidebar border",
                  abs(inset["fromSidebar"]) <= 2, f"{inset['fromSidebar']}px")
            check("insetting the map did not collapse it", inset["w"] > 400, str(inset))
            # No drawer or grip on desktop.
            sidebar = await ev("""
                const d = document.getElementById('wxDrawer');
                const grip = document.getElementById('wxGrip');
                const cs = getComputedStyle(d);
                const map = document.getElementById('fishMap').getBoundingClientRect();
                const box = d.getBoundingClientRect();
                return {
                    inFlow: cs.position === 'static',
                    gripHidden: getComputedStyle(grip).display === 'none',
                    notCollapsed: !d.classList.contains('is-collapsed'),
                    noTransform: cs.transform === 'none',
                    // Beside the map, not over it.
                    besideNotOver: box.right <= map.left + 2,
                    lift: cs.getPropertyValue('--wx-visible').trim(),
                };
            """)
            check("the weather is a sidebar, not a drawer, on desktop",
                  sidebar["inFlow"] and sidebar["gripHidden"], str(sidebar))
            check("the sidebar sits beside the map rather than over it",
                  sidebar["besideNotOver"] and sidebar["noTransform"], str(sidebar))

            # The filters are for both layouts, unlike the drawer.
            filters = await ev("""
                const zones = () => document.querySelectorAll('.zone-pin').length;
                const btn = (n) => document.querySelector(`[data-layer="${n}"]`);
                if (!btn('zones')) return { present: false };
                const before = zones();
                btn('zones').click();
                await new Promise(r => setTimeout(r, 300));
                const off = zones();
                btn('zones').click();
                await new Promise(r => setTimeout(r, 300));
                return { present: true, before, off, back: zones(),
                         overMap: (() => {
                             const f = document.getElementById('mapFilters').getBoundingClientRect();
                             const m = document.getElementById('fishMap').getBoundingClientRect();
                             return f.top >= m.top - 2 && f.left >= m.left - 2
                                 && f.right <= m.right + 2;
                         })() };
            """)
            check("the layer filters are on desktop too",
                  filters["present"] and filters["overMap"], str(filters))
            check("the desktop Zones filter works",
                  filters["off"] == 0 and filters["back"] == filters["before"], str(filters))

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

            # A fish opens in the sidebar panel too (no sheet here).
            drill = await ev("""
                const panel = document.getElementById('zonePanel');
                const zoneTitle = panel.querySelector('.zone-panel__head h2').textContent;
                panel.querySelector('[data-species-detail]').click();
                await new Promise(r => setTimeout(r, 500));
                return {
                    zoneTitle,
                    title: panel.querySelector('.zone-panel__head h2').textContent,
                    isSpeciesCard: panel.innerText.includes('FishBase'),
                    hasBack: !!panel.querySelector('[data-back-to-zone]'),
                    stillClosable: !!panel.querySelector('[data-close-zone]'),
                    noModal: !document.querySelector('.sheet-backdrop'),
                    hash: location.hash,
                };
            """)
            check("a zone's fish opens in the sidebar",
                  drill["isSpeciesCard"] and drill["title"] != drill["zoneTitle"], str(drill))
            check("opening a fish raises no modal on desktop",
                  drill["noModal"] and drill["hash"] == "#/map", str(drill))
            check("the sidebar keeps its close button while showing a fish",
                  drill["stillClosable"] and drill["hasBack"], str(drill))

            went_back = await ev("""
                const panel = document.getElementById('zonePanel');
                panel.querySelector('[data-back-to-zone]').click();
                await new Promise(r => setTimeout(r, 400));
                return { onZone: panel.innerText.includes('Possible catches'),
                         closable: !!panel.querySelector('[data-close-zone]') };
            """)
            check("the sidebar goes back to the zone",
                  went_back["onZone"] and went_back["closable"], str(went_back))

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
