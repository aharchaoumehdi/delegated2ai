// Step 1 of the daily pipeline: gather candidate posts from every enabled source,
// dedupe them, rank them and fetch page text for the best ones.
// Output: .cache/candidates.json (consumed by curate.mjs) and a run log entry.
import { createHash } from "node:crypto";
import { loadCases } from "./lib/cases.mjs";
import { path, readJSON, writeJSON, canonicalUrl, today, fetchWithTimeout, htmlToText, mapLimit } from "./lib/util.mjs";
import * as hackernews from "./collectors/hackernews.mjs";
import * as reddit from "./collectors/reddit.mjs";
import * as devto from "./collectors/devto.mjs";
import * as github from "./collectors/github.mjs";
import * as submissions from "./collectors/submissions.mjs";
import * as x from "./collectors/x.mjs";
import * as feeds from "./collectors/feeds.mjs";

const COLLECTORS = { hackernews, reddit, devto, github, submissions, x, feeds };
// Pages we can't usefully fetch (login walls / JS apps); their post text is used instead.
const NO_FETCH = /(^|\.)(x\.com|twitter\.com|reddit\.com|linkedin\.com|youtube\.com|youtu\.be)$/;

const config = await readJSON(path("config", "sources.json"));
const since = new Date(Date.now() - config.lookbackHours * 3600e3);
const runDate = today();

// 1. Collect from every source in parallel; one failing source never stops the run.
const report = {};
const raw = [];
await Promise.all(
  Object.entries(COLLECTORS).map(async ([key, mod]) => {
    const cfg = config[key];
    if (!cfg?.enabled) return (report[key] = { status: "disabled" });
    const started = Date.now();
    try {
      const result = await mod.collect(cfg, { since });
      if (!Array.isArray(result)) return (report[key] = { status: "skipped", reason: result.skipped });
      raw.push(...result);
      report[key] = { status: "ok", items: result.length, ms: Date.now() - started };
      // A collector can keep partial results and list what failed (e.g. one rate-limited tag).
      if (result.errors?.length) report[key].errors = result.errors.map((e) => String(e).slice(0, 200));
    } catch (err) {
      report[key] = { status: "error", error: String(err.message).slice(0, 300) };
    }
  }),
);

// 2. Dedupe across sources and against everything we've already processed or published.
const seen = await readJSON(path("data", "state", "seen.json"), {});
const { cases } = await loadCases();
const known = new Set([...Object.keys(seen), ...cases.map((c) => canonicalUrl(c.source.url))]);

const byUrl = new Map();
for (const item of raw) {
  if (!item.url || !item.title) continue;
  const key = canonicalUrl(item.url);
  if (known.has(key)) continue;
  const prev = byUrl.get(key);
  if (!prev) {
    byUrl.set(key, { ...item, key, also_on: [] });
  } else {
    // Same page surfaced on several sites: keep the strongest signal, remember the rest.
    prev.also_on.push({ source_name: item.source_name, url: item.discussion_url });
    prev.engagement.score = Math.max(prev.engagement.score, item.engagement.score);
    prev.engagement.comments += item.engagement.comments;
    if ((item.text || "").length > (prev.text || "").length) prev.text = item.text;
  }
}

// 3. Rank: keyword relevance + engagement relative to each source's best item.
const keywords = config.keywords.map((k) => k.toLowerCase());
const maxBySource = {};
for (const c of byUrl.values()) {
  maxBySource[c.source] = Math.max(maxBySource[c.source] || 1, c.engagement.score);
}
const ranked = [...byUrl.values()]
  .map((c) => {
    const hay = `${c.title} ${c.text}`.toLowerCase();
    const relevance = keywords.filter((k) => hay.includes(k)).length;
    const engagement = Math.log10(c.engagement.score + 1) / Math.log10(maxBySource[c.source] + 1);
    const rank = c.source === "submission" ? 2 : 0.6 * engagement + 0.4 * (Math.min(relevance, 4) / 4);
    return { ...c, relevance, rank: Number(rank.toFixed(3)) };
  })
  .filter((c) => c.relevance > 0 || c.source === "submission")
  .sort((a, b) => b.rank - a.rank)
  .slice(0, config.maxCandidates);

// 4. Enrich: fetch readable text of the linked page when the post itself is thin.
await mapLimit(ranked, 6, async (c) => {
  let host = "";
  try {
    host = new URL(c.url).hostname;
  } catch {}
  if ((c.text || "").length > 1500 || NO_FETCH.test(host)) return;
  try {
    const res = await fetchWithTimeout(c.url, {}, 12000);
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("text/html")) {
      c.page_text = htmlToText(await res.text()).slice(0, 8000);
    }
  } catch {
    // Unreachable pages are fine; the curator works from the post text.
  }
});

const candidates = ranked.map((c) => ({
  id: createHash("sha1").update(c.key).digest("hex").slice(0, 10),
  ...c,
}));

await writeJSON(path(".cache", "candidates.json"), { date: runDate, since: since.toISOString(), candidates });
await writeJSON(path("data", "runs", `${runDate}.json`), {
  date: runDate,
  collect: { sources: report, raw: raw.length, unique_new: byUrl.size, candidates: candidates.length },
});

console.log(`Collected ${raw.length} items → ${byUrl.size} new unique → ${candidates.length} candidates`);
for (const [k, v] of Object.entries(report)) {
  console.log(`  ${k.padEnd(12)} ${v.status}${v.items !== undefined ? ` (${v.items})` : ""}${v.error ? ` — ${v.error}` : ""}${v.reason ? ` — ${v.reason}` : ""}`);
  for (const e of v.errors || []) console.log(`  ${"".padEnd(12)} partial: ${e}`);
}
