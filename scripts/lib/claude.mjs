// One structured-output call to Claude, shared by the curator and the write-up backfill.
//
// Requests go through the beta endpoint with server-side refusal fallbacks
// (`fallbacks: "default"`), so a safety-classifier decline on one model is retried on
// another inside the same call. If that beta request is ever rejected as invalid, the
// helper switches to the plain endpoint for the rest of the run.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const MODEL = process.env.CURATOR_MODEL || "claude-opus-5-5";
export const EFFORT = process.env.CURATOR_EFFORT || "medium";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client;
let useFallbacks = process.env.CURATOR_FALLBACKS !== "off";

export function setClient(c) {
  client = c; // tests inject a client with a fake fetch
}

/**
 * @param {{ system: string, user: string, schema: import("zod").ZodType, maxTokens?: number }} args
 * @returns {Promise<{ parsed: any, model: string }>}
 */
export async function parseStructured({ system, user, schema, maxTokens = 16000 }) {
  client ??= new Anthropic();
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: EFFORT, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  };
  let response;
  if (useFallbacks) {
    try {
      response = await client.beta.messages.parse({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn(`Fallback-enabled request rejected (${err.message}); continuing without fallbacks.`);
      useFallbacks = false;
    }
  }
  response ??= await client.messages.parse(params);
  if (response.stop_reason === "refusal") throw new Error("model declined this batch");
  if (!response.parsed_output) throw new Error(`unparseable output (stop_reason: ${response.stop_reason})`);
  return { parsed: response.parsed_output, model: response.model || MODEL };
}

export { Anthropic };
