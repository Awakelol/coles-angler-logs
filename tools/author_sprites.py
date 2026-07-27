"""
Authoring tool for the pixel-art sprites.

Bodies are hand-drawn (head at left, ' ' = transparent, rows auto-padded).
Caudal fins are generated as an outlined *forked* tail so every fish gets a
consistent, correctly-attached tail without hand-counting pixels.

Character map (10 shading slots, matching PALETTES in js/pixel.js):
    O outline    S shadow/top    D dorsal      B body      M midtone
    L belly      H highlight     F fin         A accent
    E eye white  P pupil         . transparent

Run:  python tools/author_sprites.py
Then paste tools/sprites.generated.js into SPRITES in js/pixel.js.
"""

import os
from PIL import Image, ImageDraw

# Reference palette, used for the preview render only.
PAL = {
    'O': '#151b26',  # outline
    'S': '#2d4a63',  # deep shadow along the back
    'D': '#3f6b8a',  # dorsal
    'B': '#6f9ab5',  # body
    'M': '#a3c2d4',  # midtone / dither
    'L': '#d8e8f0',  # belly
    'H': '#ffffff',  # highlight
    'F': '#4e7d9c',  # fins
    'A': '#e8b53c',  # accent
    'E': '#ffffff',
    'P': '#10141c',
}

