// The daily run log: data/runs/<date>.json holds one entry per run, so a second run on
// the same day (a manual re-run, a write-ups-only run) adds to the day instead of
// replacing it.
//
//   { date, runs: [ { id, started, trigger, collect?, curate?, enrich? }, ... ] }
//
// The steps of one run (collect, curate, enrich) run as separate processes; they find
// their shared entry by run id: the GitHub Actions run id in CI, or an id kept in
// .cache/run-id for local runs (collect.mjs starts a new one).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { path, readJSON, writeJSON } from "./util.mjs";

const ID_FILE = path(".cache", "run-id");

export async function runId({ fresh = false } = {}) {
  if (process.env.GITHUB_RUN_ID) return `gh-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || 1}`;
  if (!fresh) {
    try {
      const id = (await readFile(ID_FILE, "utf8")).trim();
      if (id) return id;
    } catch {}
  }
  const id = `local-${new Date().toISOString()}`;
  await mkdir(path(".cache"), { recursive: true });
  await writeFile(ID_FILE, id + "\n");
  return id;
}

/** Older logs held one run's sections at the top level; keep them as a run named "legacy". */
export function normalize(log, date) {
  if (Array.isArray(log?.runs)) return { date: log.date || date, runs: log.runs };
  const { date: d, ...sections } = log || {};
  return { date: d || date, runs: Object.keys(sections).length ? [{ id: "legacy", ...sections }] : [] };
}

/** Merge `patch` into this run's entry for `date`, creating the entry if needed. */
export async function updateRun(date, patch, { id } = {}) {
  const file = path("data", "runs", `${date}.json`);
  const log = normalize(await readJSON(file, { date }), date);
  const runIdValue = id || (await runId());
  let run = log.runs.find((r) => r.id === runIdValue);
  if (!run) {
    run = { id: runIdValue, started: new Date().toISOString(), trigger: process.env.GITHUB_EVENT_NAME || "local" };
    log.runs.push(run);
  }
  Object.assign(run, patch);
  await writeJSON(file, log);
  return log;
}
