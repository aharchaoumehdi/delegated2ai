// Unsubscribes the listed addresses in Kit (e.g. test sign-ups). Touches only those
// addresses and prints nothing about any other subscriber. Run by
// .github/workflows/kit-unsubscribe.yml.
//
//   KIT_API_KEY=… EMAILS=a@x.com,b@y.com node scripts/kit-unsubscribe.mjs
import { appendFile } from "node:fs/promises";

const KIT = "https://api.kit.com/v4";
const key = (process.env.KIT_API_KEY || "").trim();
const emails = (process.env.EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const log = [];
const say = (line) => (console.log(line), log.push(line));

async function kit(path, init = {}) {
  const res = await fetch(KIT + path, { ...init, headers: { "X-Kit-Api-Key": key, "Content-Type": "application/json", Accept: "application/json" } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

try {
  if (!key || !emails.length) throw new Error("Needs KIT_API_KEY and EMAILS.");
  for (const email of emails) {
    const found = await kit(`/subscribers?email_address=${encodeURIComponent(email)}&status=all`);
    if (!found.ok) throw new Error(`Kit lookup failed (HTTP ${found.status}).`);
    const sub = (found.body.subscribers || []).find((s) => s.email_address?.toLowerCase() === email);
    if (!sub) say(`${email}: not in Kit.`);
    else if (sub.state !== "active") say(`${email}: already ${sub.state}, nothing to do.`);
    else {
      const r = await kit(`/subscribers/${sub.id}/unsubscribe`, { method: "POST", body: "{}" });
      say(r.ok ? `${email}: unsubscribed.` : `${email}: couldn't unsubscribe (HTTP ${r.status}).`);
      if (!r.ok) process.exitCode = 1;
    }
  }
} catch (err) {
  say(`Stopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Kit unsubscribe\n${log.map((l) => `- ${l}`).join("\n")}\n`);
}
