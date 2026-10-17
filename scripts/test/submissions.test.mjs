import { test } from "node:test";
import assert from "node:assert/strict";
import { fromDatabase } from "../collectors/submissions.mjs";

test("reads new site submissions from the votes database through Cloudflare's API", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method || "GET", url.replace("https://api.cloudflare.com/client/v4", ""), init.body && JSON.parse(init.body), init.headers.Authorization]);
    if (url.includes("?name=")) return Response.json({ success: true, result: [{ name: "delegatedto-votes", uuid: "db1" }] });
    return Response.json({ success: true, result: [{ results: [
      { url: "https://example.com/a", note: "A shop owner automated reorders", created: Date.parse("2026-10-17T10:00:00Z") },
      { url: "https://example.com/b", note: "", created: Date.parse("2026-10-17T11:00:00Z") },
    ] }] });
  };
  const since = new Date("2026-10-16T06:00:00Z");
  const out = await fromDatabase({ database: "delegatedto-votes" }, { since, env: { CLOUDFLARE_API_TOKEN: " t\n", CLOUDFLARE_ACCOUNT_ID: "acc" }, fetch });
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [["GET", "/accounts/acc/d1/database?name=delegatedto-votes"], ["POST", "/accounts/acc/d1/database/db1/query"]]);
  assert.deepEqual(calls[1][2].params, [since.getTime()]);
  assert.equal(calls[0][3], "Bearer t");
  assert.equal(out.length, 2);
  assert.equal(out[0].source, "submission");
  assert.equal(out[0].url, "https://example.com/a");
  assert.ok(out[0].text.includes("A shop owner automated reorders"));
  assert.equal(out[1].title, "https://example.com/b");
  assert.equal(out[1].author, null);
});

test("skips the database when Cloudflare credentials are missing", async () => {
  assert.equal(await fromDatabase({ database: "x" }, { since: new Date(), env: {} }), null);
});
