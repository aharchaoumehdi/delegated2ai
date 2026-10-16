// Exercises the votes Worker against a real SQLite database through a minimal
// stand-in for Cloudflare D1's API (prepare/bind/run/first/all/batch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { counts, vote, cleanup } from "../../worker/src/index.js";

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
