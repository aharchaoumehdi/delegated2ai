import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDigest, renderDigest, sendDigest } from "../digest.mjs";

const c = (id, added, score, extra = {}) => ({
  id, added, score, status: "published", title: `Title ${id}`, summary: `Summary <${id}>`, domain: "Software", platform: "Claude Code", prompt: "p", ...extra,
});

test("picks today's published use cases, best first, at most five", () => {
  const cases = [
    c("a", "2026-10-16", 6), c("b", "2026-10-16", 9), c("old", "2026-10-15", 10),
    c("q", "2026-10-16", 10, { status: "review" }), ...["c", "d", "e", "f"].map((id) => c(id, "2026-10-16", 5)),
  ];
  assert.deepEqual(pickDigest(cases, "2026-10-16").map((x) => x.id), ["b", "a", "c", "d", "e"]);
});

test("renders escaped, tracked links to each use case", () => {
  const email = renderDigest([c("a", "2026-10-16", 9)], { siteUrl: "https://delegatedto.ai/", siteName: "delegatedto.ai", date: "2026-10-16", total: 91 });
  assert.equal(email.subject, "1 new thing people handed to AI agents");
  assert.ok(email.html.includes("https://delegatedto.ai/use-case/a/?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=digest-2026-10-16"));
  assert.ok(email.html.includes("Summary &lt;a&gt;"));
  assert.ok(email.html.includes("Browse all 91 use cases"));
});

test("schedules one broadcast per day", async () => {
  const calls = [];
  let existing = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method || "GET", url.replace("https://api.kit.com/v4", ""), init.body && JSON.parse(init.body)]);
    if (!init.method) return Response.json({ broadcasts: existing });
    return Response.json({ broadcast: { id: 7 } }, { status: 201 });
  };
  const email = { subject: "s", preview: "p", html: "<p>x</p>" };
  const now = Date.parse("2026-10-16T06:30:00Z");
  assert.deepEqual(await sendDigest({ key: "k", date: "2026-10-16", email, fetch, now }), { id: 7 });
  const sent = calls[1][2];
  assert.equal(sent.description, "digest 2026-10-16");
  assert.equal(sent.send_at, "2026-10-16T06:35:00.000Z");
  assert.equal(sent.public, false);
  existing = [{ id: 7, description: "digest 2026-10-16" }];
  assert.deepEqual(await sendDigest({ key: "k", date: "2026-10-16", email, fetch, now }), { skipped: "already sent", id: 7 });
});
