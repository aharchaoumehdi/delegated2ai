// Validates every case file against the schema. Exits non-zero on any error.
import { loadCases } from "./lib/cases.mjs";
import { canonicalUrl } from "./lib/util.mjs";

const { cases, errors } = await loadCases();

const seen = new Map();
for (const c of cases) {
  const key = canonicalUrl(c.source.url);
  if (seen.has(key)) errors.push(`Duplicate source URL ${key} in "${c.id}" and "${seen.get(key)}"`);
  seen.set(key, c.id);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
const published = cases.filter((c) => c.status === "published").length;
console.log(`✓ ${cases.length} case files valid (${published} published, ${cases.length - published} queued/rejected)`);
