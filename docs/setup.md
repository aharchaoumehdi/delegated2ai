# One-time setup

The daily pipeline runs on GitHub Actions; the site, the votes service and the domain live on
Cloudflare (free plan).

## 1. Merge to `main`

Scheduled workflows only run on the default branch.

## 2. Publish on Cloudflare (at launch)

The site is a folder of static files served by Cloudflare (`deploy/wrangler.toml`), with the
same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets as the votes service (see
"Votes" below). The repository can stay private. Until you launch, the daily workflow still
collects and curates, and its deploy job is held (the run summary says "Deploy held").

1. **Domain.** Cloudflare dashboard → **Domain Registration → Register Domains**, search
   `delegatedto.ai`, pick a 2-year term (the .ai minimum) and pay. The domain is added to
   your account with Cloudflare DNS automatically.
2. **Launch switch.** GitHub → Settings → Secrets and variables → Actions → **Variables** →
   New repository variable `SITE_LIVE` = `true`. Set it to anything else to stop publishing.
3. **First publish.** Actions → **Daily update & deploy** → Run workflow, tick "Only rebuild
   and deploy". The run summary shows the Cloudflare address
   (`https://delegatedto-site.<account>.workers.dev`).
4. **The domain.** `deploy/wrangler.toml` declares `delegatedto.ai` and `www.delegatedto.ai`
   as custom domains, so the first publish after the domain is active attaches them;
   Cloudflare creates the DNS records and HTTPS certificates itself. (Pages declare
   `delegatedto.ai` as canonical.) If the API token lacks permission for that, add them in
   the dashboard instead: Workers & Pages → `delegatedto-site` → Settings → Domains & Routes.

After that every scheduled run publishes the day's update, and every merge to `main`
republishes the site. `config/site.json` → `url` is the address used in links, the sitemap
and the feed (a repository variable `SITE_URL` overrides it).

## 3. Add secrets

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Required | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude curation (console.anthropic.com) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Recommended | Reddit blocks anonymous requests from cloud IPs. Needs approved API access, see "Reddit" below |
| `X_BEARER_TOKEN` | Optional | X recent search, billed per post read, see "X" below |

Optional **variables** (same page, Variables tab): `SITE_LIVE` (see step 2), `REDDIT_USERNAME` (see Reddit), `CURATOR_MODEL` (default `claude-opus-5-5`),
`PUBLISH_THRESHOLD` (default 5), `DAILY_MAX` (default 25), `SITE_URL` (overrides the URL).

### Reddit

Since November 2025, Reddit approves every new Data API client by hand under its
Responsible Builder Policy; creating an app at reddit.com/prefs/apps alone no longer works.

1. Read the Responsible Builder Policy and the Data API Terms (linked from
   reddit.com/wiki/api).
2. Request access through Reddit's developer support form. Describe the use plainly:
   a read-only script that, once a day, reads the top posts of about a dozen public AI
   subreddits (listed in `config/sources.json`), has an LLM write a short summary of
   qualifying posts, and links back to the original thread. No posting, voting, user
   data, or model training. Low volume: about 15 requests a day.
3. When approved, create the "script" app the approval allows and add its client ID and
   secret as the two secrets above.
4. Add the repository **variable** `REDDIT_USERNAME` (the account that owns the app,
   without `u/`). Reddit asks API clients to identify themselves this way.

Approval can take days to weeks and is not guaranteed. Until then Reddit is reported as
an error in each run log and the other sources are unaffected.

### X

The X API is pay-per-use: you buy credits in the X Developer Console and each post a
request returns costs $0.005 (no free tier, no subscription for new accounts).

1. Sign in at console.x.com with the X account that should own the app, create a
   project and an app, and copy the app's **Bearer Token**.
2. Add a payment card and buy a small amount of credit. X has offered new accounts $20
   of starter credit after saving a card.
3. Add the token as the `X_BEARER_TOKEN` secret.

The collector runs three focused searches a day (`x.queries` in `config/sources.json`):
coding agents in use, personal and business agents, and agents at work. Each is sorted by
relevance and capped by its own `maxResults` (30, 30 and 20): at most 80 posts, about
$0.40 a day or $12 a month. Every post X returns goes to the curator (X is listed in
`alwaysCurate`), so we never pay for a post and then discard it unread. When a post
links to a repo, write-up or demo, that page is fetched so the curator judges the work,
not just the post. Each run log shows, per search, how many posts X returned (billed)
and how many were new. Lower a search's `maxResults` (10-100), or remove a search, to
spend less. Set a spending limit or turn off auto-recharge in the X console if you want
a hard cap.

