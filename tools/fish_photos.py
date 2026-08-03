"""
Species photo pipeline — iNaturalist + GBIF -> licence filter -> rank -> review
-> background removal -> a manifest the app reads.

Four stages, run in order. Every one is re-runnable and skips work already
done, so adding a species later costs only that species.

    python tools/fish_photos.py fetch     # candidates + metadata, no images yet
    python tools/fish_photos.py review    # contact sheet in your browser
    python tools/fish_photos.py build     # rembg -> white bg -> manifest
    python tools/fish_photos.py status    # what is done, what is missing

Optional, between fetch and review:

    python tools/fish_photos.py score     # ask Gemini about the doubtful ones

WHAT THIS CAN AND CANNOT DECIDE
-------------------------------
Licensing it decides completely: only CC0, CC-BY and CC-BY-SA are ever kept,
and the credit line required by the licence is carried through to the app.

Whether a photo is a clean side-profile of a whole fish out of water, it
cannot. No API exposes that. What it can read are proxies — iNaturalist's
"Alive or Dead" annotation (dead almost always means landed and laid out),
research-grade status, image proportions, how many people agreed on the ID —
and it ranks by those. The last call is yours in `review`, or Gemini's in
`score` for the ones the proxies leave doubtful.

SOURCES AND KEYS
----------------
iNaturalist and GBIF are both open and need no key or account.
Gemini is optional; only `score` uses it, via GEMINI_API_KEY in the
environment. Everything else runs without it.

Background removal uses rembg (u2net). First run downloads ~176 MB to
~/.u2net. Install with:

    python -m pip install "rembg[cpu]" onnxruntime pillow
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECIES_JS = ROOT / "js" / "data" / "species" / "indo-pacific.js"
WORK = ROOT / "tools" / "_photo_work"          # gitignored scratch
CANDIDATES = WORK / "candidates.json"
PICKS = WORK / "picks.json"                    # your choices, kept across runs
RAW = WORK / "raw"
OUT_DIR = ROOT / "assets" / "photos"
MANIFEST_JS = ROOT / "js" / "data" / "species-photos.js"
REVIEW_HTML = WORK / "review.html"

UA = "ColesAnglerLog/2.0 (personal fishing app; contact via github.com/Awakelol)"

# The only licences that may ship. Anything else is skipped outright rather
# than downloaded and sorted out later — a file on disk is a file that can be
# published by accident.
OK_LICENCES = {"cc0", "cc-by", "cc-by-sa"}
LICENCE_LABEL = {
    "cc0": "CC0",
    "cc-by": "CC BY",
    "cc-by-sa": "CC BY-SA",
}

CANDIDATES_PER_SPECIES = 10
REQUEST_PAUSE = 1.1        # iNat asks for <=1 req/sec sustained; be a good guest


# --------------------------------------------------------------------------
# the species list, read straight from the app so the two cannot drift
# --------------------------------------------------------------------------

def load_species():
    src = SPECIES_JS.read_text(encoding="utf-8")
    out = []
    for block in re.findall(r"\{\s*\n\s*id: '([a-z0-9-]+)',(.*?)\n  \},", src, re.S):
        sid, body = block
        def field(name):
            m = re.search(rf"{name}: '([^']*)'", body)
            return m.group(1) if m else ""
        out.append({
            "id": sid,
            "scientific": field("scientific"),
            "common": field("common"),
        })
    return out


def get_json(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if attempt == tries - 1:
                print(f"    ! {e}")
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


# --------------------------------------------------------------------------
# stage 1 — fetch
# --------------------------------------------------------------------------

def inat_place_id(name="Philippines"):
    """Resolved rather than hardcoded, so a renumbered place doesn't silently
    turn the geographic preference off."""
    data = get_json("https://api.inaturalist.org/v1/places/autocomplete?q="
                    + urllib.parse.quote(name))
    for r in (data or {}).get("results", []):
        if r.get("name") == name and r.get("admin_level") == 0:
            return r.get("id")
    return None


def inat_candidates(sci, place_id):
    """iNaturalist observations, licence-filtered at the API rather than here."""
    found = []
    # Two passes: the region first, then the world. Local fish photographed
    # locally are the ones an angler here will recognise, but a species with
    # no Philippine observations must not end up with no photo at all.
    for scope in ("local", "global"):
        if scope == "local" and not place_id:
            continue
        params = {
            "taxon_name": sci,
            "photo_license": "cc0,cc-by,cc-by-sa",
            "per_page": 30,
            "order_by": "votes",
            "photos": "true",
        }
        if scope == "local":
            params["place_id"] = place_id
        url = "https://api.inaturalist.org/v1/observations?" + urllib.parse.urlencode(params)
        data = get_json(url)
        time.sleep(REQUEST_PAUSE)
        for obs in (data or {}).get("results", []):
            # "Alive or Dead" — a landed fish is laid out, side on, in air.
            # This is the single most useful signal the API actually exposes.
            dead = any(a.get("controlled_attribute_id") == 17
                       and a.get("controlled_value_id") == 20
                       for a in obs.get("annotations", []))
            for ph in obs.get("photos", []):
                lic = (ph.get("license_code") or "").lower()
                if lic not in OK_LICENCES:
                    continue
                dims = ph.get("original_dimensions") or {}
                found.append({
                    "source": "inaturalist",
                    "scope": scope,
                    "url": (ph.get("url") or "").replace("/square.", "/original."),
                    "licence": lic,
                    "credit": ph.get("attribution") or "",
                    "page": f"https://www.inaturalist.org/observations/{obs.get('id')}",
                    "width": dims.get("width") or 0,
                    "height": dims.get("height") or 0,
                    "dead": dead,
                    "research": obs.get("quality_grade") == "research",
                    "agreements": obs.get("num_identification_agreements") or 0,
                })
        if len(found) >= CANDIDATES_PER_SPECIES * 2:
            break
    return found


def gbif_candidates(sci):
    """GBIF as the backstop. Its media licences are inconsistently recorded, so
    anything without an explicitly acceptable one is dropped."""
    url = ("https://api.gbif.org/v1/occurrence/search?"
           + urllib.parse.urlencode({"scientificName": sci, "mediaType": "StillImage",
                                     "limit": 20}))
    data = get_json(url)
    time.sleep(0.4)
    out = []
    for rec in (data or {}).get("results", []):
        for m in rec.get("media", []):
            lic = (m.get("license") or "").lower()
            code = ("cc0" if "zero" in lic or "cc0" in lic else
                    "cc-by-sa" if "by-sa" in lic else
                    "cc-by" if "by" in lic and "nc" not in lic and "nd" not in lic else "")
            if code not in OK_LICENCES or not m.get("identifier"):
                continue
            out.append({
                "source": "gbif",
                "scope": "global",
                "url": m["identifier"],
                "licence": code,
                "credit": m.get("rightsHolder") or rec.get("recordedBy") or "GBIF contributor",
                "page": f"https://www.gbif.org/occurrence/{rec.get('key')}",
                "width": 0, "height": 0,
                "dead": rec.get("basisOfRecord") in ("PRESERVED_SPECIMEN", "MATERIAL_SAMPLE"),
                "research": False,
                "agreements": 0,
            })
    return out


def rank(cands):
    """Order by the signals we can actually read.

    Landscape is weighted because a fish photographed side-on fills a wide
    frame; a portrait crop is usually someone holding it vertically or a
    close-up of a head. It is a tendency, not a rule, which is exactly why
    this ranks rather than filters.
    """
    def score(c):
        s = 0.0
        if c["dead"]:
            s += 3.0          # landed, in air, laid out
        if c["research"]:
            s += 1.5
        if c["scope"] == "local":
            s += 1.5          # photographed in the Philippines
        s += min(c["agreements"], 4) * 0.25
        w, h = c["width"], c["height"]
        if w and h:
            ar = w / h
            if 1.2 <= ar <= 2.2:
                s += 1.5      # side-on proportions
            elif ar < 0.9:
                s -= 1.0      # portrait: usually held up or a close-up
            if min(w, h) >= 1200:
                s += 0.5
        if c["source"] == "inaturalist":
            s += 0.5
        return s

    for c in cands:
        c["score"] = round(score(c), 2)
    cands.sort(key=lambda c: -c["score"])
    # Same photo can arrive from both sources.
    seen, unique = set(), []
    for c in cands:
        key = c["url"].split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    return unique[:CANDIDATES_PER_SPECIES]


def confidence(cands):
    """How much the ranking should be trusted for this species.

    Low means the proxies had little to go on — no landed shot, nothing local,
    or barely any candidates — and a human or Gemini should look.
    """
    if not cands:
        return 0.0
    top = cands[0]
    c = 0.35
    if top["dead"]:
        c += 0.3
    if top["scope"] == "local":
        c += 0.15
    if top["research"]:
        c += 0.1
    if len(cands) >= 4:
        c += 0.1
    return round(min(c, 1.0), 2)


def cmd_fetch(args):
    WORK.mkdir(parents=True, exist_ok=True)
    species = load_species()
    if args.only:
        species = [s for s in species if s["id"] in args.only]
    existing = json.loads(CANDIDATES.read_text(encoding="utf-8")) if CANDIDATES.exists() else {}

    place = inat_place_id()
    print(f"iNaturalist place id for the Philippines: {place or 'not found, going global'}")
    print(f"{len(species)} species to look at\n")

    for i, sp in enumerate(species, 1):
        if sp["id"] in existing and not args.refresh:
            print(f"[{i}/{len(species)}] {sp['id']}: already fetched, skipping")
            continue
        print(f"[{i}/{len(species)}] {sp['id']}  ({sp['scientific']})")
        cands = rank(inat_candidates(sp["scientific"], place) + gbif_candidates(sp["scientific"]))
        conf = confidence(cands)
        existing[sp["id"]] = {
            "scientific": sp["scientific"], "common": sp["common"],
            "confidence": conf, "candidates": cands,
        }
        flag = "" if conf >= 0.6 else "   <- doubtful, worth a look"
        print(f"    {len(cands)} usable, confidence {conf}{flag}")
        CANDIDATES.write_text(json.dumps(existing, indent=1), encoding="utf-8")

    none = [k for k, v in existing.items() if not v["candidates"]]
    print(f"\nDone. {len(existing)} species, {len(none)} with no licensed photo at all.")
    if none:
        print("  " + ", ".join(none))
    print("Next: python tools/fish_photos.py review")


# --------------------------------------------------------------------------
# stage 2 — review
# --------------------------------------------------------------------------

def cmd_review(args):
    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    picks = json.loads(PICKS.read_text(encoding="utf-8")) if PICKS.exists() else {}
    order = sorted(data.items(), key=lambda kv: (kv[1]["confidence"], kv[0]))

    rows = []
    for sid, rec in order:
        if args.doubtful and rec["confidence"] >= 0.6:
            continue
        cells = []
        for idx, c in enumerate(rec["candidates"]):
            gem = c.get("gemini")
            note = f"<div class='g'>{gem['score']:.2f} · {gem['why']}</div>" if gem else ""
            cells.append(
                f"<label class='cand'><input type='radio' name='{sid}' value='{idx}'"
                f"{' checked' if picks.get(sid) == idx else ''}>"
                f"<img src='{c['url']}' loading='lazy' referrerpolicy='no-referrer'>"
                f"<div class='meta'>#{idx} · {c['score']} · {LICENCE_LABEL[c['licence']]}"
                f"{' · landed' if c['dead'] else ''}{' · PH' if c['scope']=='local' else ''}</div>"
                f"{note}</label>")
        if not cells:
            cells.append("<p class='none'>No licensed photo found for this species.</p>")
        rows.append(
            f"<section id='{sid}'><h2>{rec['common']} <small>{rec['scientific']}</small>"
            f"<span class='conf c{int(rec['confidence']*10)}'>{rec['confidence']}</span></h2>"
            f"<label class='skip'><input type='radio' name='{sid}' value='-1'"
            f"{' checked' if picks.get(sid) == -1 else ''}> none of these</label>"
            f"<div class='row'>{''.join(cells)}</div></section>")

    total = len(rows)
    REVIEW_HTML.write_text(f"""<!doctype html><meta charset=utf-8>
