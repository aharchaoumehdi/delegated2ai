# Working on delegatedto.ai

- Content lives in `data/cases/YYYY/<added>-<id>.json`, one file per use case, validated by
  `scripts/lib/schema.mjs`. Run `npm run check` after any change to data, config or scripts.
- Never invent or guess a source URL, author, date or outcome. Every fact must come from the
  original source; unknown fields are `null`. `docs/editorial-guidelines.md` is the standard
  (and the curator's prompt) — change behaviour there, not in code, when possible.
- The curator's verdict is final: score ≥ 5 publishes automatically, with no human review.
  `status: "review"` only means "waiting for a publishing slot" (over the daily cap, published
  first on the next run) or, for `curation.method: "manual"`, held until its facts are verified.
- Each entry's write-up (`what_they_did`, `how_it_went`, `worth_knowing`, `prompt`) follows
  "The write-up" in the guidelines; `scripts/enrich.mjs` backfills missing ones.
- Votes go through `worker/` (Cloudflare Worker + D1); keep the Privacy page in
  `scripts/build.mjs` accurate if what it stores changes.
- The site is static and dependency-free in the browser. `site/assets/render.js` is shared by
  the build and the browser: keep it free of Node APIs.
- Design: dark by default (`--bg: #000`), tokens in `site/assets/style.css`; light theme via
  `[data-theme="light"]`. Fonts: Funnel Sans / Funnel Display / Geist Mono.
- Preview locally with `SITE_URL=http://localhost:4173/ npm run dev`.
