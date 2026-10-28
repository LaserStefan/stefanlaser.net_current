# Setting up stefanlaser.net

This repository holds the whole site: posts, notes, projects, publications, images,
design and the CMS. GitHub Actions builds it with Hugo, uploads it to Cloudflare Pages
and sends new posts to Bluesky, Mastodon and LinkedIn.

Everything below is a one-time setup. It takes about an hour, mostly waiting for pages
to load. Nothing here costs money.

## 1. Cloudflare: let GitHub upload the site

1. Log in at dash.cloudflare.com. On the start page, copy your **Account ID** (right column, or under *Workers & Pages*).
2. Go to *My Profile → API Tokens → Create Token → Create Custom Token*.
   - Name: `github-deploy`
   - Permissions: *Account → Cloudflare Pages → Edit*
   - Create it and copy the token (it is shown once).
3. In this repository on GitHub: *Settings → Secrets and variables → Actions → New repository secret*. Add:
   - `CLOUDFLARE_API_TOKEN` = the token
   - `CLOUDFLARE_ACCOUNT_ID` = the account ID
4. *Actions* tab → *Build, deploy and cross-post* → *Run workflow*. After 3–5 minutes the site is
   live at **https://stefanlaser-net.pages.dev**. Check it there before touching the domain.

## 2. Test address for design changes

Every branch other than `main` gets its own address. Create a branch called `test`
(GitHub → branch menu → type `test` → *Create branch*), and anything committed there
appears at **https://test.stefanlaser-net.pages.dev** without touching the real site.
Nothing is cross-posted from test branches. Keep branch names simple (letters, numbers, dashes).

In the CMS you can switch which branch you edit by changing `branch: main` in
`static/admin/config.yml` on the test branch to `branch: test`.

## 3. CMS login (Sveltia)

The CMS lives at `/admin/`. It logs in with your GitHub account through a small helper on Cloudflare.

1. Open https://github.com/sveltia/sveltia-cms-auth and click **Deploy to Cloudflare Workers**
   (follow the button; it creates a Worker in your Cloudflare account). Note its address,
   something like `https://sveltia-cms-auth.<your-name>.workers.dev`.
2. GitHub → *Settings* (your profile) → *Developer settings → OAuth Apps → New OAuth App*:
   - Application name: `stefanlaser.net CMS`
   - Homepage URL: `https://stefanlaser.net`
   - Authorization callback URL: `https://sveltia-cms-auth.<your-name>.workers.dev/callback`
   - Register, then *Generate a new client secret*. Copy the Client ID and the secret.
3. Cloudflare → *Workers & Pages* → the `sveltia-cms-auth` worker → *Settings → Variables and Secrets*. Add:
   - `GITHUB_CLIENT_ID` = Client ID
   - `GITHUB_CLIENT_SECRET` = secret (type: *Secret*)
   - `ALLOWED_DOMAINS` = `stefanlaser.net, *.stefanlaser-net.pages.dev`
4. In this repository, edit `static/admin/config.yml` and replace the line
   `base_url: https://sveltia-cms-auth.YOUR-SUBDOMAIN.workers.dev` with your worker address.
5. Open https://stefanlaser-net.pages.dev/admin/ and sign in with GitHub.

## 4. Cross-posting accounts

Add these as repository secrets (same place as in step 1). Leave out any platform you don't want;
it is simply skipped.

**Bluesky**
- In Bluesky: *Settings → Privacy and security → App passwords → Add app password*.
- Secrets: `BLUESKY_HANDLE` (e.g. `stefanlaser.bsky.social`) and `BLUESKY_APP_PASSWORD`.

**Mastodon**
- On social.tchncs.de: *Preferences → Development → New application*. Name it `stefanlaser.net`,
  keep only the scopes `write:statuses` and `write:media`, save, then open it and copy *Your access token*.
- Secrets: `MASTODON_INSTANCE` = `social.tchncs.de`, `MASTODON_TOKEN` = the token.

**LinkedIn** (the fiddly one)
- Go to https://www.linkedin.com/developers/apps → *Create app*. LinkedIn asks for a company page;
  any page you administer works (you can create a small one).
