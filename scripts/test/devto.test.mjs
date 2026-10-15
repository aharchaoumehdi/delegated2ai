import { test } from "node:test";
import assert from "node:assert/strict";
import { collect } from "../collectors/devto.mjs";

const since = new Date("2026-10-14T00:00:00Z");
const cfg = { tags: ["ai", "agents", "mcp"], minReactions: 10 };
const article = (id, extra = {}) => ({
  url: `https://dev.to/a/${id}`,
  title: `Post ${id}`,
  description: "",
  user: { name: "A" },
  published_at: "2026-10-15T00:00:00Z",
  positive_reactions_count: 20,
  comments_count: 1,
  ...extra,
});
const httpError = (status, retryAfter = null) => Object.assign(new Error(`HTTP ${status}`), { status, retryAfter });
const tagOf = (url) => new URL(url).searchParams.get("tag");

test("a rate-limited tag is retried once and kept when the retry succeeds", async () => {
  const calls = [];
  const waits = [];
  const fetchJSON = async (url) => {
    calls.push(tagOf(url));
    if (tagOf(url) === "agents" && calls.filter((t) => t === "agents").length === 1) throw httpError(429, 2);
    return [article(tagOf(url))];
  };
  const out = await collect(cfg, { since }, { fetchJSON, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(out.map((a) => a.title), ["Post ai", "Post agents", "Post mcp"]);
  assert.deepEqual(out.errors, []);
  assert.ok(waits.includes(2000), "honours Retry-After");
});

test("one failing tag keeps the other tags' results and reports the failure", async () => {
  const fetchJSON = async (url) => {
    if (tagOf(url) === "mcp") throw httpError(429);
    return [article(tagOf(url))];
  };
  const out = await collect(cfg, { since }, { fetchJSON, sleep: async () => {} });
  assert.equal(out.length, 2);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /^mcp: HTTP 429/);
});

test("articles under several tags are kept once; old and low-reaction ones are dropped", async () => {
  const fetchJSON = async () => [
    article("shared"),
    article("old", { published_at: "2026-10-01T00:00:00Z" }),
    article("quiet", { positive_reactions_count: 2 }),
  ];
  const out = await collect(cfg, { since }, { fetchJSON, sleep: async () => {} });
  assert.deepEqual(out.map((a) => a.title), ["Post shared"]);
});

test("the source fails as a whole only when every tag fails", async () => {
  const fetchJSON = async () => {
    throw httpError(500);
  };
  await assert.rejects(collect(cfg, { since }, { fetchJSON, sleep: async () => {} }), /HTTP 500/);
});