# name: (fork_depth, rows)   fork_depth None = no caudal fin (squid/crab)
#
# Detail that makes these read as fish rather than blobs, taken from the
# reference art: a pointed snout, a gill line behind the head, a dorsal fin
# that stands proud of the back, and pelvic/anal fins hanging clear underneath
# with a gap of outline between them and the belly.
BODIES = {

# --- deep-bodied: ponyfish, mojarras -------------------------------------
'deep': (5, [
'          OOOOOOOO',
'         OFFFFFFFO',
'        OFFFFFFFFFO',
'      OOOFFFFFFFFOOO',
'    OOSSSOOOOOOOOSSSOO',
'   OSSSSSSSSSSSSSSSSSO',
'  OSSSSSDDDDDDDDDDDDSO',
' OSDDDDDDDDBBBBBBBBBDO',
'OODDDDDBBBBBBBBBBBBBBO',
'OEPEODDBBBBBBMBMBBBBBO',
'OEEEOBBBBBMBMBMBMBBBBO',
'OOEEOBBMBMBMBMBMBMBBBO',
' OOMMMMLMLMLMLMLMLMLBO',
'  OMLLLLLLLLLLLLLLLMBO',
'  OLLLLLLLLLLLLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLOO',
'  OHHLLLLLLLLLLLLLLOO',
'   OOHHLLLLLLLLLLOO',
'     OOOFFFFFFOOO',
'       OFFFFFFO',
'       OOOOOOOO',
]),

# --- perch build: snappers, breams, trevally ------------------------------
'perch': (6, [
'            OOOOOOOOO',
'           OFFFFFFFFO',
'          OFFFFFFFFFFO',
'       OOOOFFFFFFFFFOOO',
'    OOOSSSSOOOOOOOOSSSSOO',
'  OOSSSSSSSSSSSSSSSSSSSSO',
' OSSSSSSDDDDDDDDDDDDDDDSO',
'OODDDDDDDDDDBBBBBBBBBBBDO',
'OEPEODDDDBBBBBBBBBBBBBBBO',
'OEEEOBBBBBBBBMBMBMBBBBBBO',
'OOEEOBBBBMBMBMBMBMBMBBBBO',
' OOMMMBMBMBMBMBMBMBMBMBBO',
'  OMMLMLMLMLMLMLMLMLMLMBO',
'  OLLLLLLLLLLLLLLLLLLLLBO',
'   OHLLLLLLLLLLLLLLLLLLOO',
'   OOHHLLLLLLLLLLLLLLLOO',
'     OOOFFOOOOFFFFOOOO',
'       OFFO   OFFFO',
'       OOOO   OOOO',
]),

# --- streamlined pelagic: mackerel, scad, sardine -------------------------
'torpedo': (7, [
'                OOOO',
'               OFFFFO',
'              OFFFFFO',
'        OOOOOOOFFFFOOOO',
'     OOOSSSSSSSSSSSSSSSOO',
'   OOSSSSSSSSSSSSSSSSSSSSO',
' OOSSDDDDDDDDDDDDDDDDDDDDSO',
'OODDDDDDDDDBBBBBBBBBBBBBBDO',
'OEPEODDDBBBBBBBBBBBBBBBBBBO',
'OEEEOBBBBBBMBMBMBMBMBBBBBBO',
'OOEEOBBMBMBMBMBMBMBMBMBMBBO',
' OOMMMLMLMLMLMLMLMLMLMLMLBO',
'  OLLLLLLLLLLLLLLLLLLLLLLBO',
'   OOHLLLLLLLLLLLLLLLLLLLOO',
'     OOOHHLLLLLLLLLLLLLLOO',
'        OOOOOFFOOOFFOOOOO',
'             OFFO OFFO',
'              OO   OO',
]),

# --- tuna: thick shoulders, sickle fins, finlets along the peduncle -------
'tuna': (8, [
'           OOOO              ',
'          OFFFFO             ',
'         OFFFFFFO            ',
'        OFFFFFFFFO           ',
'     OOOOFFFFFFFFOOOO        ',
'   OOSSSSOOOOOOOOSSSSSOO     ',
' OOSSSSSSSSSSSSSSSSSSSSSOO   ',
'OODDDDDDDDDDDDDDDDDDDDDDDSO  ',
'OEPEODDDDDBBBBBBBBBBBBBBBDAO ',
'OEEEOBBBBBBBBBBMBMBMBBBBBBAO ',
'OOEEOBBBBBMBMBMBMBMBMBBBBBAO ',
' OOMMMMBMBMBMBMBMBMBMBMBMBAO ',
'  OMLLLLLLLLLLLLLLLLLLLLLLBO ',
'  OLLLLLLLLLLLLLLLLLLLLLLLOO ',
'  OOHLLLLLLLLLLLLLLLLLLLLAO  ',
'   OOOHHLLLLLLLLLLLLLLLLAO   ',
'     OOOOFFFFFOOOOOOOOOO     ',
'        OFFFFFFO             ',
'         OOOOOO              ',
]),

# --- grouper: heavy head, big rounded fins, mottled flanks ----------------
'grouper': (4, [
'          OOOOOOOOOOO',
'         OFFFFFFFFFFFO',
'       OOOFFFFFFFFFFFFO',
'    OOOSSSOOOOOOOOOOOOOO',
'  OOSSSSSSASSSSASSSSSSSSO',
' OSSSSSSSSSSSSSSSSSSSSSDO',
'OODDDADDDDDDDDADDDDDDDDDO',
'OEPEODDDBBBBABBBBBBBABBBO',
'OEEEOBBBBBBBBBBBABBBBBBBO',
'OOEEOBBABBBBMBMBMBBBABMBO',
' OOMMMBBBBMBMBMBMBMBMBMBO',
'  OMMLMLALMLMLMLMLALMLMBO',
'  OLLLLLLLLLLLLALLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLLLLOO',
'  OOHHLLLLLLLLLLLLLLLLOO',
'    OOOFFFFOOOOFFFFFOOO',
'      OFFFFO  OFFFFFO',
'      OOOOOO  OOOOOO',
]),

# --- barracuda / needlefish: long and lean --------------------------------
'long': (6, [
'              OOOOOO         ',
'             OFFFFFO         ',
'          OOOOFFFFOOOOO      ',
'   OOOOOOOSSSSOOOOSSSSSSOO   ',
' OOSSSSSSSSSSSSSSSSSSSSSSSSO ',
'OODDDDDDDDDDDDDDDDDDDDDDDDDSO',
'OEPEODDDDBBBBBBBBBBBBBBBBBBDO',
'OEEEOBBBBBBBBBBBBBBBBBBBBBBBO',
'OOEEOBMBMBMBMBMBMBMBMBMBMBMBO',
' OOMMMLLLLLLLLLLLLLLLLLLLLLBO',
'  OLLLLLLLLLLLLLLLLLLLLLLLLOO',
'  OOHLLLLLLLLLLLLLLLLLLLLLOO ',
'    OOOOFFOOOOOOOOFFFOOOOO   ',
'       OFFO      OFFO        ',
'       OOOO      OOOO        ',
]),

# --- rabbitfish / spinefoot: oval body, spiny dorsal ----------------------
'oval': (5, [
'      A A A A A A A',
'      OAOAOAOAOAOAO',
'     OOFFFFFFFFFFFOO',
'   OOOFFFFFFFFFFFFFOOO',
'  OOSSSOOOOOOOOOOOOSSSOO',
' OSSSSSSSSSSSSSSSSSSSSSO',
' OSSSSSDDDDDDDDDDDDDDDDO',
'OODDDDDDDBBBBBBBBBBBBBBO',
'OEPEODDDBBBBBBMBMBBBBBBO',
'OEEEOBBBBBMBMBMBMBMBBBBO',
'OOEEOBBMBMBMBMBMBMBMBMBO',
' OOMMMMLMLMLMLMLMLMLMLBO',
'  OMLLLLLLLLLLLLLLLLLLBO',
'  OLLLLLLLLLLLLLLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLLLOO',
'  OOHHLLLLLLLLLLLLLLLOO',
'    OOOFFFFFFFFFFFFOO',
'      OFFFFFFFFFFO',
'      OOOOOOOOOOOO',
]),

# --- milkfish / mullet: sleek, huge deeply forked tail --------------------
'forked': (9, [
'          OOOOOOO',
'         OFFFFFFFO',
'        OFFFFFFFFFO',
'      OOOFFFFFFFFOOO',
'   OOOSSSOOOOOOOOSSSSOO',
' OOSSSSSSSSSSSSSSSSSSSSO',
'OOSSSSDDDDDDDDDDDDDDDDSO',
'OODDDDDDDDBBBBBBBBBBBBDO',
'OEPEODDDBBBBBBBMBMBBBBBO',
'OEEEOBBBBBBMBMBMBMBMBBBO',
'OOEEOBBMBMBMBMBMBMBMBMBO',
' OOMMMMLMLMLMLMLMLMLMLBO',
'  OMLLLLLLLLLLLLLLLLLLBO',
'  OLLLLLLLLLLLLLLLLLLLOO',
'  OOHLLLLLLLLLLLLLLLLOO',
'   OOOHHLLLLLLLLLLLLOO',
'     OOOOFFFOOOOOOOO',
'        OFFFFO',
'        OOOOOO',
]),

# --- squid ----------------------------------------------------------------
'squid': (None, [
'        OOOOOO',
'      OOSSAASSOO',
'     OSSAAAAAASO',
'    OSSAAAAAAAASO',
'   OSBBBBBBBBBBBSO',
'   OBBBBBBBBBBBBBO',
'  OBBBEPBBBBBBEPBBO',
'  OBBBEEBBBBBBEEBBO',
'  OBBBBBBBBBBBBBBBO',
'  OBMBMBMBMBMBMBMBO',
'   OMMMMMMMMMMMMMO',
'   OLOLOLOLOLOLOLO',
'   OL OL OL OL OLO',
'  OL  O   O   O  LO',
'  O   O   O   O   O',
]),

# --- crab -----------------------------------------------------------------
'crab': (None, [
'',
'   OO             OO',
'  OAAO  OOOOOOO  OAAO',
'  OAAOOOSSSSSSSOOOAAO',
'   OOOSSEPSSSEPSSOOO',
'    OSBBBBBBBBBBBBSO',
'   OSBBBBBBBBBBBBBBSO',
'  OOBBBBBBBBBBBBBBBBOO',
' O OOBBBBMBMBMBMBBBOO O',
' O  OOMMMMMMMMMMMMOO  O',
'  O  O OOOOOOOOOO O  O',
'  O  O  O      O  O  O',
'     O  O      O  O',
]),
}


