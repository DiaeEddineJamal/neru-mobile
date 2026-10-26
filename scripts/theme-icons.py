"""The mascot in each accent theme: `python scripts/theme-icons.py` from mobile/.

Recolors only the mascot's green body (hue 70-170 degrees), keeping its paper texture, eyes and shadow, toward the
middle of the theme's dark-mode moss and sage (src/theme.ts). Moss is the original artwork. Writes, per theme:
assets/images/themes/<id>/android-icon-foreground.png (the launcher icon) and mascot.png (in the app).
"""
import colorsys
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')
# Dark-mode moss and sage of each palette in src/theme.ts.
THEMES = {
    'glacier': ('#6f9aa5', '#9cbcc4'),
    'heather': ('#b48aa6', '#d1b3c7'),
    'terracotta': ('#c98a72', '#dcae9b'),
    'saffron': ('#d1ad62', '#e0c88f'),
    'tidepool': ('#5fa595', '#8fc2b5'),
    'twilight': ('#8e9ec0', '#b4c0da'),
}
BASE = (120, 144, 119)  # the original body green


def hsv(rgb):
    return colorsys.rgb_to_hsv(*(c / 255 for c in rgb))


def target(moss, sage):
    a, b = (tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in (moss, sage))
    return tuple((x + y) // 2 for x, y in zip(a, b))


def recolor(src, dst, color, size=None):
    bh, bs, bv = hsv(BASE)
    th, ts, tv = hsv(color)
    im = Image.open(src).convert('RGBA')
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s < 0.06 or not 70 / 360 <= h <= 170 / 360:
                continue
            nr, ng, nb = colorsys.hsv_to_rgb(th, min(1, s * ts / bs), min(1, v * tv / bv))
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, optimize=True)


for theme, (moss, sage) in THEMES.items():
    color = target(moss, sage)
    out = os.path.join(ROOT, 'themes', theme)
    recolor(os.path.join(ROOT, 'android-icon-foreground.png'), os.path.join(out, 'android-icon-foreground.png'), color)
    # The app shows the mascot at 128dp at most: 512px is sharp on any screen and keeps the bundle small.
    recolor(os.path.join(ROOT, 'neru-mascot.png'), os.path.join(out, 'mascot.png'), color, 512)
    print(theme, color)
