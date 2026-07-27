# Generates the PWA icons from the app's own pixel art.
# The fish shape and palette are read straight out of js/pixel.js, so the icon
# never drifts from the sprites shown inside the app.
#
# Run:  python tools/make_icons.py
# Out:  icons/icon-{180,192,512}.png plus maskable variants.

import os
import re
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)

SRC = open(os.path.join(ROOT, 'js', 'pixel.js'), encoding='utf-8').read()
SLOTS = 'OSDBMLHFA'

CREAM = '#FFF8E7'
YELLOW = '#FFD23F'
SPRITE = 'perch'      # which sprite to use
PALETTE = 'ocean'     # which colourway


def sprite(name):
    block = re.search(r'export const SPRITES = \{(.*?)\n\};', SRC, re.S).group(1)
    body = re.search(r"\b%s: \[(.*?)\]," % name, block, re.S).group(1)
    return re.findall(r"'([^']*)'", body)


def palette(name):
    block = re.search(r'export const PALETTES = \{(.*?)\n\};', SRC, re.S).group(1)
    body = re.search(r"\b%s:\s*\[(.*?)\]," % name, block, re.S).group(1)
    return re.findall(r"'(#[0-9a-fA-F]{6})'", body)


GRID = sprite(SPRITE)
PAL = palette(PALETTE)
CMAP = {SLOTS[i]: PAL[i] for i in range(len(SLOTS))}
CMAP['E'] = '#ffffff'
CMAP['P'] = '#10141c'


def draw(size, maskable):
    img = Image.new('RGB', (size, size), CREAM)
    d = ImageDraw.Draw(img)

    # Maskable icons get cropped to a circle by the OS, so keep art well inside
    # the safe zone; standard icons can use more of the canvas.
    inset = 0.26 if maskable else 0.12

    if maskable:
        d.rectangle([0, 0, size, size], fill=YELLOW)
    else:
        pad = int(size * 0.05)
        d.rounded_rectangle([pad, pad, size - pad, size - pad],
                            radius=int(size * 0.22), fill=YELLOW,
                            outline=CMAP['O'], width=max(2, size // 42))

    gw, gh = len(GRID[0]), len(GRID)
    px = max(1, int(size * (1 - inset * 2) / gw))
    ox = (size - px * gw) // 2
    oy = (size - px * gh) // 2

    for y, row in enumerate(GRID):
        for x, c in enumerate(row):
            if c in CMAP:
                d.rectangle([ox + x*px, oy + y*px, ox + x*px + px - 1, oy + y*px + px - 1],
                            fill=CMAP[c])
    return img


made = []
for size in (192, 512):
    for maskable in (False, True):
        name = f"icon-{size}{'-maskable' if maskable else ''}.png"
        draw(size, maskable).save(os.path.join(OUT, name))
        made.append(name)

draw(180, False).save(os.path.join(OUT, 'icon-180.png'))
made.append('icon-180.png')

print(f"{SPRITE}/{PALETTE} -> " + ', '.join(made))
