import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claudeCodeAdapter,
  defaultParams as params,
  estimate,
  mergeHistory,
  outputContext,
  parseHistory,
  rollup,
  rollupRecords,
  serializeHistory,
  weekly,
  weekStart,
} from "../src/index.js";

const sample = readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8");
const records = claudeCodeAdapter.parse(sample);

describe("history", () => {
  it("prices rollups the same as the raw records", () => {
    const fromRaw = estimate(records, params).total;
    const fromRollups = estimate(rollupRecords(rollup(records)), params).total;
    expect(fromRollups.central).toBeCloseTo(fromRaw.central, 9);
    expect(fromRollups.low).toBeCloseTo(fromRaw.low, 9);
  });

  it("gives identical totals on a rerun", () => {
    const once = mergeHistory([], rollup(records));
    const twice = mergeHistory(once, rollup(records));
    expect(twice).toEqual(once);
  });

  it("survives the logs being deleted", () => {
    const stored = mergeHistory([], rollup(records));
    const afterCleanup = mergeHistory(stored, rollup([]));
    expect(afterCleanup).toEqual(stored);
  });

  it("keeps the more complete day when logs are partly pruned", () => {
    const stored = mergeHistory([], rollup(records));
    const partial = rollup(records.slice(1));
    expect(mergeHistory(stored, partial)).toEqual(stored);
  });

  it("round-trips through JSONL with counts only", () => {
    const rows = rollup(records);
    const text = serializeHistory(rows);
    expect(parseHistory(text)).toEqual(rows);
    expect(text).not.toContain("/home/dev");
    expect(text).not.toContain("content");
  });

  it("stores output × context per row, summed over responses (ANCHORS D12)", () => {
    const rows = rollup(records);
    const total = rows.reduce((s, r) => s + r.outputContext!, 0);
    expect(total).toBe(records.reduce((s, r) => s + outputContext(r.tokens), 0));
    expect(total).toBeGreaterThan(0);
    expect(outputContext({ input: 10, cacheWrite: 20, cacheRead: 70, output: 5 })).toBe(500);
  });

  it("reads rows written before outputContext existed, and fills it in from fresh logs", () => {
    const fresh = rollup(records);
    const old = fresh.map(({ outputContext: _, ...r }) => r);
    expect(parseHistory(serializeHistory(old))).toEqual(old);
    expect(mergeHistory(old, fresh)).toEqual(fresh);
    expect(mergeHistory(fresh, old)).toEqual(fresh);
  });

  it("skips malformed lines", () => {
    expect(parseHistory('{"schema":1}\nnot json\n{"date":"x"}\n')).toEqual([]);
  });
});

describe("weekly", () => {
  it("starts weeks on Monday and fills gaps", () => {
    expect(weekStart("2026-10-21")).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    const e = { low: 1, central: 2, high: 3 };
    const t = { input: 1, cacheWrite: 0, cacheRead: 0, output: 0 };
    const weeks = weekly([
      { key: "2026-10-01", energy: e, tokens: t },
      { key: "2026-10-20", energy: e, tokens: t },
    ]);
    expect(weeks.map((w) => w.start)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(weeks[1]?.central).toBe(0);
  });
});
