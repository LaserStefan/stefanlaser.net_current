import test from "node:test";
import assert from "node:assert/strict";
import { markdownToPlain, truncate, graphemes, blueskyFacets, mastodonLength, withInlineUrls, linkedinEscape } from "./text.mjs";

test("markdown links become text plus remembered URL", () => {
  const r = markdownToPlain("Read [our book](https://example.org/book) now. ![pic](/uploads/x.jpg)");
  assert.equal(r.text, "Read our book now.");
  assert.deepEqual(r.links, [{ text: "our book", url: "https://example.org/book" }]);
});

test("truncate respects the grapheme limit and adds an ellipsis", () => {
  const s = "word ".repeat(100);
  const t = truncate(s, 50);
  assert.ok(graphemes(t) <= 50);
  assert.ok(t.endsWith("…"));
});

test("bluesky facets use UTF-8 byte offsets", () => {
  const text = "Fürsorge: see our book #AI";
  const f = blueskyFacets(text, [{ text: "our book", url: "https://x.org" }]);
  const enc = new TextEncoder();
  const link = f.find((x) => x.features[0].uri);
  assert.equal(new TextDecoder().decode(enc.encode(text).slice(link.index.byteStart, link.index.byteEnd)), "our book");
  const tag = f.find((x) => x.features[0].tag);
  assert.equal(tag.features[0].tag, "AI");
});

test("mastodon counts URLs as 23 characters", () => {
  assert.equal(mastodonLength("a https://example.org/a/very/long/path/that/goes/on"), 25);
});

test("inline URLs for Mastodon", () => {
  assert.equal(withInlineUrls("see our book", [{ text: "our book", url: "/2024/01/01/x.html" }], (u) => "https://s.net" + u), "see our book https://s.net/2024/01/01/x.html");
});

test("linkedin escaping", () => {
  assert.equal(linkedinEscape("a (b) #c"), "a \\(b\\) \\#c");
});

import { matchPosts, containment, tokens } from "./link_originals.mjs";

test("old notes are matched to their Mastodon copies by text and date", () => {
  const day = 864e5, t0 = Date.UTC(2024, 5, 1);
  const notes = [
    { id: "a", date: t0, text: "Night markets, unfortunately, are full of meaty things. But they look fabulous. #Taiwan", paths: ["/2024/06/01/night.html"] },
    { id: "b", date: t0 + day, text: "It's #linux time. Since Windows and Mac OS are moving in a questionable direction I tried popos.", paths: ["/2024/06/02/linux.html"] },
    { id: "c", date: t0 + 9 * day, text: "Night markets again, full of meaty things, fabulous.", paths: [] },
  ];
  const posts = [
    { url: "m1", date: t0 + 3600e3, text: "Night markets, unfortunately, are full of meaty things. But they look fabulous. #Taiwan", links: [] },
    { url: "m2", date: t0 + day, text: "It's #linux time. Since Windows and Mac OS are moving in a questionable … https://stefanlaser.net/2024/06/02/linux.html", links: ["https://stefanlaser.net/2024/06/02/linux.html"] },
    { url: "m3", date: t0 + 5 * day, text: "Something else entirely about waste and recycling", links: [] },
  ];
  const m = matchPosts(notes, posts);
  assert.equal(m.get("a"), "m1");
  assert.equal(m.get("b"), "m2");
  assert.equal(m.has("c"), false); // too far away in time
});

test("short posts never match by words alone", () => {
  assert.equal(containment(tokens("a long note about many things"), tokens("nice")), 0);
});
