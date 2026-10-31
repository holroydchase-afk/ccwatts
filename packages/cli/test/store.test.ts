import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultParams as params, estimate, mergeHistory, rollup, rollupRecords } from "@ccwatts/core";
import { loadLogs } from "../src/logs.js";
import { historyCsv } from "../src/render.js";
import { readHistory, writeHistory } from "../src/store.js";

const fixtures = new URL("../../../fixtures/claude-code/", import.meta.url).pathname;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ccwatts-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function run(logDir: string, home: string) {
  const logs = await loadLogs([logDir]);
  const rows = mergeHistory(await readHistory(home), rollup(logs.records));
  if (logs.records.length) await writeHistory(rows, home);
  return estimate(rollupRecords(rows), params).total;
}

describe("history file", () => {
  it("survives deleting the Claude Code logs, and reruns give identical totals", async () => {
    const logs = tmp();
    const home = tmp();
    cpSync(join(fixtures, "sample.jsonl"), join(logs, "session.jsonl"));
    const first = await run(logs, home);
    const second = await run(logs, home);
    expect(second).toEqual(first);
    rmSync(join(logs, "session.jsonl"));
    expect(await run(logs, home)).toEqual(first);
  });

  it("starts empty when there is no file", async () => {
    expect(await readHistory(tmp())).toEqual([]);
  });
});

describe("historyCsv", () => {
  it("has a header, one row per rollup and the method version", async () => {
    const logs = await loadLogs([fixtures]);
    const rows = rollup(logs.records.filter((r) => r.key.startsWith("msg_A") || r.key.startsWith("msg_B")));
    const csv = historyCsv(rows, params).split("\n");
    expect(csv[0]).toBe("date,model,project,responses,input,cache_write,cache_read,output,wh_low,wh_central,wh_high,method_version");
    expect(csv).toHaveLength(rows.length + 1);
    expect(csv[1]).toMatch(/,0\.1\.0$/);
  });
});

describe("data file permissions (PS-R8, PS-R9)", () => {
  it("PS-R8: a stale, world-readable .tmp left by a crash still ends up 0600", async () => {
    const home = join(tmp(), "data");
    mkdirSync(home);
    writeFileSync(join(home, "history.jsonl.tmp"), "stale", { mode: 0o644 });
    chmodSync(join(home, "history.jsonl.tmp"), 0o644);
    await writeHistory([], home);
    expect(statSync(join(home, "history.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("PS-R9: a new data folder is created 0700", async () => {
    const home = join(tmp(), "fresh");
    await writeHistory([], home);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });
});