- In the app, under *Products*, add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
- Under *Auth*, use the **OAuth 2.0 tools** link to create a token with the scopes
  `openid profile w_member_social`.
- Secret: `LINKEDIN_TOKEN` = the token.
- The token expires after about 60 days. Add a repository **variable** (not secret)
  `LINKEDIN_TOKEN_DATE` with the date you created it (e.g. `2026-11-02`), and the workflow
  warns you after 50 days. Then repeat the last two steps.

To try it without posting anything: *Actions → Build, deploy and cross-post → Run workflow*
with "only show what would be posted" ticked. The log shows each text exactly as it would be sent.

## 5. Your domain

When the pages.dev address looks right:

1. Cloudflare → *Workers & Pages* → `stefanlaser-net` → *Custom domains → Set up a custom domain*
   → `stefanlaser.net` (and again for `www.stefanlaser.net`).
2. Cloudflare shows which DNS records to set. At your current domain host, either
   - point the domain's nameservers to Cloudflare (simplest; the domain itself stays registered where it is), or
   - set the CNAME record Cloudflare shows (works for `www`; for the bare domain most hosts need the nameserver route).
3. Wait until Cloudflare shows the domain as *Active* (minutes to a few hours).
4. Run Micro.blog and the new site side by side for a couple of weeks, then cancel Micro.blog.
   Keep the old archive repository as a backup.

If Mastodon should show a verified link to the site, the homepage already sets `rel="me"` on the
Mastodon icon. Add `https://stefanlaser.net` to your Mastodon profile fields.

## Linking old notes to their Mastodon and Bluesky originals

New notes get their links automatically when they are cross-posted. For the old Micro.blog notes,
run *Actions → Link old notes to Mastodon and Bluesky → Run workflow* once:

1. First with "Only show the matches" ticked. The log lists every note and the post it found.
2. If that looks right, run it again without the tick. The links are written into the notes and
   show up under each note ("reply on mastodon · bluesky").

It reads your public timelines (no password needed) and matches by date and text. Add your Bluesky
handle in the CMS under *Site settings → Micro stream* first, or type it into the workflow form.
Notes that can't be matched with confidence are left alone.

## Keeping bots out

`robots.txt` asks AI crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended, PerplexityBot and others) to stay away,
and every page carries a `noai` tag. Polite crawlers respect this; to actually block the rest, turn on
Cloudflare → your domain → *Security → Bots → Block AI bots* once the domain runs through Cloudflare (step 5).

## How it runs day to day

- Write in the CMS and press **Publish**. GitHub builds the site and uploads it (2–4 minutes),
  then sends the post to the ticked platforms and writes the links back into the post.
- The micro stream (Bluesky or Mastodon, switch in *Site settings*) refreshes every 3 hours.
- Publications from your ORCID record are fetched on every build, so a new entry in ORCID shows up within 3 hours.
- The photos page collects every image used in notes automatically.
- Posts dated in the future are published by the next run after their date.
- Old posts are never cross-posted: only posts from the last 3 days with a cross-posting block are sent.

## Files worth knowing

| Where | What |
|---|---|
| `content/notes`, `content/posts` | Notes without and with a title (one stream on the site) |
| `content/projects/<name>/index.md` | One folder per project |
| `content/publications/items` | Publications added by hand (linked to projects); the rest comes from ORCID |
| `data/site.yaml` | Menu, homepage text, micro stream, colours (edited in the CMS) |
| `assets/uploads` | Images (Hugo resizes and dithers them) |
| `static/_redirects` | Old Micro.blog addresses that moved |
| `assets/css/extended/site.css` | All design changes on top of PaperMod |
| `scripts/crosspost` | The cross-posting job |
| `scripts/import_microblog.py` | The one-off import from the Micro.blog archive (kept for reference) |

GitHub Actions: a private repository has 2,000 free minutes a month; a run takes about 3 minutes,
so the 3-hourly refresh uses roughly 750. Making the repository public removes the limit.
