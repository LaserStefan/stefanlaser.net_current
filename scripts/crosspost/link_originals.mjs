#!/usr/bin/env node
// One-off (repeatable) job: find the Mastodon and Bluesky copies of OLD notes, the ones
// Micro.blog cross-posted before the move, and write their links into `syndication`.
//
// How it matches: it reads your public Mastodon and Bluesky timelines and compares each
// post with the notes written within two days of it. A post counts as the original when it
// links to the note, or when most of its words also appear in the note (Micro.blog shortened
// long notes, so a post may only contain the beginning).
//
// Environment: MASTODON_INSTANCE, MASTODON_USER, BLUESKY_HANDLE (each optional),
//              DRY_RUN=1 to only print the matches.

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { markdownToPlain } from "./text.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
const DRY = env.DRY_RUN === "1" || env.DRY_RUN === "true";
const DAY = 864e5;

// ---------------------------------------------------------------------------
export function tokens(text) {
  return new Set(
    text.toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}#]+/gu, " ")
      .split(" ")
      .filter((w) => w.length > 2),
  );
}

/** Share of the social post's words that also occur in the note (0..1). */
export function containment(noteTokens, postTokens) {
  if (postTokens.size < 4) return 0;
  let hit = 0;
  for (const t of postTokens) if (noteTokens.has(t)) hit++;
  return hit / postTokens.size;
}

/**
 * notes: [{ id, date, text, paths: [url paths of the note] }]
 * posts: [{ url, date, text, links: [urls in the post] }]
 * Returns Map(noteId -> postUrl). Each post is used at most once.
 */
export function matchPosts(notes, posts, threshold = 0.6) {
  const pairs = [];
  for (const n of notes) {
    const nt = tokens(n.text);
    for (const p of posts) {
      const gap = Math.abs(p.date - n.date);
      if (gap > 2 * DAY) continue;
      let score = 0;
      if (p.links.some((l) => n.paths.some((np) => l.includes(np)))) score = 2; // links to the note
      else score = containment(nt, tokens(p.text));
      if (score >= threshold) pairs.push({ n: n.id, p: p.url, score, gap });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.gap - b.gap);
  const out = new Map();
  const used = new Set();
  for (const x of pairs) {
    if (out.has(x.n) || used.has(x.p)) continue;
    out.set(x.n, x.p);
    used.add(x.p);
  }
  return out;
}

// ---------------------------------------------------------------------------
async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

const htmlToText = (h) => h.replace(/<br\s*\/?>/g, "\n").replace(/<\/p>\s*<p>/g, "\n\n").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function mastodonPosts(instance, user, since) {
  const host = "https://" + instance.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const acct = await getJSON(`${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user.replace(/^@/, ""))}`);
  const out = [];
  let max = "";
  for (let page = 0; page < 200; page++) {
    const batch = await getJSON(`${host}/api/v1/accounts/${acct.id}/statuses?limit=40&exclude_reblogs=true${max ? `&max_id=${max}` : ""}`);
    if (!batch.length) break;
    for (const s of batch) {
      const links = [...(s.content.matchAll(/href="([^"]+)"/g))].map((m) => m[1]);
      if (s.card?.url) links.push(s.card.url);
      out.push({ url: s.url, date: new Date(s.created_at).getTime(), text: htmlToText(s.content), links });
    }
    max = batch[batch.length - 1].id;
    if (new Date(batch[batch.length - 1].created_at).getTime() < since) break;
  }
  return out;
}

async function blueskyPosts(handle, since) {
  const out = [];
  let cursor = "";
  for (let page = 0; page < 200; page++) {
    const data = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle.replace(/^@/, ""))}&filter=posts_no_replies&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const item of data.feed || []) {
      if (item.reason) continue; // repost
      const p = item.post;
      const links = [];
      for (const f of p.record.facets || []) for (const feat of f.features || []) if (feat.uri) links.push(feat.uri);
      if (p.embed?.external?.uri) links.push(p.embed.external.uri);
      out.push({
        url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`,
        date: new Date(p.record.createdAt).getTime(),
        text: p.record.text || "",
        links,
      });
    }
    cursor = data.cursor;
    const last = data.feed?.[data.feed.length - 1];
    if (!cursor || !last || new Date(last.post.record.createdAt).getTime() < since) break;
  }
  return out;
}

async function* walk(dir) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".md") && !e.name.startsWith("_")) yield p;
  }
}

async function main() {
  const site = YAML.parse(await fs.readFile(path.join(ROOT, "data/site.yaml"), "utf8")) || {};
  const st = site.stream || {};
  const mInst = env.MASTODON_INSTANCE || st.mastodon_instance;
  const mUser = env.MASTODON_USER || st.mastodon_user;
  const bHandle = env.BLUESKY_HANDLE || st.bluesky_handle;

  const notes = [];
  for (const dir of ["content/notes", "content/posts"]) {
    for await (const file of walk(path.join(ROOT, dir))) {
      const raw = await fs.readFile(file, "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) continue;
      const doc = YAML.parseDocument(m[1]);
      const fm = doc.toJS() || {};
      const date = new Date(fm.date).getTime();
      if (!date) continue;
      const text = [fm.title, markdownToPlain(m[2]).text].filter(Boolean).join("\n");
      const paths = [fm.url, fm.url && fm.url.replace(/\.html$/, "")].filter(Boolean);
      notes.push({ id: file, date, text, paths, doc, body: m[2], syn: fm.syndication || {} });
    }
  }
  const since = Math.min(...notes.map((n) => n.date)) - 7 * DAY;
  console.log(`${notes.length} notes and posts, oldest ${new Date(since + 7 * DAY).toISOString().slice(0, 10)}`);

  const results = {};
  if (mInst && mUser) {
    const posts = await mastodonPosts(mInst, mUser, since);
    console.log(`Mastodon: ${posts.length} posts read`);
    results.mastodon = matchPosts(notes.filter((n) => !n.syn.mastodon), posts);
  }
  if (bHandle) {
    const posts = await blueskyPosts(bHandle, since);
    console.log(`Bluesky: ${posts.length} posts read`);
    results.bluesky = matchPosts(notes.filter((n) => !n.syn.bluesky), posts);
  } else {
    console.log("Bluesky: no handle set (Site settings → Micro stream), skipped.");
  }

  let changed = 0;
  for (const n of notes) {
    const add = {};
    for (const [platform, map] of Object.entries(results)) if (map.has(n.id)) add[platform] = map.get(n.id);
    if (!Object.keys(add).length) continue;
    const rel = path.relative(ROOT, n.id);
    console.log(`${rel}\n  ${Object.entries(add).map(([k, v]) => `${k}: ${v}`).join("\n  ")}`);
    if (DRY) continue;
    for (const [k, v] of Object.entries(add)) n.doc.setIn(["syndication", k], v);
    await fs.writeFile(n.id, `---\n${n.doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${n.body.startsWith("\n") ? "" : "\n"}${n.body}`);
    changed++;
  }
  for (const [k, map] of Object.entries(results)) console.log(`${k}: ${map.size} notes matched`);
  console.log(DRY ? "Dry run, nothing written." : `${changed} files updated.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
