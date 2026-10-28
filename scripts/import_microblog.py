#!/usr/bin/env python3
"""One-off import of the Micro.blog GitHub mirror (feed.json + uploads/) into this Hugo site.

Usage: python3 scripts/import_microblog.py /path/to/stefanlaser.net-micro.blog

- Titled posts  -> content/posts/<year>/<slug>.md
- Untitled posts -> content/notes/<year>/<slug>.md
- The eight portfolio posts -> content/projects/<name>/index.md
- Every post keeps its old URL (url: front matter), projects get a 301 in static/_redirects
- Images -> assets/uploads/<year>/ (so Hugo can resize and dither them), other files -> static/uploads/
"""
import json, re, shutil, sys, html
from pathlib import Path

SRC = Path(sys.argv[1])
SITE = Path(__file__).resolve().parent.parent
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# old path -> (folder name, phase, order weight)
PROJECTS = {
    "/2026/06/23/the-elon-musks-of-the.html": ("predictions", "Predictions", 10),
    "/2022/01/20/current-project.html": ("data-centres", "Data centres and semiconductors", 20),
    "/2026/06/02/happy-to-share-that-my.html": ("semiconductors-taiwan-vietnam", "Data centres and semiconductors", 30),
    "/2023/11/28/thinking-like-a-waste-scholar.html": ("waste-in-motion", "Waste", 40),
    "/2021/11/20/ewaste-dissertation-research.html": ("e-waste", "Waste", 50),
    "/2022/11/20/interspecies-care.html": ("interspecies-care", "More-than-human", 60),
    "/2022/01/20/train-infrastructures.html": ("train-infrastructures", "Mobility", 70),
    "/2022/01/01/network-valuation-studies.html": ("valuation-studies", "Valuation studies", 80),
}
PROJECT_TITLES = {"data-centres": "Data Centres"}


def q(s):
    """YAML double-quoted string."""
    return json.dumps(s, ensure_ascii=False)


def rewrite_body(text):
    # Micro.blog image hosts -> local /uploads/<year>/<file>
    text = re.sub(r"https?://cdn\.uploads\.micro\.blog/\d+/(\d{4}/[^\s\"')]+)", r"/uploads/\1", text)
    text = re.sub(r"https?://stefanlaser\.micro\.blog/uploads/(\d{4}/[^\s\"')]+)", r"/uploads/\1", text)
    # links to own posts -> relative
    text = re.sub(r"https?://(?:stefanlaser\.micro\.blog|stefanlaser\.net)(/\d{4}/\d{2}/\d{2}/[^\s\"')]+)", r"\1", text)

    # standalone <img> tags -> markdown, so the image render hook (resize + dither) applies
    def img(m):
        tag = m.group(0)
        src = re.search(r'src="([^"]+)"', tag)
        if not src:
            return tag
        alt = re.search(r'alt="([^"]*)"', tag)
        alt = html.unescape(alt.group(1)) if alt else ""
        alt = alt.replace("[", "(").replace("]", ")").replace("\n", " ")
        return f"![{alt}]({src.group(1)})"
    text = re.sub(r"<img\b[^>]*>", img, text)
    return text.strip() + "\n"


def split_cover(body):
    """Use the first image of a project post as its cover and remove it from the text."""
    m = re.match(r"\s*!\[([^\]]*)\]\((/uploads/[^)]+)\)\s*", body)
    if not m:
        return body, "", ""
    return body[m.end():], m.group(2), m.group(1)


def summary_of(body):
    head = body.split("<!--more-->")[0]
    head = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", head)
    head = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", head)
    paras = [p.strip() for p in head.split("\n\n") if p.strip() and not p.strip().startswith("#")]
    s = paras[0] if paras else ""
    return re.sub(r"\s+", " ", s)[:300]


MAX_EDGE = 2000


