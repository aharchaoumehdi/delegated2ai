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
- Design: dark by default, light via `[data-theme="light"]` (the choice is remembered). Colours are
  semantic tokens at the top of `site/assets/style.css` (surfaces, `--divider` vs `--border-control`,
  `--heading`/`--text`/`--text-muted`, `--accent*`); components use tokens, never raw hex. Cyan fill
  (`.btn-cta`, dark text) is reserved for the newsletter action; selected states pair the accent with a
  non-colour cue (fill, outline, ✓, weight). Keep every text pair at WCAG AA in both themes.
  Fonts: Funnel Sans / Funnel Display / Geist Mono; the wordmark text uses Space Grotesk 600.
- Brand: `brand/` is the C3 logo kit and `brand/specifications.html` is the standard (colours,
  clear space, minimum sizes). The site uses copies in `site/assets/brand/` (logo canvas trimmed
  to the artwork, a simplified small symbol, icons, share image); never redraw or recolour the
  logo in code. The accent `--signal` is the logo's "to" cyan.
- Preview locally with `SITE_URL=http://localhost:4173/ npm run dev`.
