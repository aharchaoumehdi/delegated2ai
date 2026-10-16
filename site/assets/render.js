// Shared rendering helpers, used by the browser (app.js) and by the static
// build (scripts/build.mjs) so pre-rendered and live HTML are identical.

let CONF = { base: "/", index: "", today: "", platforms: {}, logos: {}, repo: "", unnamed: ["Custom agent", "Other"] };
export function configure(conf) {
  CONF = { ...CONF, ...conf };
}

export function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}

export function monthYear(iso) {
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function dayLabel(iso, todayIso = CONF.today) {
  if (iso === todayIso) return "Today";
  const t = new Date(todayIso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  if (iso === t.toISOString().slice(0, 10)) return "Yesterday";
  return formatDate(iso);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function platformMeta(name) {
  const known = CONF.platforms[name];
  if (known) return known;
  const abbr = String(name).replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "··";
  return { abbr, color: "transparent" };
}

// `index` is "index.html" in the self-contained preview build, where folders don't resolve.
export const href = (p = "") => `${CONF.base}${p}${p === "" || p.endsWith("/") ? CONF.index : ""}`;
export const caseHref = (c) => href(`use-case/${c.id}/`);
export const agentHref = (name) => href(`agents/${slug(name)}/`);
export const categoryHref = (name) => href(`category/${slug(name)}/`);

/** Agent mark, as in the sidebar and list items: the product's logo on a light tile when we
 *  have one (assets/agents/, config/agent-logos.json), otherwise a two-letter badge. */
export function badge(name, size = "md") {
  const logo = CONF.logos?.[name];
  if (logo)
    return `<span class="mark mark-${size} mark-logo" aria-hidden="true"><img src="${CONF.base}assets/agents/${esc(logo)}.svg" alt="" width="14" height="14" loading="lazy" decoding="async"></span>`;
  const m = platformMeta(name);
  const hollow = m.color === "transparent";
  return `<span class="mark mark-${size}${hollow ? " mark-hollow" : ""}" aria-hidden="true"${hollow ? "" : ` style="background-color:${m.color}"`}>${esc(m.abbr)}</span>`;
}

function dot(name) {
  const m = platformMeta(name);
  return `<span class="dot${m.color === "transparent" ? " dot-hollow" : ""}" aria-hidden="true"${m.color === "transparent" ? "" : ` style="background-color:${m.color}"`}></span>`;
}

// A prompt with its [placeholders] marked, so it's clear what to fill in.
const promptHTML = (text) => esc(text).replace(/\[[^\]\n]{1,80}\]/g, (m) => `<span class="ph">${m}</span>`);

const ICON = {
  code: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  save: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.25 2.75h7.5a.5.5 0 0 1 .5.5v10.2L8 11.1 3.75 13.45V3.25a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 13.2 12.4H2.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
};
export { ICON };

/** Upvote counts, filled in by the browser (from the votes service or this browser's own votes). */
export const voteCount = (n) => (n > 0 ? String(n) : "");

function metaLine(c) {
  const isNew = c.added === CONF.today;
  const bits = [esc(c.source.name), c.source.published ? monthYear(c.source.published) : ""].filter(Boolean).join(" · ");
  return `<div class="meta">
    <a class="meta-agent" href="${agentHref(c.platform)}" title="More ${esc(c.platform)} use cases">${dot(c.platform)}${esc(c.platform)}</a>
    <span class="meta-rest">${isNew ? '<span class="signal">New</span> · ' : ""}${bits}</span>
  </div>`;
}

const shareButton = (c, cls = "btn-sm") =>
  `<span class="share-wrap"><button type="button" class="${cls}" data-share="${esc(c.id)}" aria-haspopup="menu" aria-expanded="false">Share</button></span>`;

function voteButton(c) {
  return `<button type="button" class="vote" data-vote="${esc(c.id)}" aria-pressed="false" aria-label="Upvote: ${esc(c.title)}">${ICON.up}<span class="vote-n" data-vote-n="${esc(c.id)}"></span></button>`;
}

function saveButton(c) {
  return `<button type="button" class="save" data-save="${esc(c.id)}" aria-pressed="false" aria-label="Save: ${esc(c.title)}">${ICON.save}<span>Save</span></button>`;
}

/** A use case in a list (latest finds, topic sections, agent and category pages). */
export function itemHTML(c) {
  return `<li class="item" data-id="${esc(c.id)}">
  ${badge(c.platform)}
  <div class="item-body">
    <h3 class="item-title"><a href="${caseHref(c)}" data-open="${esc(c.id)}">${esc(c.title)}</a></h3>
    <p class="item-summary">${esc(c.summary)}</p>
    ${metaLine(c)}
    <div class="actions"><button type="button" class="btn-sm" data-open="${esc(c.id)}">View prompt</button>${shareButton(c)}</div>
  </div>
  <div class="side-actions">${voteButton(c)}${saveButton(c)}</div>
</li>`;
}

/** A compact related-use-case row, as under a use case. */
export function relatedHTML(c) {
  return `<li class="item item-compact" data-id="${esc(c.id)}">
  ${badge(c.platform)}
  <div class="item-body">
    <h3 class="item-title"><a href="${caseHref(c)}">${esc(c.title)}</a></h3>
    <p class="item-summary">${esc(c.summary)}</p>
    <div class="meta"><span class="meta-agent">${dot(c.platform)}${esc(c.platform)}</span></div>
  </div>
</li>`;
}

/** A card for the "Trending today" grid. */
export function tileHTML(c) {
  return `<li class="tile" data-id="${esc(c.id)}">
  <div class="tile-votes">${ICON.up}<span data-vote-n="${esc(c.id)}"></span></div>
  <h3 class="tile-title"><a href="${caseHref(c)}" data-open="${esc(c.id)}">${esc(c.title)}</a></h3>
  <div class="tile-actions">${shareButton(c)}</div>
</li>`;
}

/** Ranks use cases for "Trending today": votes in the last day, then all-time votes, then the editor's order. */
export function trendingOrder(list, counts = {}) {
  const pos = new Map(list.map((c, i) => [c.id, i]));
  const v = (c) => counts[c.id] || [0, 0];
  return [...list].sort((a, b) => v(b)[1] - v(a)[1] || v(b)[0] - v(a)[0] || pos.get(a.id) - pos.get(b.id));
}

const para = (text) => `<p>${esc(text)}</p>`;

/** The full write-up, used on the use-case page and in the "View prompt" dialog. */
export function detailHTML(c, { heading = "h2" } = {}) {
  const H = heading;
  const did = c.what_they_did || c.agent_role;
  const went = c.how_it_went ?? c.outcome;
  const named = !CONF.unnamed.includes(c.platform);
  const date = c.source.published ? formatDate(c.source.published) : "";
  return `<article class="detail">
  <p class="eyebrow"><a href="${categoryHref(c.domain)}">${esc(c.domain)}</a></p>
  <${H} class="detail-title">${esc(c.title)}</${H}>
  <p class="detail-lead">${esc(c.summary)}</p>
  <p class="done-with">Done with <a class="agent-chip" href="${agentHref(c.platform)}">${badge(c.platform, "sm")}${esc(c.platform)}</a>${
    c.model ? `<span class="model-note">${esc(c.model)}</span>` : ""
  }</p>
  <div class="writeup">
    ${did ? `<h3 class="mono-label">What they did</h3>${para(did)}` : ""}
    ${went ? `<h3 class="mono-label">How it went</h3>${para(went)}` : ""}
    ${c.worth_knowing ? `<h3 class="mono-label">Worth knowing</h3>${para(c.worth_knowing)}` : ""}
  </div>
  ${
    c.prompt
      ? `<div class="try">
    <div class="try-head"><p><b>Try it yourself</b>${named ? ` with ${esc(c.platform)}` : ""}</p><button type="button" class="prompt-pill" data-copy-prompt="${esc(c.id)}">${ICON.code}<span aria-live="polite">Copy prompt</span></button></div>
    <pre class="prompt">${promptHTML(c.prompt)}</pre>${/\[[^\]\n]{1,80}\]/.test(c.prompt) ? `<p class="try-hint">Swap the <span class="ph-key">highlighted [parts]</span> for your own details.</p>` : ""}
  </div>`
      : ""
  }
  <div class="detail-actions">
    <a class="btn-primary" href="${esc(c.source.url)}" target="_blank" rel="noopener">Read the original ${ICON.ext}</a>
    <button type="button" class="btn-outline vote-wide" data-vote="${esc(c.id)}" aria-pressed="false">${ICON.up}<span>I want this</span><span class="vote-sep" data-vote-sep="${esc(c.id)}"> · </span><span data-vote-n="${esc(c.id)}"></span></button>
    <button type="button" class="btn-outline save-wide" data-save="${esc(c.id)}" aria-pressed="false"><span>Save</span></button>
    ${shareButton(c, "btn-outline")}
  </div>
  <p class="source-line">Source: <a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)}</a>${
    c.source.author ? ` · ${esc(c.source.author)}` : ""
  }${date ? ` · ${date}` : ""}</p>
  <p class="fineprint">Written with AI assistance from the original post and checked against our
  <a href="https://github.com/${esc(CONF.repo)}/blob/main/docs/editorial-guidelines.md">editorial guidelines</a>.
  Results are as reported by the source, not independently verified.</p>
</article>`;
}
