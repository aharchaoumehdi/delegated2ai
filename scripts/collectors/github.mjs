// GitHub repository search: recently created repos that are gaining stars quickly.
import { fetchJSON } from "../lib/util.mjs";

export const name = "GitHub";

export async function collect(cfg, { since }) {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  // Repos need a few days to accumulate stars, so look back a week for creation date.
  const created = new Date(since.getTime() - 6 * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const q of cfg.queries) {
    const query = `${q} created:>=${created} stars:>=${cfg.minStars}`;
    const data = await fetchJSON(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`,
      { headers },
    );
    for (const r of data.items) {
      out.push({
        source: "github",
        source_name: "GitHub",
        url: r.html_url,
        discussion_url: r.html_url,
        title: `${r.full_name}: ${r.description || ""}`.trim(),
        text: [r.description, (r.topics || []).join(", ")].filter(Boolean).join("\n"),
        author: r.owner?.login || null,
        published: r.created_at,
        engagement: { score: r.stargazers_count, comments: r.forks_count },
      });
    }
  }
  return out;
}
