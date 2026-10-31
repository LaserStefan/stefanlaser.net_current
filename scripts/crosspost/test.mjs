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

import { splitThread, plainWithImages } from "./thread.mjs";

test("short text stays one post without numbering", () => {
  const parts = splitThread("Just a short note. #waste", { limit: 300 });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, "Just a short note. #waste");
  assert.equal(parts[0].withLink, false);
});

test("long text becomes a numbered thread within the limit, link in the last part", () => {
  const sentence = "This sentence is about infrastructures and their many quiet failures in everyday life. ";
  const text = sentence.repeat(12).trim();
  const parts = splitThread(text, { limit: 300, reserve: 40 });
  assert.ok(parts.length >= 4);
  parts.forEach((p, i) => {
    assert.ok(p.text.endsWith(`(${i + 1}/${parts.length})`), p.text);
    assert.ok([...p.text].length <= 300 - (p.withLink ? 40 : 0), `${[...p.text].length}`);
  });
  assert.equal(parts.at(-1).withLink, true);
  assert.equal(parts.filter((p) => p.withLink).length, 1);
  // nothing lost
  const joined = parts.map((p) => p.text.replace(/ \(\d+\/\d+\)$/, "")).join(" ");
  assert.equal(joined.replace(/\s+/g, " "), text.replace(/\s+/g, " "));
});

test("images go with the part they stand in", () => {
  const long = "Words about the first place and what happened there on that very long day. ".repeat(5);
  const md = `${long}\n\n![first](/uploads/a.jpg)\n\n${long}\n\n![second](/uploads/b.jpg)`;
  const { text, images } = plainWithImages(md);
  assert.equal(images.length, 2);
  const parts = splitThread(text, { limit: 300 });
  const withA = parts.findIndex((p) => p.images.includes(0));
  const withB = parts.findIndex((p) => p.images.includes(1));
  assert.ok(withA >= 0 && withB > withA, JSON.stringify(parts.map((p) => p.images)));
  assert.ok(parts.every((p) => !p.text.includes("⁣")));
});

test("one very long sentence is cut at word boundaries", () => {
  const text = "word ".repeat(200).trim();
  const parts = splitThread(text, { limit: 300 });
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => [...p.text].length <= 300));
});

import { parseDate } from "./crosspost.mjs";

test("dates without a time zone are Berlin time", () => {
  assert.equal(parseDate("2026-10-30T23:10:00").toISOString(), "2026-10-30T22:10:00.000Z"); // winter, +1
  assert.equal(parseDate("2026-07-01T12:00:00").toISOString(), "2026-07-01T10:00:00.000Z"); // summer, +2
  assert.equal(parseDate("2026-10-30T23:10:00+01:00").toISOString(), "2026-10-30T22:10:00.000Z");
  assert.equal(parseDate("2026-10-30T22:10:00Z").toISOString(), "2026-10-30T22:10:00.000Z");
});

test("quotes get quotation marks for social media", () => {
  assert.equal(markdownToPlain("Graeber wrote:\n\n> Bullshit jobs\n> are real.\n\nIndeed.").text, "Graeber wrote:\n\n“Bullshit jobs\nare real.”\n\nIndeed.");
  assert.equal(markdownToPlain("> “Already quoted”").text, "“Already quoted”");
});
