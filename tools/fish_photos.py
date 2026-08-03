"""
Species photo pipeline — iNaturalist + GBIF -> licence filter -> rank -> review
-> background removal -> a manifest the app reads.

Four stages, run in order. Every one is re-runnable and skips work already
done, so adding a species later costs only that species.

    python tools/fish_photos.py fetch     # candidates + metadata, no images yet
    python tools/fish_photos.py review    # contact sheet in your browser
    python tools/fish_photos.py build     # rembg -> white bg -> manifest
    python tools/fish_photos.py status    # what is done, what is missing

Optional, driven by what you flag while reviewing:

    python tools/fish_photos.py more            # dig deeper where you said "give me more"
    python tools/fish_photos.py score --unsure  # ask Gemini about the ones you flagged
    python tools/fish_photos.py verify          # check the picks before building
    python tools/fish_photos.py verify --gemini # ...and have a model look at them

In `review` each species takes one of five states: a chosen photo, "no good
ones", "give me more", "unsure" (which may still name a favourite), or nothing
at all. Clicking a chosen photo again, or a lit verdict again, clears it.

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

def html_escape(text):
    """Remarks are free text and land inside a <textarea>. A stray `</textarea>`
    typed in a note would otherwise end the field and spill the rest of the
    page into it."""
    return (str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def cmd_review(args):
    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    picks = load_picks()
    order = sorted(data.items(), key=lambda kv: (kv[1]["confidence"], kv[0]))

    rows = []
    for sid, rec in order:
        if args.doubtful and rec["confidence"] >= 0.6:
            continue
        chosen = picks.get(sid, {})
        cells = []
        for idx, c in enumerate(rec["candidates"]):
            gem = c.get("gemini")
            note = f"<div class='g'>gemini {gem['score']:.2f} · {gem['why']}</div>" if gem else ""
            dims = f"{c['width']}&times;{c['height']}" if c["width"] else "size unknown"
            sel = " is-on" if chosen.get("index") == idx else ""
            cells.append(
                f"<div class='cand{sel}' data-sp='{sid}' data-idx='{idx}'>"
                f"<img src='{c['url']}' loading='lazy' referrerpolicy='no-referrer'>"
                f"<div class='meta'>#{idx} · rank {c['score']} · {LICENCE_LABEL[c['licence']]}"
                f"{' · landed' if c['dead'] else ''}{' · PH' if c['scope'] == 'local' else ''}</div>"
                f"<div class='meta dim'>{dims} · "
                f"<a href='{c['url']}' target='_blank' rel='noreferrer'>open full size &nearr;</a></div>"
                f"{note}</div>")
        if not cells:
            cells.append("<p class='nofind'>No openly licensed photo exists for this species.</p>")

        v = chosen.get("verdict", "")
        btn = lambda kind, label: (
            f"<button class='v v--{kind}{' is-on' if v == kind else ''}' "
            f"data-sp='{sid}' data-verdict='{kind}'>{label}</button>")
        rows.append(
            f"<section id='{sid}' data-sp='{sid}' data-verdict='{v}'>"
            f"<h2>{rec['common']} <small>{rec['scientific']}</small>"
            f"<span class='conf c{int(rec['confidence'] * 10)}'>{rec['confidence']}</span></h2>"
            f"<div class='verdicts'>"
            f"{btn('none', 'No good ones')}"
            f"{btn('more', 'Give me more')}"
            f"{btn('unsure', 'Unsure')}"
            f"<button class='v v--clear' data-sp='{sid}' data-verdict='clear'>Clear</button>"
            f"<span class='state' data-state='{sid}'></span>"
            f"</div>"
            f"<div class='row'>{''.join(cells)}</div>"
            f"<textarea class='note' data-sp='{sid}' rows='1' "
            f"placeholder='Remarks — what is wrong with these, what to look for instead'>"
            f"{html_escape(chosen.get('note', ''))}</textarea>"
            f"</section>")

    total = len(rows)
    REVIEW_HTML.write_text(f"""<!doctype html><meta charset=utf-8>
