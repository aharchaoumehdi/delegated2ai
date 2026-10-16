// One-time setup of Cloudflare Email Routing for the site's domain: turns it on (MX/SPF
// records), adds the destination inbox (Cloudflare emails it a verification link) and
// creates one forwarding rule per address. Safe to run again: anything that already exists
// is left alone. Run by .github/workflows/email-routing.yml; see docs/setup.md, "Email".
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… DOMAIN=delegatedto.ai \
//   DESTINATION=you@example.com ADDRESSES=hello,sponsors node scripts/setup-email-routing.mjs
import { appendFile } from "node:fs/promises";

const API = "https://api.cloudflare.com/client/v4";
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, DOMAIN: domain, DESTINATION: destination } = process.env;
const names = (process.env.ADDRESSES || "hello,sponsors").split(",").map((s) => s.trim()).filter(Boolean);
const log = [];
const say = (line) => (console.log(line), log.push(line));

async function cf(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, status: res.status, json };
}
const why = (r) => `HTTP ${r.status}: ${(r.json.errors || []).map((e) => `${e.code} ${e.message}`).join("; ") || "no details"}`;

async function main() {
  if (!token || !account || !domain || !destination) throw new Error("Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DOMAIN and DESTINATION.");

  const zones = await cf("GET", `/zones?name=${encodeURIComponent(domain)}`);
  const zone = zones.json.result?.[0]?.id;
  if (!zone) throw new Error(`Can't see the ${domain} zone (${why(zones)}). The token needs Zone · Zone · Read.`);

  // 1. Turn Email Routing on (adds and locks the MX and SPF records).
  const status = await cf("GET", `/zones/${zone}/email/routing`);
  if (status.json.result?.enabled) say(`Email Routing is already on for ${domain}.`);
  else {
    let on = await cf("POST", `/zones/${zone}/email/routing/dns`, { name: domain });
    if (!on.ok) on = await cf("POST", `/zones/${zone}/email/routing/enable`, {}); // older endpoint
    if (!on.ok) throw new Error(`Couldn't turn on Email Routing (${why(on)}). The token needs Zone · Email Routing Rules · Edit and Zone · DNS · Edit.`);
    say(`Turned on Email Routing for ${domain}.`);
  }

  // 2. The destination inbox. Cloudflare emails it a link; forwarding starts once it is clicked.
  const list = await cf("GET", `/accounts/${account}/email/routing/addresses?per_page=50`);
  if (!list.ok) throw new Error(`Couldn't list destination addresses (${why(list)}). The token needs Account · Email Routing Addresses · Edit.`);
  const known = (list.json.result || []).find((a) => a.email.toLowerCase() === destination.toLowerCase());
  if (known) say(`Destination ${destination} is already added (${known.verified ? "verified" : "waiting for you to click the verification email"}).`);
  else {
    const add = await cf("POST", `/accounts/${account}/email/routing/addresses`, { email: destination });
    if (!add.ok) throw new Error(`Couldn't add ${destination} (${why(add)}).`);
    say(`Added ${destination}: Cloudflare has emailed it a verification link. Click it to start forwarding.`);
  }

  // 3. One forwarding rule per address.
  const rules = await cf("GET", `/zones/${zone}/email/routing/rules?per_page=50`);
  if (!rules.ok) throw new Error(`Couldn't list routing rules (${why(rules)}).`);
  for (const name of names) {
    const address = `${name}@${domain}`;
    const exists = (rules.json.result || []).some((r) => (r.matchers || []).some((m) => m.type === "literal" && m.value?.toLowerCase() === address));
    if (exists) {
      say(`${address} already has a rule.`);
      continue;
    }
    const rule = await cf("POST", `/zones/${zone}/email/routing/rules`, {
      name: `Forward ${address}`,
      enabled: true,
      matchers: [{ type: "literal", field: "to", value: address }],
      actions: [{ type: "forward", value: [destination] }],
    });
    if (!rule.ok) throw new Error(`Couldn't create the rule for ${address} (${why(rule)}).`);
    say(`${address} now forwards to ${destination}.`);
  }
}

try {
  await main();
} catch (err) {
  say(`Stopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Email Routing\n${log.map((l) => `- ${l}`).join("\n")}\n`);
}
