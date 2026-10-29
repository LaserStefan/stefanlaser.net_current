#!/usr/bin/env python3
"""Build the publication list from the CV, plus ORCID.

    python3 scripts/sync_publications.py            # CV + ORCID (needs internet)
    python3 scripts/sync_publications.py --offline  # CV only

Source of truth is the "List of Publications" in content/cv.md. Every list item there
becomes one file in content/publications/items/, with the citation exactly as written in
the CV. ORCID adds DOIs where the CV has none, and adds works the CV doesn't list.

Generated files carry `source: cv` or `source: orcid` and are rewritten on every run.
Files without one of these sources (added by hand in the CMS) are never touched.
File names are stable, so projects can keep pointing at them.
"""
import hashlib
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CV = ROOT / "content/cv.md"
OUT = ROOT / "content/publications/items"
SITE = yaml.safe_load((ROOT / "data/site.yaml").read_text()) or {}
ORCID = ((SITE.get("publications") or {}).get("orcid") or "").strip()

TYPES = {  # CV heading -> short label shown on the site
    "monographs": "Monograph",
    "special issues": "Special issue",
    "edited volumes": "Edited volume",
    "article with double-blind peer-review": "Journal article",
    "article without double-blind peer review and book chapters": "Article / chapter",
    "reviews": "Review",
    "interviews": "Interview",
    "reports and working paper": "Report / working paper",
}
ORCID_TYPES = {
    "journal-article": "Journal article", "book": "Monograph", "edited-book": "Edited volume",
    "book-chapter": "Article / chapter", "report": "Report / working paper",
    "working-paper": "Report / working paper", "book-review": "Review", "review": "Review",
    "conference-paper": "Conference paper", "preprint": "Report / working paper",
}


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return re.sub(r"[^a-z0-9]+", "", s.encode("ascii", "ignore").decode())


def slugify(s, n=60):
    s = unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:n].rstrip("-")


def unescape(s):
    return re.sub(r"\\([\\`*_{}\[\]()#+\-.!>|~])", r"\1", s)


# ---------------------------------------------------------------------------
def parse_cv():
    text = unescape(CV.read_text(encoding="utf-8"))
    text = text.split("\n---\n", 1)[-1]
    m = re.search(r"^#{2,3} List of Publications.*$", text, re.M)
    if not m:
        print("CV: no 'List of Publications' heading found")
        return []
    section = text[m.end():]
    end = re.search(r"^## (?!#)(?!Interviews)", section, re.M)
    if end:
        section = section[:end.start()]
    entries, kind, order = [], None, 0
    for line in section.splitlines():
        h = re.match(r"^#{2,4}\s+(.+?)\s*$", line.strip())
        if h:
            kind = TYPES.get(h.group(1).lower(), h.group(1))
            continue
        item = re.match(r"^\s*-\s+(.+)$", line)
        if item and kind:
            entries.append(cv_entry(item.group(1).strip(), kind, order))
            order += 1
        elif entries and line.strip() and not line.startswith(("#", "-")):
            entries[-1]["citation"] += " " + line.strip()  # citation wrapped onto a second line
    for e in entries:
        finish(e)
    return entries


def cv_entry(line, kind, order):
    return {"citation": line, "pub_type": kind, "sort": order, "source": "cv"}


def finish(e):
    c = e["citation"]
    year = re.search(r"\((?:[^()]*?)((?:19|20)\d\d)\)", c) or re.search(r"\b((?:19|20)\d\d)\b", c)
    e["year"] = year.group(1) if year else ""
    status = re.search(r"\((accepted|in review|forthcoming|im erscheinen)[^)]*\)", c, re.I)
    e["status"] = status.group(1).lower() if status else ""
    # title: the text after "(year): " up to the first full stop that ends a sentence
    t = re.search(r"\)\s*[:.]\s*(.+?)(?:\.\s+(?=[A-ZÄÖÜ„\[“'‚])|\.$|\.\s*\[|$)", c)
    title = (t.group(1) if t else c).strip()
    title = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", title)
    e["title"] = title.strip(" .")
    links = re.findall(r"\]\((https?://[^)\s]+)\)", c) + re.findall(r"(?<![(\[])(https?://[^\s)\]]+)", c)
    e["link"] = links[-1].rstrip(".,") if links else ""
    doi = re.search(r"(?:doi\.org/|doi:\s*)(10\.\d{4,9}/[^\s)\]]+)", c, re.I)
    e["doi"] = doi.group(1).rstrip(".,") if doi else ""


