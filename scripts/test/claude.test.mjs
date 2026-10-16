import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { parseStructured, setClient } from "../lib/claude.mjs";

const Schema = z.object({ items: z.array(z.object({ id: z.string(), ok: z.boolean() })) });
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
const message = (json) => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 1, output_tokens: 1 },
});

test("sends fallbacks on the beta endpoint and parses the structured reply", async () => {
  const seen = [];
  setClient(new Anthropic({ apiKey: "test", maxRetries: 0, fetch: async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return reply(message({ items: [{ id: "a", ok: true }] }));
  } }));
  const { parsed, model } = await parseStructured({ system: "s", user: "u", schema: Schema });
  assert.deepEqual(parsed, { items: [{ id: "a", ok: true }] });
  assert.equal(model, "claude-opus-5-5");
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/v1\/messages\?beta=true/);
  assert.match(seen[0].headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  assert.equal(seen[0].body.fallbacks, "default");
  assert.equal(seen[0].body.model, "claude-opus-5-5");
  assert.equal(seen[0].body.output_config.effort, "medium");
  assert.equal(seen[0].body.output_config.format.type, "json_schema");
  assert.equal(seen[0].body.betas, undefined, "betas travel as a header, not in the body");
});

test("a rejected fallback request switches to the plain endpoint", async () => {
  const urls = [];
  setClient(new Anthropic({ apiKey: "test", maxRetries: 0, fetch: async (url, init) => {
    urls.push(String(url));
    if (String(url).includes("beta=true")) return reply({ type: "error", error: { type: "invalid_request_error", message: "fallbacks not allowed" } }, 400);
    assert.equal(JSON.parse(init.body).fallbacks, undefined);
    return reply(message({ items: [] }));
  } }));
  const { parsed } = await parseStructured({ system: "s", user: "u", schema: Schema });
  assert.deepEqual(parsed, { items: [] });
  assert.equal(urls.length, 2);
  // later calls skip the beta attempt
  await parseStructured({ system: "s", user: "u", schema: Schema });
  assert.equal(urls.length, 3);
  assert.ok(!urls[2].includes("beta=true"));
});

test("a refusal is reported as an error", async () => {
  setClient(new Anthropic({ apiKey: "test", maxRetries: 0, fetch: async () => reply({ ...message({}), stop_reason: "refusal", content: [] }) }));
  await assert.rejects(parseStructured({ system: "s", user: "u", schema: Schema }), /declined/);
});
