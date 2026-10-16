// Vote counter for delegatedto.ai ("I want this" / the up arrow).
//
//   GET  /counts        → { counts: { "<case id>": [total, last24h], ... } }
//   POST /vote          { id, on: true|false } → { id, total }
//
// Privacy: only counts are kept. To stop one visitor from voting the same use case
// over and over, a salted hash of (address, use case, day) is kept for two days, and a
// salted hash of the address is kept for an hour to rate-limit. Neither stores the
// address itself, and both expire.
const ID = /^[a-z0-9-]{1,100}$/;
const DAY_MS = 86400e3;
const RATE_LIMIT = 40; // vote actions per address per hour

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
  const rateKey = await hash(salt, "rate", address, Math.floor(now / 3600e3));
  const rate = await env.DB.prepare(
    "INSERT INTO rate (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n",
  ).bind(rateKey, now + 3600e3).first();
  if (rate && rate.n > RATE_LIMIT) return { status: 429, body: { error: "Too many votes, try again later." } };

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

export async function cleanup(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM seen WHERE exp < ?").bind(now),
    env.DB.prepare("DELETE FROM rate WHERE exp < ?").bind(now),
    env.DB.prepare("DELETE FROM daily WHERE day < ?").bind(day(now - 3 * DAY_MS)),
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
