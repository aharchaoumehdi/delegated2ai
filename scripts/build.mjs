// Builds the static site into dist/: the feed, one page per use case,
// RSS, sitemap and a public JSON API (cases.json).
//
//   SITE_URL=http://localhost:4173/ npm run build   # override the public URL
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCases, sortCases } from "./lib/cases.mjs";
import { taxonomy } from "./lib/taxonomy.mjs";
import { path, readJSON, slugify, today } from "./lib/util.mjs";
import { cardHTML, detailHTML, dayLabel, esc, formatDate } from "../site/assets/render.js";

const site = await readJSON(path("config", "site.json"));
const siteUrl = (process.env.SITE_URL || site.url).replace(/\/?$/, "/");
const base = new URL(siteUrl).pathname; // e.g. "/agents-in-practice/"
const DIST = path("dist");

const { cases: all, errors } = await loadCases();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const cases = sortCases(all.filter((c) => c.status === "published")).map(({ _file, curation, status, ...c }) => c);
const buildDay = cases[0]?.added && cases[0].added > today() ? cases[0].added : today();

const count = (key) => {
  const m = new Map();
  for (const c of cases) m.set(c[key], (m.get(c[key]) || 0) + 1);
  return m;
};
const domainCounts = count("domain");
const platformCounts = [...count("platform")].sort((a, b) => b[1] - a[1]);

// ---------- shared fragments ----------
const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6L20 11l-5.4 2.4L12 19l-2.6-5.6L4 11l5.4-2.4z"/></svg>`;

function head({ title, description, canonical, extra = "" }) {
  const analytics = site.analytics?.plausibleDomain
    ? `<script defer data-domain="${esc(site.analytics.plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b0f17">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="${siteUrl}feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}assets/style.css">
<script>try{var t=localStorage.getItem("aip.theme");t=t?JSON.parse(t):"dark";document.documentElement.dataset.theme=t}catch(e){}</script>
${analytics}
${extra}
</head>`;
}

function highlightsPanel(list) {
  const latestDay = list[0]?.added;
  const picks = list.filter((c) => c.added === latestDay).sort((a, b) => b.score - a.score).slice(0, 3);
  const items = (picks.length ? picks : list.slice(0, 3))
    .map(
      (c) => `<a class="hl-item" href="${base}case/${esc(c.id)}/" data-open="${esc(c.id)}">
      <div class="hl-kicker">${esc(c.platform)} · ${esc(c.domain)}</div>
      <div class="hl-title">${esc(c.title)}</div></a>`,
    )
    .join("");
  return `<section class="panel panel-hl" aria-labelledby="hl-h">
    <h2 id="hl-h">Today’s highlights</h2>
    <p class="sub">Top picks · ${latestDay ? esc(dayLabel(latestDay, buildDay)) : "the feed"}</p>
    ${items}
  </section>`;
}

function digestPanel() {
  const nl = site.newsletter?.action;
  const form = nl
    ? `<form action="${esc(nl)}" method="post" target="_blank">
        <label class="sr-only" for="nl-email">Email</label>
        <input id="nl-email" type="email" name="email" placeholder="you@example.com" required>
        <button class="btn-primary" type="submit">Subscribe</button>
      </form>`
    : `<div class="links-row"><a class="btn-primary" href="${siteUrl}feed.xml">RSS feed</a>
       <a class="btn-ghost" href="https://github.com/${esc(site.repo)}/issues/new?template=submit-use-case.yml">Submit a use case</a></div>`;
  return `<section class="panel panel-plain digest">
    <h2>Get the daily digest</h2>
    <p>3–7 hand-checked agent applications a day. No hype, always linked to the original.</p>
    ${form}
  </section>`;
}

function sponsorPanel() {
  if (!site.sponsor) return "";
  const s = site.sponsor;
  return `<section class="panel panel-plain sponsor"><div class="label">Sponsor</div>
    <p><a href="${esc(s.url)}" rel="sponsored noopener" target="_blank"><strong>${esc(s.name)}</strong></a> — ${esc(s.text)}</p></section>`;
}

function statsPanel() {
  return `<section class="panel panel-plain">
    <div class="stats">
      <div class="stat"><b>${cases.length}</b><span>use cases</span></div>
      <div class="stat"><b>${platformCounts.length}</b><span>platforms</span></div>
      <div class="stat"><b>${domainCounts.size}</b><span>domains</span></div>
    </div>
  </section>`;
}