<title>Pick a photo per species</title>
<style>
 body{{font:14px/1.5 system-ui;margin:0;padding:20px;background:#10141c;color:#e6edf3}}
 h1{{position:sticky;top:0;background:#10141c;margin:0 0 6px;padding:10px 0;z-index:2}}
 section{{border-top:1px solid #30363d;padding:14px 0}}
 h2{{font-size:17px;margin:0 0 8px}} h2 small{{font-weight:400;color:#8b949e;font-style:italic}}
 .conf{{float:right;font:700 12px/1 monospace;padding:4px 8px;border-radius:99px;background:#30363d}}
 .conf.c0,.conf.c1,.conf.c2,.conf.c3,.conf.c4,.conf.c5{{background:#7d1226}}
 .row{{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}}
 .cand{{flex:0 0 210px;cursor:pointer;display:block}}
 .cand img{{width:210px;height:150px;object-fit:cover;border-radius:8px;
            border:3px solid transparent;background:#161b22;display:block}}
 .cand input{{position:absolute;opacity:0}}
 .cand input:checked + img{{border-color:#3fbf7f}}
 .meta{{font:600 11px monospace;color:#8b949e;margin-top:4px}}
 .g{{font-size:11px;color:#d29922}}
 .skip{{display:inline-block;margin-bottom:8px;color:#8b949e}}
 .none{{color:#f26430}}
 #bar{{position:fixed;left:0;right:0;bottom:0;background:#161b22;border-top:1px solid #30363d;
       padding:12px 20px;display:flex;gap:12px;align-items:center}}
 button{{font:700 14px system-ui;padding:9px 16px;border-radius:8px;border:0;
         background:#3fbf7f;color:#0d1117;cursor:pointer}}
 textarea{{flex:1;height:34px;font:11px monospace;background:#0d1117;color:#e6edf3;
           border:1px solid #30363d;border-radius:6px;padding:6px}}
</style>
<h1>Pick one photo per species — side-on, whole fish, out of water where possible</h1>
<p>Ordered by confidence, least certain first. Choosing nothing leaves the species without a photo,
which the app shows honestly rather than faking.</p>
{''.join(rows)}
<div id=bar>
  <strong id=count>0</strong><span>picked — saved as you go, close the tab when done</span>
  <span id=state></span>
</div>
<script>
const total = {total};
async function save(name, value) {{
  const s = document.getElementById('state');
  s.textContent = 'saving…';
  try {{
    const r = await fetch('/pick', {{ method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ id: name, index: value }}) }});
    const j = await r.json();
    document.getElementById('count').textContent = j.picked + ' / ' + total;
    s.textContent = 'saved';
  }} catch (e) {{ s.textContent = 'NOT SAVED — is the review server still running?'; }}
}}
document.addEventListener('change', (e) => {{
  if (e.target.matches('input[type=radio]')) save(e.target.name, +e.target.value);
}});
document.getElementById('count').textContent =
  document.querySelectorAll('input:checked').length + ' / ' + total;
</script>""", encoding="utf-8")

    if args.no_open:
        print(f"Wrote {REVIEW_HTML} (not served)")
        return 0
    serve_review(args.port)
    return 0


def serve_review(port):
    """Serve the sheet and take the picks straight to disk.

    A file:// page cannot write anything, which is why this used to end in a
    copy-and-paste. Over 68 species that is a step too many and a chance to
    lose the lot to a mistyped paste, so the page posts each choice here and
    it lands in picks.json as you click.
    """
    import http.server, socketserver, threading

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path in ("/", "/index.html"):
                body = REVIEW_HTML.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_error(404)

        def do_POST(self):
            if self.path != "/pick":
                return self.send_error(404)
            n = int(self.headers.get("Content-Length", 0))
            try:
                msg = json.loads(self.rfile.read(n) or b"{}")
                picks = json.loads(PICKS.read_text(encoding="utf-8")) if PICKS.exists() else {}
                picks[msg["id"]] = int(msg["index"])
                PICKS.write_text(json.dumps(picks, indent=1, sort_keys=True), encoding="utf-8")
                out = json.dumps({"ok": True, "picked": len([v for v in picks.values() if v >= 0])})
            except Exception as e:
                out = json.dumps({"ok": False, "error": str(e)})
            body = out.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass          # the picks counter in the page is the only progress worth seeing

    with socketserver.TCPServer(("127.0.0.1", port), Handler) as srv:
        url = f"http://127.0.0.1:{port}/"
        print(f"Review sheet: {url}")
        print(f"Picks save to {PICKS} as you click.")
        print("Ctrl+C here when you are done, then: python tools/fish_photos.py build\n")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            picks = json.loads(PICKS.read_text(encoding="utf-8")) if PICKS.exists() else {}
            print(f"\nStopped. {len([v for v in picks.values() if v >= 0])} species picked.")


# --------------------------------------------------------------------------
# stage 2b — optional Gemini opinion on the doubtful ones
# --------------------------------------------------------------------------

def read_key(name):
    """`.dev.vars` first, then the environment.

    `.dev.vars` is where wrangler already looks for local secrets and is
    already gitignored, so the key has one home for both the Worker and this
    script rather than one each. An environment variable still wins nothing
    and loses nothing — it is checked second so a one-off override works.
    """
    dev = ROOT / ".dev.vars"
    if dev.exists():
        for line in dev.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                return v.strip().strip('"').strip("'")
    return os.environ.get(name, "").strip()


def cmd_score(args):
    key = read_key("GEMINI_API_KEY")
    if not key:
        print("No GEMINI_API_KEY found.")
        print()
        print("Put it in .dev.vars in the project root (already gitignored):")
        print("    GEMINI_API_KEY=your-key-here")
        print()
        print("That is the same file wrangler reads for local Worker runs, so")
        print("the key lives in one place. Or set it for this shell only:")
        print('    $env:GEMINI_API_KEY = "your-key-here"')
        return 1
    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    model = read_key("GEMINI_MODEL") or "gemini-2.5-flash"
    todo = [(k, v) for k, v in data.items()
            if v["candidates"] and (v["confidence"] < args.below or args.all)]
    print(f"{len(todo)} species below confidence {args.below}\n")

    for sid, rec in todo:
        for c in rec["candidates"][:args.per]:
            if c.get("gemini"):
                continue
            try:
                req = urllib.request.Request(c["url"], headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=40) as r:
                    blob = r.read()
            except Exception as e:
                print(f"  {sid}: could not fetch candidate — {e}")
                continue
            import base64
            body = json.dumps({
                "contents": [{"parts": [
                    {"text": "Rate this photo for use as a field-guide illustration of a "
                             "single fish. Reply as JSON only: {\"score\": 0..1, \"why\": "
                             "\"<=8 words\"}. Score high for: whole fish, side profile, out "
                             "of water on a flat surface or held clear, uncluttered "
                             "background, sharp. Score low for: underwater, murky, cluttered "
                             "market pile, extreme close-up, multiple fish, obscured fins."},
                    {"inline_data": {"mime_type": "image/jpeg",
                                     "data": base64.b64encode(blob).decode()}},
                ]}],
                "generationConfig": {"responseMimeType": "application/json"},
            }).encode()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            try:
                rq = urllib.request.Request(url, data=body, headers={
                    "Content-Type": "application/json", "x-goog-api-key": key})
                with urllib.request.urlopen(rq, timeout=60) as r:
                    out = json.load(r)
                txt = out["candidates"][0]["content"]["parts"][0]["text"]
                got = json.loads(txt)
                c["gemini"] = {"score": float(got.get("score", 0)),
                               "why": str(got.get("why", ""))[:60]}
                print(f"  {sid} #{rec['candidates'].index(c)}  {c['gemini']['score']:.2f}  "
                      f"{c['gemini']['why']}")
            except Exception as e:
                print(f"  {sid}: scoring failed — {e}")
            time.sleep(0.6)
        # Re-order this species by Gemini's opinion where it has one.
        rec["candidates"].sort(key=lambda c: -(c.get("gemini", {}).get("score", -1)))
        CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print("\nDone. Re-run `review` to see the scores against each thumbnail.")
    return 0


# --------------------------------------------------------------------------
# stage 3 — build
# --------------------------------------------------------------------------

CARD_W, CARD_H = 800, 600      # 4:3, the ratio the species card frame uses


def cmd_build(args):
    from PIL import Image
    from rembg import remove, new_session

    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    picks = json.loads(PICKS.read_text(encoding="utf-8")) if PICKS.exists() else {}
    if not picks:
        print("No picks yet. Run `review`, choose, and save tools/_photo_work/picks.json")
        return 1

    RAW.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = new_session("u2net")
    manifest = {}

    for sid, idx in sorted(picks.items()):
        rec = data.get(sid)
        if not rec or idx is None or idx < 0 or idx >= len(rec["candidates"]):
            continue
        cand = rec["candidates"][idx]
        out_png = OUT_DIR / f"{sid}.png"
        raw_path = RAW / f"{sid}{Path(urllib.parse.urlparse(cand['url']).path).suffix or '.jpg'}"

        if not raw_path.exists() or args.refresh:
            try:
                req = urllib.request.Request(cand["url"], headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw_path.write_bytes(r.read())
            except Exception as e:
                print(f"  {sid}: download failed — {e}")
                continue

        if not out_png.exists() or args.refresh:
            try:
                src = Image.open(raw_path).convert("RGBA")
                cut = remove(src, session=session)
                # Trim to what is left, so every fish fills its frame the same
                # way regardless of how much sea the photographer included.
                bbox = cut.getbbox()
                if bbox:
                    cut = cut.crop(bbox)
                cut.thumbnail((CARD_W - 40, CARD_H - 40), Image.LANCZOS)
                canvas = Image.new("RGB", (CARD_W, CARD_H), "white")
                canvas.paste(cut, ((CARD_W - cut.width) // 2,
                                   (CARD_H - cut.height) // 2), cut)
                canvas.save(out_png, "PNG", optimize=True)
                print(f"  {sid}: {out_png.name}  {out_png.stat().st_size // 1024} KB")
            except Exception as e:
                print(f"  {sid}: background removal failed — {e}")
                continue

        manifest[sid] = {
            "file": f"assets/photos/{sid}.png",
            "credit": re.sub(r"\s+", " ", cand["credit"]).strip()[:120],
            "licence": LICENCE_LABEL[cand["licence"]],
            "source": cand["page"],
        }

    write_manifest(manifest)
    print(f"\n{len(manifest)} photos in {OUT_DIR}")
    print(f"Manifest: {MANIFEST_JS}")
    return 0


def write_manifest(manifest):
    lines = [
        "// GENERATED by tools/fish_photos.py — do not edit by hand.",
        "//",
        "// One entry per species that has a usable, openly licensed photo. A",
        "// species missing from here has no photo, and the card says so rather",
        "// than showing something that could be mistaken for the fish.",
        "//",
        "// `credit` and `licence` are not decoration: CC BY and CC BY-SA both",
        "// require attribution, so the card that shows the photo shows these.",
        "",
        "export const SPECIES_PHOTOS = {",
    ]
    for sid in sorted(manifest):
        m = manifest[sid]
        esc = lambda v: v.replace("\\", "\\\\").replace("'", "\\'")
        lines.append(
            f"  '{sid}': {{ file: '{esc(m['file'])}', credit: '{esc(m['credit'])}', "
            f"licence: '{esc(m['licence'])}', source: '{esc(m['source'])}' }},")
    lines += ["};", "",
              "export const photoFor = (id) => SPECIES_PHOTOS[id] || null;", ""]
    MANIFEST_JS.write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------

def cmd_status(args):
    species = load_species()
    data = json.loads(CANDIDATES.read_text(encoding="utf-8")) if CANDIDATES.exists() else {}
    picks = json.loads(PICKS.read_text(encoding="utf-8")) if PICKS.exists() else {}
    built = {p.stem for p in OUT_DIR.glob("*.png")} if OUT_DIR.exists() else set()

    no_cands = [s["id"] for s in species if s["id"] in data and not data[s["id"]]["candidates"]]
    doubtful = [s["id"] for s in species
                if s["id"] in data and data[s["id"]]["candidates"]
                and data[s["id"]]["confidence"] < 0.6]
    print(f"species        {len(species)}")
    print(f"fetched        {len(data)}")
    print(f"no licensed photo {len(no_cands)}")
    print(f"low confidence {len(doubtful)}")
    print(f"picked         {len(picks)}")
    print(f"built          {len(built)}")
    missing = [s['id'] for s in species if s['id'] not in built]
    if missing:
        print(f"\nwithout a photo ({len(missing)}):")
        print("  " + ", ".join(missing[:40]) + (" ..." if len(missing) > 40 else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="find licensed candidates")
    f.add_argument("--only", nargs="*", help="species ids, default all")
    f.add_argument("--refresh", action="store_true", help="re-query species already done")
    f.set_defaults(fn=cmd_fetch)

    r = sub.add_parser("review", help="contact sheet to pick from")
    r.add_argument("--doubtful", action="store_true", help="only the low-confidence ones")
    r.add_argument("--no-open", action="store_true", help="write the file, don't serve it")
    r.add_argument("--port", type=int, default=8123)
    r.set_defaults(fn=cmd_review)

    s = sub.add_parser("score", help="ask Gemini about the doubtful ones")
    s.add_argument("--below", type=float, default=0.6)
    s.add_argument("--per", type=int, default=4, help="candidates to score per species")
    s.add_argument("--all", action="store_true")
    s.set_defaults(fn=cmd_score)

    b = sub.add_parser("build", help="background removal + manifest")
    b.add_argument("--refresh", action="store_true")
    b.set_defaults(fn=cmd_build)

    st = sub.add_parser("status", help="what is done")
    st.set_defaults(fn=cmd_status)

    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
