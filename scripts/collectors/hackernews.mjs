// Hacker News via the public Algolia search API (no key required).
import { fetchJSON } from "../lib/util.mjs";

export const name = "Hacker News";

export async function collect(cfg, { since }) {
  const sinceSec = Math.floor(since.getTime() / 1000);
  const out = [];
  for (const query of cfg.queries) {
    const url =
      "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=50" +
      `&query=${encodeURIComponent(query)}` +
      `&numericFilters=${encodeURIComponent(`created_at_i>${sinceSec},points>=${cfg.minPoints}`)}`;
    const data = await fetchJSON(url);
    for (const hit of data.hits) {
      const discussion = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      out.push({
        source: "hackernews",
        source_name: "Hacker News",
        url: hit.url || discussion,
        discussion_url: discussion,
        title: hit.title,
        text: hit.story_text || "",
        author: hit.author,
        published: hit.created_at,
        engagement: { score: hit.points ?? 0, comments: hit.num_comments ?? 0 },
      });
    }
  }
  return out;
}