<title>Pick a photo per species</title>
<style>
 body{{font:14px/1.5 system-ui;margin:0;padding:16px 20px 96px;background:#10141c;color:#e6edf3}}
 h1{{font-size:19px;margin:0 0 4px}}
 .lede{{color:#8b949e;margin:0 0 14px;max-width:70ch}}
 section{{border-top:1px solid #30363d;padding:14px 0}}
 section[data-verdict="none"]{{opacity:.55}}
 section[data-verdict="more"]{{box-shadow:inset 3px 0 0 #d29922;padding-left:12px}}
 section[data-verdict="unsure"]{{box-shadow:inset 3px 0 0 #8b5cf6;padding-left:12px}}
 h2{{font-size:17px;margin:0 0 8px}} h2 small{{font-weight:400;color:#8b949e;font-style:italic}}
 .conf{{float:right;font:700 12px/1 monospace;padding:4px 8px;border-radius:99px;background:#30363d}}
 .conf.c0,.conf.c1,.conf.c2,.conf.c3,.conf.c4,.conf.c5{{background:#7d1226}}

 .verdicts{{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}}
 .v{{font:800 12px system-ui;padding:6px 12px;border-radius:99px;cursor:pointer;
     border:1px solid #30363d;background:#161b22;color:#8b949e}}
 .v:hover{{border-color:#8b949e}}
 .v--none.is-on{{background:#7d1226;border-color:#7d1226;color:#fff}}
 .v--more.is-on{{background:#d29922;border-color:#d29922;color:#0d1117}}
 .v--unsure.is-on{{background:#8b5cf6;border-color:#8b5cf6;color:#fff}}
 .state{{font:700 11px monospace;color:#3fb950}}

 .row{{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}}
 .cand{{flex:0 0 280px;cursor:pointer}}
 /* contain, not cover. Cover cropped the tails and fins off, which are exactly
    what you are looking at to judge the fish. */
 .cand img{{width:280px;height:210px;object-fit:contain;border-radius:8px;
            border:3px solid transparent;background:#0d1117;display:block}}
 .cand.is-on img{{border-color:#3fb950}}
 .cand:hover img{{border-color:#8b949e}}
 .cand.is-on .meta{{color:#3fb950}}
 .meta{{font:600 11px monospace;color:#8b949e;margin-top:4px}}
 .meta.dim{{color:#6e7681}} .meta a{{color:#58a6ff}}
 .g{{font-size:11px;color:#d29922}}
 .nofind{{color:#f26430}}
 .note{{width:100%;margin-top:8px;font:13px/1.5 system-ui;background:#0d1117;color:#e6edf3;
        border:1px solid #30363d;border-radius:8px;padding:8px 10px;resize:vertical;
        min-height:36px;box-sizing:border-box}}
 .note:focus{{outline:none;border-color:#58a6ff}}
 .note:not(:placeholder-shown){{border-color:#d29922;background:#14120c}}
 section:has(.note:not(:placeholder-shown)) h2::after{{content:' ✎';color:#d29922}}

 #bar{{position:fixed;left:0;right:0;bottom:0;background:#161b22;border-top:1px solid #30363d;
       padding:12px 20px;display:flex;gap:16px;align-items:center;font:700 13px system-ui}}
 #bar b{{font-size:16px}} #bar .sp{{flex:1}}
 .tag{{font:700 11px monospace;padding:3px 8px;border-radius:99px;background:#30363d;color:#8b949e}}
</style>
<h1>Pick a photo per species</h1>
<p class=lede>Looking for: whole fish, side-on, out of water, uncluttered. Click a photo to choose it;
click it again to unchoose. Images are shown uncropped, so what you see is the whole frame —
<b>open full size</b> for the original. Everything saves the moment you click it — including
the remarks box under each row, which is there for anything I should know: what is wrong with
these, what to look for instead, a name that needs correcting.</p>
{''.join(rows)}
<div id=bar>
  <span class=sp><b id=count>0</b> / {total} decided</span>
  <span class=tag id=t-pick>0 picked</span>
  <span class=tag id=t-none>0 no good</span>
  <span class=tag id=t-more>0 more wanted</span>
  <span class=tag id=t-unsure>0 unsure</span>
  <span class=tag id=t-note>0 with remarks</span>
  <span id=state></span>
</div>
<script>
const TOTAL = {total};

async function send(sp, verdict, index) {{
  const cell = document.querySelector(`.state[data-state="${{sp}}"]`);
  if (cell) cell.textContent = 'saving…';
  try {{
    const r = await fetch('/pick', {{ method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ id: sp, verdict, index }}) }});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'refused');
    if (cell) {{ cell.textContent = 'saved'; setTimeout(() => cell.textContent = '', 1200); }}
    document.getElementById('count').textContent = j.decided;
    document.getElementById('t-note').textContent = j.notes + ' with remarks';
    document.getElementById('t-pick').textContent = j.counts.pick + ' picked';
    document.getElementById('t-none').textContent = j.counts.none + ' no good';
    document.getElementById('t-more').textContent = j.counts.more + ' more wanted';
    document.getElementById('t-unsure').textContent = j.counts.unsure + ' unsure';
    document.getElementById('state').textContent = '';
  }} catch (e) {{
    if (cell) cell.textContent = '';
    document.getElementById('state').textContent = 'NOT SAVED — is the review server still running?';
  }}
}}

function setVerdict(sp, verdict) {{
  const sec = document.getElementById(sp);
  sec.dataset.verdict = verdict === 'clear' ? '' : verdict;
  sec.querySelectorAll('.v').forEach(b =>
    b.classList.toggle('is-on', b.dataset.verdict === verdict && verdict !== 'clear'));
  if (verdict === 'none' || verdict === 'more' || verdict === 'clear') {{
    sec.querySelectorAll('.cand').forEach(c => c.classList.remove('is-on'));
  }}
}}

// Remarks save on a pause, not per keystroke — one write per thought.
const noteTimers = {{}};
document.addEventListener('input', (e) => {{
  const n = e.target.closest('.note');
  if (!n) return;
  const sp = n.dataset.sp;
  clearTimeout(noteTimers[sp]);
  noteTimers[sp] = setTimeout(async () => {{
    const cell = document.querySelector(`.state[data-state="${{sp}}"]`);
    if (cell) cell.textContent = 'saving…';
    try {{
      const r = await fetch('/note', {{ method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ id: sp, note: n.value }}) }});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      if (cell) {{ cell.textContent = 'remark saved'; setTimeout(() => cell.textContent = '', 1400); }}
      document.getElementById('t-note').textContent = j.notes + ' with remarks';
    }} catch (err) {{
      document.getElementById('state').textContent = 'REMARK NOT SAVED — is the server running?';
    }}
  }}, 600);
}});

document.addEventListener('click', (e) => {{
  const v = e.target.closest('.v');
  if (v) {{
    const sp = v.dataset.sp, verdict = v.dataset.verdict;
    const already = v.classList.contains('is-on');
    // Pressing the lit one again turns it off, same as clicking a chosen photo.
    const next = (already || verdict === 'clear') ? 'clear' : verdict;
    setVerdict(sp, next);
    send(sp, next === 'clear' ? null : next, null);
    return;
  }}
  const cand = e.target.closest('.cand');
  if (cand) {{
    const sp = cand.dataset.sp, idx = +cand.dataset.idx;
    const sec = document.getElementById(sp);
    if (cand.classList.contains('is-on')) {{      // unchoose
      cand.classList.remove('is-on');
      setVerdict(sp, 'clear');
      send(sp, null, null);
      return;
    }}
    sec.querySelectorAll('.cand').forEach(c => c.classList.remove('is-on'));
    cand.classList.add('is-on');
    // Choosing a photo while "unsure" is lit keeps the flag — you can mark a
    // favourite and still say you want another opinion on it.
    const keep = sec.dataset.verdict === 'unsure' ? 'unsure' : 'pick';
    setVerdict(sp, keep === 'unsure' ? 'unsure' : '');
    send(sp, keep, idx);
  }}
}});
</script>""", encoding="utf-8")

    if args.no_open:
        print(f"Wrote {REVIEW_HTML} (not served)")
        return 0
    serve_review(args.port)
    return 0


def load_picks():
    """Picks, normalised to the current shape.

    They started life as a bare integer per species. Tolerating that costs
    three lines and means an old file is not silently read as garbage.
    """
    if not PICKS.exists():
        return {}
    raw = json.loads(PICKS.read_text(encoding="utf-8"))
    out = {}
    for sid, v in raw.items():
        if isinstance(v, int):
            out[sid] = {"verdict": "none"} if v < 0 else {"verdict": "pick", "index": v}
        elif isinstance(v, dict) and (v.get("verdict") or v.get("note")):
            # A remark with no verdict is a legitimate state — "I looked, I
            # have something to say, I have not decided yet" — so it survives.
            out[sid] = v
    return out


def decided_count(picks):
    """Species with a verdict. A remark alone is a note to self, not a decision."""
    return len([1 for v in picks.values() if v.get("verdict")])


def note_count(picks):
    return len([1 for v in picks.values() if (v.get("note") or "").strip()])


def pick_counts(picks):
    counts = {"pick": 0, "none": 0, "more": 0, "unsure": 0}
    for v in picks.values():
        if v.get("verdict") in counts:
            counts[v["verdict"]] += 1
    return counts


def serve_review(port):
    """Serve the sheet and take each decision straight to disk.

    A file:// page cannot write anything, which is why this used to end in a
    copy-and-paste. Over 68 species that is a step too many and a chance to
    lose the lot to a mistyped paste, so the page posts each choice here and
    it lands in picks.json as you click.
    """
    import http.server, socketserver, threading

    class Handler(http.server.SimpleHTTPRequestHandler):
        def _json(self, obj, status=200):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

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
            if self.path not in ("/pick", "/note"):
                return self.send_error(404)
            n = int(self.headers.get("Content-Length", 0))
            try:
                msg = json.loads(self.rfile.read(n) or b"{}")
                picks = load_picks()
                sid = msg["id"]
                entry = dict(picks.get(sid, {}))

                if self.path == "/note":
                    note = (msg.get("note") or "").strip()
                    if note:
                        entry["note"] = note[:500]
                    else:
                        entry.pop("note", None)
                else:
                    verdict = msg.get("verdict")
                    if verdict:
                        entry["verdict"] = verdict
                        entry.pop("index", None)
                        if msg.get("index") is not None:
                            entry["index"] = int(msg["index"])
                    else:
                        # Unselected. A remark survives it — clearing a choice
                        # is not the same as retracting what you said about it.
                        entry.pop("verdict", None)
                        entry.pop("index", None)

                if entry:
                    picks[sid] = entry
                else:
                    picks.pop(sid, None)

                PICKS.write_text(json.dumps(picks, indent=1, sort_keys=True), encoding="utf-8")
                self._json({"ok": True, "decided": decided_count(picks),
                            "notes": note_count(picks), "counts": pick_counts(picks)})
            except Exception as e:
                self._json({"ok": False, "error": str(e)}, 400)

        def log_message(self, *a):
            pass          # the counters in the page are the only progress worth seeing

    with socketserver.TCPServer(("127.0.0.1", port), Handler) as srv:
        url = f"http://127.0.0.1:{port}/"
        print(f"Review sheet: {url}")
        print(f"Every decision saves to {PICKS} as you click.")
        print("Ctrl+C here when you are done.\n")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            picks = load_picks()
            c = pick_counts(picks)
            print(f"\nStopped. {c['pick']} picked, {c['none']} no-good, "
                  f"{c['more']} want more, {c['unsure']} unsure.")
            if c["more"]:
                print("  More wanted:   python tools/fish_photos.py more")
            if c["unsure"]:
                print("  Second opinion: python tools/fish_photos.py score --unsure")


def cmd_more(args):
    """Dig deeper for the species you flagged 'give me more'.

    The first pass takes the most-voted observations, which is the right
    default and also means it never sees anything past the first thirty. This
    goes further and sorts differently, so what comes back is genuinely new
    rather than the same photos in the same order.
    """
    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    picks = load_picks()
    want = [sid for sid, v in picks.items() if v.get("verdict") == "more"]
    if args.only:
        want = list(args.only)
    if not want:
        print("Nothing flagged 'give me more'. Flag some in `review` first.")
        return 0

    place = inat_place_id()
    print(f"{len(want)} species to dig into\n")
    for sid in want:
        rec = data.get(sid)
        if not rec:
            print(f"  {sid}: not fetched yet, skipping")
            continue
        have = {c["url"].split("?")[0] for c in rec["candidates"]}
        fresh = []
        for order_by, page in (("created_at", 1), ("votes", 2), ("created_at", 2)):
            fresh += inat_deeper(rec["scientific"], place, order_by, page)
        fresh += gbif_candidates(rec["scientific"])
        new = [c for c in rank(fresh) if c["url"].split("?")[0] not in have]
        rec["candidates"] = (rec["candidates"] + new)[:CANDIDATES_PER_SPECIES * 3]
        # It has been dug into; drop the flag so the sheet stops asking.
        picks.pop(sid, None)
        if new:
            print(f"  {sid}: +{len(new)} new (now {len(rec['candidates'])})")
        else:
            print(f"  {sid}: nothing new — {len(rec['candidates'])} is all that exists "
                  f"under an open licence")

    CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
    PICKS.write_text(json.dumps(picks, indent=1, sort_keys=True), encoding="utf-8")
    print("\nRe-run `review` to see them.")
    return 0


def inat_deeper(sci, place_id, order_by, page):
    out = []
    for scope in ("local", "global"):
        if scope == "local" and not place_id:
            continue
        params = {"taxon_name": sci, "photo_license": "cc0,cc-by,cc-by-sa",
                  "per_page": 30, "order_by": order_by, "page": page, "photos": "true"}
        if scope == "local":
            params["place_id"] = place_id
        data = get_json("https://api.inaturalist.org/v1/observations?"
                        + urllib.parse.urlencode(params))
        time.sleep(REQUEST_PAUSE)
        for obs in (data or {}).get("results", []):
            dead = any(a.get("controlled_attribute_id") == 17
                       and a.get("controlled_value_id") == 20
                       for a in obs.get("annotations", []))
            for ph in obs.get("photos", []):
                lic = (ph.get("license_code") or "").lower()
                if lic not in OK_LICENCES:
                    continue
                dims = ph.get("original_dimensions") or {}
                out.append({
                    "source": "inaturalist", "scope": scope,
                    "url": (ph.get("url") or "").replace("/square.", "/original."),
                    "licence": lic, "credit": ph.get("attribution") or "",
                    "page": f"https://www.inaturalist.org/observations/{obs.get('id')}",
                    "width": dims.get("width") or 0, "height": dims.get("height") or 0,
                    "dead": dead, "research": obs.get("quality_grade") == "research",
                    "agreements": obs.get("num_identification_agreements") or 0,
                })
    return out


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
    if args.unsure:
        flagged = {sid for sid, v in load_picks().items() if v.get("verdict") == "unsure"}
        todo = [(k, v) for k, v in data.items() if k in flagged and v["candidates"]]
        print(f"{len(todo)} species you marked unsure\n")
    else:
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
# stage 2c — verify what you picked
# --------------------------------------------------------------------------

# What a good species photo is, in this app — decided by reviewing 68 of them
# rather than assumed up front.
#
# The brief started as "out of water, laid flat, skip underwater". The review
# disagreed on both counts: market piles are worse than clean in-water shots,
# and more than one fish in frame is disqualifying however good the fish are.
# This wording is what goes to the model AND what the ranking leans on, so the
# two cannot drift apart.
GOOD_PHOTO = (
    "A good photo shows ONE fish, side-on, whole - snout to tail fin, no part "
    "cropped - sharp, against a background that does not compete with it. "
    "A clean underwater or aquarium shot of a single fish is GOOD. "
    "A market stall or catch pile is BAD even when the fish are clear, because "
    "several fish in frame make it useless for identification. Also bad: "
    "blurry, extreme close-ups, fish facing the camera, hands or gear covering "
    "the body, and anything where a fin or the tail is cut off."
)


def norm_sci(name):
    """Genus + species, lowercased. Enough to catch a photo taken from the
    wrong species' page, while tolerating subspecies and authorship suffixes."""
    parts = re.sub(r"[^A-Za-z ]", " ", str(name or "")).split()
    return " ".join(parts[:2]).lower()


def cmd_verify(args):
    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    picks = load_picks()
    species = {s["id"]: s for s in load_species()}
    chosen = {sid: v for sid, v in picks.items()
              if v.get("verdict") in ("pick", "unsure") and v.get("index") is not None}

    problems, warnings = [], []
    bad = lambda sid, msg: problems.append(f"{sid}: {msg}")
    warn = lambda sid, msg: warnings.append(f"{sid}: {msg}")

    print(f"Verifying {len(chosen)} picked photos.\n")

    # --- 1. coverage --------------------------------------------------------
    for sid in species:
        if sid not in picks:
            warn(sid, "never decided - will ship with no photo")
    for sid, v in picks.items():
        if not v.get("verdict"):
            warn(sid, "has a remark but no verdict")

    # --- 2. the same photo used twice ---------------------------------------
    # Easy to do when browsing quickly, and it means one of the two cards shows
    # the wrong fish - the exact failure this app must not have.
    seen = {}
    for sid, v in chosen.items():
        rec = data.get(sid)
        if not rec or v["index"] >= len(rec["candidates"]):
            bad(sid, f"pick #{v['index']} no longer exists - re-run review")
            continue
        url = rec["candidates"][v["index"]]["url"].split("?")[0]
        if url in seen:
            bad(sid, f"same photo as {seen[url]} - one of them is the wrong fish")
        seen[url] = sid

    # --- 3. licence, attribution, resolution --------------------------------
    for sid, v in chosen.items():
        rec = data.get(sid)
        if not rec or v["index"] >= len(rec["candidates"]):
            continue
        c = rec["candidates"][v["index"]]
        if c["licence"] not in OK_LICENCES:
            bad(sid, f"licence {c['licence']!r} is not one we may ship")
        if c["licence"] in ("cc-by", "cc-by-sa") and not (c["credit"] or "").strip():
            bad(sid, f"{LICENCE_LABEL[c['licence']]} requires attribution, credit is empty")
        if c["width"] and max(c["width"], c["height"]) < 800:
            warn(sid, f"only {c['width']}x{c['height']} - will look soft on a card")
        if c["width"] and c["height"] and c["width"] / c["height"] < 0.8:
            warn(sid, f"portrait {c['width']}x{c['height']} - often a held-up or cropped fish")

    # --- 4. does the observation actually say this species? -----------------
    # The strongest identity check available without a model: ask iNaturalist
    # what the observation is identified as, and compare. Catches a photo taken
    # from the wrong species' page, which no amount of looking would reveal if
    # the two fish resemble each other.
    if not args.no_taxon:
        print("Cross-checking each photo's observation against the species name...")
        for sid, v in sorted(chosen.items()):
            rec = data.get(sid)
            if not rec or v["index"] >= len(rec["candidates"]):
                continue
            c = rec["candidates"][v["index"]]
            m = re.search(r"/observations/(\d+)", c.get("page") or "")
            if not m:
                continue                       # a GBIF record; nothing to ask
            obs = get_json(f"https://api.inaturalist.org/v1/observations/{m.group(1)}")
            time.sleep(REQUEST_PAUSE)
            got = ((obs or {}).get("results") or [{}])[0].get("taxon", {}).get("name", "")
            want = species.get(sid, {}).get("scientific", "")
            if not got or norm_sci(got) == norm_sci(want):
                continue
            same_genus = norm_sci(got).split(" ")[:1] == norm_sci(want).split(" ")[:1]
            (warn if same_genus else bad)(
                sid, f"photo is identified as {got!r}, not {want!r}"
                     + (" (same genus)" if same_genus else ""))

    # --- 5. the model's opinion ---------------------------------------------
    if args.gemini:
        if gemini_verify(data, chosen, species, bad, warn):
            return 1

    # --- report -------------------------------------------------------------
    print()
    if problems:
        print(f"PROBLEMS ({len(problems)}) - worth fixing before building:")
        for p in problems:
            print(f"  ! {p}")
    if warnings:
        print(f"\nWorth a look ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")
    if not problems and not warnings:
        print("Nothing to report. Ready to build.")
    else:
        print(f"\n{len(problems)} problems, {len(warnings)} warnings.")

    notes = {sid: v["note"] for sid, v in picks.items() if (v.get("note") or "").strip()}
    if notes:
        print(f"\nYour remarks ({len(notes)}):")
        for sid, n in sorted(notes.items()):
            print(f"  {sid}: {n}")
    return 0


def gemini_verify(data, chosen, species, bad, warn):
    key = read_key("GEMINI_API_KEY")
    if not key:
        print("No GEMINI_API_KEY found.")
        print()
        print("Put it in .dev.vars in the project root (already gitignored):")
        print("    GEMINI_API_KEY=your-key-here")
        print()
        print("Or set it for this shell only:")
        print('    $env:GEMINI_API_KEY = "your-key-here"')
        return 1

    import base64
    model = read_key("GEMINI_MODEL") or "gemini-2.5-flash"
    print(f"\nAsking {model} about {len(chosen)} photos - identity, framing, single fish.\n")

    for sid, v in sorted(chosen.items()):
        rec = data.get(sid)
        if not rec or v["index"] >= len(rec["candidates"]):
            continue
        c = rec["candidates"][v["index"]]
        sp = species.get(sid, {})
        try:
            req = urllib.request.Request(c["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                blob = r.read()
        except Exception as e:
            warn(sid, f"could not download the picked photo to check it - {e}")
            continue

        prompt = (
            f"This photo is meant to illustrate {sp.get('scientific','')} "
            f"({sp.get('common','')}) in a fishing field guide.\n\n{GOOD_PHOTO}\n\n"
            "Answer as JSON only:\n"
            '{"looks_like_species": true/false/null, "identity_note": "<=10 words", '
            '"single_fish": true/false, "side_on": true/false, "whole_fish": true/false, '
            '"setting": "in water"|"held"|"flat surface"|"market pile"|"other", '
            '"quality": 0..1, "why": "<=12 words"}\n'
            "Use null for looks_like_species only if you genuinely cannot tell."
        )
        body = json.dumps({
            "contents": [{"parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg",
                                 "data": base64.b64encode(blob).decode()}},
            ]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            rq = urllib.request.Request(url, data=body, headers={
                "Content-Type": "application/json", "x-goog-api-key": key})
            with urllib.request.urlopen(rq, timeout=90) as r:
                out = json.load(r)
            got = json.loads(out["candidates"][0]["content"]["parts"][0]["text"])
        except Exception as e:
            warn(sid, f"could not be checked by the model - {e}")
            continue

        c["verify"] = got
        flags = []
        # Identity is the only one that makes a card actively lie, so it is the
        # only one raised as a problem rather than a warning.
        if got.get("looks_like_species") is False:
            bad(sid, f"model says this is not {sp.get('scientific','')} "
                     f"- {got.get('identity_note','')}")
        if got.get("single_fish") is False:
            flags.append("more than one fish")
        if got.get("whole_fish") is False:
            flags.append("fish is cut off")
        if got.get("side_on") is False:
            flags.append("not side-on")
        if got.get("setting") == "market pile":
            flags.append("market pile")
        q = got.get("quality")
        if isinstance(q, (int, float)) and q < 0.45:
            flags.append(f"quality {q:.2f}")
        if flags:
            warn(sid, ", ".join(flags) + f" - {got.get('why','')}")
        print(f"  {sid:34} {'OK' if not flags else 'HM'}  {q if isinstance(q,(int,float)) else 0:.2f}"
              f"  {got.get('setting','?'):12} {got.get('why','') if flags else ''}")
        time.sleep(0.5)

    CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return 0


# --------------------------------------------------------------------------
# stage 3 — build
# --------------------------------------------------------------------------

CARD_W, CARD_H = 800, 600      # 4:3, the ratio the species card frame uses


def cmd_build(args):
    from PIL import Image
    from rembg import remove, new_session

    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    picks = load_picks()
    chosen = {sid: v["index"] for sid, v in picks.items()
              if v.get("verdict") in ("pick", "unsure") and v.get("index") is not None}
    if not chosen:
        counts = pick_counts(picks)
        print("Nothing picked yet. Run `review` and choose a photo for at least one species.")
        if counts["unsure"] or counts["more"]:
            print(f"  ({counts['unsure']} unsure, {counts['more']} waiting on `more`)")
        return 1
    # 'unsure' still builds — a flagged favourite beats a gap, and the flag
    # stays in picks.json so you can come back to it.
    unsure = [sid for sid, v in picks.items() if v.get("verdict") == "unsure"]
    if unsure:
        print(f"Building {len(unsure)} still marked unsure: {', '.join(sorted(unsure))}\n")

    RAW.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = new_session("u2net")
    manifest = {}

    for sid, idx in sorted(chosen.items()):
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
    picks = load_picks()
    counts = pick_counts(picks)
    built = {p.stem for p in OUT_DIR.glob("*.png")} if OUT_DIR.exists() else set()

    no_cands = [s["id"] for s in species if s["id"] in data and not data[s["id"]]["candidates"]]
    doubtful = [s["id"] for s in species
                if s["id"] in data and data[s["id"]]["candidates"]
                and data[s["id"]]["confidence"] < 0.6]
    print(f"species        {len(species)}")
    print(f"fetched        {len(data)}")
    print(f"no licensed photo {len(no_cands)}")
    print(f"low confidence {len(doubtful)}")
    print(f"decided        {len(picks)} of {len(species)}")
    print(f"  picked       {counts['pick']}")
    print(f"  no good ones {counts['none']}")
    print(f"  want more    {counts['more']}   -> python tools/fish_photos.py more")
    print(f"  unsure       {counts['unsure']}   -> python tools/fish_photos.py score --unsure")
    print(f"remarks        {note_count(picks)}")
    print(f"built          {len(built)}")
    for sid, v in sorted(picks.items()):
        if (v.get("note") or "").strip():
            print(f"    {sid}: {v['note']}")
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
    s.add_argument("--unsure", action="store_true",
                   help="only the species you flagged unsure in review")
    s.set_defaults(fn=cmd_score)

    m = sub.add_parser("more", help="dig deeper for species flagged 'give me more'")
    m.add_argument("--only", nargs="*", help="species ids, default whatever is flagged")
    m.set_defaults(fn=cmd_more)

    vy = sub.add_parser("verify", help="check the photos you picked before building")
    vy.add_argument("--gemini", action="store_true",
                    help="also ask a vision model about identity and framing")
    vy.add_argument("--no-taxon", action="store_true",
                    help="skip the iNaturalist identity cross-check (offline)")
    vy.set_defaults(fn=cmd_verify)

    b = sub.add_parser("build", help="background removal + manifest")
    b.add_argument("--refresh", action="store_true")
    b.set_defaults(fn=cmd_build)

    st = sub.add_parser("status", help="what is done")
    st.set_defaults(fn=cmd_status)

    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