def build(fork, rows):
    grid = [list(r.replace(' ', '.')) for r in rows]
    w = max((len(r) for r in grid), default=0)
    for r in grid:
        r.extend('.' * (w - len(r)))

    if fork is not None:
        occupied = [(y, x) for y, r in enumerate(grid) for x, c in enumerate(r) if c != '.']
        ys = [y for y, _ in occupied]
        attach = max(x for _, x in occupied) + 1
        cy = (min(ys) + max(ys)) / 2
        half = max((max(ys) - min(ys)) / 2, 1e-6)

        total_w = attach + fork + 2
        for r in grid:
            r.extend('.' * (total_w - len(r)))

        # A caudal fin attaches at a narrow peduncle and flares outward, with a
        # notch cut into the trailing edge. Building it column by column (rather
        # than row by row) is what gives it that shape instead of a flat slab.
        ped_half = max(half * 0.26, 1.2)   # height where it meets the body
        tip_half = half * 1.02             # height at the outer lobes

        for i in range(fork + 1):
            t = i / fork
            hh = ped_half + (tip_half - ped_half) * t
            # The notch only starts once the fin has flared out a little.
            notch = 0.0 if t < 0.45 else (t - 0.45) / 0.55 * hh * 0.85
            x = attach + i
            if x >= total_w:
                break
            for y in range(len(grid)):
                dy = abs(y - cy)
                if dy <= hh and dy >= notch and grid[y][x] == '.':
                    grid[y][x] = 'F'

        for y, r in enumerate(grid):
            for x, c in enumerate(r):
                if c != 'F':
                    continue
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < len(grid) and 0 <= nx < len(grid[0]) and grid[ny][nx] == '.':
                        grid[ny][nx] = 'O'

    w = max(len(r) for r in grid)
    for r in grid:
        r.extend('.' * (w - len(r)))

    out = [''.join(r) for r in grid]
    while out and set(out[0]) == {'.'}:
        out.pop(0)
    while out and set(out[-1]) == {'.'}:
        out.pop()
    return out


