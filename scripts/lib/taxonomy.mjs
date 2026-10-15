import { readFileSync } from "node:fs";
import { path } from "./util.mjs";

export const taxonomy = JSON.parse(readFileSync(path("config", "taxonomy.json"), "utf8"));
export const DOMAINS = taxonomy.domains.map((d) => d.name);
export const EVIDENCE = taxonomy.evidence.map((e) => e.name);
export const DIFFICULTY = taxonomy.difficulty;
export const PLATFORMS = taxonomy.platforms.map((p) => p.name);

/** Map free-text platform names ("codex cli", "Claude-Code") to canonical names. */
export function normalizePlatform(raw) {
  if (!raw) return "Not specified";
  const needle = String(raw).trim().toLowerCase();
  for (const p of taxonomy.platforms) {
    if (p.name.toLowerCase() === needle || p.aliases.includes(needle)) return p.name;
  }
  return String(raw).trim();
}
