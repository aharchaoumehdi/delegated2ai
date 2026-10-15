import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCandidates } from "../lib/rank.mjs";

const item = (source, title, score) => ({ source, title, text: "", engagement: { score, comments: 0 } });
const config = { keywords: ["agent"], maxCandidates: 2, alwaysCurate: ["submission", "x"] };

test("paid and submitted items always reach the curator, outside the cap and keyword filter", () => {
  const items = [
    item("hackernews", "agent one", 100),
    item("hackernews", "agent two", 50),
    item("hackernews", "agent three", 10),
    item("x", "no keyword here, zero likes", 0),
    item("x", "another post", 0),
    item("submission", "reader tip", 0),
  ];
  const out = selectCandidates(items, config);
  assert.equal(out.filter((c) => c.source === "x").length, 2);
  assert.equal(out.filter((c) => c.source === "submission").length, 1);
  assert.equal(out.filter((c) => c.source === "hackernews").length, 2, "free pool still capped");
});

test("free items need a keyword match; low engagement alone does not exclude them", () => {
  const items = [item("devto", "an agent built with care", 0), item("devto", "unrelated cooking post", 500)];
  const out = selectCandidates(items, { ...config, maxCandidates: 10 });
  assert.deepEqual(out.map((c) => c.title), ["an agent built with care"]);
});

test("without alwaysCurate, only submissions are guaranteed", () => {
  const out = selectCandidates([item("x", "post", 0)], { keywords: ["agent"], maxCandidates: 10 });
  assert.equal(out.length, 0);
});
