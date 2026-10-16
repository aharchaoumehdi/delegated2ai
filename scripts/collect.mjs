// Step 1 of the daily pipeline: gather candidate posts from every enabled source,
// dedupe them, rank them and fetch page text for the best ones.
// Output: .cache/candidates.json (consumed by curate.mjs) and a run log entry.
import { createHash } from "node:crypto";
import { loadCases } from "./lib/cases.mjs";
import { selectCandidates } from "./lib/rank.mjs";
import { updateRun, runId } from "./lib/runlog.mjs";
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
      if (result.fetched !== undefined) report[key].fetched = result.fetched;
      if (result.searches) report[key].searches = result.searches;
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

// 3. Rank and select what the curator will judge (see lib/rank.mjs).
const ranked = selectCandidates([...byUrl.values()], config);

// 4. Enrich: fetch readable text of the linked page when the post itself is thin. For
// posts on sites we can't read (X, Reddit…), fetch the page the post links to instead.
const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
await mapLimit(ranked, 6, async (c) => {
  const target = NO_FETCH.test(hostOf(c.url)) ? c.link : c.url;
  if (!target || NO_FETCH.test(hostOf(target)) || (c.text || "").length > 1500) return;
  try {
    const res = await fetchWithTimeout(target, {}, 12000);
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
await updateRun(
  runDate,
  { collect: { sources: report, raw: raw.length, unique_new: byUrl.size, candidates: candidates.length } },
  { id: await runId({ fresh: true }) },
);

console.log(`Collected ${raw.length} items → ${byUrl.size} new unique → ${candidates.length} candidates`);
for (const [k, v] of Object.entries(report)) {
  console.log(`  ${k.padEnd(12)} ${v.status}${v.items !== undefined ? ` (${v.items}${v.fetched !== undefined ? ` of ${v.fetched} fetched` : ""})` : ""}${v.error ? ` — ${v.error}` : ""}${v.reason ? ` — ${v.reason}` : ""}`);
  for (const e of v.errors || []) console.log(`  ${"".padEnd(12)} partial: ${e}`);
}
