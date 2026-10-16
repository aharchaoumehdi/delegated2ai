// Sends the daily email: today's best new use cases (up to 5), as a Kit broadcast.
//
// Runs from the daily workflow after the site is deployed, on the scheduled run only, so
// every link in the email already works. Needs KIT_API_KEY; without it, it does nothing.
// It never sends twice for the same day: each broadcast is tagged "digest <date>" in its
// internal description, and an existing one for today is left alone.
import { pathToFileURL } from "node:url";
import { loadCases } from "./lib/cases.mjs";
import { escapeHtml as esc, path, readJSON, today, truncate } from "./lib/util.mjs";

const KIT = "https://api.kit.com/v4";
export const DIGEST_SIZE = 5;

/** Today's published use cases, best first (curator score, then title for a stable order). */
export function pickDigest(cases, date, size = DIGEST_SIZE) {
  return cases
    .filter((c) => c.status === "published" && c.added === date)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title))
    .slice(0, size);
}

const formatDay = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Subject, preview text and email-safe HTML (inline styles, light background). */
export function renderDigest(list, { siteUrl, siteName, date, total }) {
  const track = (url) => `${url}${url.includes("?") ? "&" : "?"}utm_source=newsletter&utm_medium=email&utm_campaign=digest-${date}`;
  const muted = "color:#5c626b";
  const items = list
    .map((c) => {
      const url = track(`${siteUrl}use-case/${c.id}/`);
      return `<tr><td style="padding:18px 0;border-top:1px solid #dde2e8">
<p style="margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;${muted}">${esc(c.domain)} · ${esc(c.platform)}</p>
<h2 style="margin:6px 0 6px;font-size:18px;line-height:1.35"><a href="${esc(url)}" style="color:#111318;text-decoration:none">${esc(c.title)}</a></h2>
<p style="margin:0;font-size:15px;line-height:1.6;color:#2b313a">${esc(c.summary)}</p>
<p style="margin:10px 0 0;font-size:14px"><a href="${esc(url)}" style="color:#006a8c">${c.prompt ? "Read it and copy the prompt" : "Read the full story"} →</a></p>
</td></tr>`;
    })
    .join("\n");
  const n = list.length;
  const subject = `${n} new thing${n === 1 ? "" : "s"} people handed to AI agents`;
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111318">
<tr><td style="padding:8px 0 14px"><p style="margin:0;font-size:13px;${muted}">${esc(siteName)} · ${esc(formatDay(date))}</p>
<h1 style="margin:6px 0 0;font-size:22px;line-height:1.3">${esc(subject)}</h1></td></tr>
${items}
<tr><td style="padding:18px 0;border-top:1px solid #dde2e8;font-size:13px;line-height:1.6;${muted}">Found across the web and written up from the original sources. <a href="${esc(track(siteUrl))}" style="color:#006a8c">Browse all ${total} use cases</a>.</td></tr>
</table>`;
  return { subject, preview: truncate(list[0]?.title || "", 140), html };
}

/** Creates the broadcast, scheduled a few minutes out, unless today's already exists. */
export async function sendDigest({ key, date, email, fetch: f = fetch, now = Date.now() }) {
  const call = async (p, init = {}) => {
    const res = await f(KIT + p, { ...init, headers: { "X-Kit-Api-Key": key, "Content-Type": "application/json", Accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Kit ${init.method || "GET"} ${p}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  };
  const tag = `digest ${date}`;
  const recent = await call("/broadcasts?per_page=50");
  const existing = (recent.broadcasts || []).find((b) => b.description === tag);
  if (existing) return { skipped: "already sent", id: existing.id };
  const created = await call("/broadcasts", {
    method: "POST",
    body: JSON.stringify({
      subject: email.subject,
      preview_text: email.preview,
      description: tag,
      content: email.html,
      public: false,
      send_at: new Date(now + 5 * 60e3).toISOString(),
    }),
  });
  return { id: created.broadcast?.id };
}

async function main() {
  const key = process.env.KIT_API_KEY;
  if (!key) {
    console.log("No KIT_API_KEY: the daily email is off (docs/setup.md, \"Newsletter\").");
    return;
  }
  const site = await readJSON(path("config", "site.json"));
  const siteUrl = (process.env.SITE_URL || site.url).replace(/\/?$/, "/");
  const date = process.env.DIGEST_DATE || today();
  const { cases } = await loadCases();
  const list = pickDigest(cases, date);
  if (!list.length) {
    console.log(`No new use cases on ${date}: no email today.`);
    return;
  }
  const total = cases.filter((c) => c.status === "published").length;
  const email = renderDigest(list, { siteUrl, siteName: site.name, date, total });
  const r = await sendDigest({ key, date, email });
  console.log(r.skipped ? `Today's email already exists (broadcast ${r.id}).` : `Scheduled today's email: ${list.length} use cases (broadcast ${r.id}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
