// Collects the site's numbers for the owner's dashboard and writes them as JSON row files
// to metrics/ (the "Site metrics" workflow commits them to the `metrics` branch, and a
// scheduled task loads them into the dashboard). Each source is independent: one that
// fails or isn't set up is recorded in status.json and the rest still run.
//
// Sources, and what each needs:
//   traffic      Cloudflare Web Analytics   CLOUDFLARE_API_TOKEN (Account Analytics: Read),
//                                           CLOUDFLARE_ACCOUNT_ID, analytics.cloudflareSiteTag
//   newsletter   Kit                        KIT_API_KEY
//   engagement   the votes service's D1     CLOUDFLARE_API_TOKEN (D1), CLOUDFLARE_ACCOUNT_ID
//   search       Google Search Console      GSC_SERVICE_ACCOUNT (a service account's JSON key)
//   content      this repository            nothing
//   health       the live site, GitHub      GITHUB_TOKEN, GITHUB_REPOSITORY (for workflow runs)
//
// No email address, network address or reader's note is written: only counts, page paths,
// referring sites, countries and the like.
//
//   node scripts/metrics.mjs [outDir]     (default: metrics/)
import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCases } from "./lib/cases.mjs";
import { path, readJSON } from "./lib/util.mjs";

const DAY = 86400e3;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const env = (k) => (process.env[k] || "").trim();

export const daysBack = (n, now = Date.now()) => Array.from({ length: n }, (_, i) => iso(now - (n - 1 - i) * DAY));

/** Fills missing days with zeros so charts show gaps as 0, not as a skipped day. */
export function fillDays(rows, days, zero) {
  const by = new Map(rows.map((r) => [r.day, r]));
  return days.map((day) => by.get(day) || { day, ...zero });
}

/** Drops the all-zero days before the first real one (the site's launch), keeping at least `min`. */
export function trimLeading(rows, keys, min = 14) {
  const first = rows.findIndex((r) => keys.some((k) => r[k]));
  const cut = first < 0 ? rows.length - min : Math.min(first, rows.length - min);
  return rows.slice(Math.max(0, cut));
}

// ---------- Cloudflare ----------
async function cf(pathname, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false || body.errors?.length)
    throw new Error(`Cloudflare ${pathname.split("?")[0]}: HTTP ${res.status} ${(body.errors || []).map((e) => e.message).join("; ").slice(0, 200)}`);
  return body;
}

