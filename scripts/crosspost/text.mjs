// Text helpers: turn Markdown into plain text with link ranges, count characters
// the way each platform does, and build Bluesky facets.

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const graphemes = (s) => [...segmenter.segment(s)].length;

/** Cut text to at most `max` graphemes at a word boundary, adding an ellipsis. */
export function truncate(s, max) {
  if (graphemes(s) <= max) return s;
  const parts = [...segmenter.segment(s)].map((x) => x.segment);
  let cut = parts.slice(0, Math.max(0, max - 1)).join("");
  const space = cut.search(/\s\S*$/);
  if (space > cut.length * 0.6) cut = cut.slice(0, space);
  return cut.replace(/[\s,.;:–-]+$/u, "") + "…";
}

/**
 * Markdown -> { text, links: [{ text, url }] }.
 * Links keep their visible text; the URL is remembered so each platform can
 * render it its own way (facet on Bluesky, "text url" on Mastodon).
 */
export function markdownToPlain(md) {
  const links = [];
  let s = md.replace(/\r\n/g, "\n");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/```[\s\S]*?```/g, "");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images are attached separately
  s = s.replace(/<img\b[^>]*>/gi, "");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, text, url) => {
    links.push({ text, url });
    return text;
  });
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^>\s?/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "• ");
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(\*|_)(\S.*?\S|\S)\1/g, "$2");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&hellip;/g, "…").replace(/&rsquo;/g, "’").replace(/&lsquo;/g, "‘").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: s, links };
}

/** Mastodon: put the URL after the link text, unless the text already is the URL. */
export function withInlineUrls(text, links, absolutize) {
  let out = text;
  for (const { text: t, url } of links) {
    const abs = absolutize(url);
    if (t.includes(abs) || abs.includes(t.replace(/…$/, ""))) {
      out = out.replace(t, abs);
      continue;
    }
    out = out.replace(t, `${t} ${abs}`);
  }
  return out;
}

/** Mastodon counts every URL as 23 characters. */
export function mastodonLength(s) {
  return graphemes(s.replace(/https?:\/\/\S+/g, "x".repeat(23)));
}

const enc = new TextEncoder();
const byteIndex = (s, charIndex) => enc.encode(s.slice(0, charIndex)).length;

/** Bluesky facets for link texts, bare URLs and #hashtags (byte offsets, UTF-8). */
export function blueskyFacets(text, links = [], absolutize = (u) => u) {
  const facets = [];
  const taken = [];
  const add = (start, end, feature) => {
    if (taken.some(([a, b]) => start < b && end > a)) return;
    taken.push([start, end]);
    facets.push({ index: { byteStart: byteIndex(text, start), byteEnd: byteIndex(text, end) }, features: [feature] });
  };
  let from = 0;
  for (const { text: t, url } of links) {
    const i = text.indexOf(t, from);
    if (i < 0) continue;
    add(i, i + t.length, { $type: "app.bsky.richtext.facet#link", uri: absolutize(url) });
    from = i + t.length;
  }
  for (const m of text.matchAll(/https?:\/\/[^\s)]+[^\s).,;:!?]/g)) {
    add(m.index, m.index + m[0].length, { $type: "app.bsky.richtext.facet#link", uri: m[0] });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu)) {
    const start = m.index + m[1].length;
    add(start, start + m[2].length + 1, { $type: "app.bsky.richtext.facet#tag", tag: m[2] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

/** LinkedIn "little text" format: these characters must be escaped. */
export const linkedinEscape = (s) => s.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => "\\" + c);
