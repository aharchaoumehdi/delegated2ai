// RSS / Atom feeds from blogs and newsletters that regularly feature agent work.
import { fetchWithTimeout, htmlToText } from "../lib/util.mjs";

export const name = "Feeds";

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
}

function link(xml) {
  const atom = xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ||
    xml.match(/<link[^>]*href=["']([^"']+)["']/i);
  return tag(xml, "link") || atom?.[1] || "";
}

export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const feedTitle = htmlToText(tag(xml.replace(/<(item|entry)[\s>][\s\S]*/i, ""), "title"));
  return blocks.map((b) => ({
    feedTitle,
    title: htmlToText(tag(b, "title")),
    url: htmlToText(link(b)),
    text: htmlToText(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 4000),
    author: htmlToText(tag(tag(b, "author"), "name") || tag(b, "dc:creator") || tag(b, "author")) || null,
    published: tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"),
  }));
}

export async function collect(cfg, { since }) {
  const out = [];
  const errors = [];
  for (const feedUrl of cfg.urls) {
    try {
      const res = await fetchWithTimeout(feedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const item of parseFeed(await res.text())) {
        const when = new Date(item.published);
        if (!item.url || Number.isNaN(when.getTime()) || when < since) continue;
        out.push({
          source: "feed",
          source_name: item.feedTitle || new URL(feedUrl).hostname,
          url: item.url,
          discussion_url: item.url,
          title: item.title,
          text: item.text,
          author: item.author,
          published: when.toISOString(),
          // Curated feeds have no engagement signal; give them a neutral prior.
          engagement: { score: 50, comments: 0 },
        });
      }
    } catch (err) {
      errors.push(`${feedUrl}: ${err.message}`);
    }
  }
  if (out.length === 0 && errors.length === cfg.urls.length) throw new Error(errors.join("; "));
  return out;
}
