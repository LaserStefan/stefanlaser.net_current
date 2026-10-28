#!/usr/bin/env python3
"""Re-save Hugo's dithered images as true 1-bit GIFs.

Hugo writes dithered images as 8-bit GIFs (~170 KB each). The same pixels stored
with a 1-bit palette are about a quarter of that (~40 KB). Run after `hugo`:

    python3 scripts/shrink_dithered.py public
"""
import sys
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
before = after = count = 0
for f in root.rglob("*_hu_*.gif"):
    with Image.open(f) as im:
        if getattr(im, "is_animated", False):
            continue
        # Go's GIF encoder spreads the two dither colours over a few near-black and
        # near-white shades; only touch images that contain nothing in between.
        gray = im.convert("L")
        colors = gray.getcolors(256) or []
        if not colors or any(90 < value < 170 for _, value in colors):
            continue
        one_bit = gray.point(lambda v: 255 if v >= 128 else 0, "1")
    size = f.stat().st_size
    one_bit.save(f, "GIF", optimize=True)
    before += size
    after += f.stat().st_size
    count += 1

if count:
    print(f"dithered images: {count}, {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB")
