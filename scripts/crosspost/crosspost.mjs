#!/usr/bin/env node
// Cross-post new posts and notes to Bluesky, Mastodon and LinkedIn.
//
// Runs in GitHub Actions after the site is built and deployed. For every post that
//   - has a `crosspost` block (the CMS adds one to every new post),
//   - is not a draft, is dated in the past but within MAX_AGE_DAYS,
//   - and has no link for that platform under `syndication` yet,
// it waits until the page is live, posts it, and writes the link back into the
// post's front matter (the workflow then commits that change).
//
// Environment (GitHub secrets / variables):
//   SITE_URL               https://stefanlaser.net
//   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, BLUESKY_SERVICE (optional, default https://bsky.social)
//   MASTODON_INSTANCE (e.g. social.tchncs.de), MASTODON_TOKEN
//   LINKEDIN_TOKEN, LINKEDIN_AUTHOR_URN (optional), LINKEDIN_VERSION (optional, YYYYMM)
//   MAX_AGE_DAYS (default 3), DRY_RUN=1 to only print what would be sent,
//   ONLY_FILE=content/notes/... to limit to one file (for testing)

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import {
  markdownToPlain, truncate, graphemes, withInlineUrls, mastodonLength,
  blueskyFacets, linkedinEscape,
} from "./text.mjs";
import { plainWithImages, splitThread, singlePost } from "./thread.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
// trim stray spaces/line breaks from pasted secrets
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
const SITE_URL = (env.SITE_URL || "https://stefanlaser.net").replace(/\/$/, "");
const DRY = env.DRY_RUN === "1" || env.DRY_RUN === "true";
const MAX_AGE_DAYS = Number(env.MAX_AGE_DAYS || 3);
const TZ = "Europe/Berlin";
const SECTIONS = ["content/notes", "content/posts"];
// Nothing dated before this moment is ever sent: everything older was already posted by
// Micro.blog or by hand, and the old blog posts were moved between folders on this day.
const CROSSPOST_SINCE = new Date("2026-10-30T10:00:00+01:00");

const log = (...a) => console.log(...a);
const warn = (...a) => console.log("::warning::" + a.join(" "));

// ---------------------------------------------------------------------------
// Reading posts
// ---------------------------------------------------------------------------
async function* walk(dir) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".md") && !e.name.startsWith("_")) yield p;
  }
}

function splitFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { doc: YAML.parseDocument(m[1]), body: m[2] };
}

function berlinParts(date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, mo, d] = f.format(date).split("-");
  return { y, mo, d };
}

function permalink(file, fm, date) {
  if (fm.url) return fm.url;
  const { y, mo, d } = berlinParts(date);
  return `/${y}/${mo}/${d}/${path.basename(file, ".md")}.html`;
}

