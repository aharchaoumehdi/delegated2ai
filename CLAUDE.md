# Working on delegated.ai

- Content lives in `data/cases/YYYY/<added>-<id>.json`, one file per use case, validated by
  `scripts/lib/schema.mjs`. Run `npm run check` after any change to data, config or scripts.
- Never invent or guess a source URL, author, date or outcome. Every fact must come from the
  original source; unknown fields are `null`. `docs/editorial-guidelines.md` is the standard
  (and the curator's prompt) — change behaviour there, not in code, when possible.
- Entries with `status: "review"` are hidden until a human flips them to `"published"`.
- The site is static and dependency-free in the browser. `site/assets/render.js` is shared by
  the build and the browser: keep it free of Node APIs.
- Design: dark by default (`--bg: #000`), tokens in `site/assets/style.css`; light theme via
  `[data-theme="light"]`. Fonts: Funnel Sans / Funnel Display / Geist Mono.
- Preview locally with `SITE_URL=http://localhost:4173/ npm run dev`.
