// DEV Community public API.
// The API rate-limits bursts, so tags are fetched one at a time with a pause between them.
// A failing tag never discards the others: its error is reported and the rest are kept.
import { fetchJSON as defaultFetchJSON, sleep as defaultSleep } from "../lib/util.mjs";

export const name = "DEV";

const MAX_RETRY_WAIT_S = 30;

export async function collect(cfg, { since }, { fetchJSON = defaultFetchJSON, sleep = defaultSleep } = {}) {
  const delayMs = cfg.delayMs ?? 1500;
  const out = [];
  const errors = [];
  const urls = new Set(); // the same article often carries several of our tags

  for (const [i, tag] of cfg.tags.entries()) {
    if (i > 0) await sleep(delayMs);
    const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=2&per_page=50`;
    let items;
    try {
      items = await fetchJSON(url);
    } catch (err) {
      if (err.status !== 429) {
        errors.push(`${tag}: ${err.message}`);
        continue;
      }
      // Rate-limited: wait as long as the server asks (capped), then try this tag once more.
      await sleep(Math.min(err.retryAfter ?? 5, MAX_RETRY_WAIT_S) * 1000);
      try {
        items = await fetchJSON(url);
      } catch (retryErr) {
        errors.push(`${tag}: ${retryErr.message}`);
        continue;
      }
    }
    for (const a of items) {
      if (a.positive_reactions_count < cfg.minReactions) continue;
      if (new Date(a.published_at) < since) continue;
      if (urls.has(a.url)) continue;
      urls.add(a.url);
      out.push({
        source: "devto",
        source_name: "DEV Community",
        url: a.url,
        discussion_url: a.url,
        title: a.title,
        text: a.description || "",
        author: a.user?.name || a.user?.username || null,
        published: a.published_at,
        engagement: { score: a.positive_reactions_count, comments: a.comments_count },
      });
    }
  }

  // Nothing worked at all: report the source as failed rather than as an empty success.
  if (errors.length === cfg.tags.length) throw new Error(errors.join("; "));
  out.errors = errors;
  return out;
}
