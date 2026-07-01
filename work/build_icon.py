#!/usr/bin/env python3
"""Build the Clawd Station app icon: pixel wizard Clawd on a denim rounded tile."""
import os
import subprocess
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MASCOT = os.path.join(ROOT, "src", "assets", "clawd-wizard.png")
BUILD = os.path.join(ROOT, "build")
ICONSET = os.path.join(BUILD, "icon.iconset")
SIZE = 1024

# Denim palette (matches the reference poster).
TOP = (74, 105, 142)     # #4A698E
BOTTOM = (46, 74, 107)    # #2E4A6B
RADIUS = int(SIZE * 0.225)

os.makedirs(ICONSET, exist_ok=True)

# 1) Vertical denim gradient.
base = Image.new("RGB", (SIZE, SIZE), TOP)
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(TOP[0] + (BOTTOM[0] - TOP[0]) * t)
    g = int(TOP[1] + (BOTTOM[1] - TOP[1]) * t)
    b = int(TOP[2] + (BOTTOM[2] - TOP[2]) * t)
    for x in range(0, SIZE, SIZE):  # noop guard
        pass
    base.paste((r, g, b), (0, y, SIZE, y + 1))
base = base.convert("RGBA")

# 2) Rounded-square mask.
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)

tile = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
tile.paste(base, (0, 0), mask)

# 3) Subtle inner top highlight for depth.
hi = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(hi).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS,
                                     outline=(255, 255, 255, 26), width=6)
tile = Image.alpha_composite(tile, hi)

# 4) Composite the mascot, scaled to fit a centered box with padding.
mascot = Image.open(MASCOT).convert("RGBA")
box_w, box_h = int(SIZE * 0.70), int(SIZE * 0.66)
scale = min(box_w / mascot.width, box_h / mascot.height)
mw, mh = int(mascot.width * scale), int(mascot.height * scale)
mascot = mascot.resize((mw, mh), Image.LANCZOS)
px = (SIZE - mw) // 2
py = (SIZE - mh) // 2 + int(SIZE * 0.02)  # nudge down slightly for optical center
tile.alpha_composite(mascot, (px, py))

master = os.path.join(BUILD, "icon_1024.png")
tile.save(master)

# 5) Emit all iconset sizes.
specs = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2),
         (256, 1), (256, 2), (512, 1), (512, 2)]
for pt, scale_f in specs:
    px_size = pt * scale_f
    img = tile.resize((px_size, px_size), Image.LANCZOS)
    suffix = "" if scale_f == 1 else "@2x"
    img.save(os.path.join(ICONSET, f"icon_{pt}x{pt}{suffix}.png"))

# 6) Build .icns.
icns = os.path.join(BUILD, "icon.icns")
subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", icns], check=True)
print("wrote", icns)
