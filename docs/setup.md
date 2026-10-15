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
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Recommended | Reddit blocks anonymous requests from cloud IPs. Create a "script" app at reddit.com/prefs/apps |
| `X_BEARER_TOKEN` | Optional | X search (paid API plan) |

Optional **variables** (same page, Variables tab): `SITE_LIVE` (see step 2), `CURATOR_MODEL` (default `claude-opus-5-5`),
`PUBLISH_THRESHOLD` (default 7), `DAILY_MAX` (default 7), `SITE_URL` (overrides the URL).

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