// ---------- listing pages (home, new today, per-category, per-agent) ----------
const DOMAIN_BY_NAME = new Map(taxonomy.domains.map((d) => [d.name, d]));
const domainHref = (name) => `${base}category/${slugify(name)}/`;
const agentHref = (name) => `${base}agents/${slugify(name)}/`;

function sidebar(active) {
  const item = (href, label, count, key) =>
    `<a class="nav-item${active === key ? " is-active" : ""}" href="${href}"><span>${label}</span>${
      count !== undefined ? `<span class="count">${count}</span>` : ""
    }</a>`;
  const domains = taxonomy.domains
    .filter((d) => domainCounts.has(d.name))
    .map((d) => item(domainHref(d.name), `${d.emoji} ${esc(d.name)}`, domainCounts.get(d.name), `domain:${d.name}`))
    .join("");
  const agents = platformCounts
    .slice(0, 12)
    .map(([p, n]) => item(agentHref(p), esc(p), n, `agent:${p}`))
    .join("");
  const evidence = taxonomy.evidence
    .map((e) => `<button class="nav-item" data-evidence="${esc(e.name)}" title="${esc(e.description)}"><span>${esc(e.name)}</span></button>`)
    .join("");
  return `<aside class="sidebar" aria-label="Browse">
    <a class="brand" href="${base}"><span class="logo">${LOGO}</span>${esc(site.name)}</a>
    <nav class="nav">
      ${item(base, "Home", cases.length, "home")}
      ${item(`${base}new/`, "New today", newToday.length, "new")}
      <a class="nav-item" href="${base}?view=top" data-view="top"><span>Top rated</span></a>
      <a class="nav-item" href="?view=saved" data-view="saved"><span>Saved</span><span class="count" id="saved-count"></span></a>
    </nav>
    <div class="nav-label">Categories</div>
    <nav class="nav">${domains}</nav>
    <div class="nav-label">Agents</div>
    <nav class="nav">${agents}${item(`${base}agents/`, "All agents →", undefined, "agents")}</nav>
    <div class="nav-label">Evidence</div>
    <nav class="nav">${evidence}</nav>
    <div class="side-foot">
      <a href="https://github.com/${esc(site.repo)}/issues/new?template=submit-use-case.yml">+ Submit a use case</a>
      <a href="${siteUrl}feed.xml">RSS feed</a>
      <a href="${siteUrl}cases.json">JSON API</a>
      <a href="https://github.com/${esc(site.repo)}/blob/main/docs/editorial-guidelines.md">How we curate</a>
    </div>
  </aside>`;
}

function rail() {
  return `<aside class="rail" aria-label="Highlights">
    ${highlightsPanel(cases)}
    ${statsPanel()}
    ${digestPanel()}
    ${sponsorPanel()}
    <p class="rail-foot">Updated ${esc(formatDate(buildDay))}. Summaries are AI-assisted and link to original creators.
      Outcomes are as reported by the source. <a href="https://github.com/${esc(site.repo)}">Open source</a>.</p>
  </aside>`;
}

function feedHTML(list, grouped) {
  if (!grouped) return list.map((c) => cardHTML(c, { base })).join("");
  let html = "";
  let day = null;
  for (const c of list) {
    if (c.added !== day) {
      day = c.added;
      html += `<h2 class="day">${esc(dayLabel(day, buildDay))}</h2>`;
    }
    html += cardHTML(c, { base });
  }
  return html;
}

