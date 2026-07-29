"""
Pull local (vernacular) fish names from FishBase into the species catalogue.

    python tools/fetch_fishbase.py            # dry run — prints what it would add
    python tools/fetch_fishbase.py --write    # actually edit the catalogue

Needs duckdb:  pip install duckdb

WHY THIS IS A BUILD-TIME TOOL AND NOT AN API CALL
-------------------------------------------------
FishBase publishes versioned Parquet snapshots on public S3 (no key, no
signup) — the same ones the rOpenSci `rfishbase` package reads. There is no
live species API worth depending on, and we would not want one: the app has to
work on a boat with no signal. So the names are baked into js/data at build
time, exactly like the sprites in tools/author_sprites.py.

LICENCE
-------
FishBase data is CC BY-NC 4.0. Free for personal, non-commercial use with
attribution, which is what this app is. If this ever becomes commercial the
FishBase team have to be contacted first — see <https://fishbase.org>.

PRIORITY: BFAR OUTRANKS FISHBASE
--------------------------------
BFAR Region VIII data is regional — collected in these waters. FishBase's
COMNAMES is national. Where they disagree the regional source wins, so names
already in the catalogue are never removed, never reordered, and always come
first. FishBase only ever appends.
"""

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'js' / 'data' / 'species' / 'indo-pacific.js'

SNAPSHOT = 'v23.01'
FB = f'https://data.source.coop/cboettig/fishbase/fb/{SNAPSHOT}/parquet'
SLB = f'https://data.source.coop/cboettig/fishbase/slb/{SNAPSHOT}/parquet'

# FishBase language -> the key used in `local: { ... }`.
#
# 'Visayan' is deliberately absent. It is a language GROUP covering Waray,
# Cebuano and Hiligaynon; filing those rows under any single one would invent
# precision the source does not have.
LANG_MAP = {'Waray-waray': 'war', 'Cebuano': 'ceb', 'Tagalog': 'tl'}
ORDER = ['war', 'ceb', 'tl']

# Real rows in FishBase, but loanwords and anglicisms rather than local
# knowledge — "Barracuda" is not a Waray name for a barracuda.
JUNK = re.compile(
    r'^(barracuda|baracuda|nylon|rumpe|rompe|rumpi|tursilyo|torsilyo|trosilyo|'
    r'penyosa|bikuda|siga-sigaro|kandado)',
    re.I,
)

# Keeps the detail sheet readable. BFAR names are never counted out by this —
# they are added before the cap applies.
CAP = 8


def variant_key(name):
    """Collapse spelling variants: 'Sap-sap', 'sapsap', 'Sap sap' all match."""
    return re.sub(r'[^a-z]', '', name.lower())


def read_catalogue():
    """id / scientific name / existing local names, straight from the data file."""
    js = SRC.read_text(encoding='utf-8')
    out = []
    for m in re.finditer(r"\{\s*id: '([^']+)',(.*?)\n  \}", js, re.S):
        body = m.group(2)
        sci = re.search(r"scientific: '([^']+)'", body)
        if not sci:
            continue
        have = {}
        loc = re.search(r'local: \{([^}]*)\}', body)
        if loc:
            for lang, arr in re.findall(r'(\w+): \[([^\]]*)\]', loc.group(1)):
                have[lang] = [x.strip().strip("'") for x in arr.split(',') if x.strip()]
        out.append({'id': m.group(1), 'sci': sci.group(1), 'have': have})
    return js, out


def fetch_names(con, base, entries):
    pairs = ' OR '.join(
        "(sp.Genus='%s' AND sp.Species='%s')" % tuple(e['sci'].split()[:2])
        for e in entries if len(e['sci'].split()) >= 2
    )
    langs = ','.join(f"'{l}'" for l in LANG_MAP)
    return con.execute(f"""
        SELECT sp.Genus || ' ' || sp.Species, c.Language, c.ComName
        FROM '{base}/species.parquet' sp
        JOIN '{base}/comnames.parquet' c USING (SpecCode)
        WHERE ({pairs}) AND c.Language IN ({langs})
    """).fetchall()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--write', action='store_true', help='edit the catalogue in place')
    args = ap.parse_args()

    try:
        import duckdb
    except ImportError:
        sys.exit('duckdb is required:  pip install duckdb')

    js, entries = read_catalogue()
    print(f'catalogue: {len(entries)} species')

    con = duckdb.connect()
    con.execute('INSTALL httpfs; LOAD httpfs;')

    rows = fetch_names(con, FB, entries)
    try:
        # Squid and crab live in SeaLifeBase, not FishBase.
        rows += fetch_names(con, SLB, entries)
    except Exception as err:  # noqa: BLE001 — informational, never fatal
        print(f'sealifebase unavailable: {str(err)[:100]}')

    found = {}
    for sci, lang, name in rows:
        found.setdefault(sci, {}).setdefault(lang, set()).add(name.strip())

    added = 0
    changed = 0

    for e in entries:
        got = found.get(e['sci'], {})
        if not got:
            continue

        have = e['have']
        # Every BFAR name for this species in ANY language. A FishBase name
        # that matches one is almost certainly the real name, so it ranks
        # first — ranking alphabetically instead kept 'iso' and dropped
        # 'maya maya', which is the name everyone actually uses.
        corroborated = {variant_key(n) for names in have.values() for n in names}

        merged = {}
        for lang in ORDER:
            existing = list(have.get(lang, []))
            seen = {variant_key(n) for n in existing}
            fb_lang = next((k for k, v in LANG_MAP.items() if v == lang), None)

            extra = []
            for name in sorted(got.get(fb_lang, [])):
                if '(' in name or JUNK.match(name) or len(name) <= 2:
                    continue  # a gloss, a loanword, or noise
                key = variant_key(name)
                if key and key not in seen:
                    seen.add(key)
                    extra.append(name.lower())

            extra.sort(key=lambda n: (variant_key(n) not in corroborated, len(n), n))

            keep = (existing + extra)[:CAP]
            if keep:
                merged[lang] = keep
            gained = [n for n in extra if n in keep]
            if gained:
                added += len(gained)
                print(f'  {e["id"]:<32} +{lang}: {", ".join(gained)}')

        for lang, names in have.items():
            merged.setdefault(lang, names)

        if merged == have:
            continue
        changed += 1

        parts = [
            f'{lang}: [' + ', '.join(f"'{n}'" for n in merged[lang]) + ']'
            for lang in ORDER + [l for l in merged if l not in ORDER]
            if lang in merged
        ]
        line = 'local: { ' + ', '.join(parts) + ' },'
        pattern = re.compile(r"(\{\s*id: '" + re.escape(e['id']) + r"',.*?)local: \{[^}]*\},", re.S)
        js = pattern.sub(lambda m: m.group(1) + line, js, count=1)

    print(f'\n{changed} species would gain {added} names')
    if args.write:
        SRC.write_text(js, encoding='utf-8')
        print(f'written -> {SRC.relative_to(ROOT)}')
    else:
        print('dry run — pass --write to apply')


if __name__ == '__main__':
    main()