### Votes ("I want this" and the up arrow)

Vote counts are shared through a small Cloudflare Worker with a D1 database
(`worker/`), on Cloudflare's free plan. Until it is set up, votes still work but are
kept in each visitor's browser only, and "Trending today" uses the editor's order.

1. Create a free Cloudflare account, then an API token at
   dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare
   Workers" template, with **D1: Edit** added under Account permissions.
2. Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (the account ID is on the Workers & Pages overview page).
3. Actions → **Deploy votes service** → Run workflow. It creates the database, deploys
   the Worker and prints its URL in the run summary.
4. Put that URL in `votesApi` in `config/site.json` (done: it is
   `https://delegatedto-votes.aharchaou-mehdi.workers.dev`). A repository variable
   `VOTES_API` overrides it without a code change.

Allowed site origins are listed in `worker/wrangler.toml` (`ALLOWED_ORIGINS`). What is
stored, and for how long, is described on the site's Privacy page.

### Email addresses (hello@, sponsors@)

`hello@delegatedto.ai` (the newsletter's sender, where replies land) and
`sponsors@delegatedto.ai` (on the Sponsor page) forward to your own inbox through Cloudflare
Email Routing (free). To set them up:

1. Give `CLOUDFLARE_API_TOKEN` these extra permissions (Cloudflare → My Profile → API
   Tokens → edit the token): Zone · Email Routing Rules · Edit, Zone · DNS · Edit,
   Zone · Zone · Read, Account · Email Routing Addresses · Edit.
2. Actions → **Set up email addresses** → Run workflow, with your inbox as the destination.
3. Click the verification link Cloudflare emails to that inbox. Forwarding starts then.

The workflow is safe to re-run; it only adds what is missing.

### Newsletter (the daily email)

The sign-up form posts to the votes service, which passes the address to
[Kit](https://kit.com) (free up to 10,000 subscribers, API included). Kit sends the
"confirm your address" email, hosts the list and adds the unsubscribe link; we never
store addresses. Every scheduled daily run then emails that day's best new use cases
(up to 5) as a Kit broadcast. Until Kit is connected, the form says sign-ups open soon
and points to the RSS feed.

1. Create a Kit account and a form (any design; it is never shown on the site). In
   the form's settings keep **double opt-in** on (Kit calls the confirmation message
   the "incentive email"). The form's ID is the number in its URL in Kit.
2. In **Settings → Developer**, create a **v4 API key**.
3. Add two repository secrets: `KIT_API_KEY` (the key) and `KIT_FORM_ID` (the number).
4. Actions → **Deploy votes service** → Run workflow. It hands both to the Worker; the
   run summary says "Newsletter sign-ups connected to Kit".
5. The daily email starts with the first scheduled run after launch (`SITE_LIVE`), and
   only on scheduled runs, so every link already works. Each broadcast is tagged
   `digest <date>` and is never sent twice for the same day.

Set `newsletter.showCountFrom` in `config/site.json` to the subscriber count at which
"Join N readers" appears under the form (100 by default). Set `newsletter.provider` to
`""` to go back to a plain link to the RSS feed.

### Sponsors

Paid placements live in `config/site.json`: `sponsors` (the bar along the bottom of
every page: `{ "name", "text", "url", "abbr" }`) and `sponsor` (the sidebar card:
`{ "name", "text", "url", "cta" }`). With none set, the bar shows our own digest and a
"Your logo here" slot linking to the Sponsor page.

### Write-ups

Every entry has a write-up: what they did, how it went, what's worth knowing, and a
prompt to try it. The curator writes it for new entries; `scripts/enrich.mjs` fills in
any that are missing on each daily run. To backfill right away, run **Daily update &
deploy** with "Only fill in missing write-ups" ticked.

## 4. Allow the workflow to push

Settings → Actions → General → **Workflow permissions: Read and write permissions**.

## 5. First run

Actions → **Daily update & deploy** → **Run workflow**. Each run's summary lists what was
published; `data/runs/<date>.json` records what every source returned.

## Cost

Filters are deliberately loose: low engagement never keeps a relevant post from the
curator, because new ideas often start with few likes. What reaches Claude each day:

- every post from a paid source or a reader submission (`alwaysCurate`), and
- up to `maxCandidates` (60) of the free sources' keyword-matching posts.

That is up to about 110 candidates on a busy day, judged in batches of 6; posts already
judged are remembered and never paid for twice. Curation cost grows with that number, so
`maxCandidates`, each X search's `maxResults` and `CURATOR_MODEL` are the levers to spend less. Each
run log in `data/runs/` shows how many items every source returned and, for X, how many
posts were billed (`fetched`).