async function traffic(now, siteTag) {
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const site = siteTag;
  if (!env("CLOUDFLARE_API_TOKEN") || !account || !site) throw new Error("not set up: needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and analytics.cloudflareSiteTag");
  const days = daysBack(90, now);
  const start = days[0], end = days.at(-1), start28 = days.at(-28);
  // Bots are left out, as in Cloudflare's own dashboard ("Exclude bots"); if the API
  // refuses that filter, the run falls back to all traffic and says so in status.json.
  let botFilter = ", bot: 0";
  const group = (alias, dims, from, limit, order) =>
    `${alias}: rumPageloadEventsAdaptiveGroups(limit: ${limit}, filter: {siteTag: $site, date_geq: "${from}", date_leq: $end${botFilter}}, orderBy: [${order}]) { count sum { visits } dimensions { ${dims} } }`;
  const build = () => `query ($account: String!, $site: String!, $end: Date!) { viewer { accounts(filter: {accountTag: $account}) {
    ${group("daily", "date", start, 1000, "date_ASC")}
    ${group("pages", "requestPath", start28, 20, "count_DESC")}
    ${group("referrers", "refererHost", start28, 20, "count_DESC")}
    ${group("countries", "countryName", start28, 20, "count_DESC")}
    ${group("devices", "deviceType", start28, 10, "count_DESC")}
    ${group("browsers", "userAgentBrowser", start28, 10, "count_DESC")}
  } } }`;
  const ask = () => cf("/graphql", { method: "POST", body: JSON.stringify({ query: build(), variables: { account, site, end } }) });
  let data, note = "updated (bots excluded)";
  try {
    ({ data } = await ask());
  } catch (e) {
    if (!/bot/i.test(e.message)) throw e;
    botFilter = "";
    note = "updated (includes bots: the API refused the bot filter)";
    ({ data } = await ask());
  }
  const a = data?.viewer?.accounts?.[0];
  if (!a) throw new Error("Cloudflare returned no account data (check CLOUDFLARE_ACCOUNT_ID)");
  const daily = trimLeading(
    fillDays(a.daily.map((g) => ({ day: g.dimensions.date, pageviews: g.count, visits: g.sum.visits })), days, { pageviews: 0, visits: 0 }),
    ["pageviews"],
  );
  const breakdown = [];
  const add = (dimension, list, key, label = (v) => v) => {
    for (const g of list) breakdown.push({ dimension, value: label(g.dimensions[key]) || "(none)", pageviews: g.count, visits: g.sum.visits });
  };
  add("page", a.pages, "requestPath");
  add("referrer", a.referrers, "refererHost", (v) => (v === "delegatedto.ai" || v === "www.delegatedto.ai" ? "" : v) || "Direct or unknown");
  add("country", a.countries, "countryName");
  add("device", a.devices, "deviceType");
  add("browser", a.browsers, "userAgentBrowser");
  // Merge rows that ended up with the same label (e.g. the site itself folded into Direct).
  const merged = new Map();
  for (const r of breakdown) {
    const k = `${r.dimension}|${r.value}`;
    const m = merged.get(k) || { ...r, pageviews: 0, visits: 0 };
    m.pageviews += r.pageviews;
    m.visits += r.visits;
    merged.set(k, m);
  }
  return { traffic_daily: daily, traffic_breakdown: [...merged.values()], _note: note };
}

