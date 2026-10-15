import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { path } from "./util.mjs";
import { CaseSchema } from "./schema.mjs";

export const CASES_DIR = path("data", "cases");

async function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return out;
    throw err;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

/** Load and validate every case file. Returns { cases, errors }. */
export async function loadCases() {
  const files = await walk(CASES_DIR);
  const cases = [];
  const errors = [];
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      errors.push(`${file}: invalid JSON (${err.message})`);
      continue;
    }
    const parsed = CaseSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      errors.push(`${file}:\n    ${issues.join("\n    ")}`);
      continue;
    }
    cases.push({ ...parsed.data, _file: file });
  }
  const ids = new Map();
  for (const c of cases) {
    if (ids.has(c.id)) errors.push(`Duplicate id "${c.id}" in ${c._file} and ${ids.get(c.id)}`);
    ids.set(c.id, c._file);
  }
  return { cases, errors };
}

export function caseFilePath(c) {
  return join(CASES_DIR, c.added.slice(0, 4), `${c.added}-${c.id}.json`);
}

export function sortCases(cases) {
  return [...cases].sort(
    (a, b) => b.added.localeCompare(a.added) || Number(b.featured) - Number(a.featured) || b.score - a.score,
  );
}
