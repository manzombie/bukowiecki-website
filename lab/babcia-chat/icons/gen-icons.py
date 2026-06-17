#!/usr/bin/env python3
"""gen-icons.py — generate Babcia Chat app icons from the transparent source logo.

Run AFTER placing the logo at icons/source/babcia_Chat_logo.png:
    python3 gen-icons.py          (needs Pillow:  pip install pillow)

Outputs into this icons/ folder:
  apple-touch-icon.png   180  — FLATTENED on brand teal (iOS fills transparency
                                with black otherwise; iOS also rounds corners)
  icon-192.png           192  — manifest (on teal)
  icon-512.png           512  — manifest (on teal)
  icon-512-maskable.png  512  — extra safe padding so Android's mask won't crop
  favicon-32.png          32
All are opaque (no transparency) on the brand teal so they look right everywhere.
"""
import os
from PIL import Image

TEAL = (31, 125, 140)          # brand teal == manifest theme/background
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source", "babcia_Chat_logo.png")

def icon(size, pad, out, bg=TEAL):
    logo = Image.open(SRC).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), bg + (255,))
    inner = int(size * (1 - 2 * pad))
    w, h = logo.size
    scale = min(inner / w, inner / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    logo = logo.resize((nw, nh), Image.LANCZOS)
    canvas.paste(logo, ((size - nw) // 2, (size - nh) // 2), logo)  # alpha as mask
    canvas.convert("RGB").save(os.path.join(HERE, out))             # RGB = opaque
    print("wrote", out, f"{size}px")

if __name__ == "__main__":
    if not os.path.exists(SRC):
        raise SystemExit(f"Missing source logo: {SRC}\nPlace babcia_Chat_logo.png there first.")
    icon(180, 0.12, "apple-touch-icon.png")
    icon(192, 0.12, "icon-192.png")
    icon(512, 0.12, "icon-512.png")
    icon(512, 0.22, "icon-512-maskable.png")   # bigger safe area for maskable
    icon(32, 0.08, "favicon-32.png")
    print("done — icons generated on brand teal.")
