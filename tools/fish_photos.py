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
    python tools/fish_photos.py crops           # pass or fail each finished crop

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

Gemini is optional and only `score` and `verify --gemini` use it. Put the key
in `.dev.vars` in the project root, which is gitignored and is also where
wrangler looks for local Worker secrets, so it has one home:

    GEMINI_API_KEY=your-key-here

Read as utf-8-sig, because PowerShell redirection and Notepad both write a
byte-order mark by default and a BOM would make the first key unmatchable.

PHOTOS SHIP AS THEY WERE TAKEN
------------------------------
No background removal, no cut-outs, no compositing. `build` downloads the
original, corrects its EXIF orientation, scales it down and saves it. That is
all.

Cutting the fish out was tried and dropped. It looked consistent in principle
and was not in practice: some fish came back with a halo, some lost a fin the
matting decided was background, and an underwater shot with the water removed
stops looking like a fish in the sea. A real photograph in a consistent FRAME
is steadier than a processed one, and the frame is a CSS rule rather than a
permanent edit to the file.

    python -m pip install pillow
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
CROPS_HTML = WORK / "crops.html"

UA = "ColesAnglerLog/2.0 (personal fishing app; contact via github.com/Awakelol)"

# The only licences that may ship. Anything else is skipped outright rather
# than downloaded and sorted out later — a file on disk is a file that can be
# published by accident.
OK_LICENCES = {"cc0", "cc-by", "cc-by-sa", "pd"}
LICENCE_LABEL = {
    "cc0": "CC0",
    "cc-by": "CC BY",
    "cc-by-sa": "CC BY-SA",
    # Only reachable via Commons. Strictly freer than the three the brief
    # named, and the licence most of the old scientific plates carry, so
    # excluding it would rule out material on a technicality.
    "pd": "Public domain",
}

CANDIDATES_PER_SPECIES = 10
REQUEST_PAUSE = 1.1        # iNat asks for <=1 req/sec sustained; be a good guest

# Gemini's free tier is a per-MINUTE budget, not a per-second one, and it is
# small — around 20 requests. Pacing by "a short sleep between calls" burns it
# in the first few seconds and every remaining photo comes back 429. Four and
# a half seconds is ~13/min, comfortably under, and gemini_call backs off and
# retries on top of that rather than giving up on the photo.
GEMINI_PAUSE = 4.5
GEMINI_RETRIES = 4

# Tried in order until one answers. Hardcoding a single model is how this broke
# first time: gemini-2.5-flash-lite is LISTED by the models endpoint and returns
# 404 when called, and gemini-2.5-flash had spent its daily free quota — two
# different failures that both read as "your key is wrong".
#
# Lite models first. This asks one small question of each photo, which is what
# they are for, and their free-tier budget is the larger one.
GEMINI_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
]


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


COMMONS = "https://commons.wikimedia.org/w/api.php"

# Commons holds far more than photographs. Range maps and taxonomy diagrams
# match a species search perfectly and are useless on a card.
NOT_A_PHOTO = re.compile(
    r"(map|range|distribution|diagram|chart|graph|logo|icon|stamp|coin|"
    r"signature|locator|phylogen|cladogram)", re.I)


