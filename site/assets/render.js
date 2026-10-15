// Shared rendering helpers, used by the browser (app.js) and by the static
// build (scripts/build.mjs) so pre-rendered and live HTML are identical.

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

export function dayLabel(iso, todayIso) {
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

const EVIDENCE_CLASS = {
  "Author's account": "ev-claim",
  Demo: "ev-demo",
  "Code available": "ev-code",
  Paper: "ev-paper",
  "Independent report": "ev-indep",
};

export const ICONS = {
  bookmark:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
  outcome: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>',
};

export function cardHTML(c, { base = "/", saved = false } = {}) {
  const author = c.source.author ? ` · ${esc(c.source.author)}` : "";
  return `<article class="card${c.featured ? " is-featured" : ""}" data-id="${esc(c.id)}">
  <div class="card-meta">
    <span class="pill pill-platform">${esc(c.platform)}</span>
    <span class="pill pill-domain">${esc(c.domain)}</span>
    <span class="ev ${EVIDENCE_CLASS[c.evidence] || ""}" title="Evidence: ${esc(c.evidence)}">${esc(c.evidence)}</span>
    ${c.featured ? '<span class="pill pill-featured">Editor’s pick</span>' : ""}
  </div>
  <h3 class="card-title"><a href="${base}case/${esc(c.id)}/" data-open="${esc(c.id)}">${esc(c.title)}</a></h3>
  <p class="card-summary">${esc(c.summary)}</p>
  ${c.outcome ? `<p class="card-outcome">${ICONS.outcome}<span>${esc(c.outcome)}</span></p>` : ""}
  <div class="card-foot">
    <span class="card-source">via <strong>${esc(c.source.name)}</strong>${author}</span>
    <span class="card-actions">
      <button class="icon-btn${saved ? " is-on" : ""}" data-save="${esc(c.id)}" aria-pressed="${saved}" aria-label="Save" title="Save">${ICONS.bookmark}</button>
      <button class="icon-btn" data-copy="${esc(c.id)}" aria-label="Copy link" title="Copy link">${ICONS.link}</button>
      <a class="btn-original" href="${esc(c.source.url)}" target="_blank" rel="noopener">Read original ${ICONS.external}</a>
    </span>
  </div>
</article>`;
}

export function detailHTML(c, { base = "/" } = {}) {
  const row = (label, value) => (value ? `<div class="d-row"><dt>${label}</dt><dd>${value}</dd></div>` : "");
  return `<div class="detail">
  <div class="card-meta">
    <span class="pill pill-platform">${esc(c.platform)}</span>
    <span class="pill pill-domain">${esc(c.domain)}</span>
    <span class="ev ${EVIDENCE_CLASS[c.evidence] || ""}">${esc(c.evidence)}</span>
  </div>
  <h1 class="detail-title">${esc(c.title)}</h1>
  <p class="detail-summary">${esc(c.summary)}</p>
  <dl class="d-grid">
    ${row("What the agent did", esc(c.agent_role))}
    ${row("Reported outcome", c.outcome ? esc(c.outcome) : '<span class="muted">Not stated in the source</span>')}
    ${row("Platform", esc(c.platform))}
    ${row("Model", esc(c.model || "Not specified"))}
    ${row("Tools", c.tools.length ? c.tools.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ") : "")}
    ${row("Difficulty to reproduce", esc(c.difficulty))}
    ${row("Evidence", esc(c.evidence))}
    ${row("Tags", c.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join(" "))}
    ${row(
      "Source",
      `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)} · ${esc(hostOf(c.source.url))}</a>${
        c.source.author ? ` by ${esc(c.source.author)}` : ""
      }${c.source.published ? `, ${formatDate(c.source.published)}` : ""}`,
    )}
    ${row("Added", formatDate(c.added))}
  </dl>
  <div class="detail-actions">
    <a class="btn-primary" href="${esc(c.source.url)}" target="_blank" rel="noopener">Read the original ${ICONS.external}</a>
    <a class="btn-ghost" href="${base}case/${esc(c.id)}/">Permalink</a>
  </div>
  <p class="fineprint">Summaries are written with AI assistance from the original post and checked against our
  <a href="https://github.com/aharchaoumehdi/agents-in-practice/blob/main/docs/editorial-guidelines.md">editorial guidelines</a>.
  Outcomes are as reported by the source, not independently verified.</p>
</div>`;
}
