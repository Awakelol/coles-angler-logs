"""Species photo pipeline: iNaturalist / GBIF / Wikimedia Commons -> licence
filter -> ranking -> manual review -> crop -> manifest for the app.

Each stage can be re-run and skips work that's already done.

    python tools/fish_photos.py fetch     # find candidates + metadata
    python tools/fish_photos.py review    # contact sheet in the browser
    python tools/fish_photos.py build     # crop around the fish, write manifest
    python tools/fish_photos.py status    # progress

Optional:

    python tools/fish_photos.py more            # more candidates for "give me more"
    python tools/fish_photos.py score --unsure  # ask Gemini about flagged species
    python tools/fish_photos.py verify          # sanity-check picks before building
    python tools/fish_photos.py verify --gemini # ...with a model looking too
    python tools/fish_photos.py crops           # pass/fail each finished crop

In `review` each species is one of: a chosen photo, "no good ones", "give me
more", "unsure" (optionally with a favourite), or undecided. Clicking a
selection again clears it.

Licensing: only CC0, CC BY and CC BY-SA are kept, and the required credit is
carried into the manifest.

Photo quality can't be checked automatically, so candidates are ranked on
proxies (iNaturalist's "Alive or Dead" annotation, research grade, aspect
ratio, ID agreements) and the final choice is made in `review` or by Gemini
in `score`.

iNaturalist, GBIF and Commons need no key. Gemini (only for `score` and
`verify --gemini`) reads GEMINI_API_KEY from `.dev.vars` in the project root
(gitignored, also used by wrangler), read as utf-8-sig to tolerate a BOM.

`build` doesn't edit the photo itself: it fixes EXIF orientation, crops a 4:3
window around the fish (located with rembg's u2net model) and scales it down.

    python -m pip install pillow rembg
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
# Put <species-id>.jpg here to override whatever the APIs found (e.g. for
# images that can't be downloaded, or your own photos).
MANUAL = WORK / "manual"
OUT_DIR = ROOT / "assets" / "photos"
MANIFEST_JS = ROOT / "js" / "data" / "species-photos.js"
REVIEW_HTML = WORK / "review.html"
CROPS_HTML = WORK / "crops.html"

UA = "ColesAnglerLog/2.0 (personal fishing app; contact via github.com/Awakelol)"

# Only these licences are downloaded at all.
OK_LICENCES = {"cc0", "cc-by", "cc-by-sa", "pd"}
LICENCE_LABEL = {
    "cc0": "CC0",
    "cc-by": "CC BY",
    "cc-by-sa": "CC BY-SA",
    # Public domain (Commons only).
    "pd": "Public domain",
}

CANDIDATES_PER_SPECIES = 10
REQUEST_PAUSE = 1.1        # iNat asks for <=1 req/sec sustained; be a good guest

# Gemini's free tier allows ~20 requests per minute, so space calls ~4.5 s
# apart (gemini_call also backs off on 429).
GEMINI_PAUSE = 4.5
GEMINI_RETRIES = 4

# Tried in order until one answers (some listed models 404, some hit daily
# quota). Lite models first: cheaper, larger free budget.
GEMINI_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
]


# --------------------------------------------------------------------------
# species list, read from the app's data files
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
# stage 1: fetch
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
    # Philippine observations first, then worldwide as a fallback.
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
            # iNaturalist's "Alive or Dead" annotation.
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


COMMONS = "https://commons.wikimedia.org/w/api.php"

# Filename words that indicate maps, diagrams etc. rather than photos.
NOT_A_PHOTO = re.compile(
    r"(map|range|distribution|diagram|chart|graph|logo|icon|stamp|coin|"
    r"signature|locator|phylogen|cladogram)", re.I)


def commons_licence(meta):
    """Map Commons' free-text licence to our codes. Returns None unless it's
    clearly one we accept.
    """
    short = (meta.get("LicenseShortName", {}).get("value") or "").lower()
    terms = (meta.get("UsageTerms", {}).get("value") or "").lower()
    text = f"{short} {terms}"

    # Check exclusions first: "CC BY-NC-SA" also contains "share alike".
    if re.search(r"\bnc\b|non-?commercial", text):
        return None
    if re.search(r"\bnd\b|no-?deriv", text):
        return None
    # GFDL and the various "fair use" tags are not free enough for this.
    if "gfdl" in text or "fair use" in text or "all rights reserved" in text:
        return None

    if "cc0" in text:
        return "cc0"
    if "public domain" in text or re.match(r"^pd[-\s]", short):
        return "pd"
    if re.search(r"share.?alike|by-sa", text):
        return "cc-by-sa"
    if re.search(r"cc.?by|attribution", text):
        return "cc-by"
    return None


def commons_candidates(sci):
    """Wikimedia Commons candidates, licence-filtered here.

    Searches `Category:<Scientific name>` first, then a plain text search for
    species whose category is missing or named differently.
    """
    out = []
    queries = [
        {"generator": "categorymembers", "gcmtitle": f"Category:{sci}",
         "gcmtype": "file", "gcmlimit": "40"},
        {"generator": "search", "gsrsearch": f"filetype:bitmap {sci}",
         "gsrnamespace": "6", "gsrlimit": "40"},
    ]
    seen = set()
    for extra in queries:
        params = {"action": "query", "prop": "imageinfo",
                  "iiprop": "url|extmetadata|size", "iiurlwidth": "1600",
                  "format": "json", **extra}
        data = get_json(COMMONS + "?" + urllib.parse.urlencode(params))
        time.sleep(0.4)
        for page in ((data or {}).get("query", {}).get("pages", {}) or {}).values():
            title = page.get("title", "")
            info = (page.get("imageinfo") or [{}])[0]
            url = info.get("thumburl") or info.get("url")
            if not url or url in seen or NOT_A_PHOTO.search(title):
                continue
            code = commons_licence(info.get("extmetadata") or {})
            if code not in OK_LICENCES:
                continue
            seen.add(url)
            artist = re.sub(r"<[^>]*>", "", (info.get("extmetadata", {})
                            .get("Artist", {}).get("value") or "")).strip()
            # Stripping markup can leave the name doubled.
            half = len(artist) // 2
            if artist and len(artist) % 2 == 0 and artist[:half] == artist[half:]:
                artist = artist[:half]
            artist = re.sub(r"\s+", " ", artist).strip()
            out.append({
                "source": "commons",
                "scope": "global",
                "url": url,
                "licence": code,
                "credit": artist or "Wikimedia Commons",
                "page": info.get("descriptionurl") or
                        f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title)}",
                "width": info.get("thumbwidth") or info.get("width") or 0,
                "height": info.get("thumbheight") or info.get("height") or 0,
                "dead": False,
                "research": False,
                "agreements": 0,
            })
        if len(out) >= CANDIDATES_PER_SPECIES * 2:
            break
    return out


def rank(cands):
    """Sort candidates by the signals we have. Landscape images score higher
    since side-on fish photos tend to be wide.
    """
    def score(c):
        s = 0.0
        # "Dead" isn't scored: in review it mostly meant market piles, though
        # a single fish on a deck is fine.
        if c["research"]:
            s += 2.5           # somebody else agreed it is this species
        if c["scope"] == "local":
            s += 2.0          # photographed in the Philippines
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
        elif c["source"] == "commons":
            s += 0.4        # curated onto a species page, but nobody voted on the ID
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
    """How much to trust the ranking for this species. Low means few candidates
    or weak signals, so a person or Gemini should look.
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
        cands = rank(inat_candidates(sp["scientific"], place)
                     + commons_candidates(sp["scientific"])
                     + gbif_candidates(sp["scientific"]))
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
# stage 2: review
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
    # Which species already have a photo on disk - the ones left are the work.
    have = {p.stem for p in OUT_DIR.glob("*.jpg")} if OUT_DIR.exists() else set()

    for sid, rec in order:
        if args.doubtful and rec["confidence"] >= 0.6:
            continue
        if args.needed and sid in have:
            continue
        chosen = picks.get(sid, {})
        cells = []
        for idx, c in enumerate(rec["candidates"]):
            gem = c.get("gemini")
            note = f"<div class='g'>gemini {gem['score']:.2f} · {gem['why']}</div>" if gem else ""
            dims = f"{c['width']}&times;{c['height']}" if c["width"] else "size unknown"
            sel = " is-on" if chosen.get("index") == idx else ""
            dead = c.get("unavailable")
            cells.append(
                f"<div class='cand{sel}{' is-dead' if dead else ''}' "
                f"data-sp='{sid}' data-idx='{idx}'>"
                + (f"<div class='deadmsg'>host refuses downloads &mdash; cannot be used</div>"
                   if dead else "")
                + f"<img src='{c['url']}' loading='lazy' referrerpolicy='no-referrer'>"
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
            f"placeholder='Remarks - what is wrong with these, what to look for instead'>"
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
 .cand.is-dead{{opacity:.4}} .cand.is-dead img{{border-color:#7d1226}}
 .deadmsg{{font:800 10px system-ui;color:#f26430;margin-bottom:2px}}
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
<b>open full size</b> for the original. Everything saves the moment you click it - including
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
    document.getElementById('state').textContent = 'NOT SAVED - is the review server still running?';
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

// Remarks save on a pause, not per keystroke - one write per thought.
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
      document.getElementById('state').textContent = 'REMARK NOT SAVED - is the server running?';
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
    // Choosing a photo while "unsure" is lit keeps the flag - you can mark a
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
    """Load picks.json, upgrading the old format (a bare index per species)."""
    if not PICKS.exists():
        return {}
    raw = json.loads(PICKS.read_text(encoding="utf-8"))
    out = {}
    for sid, v in raw.items():
        if isinstance(v, int):
            out[sid] = {"verdict": "none"} if v < 0 else {"verdict": "pick", "index": v}
        elif isinstance(v, dict) and (v.get("verdict") or v.get("note")):
            # A remark without a verdict is kept.
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


def bind_server(port, handler, what):
    """Bind to the first free port from `port` upward (SO_REUSEADDR doesn't
    help on Windows).
    """
    import socketserver

    class Server(socketserver.TCPServer):
        allow_reuse_address = True

    last = None
    for attempt in range(12):
        try:
            return Server(("127.0.0.1", port + attempt), handler), port + attempt
        except OSError as e:
            last = e
            if attempt == 0:
                print(f"  port {port} is in use - trying the next one")
    raise SystemExit(
        f"Could not bind any port from {port} to {port + 11}: {last}\n"
        f"Something is still listening. Find it with:\n"
        f"  Get-NetTCPConnection -LocalPort {port} -State Listen")


def serve_review(port):
    """Serve the review sheet and save each choice to picks.json as it's made."""
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
                        # Unselected; keep any remark.
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

    srv, port = bind_server(port, Handler, "review")
    with srv:
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
    """Fetch more candidates for species flagged 'give me more', going past the
    first page and sorting differently so the results are new.
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
        fresh += commons_candidates(rec["scientific"])
        fresh += gbif_candidates(rec["scientific"])
        new = [c for c in rank(fresh) if c["url"].split("?")[0] not in have]
        rec["candidates"] = (rec["candidates"] + new)[:CANDIDATES_PER_SPECIES * 3]
        # Clear only the "more" flag; with --only the species may already
        # have a pick.
        if picks.get(sid, {}).get("verdict") == "more":
            entry = dict(picks[sid])
            entry.pop("verdict", None)
            entry.pop("index", None)
            if entry:
                picks[sid] = entry        # keeps any remark
            else:
                picks.pop(sid, None)
        if new:
            print(f"  {sid}: +{len(new)} new (now {len(rec['candidates'])})")
        else:
            print(f"  {sid}: nothing new - {len(rec['candidates'])} is all that exists "
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
# stage 2b: optional Gemini opinion
# --------------------------------------------------------------------------

def read_key(name):
    """GEMINI_API_KEY from `.dev.vars`, falling back to the environment."""
    dev = ROOT / ".dev.vars"
    if dev.exists():
        # utf-8-sig: PowerShell and Notepad write a BOM by default.
        for line in dev.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                return v.strip().strip('"').strip("'")
    return os.environ.get(name, "").strip()


def key_help(name):
    """Explain why the key wasn't found (no file, empty file, or no such line)."""
    dev = ROOT / ".dev.vars"
    lines = [f"No {name} found."]
    if not dev.exists():
        lines.append(f"  {dev} does not exist.")
    elif dev.stat().st_size == 0:
        lines.append(f"  {dev} exists but is EMPTY - the write didn't land.")
        lines.append("  (A disk with no free space produces exactly this.)")
    else:
        keys = [l.split("=", 1)[0].strip()
                for l in dev.read_text(encoding="utf-8-sig").splitlines()
                if "=" in l and not l.strip().startswith("#")]
        lines.append(f"  {dev} has: {', '.join(keys) or '(no KEY=VALUE lines)'}")
    lines += [
        "",
        "Fix it with one line - from the project root:",
        f'    "{name}=your-key-here" | Out-File -Encoding utf8 .dev.vars',
        "",
        "Or open .dev.vars in your editor and paste:",
        f"    {name}=your-key-here",
        "",
        "Or set it for this shell only:",
        f'    $env:{name} = "your-key-here"',
    ]
    return "\n".join(lines)


def cmd_score(args):
    key = read_key("GEMINI_API_KEY")
    if not key:
        print(key_help("GEMINI_API_KEY"))
        return 1
    data = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    # gemini-2.5-flash isn't available to new keys. Override with
    # GEMINI_MODEL in .dev.vars; `models?key=...` lists what's available.
    model = read_key("GEMINI_MODEL") or "gemini-flash-latest"
    if args.unsure:
        flagged = {sid for sid, v in load_picks().items() if v.get("verdict") == "unsure"}
        todo = [(k, v) for k, v in data.items() if k in flagged and v["candidates"]]
        print(f"{len(todo)} species you marked unsure\n")
    else:
        # Skip species that are already decided. Scoring re-sorts the
        # candidates and picks.json stores an index, so re-scoring would point
        # the pick at a different photo.
        settled = {sid for sid, v in load_picks().items()
                   if v.get("verdict") in ("pick", "none")}
        todo = [(k, v) for k, v in data.items()
                if v["candidates"] and k not in settled
                and (v["confidence"] < args.below or args.all)]
        held = len(settled & set(data))
        print(f"{len(todo)} species below confidence {args.below}"
              f"{f' ({held} already decided, left alone)' if held else ''}\n")

    for sid, rec in todo:
        for c in rec["candidates"][:args.per]:
            if c.get("gemini"):
                continue
            try:
                req = urllib.request.Request(c["url"], headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=40) as r:
                    blob = r.read()
            except Exception as e:
                print(f"  {sid}: could not fetch candidate - {e}")
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
            # 429s are expected on the free tier; back off rather than skip.
            out = None
            for attempt in range(4):
                try:
                    rq = urllib.request.Request(url, data=body, headers={
                        "Content-Type": "application/json", "x-goog-api-key": key})
                    with urllib.request.urlopen(rq, timeout=60) as r:
                        out = json.load(r)
                    break
                except urllib.error.HTTPError as e:
                    if e.code != 429 or attempt == 3:
                        raise
                    wait = 5 * (2 ** attempt)
                    print(f"  {sid}: rate limited, waiting {wait}s")
                    time.sleep(wait)
            try:
                if out is None:
                    raise RuntimeError("no response")
                txt = out["candidates"][0]["content"]["parts"][0]["text"]
                got = json.loads(txt)
                c["gemini"] = {"score": float(got.get("score", 0)),
                               "why": str(got.get("why", ""))[:60]}
                print(f"  {sid} #{rec['candidates'].index(c)}  {c['gemini']['score']:.2f}  "
                      f"{c['gemini']['why']}")
            except Exception as e:
                print(f"  {sid}: scoring failed - {e}")
            time.sleep(0.6)
        # Re-order this species by Gemini's opinion where it has one.
        rec["candidates"].sort(key=lambda c: -(c.get("gemini", {}).get("score", -1)))
        CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print("\nDone. Re-run `review` to see the scores against each thumbnail.")
    return 0


# --------------------------------------------------------------------------
# stage 2c: verify picks
# --------------------------------------------------------------------------

# What makes a good species photo (from reviewing the first 68). Used both in
# the model prompt and by the ranking.
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

    # --- 2. the same photo used for two species -----------------------------
    seen = {}
    for sid, v in chosen.items():
        rec = data.get(sid)
        if not rec or v["index"] >= len(rec["candidates"]):
            bad(sid, f"pick #{v['index']} no longer exists - re-run review")
            continue
        # Key on the observation/occurrence page, not the image URL: SAIAB
        # images put the filename in the query string.
        cnd = rec["candidates"][v["index"]]
        url = cnd.get("page") or cnd["url"]
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

    # --- 4. does the observation's ID match this species? -----------------
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
        if gemini_verify(data, chosen, species, bad, warn, args.limit):
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


def gemini_call(key, model, prompt, blob, timeout=90):
    """One vision call. Backs off and retries on 429.

    Returns (parsed_json, None) or (None, reason).
    """
    import base64
    body = json.dumps({
        "contents": [{"parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": "image/jpeg",
                             "data": base64.b64encode(blob).decode()}},
        ]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    for attempt in range(GEMINI_RETRIES):
        try:
            rq = urllib.request.Request(url, data=body, headers={
                "Content-Type": "application/json", "x-goog-api-key": key})
            with urllib.request.urlopen(rq, timeout=timeout) as r:
                out = json.load(r)
            return json.loads(out["candidates"][0]["content"]["parts"][0]["text"]), None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429:
                # The message carries "Please retry in 37.1s" - believe it.
                m = re.search(r"retry in ([\d.]+)s", detail)
                wait = min(float(m.group(1)) + 1, 65) if m else 20 * (attempt + 1)
                if "PerDay" in detail or "per day" in detail.lower():
                    return None, "daily free-tier quota is spent - try again tomorrow"
                print(f"      rate limited, waiting {wait:.0f}s")
                time.sleep(wait)
                continue
            return None, f"HTTP {e.code}: {detail[:160]}"
        except Exception as e:
            if attempt == GEMINI_RETRIES - 1:
                return None, f"{type(e).__name__}: {e}"
            time.sleep(3 * (attempt + 1))
    return None, "gave up after repeated rate limits"


def pick_model(key):
    """Return the first model that answers a tiny test call."""
    override = read_key("GEMINI_MODEL")
    order = ([override] + GEMINI_MODELS) if override else GEMINI_MODELS
    for model in order:
        body = json.dumps({"contents": [{"parts": [{"text": "Reply with: ok"}]}]}).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            rq = urllib.request.Request(url, data=body, headers={
                "Content-Type": "application/json", "x-goog-api-key": key})
            with urllib.request.urlopen(rq, timeout=30) as r:
                r.read()
            return model, None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            why = ("not available to this key" if e.code == 404 else
                   "daily free quota already spent"
                   if "per day" in detail.lower() or "PerDay" in detail else f"HTTP {e.code}")
            print(f"  {model}: {why}")
        except Exception as e:
            print(f"  {model}: {type(e).__name__}")
        time.sleep(1)
    return None, ("No candidate model would answer. Either they have all spent their daily "
                  "free quota, or the key lacks access. Try again tomorrow, or put "
                  "GEMINI_MODEL=<name> in .dev.vars.")


def gemini_verify(data, chosen, species, bad, warn, limit=0):
    key = read_key("GEMINI_API_KEY")
    if not key:
        print(key_help("GEMINI_API_KEY"))
        return 1

    print("\nFinding a model that will answer…")
    model, err = pick_model(key)
    if not model:
        print(f"\n{err}")
        return 1

    # Already-checked photos are skipped.
    def done(sid, v):
        rec = data.get(sid)
        if not rec or v["index"] >= len(rec["candidates"]):
            return True
        return bool(rec["candidates"][v["index"]].get("verify"))

    todo = {sid: v for sid, v in chosen.items() if not done(sid, v)}
    if limit:
        todo = dict(sorted(todo.items())[:limit])
    already = len(chosen) - len([1 for s, v in chosen.items() if not done(s, v)])

    print(f"\nUsing {model}.")
    print(f"  {len(todo)} photos to check, {already} already done - "
          f"that is {len(todo)} API calls, about "
          f"{len(todo) * (GEMINI_PAUSE + 3.5) / 60:.0f} min at a free-tier-safe pace.\n")
    if not todo:
        return 0

    for sid, v in sorted(todo.items()):
        rec = data.get(sid)
        c = rec["candidates"][v["index"]]
        sp = species.get(sid, {})
        try:
            req = urllib.request.Request(c["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                blob = r.read()
        except Exception as e:
            # Broken image link: a source problem, not a model problem.
            warn(sid, f"photo could not be downloaded ({e}) - the source link may be dead")
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
        got, err = gemini_call(key, model, prompt, blob)
        if err:
            warn(sid, f"could not be checked by the model - {err}")
            if "quota" in err:
                print("\n  Stopping here rather than hammering a spent quota.")
                print("  Re-run when it resets - everything checked so far is saved.")
                break
            continue

        c["verify"] = got
        # Save after every photo so a crash doesn't lose paid-for calls and
        # re-runs resume.
        CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
        flags = []
        # A wrong species is an error; everything else is a warning.
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
        time.sleep(GEMINI_PAUSE)

    return 0


# --------------------------------------------------------------------------
# stage 3: build
# --------------------------------------------------------------------------

# Longest edge of a shipped photo (sharp at 2x on the hero card).
MAX_EDGE = 1400


CARD_ASPECT = 4 / 3
# Margin around the fish, as a fraction of its size.
FISH_MARGIN = 1.22


def find_fish(img, session):
    """Bounding box of the fish in the original image, from u2net's saliency
    mask (the mask is only used for location; the photo isn't altered).

    Returns (x0, y0, x1, y1) or None.
    """
    from rembg import remove
    mask = remove(img, session=session, only_mask=True)
    # Threshold first; the mask's faint halo would inflate getbbox().
    mask = mask.point(lambda p: 255 if p > 96 else 0)
    box = mask.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    # Nearly the whole frame or a tiny speck: treat as not found.
    frac = ((x1 - x0) * (y1 - y0)) / float(img.width * img.height)
    if frac > 0.97 or frac < 0.01:
        return None
    return box


def frame_on_fish(img, box):
    """A CARD_ASPECT window centred on the fish that contains all of it. Returns
    None if the fish is too long to fit; that photo ships uncropped.
    """
    W, H = img.width, img.height
    x0, y0, x1, y1 = box
    fw, fh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    need_w, need_h = fw * FISH_MARGIN, fh * FISH_MARGIN
    if need_w / need_h > CARD_ASPECT:
        cw = need_w
        ch = cw / CARD_ASPECT
    else:
        ch = need_h
        cw = ch * CARD_ASPECT

    if cw > W or ch > H:
        # Shrink to what the photo can give while keeping the shape...
        scale = min(W / cw, H / ch)
        cw, ch = cw * scale, ch * scale
        # ...but not if that would start eating the fish.
        if cw < fw or ch < fh:
            return None

    left = cx - cw / 2
    top = cy - ch / 2
    left = max(0, min(left, W - cw))
    top = max(0, min(top, H - ch))

    # Nudge back if clamping pushed the window off the fish.
    if x0 < left:
        left = x0
    if y0 < top:
        top = y0
    if x1 > left + cw:
        left = x1 - cw
    if y1 > top + ch:
        top = y1 - ch
    left, top = max(0, left), max(0, top)
    if left + cw > W or top + ch > H:
        return None

    return (int(left), int(top), int(left + cw), int(top + ch))


def fill_to_card(img):
    """Pad a photo to the card's aspect ratio with a blurred, enlarged copy of
    itself behind it, instead of cropping the fish or leaving bars.
    """
    from PIL import Image, ImageFilter, ImageEnhance
    w, h = img.width, img.height
    if abs((w / h) - CARD_ASPECT) < 0.02:
        return img, False

    if w / h > CARD_ASPECT:
        cw, ch = w, round(w / CARD_ASPECT)
    else:
        ch, cw = h, round(h * CARD_ASPECT)

    # Blurred, dimmed background copy.
    scale = max(cw / w, ch / h) * 1.08
    back = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    left, top = (back.width - cw) // 2, (back.height - ch) // 2
    back = back.crop((left, top, left + cw, top + ch))
    back = back.filter(ImageFilter.GaussianBlur(radius=max(cw, ch) // 28))
    back = ImageEnhance.Brightness(back).enhance(0.62)
    back.paste(img, ((cw - w) // 2, (ch - h) // 2))
    return back, True


def manifest_entry(sid, cand):
    return {
        "file": f"assets/photos/{sid}.jpg",
        "credit": re.sub(r"\s+", " ", cand["credit"]).strip()[:120],
        "licence": LICENCE_LABEL[cand["licence"]],
        "source": cand["page"],
    }


def cmd_build(args):
    import io
    from PIL import Image, ImageOps

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
    # 'unsure' picks still build; the flag stays in picks.json.
    unsure = [sid for sid, v in picks.items() if v.get("verdict") == "unsure"]
    if unsure:
        print(f"Building {len(unsure)} still marked unsure: {', '.join(sorted(unsure))}\n")

    from rembg import new_session

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    fitted = {}
    wrote = 0
    # Load the model once (176 MB).
    session = new_session("u2net")

    crops = load_crops()

    for sid, idx in sorted(chosen.items()):
        rec = data.get(sid)
        if not rec or idx is None or idx < 0 or idx >= len(rec["candidates"]):
            continue
        # Failed in crop review: ship no photo until it's replaced.
        cv = dict(crops.get(sid, {}))
        # Verdict was for a different photo; ignore it.
        if cv.get("verdict") and cv.get("for_index") is not None and cv["for_index"] != idx:
            cv = {k: v for k, v in cv.items() if k == "note"}
        # "Replace" plus "rotate" usually means it failed because it was
        # sideways, so build it (rotated) rather than pulling it.
        if cv.get("verdict") == "fail" and not int(cv.get("rotate", 0)):
            out_dead = OUT_DIR / f"{sid}.jpg"
            if out_dead.exists():
                out_dead.unlink()
            print(f"  {sid:34} pulled - marked 'replace' in the crop review")
            continue
        if cv.get("verdict") == "fail":
            print(f"  {sid:34} marked 'replace' BUT rotated - building it rotated "
                  f"so you can judge it straightened")
        cand = rec["candidates"][idx]
        out = OUT_DIR / f"{sid}.jpg"

        # A manual photo overrides fetched ones. Credit comes from a sidecar
        # JSON if present, otherwise it's marked as unrecorded.
        manual = next((f for e in ("jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG", "WEBP")
                       for f in [MANUAL / f"{sid}.{e}"] if f.exists()), None)

        # Rebuild existing files when the crop was rejected or a rotation was
        # requested.
        turn = int(crops.get(sid, {}).get("rotate", 0)) % 360
        recrop = crops.get(sid, {}).get("verdict") == "full" or turn
        if out.exists() and not args.refresh and not recrop:
            manifest[sid] = manifest_entry(sid, cand)
            continue

        if manual:
            blob = manual.read_bytes()
            side = MANUAL / f"{sid}.json"
            meta = json.loads(side.read_text(encoding="utf-8")) if side.exists() else {}
            cand = {
                "credit": meta.get("credit", "supplied by hand - provenance not recorded"),
                "licence": meta.get("licence", "cc-by"),
                "page": meta.get("source", ""),
            }
            if cand["licence"] not in LICENCE_LABEL:
                cand["licence"] = "cc-by"
        else:
          try:
            req = urllib.request.Request(cand["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                blob = r.read()
          except Exception as e:
            # Some hosts refuse downloads (403); mark unavailable and move on.
            print(f"  {sid}: download failed - {e}")
            if "403" in str(e) or "404" in str(e):
                cand["unavailable"] = str(e)[:80]
                CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
                print(f"  {' ' * 34}marked unavailable - supply it by hand in "
                      f"tools/_photo_work/manual/, or pick another in `review`")
            continue

        try:
            src = Image.open(io.BytesIO(blob))
            # Apply EXIF orientation.
            src = ImageOps.exif_transpose(src).convert("RGB")
            # Rotate before detection.
            if turn:
                src = src.rotate(-turn, expand=True)

            # Crop around the fish.
            note = "full frame"
            # "Use whole photo": skip detection.
            box = None if crops.get(sid, {}).get("verdict") == "full"                 else find_fish(src, session)
            if crops.get(sid, {}).get("verdict") == "full":
                note = "whole frame (your call)"
            if turn:
                note += f", rotated {turn}°"
            if box:
                window = frame_on_fish(src, box)
                if window:
                    src = src.crop(window)
                    note = "centred on fish"
                else:
                    note = "fish too long to frame - full frame kept"
            elif crops.get(sid, {}).get("verdict") != "full":
                # Only report "not found" if detection actually ran.
                note = "no subject found - full frame kept"
            if manual:
                note += " (supplied by hand)"
            fitted[note] = fitted.get(note, 0) + 1

            src, padded = fill_to_card(src)
            if padded:
                note += ", filled to frame"
            src.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            src.save(out, "JPEG", quality=86, optimize=True, progressive=True)
            wrote += 1
            print(f"  {sid:34} {src.width}x{src.height}  "
                  f"{out.stat().st_size // 1024:>4} KB  {note}")
        except Exception as e:
            print(f"  {sid}: could not be processed - {e}")
            continue

        manifest[sid] = manifest_entry(sid, cand)

    write_manifest(manifest)
    if wrote:
        bump_cache_version(wrote)
    print()
    for note, n in sorted(fitted.items(), key=lambda kv: -kv[1]):
        print(f"  {n:>3}  {note}")
    print(f"\n{len(manifest)} photos in {OUT_DIR}")
    print(f"Manifest: {MANIFEST_JS}")
    return 0


# --------------------------------------------------------------------------
# stage 3b: crop review
# --------------------------------------------------------------------------
#
# The saliency model sometimes frames the wrong thing (a diver, a hand, a
# bright rock). Verdicts:
#
#   pass  crop is fine
#   full  crop is wrong but the photo is fine: ship the whole frame
#   fail  photo is no good: pull it and pick another

CROPS = WORK / "crops.json"


def load_crops():
    if not CROPS.exists():
        return {}
    try:
        raw = json.loads(CROPS.read_text(encoding="utf-8"))
        return {k: v for k, v in raw.items() if isinstance(v, dict)}
    except Exception:
        return {}


def crop_counts(crops):
    c = {"pass": 0, "full": 0, "fail": 0}
    for v in crops.values():
        if v.get("verdict") in c:
            c[v["verdict"]] += 1
    return c


def cmd_crops(args):
    species = {s["id"]: s for s in load_species()}
    crops = load_crops()
    built = sorted(p for p in OUT_DIR.glob("*.jpg")) if OUT_DIR.exists() else []
    if not built:
        print("Nothing built yet. Run `build` first.")
        return 1

    # Show how each was framed.
    data = json.loads(CANDIDATES.read_text(encoding="utf-8")) if CANDIDATES.exists() else {}

    rows = []
    for p in built:
        sid = p.stem
        sp = species.get(sid, {})
        v = crops.get(sid, {})
        verdict = v.get("verdict", "")
        from PIL import Image
        with Image.open(p) as im:
            w, h = im.size
        shape = "4:3, centred on the fish" if abs((w / h) - CARD_ASPECT) < 0.02 \
            else f"whole frame, {w}x{h} - letterboxed on the card"

        btn = lambda kind, label: (
            f"<button class='v v--{kind}{' is-on' if verdict == kind else ''}' "
            f"data-sp='{sid}' data-verdict='{kind}'>{label}</button>")
        rows.append(
            f"<section id='{sid}' data-sp='{sid}' data-verdict='{verdict}'>"
            f"<div class='shot'><img src='/photo/{sid}.jpg' loading='lazy'></div>"
            f"<div class='side'>"
            f"<h2>{html_escape(sp.get('common', sid))}"
            f"<small>{html_escape(sp.get('scientific', ''))}</small></h2>"
            f"<p class='shape'>{html_escape(shape)}</p>"
            f"<div class='verdicts'>"
            f"{btn('pass', 'Crop is good')}"
            f"{btn('full', 'Bad crop - use whole photo')}"
            f"{btn('fail', 'Bad photo - replace it')}"
            f"<button class='v v--clear' data-sp='{sid}' data-verdict='clear'>Clear</button>"
            f"<span class='state' data-state='{sid}'></span>"
            f"</div>"
            # Rotation is separate from the verdict.
            f"<div class='verdicts'>"
            f"<span class='rotlabel'>Rotate</span>"
            f"<button class='v v--rot' data-sp='{sid}' data-rot='-90'>&#8634; left</button>"
            f"<button class='v v--rot' data-sp='{sid}' data-rot='90'>&#8635; right</button>"
            f"<span class='rotnow' data-rotnow='{sid}'>"
            f"{(str(v.get('rotate', 0)) + '&deg;') if v.get('rotate') else ''}</span>"
            f"</div>"
            f"<textarea class='note' data-sp='{sid}' rows='2' "
            f"placeholder='Remarks - what is wrong with this crop or photo'>"
            f"{html_escape(v.get('note', ''))}</textarea>"
            f"</div></section>")

    total = len(rows)
    CROPS_HTML.write_text(f"""<!doctype html><meta charset=utf-8>
<title>Pass or fail the crops</title>
<style>
 body{{font:14px/1.5 system-ui;margin:0;padding:16px 20px 96px;background:#10141c;color:#e6edf3}}
 h1{{font-size:19px;margin:0 0 4px}}
 .lede{{color:#8b949e;margin:0 0 14px;max-width:74ch}}
 section{{display:flex;gap:18px;border-top:1px solid #30363d;padding:16px 0;align-items:flex-start}}
 section[data-verdict="fail"]{{opacity:.5}}
 section[data-verdict="full"]{{box-shadow:inset 3px 0 0 #d29922;padding-left:12px}}
 /* Shown exactly as the card shows it: same ratio, same fit, same backing.
    A crop judged in a different frame is judged against the wrong thing. */
 .shot{{flex:0 0 340px}}
 .shot img{{width:340px;aspect-ratio:4/3;object-fit:contain;
            background:#10202e;border-radius:10px;display:block}}
 .side{{flex:1;min-width:0}}
 h2{{font-size:17px;margin:0 0 2px}}
 h2 small{{display:block;font-weight:400;font-style:italic;color:#8b949e;font-size:13px}}
 .shape{{margin:0 0 10px;font:600 11px monospace;color:#6e7681}}
 .verdicts{{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}}
 .v{{font:800 12px system-ui;padding:6px 12px;border-radius:99px;cursor:pointer;
     border:1px solid #30363d;background:#161b22;color:#8b949e}}
 .v:hover{{border-color:#8b949e}}
 .v--pass.is-on{{background:#3fb950;border-color:#3fb950;color:#0d1117}}
 .v--full.is-on{{background:#d29922;border-color:#d29922;color:#0d1117}}
 .v--fail.is-on{{background:#7d1226;border-color:#7d1226;color:#fff}}
 .state{{font:700 11px monospace;color:#3fb950}}
 .rotlabel{{font:800 11px system-ui;color:#6e7681;text-transform:uppercase;letter-spacing:.06em}}
 .rotnow{{font:800 12px monospace;color:#d29922}}
 .note{{width:100%;font:13px/1.5 system-ui;background:#0d1117;color:#e6edf3;
        border:1px solid #30363d;border-radius:8px;padding:8px 10px;resize:vertical;
        box-sizing:border-box}}
 .note:focus{{outline:none;border-color:#58a6ff}}
 .note:not(:placeholder-shown){{border-color:#d29922;background:#14120c}}
 #bar{{position:fixed;left:0;right:0;bottom:0;background:#161b22;border-top:1px solid #30363d;
       padding:12px 20px;display:flex;gap:16px;align-items:center;font:700 13px system-ui}}
 #bar b{{font-size:16px}} #bar .sp{{flex:1}}
 .tag{{font:700 11px monospace;padding:3px 8px;border-radius:99px;background:#30363d;color:#8b949e}}
</style>
<h1>Pass or fail each crop</h1>
<p class=lede>Each photo is shown exactly as the species card shows it - same ratio, same fit,
same backing. <b>Crop is good</b> keeps it. <b>Bad crop</b> keeps the photo but ships the whole
frame instead, which is the right answer when the framing is off but the picture is fine.
<b>Bad photo</b> pulls it entirely and the card says "photo not yet available" until it is
replaced. Everything saves as you click.</p>
{''.join(rows)}
<div id=bar>
  <span class=sp><b id=count>0</b> / {total} judged</span>
  <span class=tag id=t-pass>0 good</span>
  <span class=tag id=t-full>0 use whole</span>
  <span class=tag id=t-fail>0 replace</span>
  <span class=tag id=t-note>0 with remarks</span>
  <span id=state></span>
</div>
<script>
async function post(path, body, sp) {{
  const cell = sp ? document.querySelector(`.state[data-state="${{sp}}"]`) : null;
  if (cell) cell.textContent = 'saving…';
  try {{
    const r = await fetch(path, {{ method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify(body) }});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'refused');
    if (cell) {{ cell.textContent = 'saved'; setTimeout(() => cell.textContent = '', 1200); }}
    document.getElementById('count').textContent = j.judged;
    document.getElementById('t-pass').textContent = j.counts.pass + ' good';
    document.getElementById('t-full').textContent = j.counts.full + ' use whole';
    document.getElementById('t-fail').textContent = j.counts.fail + ' replace';
    document.getElementById('t-note').textContent = j.notes + ' with remarks';
    if (j.rotate !== undefined && sp) {{
      const cell = document.querySelector(`.rotnow[data-rotnow="${{sp}}"]`);
      if (cell) cell.textContent = j.rotate ? j.rotate + '°' : '';
    }}
    document.getElementById('state').textContent = '';
  }} catch (e) {{
    if (cell) cell.textContent = '';
    document.getElementById('state').textContent = 'NOT SAVED - is the server still running?';
  }}
}}

document.addEventListener('click', (e) => {{
  const rot = e.target.closest('.v--rot');
  if (rot) {{
    const sp = rot.dataset.sp;
    post('/croprot', {{ id: sp, by: +rot.dataset.rot }}, sp).then(() => {{}});
    return;
  }}
  const v = e.target.closest('.v');
  if (!v) return;
  const sp = v.dataset.sp, verdict = v.dataset.verdict;
  const already = v.classList.contains('is-on');
  const next = (already || verdict === 'clear') ? 'clear' : verdict;
  const sec = document.getElementById(sp);
  sec.dataset.verdict = next === 'clear' ? '' : next;
  sec.querySelectorAll('.v').forEach(b =>
    b.classList.toggle('is-on', b.dataset.verdict === next && next !== 'clear'));
  post('/crop', {{ id: sp, verdict: next === 'clear' ? null : next }}, sp);
}});

const timers = {{}};
document.addEventListener('input', (e) => {{
  const n = e.target.closest('.note');
  if (!n) return;
  const sp = n.dataset.sp;
  clearTimeout(timers[sp]);
  timers[sp] = setTimeout(() => post('/cropnote', {{ id: sp, note: n.value }}, sp), 600);
}});
</script>""", encoding="utf-8")

    if args.no_open:
        print(f"Wrote {CROPS_HTML} (not served)")
        return 0
    serve_crops(args.port)
    return 0


def serve_crops(port):
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
                body = CROPS_HTML.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            # Served over HTTP so it works from any directory.
            if self.path.startswith("/photo/"):
                name = os.path.basename(self.path)
                f = OUT_DIR / name
                if f.exists() and f.suffix == ".jpg":
                    body = f.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            self.send_error(404)

        def do_POST(self):
            if self.path not in ("/crop", "/cropnote", "/croprot"):
                return self.send_error(404)
            n = int(self.headers.get("Content-Length", 0))
            try:
                msg = json.loads(self.rfile.read(n) or b"{}")
                crops = load_crops()
                sid = msg["id"]
                entry = dict(crops.get(sid, {}))
                if self.path == "/croprot":
                    now = int(entry.get("rotate", 0))
                    entry["rotate"] = (now + int(msg.get("by", 0))) % 360
                    if entry["rotate"] == 0:
                        entry.pop("rotate", None)
                elif self.path == "/cropnote":
                    note = (msg.get("note") or "").strip()
                    if note:
                        entry["note"] = note[:500]
                    else:
                        entry.pop("note", None)
                else:
                    verdict = msg.get("verdict")
                    if verdict:
                        entry["verdict"] = verdict
                        # Which photo the verdict applies to.
                        pk = load_picks().get(sid, {})
                        if pk.get("index") is not None:
                            entry["for_index"] = pk["index"]
                    else:
                        entry.pop("verdict", None)   # a remark outlives a cleared verdict
                        entry.pop("for_index", None)
                if entry:
                    crops[sid] = entry
                else:
                    crops.pop(sid, None)
                CROPS.write_text(json.dumps(crops, indent=1, sort_keys=True), encoding="utf-8")
                self._json({
                    "ok": True,
                    "judged": len([1 for v in crops.values() if v.get("verdict")]),
                    "counts": crop_counts(crops),
                    "notes": len([1 for v in crops.values() if (v.get("note") or "").strip()]),
                    "rotate": crops.get(sid, {}).get("rotate", 0),
                })
            except Exception as e:
                self._json({"ok": False, "error": str(e)}, 400)

        def log_message(self, *a):
            pass

    srv, port = bind_server(port, Handler, "crops")
    with srv:
        url = f"http://127.0.0.1:{port}/"
        print(f"Crop review: {url}")
        print(f"Saves to {CROPS} as you click.")
        print("Ctrl+C here when done.\n")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            crops = load_crops()
            c = crop_counts(crops)
            notes = {k: v["note"] for k, v in crops.items() if (v.get("note") or "").strip()}
            print(f"\nStopped. {c['pass']} good, {c['full']} use-whole, {c['fail']} replace, "
                  f"{len(notes)} with remarks.")
            for sid, note in sorted(notes.items()):
                print(f"    {sid}: {note}")
            if c["full"]:
                print("\n  Re-run build to ship those whole:")
                print("    python tools/fish_photos.py build --refresh")
            if c["fail"]:
                print("\n  Photos to replace are excluded from the manifest on the next build.")


def bump_cache_version(n):
    """Bump CACHE_VERSION in sw.js so devices drop cached photos. Images are
    cache-first and rebuilt photos keep the same URL.
    """
    sw = ROOT / "sw.js"
    src = sw.read_text(encoding="utf-8")
    m = re.search(r"const CACHE_VERSION = 'v(\d+)';", src)
    if not m:
        print("  ! could not find CACHE_VERSION in sw.js - bump it by hand")
        return
    nxt = int(m.group(1)) + 1
    sw.write_text(src.replace(m.group(0), f"const CACHE_VERSION = 'v{nxt}';"), encoding="utf-8")
    print(f"\n  {n} photo(s) changed -> CACHE_VERSION bumped to v{nxt}")
    print("  (images are cache-first; without this, devices keep the old ones)")


def write_manifest(manifest):
    lines = [
        "// Generated by tools/fish_photos.py. Don't edit by hand.",
        "//",
        "// Species with an openly licensed photo. `credit` and `licence` are",
        "// shown on the card, as CC BY / BY-SA require.",
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
    built = {p.stem for p in OUT_DIR.glob("*.jpg")} if OUT_DIR.exists() else set()

    no_cands = [s["id"] for s in species if s["id"] in data and not data[s["id"]]["candidates"]]
    doubtful = [s["id"] for s in species
                if s["id"] in data and data[s["id"]]["candidates"]
                and data[s["id"]]["confidence"] < 0.6]
    print(f"species        {len(species)}")
    print(f"fetched        {len(data)}")
    print(f"no licensed photo {len(no_cands)}")
    print(f"low confidence {len(doubtful)}")
    # Count verdicts, not entries (remark-only entries aren't decided).
    print(f"decided        {decided_count(picks)} of {len(species)}")
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
    # Line-buffered so redirected output shows up as it runs.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="find licensed candidates")
    f.add_argument("--only", nargs="*", help="species ids, default all")
    f.add_argument("--refresh", action="store_true", help="re-query species already done")
    f.set_defaults(fn=cmd_fetch)

    r = sub.add_parser("review", help="contact sheet to pick from")
    r.add_argument("--doubtful", action="store_true", help="only the low-confidence ones")
    r.add_argument("--needed", action="store_true",
                   help="only species that still have no photo")
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
    vy.add_argument("--limit", type=int, default=0,
                    help="check at most N photos this run (0 = all not yet done)")
    vy.set_defaults(fn=cmd_verify)

    cr = sub.add_parser("crops", help="pass or fail each built crop")
    cr.add_argument("--no-open", action="store_true")
    cr.add_argument("--port", type=int, default=8124)
    cr.set_defaults(fn=cmd_crops)

    b = sub.add_parser("build", help="crop centred on the fish + manifest")
    b.add_argument("--refresh", action="store_true")
    b.set_defaults(fn=cmd_build)

    st = sub.add_parser("status", help="what is done")
    st.set_defaults(fn=cmd_status)

    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
