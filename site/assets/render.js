// Shared rendering helpers, used by the browser (app.js) and by the static
// build (scripts/build.mjs) so pre-rendered and live HTML are identical.

let CONF = { base: "/", index: "", today: "", platforms: {}, repo: "" };
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

/** Two-letter agent mark, as in the sidebar and list items. */
export function badge(name, size = "md") {
  const m = platformMeta(name);
  const hollow = m.color === "transparent";
  return `<span class="mark mark-${size}${hollow ? " mark-hollow" : ""}" aria-hidden="true"${hollow ? "" : ` style="background-color:${m.color}"`}>${esc(m.abbr)}</span>`;
}

function dot(name) {
  const m = platformMeta(name);
  return `<span class="dot${m.color === "transparent" ? " dot-hollow" : ""}" aria-hidden="true"${m.color === "transparent" ? "" : ` style="background-color:${m.color}"`}></span>`;
}

const ICON = {
  save: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.25 2.75h7.5a.5.5 0 0 1 .5.5v10.2L8 11.1 3.75 13.45V3.25a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
export { ICON };

function metaLine(c) {
  const isNew = c.added === CONF.today;
  const bits = [esc(c.source.name), c.source.published ? monthYear(c.source.published) : ""].filter(Boolean).join(" · ");
  return `<div class="meta">
    <a class="meta-agent" href="${agentHref(c.platform)}" title="More ${esc(c.platform)} use cases">${dot(c.platform)}${esc(c.platform)}</a>
    <span class="meta-rest">${isNew ? '<span class="signal">New · </span>' : ""}${bits}</span>
  </div>`;
}

function actions(c, saved) {
  return `<div class="actions">
    <button type="button" class="btn-sm" data-open="${esc(c.id)}">Details</button>
    <span class="share-wrap"><button type="button" class="btn-sm" data-share="${esc(c.id)}" aria-haspopup="menu" aria-expanded="false">Share</button></span>
    <a class="btn-sm" href="${esc(c.source.url)}" target="_blank" rel="noopener">Original ${ICON.ext}</a>
  </div>`;
}

function saveButton(c, saved) {
  return `<div class="side-actions">
    <button type="button" class="save${saved ? " is-on" : ""}" data-save="${esc(c.id)}" aria-pressed="${saved}" aria-label="Save: ${esc(c.title)}">${ICON.save}<span>${saved ? "Saved" : "Save"}</span></button>
  </div>`;
}

/** A use case in a list (latest finds, topic sections, category pages). */
export function itemHTML(c, { saved = false, showOutcome = false } = {}) {
  return `<li class="item" data-id="${esc(c.id)}">
  ${badge(c.platform)}
  <div class="item-body">
    <h3 class="item-title"><a href="${caseHref(c)}" data-open="${esc(c.id)}">${esc(c.title)}</a></h3>
    <p class="item-summary${showOutcome ? " no-clamp" : ""}">${esc(c.summary)}</p>
    ${showOutcome && c.outcome ? `<p class="how"><span class="label">How it went</span> ${esc(c.outcome)}</p>` : ""}
    ${metaLine(c)}
    ${actions(c, saved)}
  </div>
  ${saveButton(c, saved)}
</li>`;
}

/** A compact card for the "Top picks" grid. */
export function tileHTML(c) {
  return `<li class="tile" data-id="${esc(c.id)}">
  <div class="tile-top">${badge(c.platform, "sm")}<span>${esc(c.platform)}</span></div>
  <h3 class="tile-title"><a href="${caseHref(c)}" data-open="${esc(c.id)}">${esc(c.title)}</a></h3>
  <div class="tile-actions"><span class="share-wrap"><button type="button" class="btn-sm" data-share="${esc(c.id)}" aria-haspopup="menu" aria-expanded="false">Share</button></span></div>
</li>`;
}

export function detailHTML(c, { heading = "h2" } = {}) {
  const row = (label, value) => (value ? `<div class="d-row"><dt>${label}</dt><dd>${value}</dd></div>` : "");
  const H = heading;
  return `<article class="detail">
  <p class="eyebrow"><a href="${agentHref(c.platform)}">${esc(c.platform)}</a> · <a href="${categoryHref(c.domain)}">${esc(c.domain)}</a></p>
  <${H} class="detail-title">${esc(c.title)}</${H}>
  <p class="detail-lead">${esc(c.summary)}</p>
  ${c.outcome ? `<p class="how how-lg"><span class="label">How it went</span> ${esc(c.outcome)}</p>` : ""}
  <dl class="d-grid">
    ${row("What the agent did", esc(c.agent_role))}
    ${row("Agent", `<a class="meta-agent" href="${agentHref(c.platform)}">${dot(c.platform)}${esc(c.platform)}</a>`)}
    ${row("Model", esc(c.model || "Not specified"))}
    ${row("Tools", c.tools.length ? c.tools.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ") : "")}
    ${row("Evidence", esc(c.evidence))}
    ${row("Difficulty", esc(c.difficulty))}
    ${row("Tags", c.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join(" "))}
    ${row(
      "Source",
      `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)} · ${esc(hostOf(c.source.url))}</a>${
        c.source.author ? ` · ${esc(c.source.author)}` : ""
      }${c.source.published ? ` · ${formatDate(c.source.published)}` : ""}`,
    )}
    ${row("Added", formatDate(c.added))}
  </dl>
  <div class="detail-actions">
    <a class="btn-primary" href="${esc(c.source.url)}" target="_blank" rel="noopener">Read the original ${ICON.ext}</a>
    <a class="btn-outline" href="${caseHref(c)}">Permalink</a>
    <span class="share-wrap"><button type="button" class="btn-outline" data-share="${esc(c.id)}" aria-haspopup="menu" aria-expanded="false">Share</button></span>
  </div>
  <p class="fineprint">Summary written with AI assistance from the original post and checked against our
  <a href="https://github.com/${esc(CONF.repo)}/blob/main/docs/editorial-guidelines.md">editorial guidelines</a>.
  Outcomes are as reported by the source, not independently verified.</p>
</article>`;
}