function shell({ path: pagePath, title, description, h1, intro, active, list, body, jsonld, showHighlights = false }) {
  const canonical = siteUrl + pagePath;
  const data = list ? JSON.stringify({ cases: list, base, today: buildDay }).replace(/</g, "\\u003c") : null;
  return `${head({
    title,
    description,
    canonical,
    extra: jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : "",
  })}
<body>
<div class="shell">
  ${sidebar(active)}
  <main class="main">
    <div class="topbar">
      <div class="topbar-row">
        <button class="icon-btn menu-btn" data-menu aria-label="Open menu"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
        <label class="search"><span class="sr-only">Search use cases</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="search" type="search" placeholder="Search use cases, tools, agents…" autocomplete="off"${list ? "" : " disabled"}><kbd>/</kbd>
        </label>
        <button class="icon-btn" data-theme aria-label="Toggle light mode" title="Toggle light mode"><svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
      </div>
      ${
        list
          ? `<div class="tabs" role="tablist">
        <button class="tab" data-view="latest">Latest</button>
        <button class="tab" data-view="top">Top rated</button>
        <button class="tab" data-view="saved">Saved</button>
        <span class="result-count" id="result-count">${list.length} use cases</span>
      </div>
      <div class="active-filters" id="active-filters"></div>`
          : ""
      }
    </div>
    <div class="intro">
      <h1>${esc(h1)}</h1>
      ${intro ? `<p>${intro}</p>` : ""}
    </div>
    ${showHighlights ? `<div class="mobile-hl">${highlightsPanel(cases)}</div>` : ""}
    ${body ?? `<div class="feed" id="feed">${feedHTML(list.slice(0, 60), true)}</div>`}
  </main>
  ${rail()}
</div>
<dialog id="detail" aria-label="Use case details">
  <div class="dialog-close"><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <div id="detail-body"></div>
</dialog>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${data ? `<script id="cases-data" type="application/json">${data}</script>` : ""}
<script type="module" src="${base}assets/app.js"></script>
</body>
</html>
`;
}

const newToday = cases.filter((c) => c.added === cases[0]?.added);
const n = (k, word = "use case") => `${k} real ${word}${k === 1 ? "" : "s"}`;

function homePage() {
  return shell({
    path: "",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    h1: site.tagline,
    intro: `Real AI agent applications from across the web — explained in two sentences, tagged by agent and category, and linked to the original. ${n(cases.length)} and counting.`,
    active: "home",
    list: cases,
    showHighlights: true,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: site.name,
      url: siteUrl,
      description: site.description,
      potentialAction: { "@type": "SearchAction", target: `${siteUrl}?q={query}`, "query-input": "required name=query" },
    },
  });
}

function newPage() {
  const day = cases[0]?.added;
  return shell({
    path: "new/",
    title: `New AI agent use cases today · ${site.name}`,
    description: `The newest real-world AI agent applications, found fresh every day and listed day by day.`,
    h1: "New today",
    intro: day ? `${n(newToday.length)} added ${esc(dayLabel(day, buildDay).toLowerCase() === "today" ? "today" : `on ${formatDate(day)}`)}. Found fresh every day and listed day by day.` : "",
    active: "new",
    list: newToday,
  });
}

function domainPage(name) {
  const list = cases.filter((c) => c.domain === name);
  const d = DOMAIN_BY_NAME.get(name);
  return shell({
    path: `category/${slugify(name)}/`,
    title: `AI agents for ${name}: ${n(list.length)} · ${site.name}`,
    description: `${d.description} ${n(list.length)} of AI agents in ${name.toLowerCase()}, each linked to the original source.`,
    h1: `AI agents for ${name}`,
    intro: `${esc(d.description)} ${n(list.length)}.`,
    active: `domain:${name}`,
    list,
  });
}

function agentPage(name) {
  const list = cases.filter((c) => c.platform === name);
  return shell({
    path: `agents/${slugify(name)}/`,
    title: `${name} use cases: ${n(list.length, "example")} · ${site.name}`,
    description: `What people are actually doing with ${name}: ${n(list.length, "example")}, each explained briefly and linked to the original source.`,
    h1: `${name} use cases`,
    intro: `What people are actually doing with ${esc(name)} — ${n(list.length, "example")}.`,
    active: `agent:${name}`,
    list,
  });
}

function agentsIndexPage() {
  const tiles = platformCounts
    .map(([p, k]) => {
      const doms = [...new Set(cases.filter((c) => c.platform === p).map((c) => c.domain))].slice(0, 3).join(" · ");
      return `<a class="tile" href="${agentHref(p)}"><span class="tile-name">${esc(p)}</span><span class="tile-count">${n(k)}</span><span class="tile-sub">${esc(doms)}</span></a>`;
    })
    .join("");
  return shell({
    path: "agents/",
    title: `AI agents and what people do with them · ${site.name}`,
    description: `Browse ${platformCounts.length} AI agents and platforms — Claude Code, Codex, Devin, n8n and more — by the real use cases people have published.`,
    h1: "AI agents and what people do with them",
    intro: `${platformCounts.length} agents and platforms, ${n(cases.length)}.`,
    active: "agents",
    list: null,
    body: `<div class="tiles">${tiles}</div>`,
  });
}