async function d1(sql, params = []) {
  const account = env("CLOUDFLARE_ACCOUNT_ID");
  const dbs = await cf(`/accounts/${account}/d1/database?name=delegatedto-votes`);
  const db = dbs.result?.find((d) => d.name === "delegatedto-votes");
  if (!db) throw new Error("the votes database wasn't found");
  const r = await cf(`/accounts/${account}/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql, params }) });
  return r.result?.[0]?.results || [];
}

async function engagement(now, cases) {
  if (!env("CLOUDFLARE_API_TOKEN") || !env("CLOUDFLARE_ACCOUNT_ID")) throw new Error("not set up: needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
  const titles = new Map(cases.map((c) => [c.id, c.title]));
  const top = await d1("SELECT case_id, total FROM votes WHERE total > 0 ORDER BY total DESC LIMIT 15");
  const [{ n: votesTotal = 0 } = {}] = await d1("SELECT COALESCE(SUM(total), 0) AS n FROM votes");
  const recent = await d1("SELECT day, SUM(n) AS n FROM daily GROUP BY day");
  const subs = await d1("SELECT created FROM submissions");
  const subDays = new Map();
  for (const s of subs) subDays.set(iso(s.created), (subDays.get(iso(s.created)) || 0) + 1);
  return {
    top_voted: top.map((r) => ({ case_id: r.case_id, title: titles.get(r.case_id) || r.case_id, votes: r.total })),
    // `votes` keeps a few days only in the database; history.json keeps the long view.
    votes_recent: recent.map((r) => ({ day: r.day, votes: r.n })),
    submissions_daily: fillDays([...subDays].map(([day, n]) => ({ day, submissions: n })), daysBack(30, now), { submissions: 0 }),
    _totals: { votes_total: votesTotal, submissions_30d: subs.length },
  };
}

// ---------- Kit ----------
async function kit(pathname) {
  const res = await fetch(`https://api.kit.com/v4${pathname}`, { headers: { "X-Kit-Api-Key": env("KIT_API_KEY"), Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Kit ${pathname.split("?")[0]}: HTTP ${res.status}`);
  return body;
}

async function kitAll(pathname, key) {
  const out = [];
  let after = "";
  for (let page = 0; page < 50; page++) {
    const body = await kit(`${pathname}${pathname.includes("?") ? "&" : "?"}per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    out.push(...(body[key] || []));
    if (!body.pagination?.has_next_page) break;
    after = body.pagination.end_cursor;
  }
  return out;
}

async function newsletter(now) {
  if (!env("KIT_API_KEY")) throw new Error("not set up: needs KIT_API_KEY");
  const days = daysBack(90, now);
  // Only each subscriber's sign-up date is used; addresses are never written out.
  const active = await kitAll("/subscribers?status=active", "subscribers");
  const cancelled = await kitAll("/subscribers?status=cancelled", "subscribers");
  const perDay = new Map();
  for (const s of active) {
    const d = iso(s.created_at);
    perDay.set(d, (perDay.get(d) || 0) + 1);
  }
  let total = active.filter((s) => iso(s.created_at) < days[0]).length;
  const subscribers_daily = trimLeading(
    days.map((day) => {
      const n = perDay.get(day) || 0;
      total += n;
      return { day, new: n, total };
    }),
    ["total"],
  );
  const broadcasts = (await kit("/broadcasts?per_page=50")).broadcasts || [];
  const emails = [];
  for (const b of broadcasts.filter((b) => b.published_at || b.send_at).slice(0, 30)) {
    const st = (await kit(`/broadcasts/${b.id}/stats`)).broadcast?.stats || {};
    emails.push({
      day: iso(b.published_at || b.send_at),
      subject: b.subject || "",
      recipients: st.recipients ?? 0,
      open_rate: (st.open_rate ?? 0) / 100,
      click_rate: (st.click_rate ?? 0) / 100,
      unsubscribes: st.unsubscribes ?? 0,
      status: st.status || "",
    });
  }
  emails.sort((a, b) => b.day.localeCompare(a.day));
  return { subscribers_daily, emails, _totals: { subscribers: active.length, unsubscribed: cancelled.length } };
}

// ---------- Google Search Console ----------
export function googleJwt(key, now = Date.now()) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(now / 1000);
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claim = b64({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 });
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url");
  return `${head}.${claim}.${sig}`;
}

async function search(now, siteUrl) {
  const raw = env("GSC_SERVICE_ACCOUNT");
  if (!raw) throw new Error("not set up: needs the GSC_SERVICE_ACCOUNT secret");
  const key = JSON.parse(raw);
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: googleJwt(key, now) }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Google sign-in failed: ${tok.error_description || tok.error || "no token"}`);
  const q = async (body) => {
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Search Console: HTTP ${res.status} ${j.error?.message || ""}`.trim());
    return j.rows || [];
  };
  const days = daysBack(90, now);
  const start28 = days.at(-28);
  const daily = await q({ startDate: days[0], endDate: days.at(-1), dimensions: ["date"], rowLimit: 1000 });
  const row = (dimension, r) => ({ dimension, value: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
  return {
    search_daily: trimLeading(
      fillDays(
        daily.map((r) => ({ day: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
        days,
        { clicks: 0, impressions: 0, ctr: 0, position: null },
      ),
      ["impressions"],
    ),
    search_breakdown: [
      ...(await q({ startDate: start28, endDate: days.at(-1), dimensions: ["query"], rowLimit: 25 })).map((r) => row("query", r)),
      ...(await q({ startDate: start28, endDate: days.at(-1), dimensions: ["page"], rowLimit: 25 })).map((r) => row("page", r)),
      ...(await q({ startDate: start28, endDate: days.at(-1), dimensions: ["country"], rowLimit: 15 })).map((r) => row("country", r)),
      ...(await q({ startDate: start28, endDate: days.at(-1), dimensions: ["device"], rowLimit: 5 })).map((r) => row("device", r)),
    ],
  };
}

// ---------- content and the daily pipeline (this repository) ----------
async function content(now, cases) {
  const days = daysBack(30, now);
  const published = cases.filter((c) => c.status === "published");
  const pipeline = [];
  for (const day of days) {
    const log = await readJSON(path("data", "runs", `${day}.json`), null);
    const runs = Array.isArray(log?.runs) ? log.runs : log ? [log] : [];
    const row = { day, collected: 0, evaluated: 0, published: published.filter((c) => c.added === day).length, rejected: 0, source_errors: 0 };
    for (const r of runs) {
      for (const s of Object.values(r.collect?.sources || {})) {
        row.collected += s.items || 0;
        if (s.status === "error") row.source_errors += 1;
      }
      row.evaluated += r.curate?.evaluated || 0;
      row.rejected += r.curate?.rejected || 0;
    }
    pipeline.push(row);
  }
  const count = (key) => {
    const m = new Map();
    for (const c of published) m.set(c[key], (m.get(c[key]) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const content_breakdown = [
    ...count("domain").map(([value, n]) => ({ dimension: "topic", value, use_cases: n })),
    ...count("platform").map(([value, n]) => ({ dimension: "agent", value, use_cases: n })),
  ];
  // The latest run's sources, for the health panel.
  let sources = [];
  for (const day of [...days].reverse()) {
    const log = await readJSON(path("data", "runs", `${day}.json`), null);
    const last = (Array.isArray(log?.runs) ? log.runs : []).filter((r) => r.collect).at(-1);
    if (last) {
      sources = Object.entries(last.collect.sources || {}).map(([name, s]) => ({ day, source: name, status: s.status, items: s.items ?? 0 }));
      break;
    }
  }
  return { pipeline_daily: trimLeading(pipeline, ["collected", "published"]), content_breakdown, collector_sources: sources, _totals: { use_cases: published.length } };
}

// ---------- health ----------
async function timed(url, init) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.name };
  }
}

async function health(siteUrl, votesApi) {
  const rows = [];
  const check = async (name, url, init) => {
    const r = await timed(url, init);
    rows.push({ check: name, ok: r.ok, detail: r.ok ? `${r.ms} ms` : `HTTP ${r.status || r.error}` , ms: r.ms });
  };
  await check("Home page", siteUrl);
  await check("RSS feed", `${siteUrl}feed.xml`);
  await check("Sitemap", `${siteUrl}sitemap.xml`);
  if (votesApi) await check("Votes and sign-ups service", `${votesApi}/stats`, { headers: { Origin: siteUrl.replace(/\/$/, "") } });
  const repo = env("GITHUB_REPOSITORY");
  if (repo && env("GITHUB_TOKEN")) {
    for (const [name, file] of [["Daily update", "daily.yml"], ["Votes service deploy", "votes.yml"]]) {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?per_page=1&exclude_pull_requests=true`, {
        headers: { Authorization: `Bearer ${env("GITHUB_TOKEN")}`, Accept: "application/vnd.github+json" },
      }).then((r) => r.json()).catch(() => ({}));
      const run = res.workflow_runs?.[0];
      // A run still going is neither a pass nor a failure: ok is null.
      if (run)
        rows.push({
          check: `${name} (last run)`,
          ok: run.status === "completed" ? run.conclusion === "success" : null,
          detail: `${run.status === "completed" ? run.conclusion : "running"} · ${run.created_at.slice(0, 16).replace("T", " ")} UTC`,
          ms: null,
        });
    }
  }
  return rows;
}

