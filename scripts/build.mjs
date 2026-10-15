// Builds the static site into dist/:
//   /                      home: sidebar, top picks, latest finds, topic sections
//   /new/                  everything, day by day
//   /agents/  /agents/x/   browse by agent
//   /category/x/           browse by category
//   /use-case/x/           one page per use case
//   feed.xml, sitemap.xml, cases.json, robots.txt
//
//   SITE_URL=http://localhost:4173/ npm run build   # override the public URL
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCases, sortCases } from "./lib/cases.mjs";
import { taxonomy } from "./lib/taxonomy.mjs";
import { path, readJSON, today } from "./lib/util.mjs";
import {
  configure, href, esc, formatDate, dayLabel, slug, badge, itemHTML, tileHTML, detailHTML,
  caseHref, agentHref, categoryHref, ICON,
} from "../site/assets/render.js";

const site = await readJSON(path("config", "site.json"));
const siteUrl = (process.env.SITE_URL || site.url).replace(/\/?$/, "/");
const PREVIEW = process.env.PREVIEW === "1"; // relative links, for hosting as plain files
const ABS_BASE = new URL(siteUrl).pathname; // e.g. "/delegated2ai/"
let base = ABS_BASE;
const DIST = path("dist");

const { cases: all, errors } = await loadCases();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const cases = sortCases(all.filter((c) => c.status === "published")).map(({ _file, curation, status, ...c }) => c);
const buildDay = today();
const latestDay = cases[0]?.added || buildDay;

const platforms = Object.fromEntries(taxonomy.platforms.map((p) => [p.name, { abbr: p.abbr, color: p.color }]));
const platformInfo = new Map(taxonomy.platforms.map((p) => [p.name, p]));
const domainInfo = new Map(taxonomy.domains.map((d) => [d.name, d]));
configure({ base, index: PREVIEW ? "index.html" : "", today: latestDay, platforms, repo: site.repo });

