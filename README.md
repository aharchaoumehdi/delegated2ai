# delegatedto.ai

A daily, searchable directory of real things people are handing to AI agents — found across
the web (Hacker News, Reddit, X, GitHub, blogs), explained in two sentences, tagged by agent
and category, and always linked to the original source.

## How it works

```
collect (scripts/collect.mjs)  →  curate with Claude (scripts/curate.mjs)  →  data/cases/*.json  →  build (scripts/build.mjs)  →  GitHub Pages
```

1. **Collect** — pulls the last ~36 hours from every source in `config/sources.json`, dedupes
   by canonical URL, ranks by relevance and engagement, and fetches page text for the best 40.
2. **Curate** — Claude judges each candidate against `docs/editorial-guidelines.md`, writes
   the title/summary/fields, and scores it 0–10. ≥ 7 is published (max 7/day), 5–6 waits in a
   review queue (`status: "review"`), the rest is remembered in `data/state/seen.json` so it is
   never paid for twice. Source URLs always come from the collector, never from the model.
3. **Build** — renders a static site into `dist/`: home, New, per-agent and per-category pages,
   one page per use case, RSS, sitemap and a public `cases.json`.
4. **Deploy** — `.github/workflows/daily.yml` runs all of the above every day at 06:17 UTC,
   commits new entries, and publishes to GitHub Pages once the `SITE_LIVE` repository
   variable is `true` (see [docs/setup.md](docs/setup.md)).

## Repository layout

| Path | What lives there |
|---|---|
| `config/site.json` | Name, tagline, public URL, newsletter / analytics / sponsor slots |
| `config/sources.json` | Which sources, queries and thresholds the collector uses |
| `config/taxonomy.json` | Categories, agents (badge colours, descriptions), evidence types |
| `data/cases/YYYY/` | One JSON file per use case — the content of the site |
| `data/runs/` | One log per daily run (what each source returned, what was published) |
| `data/state/seen.json` | URLs already judged, so they aren't re-evaluated |
| `docs/editorial-guidelines.md` | The editorial standard — also the curator's instructions |
| `docs/setup.md` | One-time setup: Pages, secrets, custom domain |
| `scripts/` | Collectors, curator, builder, validator, local preview server |
| `site/assets/` | CSS, browser JS and the rendering code shared with the build |

## Local development

```bash
npm ci
npm run check                                   # validate data + build
SITE_URL=http://localhost:4173/ npm run dev     # build and preview at http://localhost:4173/
npm run collect                                 # needs network access to the sources
ANTHROPIC_API_KEY=... npm run curate            # judges .cache/candidates.json
```

To add or fix an entry by hand, edit or create a file in `data/cases/YYYY/` (see
`scripts/lib/schema.mjs` for the fields) and run `npm run check`.

## Setup

See [docs/setup.md](docs/setup.md).
