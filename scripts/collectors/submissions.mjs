// Reader submissions: the site's "Submit a use case" form, stored by the votes service
// (worker/) in its D1 database, plus any GitHub issue labelled `submission` in this repo.
// The database is read through Cloudflare's API with the same CLOUDFLARE_* secrets that
// deploy the site; each source is skipped when its credentials are missing.
import { fetchJSON } from "../lib/util.mjs";

export const name = "Reader submissions";

const CF = "https://api.cloudflare.com/client/v4";

// Submissions skip the engagement filter but still go through curation.
const candidate = ({ url, title, text, published, discussion_url = null, comments = 0 }) => ({
  source: "submission",
  source_name: "Reader submission",
  url,
  discussion_url,
  title,
  text,
  author: null,
  published,
  engagement: { score: 1000, comments },
});

/** Rows from the votes service's `submissions` table added since `since`. */
export async function fromDatabase(cfg, { since, env = process.env, fetch: f = fetch }) {
  const token = (env.CLOUDFLARE_API_TOKEN || "").trim();
  const account = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (!token || !account) return null;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const call = async (p, init = {}) => {
    const res = await f(CF + p, { ...init, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw new Error(`Cloudflare ${p}: HTTP ${res.status} ${JSON.stringify(body.errors || "").slice(0, 200)}`);
    return body.result;
  };
  const dbs = await call(`/accounts/${account}/d1/database?name=${encodeURIComponent(cfg.database)}`);
  const db = (dbs || []).find((d) => d.name === cfg.database);
  if (!db) return [];
  const [res] = await call(`/accounts/${account}/d1/database/${db.uuid}/query`, {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT url, note, created FROM submissions WHERE created >= ? ORDER BY created", params: [since.getTime()] }),
  });
  return (res?.results || []).map((r) =>
    candidate({
      url: r.url,
      title: r.note ? r.note.slice(0, 120) : r.url,
      text: r.note ? `Note from the reader who submitted it: ${r.note}` : "",
      published: new Date(r.created).toISOString(),
    }),
  );
}

async function fromIssues(cfg, { since }) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const issues = await fetchJSON(
    `https://api.github.com/repos/${repo}/issues?labels=${encodeURIComponent(cfg.label)}&state=open&since=${since.toISOString()}&per_page=50`,
    { headers },
  );
  const out = [];
  for (const issue of issues) {
    const body = issue.body || "";
    const link = body.match(/https?:\/\/[^\s)>\]]+/);
    if (!link) continue;
    out.push(
      candidate({
        url: link[0],
        discussion_url: issue.html_url,
        title: issue.title.replace(/^\[?submission\]?:?\s*/i, ""),
        text: body,
        published: issue.created_at,
        comments: issue.comments,
      }),
    );
  }
  return out;
}

export async function collect(cfg, { since }) {
  const [site, issues] = await Promise.all([fromDatabase(cfg, { since }), fromIssues(cfg, { since })]);
  if (site === null && issues === null) throw new Error("Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (site form) or GITHUB_REPOSITORY (issues)");
  const seen = new Set();
  return [...(site || []), ...(issues || [])].filter((c) => !seen.has(c.url) && seen.add(c.url));
}