const countBy = (key) => {
  const m = new Map();
  for (const c of cases) m.set(c[key], (m.get(c[key]) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const agentCounts = countBy("platform");
const domainCounts = countBy("domain");
const newest = cases.filter((c) => c.added === latestDay);
const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const issueUrl = (template, title = "") =>
  `https://github.com/${site.repo}/issues/new?template=${template}${title ? `&title=${encodeURIComponent(title)}` : ""}`;
const digestHref = site.newsletter?.action || `${siteUrl}feed.xml`;

// ---------- shared fragments ----------
// Logo: a 6×6 pixel grid with an arrow picked out — work handed off.
function logoSVG(cls = "logo-mark") {
  const shaft = "#5aabff", mid = "#a78bfa", tip = "#f472b6";
  const on = {
    "0,2": shaft, "0,3": shaft, "1,2": shaft, "1,3": shaft, "2,2": "#7c9cff", "2,3": "#7c9cff",
    "3,0": mid, "3,2": mid, "3,3": mid, "3,5": mid, "4,1": "#e879f9", "4,2": "#e879f9", "4,3": "#e879f9", "4,4": "#e879f9",
    "5,2": tip, "5,3": tip,
  };
  let rects = "";
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) {
      const fill = on[`${x},${y}`];
      rects += `<rect x="${x * 10}" y="${y * 10}" width="8" height="8" rx="1.5" ${fill ? `fill="${fill}"` : 'fill="currentColor" opacity="0.18"'}/>`;
    }
  return `<svg class="${cls}" viewBox="0 0 58 58" aria-hidden="true">${rects}</svg>`;
}
const wordmark = `<span class="wordmark">delegated<span class="tld">.ai</span></span>`;
const themeButton = `<button type="button" class="theme-btn" data-theme aria-label="Switch theme" title="Switch theme">
  <svg class="icon-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
  <svg class="icon-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.75" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
</button>`;

function head({ title, description, canonical, jsonld }) {
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
<meta name="theme-color" content="#000000">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}: new use cases" href="${siteUrl}feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@400;500;600&family=Funnel+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}assets/style.css">
<script>try{var t=JSON.parse(localStorage.getItem("dlg.theme"));document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
${analytics}
</head>`;
}

function pageData(list) {
  return `<script id="page-data" type="application/json">${JSON.stringify({ cases: list, base, today: latestDay, platforms, repo: site.repo }).replace(/</g, "\\u003c")}</script>`;
}

const dialogAndScripts = (list) => `<dialog id="detail" aria-label="Use case details">
  <div class="dialog-bar"><button type="button" class="theme-btn" data-close aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button></div>
  <div class="dialog-body" id="detail-body"></div>
</dialog>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${pageData(list)}
<script type="module" src="${base}assets/app.js"></script>`;

function promoCard() {
  if (site.sponsor) {
    const s = site.sponsor;
    return `<div class="promo"><p class="mono-label">Sponsor</p><strong>${esc(s.name)}</strong>${esc(s.text)}<br><a class="more" href="${esc(s.url)}" rel="sponsored noopener" target="_blank">${esc(s.cta || "Learn more")} ↗</a></div>`;
  }
  return `<div class="promo"><p class="mono-label">Advertise</p><strong>Your product here</strong>Reach people who build and buy AI agents, every day.<br><a class="more" href="${issueUrl("sponsor.yml", "[sponsor] ")}">Sponsor ${esc(site.name)} ↗</a></div>`;
}

function sidebar({ activeAgent, activeDomain } = {}) {
  const agentRow = ([name, n]) =>
    `<a href="${agentHref(name)}"${activeAgent === name ? ' class="is-active"' : ""}>${badge(name, "sm")}<span>${esc(name)}</span><span class="n">${n}</span></a>`;
  const domainRow = ([name, n]) =>
    `<a href="${categoryHref(name)}"${activeDomain === name ? ' class="is-active"' : ""}><span>${esc(name)}</span><span class="n">${n}</span></a>`;
  return `<aside class="sidebar">
  <a href="${href()}" aria-label="${esc(site.name)} home">${logoSVG()}</a>
  <div class="brand-row"><h1><a href="${href()}">${logoSVG("logo-inline")}${wordmark}</a></h1>${themeButton}</div>
  <p class="tagline">${esc(site.tagline)}</p>
  <div class="side-ctas">
    <a class="btn-primary" href="${esc(digestHref)}">Get the daily digest</a>
    <a class="btn-outline" href="${issueUrl("submit-use-case.yml")}">Submit a use case</a>
  </div>
  <button type="button" class="filter-toggle" data-filters aria-expanded="false">Filter <span>Agents · Categories</span></button>
  <a class="new-today" href="${href("new/")}"><span><span class="pulse"></span>New ${esc(dayLabel(latestDay, buildDay) === "Today" ? "today" : dayLabel(latestDay, buildDay).toLowerCase())}</span><span class="n">${newest.length}</span></a>
  ${promoCard()}
  <div class="side-lists">
    <section class="side-section">
      <div class="side-head"><h2 class="mono-label">Agents</h2><a href="${href("agents/")}">All agents</a></div>
      <nav class="side-list">${agentCounts.slice(0, 10).map(agentRow).join("")}${
        agentCounts.length > 10 ? `<a class="show-all" href="${href("agents/")}">Show all ${agentCounts.length}</a>` : ""
      }</nav>
    </section>
    <section class="side-section">
      <div class="side-head"><h2 class="mono-label">Categories</h2></div>
      <nav class="side-list">${domainCounts.map(domainRow).join("")}</nav>
    </section>
  </div>
  <div class="side-foot">
    <b>${plural(cases.length, "use case")}</b><br>
    Updated ${esc(formatDate(buildDay))}<br>
    Sources: the open web, X, Reddit, Hacker News, GitHub
    <nav><a href="${href("agents/")}">Agents</a><a href="${href("new/")}">New</a><a href="https://github.com/${esc(site.repo)}/blob/main/docs/editorial-guidelines.md">How we curate</a><a href="${siteUrl}feed.xml">RSS feed</a><a href="${issueUrl("sponsor.yml", "[sponsor] ")}">Sponsor</a></nav>
  </div>
</aside>`;
}

// ---------- home ----------
function homePage() {
  const picks = [...cases].sort((a, b) => b.score - a.score || b.added.localeCompare(a.added)).slice(0, 9);
  const latest = newest.length >= 3 ? newest : cases.slice(0, 8);
  const topicSections = domainCounts
    .map(([name, n], i) => {
      const list = cases.filter((c) => c.domain === name).sort((a, b) => b.score - a.score).slice(0, 5);
      return `<section class="section">
  <div class="section-head"><span class="num">${String(i + 1).padStart(2, "0")}</span><h2><a href="${categoryHref(name)}">${esc(name)}</a></h2><span class="kind">Topic</span><span class="blurb">${esc(domainInfo.get(name).blurb)}</span></div>
  <ul class="items">${list.map((c) => itemHTML(c)).join("")}</ul>
  ${n > list.length ? `<a class="see-all" href="${categoryHref(name)}">All ${n} ${esc(name)} use cases ${ICON.ext}</a>` : ""}
</section>`;
    })
    .join("");

  return `${head({
    title: `${site.name}: ${site.tagline}`,
    description: site.description,
    canonical: siteUrl,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: site.name,
      url: siteUrl,
      description: site.description,
      potentialAction: { "@type": "SearchAction", target: `${siteUrl}?q={query}`, "query-input": "required name=query" },
    },
  })}
<body>
<div class="frame frame-grid">
${sidebar()}
<main class="main">
  <div class="toolbar">
    <div class="toolbar-row">
      <label class="search"><span class="sr-only">Search use cases</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <input id="search" type="search" placeholder="Search use cases" autocomplete="off"><span class="kbd">⌘K</span>
      </label>
      <div class="seg" role="group" aria-label="Sort"><button type="button" class="is-on" data-sort="top">Top</button><button type="button" data-sort="new">New</button></div>
    </div>
    <div class="chips">
      <button type="button" class="chip-btn is-on" data-chip="all">All ${cases.length}</button>
      <button type="button" class="chip-btn" data-chip="week">New this week ${cases.filter((c) => c.added >= weekStart()).length}</button>
      <button type="button" class="chip-btn" data-chip="saved">Saved 0</button>
    </div>
  </div>
  <div id="results" hidden></div>
  <div id="sections">
    <section class="section">
      <h2 class="mono-label" style="margin-bottom:12px">Top picks</h2>
      <ul class="tiles">${picks.map(tileHTML).join("")}</ul>
    </section>
    <section class="section">
      <div class="signal-panel">
        <div class="signal-head">
          <div><h2>${plural(latest.length, "new use case")}</h2><p>${esc(dayLabel(latestDay, buildDay))} · a few of them below</p></div>
          <p class="mono-label">Latest finds</p>
        </div>
        <ul class="items">${latest.slice(0, 8).map((c) => itemHTML(c)).join("")}</ul>
        <a class="see-all" href="${href("new/")}">See all, day by day ${ICON.ext}</a>
      </div>
    </section>
    ${topicSections}
  </div>
</main>
</div>
${dialogAndScripts(cases)}
</body>
</html>
`;
}

function weekStart() {
  const d = new Date(latestDay + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

// ---------- narrow pages ----------
function narrowPage({ path: pagePath, title, description, body, list, jsonld }) {
  return `${head({ title, description, canonical: siteUrl + pagePath, jsonld })}
<body>
<div class="frame frame-narrow">
  <header class="topnav">
    <a class="brand" href="${href()}">${logoSVG("")}${wordmark}</a>
    <div class="topnav-right">${themeButton}<a class="count" href="${href()}">All ${cases.length.toLocaleString("en-US")} use cases</a></div>
  </header>
  <main class="page">${body}</main>
</div>
${dialogAndScripts(list)}
</body>
</html>
`;
}

const itemList = (list) => `<ul class="items">${list.map((c) => itemHTML(c, { showOutcome: true })).join("")}</ul>`;

function topAgentsSentence(list) {
  const named = list.filter((c) => !["Custom agent", "Not specified"].includes(c.platform));
  const counts = new Map();
  for (const c of named) counts.set(c.platform, (counts.get(c.platform) || 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
  const custom = list.length - named.length;
  if (!named.length) return "";
  const joined = top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : top[0];
  const agents = counts.size === 1 ? top[0] : `${plural(counts.size, "named agent")}, most often ${joined}`;
  return ` ${named.length} ${named.length === 1 ? "was" : "were"} done with ${agents}${
    custom ? `; ${custom} with custom-built or unnamed ones` : ""
  }.`;
}

function categoryPage(name) {
  const list = cases.filter((c) => c.domain === name).sort((a, b) => b.score - a.score);
  const agents = new Set(list.map((c) => c.platform));
  return narrowPage({
    path: `category/${slug(name)}/`,
    title: `AI agents for ${name}: ${plural(list.length, "real use case")} · ${site.name}`,
    description: `${domainInfo.get(name).blurb} ${plural(list.length, "real use case")}, each linked to its source.`,
    list,
    body: `<p class="eyebrow">Categories</p>
<h1 class="page-title">AI agents for ${esc(name)}: ${plural(list.length, "real use case")}</h1>
<p class="page-lead">${esc(domainInfo.get(name).blurb)} ${plural(list.length, "real use case")}.${esc(topAgentsSentence(list))} Each links to its source.</p>
<p class="page-stats">${plural(list.length, "use case")} · ${plural(agents.size, "agent")} · Updated ${esc(formatDate(buildDay))}</p>
<h2 class="list-head">All ${list.length} ${esc(name)} use cases</h2>
${itemList(list)}`,
  });
}

function agentPage(name) {
  const list = cases.filter((c) => c.platform === name).sort((a, b) => b.score - a.score);
  const info = platformInfo.get(name);
  const doms = countByIn(list, "domain").map(([d]) => d.toLowerCase());
  return narrowPage({
    path: `agents/${slug(name)}/`,
    title: `${name} use cases: ${plural(list.length, "real example")} · ${site.name}`,
    description: `What people are actually doing with ${name}: ${plural(list.length, "real example")}, each explained briefly and linked to the original.`,
    list,
    body: `<p class="eyebrow"><a href="${href("agents/")}">Agents</a></p>
<h1 class="page-title">${esc(name)} use cases: ${plural(list.length, "real example")}</h1>
<p class="page-lead">${esc(info?.description || "")} Here is what people have got it to do.</p>
<p class="page-stats">${plural(list.length, "use case")}${doms.length ? ` · Most often: ${esc(doms.slice(0, 3).join(" · "))}` : ""} · Updated ${esc(formatDate(buildDay))}</p>
<h2 class="list-head">All ${list.length} ${esc(name)} use cases</h2>
${itemList(list)}`,
  });
}

function countByIn(list, key) {
  const m = new Map();
  for (const c of list) m.set(c[key], (m.get(c[key]) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

function agentsIndexPage() {
  const rows = agentCounts
    .map(([name, n]) => {
      const doms = countByIn(cases.filter((c) => c.platform === name), "domain").slice(0, 3).map(([d]) => d.toLowerCase());
      return `<div class="agent-row">${badge(name)}<div class="body"><a class="name" href="${agentHref(name)}">${esc(name)}</a>
        <p class="desc">${esc(platformInfo.get(name)?.description || "")}</p>
        <p class="often">Most often: ${esc(doms.join(" · "))}</p></div><span class="n">${n}</span></div>`;
    })
    .join("");
  return narrowPage({
    path: "agents/",
    title: `AI agents, and what people do with them · ${site.name}`,
    description: `Browse ${agentCounts.length} AI agents and platforms by the real use cases people have published.`,
    list: [],
    body: `<p class="eyebrow">Browse by agent</p>
<h1 class="page-title">AI agents, and what people do with them</h1>
<p class="page-lead">${plural(agentCounts.length, "agent")} and ${plural(cases.length, "real use case")}. Pick one to see what people have got it to do.</p>
<div class="agent-rows">${rows}</div>`,
  });
}

function newPage() {
  let body = "";
  let day = null;
  for (const c of cases) {
    if (c.added !== day) {
      if (day) body += "</ul>";
      day = c.added;
      const n = cases.filter((x) => x.added === day).length;
      body += `<h2 class="list-head">${esc(dayLabel(day, buildDay))} · ${plural(n, "use case")}</h2><ul class="items">`;
    }
    body += itemHTML(c, { showOutcome: true });
  }
  if (day) body += "</ul>";
  return narrowPage({
    path: "new/",
    title: `New AI agent use cases, day by day · ${site.name}`,
    description: "The newest real-world AI agent applications, found fresh every day and listed day by day.",
    list: cases,
    body: `<p class="eyebrow">New</p>
<h1 class="page-title">New use cases, day by day</h1>
<p class="page-lead">Found fresh every day across the web, checked, and summarised in two sentences. ${plural(newest.length, "use case")} added ${
      dayLabel(latestDay, buildDay) === "Today" ? "today" : `on ${formatDate(latestDay)}`
    }.</p>
${body}`,
  });
}

function casePage(c) {
  const related = cases
    .filter((o) => o.id !== c.id && (o.domain === c.domain || o.platform === c.platform))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  return narrowPage({
    path: `use-case/${c.id}/`,
    title: `${c.title} · ${site.name}`,
    description: c.summary,
    list: [c, ...related],
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: c.title,
      description: c.summary,
      datePublished: c.added,
      isBasedOn: c.source.url,
      publisher: { "@type": "Organization", name: site.name, url: siteUrl },
      about: [c.platform, c.domain, ...c.tags],
    },
    body: `${detailHTML(c, { heading: "h1" })}
${related.length ? `<section class="related"><h2 class="list-head">Related use cases</h2><ul class="items">${related.map((r) => itemHTML(r)).join("")}</ul></section>` : ""}`,
  });
}

// ---------- feeds ----------
function rss() {
  const items = cases
    .slice(0, 50)
    .map(
      (c) => `<item>
  <title>${esc(c.title)}</title>
  <link>${siteUrl}use-case/${c.id}/</link>
  <guid isPermaLink="true">${siteUrl}use-case/${c.id}/</guid>
  <pubDate>${new Date(c.added + "T12:00:00Z").toUTCString()}</pubDate>
  <category>${esc(c.domain)}</category>
  <category>${esc(c.platform)}</category>
  <description>${esc(`${c.summary}${c.outcome ? ` ${c.outcome}` : ""} Original: ${c.source.url}`)}</description>
</item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(site.name)}: new use cases</title>
<link>${siteUrl}</link>
<description>${esc(site.description)}</description>
<language>en</language>
${items}
</channel></rss>
`;
}

// ---------- write ----------
const renderers = {
  "index.html": homePage,
  "new/index.html": newPage,
  "agents/index.html": agentsIndexPage,
};
for (const [d] of domainCounts) renderers[`category/${slug(d)}/index.html`] = () => categoryPage(d);
for (const [p] of agentCounts) renderers[`agents/${slug(p)}/index.html`] = () => agentPage(p);
for (const c of cases) renderers[`use-case/${c.id}/index.html`] = () => casePage(c);
renderers["404.html"] = () =>
  narrowPage({ path: "404.html", title: `Not found · ${site.name}`, description: site.description, list: [], body: `<h1 class="page-title">Page not found</h1><p class="page-lead"><a href="${href()}">Back to all use cases</a></p>` });

const pages = {};
for (const [file, render] of Object.entries(renderers)) {
  if (PREVIEW) {
    base = "../".repeat(file.split("/").length - 1) || "./";
    configure({ base });
  }
  pages[file] = render();
}

await rm(DIST, { recursive: true, force: true });
await cp(path("site", "assets"), join(DIST, "assets"), { recursive: true });
for (const [file, html] of Object.entries(pages)) {
  await mkdir(join(DIST, file, ".."), { recursive: true });
  await writeFile(join(DIST, file), html);
}
const urls = Object.keys(pages).filter((f) => f !== "404.html").map((f) => siteUrl + f.replace(/index\.html$/, ""));
await writeFile(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`,
);
await writeFile(join(DIST, "feed.xml"), rss());
await writeFile(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`);
await writeFile(join(DIST, "cases.json"), JSON.stringify({ generated: buildDay, count: cases.length, cases }, null, 2));
await writeFile(join(DIST, ".nojekyll"), "");
const host = new URL(siteUrl).hostname;
if (!host.endsWith("github.io") && host !== "localhost") await writeFile(join(DIST, "CNAME"), host + "\n");

console.log(`Built ${cases.length} use cases into ${Object.keys(pages).length} pages → dist/ (${PREVIEW ? "preview, relative links" : `base ${ABS_BASE}`})`);
