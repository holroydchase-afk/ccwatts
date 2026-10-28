// CCW-M2.6.5 "What if?" cache-read slider: the pure part. The page lets a skeptic move
// cache_read_vs_input and watch the range recompute; core supplies a params copy with one
// parameter overridden. Assumed interface: withOverrides(params, { id: value }) -> new Params.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { claudeCodeAdapter, defaultParams, estimate, type Estimate, type Params } from "../src/index.js";

const sample = readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8");
const records = claudeCodeAdapter.parse(sample);

type WithOverrides = (params: Params, overrides: Record<string, number>) => Params;
const withOverrides = (core as unknown as { withOverrides?: WithOverrides }).withOverrides;

const byType = (e: Estimate, type: string) => e.byType.find((b) => b.key === type)?.energy;
const ID = "cache_read_vs_input";

describe("WI-1 withOverrides (pure, core)", () => {
  it("WI-1: core exports withOverrides", () => {
    expect(typeof withOverrides).toBe("function");
  });

  it("WI-1: 2x cache_read_vs_input doubles the cache-read central and leaves other types alone", () => {
    const base = defaultParams.params[ID]!;
    const over = withOverrides!(defaultParams, { [ID]: base.value * 2 });
    const before = estimate(records, defaultParams);
    const after = estimate(records, over);
    expect(byType(before, "cacheRead")!.central).toBeGreaterThan(0);
    expect(byType(after, "cacheRead")!.central).toBeCloseTo(byType(before, "cacheRead")!.central * 2, 9);
    for (const type of ["input", "output", "cacheWrite"]) {
      const b = byType(before, type);
      const a = byType(after, type);
      expect(a, type).toEqual(b);
    }
    expect(after.methodVersion).toBe(before.methodVersion);
  });

  it("WI-1: sets value, scales low/high by the same ratio, and keeps low <= value <= high", () => {
    const base = defaultParams.params[ID]!;
    const over = withOverrides!(defaultParams, { [ID]: base.value * 2 });
    const p = over.params[ID]!;
    expect(p.value).toBeCloseTo(base.value * 2, 12);
    expect(p.low).toBeCloseTo(base.low * 2, 12);
    expect(p.high).toBeCloseTo(base.high * 2, 12);
    expect(p.low).toBeLessThanOrEqual(p.value);
    expect(p.value).toBeLessThanOrEqual(p.high);
    // The estimate's own range stays ordered too.
    const t = estimate(records, over).total;
    expect(t.low).toBeLessThanOrEqual(t.central);
    expect(t.central).toBeLessThanOrEqual(t.high);
  });

  it("WI-1: does not mutate the input params (and returns a new object)", () => {
    const snapshot = JSON.parse(JSON.stringify(defaultParams));
    const over = withOverrides!(defaultParams, { [ID]: 0.25 });
    expect(over).not.toBe(defaultParams);
    expect(over.params).not.toBe(defaultParams.params);
    expect(JSON.parse(JSON.stringify(defaultParams))).toEqual(snapshot);
    // Other parameters are carried over unchanged.
    for (const id of Object.keys(defaultParams.params)) {
      if (id !== ID) expect(over.params[id], id).toEqual(defaultParams.params[id]);
    }
  });

  it("WI-1: the original params still give the original estimate after an override (no stale cache)", () => {
    const before = estimate(records, defaultParams).total;
    estimate(records, withOverrides!(defaultParams, { [ID]: 0.25 }));
    expect(estimate(records, defaultParams).total).toEqual(before);
  });

  it("WI-1: rejects an unknown parameter id or a non-positive value", () => {
    // Guard so a missing export can't make the toThrow() checks pass by accident.
    expect(typeof withOverrides).toBe("function");
    expect(() => withOverrides!(defaultParams, { not_a_param: 1 })).toThrow(/not_a_param/);
    expect(() => withOverrides!(defaultParams, { [ID]: 0 })).toThrow();
    expect(() => withOverrides!(defaultParams, { [ID]: Number.NaN })).toThrow();
  });
});
