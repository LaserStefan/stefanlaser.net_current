#!/usr/bin/env python3
"""Store Hugo's dithered images as small GIFs with an exact palette.

Hugo writes the dithered images as full-colour PNGs. They only contain two to a few
colours, so the same pixels fit into a GIF with a tiny colour table at a fraction of
the size. This script
converts them and rewrites the references in the generated pages.

    python3 scripts/shrink_dithered.py public
"""
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
public = Path(sys.argv[1] if len(sys.argv) > 1 else "public")

MAX_COLOURS = 16  # dithered images use 2 (rotating mode) to ~8 colours; photos have thousands
renamed = {}
before = after = 0
for f in public.rglob("*_hu_*.png"):
    with Image.open(f) as im:
        img = im.convert("RGB")
    colours = img.getcolors(MAX_COLOURS)
    if not colours:
        continue  # a normal photo, not a dithered image
    target = f.with_suffix(".gif")
    pal = Image.new("P", (1, 1))
    used = [c for _, c in colours]
    flat = []
    for i in range(256):
        flat.extend(used[i] if i < len(used) else used[0])
    pal.putpalette(flat)
    img.quantize(palette=pal, dither=Image.Dither.NONE).save(target, "GIF", optimize=True)
    before += f.stat().st_size
    after += target.stat().st_size
    f.unlink()
    renamed[f.name] = target.name

if renamed:
    pattern = re.compile("|".join(re.escape(k) for k in renamed))
    for page in public.rglob("*"):
        if page.suffix not in {".html", ".xml", ".json"} or not page.is_file():
            continue
        text = page.read_text(encoding="utf-8")
        new = pattern.sub(lambda m: renamed[m.group(0)], text)
        if new != text:
            page.write_text(new, encoding="utf-8")
    print(f"dithered images: {len(renamed)}, {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB")
