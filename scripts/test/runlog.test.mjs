import { test } from "node:test";
import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";
import { normalize, updateRun } from "../lib/runlog.mjs";
import { path } from "../lib/util.mjs";

test("old single-run logs become one 'legacy' run", () => {
  assert.deepEqual(normalize({ date: "d", collect: { raw: 1 }, curate: { status: "ok" } }, "d"), {
    date: "d",
    runs: [{ id: "legacy", collect: { raw: 1 }, curate: { status: "ok" } }],
  });
  assert.deepEqual(normalize(undefined, "d"), { date: "d", runs: [] });
});

test("each run keeps its own entry; steps of one run merge into it", async () => {
  const date = "0000-runlog-test";
  const file = path("data", "runs", `${date}.json`);
  try {
    await updateRun(date, { collect: { raw: 5 } }, { id: "run-a" });
    await updateRun(date, { curate: { published: 1 } }, { id: "run-a" });
    await updateRun(date, { enrich: { written: 2 } }, { id: "run-b" });
    const log = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(log.runs.map((r) => r.id), ["run-a", "run-b"]);
    assert.deepEqual(log.runs[0].collect, { raw: 5 });
    assert.deepEqual(log.runs[0].curate, { published: 1 });
    assert.deepEqual(log.runs[1].enrich, { written: 2 });
  } finally {
    await rm(file, { force: true });
  }
});
