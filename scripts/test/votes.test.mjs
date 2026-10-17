// Exercises the votes Worker against a real SQLite database through a minimal
// stand-in for Cloudflare D1's API (prepare/bind/run/first/all/batch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { counts, vote, cleanup, subscribe, stats, submit } from "../../worker/src/index.js";

function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../worker/schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => Promise.all(list.map((s) => (/^\s*select/i.test(s.sql ?? "") ? s.all() : s.all()))),
  };
}
const envWith = () => ({ DB: d1(), SALT: "s", ALLOWED_ORIGINS: "https://delegatedto.ai" });
const T = Date.parse("2026-10-16T12:00:00Z");

test("a vote counts once per visitor per day and can be taken back", async () => {
  const env = envWith();
  assert.deepEqual((await vote(env, { id: "a", on: true, address: "1.1.1.1", now: T })).body, { id: "a", total: 1 });
  assert.deepEqual((await vote(env, { id: "a", on: true, address: "1.1.1.1", now: T })).body, { id: "a", total: 1 });
  assert.deepEqual((await vote(env, { id: "a", on: true, address: "2.2.2.2", now: T })).body, { id: "a", total: 2 });
  assert.deepEqual((await vote(env, { id: "a", on: false, address: "1.1.1.1", now: T })).body, { id: "a", total: 1 });
  // taking back a vote you never cast changes nothing
  assert.deepEqual((await vote(env, { id: "a", on: false, address: "3.3.3.3", now: T })).body, { id: "a", total: 1 });
  assert.deepEqual(await counts(env, T), { a: [1, 1] });
});

test("recent counts cover today and yesterday only", async () => {
  const env = envWith();
  await vote(env, { id: "old", on: true, address: "x", now: T - 3 * 86400e3 });
  await vote(env, { id: "new", on: true, address: "x", now: T });
  assert.deepEqual(await counts(env, T), { old: [1, 0], new: [1, 1] });
});

test("rate limit stops floods from one address", async () => {
  const env = envWith();
  let last;
  for (let i = 0; i < 45; i++) last = await vote(env, { id: `c${i}`, on: true, address: "9.9.9.9", now: T });
  assert.equal(last.status, 429);
});

test("no address is stored, and guards expire", async () => {
  const env = envWith();
  await vote(env, { id: "a", on: true, address: "203.0.113.7", now: T });
  const rows = JSON.stringify([...(await env.DB.prepare("SELECT * FROM seen").all()).results, ...(await env.DB.prepare("SELECT * FROM rate").all()).results]);
  assert.ok(!rows.includes("203.0.113.7"));
  await cleanup(env, T + 3 * 86400e3);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM seen").first()).n, 0);
  assert.deepEqual(await counts(env, T + 3 * 86400e3), { a: [1, 0] }, "totals survive cleanup");
});

test("HTTP: CORS, validation and the vote round trip", async () => {
  const env = envWith();
  const call = (method, path, body, origin = "https://delegatedto.ai") =>
    worker.fetch(new Request(`https://votes.example${path}`, {
      method, headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" }, body: body && JSON.stringify(body),
    }), env);
  let r = await call("POST", "/vote", { id: "a", on: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://delegatedto.ai");
  assert.deepEqual(await r.json(), { id: "a", total: 1 });
  r = await call("GET", "/counts");
  assert.deepEqual(await r.json(), { counts: { a: [1, 1] } });
  assert.equal((await call("POST", "/vote", { id: "Bad Id!", on: true })).status, 400);
  assert.equal((await call("POST", "/vote", { id: "a", on: true }, "https://evil.example")).status, 403);
  assert.equal((await call("OPTIONS", "/vote")).status, 204);
});

// A fake Kit API that records calls.
function fakeKit({ total = 7, fail = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, key: init.headers["X-Kit-Api-Key"] });
    if (fail) return new Response("{}", { status: 500 });
    if (url.includes("/subscribers?")) return Response.json({ subscribers: [], pagination: { total_count: total } });
    return Response.json({ subscriber: { email_address: "x" } }, { status: 201 });
  };
  return { calls, fetch };
}
const kitEnv = (kit) => ({ ...envWith(), KIT_API_KEY: "k", KIT_FORM_ID: "123", fetch: kit.fetch });

