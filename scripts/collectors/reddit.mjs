// Reddit. Uses OAuth (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET, "script" app) when
// available; otherwise falls back to the public JSON endpoints, which Reddit often
// blocks from cloud IPs.
import { fetchJSON, fetchWithTimeout } from "../lib/util.mjs";

export const name = "Reddit";

// Reddit's API rules ask for a descriptive User-Agent naming the app and a Reddit account;
// generic ones are heavily rate-limited. REDDIT_USERNAME is the account that owns the app.
function userAgent() {
  const user = process.env.REDDIT_USERNAME;
  return user ? `github-actions:delegatedto.ai:v0.1 (by /u/${user.replace(/^u\//, "")})` : undefined;
}

async function token() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetchWithTimeout("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      ...(userAgent() ? { "User-Agent": userAgent() } : {}),
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit OAuth failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

export async function collect(cfg, { since }) {
  const bearer = await token();
  const base = bearer ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
  if (userAgent()) headers["User-Agent"] = userAgent();
  const out = [];
  const errors = [];
  for (const sub of cfg.subreddits) {
    try {
      const data = await fetchJSON(`${base}/r/${sub}/top.json?t=day&limit=25&raw_json=1`, { headers });
      for (const { data: p } of data.data.children) {
        if (p.stickied || p.over_18 || p.score < cfg.minScore) continue;
        if (p.created_utc * 1000 < since.getTime()) continue;
        const permalink = `https://www.reddit.com${p.permalink}`;
        out.push({
          source: "reddit",
          source_name: `Reddit r/${p.subreddit}`,
          // Self posts are the content; link posts point elsewhere but we keep the thread too.
          url: p.is_self ? permalink : p.url_overridden_by_dest || permalink,
          discussion_url: permalink,
          title: p.title,
          text: p.selftext || "",
          author: p.author ? `u/${p.author}` : null,
          published: new Date(p.created_utc * 1000).toISOString(),
          engagement: { score: p.score, comments: p.num_comments },
        });
      }
    } catch (err) {
      errors.push(`r/${sub}: ${err.message}`);
    }
  }
  if (out.length === 0 && errors.length) throw new Error(errors.join("; "));
  out.errors = errors; // partial failures (e.g. one private subreddit) go to the run log
  return out;
}
