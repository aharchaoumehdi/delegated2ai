// X (Twitter) recent search. Needs X_BEARER_TOKEN from a pay-per-use X developer account.
// X bills each post returned, so maxResults (10-100) in config/sources.json caps the daily cost.
import { fetchJSON } from "../lib/util.mjs";

export const name = "X";

export async function collect(cfg, { since }) {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return { skipped: "X_BEARER_TOKEN not set" };
  const params = new URLSearchParams({
    query: cfg.query,
    max_results: String(Math.min(100, Math.max(10, cfg.maxResults ?? 100))),
    // "recency" (the newest posts) returns mostly minutes-old posts with no likes yet,
    // which minLikes then discards after we have paid for them.
    sort_order: cfg.sortOrder ?? "relevancy",
    start_time: since.toISOString(),
    "tweet.fields": "created_at,public_metrics,entities,note_tweet",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  const data = await fetchJSON(`https://api.x.com/2/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
  const out = [];
  for (const t of data.data || []) {
    if ((t.public_metrics?.like_count ?? 0) < cfg.minLikes) continue;
    const user = users.get(t.author_id);
    const url = `https://x.com/${user?.username || "i"}/status/${t.id}`;
    const text = t.note_tweet?.text || t.text;
    out.push({
      source: "x",
      source_name: "X",
      url,
      discussion_url: url,
      title: text.split("\n")[0].slice(0, 120),
      text,
      author: user ? `@${user.username}` : null,
      published: t.created_at,
      engagement: { score: t.public_metrics.like_count, comments: t.public_metrics.reply_count },
    });
  }
  out.fetched = data.data?.length ?? 0; // posts X billed for, before the minLikes filter
  return out;
}
