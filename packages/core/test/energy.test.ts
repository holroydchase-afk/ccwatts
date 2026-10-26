import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claudeCodeAdapter,
  comparisons,
  defaultParams as params,
  energyForCounts,
  estimate,
  tierFor,
  type UsageRecord,
} from "../src/index.js";

const sample = readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8");

const record = (model: string, tokens: Partial<UsageRecord["tokens"]>, timestamp = "2026-10-01T00:00:00Z"): UsageRecord => ({
  source: "test",
  key: Math.random().toString(36),
  timestamp,
  model,
  project: null,
  tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, ...tokens },
});

describe("params.json", () => {
  it("sources every parameter, with low <= value <= high", () => {
    for (const [id, p] of Object.entries(params.params)) {
      expect(p.source, id).toMatch(/^https:\/\//);
      expect(p.as_of, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["DISCLOSED", "MEASURED", "MODELED", "GUESS"], id).toContain(p.label);
      expect(p.low, id).toBeGreaterThan(0);
      expect(p.low, id).toBeLessThanOrEqual(p.value);
      expect(p.value, id).toBeLessThanOrEqual(p.high);
    }
    for (const [id, c] of Object.entries(params.comparisons)) expect(c.source, id).toMatch(/^https:\/\//);
  });
});

describe("tierFor", () => {
  it("maps model families and falls back with a flag", () => {
    expect(tierFor("claude-opus-4-6", params)).toEqual({ tier: "opus", known: true });
    expect(tierFor("claude-3-5-haiku-20241022", params)).toEqual({ tier: "haiku", known: true });
    expect(tierFor("some-new-model", params)).toEqual({ tier: "sonnet", known: false });
  });
});

describe("estimate", () => {
  it("always returns low <= central <= high", () => {
    const e = estimate(claudeCodeAdapter.parse(sample), params);
    expect(e.total.low).toBeLessThan(e.total.central);
    expect(e.total.central).toBeLessThan(e.total.high);
    expect(e.methodVersion).toBe(params.version);
  });

  it("breakdowns add up to the total", () => {
    const e = estimate(claudeCodeAdapter.parse(sample), params);
    for (const rows of [e.byModel, e.byType, e.byDay, e.byProject]) {
      const sum = rows.reduce((s, r) => s + r.energy.central, 0);
      expect(sum).toBeCloseTo(e.total.central, 9);
    }
  });

  it("charges cache reads far less than output, per token", () => {
    const read = energyForCounts({ input: 0, cacheWrite: 0, cacheRead: 1000, output: 0 }, "opus", params);
    const out = energyForCounts({ input: 0, cacheWrite: 0, cacheRead: 0, output: 1000 }, "opus", params);
    expect(read.central * 10).toBeLessThan(out.central);
  });

  it("warns on unknown models", () => {
    const e = estimate([record("mystery-1", { output: 100 })], params);
    expect(e.warnings).toHaveLength(1);
  });

  it("is deterministic", () => {
    const records = claudeCodeAdapter.parse(sample);
    expect(estimate(records, params)).toEqual(estimate(records, params));
  });
});

// PLAN.md sanity checks. If these fail after a params change, explain why in METHODOLOGY.md or fix the model.
describe("sanity checks", () => {
  it("a typical chat query lands near the 0.24-0.34 Wh public medians", () => {
    const wh = energyForCounts({ input: 1000, cacheWrite: 0, cacheRead: 0, output: 400 }, "sonnet", params);
    expect(wh.central).toBeGreaterThan(0.18);
    expect(wh.central).toBeLessThan(0.67);
  });

  it("a heavy agentic day (~$17 of Opus API spend) lands near a dishwasher load, 1-3 kWh", () => {
    // About 20M cache reads, 1M cache writes, 0.1M fresh input, 0.15M output.
    const wh = energyForCounts({ input: 100_000, cacheWrite: 1_000_000, cacheRead: 20_000_000, output: 150_000 }, "opus", params);
    expect(wh.central / 1000).toBeGreaterThan(0.5);
    expect(wh.central / 1000).toBeLessThan(3);
  });

  it("Hausfather-scale use (8 weeks, ~96% cache reads) lands inside his 70-330 kWh range", () => {
    // Illustrative token mix for ~3 kWh/day over 56 days; his exact token counts are not published.
    const days = 56;
    const perDay = { input: 300_000, cacheWrite: 2_500_000, cacheRead: 55_000_000, output: 400_000 };
    const wh = energyForCounts(perDay, "opus", params);
    const kwh = (wh.central * days) / 1000;
    expect(kwh).toBeGreaterThan(70);
    expect(kwh).toBeLessThan(330);
  });
});

describe("comparisons", () => {
  it("uses the central value", () => {
    const [ev] = comparisons(3, params);
    expect(ev?.amount).toBeCloseTo(10, 5);
  });

  // CCW-RR-20: tiny totals read "charging a phone about 0.5 times".
  it("says a fraction of a phone charge in words, not '0.5 times'", () => {
    const phone = (kwh: number) => comparisons(kwh, params).find((c) => c.id === "phone")?.text;
    expect(phone(0.0095)).toBe("about half a phone charge");
    expect(phone(0.0057)).toBe("about 30% of a phone charge");
    expect(phone(0.00005)).toBe("under 1% of a phone charge");
    expect(phone(0.019)).toBe("charging a phone about once");
    expect(phone(0.038)).toBe("charging a phone about 2 times");
  });

  it("uses the singular for exactly one mile or day", () => {
    const all = comparisons(0.3, params);
    const ev = params.comparisons.ev_kwh_per_mile!.value;
    expect(comparisons(ev, params).find((c) => c.id === "ev")?.text).toBe("driving an EV about 1 mile");
    const fridge = params.comparisons.fridge_kwh_per_day!.value;
    expect(comparisons(fridge, params).find((c) => c.id === "fridge")?.text).toBe("running a fridge about 1 day");
    for (const c of all) expect(c.text).not.toMatch(/\b1 (miles|days|times)\b/);
  });
});
