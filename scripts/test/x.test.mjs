import { test } from "node:test";
import assert from "node:assert/strict";
import { collect } from "../collectors/x.mjs";

process.env.X_BEARER_TOKEN = "test";
const since = new Date("2026-10-15T00:00:00Z");
const cfg = {
  minLikes: 0,
  queries: [
    { label: "one", query: "q1", maxResults: 30 },
    { label: "two", query: "q2", maxResults: 20 },
  ],
};
const post = (id, extra = {}) => ({
  id, author_id: "u1", text: `post ${id}`, created_at: "2026-10-15T10:00:00Z",
  public_metrics: { like_count: 3, reply_count: 1 }, ...extra,
});
const page = (posts) => ({ data: posts, includes: { users: [{ id: "u1", username: "maker" }] } });

test("runs every search, de-duplicates posts and records what each search returned", async () => {
  const urls = [];
  const fetchJSON = async (url) => {
    urls.push(new URL(url));
    return new URL(url).searchParams.get("query") === "q1" ? page([post("1"), post("2")]) : page([post("2"), post("3")]);
  };
  const out = await collect(cfg, { since }, { fetchJSON });
  assert.deepEqual(out.map((p) => p.url), ["https://x.com/maker/status/1", "https://x.com/maker/status/2", "https://x.com/maker/status/3"]);
  assert.equal(out.fetched, 4, "billed posts count duplicates");
  assert.deepEqual(out.searches, [{ label: "one", fetched: 2, kept: 2 }, { label: "two", fetched: 2, kept: 1 }]);
  assert.equal(urls[0].searchParams.get("sort_order"), "relevancy");
  assert.equal(urls[0].searchParams.get("max_results"), "30");
  assert.equal(urls[1].searchParams.get("max_results"), "20");
});

test("expands t.co links and keeps the first outside link for the curator", async () => {
  const fetchJSON = async () =>
    page([post("9", {
      text: "Look what I built https://t.co/a and the thread https://t.co/b",
      entities: { urls: [
        { url: "https://t.co/b", expanded_url: "https://x.com/maker/status/8" },
        { url: "https://t.co/a", expanded_url: "https://github.com/maker/agent-tool" },
      ] },
    })]);
  const [p] = await collect({ ...cfg, queries: [cfg.queries[0]] }, { since }, { fetchJSON });
  assert.equal(p.link, "https://github.com/maker/agent-tool");
  assert.match(p.text, /github\.com\/maker\/agent-tool/);
  assert.doesNotMatch(p.text, /t\.co/);
});

test("one failing search is reported; all failing fails the source", async () => {
  const half = async (url) => {
    if (new URL(url).searchParams.get("query") === "q2") throw new Error("HTTP 429");
    return page([post("1")]);
  };
  const out = await collect(cfg, { since }, { fetchJSON: half });
  assert.equal(out.length, 1);
  assert.match(out.errors[0], /^two: HTTP 429/);
  await assert.rejects(collect(cfg, { since }, { fetchJSON: async () => { throw new Error("HTTP 401"); } }), /HTTP 401/);
});

test("the older single-query config still works", async () => {
  const out = await collect({ query: "q", maxResults: 50 }, { since }, { fetchJSON: async () => page([post("1")]) });
  assert.equal(out.length, 1);
  assert.deepEqual(out.searches, [{ label: "default", fetched: 1, kept: 1 }]);
});