# ---------------------------------------------------------------------------
def fetch_orcid():
    if not ORCID:
        return []
    base = f"https://pub.orcid.org/v3.0/{ORCID}"
    get = lambda url: json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=30))
    works = []
    for g in get(base + "/works").get("group", []):
        w = (g.get("work-summary") or [{}])[0]
        title = (((w.get("title") or {}).get("title") or {}).get("value") or "").strip()
        if not title:
            continue
        year = (((w.get("publication-date") or {}).get("year") or {}).get("value")) or ""
        venue = ((w.get("journal-title") or {}).get("value")) or ""
        doi = url = ""
        for x in ((w.get("external-ids") or {}).get("external-id") or []):
            if x.get("external-id-type") == "doi" and not doi:
                doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:)", "", x.get("external-id-value", ""), flags=re.I)
            if not url and x.get("external-id-url"):
                url = x["external-id-url"].get("value", "")
        url = f"https://doi.org/{doi}" if doi else (((w.get("url") or {}).get("value")) or url)
        works.append({"title": title, "year": str(year), "venue": venue, "doi": doi, "link": url,
                      "pub_type": ORCID_TYPES.get(w.get("type", ""), (w.get("type") or "").replace("-", " ").capitalize()),
                      "put_code": w.get("put-code"), "source": "orcid"})
    return works


STOP = {"the", "and", "and", "for", "with", "from", "into", "der", "die", "das", "des", "und", "ein", "eine",
        "von", "zur", "zum", "special", "issue", "vol", "volume", "introduction"}


def words(s):
    s = unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()
    s = re.sub(r"(i)s(e|ed|ing|ation)\b", r"\1z\2", s)  # globalised -> globalized
    return [w for w in re.findall(r"[a-z0-9]+", s) if len(w) > 2 and w not in STOP]


def score(work, entry):
    """How well an ORCID work matches a CV citation (0..1)."""
    if work["doi"] and work["doi"].lower() in entry["citation"].lower():
        return 1.0
    if work["year"] and entry["year"] and work["year"] != entry["year"]:
        return 0.0
    w = words(work["title"])
    if not w:
        return 0.0
    c = set(words(entry["citation"]))
    share = sum(1 for x in w if x in c) / len(w)
    main = words(re.split(r"[:.?!]", work["title"])[0])  # the part before the subtitle
    if main and len("".join(main)) >= 8 and all(x in c for x in main):
        share = max(share, 0.75)
    return share


def merge(cv, orcid):
    """Attach ORCID DOIs to CV entries; return the ORCID works the CV doesn't have."""
    extra = []
    for w in orcid:
        best, hit = 0.0, None
        for e in cv:
            sc = score(w, e)
            if sc > best:
                best, hit = sc, e
        if hit and best >= 0.6:
            if w["doi"] and not hit["doi"]:
                hit["doi"] = w["doi"]
                if not hit["link"]:
                    hit["link"] = w["link"]
            hit["orcid"] = w["put_code"]
        else:
            extra.append(w)
    return extra


# ---------------------------------------------------------------------------
def file_name(e):
    base = f"{e['year'] or 'nd'}-{slugify(e['title']) or 'untitled'}"
    if e["source"] == "orcid":
        base = f"orcid-{e['put_code']}"
    return base


def main(offline=False):
    OUT.mkdir(parents=True, exist_ok=True)
    cv = parse_cv()
    extra = []
    if not offline:
        try:
            orcid = fetch_orcid()
            extra = merge(cv, orcid)
            print(f"ORCID: {len(orcid)} works, {len(orcid) - len(extra)} matched to the CV, {len(extra)} only in ORCID")
        except Exception as ex:  # keep the last known ORCID files if ORCID is down
            print(f"ORCID not reachable ({ex}); keeping the existing ORCID entries")
            offline = True
    print(f"CV: {len(cv)} publications")

    wanted = {}
    seen = set()
    for i, e in enumerate(cv + extra):
        name = file_name(e)
        while name in seen:  # same year and title twice in the CV
            name += "-" + hashlib.sha1(e.get("citation", e["title"]).encode()).hexdigest()[:4]
        seen.add(name)
        fm = {k: e.get(k, "") for k in ("title", "year", "pub_type", "link", "doi", "source")}
        if e["source"] == "cv":
            fm["citation"] = e["citation"]
            fm["status"] = e["status"]
            fm["sort"] = e["sort"]
        else:
            fm["venue"] = e["venue"]
            fm["sort"] = 1000 + i
        wanted[name] = fm

    changed = 0
    for f in OUT.glob("*.md"):
        meta = yaml.safe_load(f.read_text().split("---", 2)[1]) or {}
        src = meta.get("source")
        if src == "cv" and f.stem not in wanted:
            f.unlink(); changed += 1
        if src == "orcid" and f.stem not in wanted and not offline:
            f.unlink(); changed += 1
    for name, fm in wanted.items():
        text = "---\n" + yaml.safe_dump(fm, allow_unicode=True, sort_keys=False, width=10_000) + "---\n"
        p = OUT / f"{name}.md"
        if not p.exists() or p.read_text() != text:
            p.write_text(text, encoding="utf-8")
            changed += 1
    print(f"{changed} publication files written or removed")


if __name__ == "__main__":
    main(offline="--offline" in sys.argv)
