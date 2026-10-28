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