def commons_licence(meta):
    """Commons records licences as free text; this maps it to our codes.

    Anything not confidently free returns None and the file is skipped. The
    default has to be "no" — a permissive guess here puts a file we may not
    have the right to publish into the repository.
    """
    short = (meta.get("LicenseShortName", {}).get("value") or "").lower()
    terms = (meta.get("UsageTerms", {}).get("value") or "").lower()
    text = f"{short} {terms}"

    # EXCLUSIONS FIRST, and this order is the whole point. "CC BY-NC-SA"
    # contains "share alike", so a share-alike test placed above this returns
    # cc-by-sa for a non-commercial licence and ships a file we have no right
    # to publish. It did exactly that until a test caught it.
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
    """Wikimedia Commons, licence-filtered here rather than at the API.

    Two passes: the species category first, because Commons files a species'
    images under `Category:<Scientific name>` and that is curated, then a plain
    search for species whose category is missing or differently named.
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
            # Commons wraps the artist in nested markup, and stripping tags can
            # leave the same name twice ("Unknown authorUnknown author").
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
    """Order by the signals we can actually read.

    Landscape is weighted because a fish photographed side-on fills a wide
    frame; a portrait crop is usually someone holding it vertically or a
    close-up of a head. It is a tendency, not a rule, which is exactly why
    this ranks rather than filters.
    """
    def score(c):
        s = 0.0
        # "Dead" USED to be worth +3, on the theory that a landed fish is laid
        # out side-on in air. Reviewing 68 of them showed what it actually
        # correlates with: market stalls and catch piles, which are the single
        # most common reason a photo got rejected — "less from the market,
        # preferrably still in water", seven times over.
        #
        # It is not a penalty either, because one fish laid flat on a deck is
        # exactly right. It is simply no longer evidence in either direction,
        # and the signals that DO track a usable photo carry the weight instead.
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
    # Which species already have a photo on disk — the ones left are the work.
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
        fresh += commons_candidates(rec["scientific"])
        fresh += gbif_candidates(rec["scientific"])
        new = [c for c in rank(fresh) if c["url"].split("?")[0] not in have]
        rec["candidates"] = (rec["candidates"] + new)[:CANDIDATES_PER_SPECIES * 3]
        # Drop the "give me more" flag, since it has now been dug into — but
        # ONLY that flag. With --only this runs over species that already have
        # a chosen photo, and popping the entry would throw the choice away.
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
        # utf-8-sig, not utf-8. PowerShell's redirection and Notepad both write
        # a byte-order mark by default, and a BOM makes the first key
        # "﻿GEMINI_API_KEY", which matches nothing and looks for all the
        # world like the file was ignored.
        for line in dev.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                return v.strip().strip('"').strip("'")
    return os.environ.get(name, "").strip()


def key_help(name):
    """Why the key wasn't found, specifically.

    "Not found" covers three different mistakes — no file, an empty file, a
    file without that line — and they have three different fixes. An empty
    .dev.vars in particular is what a failed write leaves behind, which is
    exactly the case that looks like the tool is at fault.
    """
    dev = ROOT / ".dev.vars"
    lines = [f"No {name} found."]
    if not dev.exists():
        lines.append(f"  {dev} does not exist.")
    elif dev.stat().st_size == 0:
        lines.append(f"  {dev} exists but is EMPTY — the write didn't land.")
        lines.append("  (A disk with no free space produces exactly this.)")
    else:
        keys = [l.split("=", 1)[0].strip()
                for l in dev.read_text(encoding="utf-8-sig").splitlines()
                if "=" in l and not l.strip().startswith("#")]
        lines.append(f"  {dev} has: {', '.join(keys) or '(no KEY=VALUE lines)'}")
    lines += [
        "",
        "Fix it with one line — from the project root:",
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
    """One vision call, with backoff on the free tier's minute budget.

    Returns (parsed_json, None) or (None, "why it failed"). A 429 is not a
    failure worth reporting to the user — it is the expected shape of a free
    tier, and the server tells us how long to wait, so we wait.
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
                # The message carries "Please retry in 37.1s" — believe it.
                m = re.search(r"retry in ([\d.]+)s", detail)
                wait = min(float(m.group(1)) + 1, 65) if m else 20 * (attempt + 1)
                if "PerDay" in detail or "per day" in detail.lower():
                    return None, "daily free-tier quota is spent — try again tomorrow"
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
    """The first model that actually answers.

    Costs one tiny text call per model tried, which is far cheaper than
    discovering forty photos into a run that the model is unavailable today.
    """
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

    # Anything already checked is skipped. Re-running costs nothing but the
    # photos that have not been looked at yet.
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
    print(f"  {len(todo)} photos to check, {already} already done — "
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
            # A dead image link is a source problem, not a model problem.
            # Saying which is the difference between "re-pick this one" and
            # "the AI is broken".
            warn(sid, f"photo could not be downloaded ({e}) — the source link may be dead")
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
                print("  Re-run when it resets — everything checked so far is saved.")
                break
            continue

        c["verify"] = got
        # Written after EVERY photo, not at the end of the run. A call that is
        # paid for and then lost to a crash is the one genuinely wasteful thing
        # this could do on a free tier, and it also means a re-run resumes
        # instead of starting over.
        CANDIDATES.write_text(json.dumps(data, indent=1), encoding="utf-8")
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
        time.sleep(GEMINI_PAUSE)

    return 0


# --------------------------------------------------------------------------
# stage 3 — build
# --------------------------------------------------------------------------

# The longest edge a shipped photo may have. Big enough to stay sharp on a
# hero card at 2x, small enough that 68 of them are not a download.
#
# NOTE there is no card width or height here any more, and that is the point:
# nothing is cropped or composited. The whole original frame ships and the card
# gives it a consistent shape in CSS. A crop decided here would be permanent
# and could take a fin with it; a crop decided in CSS is a stylesheet edit.
MAX_EDGE = 1400


CARD_ASPECT = 4 / 3
# Breathing room around the fish, as a fraction of its own size. Cropped hard
# to the fish it looks like a mugshot; this leaves enough water or deck around
# it to read as a photograph.
FISH_MARGIN = 1.22


def find_fish(img, session):
    """Where the fish is, as a box in the original image.

    u2net is a salient-object detector — the thing rembg uses to decide what to
    keep. We want only its opinion of WHERE the subject is, not its cut-out, so
    this takes the mask and throws the matting away. The pixels that ship are
    the photographer's, untouched.

    Returns (x0, y0, x1, y1) or None if it cannot find a subject.
    """
    from rembg import remove
    mask = remove(img, session=session, only_mask=True)
    # Threshold before measuring. A raw mask has a faint halo of low-confidence
    # pixels around the subject, and getbbox() counts any non-zero pixel, so
    # the untresholded box creeps outward towards the whole frame.
    mask = mask.point(lambda p: 255 if p > 96 else 0)
    box = mask.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    # Something that fills almost everything is the detector shrugging, not a
    # fish; and something tiny is usually a speck of noise.
    frac = ((x1 - x0) * (y1 - y0)) / float(img.width * img.height)
    if frac > 0.97 or frac < 0.01:
        return None
    return box


def frame_on_fish(img, box):
    """A CARD_ASPECT window centred on the fish that contains all of it.

    Crops the picture, never the fish. If the fish is so long that no window of
    this shape can hold it inside the photo, this gives up and returns None —
    the whole frame ships and the card letterboxes it. Cutting a tail off to
    make the shape work would be the one thing worth avoiding here.
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

    # The fish must be wholly inside. Clamping to the edge can push the window
    # off it, so nudge back if so.
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
    # 'unsure' still builds — a flagged favourite beats a gap, and the flag
    # stays in picks.json so you can come back to it.
    unsure = [sid for sid, v in picks.items() if v.get("verdict") == "unsure"]
    if unsure:
        print(f"Building {len(unsure)} still marked unsure: {', '.join(sorted(unsure))}\n")

    from rembg import new_session

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    fitted = {}
    # Loaded once. Building the session per photo would re-read 176 MB of model
    # forty-three times.
    session = new_session("u2net")

    crops = load_crops()

    for sid, idx in sorted(chosen.items()):
        rec = data.get(sid)
        if not rec or idx is None or idx < 0 or idx >= len(rec["candidates"]):
            continue
        # A photo failed in the crop review is pulled entirely — the card says
        # "photo not yet available", which is the honest state until it is
        # replaced, rather than shipping something already judged wrong.
        cv = crops.get(sid, {})
        # "Replace this" and "rotate this" together is a contradiction worth
        # surfacing rather than resolving quietly: it usually means the photo
        # was failed BECAUSE it was sideways, and straightening it is the fix.
        # Building it keeps the choice open; pulling it would throw away a
        # photo the remark says is fine.
        if cv.get("verdict") == "fail" and not int(cv.get("rotate", 0)):
            out_dead = OUT_DIR / f"{sid}.jpg"
            if out_dead.exists():
                out_dead.unlink()
            print(f"  {sid:34} pulled — marked 'replace' in the crop review")
            continue
        if cv.get("verdict") == "fail":
            print(f"  {sid:34} marked 'replace' BUT rotated — building it rotated "
                  f"so you can judge it straightened")
        cand = rec["candidates"][idx]
        out = OUT_DIR / f"{sid}.jpg"

        # Normally an existing file is left alone. Not when you have just said
        # its crop is wrong — the whole point of that verdict is to change the
        # file, and making you remember --refresh for it would be a trap.
        # A rotation you have just asked for has to be applied, so a species
        # carrying one always rebuilds. There are only ever a handful.
        turn = int(crops.get(sid, {}).get("rotate", 0)) % 360
        recrop = crops.get(sid, {}).get("verdict") == "full" or turn
        if out.exists() and not args.refresh and not recrop:
            manifest[sid] = manifest_entry(sid, cand)
            continue

        try:
            req = urllib.request.Request(cand["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                blob = r.read()
        except Exception as e:
            print(f"  {sid}: download failed — {e}")
            continue

        try:
            src = Image.open(io.BytesIO(blob))
            # EXIF orientation is a flag, not applied pixels. Without this a
            # phone photo taken in portrait arrives on its side.
            src = ImageOps.exif_transpose(src).convert("RGB")
            # Straighten it before anything else looks at it — the detector
            # reads a sideways fish as a tall thin subject and frames it badly.
            if turn:
                src = src.rotate(-turn, expand=True)

            # Find the fish and frame on it. The pixels that ship are the
            # photographer's — the detector only decides WHERE to cut the
            # picture, never what to erase from it.
            note = "full frame"
            # "Bad crop, good photo" — ship the whole frame and skip detection
            # entirely. Re-running the detector would only find the same wrong
            # thing again.
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
                    note = "fish too long to frame — full frame kept"
            elif crops.get(sid, {}).get("verdict") != "full":
                # Only say the detector found nothing when it actually looked.
                # For a "use whole photo" verdict it was never asked, and
                # reporting a failure there would send you hunting a bug that
                # is really your own instruction being followed.
                note = "no subject found — full frame kept"
            fitted[note] = fitted.get(note, 0) + 1

            src.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
            src.save(out, "JPEG", quality=86, optimize=True, progressive=True)
            print(f"  {sid:34} {src.width}x{src.height}  "
                  f"{out.stat().st_size // 1024:>4} KB  {note}")
        except Exception as e:
            print(f"  {sid}: could not be processed — {e}")
            continue

        manifest[sid] = manifest_entry(sid, cand)

    write_manifest(manifest)
    print()
    for note, n in sorted(fitted.items(), key=lambda kv: -kv[1]):
        print(f"  {n:>3}  {note}")
    print(f"\n{len(manifest)} photos in {OUT_DIR}")
    print(f"Manifest: {MANIFEST_JS}")
    return 0


# --------------------------------------------------------------------------
# stage 3b — pass or fail the crops
# --------------------------------------------------------------------------
#
# The crop is decided by a saliency model, and a saliency model is sometimes
# looking at the diver, the hand, or the brightest rock. Nothing in the build
# can tell you it got the wrong thing — only looking can.
#
# Three verdicts, because "fail" alone would not say what to do about it:
#
#   pass  the crop is good
#   full  the crop is wrong but the PHOTO is fine — ship the whole frame
#   fail  the photo itself is no good — pull it and find another
#
# `full` is the useful one. Most bad crops are a good photograph framed badly,
# and re-picking a perfectly good photo to fix a crop would be wasted work.

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

    # How each one was framed, so a letterboxed card is obviously a decision
    # rather than a mistake.
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
            else f"whole frame, {w}x{h} — letterboxed on the card"

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
            f"{btn('full', 'Bad crop — use whole photo')}"
            f"{btn('fail', 'Bad photo — replace it')}"
            f"<button class='v v--clear' data-sp='{sid}' data-verdict='clear'>Clear</button>"
            f"<span class='state' data-state='{sid}'></span>"
            f"</div>"
            # Rotation is not a verdict — a photo can be good AND on its side.
            # Kept separate so you can pass it and straighten it in one go.
            f"<div class='verdicts'>"
            f"<span class='rotlabel'>Rotate</span>"
            f"<button class='v v--rot' data-sp='{sid}' data-rot='-90'>&#8634; left</button>"
            f"<button class='v v--rot' data-sp='{sid}' data-rot='90'>&#8635; right</button>"
            f"<span class='rotnow' data-rotnow='{sid}'>"
            f"{(str(v.get('rotate', 0)) + '&deg;') if v.get('rotate') else ''}</span>"
            f"</div>"
            f"<textarea class='note' data-sp='{sid}' rows='2' "
            f"placeholder='Remarks — what is wrong with this crop or photo'>"
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
<p class=lede>Each photo is shown exactly as the species card shows it — same ratio, same fit,
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
    document.getElementById('state').textContent = 'NOT SAVED — is the server still running?';
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
            # Served from here rather than by file:// path, so the sheet works
            # the same whichever directory it is opened from.
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
                    else:
                        entry.pop("verdict", None)   # a remark outlives a cleared verdict
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

    with socketserver.TCPServer(("127.0.0.1", port), Handler) as srv:
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
    built = {p.stem for p in OUT_DIR.glob("*.jpg")} if OUT_DIR.exists() else set()

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
    # Line-buffered, so a run redirected to a log is watchable while it works.
    # Python block-buffers stdout when it is not a terminal, which meant a
    # forty-minute background search wrote nothing at all until it exited —
    # indistinguishable, from outside, from a job that had silently died.
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
