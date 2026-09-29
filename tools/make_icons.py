# Generates the PWA icons from the brand mark.
#
# The hook is redrawn from js/art/modern.js and the colours are read from
# css/style.css so the icons match the app.
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

# Draw at 4x and downscale for antialiasing (PIL doesn't antialias strokes).
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
        """Bounding box for a stroke centred on radius r (PIL draws arc widths inward
        from the box; SVG centres them on the path).
        """
        return box(cx, cy, r + w / 2)

    shank = W(5.4)

    # The shank, straight down the right.
    d.line([P(27, 6), P(27, 28)], fill=colour, width=shank)
    # The bend: the bottom half of a circle, coming back up to meet it.
    d.arc(stroked(16, 28, 11, 5.4), 0, 180, fill=colour, width=shank)
    # Round joins (PIL strokes have flat caps).
    d.ellipse(box(27, 28, 2.7), fill=colour)
    d.ellipse(box(5, 28, 2.7), fill=colour)

    # No barb: at icon size it closes up and the bend turns into a blob.

    # The eye: a bar across the top, into a ring.
    d.line([P(20, 6), P(30, 6)], fill=colour, width=W(5))
    d.ellipse(box(20, 6, 2.5), fill=colour)
    d.ellipse(stroked(33.6, 6, 4.6, 2.6), outline=colour, width=W(2.6))


def draw(size, maskable):
    S = size * SS
    img = Image.new('RGB', (S, S), BLUE)
    d = ImageDraw.Draw(img)

    if not maskable:
        # Rounded tile with a cream keyline.
        pad = int(S * 0.045)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=CREAM)
        d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad],
                            radius=int(S * 0.19), fill=BLUE)

    # Maskable icons get cropped to a circle, so keep the mark in the safe zone.
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
