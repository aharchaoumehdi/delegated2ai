// Rewrites existing entries into the plain-language style of docs/editorial-guidelines.md:
// a short, verb-first title, a one-sentence summary and a write-up in everyday words.
//
// It works from each entry's own record only and adds nothing new. Two guards back that
// up in code, not just in the prompt: a rewrite that contains any number the record
// doesn't already have is rejected (the entry keeps its old text), and a write-up part
// that was empty stays empty. Prompts are left as they are.
//
//   ANTHROPIC_API_KEY=... node scripts/rewrite.mjs     # REWRITE_MAX caps entries (default 200)
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadCases } from "./lib/cases.mjs";
import { CaseSchema } from "./lib/schema.mjs";
import { parseStructured } from "./lib/claude.mjs";
import { updateRun } from "./lib/runlog.mjs";
import { path, today } from "./lib/util.mjs";
import { SUMMARY_WORDS, SUMMARY_SLACK, wordCount } from "./enrich.mjs";

const MAX = Number(process.env.REWRITE_MAX || 200);
const BATCH = 5;
export const TITLE_MAX = 60;
const FIELDS = ["title", "summary", "what_they_did", "how_it_went", "worth_knowing"];

/** Every number in a text, normalised ("12,074" → "12074", "$1k" → "1"). */
export const numbersIn = (text = "") => (String(text).replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) || []);

/** Reasons to reject a rewrite of record `c` (empty when it is safe to keep). */
export function problems(c, w) {
  const known = new Set(
    [c.title, c.summary, c.what_they_did, c.how_it_went, c.worth_knowing, c.outcome, c.agent_role, c.model, c.source?.author, ...(c.tools || [])]
      .flatMap((t) => numbersIn(t)),
  );
  const out = [];
  for (const f of FIELDS) {
    if (w[f] == null) continue;
    const added = numbersIn(w[f]).filter((n) => !known.has(n));
    if (added.length) out.push(`${f} adds ${added.join(", ")}`);
  }
  if (!w.title || w.title.length > TITLE_MAX + 10) out.push("title too long");
  if (!w.summary || wordCount(w.summary) > SUMMARY_WORDS + SUMMARY_SLACK) out.push("summary too long");
  return out;
}

async function main() {
  const { cases, errors } = await loadCases();
  if (errors.length) throw new Error(errors.join("\n"));
  const todo = cases.filter((c) => c.status !== "rejected").slice(0, MAX);
  if (!process.env.ANTHROPIC_API_KEY) return console.log("::warning title=Rewrite skipped::ANTHROPIC_API_KEY is not set.");

  const guidelines = await readFile(path("docs", "editorial-guidelines.md"), "utf8");
  const system = `You edit entries for a directory of real-world AI agent applications, for readers with no
technical background. Rewrite each entry's title, summary and write-up (what they did, how it went,
worth knowing) to follow these guidelines exactly, especially "Writing the entry" and "The write-up":

${guidelines}

Rules for this rewrite:
- Use only facts in the entry. Never add, change or round a number, a name or an outcome.
- Keep claims attributed the way the entry attributes them ("they say", "the author reports").
- Replace jargon and acronyms with plain words that say what the thing does.
- When a part is "(none)", return null for it.
Return one rewrite per entry, using its id.`;
  const Rewrite = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    what_they_did: z.string().nullable(),
    how_it_went: z.string().nullable(),
    worth_knowing: z.string().nullable(),
  });
  const Batch = z.object({ rewrites: z.array(Rewrite) });
  const render = (c) => `<entry id="${c.id}">
title: ${c.title}
summary: ${c.summary}
agent: ${c.platform}
reported outcome: ${c.outcome ?? "none stated"}
what they did: ${c.what_they_did ?? "(none)"}
how it went: ${c.how_it_went ?? "(none)"}
worth knowing: ${c.worth_knowing ?? "(none)"}
</entry>`;

  const byId = new Map(todo.map((c) => [c.id, c]));
  let written = 0;
  const failures = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let rewrites;
    try {
      ({ parsed: { rewrites } } = await parseStructured({ system, schema: Batch, user: batch.map(render).join("\n\n"), maxTokens: 8000 }));
    } catch (err) {
      failures.push({ ids: batch.map((c) => c.id), error: String(err.message).slice(0, 300) });
      continue;
    }
    for (const w of rewrites) {
      const c = byId.get(w.id);
      if (!c) continue;
      const issues = problems(c, w);
      if (issues.length) {
        failures.push({ ids: [c.id], error: issues.join("; ") });
        continue;
      }
      const { _file, ...record } = c;
      record.title = w.title.trim();
      record.summary = w.summary.trim();
      for (const f of ["what_they_did", "how_it_went", "worth_knowing"])
        if (c[f] != null && w[f] != null && w[f].trim().length >= 20) record[f] = w[f].trim(); // empty stays empty
      const parsed = CaseSchema.safeParse(record);
      if (!parsed.success) {
        failures.push({ ids: [c.id], error: parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ") });
        continue;
      }
      await writeFile(_file, JSON.stringify(parsed.data, null, 2) + "\n");
      written++;
    }
  }
  await updateRun(today(), { rewrite: { needed: todo.length, written, failures } });
  const line = `Plain-language rewrite: ${written} of ${todo.length} entries rewritten, ${failures.length} kept as they were`;
  console.log(line);
  for (const f of failures) console.log(`  kept ${f.ids.join(", ")}: ${f.error}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### ${line}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
