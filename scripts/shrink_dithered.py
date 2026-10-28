#!/usr/bin/env python3
"""Store Hugo's dithered images as small GIFs with an exact palette.

Hugo writes the dithered images as full-colour PNGs (about 1 MB each). Every pixel
already uses one of the few palette colours from data/site.yaml, so the same image
fits into a GIF with a 4-colour or 8-colour table at a tenth of the size. This script
converts them and rewrites the references in the generated pages.

    python3 scripts/shrink_dithered.py public
"""
import re
import sys
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
public = Path(sys.argv[1] if len(sys.argv) > 1 else "public")

design = (yaml.safe_load((ROOT / "data/site.yaml").read_text()) or {}).get("design", {})
palette = design.get("dither_palette") or ["#1f2421", "#3f6b55", "#8fc4a3", "#f6f1e3", "#f2b134", "#e5625e"]
rgb = [tuple(int(h.strip().lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) for h in palette]

pal_img = Image.new("P", (1, 1))
flat = []
for i in range(256):
    flat.extend(rgb[i] if i < len(rgb) else rgb[0])
pal_img.putpalette(flat)

renamed = {}
before = after = 0
for f in public.rglob("*_hu_*.png"):
    with Image.open(f) as im:
        mode = im.mode
        img = im.convert("RGB")
    if mode == "L":
        # Black-and-white sources come out of the filter as greys (one per palette
        # colour, by brightness). Give each grey its palette colour back.
        greys = [c[0] for _, c in (img.getcolors(len(rgb) + 1) or [])]
        if not greys or len(greys) > len(rgb):
            continue
        luma = {c: round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) for c in rgb}
        lut = {g: min(rgb, key=lambda c: abs(luma[c] - g)) for g in greys}
        img = Image.merge("RGB", [img.getchannel(i).point([lut.get(v, (v, v, v))[i] for v in range(256)]) for i in range(3)])
    colours = img.getcolors(len(rgb) + 1)
    if not colours or any(c not in set(rgb) for _, c in colours):
        continue  # not a dithered image
    target = f.with_suffix(".gif")
    img.quantize(palette=pal_img, dither=Image.Dither.NONE).save(target, "GIF", optimize=True)
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