def shrink(src, dest):
    """Store large photos at max 2000px on the long edge. The full originals stay in the archive repo."""
    if src.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        return False
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return False
    with Image.open(src) as im:
        if max(im.size) <= MAX_EDGE and src.stat().st_size < 600_000:
            return False
        im = ImageOps.exif_transpose(im)
        im.thumbnail((MAX_EDGE, MAX_EDGE))
        fmt = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[src.suffix.lower()]
        if fmt == "JPEG" and im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        opts = {"JPEG": {"quality": 82, "optimize": True, "progressive": True},
                "WEBP": {"quality": 82}, "PNG": {"optimize": True}}[fmt]
        im.save(dest, fmt, **opts)
    return True


def strip_lead(body, summary):
    """The summary is shown in the project header, so drop the identical first paragraph."""
    paras = body.split("\n\n")
    for i, para in enumerate(paras):
        plain = re.sub(r"\s+", " ", re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", para)).strip()
        if plain and plain == summary:
            del paras[i]
            break
        if para.strip():
            break
    body = "\n\n".join(paras).lstrip("\n")
    return re.sub(r"^\s*<!--more-->\s*", "", body)


def main():
    items = json.loads((SRC / "feed.json").read_text())["items"]
    counts = {"posts": 0, "notes": 0, "projects": 0}
    redirects = []
    referenced = set()

    for it in items:
        path = re.sub(r"^https?://[^/]+", "", it["url"])
        year, slug = path.split("/")[1], Path(path).stem
        body = rewrite_body(it["content_text"])
        referenced.update(re.findall(r"/uploads/(\d{4}/[^\s\"')]+)", body))
        date = it["date_published"]
        tags = it.get("tags") or []
        title = (it.get("title") or "").strip()

        fm = []
        if path in PROJECTS:
            name, phase, weight = PROJECTS[path]
            body, cover, cover_alt = split_cover(body)
            out = SITE / "content/projects" / name / "index.md"
            summary = summary_of(body)
            body = strip_lead(body, summary)
            fm += [f"title: {q(PROJECT_TITLES.get(name, title))}",
                   f"date: {date}",
                   f"summary: {q(summary)}",
                   'project_website: ""',
                   'project_website_label: ""',
                   f"phase: {q(phase)}",
                   'years: ""',
                   f"weight: {weight}"]
            if cover:
                fm += [f"thumbnail: {q(cover)}", f"thumbnail_alt: {q(cover_alt)}"]
            fm.append(f"old_url: {q(path)}")
            redirects.append(f"{path} /projects/{name}/ 301")
            counts["projects"] += 1
        else:
            kind = "posts" if title else "notes"
            out = SITE / "content" / kind / year / f"{slug}.md"
            if title:
                fm.append(f"title: {q(title)}")
            fm += [f"date: {date}", f"url: {q(path)}"]
            counts[kind] += 1
        if tags:
            fm.append("tags: [" + ", ".join(q(t) for t in tags) + "]")

        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("---\n" + "\n".join(fm) + "\n---\n\n" + body, encoding="utf-8")

    # uploads
    n_img = n_other = 0
    for f in (SRC / "uploads").rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(SRC / "uploads")
        dest_root = SITE / ("assets/uploads" if f.suffix.lower() in IMG_EXT else "static/uploads")
        dest = dest_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not shrink(f, dest):
            shutil.copy2(f, dest)
        if f.suffix.lower() in IMG_EXT:
            n_img += 1
        else:
            n_other += 1

    have = {str(p.relative_to(SRC / "uploads")) for p in (SRC / "uploads").rglob("*") if p.is_file()}
    missing = sorted(r for r in referenced if r not in have)

    redirects += [
        "/feed.xml /index.xml 301",
        "/archive/ /notes/ 301",
        "/archive/index.html /notes/ 301",
    ]
    (SITE / "static").mkdir(exist_ok=True)
    (SITE / "static/_redirects").write_text("\n".join(redirects) + "\n")

    print(counts, f"images={n_img} other_files={n_other}")
    print(f"missing referenced uploads ({len(missing)}):", *missing, sep="\n  ")


if __name__ == "__main__":
    main()