const absolutize = (u) => (/^https?:\/\//.test(u) ? u : SITE_URL + (u.startsWith("/") ? u : "/" + u));

async function loadCandidates() {
  const now = Date.now();
  const out = [];
  const files = [];
  if (env.ONLY_FILE) files.push(path.resolve(ROOT, env.ONLY_FILE));
  else for (const s of SECTIONS) for await (const f of walk(path.join(ROOT, s))) files.push(f);

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = splitFrontMatter(raw);
    if (!parsed) continue;
    const fm = parsed.doc.toJS() || {};
    const cp = fm.crosspost;
    if (!cp || fm.draft || fm.no_crosspost) continue;
    const date = new Date(fm.date);
    if (Number.isNaN(date.getTime())) continue;
    if (date.getTime() > now) continue; // scheduled for later
    if (date < CROSSPOST_SINCE) continue; // never touch old posts, not even with ONLY_FILE
    if (!env.ONLY_FILE && now - date.getTime() > MAX_AGE_DAYS * 864e5) continue; // never touch old posts
    const want = ["bluesky", "mastodon", "linkedin"].filter((p) => cp[p] && !(fm.syndication || {})[p]);
    if (!want.length) continue;
    out.push({ file, raw, parsed, fm, cp, date, want, url: absolutize(permalink(file, fm, date)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building the text for each platform
// ---------------------------------------------------------------------------
function excerpt(body, max = 400) {
  const head = body.split("<!--more-->")[0];
  return truncate(markdownToPlain(head).text.replace(/\n+/g, " "), max);
}

/**
 * Posts for one platform: [{ text, links, withLink, images: [{src, alt}] }].
 * Order: own thread > short text > the text itself (as a numbered thread if it is long).
 */
function compose(post, { limit, platform }) {
  const { fm, cp } = post;
  const linkAt = cp.link_position || "end";
  const reserve = platform === "mastodon" ? 25 : graphemes(post.url) + 2;
  const measureFor = (links) => (s) => platform === "mastodon"
    ? mastodonLength(withInlineUrls(s, links, absolutize))
    : graphemes(s);
  const linksIn = (links, s) => links.filter((l) => s.includes(l.text));

  // 1. own thread: each entry with its own images
  const own = (Array.isArray(cp.thread) ? cp.thread : [])
    .map((t) => (typeof t === "string" ? { text: t } : t || {}))
    .filter((t) => (t.text && t.text.trim()) || (t.images && t.images.length));
  const ownOn = own.length && (platform === "bluesky" || cp.thread_mastodon !== false);
  if (ownOn) {
    const idx = linkAt === "start" ? 0 : own.length - 1;
    return own.map((t, i) => {
      const p = markdownToPlain(t.text || "");
      const withLink = linkAt !== "none" && i === idx;
      return {
        text: truncate(p.text, limit - (withLink ? reserve : 0)),
        links: p.links, withLink,
        images: (t.images || []).filter((x) => x && x.image).map((x) => ({ src: x.image, alt: x.alt || "" })),
      };
    });
  }

  // 2. short text: one post with link
  if (cp.text && cp.text.trim()) {
    const p = markdownToPlain(cp.text);
    const withLink = linkAt !== "none";
    const imgs = cp.image ? [{ src: cp.image, alt: cp.image_alt || "" }] : plainWithImages(post.parsed.body).images;
    return [{ text: truncate(p.text, limit - (withLink ? reserve : 0)), links: p.links, withLink, images: imgs.slice(0, 4) }];
  }

  // 3. the text itself; long texts become a numbered thread unless switched off
  const src = plainWithImages(post.parsed.body.split("<!--more-->").join(""));
  const text = fm.title ? `${fm.title}\n\n${src.text}` : src.text;
  const opts = { limit, measure: measureFor(src.links), reserve, linkAt };
  const parts = cp.auto_thread === false
    ? (fm.title
      ? [{ text: truncate(`${fm.title}\n\n${fm.summary ? markdownToPlain(fm.summary).text : excerpt(post.parsed.body)}`, limit - reserve), images: [0, 1, 2, 3].filter((i) => i < src.images.length), withLink: linkAt !== "none" }]
      : singlePost(text, opts))
    : splitThread(text, opts);
  if (cp.image && parts.length && !parts[0].images.length) parts[0].extra = [{ src: cp.image, alt: cp.image_alt || "" }];
  return parts.map((part) => {
    const imgs = part.extra || part.images.map((i) => src.images[i]);
    if (imgs.length > 4) warn(`${path.relative(ROOT, post.file)}: more than 4 images in one part of the thread; only the first 4 are attached.`);
    return { text: part.text, links: linksIn(src.links, part.text), withLink: part.withLink, images: imgs.slice(0, 4) };
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
async function resolveImages(post, list) {
  const found = [];
  for (const img of list) {
    if (!img || !img.src || /^https?:/.test(img.src)) continue;
    const rel = img.src.replace(/^\//, "");
    const candidates = [path.join(ROOT, "assets", rel), path.join(ROOT, "static", rel), path.join(path.dirname(post.file), rel)];
    for (const c of candidates) {
      try { await fs.access(c); found.push({ ...img, file: c }); break; } catch {}
    }
  }
  return found;
}

let sharp;
async function prepareImage(file, maxBytes) {
  sharp ??= (await import("sharp")).default;
  let quality = 82;
  let width = 2000;
  for (;;) {
    const buf = await sharp(file).rotate().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (buf.data.length <= maxBytes || quality < 40) return { bytes: buf.data, width: buf.info.width, height: buf.info.height };
    quality -= 10;
    if (quality < 60) width = Math.round(width * 0.8);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function http(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  return { data, headers: res.headers };
}

async function waitUntilLive(url) {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(url, { method: "GET", redirect: "follow" });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 15000));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bluesky
// ---------------------------------------------------------------------------
async function postBluesky(post) {
  const service = (env.BLUESKY_SERVICE || "https://bsky.social").replace(/\/$/, "");
  const parts = compose(post, { limit: 300, platform: "bluesky" });
  for (const p of parts) p.files = await resolveImages(post, p.images);
  if (DRY) return dryPrint("Bluesky", parts.map((p) => p.text + (p.withLink ? `\n[link card: ${post.url}]` : "") + (p.files.length ? `\n[${p.files.length} image(s)]` : "")));

  const { data: session } = await http(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }),
  });
  const auth = { Authorization: `Bearer ${session.accessJwt}` };

  const upload = async (files) => {
    const blobs = [];
    for (const img of files) {
      const prepared = await prepareImage(img.file, 950_000);
      const { data } = await http(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
        method: "POST", headers: { ...auth, "Content-Type": "image/jpeg" }, body: prepared.bytes,
      });
      blobs.push({ image: data.blob, alt: img.alt || "", aspectRatio: { width: prepared.width, height: prepared.height } });
    }
    return blobs;
  };

  let root = null, parent = null, firstUri = null;
  for (const [i, part] of parts.entries()) {
    let text = part.text;
    let embed;
    const blobs = await upload(part.files);
    if (blobs.length) embed = { $type: "app.bsky.embed.images", images: blobs };
    if (part.withLink) {
      if (embed) text = `${text}\n\n${post.url}`;
      else embed = {
        $type: "app.bsky.embed.external",
        external: { uri: post.url, title: post.fm.title || truncate(markdownToPlain(post.parsed.body).text, 80), description: post.fm.title ? excerpt(post.parsed.body, 200) : "" },
      };
    }
    const record = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
      langs: [post.fm.lang || guessLang(text)],
      facets: blueskyFacets(text, part.links, absolutize),
    };
    if (embed) record.embed = embed;
    if (root) record.reply = { root, parent };
    const { data } = await http(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
    });
    const ref = { uri: data.uri, cid: data.cid };
    if (!root) { root = ref; firstUri = data.uri; }
    parent = ref;
  }
  const rkey = firstUri.split("/").pop();
  return `https://bsky.app/profile/${session.handle}/post/${rkey}`;
}

// ---------------------------------------------------------------------------
// Mastodon
// ---------------------------------------------------------------------------
async function postMastodon(post) {
  const instance = "https://" + (env.MASTODON_INSTANCE || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const parts = compose(post, { limit: 500, platform: "mastodon" });
  for (const p of parts) p.files = await resolveImages(post, p.images);
  const render = (p) => {
    let t = withInlineUrls(p.text, p.links, absolutize);
    if (p.withLink) t = `${t}\n\n${post.url}`;
    return t;
  };
  if (DRY) return dryPrint("Mastodon", parts.map((p) => render(p) + (p.files.length ? `\n[${p.files.length} image(s)]` : "")));

  const auth = { Authorization: `Bearer ${env.MASTODON_TOKEN}` };
  const upload = async (files) => {
    const ids = [];
    for (const img of files) {
      const prepared = await prepareImage(img.file, 8_000_000);
      const form = new FormData();
      form.append("file", new Blob([prepared.bytes], { type: "image/jpeg" }), "image.jpg");
      if (img.alt) form.append("description", img.alt.slice(0, 1500));
      let { data } = await http(`${instance}/api/v2/media`, { method: "POST", headers: auth, body: form });
      for (let i = 0; i < 10 && !data.url; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        ({ data } = await http(`${instance}/api/v1/media/${data.id}`, { headers: auth }));
      }
      ids.push(data.id);
    }
    return ids;
  };

  let parentId = null, firstUrl = null;
  for (const [i, part] of parts.entries()) {
    const body = { status: render(part), visibility: "public", language: post.fm.lang || guessLang(part.text) };
    const mediaIds = await upload(part.files);
    if (mediaIds.length) body.media_ids = mediaIds;
    if (parentId) body.in_reply_to_id = parentId;
    const key = crypto.createHash("sha256").update(`${post.file}|mastodon|${i}`).digest("hex");
    const { data } = await http(`${instance}/api/v1/statuses`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    parentId = data.id;
    firstUrl ??= data.url;
  }
  return firstUrl;
}

// ---------------------------------------------------------------------------
// LinkedIn (text + link preview; no threads)
// ---------------------------------------------------------------------------
function linkedinVersion() {
  if (env.LINKEDIN_VERSION) return env.LINKEDIN_VERSION;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 2); // LinkedIn supports monthly versions for about a year
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function postLinkedin(post) {
  const { fm, cp } = post;
  let text;
  if (cp.text && cp.text.trim()) text = withInlineUrls(...Object.values(markdownToPlain(cp.text)), absolutize);
  else if (fm.title) text = `${fm.title}\n\n${fm.summary ? markdownToPlain(fm.summary).text : excerpt(post.parsed.body, 1200)}`;
  else { const p = markdownToPlain(post.parsed.body); text = withInlineUrls(p.text, p.links, absolutize); }
  text = truncate(text, 2900);
  const commentary = linkedinEscape(text).replace(/\\#([\p{L}\p{N}_]+)/gu, "{hashtag|\\#|$1}");
  const title = fm.title || truncate(markdownToPlain(post.parsed.body).text.replace(/\n+/g, " "), 120);
  if (DRY) return dryPrint("LinkedIn", [`${text}\n[link preview: ${post.url} · ${title}]`]);

  const headers = {
    Authorization: `Bearer ${env.LINKEDIN_TOKEN}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": linkedinVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
  };
  let author = env.LINKEDIN_AUTHOR_URN;
  if (!author) {
    const { data } = await http("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: headers.Authorization } });
    author = `urn:li:person:${data.sub}`;
  }
  const { headers: h } = await http("https://api.linkedin.com/rest/posts", {
    method: "POST", headers,
    body: JSON.stringify({
      author, commentary, visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { article: { source: post.url, title } },
      lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
    }),
  });
  const urn = h.get("x-restli-id") || h.get("x-linkedin-id");
  return urn ? `https://www.linkedin.com/feed/update/${urn}/` : "https://www.linkedin.com/in/me/recent-activity/all/";
}

// ---------------------------------------------------------------------------
function guessLang(text) {
  const de = (text.match(/\b(und|der|die|das|nicht|ist|mit|ein|eine|für|auf|ich|wir)\b/gi) || []).length;
  const en = (text.match(/\b(and|the|is|not|with|for|on|this|that|we|our)\b/gi) || []).length;
  return de > en ? "de" : "en";
}

function dryPrint(platform, posts) {
  log(`\n--- ${platform} (${posts.length} post${posts.length > 1 ? "s" : ""}) ---`);
  posts.forEach((p, i) => log(`[${i + 1}] (${graphemes(p)} chars)\n${p}\n`));
  return `dry-run:${platform.toLowerCase()}`;
}

const PLATFORMS = {
  bluesky: { ready: () => env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD, send: postBluesky },
  mastodon: { ready: () => env.MASTODON_INSTANCE && env.MASTODON_TOKEN, send: postMastodon },
  linkedin: { ready: () => env.LINKEDIN_TOKEN, send: postLinkedin },
};

async function main() {
  const posts = await loadCandidates();
  if (!posts.length) return log("Nothing to cross-post.");
  let failed = 0;

  for (const post of posts) {
    const rel = path.relative(ROOT, post.file);
    log(`\n${rel} -> ${post.url} (${post.want.join(", ")})`);
    if (!DRY && !(await waitUntilLive(post.url))) {
      warn(`${post.url} is not reachable yet; will try again on the next run.`);
      continue;
    }
    const results = {};
    for (const p of post.want) {
      if (!PLATFORMS[p].ready() && !DRY) { warn(`${p}: no credentials set, skipped.`); continue; }
      try {
        results[p] = await PLATFORMS[p].send(post);
        log(`  ${p}: ${results[p]}`);
      } catch (e) {
        failed++;
        warn(`${p} failed for ${rel}: ${e.message}`);
      }
    }
    if (!DRY && Object.keys(results).length) {
      const doc = post.parsed.doc;
      for (const [p, url] of Object.entries(results)) doc.setIn(["syndication", p], url);
      await fs.writeFile(post.file, `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n${post.parsed.body.startsWith("\n") ? "" : "\n"}${post.parsed.body}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
