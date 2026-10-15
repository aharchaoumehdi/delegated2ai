// DEV Community public API.
import { fetchJSON } from "../lib/util.mjs";

export const name = "DEV";

export async function collect(cfg, { since }) {
  const out = [];
  for (const tag of cfg.tags) {
    const items = await fetchJSON(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=2&per_page=50`);
    for (const a of items) {
      if (a.positive_reactions_count < cfg.minReactions) continue;
      if (new Date(a.published_at) < since) continue;
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
  return out;
}