// ---------- case page ----------
function casePage(c) {
  const url = `${siteUrl}case/${c.id}/`;
  const related = cases
    .filter((o) => o.id !== c.id && (o.domain === c.domain || o.platform === c.platform))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: c.title,
    description: c.summary,
    datePublished: c.added,
    isBasedOn: c.source.url,
    publisher: { "@type": "Organization", name: site.name, url: siteUrl },
    about: [c.platform, c.domain, ...c.tags],
  };
  return `${head({
    title: `${c.title} · ${site.name}`,
    description: c.summary,
    canonical: url,
    extra: `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>`,
  })}
<body>
<div class="page">
  <div class="page-top">
    <a class="brand" href="${base}" style="margin:0"><span class="logo">${LOGO}</span>${esc(site.name)}</a>
    <a class="btn-ghost" href="${base}">← All use cases</a>
  </div>
  ${detailHTML(c, { base })}
  ${
    related.length
      ? `<section class="related"><h2>Related use cases</h2>${related.map((r) => cardHTML(r, { base })).join("")}</section>`
      : ""
  }
</div>
</body>
</html>
`;
}

// ---------- feeds ----------
function rss() {
  const items = cases
    .slice(0, 50)
    .map(
      (c) => `<item>
  <title>${esc(c.title)}</title>
  <link>${siteUrl}case/${c.id}/</link>
  <guid isPermaLink="true">${siteUrl}case/${c.id}/</guid>
  <pubDate>${new Date(c.added + "T12:00:00Z").toUTCString()}</pubDate>
  <category>${esc(c.domain)}</category>
  <category>${esc(c.platform)}</category>
  <description>${esc(`${c.summary}${c.outcome ? ` ${c.outcome}` : ""} Original: ${c.source.url}`)}</description>
</item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(site.name)}</title>
<link>${siteUrl}</link>
<description>${esc(site.description)}</description>
<language>en</language>
${items}
</channel></rss>
`;
}

function sitemap() {
  const listings = ["new/", "agents/", ...[...domainCounts.keys()].map((d) => `category/${slugify(d)}/`), ...platformCounts.map(([p]) => `agents/${slugify(p)}/`)];
  const urls = [`<url><loc>${siteUrl}</loc><changefreq>daily</changefreq></url>`]
    .concat(listings.map((l) => `<url><loc>${siteUrl}${l}</loc><changefreq>daily</changefreq></url>`))
    .concat(
    cases.map((c) => `<url><loc>${siteUrl}case/${c.id}/</loc><lastmod>${c.added}</lastmod></url>`),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

// ---------- write ----------
await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, "assets"), { recursive: true });
await cp(path("site", "assets"), join(DIST, "assets"), { recursive: true });
const pages = { "index.html": homePage(), "new/index.html": newPage(), "agents/index.html": agentsIndexPage() };
for (const d of domainCounts.keys()) pages[`category/${slugify(d)}/index.html`] = domainPage(d);
for (const [p] of platformCounts) pages[`agents/${slugify(p)}/index.html`] = agentPage(p);
for (const [file, html] of Object.entries(pages)) {
  await mkdir(join(DIST, file, ".."), { recursive: true });
  await writeFile(join(DIST, file), html);
}
for (const c of cases) {
  await mkdir(join(DIST, "case", c.id), { recursive: true });
  await writeFile(join(DIST, "case", c.id, "index.html"), casePage(c));
}
await writeFile(join(DIST, "feed.xml"), rss());
await writeFile(join(DIST, "sitemap.xml"), sitemap());
await writeFile(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`);
await writeFile(join(DIST, "cases.json"), JSON.stringify({ generated: buildDay, count: cases.length, cases }, null, 2));
await writeFile(join(DIST, ".nojekyll"), "");
const host = new URL(siteUrl).hostname;
if (!host.endsWith("github.io") && host !== "localhost") await writeFile(join(DIST, "CNAME"), host + "\n");
await writeFile(
  join(DIST, "404.html"),
  `${head({ title: `Not found · ${site.name}`, description: site.description, canonical: siteUrl })}<body><div class="page"><h1>Page not found</h1><p><a href="${base}">Back to all use cases</a></p></div></body></html>`,
);

console.log(`Built ${cases.length} use cases, ${Object.keys(pages).length} listing pages → dist/ (base ${base})`);
