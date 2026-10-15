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
`PUBLISH_THRESHOLD` (default 7), `DAILY_MAX` (default 7), `SITE_URL` (overrides the URL).

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

The collector makes one search a day of up to `maxResults` posts (100 by default in
`config/sources.json`): at most about $0.50 a day, roughly $15 a month. Lower
`maxResults` to spend less. Set a spending limit or turn off auto-recharge in the
console if you want a hard cap.

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

Curation evaluates at most 40 candidates a day (`maxCandidates` in `config/sources.json`),
in batches of 6. With the default model that is roughly a dollar a day or less; lower
`maxCandidates` or set `CURATOR_MODEL` to reduce it.
