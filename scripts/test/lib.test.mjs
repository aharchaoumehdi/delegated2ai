import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, slugify, truncate } from "../lib/util.mjs";
import { normalizePlatform } from "../lib/taxonomy.mjs";
import { CaseSchema } from "../lib/schema.mjs";
import { parseFeed } from "../collectors/feeds.mjs";

test("canonicalUrl strips tracking and normalises hosts", () => {
  assert.equal(canonicalUrl("https://www.example.com/post/?utm_source=x&id=3#top"), "https://example.com/post/?id=3");
  assert.equal(canonicalUrl("https://twitter.com/a/status/1?s=20"), "https://x.com/a/status/1");
  assert.equal(canonicalUrl("https://old.reddit.com/r/ClaudeAI/comments/abc/"), "https://reddit.com/r/ClaudeAI/comments/abc");
});

test("slugify breaks on word boundaries", () => {
  assert.equal(slugify("Claude Code migrated a 40k-line Flask app!"), "claude-code-migrated-a-40k-line-flask-app");
  const long = slugify("A month handing 20 real tasks to Devin: 3 successes, 14 failures and more words here");
  assert.ok(long.length <= 60 && !long.endsWith("-"));
  assert.ok(!/failur$/.test(long));
});

test("truncate adds an ellipsis at a word boundary", () => {
  assert.equal(truncate("one two three four", 10), "one two…");
});

test("normalizePlatform maps aliases", () => {
  assert.equal(normalizePlatform("codex cli"), "OpenAI Codex");
  assert.equal(normalizePlatform("Claude-Code"), "Claude Code");
  assert.equal(normalizePlatform(null), "Other");
  assert.equal(normalizePlatform("not specified"), "Other");
  assert.equal(normalizePlatform("SomeNewTool"), "SomeNewTool");
});

test("parseFeed reads RSS and Atom", () => {
  const rss = `<rss><channel><title>Blog</title><item><title>Hello &amp; bye</title><link>https://a.com/1</link><pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Body</p>]]></description></item></channel></rss>`;
  const [r] = parseFeed(rss);
  assert.equal(r.title, "Hello & bye");
  assert.equal(r.url, "https://a.com/1");
  assert.equal(r.text, "Body");
  const atom = `<feed><title>Atom</title><entry><title>E</title><link rel="alternate" href="https://b.com/2"/><updated>2026-10-14T00:00:00Z</updated><summary>S</summary></entry></feed>`;
  assert.equal(parseFeed(atom)[0].url, "https://b.com/2");
});

test("CaseSchema rejects unknown domains and bad URLs", () => {
  const ok = {
    id: "x-y", title: "A valid title here", summary: "A summary that is long enough to pass.", domain: "Science",
    platform: "Claude Code", model: null, tools: [], agent_role: "Did the steps end to end.", outcome: null,
    evidence: "Demo", difficulty: "Beginner", tags: ["research"],
    source: { url: "https://example.com", name: "Blog", author: null, published: null },
    added: "2026-10-15", status: "published", score: 7, featured: false, curation: { method: "manual" },
  };
  assert.ok(CaseSchema.safeParse(ok).success);
  assert.ok(!CaseSchema.safeParse({ ...ok, domain: "Space" }).success);
  assert.ok(!CaseSchema.safeParse({ ...ok, source: { ...ok.source, url: "not a url" } }).success);
});

test("write-up fields are optional but validated", async () => {
  const { CaseSchema } = await import("../lib/schema.mjs");
  const { loadCases } = await import("../lib/cases.mjs");
  const { cases } = await loadCases();
  const { _file, ...base } = cases[0];
  assert.ok(CaseSchema.safeParse({ ...base, what_they_did: undefined, prompt: undefined }).success);
  assert.ok(CaseSchema.safeParse({ ...base, what_they_did: "x".repeat(60), how_it_went: null, worth_knowing: null, prompt: null }).success);
  assert.ok(!CaseSchema.safeParse({ ...base, what_they_did: "too short" }).success);
  assert.ok(!CaseSchema.safeParse({ ...base, prompt: "x".repeat(1600) }).success);
});

test("trending puts recent votes first, then all-time votes, then the editor's order", async () => {
  const { trendingOrder } = await import("../../site/assets/render.js");
  const list = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(trendingOrder(list).map((c) => c.id), ["a", "b", "c", "d"]);
  assert.deepEqual(trendingOrder(list, { c: [5, 0], d: [1, 1] }).map((c) => c.id), ["d", "c", "a", "b"]);
});

test("summaries well over 30 words are queued for shortening; rejected entries are left alone", async () => {
  const { needsShorterSummary, wordCount } = await import("../enrich.mjs");
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const long = words(34);
  assert.equal(needsShorterSummary({ status: "published", summary: words(33) }), false, "a little slack");
  assert.equal(wordCount("  one two\nthree "), 3);
  assert.equal(needsShorterSummary({ status: "published", summary: long }), true);
  assert.equal(needsShorterSummary({ status: "published", summary: "A short one." }), false);
  assert.equal(needsShorterSummary({ status: "rejected", summary: long }), false);
});
