// Votes, newsletter sign-ups and live stats for delegatedto.ai.
//
//   GET  /counts        → { counts: { "<case id>": [total, last24h], ... } }
//   POST /vote          { id, on: true|false } → { id, total }
//   POST /subscribe     { email } (JSON or a plain form post) → { ok: true }
//   GET  /stats         → { subscribers, votesTotal, votes24h }
//   POST /submit        { url, note } (JSON or a plain form post) → { ok: true }
//
// Sign-ups are passed straight to the newsletter provider (Kit), which emails the
// subscriber to confirm (double opt-in). This service never stores email addresses.
//
// Privacy: only counts are kept. To stop one visitor from voting the same use case
// over and over, a salted hash of (address, use case, day) is kept for two days, and a
// salted hash of the address is kept for an hour to rate-limit. Neither stores the
// address itself, and both expire. Reader submissions (a link and an optional note, nothing
// about the sender) are kept for 30 days, for the daily run to pick up.
const ID = /^[a-z0-9-]{1,100}$/;
const DAY_MS = 86400e3;
const RATE_LIMIT = 40; // vote actions per address per hour
const SUBSCRIBE_LIMIT = 5; // sign-up attempts per address per hour
const SUBMIT_LIMIT = 10; // submissions per address per hour
const SUBMISSION_DAYS = 30; // how long a submission is kept
const NOTE_MAX = 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const KIT = "https://api.kit.com/v4";
const STATS_TTL_MS = 15 * 60e3; // how long the subscriber count is cached

const day = (t) => new Date(t).toISOString().slice(0, 10);

async function hash(...parts) {
  const data = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin);
  return ok
    ? { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
}

// Where to send a plain form post back to: the referring page, if it is one of our origins.
function returnUrl(req, env) {
  try {
    const ref = new URL(req.headers.get("Referer") || "");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
    return allowed.includes(ref.origin) ? ref.origin + ref.pathname : "";
  } catch {
    return "";
  }
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export async function counts(env, now = Date.now()) {
  const [totals, recent] = await env.DB.batch([
    env.DB.prepare("SELECT case_id, total FROM votes WHERE total > 0"),
    env.DB.prepare("SELECT case_id, SUM(n) AS n FROM daily WHERE day >= ? GROUP BY case_id").bind(day(now - DAY_MS)),
  ]);
  const out = {};
  for (const r of totals.results) out[r.case_id] = [r.total, 0];
  // "Last 24h" is approximated by today plus yesterday (UTC), the granularity we keep.
  for (const r of recent.results) if (out[r.case_id]) out[r.case_id][1] = Math.max(0, r.n);
  return out;
}

export async function vote(env, { id, on, address, now = Date.now() }) {
  const salt = env.SALT || "";
  if (await overLimit(env, "rate", address, RATE_LIMIT, now)) return { status: 429, body: { error: "Too many votes, try again later." } };

  const today = day(now);
  const seenKey = await hash(salt, "vote", address, id, today);
  if (on) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO seen (k, exp) VALUES (?, ?)").bind(seenKey, now + 2 * DAY_MS).run();
    if (r.meta.changes === 1) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO votes (case_id, total) VALUES (?, 1) ON CONFLICT(case_id) DO UPDATE SET total = total + 1").bind(id),
        env.DB.prepare("INSERT INTO daily (case_id, day, n) VALUES (?, ?, 1) ON CONFLICT(case_id, day) DO UPDATE SET n = n + 1").bind(id, today),
      ]);
    }
  } else {
    // Only a vote cast from this address today can be taken back.
    const r = await env.DB.prepare("DELETE FROM seen WHERE k = ?").bind(seenKey).run();
    if (r.meta.changes === 1) {
      await env.DB.batch([
        env.DB.prepare("UPDATE votes SET total = MAX(total - 1, 0) WHERE case_id = ?").bind(id),
        env.DB.prepare("UPDATE daily SET n = MAX(n - 1, 0) WHERE case_id = ? AND day = ?").bind(id, today),
      ]);
    }
  }
  const row = await env.DB.prepare("SELECT total FROM votes WHERE case_id = ?").bind(id).first();
  return { status: 200, body: { id, total: row ? row.total : 0 } };
}

// One hourly counter per (purpose, address), shared by votes and sign-ups.
async function overLimit(env, purpose, address, limit, now) {
  const key = await hash(env.SALT || "", purpose, address, Math.floor(now / 3600e3));
  const row = await env.DB.prepare(
    "INSERT INTO rate (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n",
  ).bind(key, now + 3600e3).first();
  return row && row.n > limit;
}

