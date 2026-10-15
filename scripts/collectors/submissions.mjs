// Reader submissions filed through the "Submit a use case" GitHub issue form.
import { fetchJSON } from "../lib/util.mjs";

export const name = "Reader submissions";

export async function collect(cfg, { since }) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY not set (only runs in GitHub Actions)");
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
    out.push({
      source: "submission",
      source_name: "Reader submission",
      url: link[0],
      discussion_url: issue.html_url,
      title: issue.title.replace(/^\[?submission\]?:?\s*/i, ""),
      text: body,
      author: null,
      published: issue.created_at,
      // Submissions skip the engagement filter but still go through curation.
      engagement: { score: 1000, comments: issue.comments },
    });
  }
  return out;
}
