#!/usr/bin/env python3
"""Generate Minfolio's "M" app icon for macOS (.icns) and Android (mipmaps).

Editorial look: a warm-paper serif "M" on a deep-ink rounded square, echoing the
app's Newsreader headings. Run from the folio/ project root.
"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont

INK = (26, 26, 24, 255)        # deep charcoal background (matches app --bg dark)
PAPER = (245, 242, 234, 255)   # warm paper "M"
FONT = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def draw_M(size, *, bg=True, margin_frac=0.0, radius_frac=0.225, m_frac=0.6):
    """Render an `M` icon at `size`px.

    bg=True paints a rounded-ink square (inset by margin_frac); bg=False leaves a
    transparent canvas (for the Android adaptive foreground). `m_frac` is the M
    cap-height as a fraction of the full canvas.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        m = round(size * margin_frac)
        r = round(size * radius_frac)
        d.rounded_rectangle([m, m, size - 1 - m, size - 1 - m], radius=r, fill=INK)
    # Size the font so the glyph's actual height ≈ m_frac of the canvas.
    target = size * m_frac
    fs = int(target * 1.35)
    font = ImageFont.truetype(FONT, fs)
    l, t, r2, b = font.getbbox("M")
    gw, gh = r2 - l, b - t
    if gh > target:  # nudge down to hit the target cap-height
        fs = int(fs * target / gh)
        font = ImageFont.truetype(FONT, fs)
        l, t, r2, b = font.getbbox("M")
        gw, gh = r2 - l, b - t
    x = (size - gw) / 2 - l
    y = (size - gh) / 2 - t
    d.text((x, y), "M", font=font, fill=PAPER)
    return img


def master(size=1024):
    # macOS app icons leave ~10% transparent padding around the rounded square.
    return draw_M(size, bg=True, margin_frac=0.06, radius_frac=0.2, m_frac=0.52)


def build_mac_icns():
    iconset = os.path.join(ROOT, "build", "icon.iconset")
    os.makedirs(iconset, exist_ok=True)
    base = master(1024)
    specs = [
        (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
    ]
    for px, name in specs:
        base.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
    icns = os.path.join(ROOT, "build", "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
    # electron-builder also accepts build/icon.png as a fallback master.
    base.save(os.path.join(ROOT, "build", "icon.png"))
    print("wrote", icns)


def build_android():
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    # Legacy launcher icons (full-bleed; launcher applies its own mask).
    legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dens, px in legacy.items():
        icon = draw_M(px, bg=True, margin_frac=0.0, radius_frac=0.18, m_frac=0.6)
        d = os.path.join(res, f"mipmap-{dens}")
        icon.save(os.path.join(d, "ic_launcher.png"))
        icon.save(os.path.join(d, "ic_launcher_round.png"))
    # Adaptive foreground (108dp): transparent, M kept inside the 66% safe zone.
    fg = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for dens, px in fg.items():
        f = draw_M(px, bg=False, m_frac=0.42)
        f.save(os.path.join(res, f"mipmap-{dens}", "ic_launcher_foreground.png"))
    # Adaptive background colour → ink.
    bgxml = os.path.join(res, "values", "ic_launcher_background.xml")
    with open(bgxml, "w") as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                 '    <color name="ic_launcher_background">#1A1A18</color>\n</resources>\n')
    print("wrote android mipmaps + adaptive background")


def draw_splash(w, h):
    """Full-bleed ink canvas with a centred cream `M`, sized to ~18% of the
    smaller edge (a modest launch logo, not edge to edge)."""
    img = Image.new("RGBA", (w, h), INK)
    d = ImageDraw.Draw(img)
    target = min(w, h) * 0.18
    fs = int(target * 1.35)
    font = ImageFont.truetype(FONT, fs)
    l, t, r, b = font.getbbox("M")
    gw, gh = r - l, b - t
    if gh > target:
        fs = int(fs * target / gh)
        font = ImageFont.truetype(FONT, fs)
        l, t, r, b = font.getbbox("M")
        gw, gh = r - l, b - t
    d.text(((w - gw) / 2 - l, (h - gh) / 2 - t), "M", font=font, fill=PAPER)
    return img


def build_android_splash():
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    # Regenerate every existing splash.png in place at its current dimensions
    # (Capacitor ships port/land variants per density plus a base drawable).
    count = 0
    for entry in sorted(os.listdir(res)):
        if not entry.startswith("drawable"):
            continue
        p = os.path.join(res, entry, "splash.png")
        if not os.path.exists(p):
            continue
        with Image.open(p) as cur:
            w, hh = cur.size
        draw_splash(w, hh).save(p)
        count += 1
    print(f"rewrote {count} splash.png variants")

    # Android 12+ (API 31) draws its own splash: the launcher icon centred on
    # `windowSplashScreenBackground`. Point that background at our ink colour so
    # the M (launcher icon, already M-on-ink) sits seamlessly on ink.
    v31 = os.path.join(res, "values-v31")
    os.makedirs(v31, exist_ok=True)
    with open(os.path.join(v31, "styles.xml"), "w") as fh:
        fh.write(
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n'
            '        <item name="android:windowSplashScreenBackground">@color/ic_launcher_background</item>\n'
            '        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n'
            '    </style>\n</resources>\n'
        )
    print("wrote values-v31/styles.xml (Android 12 splash background = ink)")


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    build_mac_icns()
    build_android()
    build_android_splash()
