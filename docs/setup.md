# One-time setup

The site and the daily pipeline run entirely on GitHub Actions + GitHub Pages.

## 1. Merge to `main`

Scheduled workflows only run on the default branch.

## 2. Turn on GitHub Pages (at launch)

A GitHub Pages site is public, even when the repository is private. Until you are ready to
launch, leave Pages off: the daily workflow still collects and curates, and its deploy job is
held (the run summary says "Deploy held"). To launch:

1. Settings → Pages → **Build and deployment → Source: GitHub Actions**.
2. Settings → Secrets and variables → Actions → Variables → **New repository variable**
   `SITE_LIVE` = `true`. Set it back to anything else to stop publishing.
3. Actions → **Daily update & deploy** → **Run workflow** (tick "Only rebuild and deploy").

The site is served at `https://aharchaoumehdi.github.io/delegated2ai/` until the custom
domain below is set up. GitHub Pages on a private repository needs a paid GitHub plan; on a
free plan, make the repository public.

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

The collector makes one search a day of up to `maxResults` posts (50 by default in
`config/sources.json`), sorted by relevance: at most about $0.25 a day, roughly $7.50 a
month. Every post X returns goes to the curator (X is listed in `alwaysCurate`), so we
never pay for a post and then discard it unread. Change `maxResults` (10-100) to spend
more or less. Set a spending limit or turn off auto-recharge in the
console if you want a hard cap.

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
4. Add that URL as the repository **variable** `VOTES_API`. The next deploy uses it.

Allowed site origins are listed in `worker/wrangler.toml` (`ALLOWED_ORIGINS`). What is
stored, and for how long, is described on the site's Privacy page.

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

## 6. Custom domain: delegatedto.ai

The site runs on the github.io address until these steps are done. Do them in this order,
because the build writes a `CNAME` file as soon as `url` is no longer a github.io address.

1. Register `delegatedto.ai` at any registrar that sells .ai (two-year minimum term).
2. Verify the domain for your account first, so nobody else can claim it on Pages:
   GitHub → your profile Settings → Pages → **Add a domain**, then add the TXT record it shows.
3. At the registrar, add DNS records for the apex domain:
   - A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - AAAA records `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - CNAME `www` → `aharchaoumehdi.github.io`
4. Set `"url": "https://delegatedto.ai/"` in `config/site.json`, merge to `main`, and let
   the deploy run.
5. Repo Settings → Pages → Custom domain → `delegatedto.ai`, wait for the DNS check, then
   tick **Enforce HTTPS** once it becomes available.

## Cost

Filters are deliberately loose: low engagement never keeps a relevant post from the
curator, because new ideas often start with few likes. What reaches Claude each day:

- every post from a paid source or a reader submission (`alwaysCurate`), and
- up to `maxCandidates` (60) of the free sources' keyword-matching posts.

That is up to about 110 candidates on a busy day, judged in batches of 6; posts already
judged are remembered and never paid for twice. Curation cost grows with that number, so
`maxCandidates`, X's `maxResults` and `CURATOR_MODEL` are the levers to spend less. Each
run log in `data/runs/` shows how many items every source returned and, for X, how many
posts were billed (`fetched`).