// ---------- run ----------
/** Which source fills each dataset (for the note on an empty one). */
const SOURCE_OF = {
  traffic_daily: "traffic", traffic_breakdown: "traffic", subscribers_daily: "newsletter", emails: "newsletter",
  top_voted: "engagement", submissions_daily: "engagement", search_daily: "search", search_breakdown: "search",
  pipeline_daily: "content", content_breakdown: "content", collector_sources: "content",
};

/** Every file the dashboard reads (each one is a dataset there, under the same name). */
export const DATASETS = [
  "traffic_daily", "traffic_breakdown", "subscribers_daily", "emails", "top_voted", "submissions_daily",
  "search_daily", "search_breakdown", "pipeline_daily", "content_breakdown", "collector_sources",
  "health", "status", "history", "updated",
];
export async function collect({ now = Date.now(), previousHistory = [] } = {}) {
  const site = await readJSON(path("config", "site.json"));
  const siteUrl = site.url.replace(/\/?$/, "/");
  const { cases } = await loadCases();
  const out = {};
  const status = [];
  const totals = {};
  const run = async (name, label, fn) => {
    try {
      const r = await fn();
      for (const [k, v] of Object.entries(r)) if (k === "_totals") Object.assign(totals, v); else if (k !== "_note") out[k] = v;
      status.push({ source: name, label, ok: true, detail: r._note || "updated", at: new Date(now).toISOString() });
    } catch (e) {
      status.push({ source: name, label, ok: false, detail: String(e.message).slice(0, 300), at: new Date(now).toISOString() });
    }
  };
  await run("traffic", "Cloudflare Web Analytics", () => traffic(now, site.analytics?.cloudflareSiteTag));
  await run("newsletter", "Kit", () => newsletter(now));
  await run("engagement", "Votes and submissions", () => engagement(now, cases));
  await run("search", "Google Search Console", () => search(now, env("GSC_SITE_URL") || siteUrl));
  await run("content", "Daily pipeline", () => content(now, cases));
  out.health = await health(siteUrl, env("VOTES_API") || site.votesApi);
  out.status = status;
  // One row per day of the headline numbers, kept across runs (votes and submissions
  // aren't kept long in the database, so this is their long-term record).
  const today = iso(now);
  const prev = previousHistory.filter((r) => r.day !== today).slice(-365);
  const last = prev.at(-1) || {};
  out.history = [
    ...prev,
    {
      day: today,
      use_cases: totals.use_cases ?? last.use_cases ?? null,
      subscribers: totals.subscribers ?? last.subscribers ?? null,
      votes_total: totals.votes_total ?? last.votes_total ?? null,
      submissions_30d: totals.submissions_30d ?? last.submissions_30d ?? null,
    },
  ];
  return out;
}