const kit = (env, path, init = {}) =>
  (env.fetch || fetch)(KIT + path, {
    ...init,
    headers: { "X-Kit-Api-Key": env.KIT_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
  });

export async function subscribe(env, { email, address, referrer, now = Date.now() }) {
  if (!env.KIT_API_KEY || !env.KIT_FORM_ID) return { status: 503, body: { error: "not_configured" } };
  email = String(email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { status: 400, body: { error: "Enter a valid email address." } };
  if (await overLimit(env, "subscribe", address, SUBSCRIBE_LIMIT, now))
    return { status: 429, body: { error: "Too many attempts, try again in an hour." } };
  // Create (or find) the subscriber as unconfirmed, then add them to the double opt-in form,
  // which makes Kit send the confirmation email.
  const created = await kit(env, "/subscribers", { method: "POST", body: JSON.stringify({ email_address: email, state: "inactive" }) });
  if (created.status === 422) return { status: 400, body: { error: "Enter a valid email address." } };
  if (!created.ok) return { status: 502, body: { error: "The newsletter service didn't answer. Try again shortly." } };
  const added = await kit(env, `/forms/${encodeURIComponent(env.KIT_FORM_ID)}/subscribers`, {
    method: "POST",
    body: JSON.stringify({ email_address: email, ...(referrer ? { referrer } : {}) }),
  });
  if (!added.ok) return { status: 502, body: { error: "The newsletter service didn't answer. Try again shortly." } };
  return { status: 200, body: { ok: true } };
}

/** A reader's suggestion: a public http(s) link, plus an optional short note. */
export async function submit(env, { url, note, address, now = Date.now() }) {
  let link;
  try {
    link = new URL(String(url || "").trim());
  } catch {
    return { status: 400, body: { error: "Enter the full link, starting with https://" } };
  }
  if (!/^https?:$/.test(link.protocol) || !link.hostname.includes(".") || link.href.length > 2000)
    return { status: 400, body: { error: "Enter the full link, starting with https://" } };
  if (await overLimit(env, "submit", address, SUBMIT_LIMIT, now))
    return { status: 429, body: { error: "Too many submissions, try again in an hour." } };
  link.hash = "";
  const text = String(note || "").trim().slice(0, NOTE_MAX);
  // The same link twice is kept once.
  await env.DB.prepare("INSERT OR IGNORE INTO submissions (url, note, created) VALUES (?, ?, ?)").bind(link.href, text, now).run();
  return { status: 200, body: { ok: true } };
}

async function subscriberCount(env, now) {
  if (!env.KIT_API_KEY) return null;
  const cached = await env.DB.prepare("SELECT v, exp FROM meta WHERE k = 'subscribers'").first();
  if (cached && cached.exp > now) return Number(cached.v);
  try {
    const res = await kit(env, "/subscribers?status=active&include_total_count=true&per_page=1");
    if (!res.ok) throw new Error(String(res.status));
    const n = Number((await res.json())?.pagination?.total_count);
    if (!Number.isFinite(n)) throw new Error("no count");
    await env.DB.prepare("INSERT INTO meta (k, v, exp) VALUES ('subscribers', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
      .bind(String(n), now + STATS_TTL_MS).run();
    return n;
  } catch {
    return cached ? Number(cached.v) : null; // a stale count beats none
  }
}

export async function stats(env, now = Date.now()) {
  const [total, recent] = await env.DB.batch([
    env.DB.prepare("SELECT COALESCE(SUM(total), 0) AS n FROM votes"),
    env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM daily WHERE day >= ?").bind(day(now - DAY_MS)),
  ]);
  return {
    subscribers: await subscriberCount(env, now),
    votesTotal: total.results[0]?.n || 0,
    votes24h: Math.max(0, recent.results[0]?.n || 0),
  };
}

export async function cleanup(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM seen WHERE exp < ?").bind(now),
    env.DB.prepare("DELETE FROM rate WHERE exp < ?").bind(now),
    env.DB.prepare("DELETE FROM daily WHERE day < ?").bind(day(now - 3 * DAY_MS)),
    env.DB.prepare("DELETE FROM submissions WHERE created < ?").bind(now - SUBMISSION_DAYS * DAY_MS),
  ]);
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method === "GET" && pathname === "/counts") {
        return json({ counts: await counts(env) }, 200, { ...cors, "Cache-Control": "public, max-age=30" });
      }
      if (req.method === "GET" && pathname === "/stats") {
        return json(await stats(env), 200, { ...cors, "Cache-Control": "public, max-age=60" });
      }
      if (req.method === "POST" && (pathname === "/subscribe" || pathname === "/submit")) {
        // A plain form post (no JavaScript) is redirected back to the page it came from.
        const isForm = (req.headers.get("Content-Type") || "").includes("application/x-www-form-urlencoded");
        const back = returnUrl(req, env);
        if (!isForm && !cors["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed." }, 403, cors);
        if (isForm && !back) return json({ error: "Origin not allowed." }, 403, cors);
        let body;
        try {
          body = isForm ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json();
        } catch {
          return json({ error: "Send JSON." }, 400, cors);
        }
        const address = req.headers.get("CF-Connecting-IP") || "unknown";
        // Bots fill the hidden "website" field; pretend it worked.
        const r = body?.website
          ? { status: 200, body: { ok: true } }
          : pathname === "/submit"
            ? await submit(env, { url: body?.url, note: body?.note, address })
            : await subscribe(env, { email: body?.email, address, referrer: back || req.headers.get("Origin") || "" });
        if (isForm) {
          const u = new URL(back);
          u.searchParams.set(pathname === "/submit" ? "submitted" : "subscribed", r.status === 200 ? "1" : "0");
          return Response.redirect(u.toString(), 303);
        }
        return json(r.body, r.status, cors);
      }
      if (req.method === "POST" && pathname === "/vote") {
        if (!cors["Access-Control-Allow-Origin"]) return json({ error: "Origin not allowed." }, 403, cors);
        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Send JSON: { id, on }." }, 400, cors);
        }
        if (!ID.test(String(body?.id || "")) || typeof body.on !== "boolean") return json({ error: "Send { id, on }." }, 400, cors);
        const address = req.headers.get("CF-Connecting-IP") || "unknown";
        const r = await vote(env, { id: body.id, on: body.on, address });
        return json(r.body, r.status, cors);
      }
      return json({ error: "Not found." }, 404, cors);
    } catch (err) {
      return json({ error: "Something went wrong." }, 500, cors);
    }
  },
  async scheduled(_event, env) {
    await cleanup(env);
  },
};
