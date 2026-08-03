# Generates the PWA icons from the app's own brand mark.
#
# The mark is the hook from js/art/modern.js redrawn in the same coordinate
# space, and the two colours are read out of css/style.css — so the icon on
# someone's home screen cannot drift away from the one in the header. It used
# to draw the pixel perch on a gold tile, which stopped being the app's look
# the day the palette went blue.
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

CSS = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()


def token(name):
    """A custom property's value, from the stylesheet."""
    m = re.search(r'--%s:\s*(#[0-9a-fA-F]{6})' % re.escape(name), CSS)
    if not m:
        raise SystemExit(f"css/style.css has no --{name}; the palette moved")
    return m.group(1)


BLUE = token('blue')
CREAM = token('cream')

# The mark's own coordinate space, matching the viewBox in modernBrandMark.
VB_W, VB_H = 40.0, 48.0

# Drawn at 4x and shrunk, because PIL does not antialias strokes and a fishhook
# is almost entirely curve — aliased at 192px it comes out a staircase.
SS = 4


def draw_mark(d, colour, scale, ox, oy):
    def P(x, y):
        return (ox + x * scale, oy + y * scale)

    def W(t):
        return max(1, int(round(t * scale)))

    def box(cx, cy, r):
        return [ox + (cx - r) * scale, oy + (cy - r) * scale,
                ox + (cx + r) * scale, oy + (cy + r) * scale]

    def stroked(cx, cy, r, w):
        """Bounding box for a stroke CENTRED on radius r.

        PIL grows arc and ellipse widths INWARD from the bounding box, where
        SVG centres them on the path. Left uncorrected the bend sits half a
        stroke inside the shank and the two meet in a visible step.
        """
        return box(cx, cy, r + w / 2)

    shank = W(5.4)

    # The shank, straight down the right.
    d.line([P(27, 6), P(27, 28)], fill=colour, width=shank)
    # The bend: the bottom half of a circle, coming back up to meet it.
    d.arc(stroked(16, 28, 11, 5.4), 0, 180, fill=colour, width=shank)
    # PIL strokes have flat caps, so the shank and the bend meet in a notch.
    # A disc at each joint is the round join the SVG gets for free.
    d.ellipse(box(27, 28, 2.7), fill=colour)
    d.ellipse(box(5, 28, 2.7), fill=colour)

    # NO BARB. The header mark curls a point off the end of the bend, and at
    # 40px it is already almost invisible; at a 48px home-screen tile, drawn in
    # a stroke this thick, it closes the gap and the bend fills into a blob.
    # The hook reads as a hook without it.

    # The eye: a bar across the top, into a ring.
    d.line([P(20, 6), P(30, 6)], fill=colour, width=W(5))
    d.ellipse(box(20, 6, 2.5), fill=colour)
    d.ellipse(stroked(33.6, 6, 4.6, 2.6), outline=colour, width=W(2.6))


def draw(size, maskable):
    S = size * SS
    img = Image.new('RGB', (S, S), BLUE)
    d = ImageDraw.Draw(img)

    if not maskable:
        # A rounded tile with a cream keyline, so the icon has an edge of its
        # own on platforms that don't give it one.
        pad = int(S * 0.045)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=CREAM)
        d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad],
                            radius=int(S * 0.19), fill=BLUE)

    # Maskable icons are cropped to a circle, so the mark has to sit well inside
    # the safe zone; a standard icon can use more of the canvas.
    frac = 0.50 if maskable else 0.62
    scale = S * frac / VB_H
    ox = (S - VB_W * scale) / 2
    oy = (S - VB_H * scale) / 2
    draw_mark(d, CREAM, scale, ox, oy)

    return img.resize((size, size), Image.LANCZOS)


made = []
for size in (192, 512):
    for maskable in (False, True):
        name = f"icon-{size}{'-maskable' if maskable else ''}.png"
        draw(size, maskable).save(os.path.join(OUT, name))
        made.append(name)

draw(180, False).save(os.path.join(OUT, 'icon-180.png'))
made.append('icon-180.png')

print(f"brand mark, {CREAM} on {BLUE} -> " + ', '.join(made))