async function main() {
  const dir = process.argv[2] || path("metrics");
  await mkdir(dir, { recursive: true });
  let previousHistory = [];
  try {
    previousHistory = JSON.parse(await readFile(join(dir, "history.json"), "utf8"));
  } catch {}
  const out = await collect({ previousHistory });
  // The dashboard can't load a file with no rows, so a source with nothing to show yet
  // gets one row holding only a `note` (why it's empty); the dashboard skips such rows.
  const why = (name) => {
    const s = out.status.find((x) => SOURCE_OF[name] === x.source);
    return s && !s.ok ? s.detail : "nothing recorded yet";
  };
  const write = (name, rows) => writeFile(join(dir, `${name}.json`), JSON.stringify(rows.length ? rows : [{ note: why(name) }], null, 1) + "\n");
  for (const [name, rows] of Object.entries(out)) await write(name, rows);
  // A source that failed this time keeps its last file (the directory starts from the
  // previous run's); one that has never worked gets a note row.
  for (const name of DATASETS) {
    try {
      const prev = JSON.parse(await readFile(join(dir, `${name}.json`), "utf8"));
      if (!Array.isArray(prev) || !prev.length) await write(name, []);
    } catch {
      await write(name, []);
    }
  }
  await writeFile(join(dir, "updated.json"), JSON.stringify([{ at: new Date().toISOString() }]) + "\n");
  for (const s of out.status) console.log(`${s.ok ? "✓" : "✗"} ${s.label}: ${s.detail}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `### Site metrics\n${out.status.map((s) => `- ${s.ok ? "✓" : "✗"} **${s.label}**: ${s.detail}`).join("\n")}\n`, { flag: "a" });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