test("subscribe creates an unconfirmed subscriber and adds them to the double opt-in form", async () => {
  const kit = fakeKit();
  const env = kitEnv(kit);
  const r = await subscribe(env, { email: " Ada@Example.com ", address: "1.1.1.1", referrer: "https://delegatedto.ai/", now: T });
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.deepEqual(kit.calls.map((c) => [c.method, c.url.replace("https://api.kit.com/v4", "")]), [["POST", "/subscribers"], ["POST", "/forms/123/subscribers"]]);
  assert.deepEqual(kit.calls[0].body, { email_address: "ada@example.com", state: "inactive" });
  assert.equal(kit.calls[1].body.email_address, "ada@example.com");
  assert.equal(kit.calls[0].key, "k");
  const tables = ["rate", "seen", "meta", "votes", "daily"];
  const stored = JSON.stringify(await Promise.all(tables.map(async (t) => (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results)));
  assert.ok(!stored.includes("ada@"), "no email is stored");
});

test("subscribe validates, rate-limits, and reports when it isn't set up", async () => {
  assert.equal((await subscribe(envWith(), { email: "a@b.co", address: "x", now: T })).status, 503);
  const kit = fakeKit();
  const env = kitEnv(kit);
  assert.equal((await subscribe(env, { email: "not-an-email", address: "x", now: T })).status, 400);
  assert.equal(kit.calls.length, 0);
  let last;
  for (let i = 0; i < 6; i++) last = await subscribe(env, { email: `a${i}@b.co`, address: "x", now: T });
  assert.equal(last.status, 429);
  assert.equal((await subscribe(kitEnv(fakeKit({ fail: true })), { email: "a@b.co", address: "y", now: T })).status, 502);
});

test("stats: vote totals, and a cached subscriber count", async () => {
  const kit = fakeKit({ total: 42 });
  const env = kitEnv(kit);
  await vote(env, { id: "a", on: true, address: "1", now: T });
  await vote(env, { id: "b", on: true, address: "1", now: T - 3 * 86400e3 });
  assert.deepEqual(await stats(env, T), { subscribers: 42, votesTotal: 2, votes24h: 1 });
  await stats(env, T + 60e3);
  assert.equal(kit.calls.length, 1, "the count is cached");
  assert.equal((await stats(envWith(), T)).subscribers, null, "no provider, no count");
});

test("HTTP: a plain form post redirects back with the outcome; bots get a quiet success", async () => {
  const kit = fakeKit();
  const env = kitEnv(kit);
  const post = (body, referer = "https://delegatedto.ai/use-case/x/") =>
    worker.fetch(new Request("https://votes.example/subscribe", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: referer, "CF-Connecting-IP": "5.5.5.5" }, body: new URLSearchParams(body).toString(),
    }), env);
  let r = await post({ email: "a@b.co" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), "https://delegatedto.ai/use-case/x/?subscribed=1");
  r = await post({ email: "a@b.co", website: "spam" });
  assert.equal(r.headers.get("Location"), "https://delegatedto.ai/use-case/x/?subscribed=1");
  assert.equal(kit.calls.length, 2, "the honeypot post never reached Kit");
  assert.equal((await post({ email: "a@b.co" }, "https://evil.example/")).status, 403);
});

test("submit keeps a link and a note, once per link, and nothing about the sender", async () => {
  const env = envWith();
  assert.deepEqual(await submit(env, { url: " https://example.com/post#top ", note: "  Great one  ", address: "1.1.1.1", now: T }), { status: 200, body: { ok: true } });
  await submit(env, { url: "https://example.com/post", note: "again", address: "2.2.2.2", now: T });
  const rows = (await env.DB.prepare("SELECT * FROM submissions").all()).results.map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ url: "https://example.com/post", note: "Great one", created: T }]);
  for (const url of ["", "example.com/post", "javascript:alert(1)", "ftp://example.com/x", "https://localhost/x"])
    assert.equal((await submit(env, { url, address: "1.1.1.1", now: T })).status, 400, url);
  const guards = JSON.stringify((await env.DB.prepare("SELECT * FROM rate").all()).results);
  assert.ok(!guards.includes("1.1.1.1"));
  await cleanup(env, T + 31 * 86400e3);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions").first()).n, 0, "kept 30 days");
});

test("HTTP: submit by JSON and by plain form post", async () => {
  const env = envWith();
  const r = await worker.fetch(new Request("https://votes.example/submit", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://delegatedto.ai", "CF-Connecting-IP": "5.5.5.5" }, body: JSON.stringify({ url: "https://example.com/a" }),
  }), env);
  assert.equal(r.status, 200);
  const form = await worker.fetch(new Request("https://votes.example/submit", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://delegatedto.ai/submit/", "CF-Connecting-IP": "5.5.5.5" }, body: "url=not-a-link",
  }), env);
  assert.equal(form.headers.get("Location"), "https://delegatedto.ai/submit/?submitted=0");
  for (let i = 0; i < 10; i++) await submit(env, { url: `https://example.com/${i}`, address: "9.9.9.9", now: T });
  assert.equal((await submit(env, { url: "https://example.com/z", address: "9.9.9.9", now: T })).status, 429);
});
