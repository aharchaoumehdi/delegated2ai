// X (Twitter) recent search. Needs X_BEARER_TOKEN from a pay-per-use X developer account.
//
// Runs several focused searches (config/sources.json → x.queries), because one broad
// query mostly returns announcements and opinions rather than people showing what an
// agent did for them. X bills every post returned, so each search's maxResults (10-100)
// sets the daily cost; every returned post goes to the curator (see alwaysCurate).
//
// Posts that link out (a repo, a write-up, a demo) carry that link, so the collector can
// fetch the page and the curator can judge the work, not just the post text.
import { fetchJSON as defaultFetchJSON } from "../lib/util.mjs";

export const name = "X";

const X_HOST = /(^|\.)(x\.com|twitter\.com|t\.co)$/;

function searches(cfg) {
  if (Array.isArray(cfg.queries) && cfg.queries.length) return cfg.queries;
  return cfg.query ? [{ label: "default", query: cfg.query, maxResults: cfg.maxResults }] : [];
}

/** The post's own words, with t.co links expanded, and its first outside link. */
function readPost(t) {
  let text = t.note_tweet?.text || t.text || "";
  let link = null;
  const urls = t.note_tweet?.entities?.urls || t.entities?.urls || [];
  for (const u of urls) {
    const expanded = u.unwound_url || u.expanded_url;
    if (!expanded) continue;
    if (u.url) text = text.split(u.url).join(expanded);
    try {
      if (!link && !X_HOST.test(new URL(expanded).hostname)) link = expanded;
    } catch {}
  }
  return { text, link };
}

export async function collect(cfg, { since }, { fetchJSON = defaultFetchJSON } = {}) {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return { skipped: "X_BEARER_TOKEN not set" };
  const out = [];
  const errors = [];
  const stats = [];
  const ids = new Set(); // the same post can match more than one search
  let fetched = 0;

  for (const s of searches(cfg)) {
    const params = new URLSearchParams({
      query: s.query,
      max_results: String(Math.min(100, Math.max(10, s.maxResults ?? 30))),
      // "recency" returns minutes-old posts with no engagement yet; "relevancy" surfaces
      // the posts people are actually reading and sharing.
      sort_order: cfg.sortOrder ?? "relevancy",
      start_time: since.toISOString(),
      "tweet.fields": "created_at,public_metrics,entities,note_tweet",
      expansions: "author_id",
      "user.fields": "username,name",
    });
    let data;
    try {
      data = await fetchJSON(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { Authorization: `Bearer ${bearer}` } });
    } catch (err) {
      errors.push(`${s.label}: ${err.message}`);
      stats.push({ label: s.label, fetched: 0, kept: 0, error: true });
      continue;
    }
    const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
    const posts = data.data || [];
    fetched += posts.length;
    let kept = 0;
    for (const t of posts) {
      if ((t.public_metrics?.like_count ?? 0) < (cfg.minLikes ?? 0)) continue;
      if (ids.has(t.id)) continue;
      ids.add(t.id);
      const user = users.get(t.author_id);
      const url = `https://x.com/${user?.username || "i"}/status/${t.id}`;
      const { text, link } = readPost(t);
      out.push({
        source: "x",
        source_name: "X",
        url,
        discussion_url: url,
        link, // fetched by collect.mjs so the curator sees the linked work
        title: text.split("\n")[0].slice(0, 120),
        text,
        author: user ? `@${user.username}` : null,
        published: t.created_at,
        engagement: { score: t.public_metrics?.like_count ?? 0, comments: t.public_metrics?.reply_count ?? 0 },
        search: s.label,
      });
      kept++;
    }
    stats.push({ label: s.label, fetched: posts.length, kept });
  }

  if (!out.length && errors.length) throw new Error(errors.join("; "));
  out.fetched = fetched; // posts X billed for, across all searches
  out.searches = stats;
  out.errors = errors;
  return out;
}
