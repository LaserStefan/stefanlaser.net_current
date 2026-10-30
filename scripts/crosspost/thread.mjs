// Split a long text into a numbered thread: "… (1/3)", "… (2/3)", "… (3/3)".
// Images stay with the part of the text they stand in.

import { markdownToPlain, graphemes, truncate } from "./text.mjs";

const IMG = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const MARK = (i) => `⁣IMG${i}⁣`; // invisible separator, never typed by hand
const MARK_RE = /⁣IMG(\d+)⁣/g;

/** Markdown -> { text, links, images: [{src, alt}] } with image markers left in the text. */
export function plainWithImages(md) {
  const images = [];
  const marked = md.replace(IMG, (_, alt, src) => {
    images.push({ src, alt });
    return MARK(images.length - 1);
  });
  const { text, links } = markdownToPlain(marked);
  return { text, links, images };
}

/** Cut text into sentences and paragraph breaks, keeping all characters. */
function units(text) {
  const out = [];
  for (const para of text.split(/(\n\n+)/)) {
    if (/^\n+$/.test(para)) { out.push(para); continue; }
    // a sentence ends with . ! ? … followed by a space; keeps the space with the sentence
    const parts = para.match(/[^.!?…]+(?:[.!?…]+(?:["”’)\]]*)\s+|[.!?…]*["”’)\]]*$)|[.!?…]+\s*/g) || [para];
    out.push(...parts.filter((p) => p.length));
  }
  return out;
}

/** Split one unit that is too long at word boundaries. */
function splitLong(unit, max, measure) {
  const words = unit.split(/(\s+)/);
  const out = [];
  let cur = "";
  for (const w of words) {
    if (measure(cur + w) > max && cur.trim()) { out.push(cur); cur = w.trimStart(); }
    else cur += w;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Build the parts of a thread.
 *   text      plain text, may contain image markers
 *   limit     characters per post (Bluesky 300, Mastodon 500)
 *   measure   counts characters the way the platform does
 *   reserve   characters to keep free in the post that gets the link
 *   linkAt    "start" | "end" | "none"
 * Returns [{ text, images: [index], withLink }]. One part means: no numbering.
 */
export function splitThread(text, { limit, measure = graphemes, reserve = 0, linkAt = "end" }) {
  const clean = (s) => s.replace(MARK_RE, "");
  const imagesIn = (s) => [...s.matchAll(MARK_RE)].map((m) => Number(m[1]));
  const visible = (s) => measure(clean(s).replace(/\n{3,}/g, "\n\n").trim());

  // fits into one post as it is: no thread, no link needed (like Micro.blog)
  if (visible(text) <= limit && linkAt !== "start") {
    return [{ text: clean(text).trim(), images: imagesIn(text), withLink: false }];
  }

  const NUM = 8; // room for " (12/34)"
  const room = (i, isLast) => limit - NUM - ((linkAt === "start" && i === 0) || (linkAt === "end" && isLast) ? reserve : 0);

  // greedy packing; done twice so the last part knows it is the last
  const pack = (lastRoom) => {
    const parts = [];
    let cur = "";
    const max = () => room(parts.length, false);
    for (let u of units(text)) {
      // prefer to end a part at a paragraph break once it is reasonably full
      if (/^\n+$/.test(u) && visible(cur) >= 0.6 * max()) { parts.push(cur); cur = ""; continue; }
      if (visible(u) > max()) {
        for (const piece of splitLong(u, max(), (s) => visible(s))) {
          if (cur.trim()) { parts.push(cur); cur = ""; }
          parts.push(piece);
        }
        continue;
      }
      if (visible(cur + u) > max() && cur.trim()) { parts.push(cur); cur = u.replace(/^\n+/, ""); }
      else cur += u;
    }
    if (cur.trim() || imagesIn(cur).length) parts.push(cur);
    // the last part may need room for the link
    if (parts.length && visible(parts[parts.length - 1]) > lastRoom) {
      const last = parts.pop();
      const pieces = splitLong(last, lastRoom, (s) => visible(s));
      parts.push(...pieces);
    }
    return parts;
  };
  let parts = pack(room(0, true));
  // a part that only holds an image marker joins the part before
  const merged = [];
  for (const p of parts) {
    if (!clean(p).trim() && merged.length) merged[merged.length - 1] += p;
    else merged.push(p);
  }
  parts = merged;

  const n = parts.length;
  return parts.map((p, i) => {
    const body = clean(p).replace(/\n{3,}/g, "\n\n").trim();
    return {
      text: n > 1 ? `${body} (${i + 1}/${n})` : body,
      images: imagesIn(p),
      withLink: linkAt !== "none" && ((linkAt === "start" && i === 0) || (linkAt === "end" && i === n - 1)),
    };
  });
}

/** Single post, cut off: the old behaviour when automatic threads are switched off. */
export function singlePost(text, { limit, measure = graphemes, reserve = 0, linkAt = "end" }) {
  const clean = text.replace(MARK_RE, "").trim();
  const images = [...text.matchAll(MARK_RE)].map((m) => Number(m[1]));
  if (measure(clean) <= limit && linkAt !== "start") return [{ text: clean, images, withLink: false }];
  return [{ text: truncate(clean, limit - (linkAt === "none" ? 0 : reserve)), images, withLink: linkAt !== "none" }];
}