sprites = {n: build(f, rows) for n, (f, rows) in BODIES.items()}
for n, g in sprites.items():
    assert len({len(r) for r in g}) == 1, f"{n} has ragged rows"
    stray = {c for r in g for c in r} - set(PAL) - {'.'}
    assert not stray, f"{n} has stray characters {stray}"

# ---------------------------------------------------------------- preview
HERE = os.path.dirname(os.path.abspath(__file__))
SCALE, PAD, cols = 7, 14, 4
names = list(sprites)
rows_n = (len(names) + cols - 1) // cols
maxw = max(len(g[0]) for g in sprites.values())
maxh = max(len(g) for g in sprites.values())
cw, ch = maxw * SCALE + PAD * 2, maxh * SCALE + PAD * 2 + 16
img = Image.new('RGB', (cw * cols, ch * rows_n), '#fff8e7')
d = ImageDraw.Draw(img)
for i, name in enumerate(names):
    ox, oy = (i % cols) * cw + PAD, (i // cols) * ch + PAD
    for y, row in enumerate(sprites[name]):
        for x, c in enumerate(row):
            if c in PAL:
                d.rectangle([ox+x*SCALE, oy+y*SCALE, ox+x*SCALE+SCALE-1, oy+y*SCALE+SCALE-1], fill=PAL[c])
    d.text((ox, oy + maxh*SCALE + 2), name, fill='#333')
preview = os.path.join(HERE, 'sprite-preview.png')
img.save(preview)

# ---------------------------------------------------------------- emit JS
out = []
for name, g in sprites.items():
    body = ',\n'.join("    '%s'" % r for r in g)
    out.append("  %s: [\n%s,\n  ]," % (name, body))
with open(os.path.join(HERE, 'sprites.generated.js'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

print(f"{len(sprites)} sprites, max {maxw}x{maxh}")
print("preview ->", preview)
