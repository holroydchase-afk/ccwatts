import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, defaultParams as params, estimate, parseSince } from "@ccwatts/core";
import { breakdown, energy, history, json, method, num, sparkline, statusLine, summary } from "../src/render.js";

const sample = readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8");
const e = estimate(claudeCodeAdapter.parse(sample), params);
const window = { start: null, label: "all time" };

describe("summary", () => {
  it("matches the PLAN.md layout", () => {
    expect(summary(e, params, window)).toMatchSnapshot();
  });

  it("always shows a range and the method version", () => {
    const out = summary(e, params, window);
    expect(out).toMatch(/range [\d.]+ – [\d.]+/);
    expect(out).toContain(`method v${params.version}`);
  });

  it("says so when the window is empty", () => {
    expect(summary(estimate([], params), params, window)).toContain("No Claude Code usage");
  });

  it("never prints a full path", () => {
    expect(summary(e, params, window)).not.toContain("/home/dev");
    expect(json(e, params, window)).not.toContain("/home/dev");
  });
});

describe("breakdown", () => {
  it.each(["model", "type", "day", "project"] as const)("--by %s", (dim) => {
    expect(breakdown(e, params, window, dim)).toMatchSnapshot();
  });
});

describe("json", () => {
  it("carries the same totals as the table", () => {
    const parsed = JSON.parse(json(e, params, window));
    expect(parsed.wh).toEqual(e.total);
    expect(parsed.methodVersion).toBe(params.version);
    expect(parsed.byProject[0].key).toBe("alpha");
  });
});

describe("method", () => {
  it("lists every parameter with its source", () => {
    const out = method(params);
    for (const [id, p] of Object.entries(params.params)) {
      expect(out).toContain(id);
      expect(out).toContain(p.source);
    }
  });
});

describe("formatting", () => {
  it("switches to kWh at 1000 Wh", () => {
    expect(energy({ low: 400, central: 1200, high: 3000 })).toEqual({ central: "1.2 kWh", range: "0.4 – 3", unit: "kWh" });
    expect(num(0.004)).toBe("0.004");
  });
});

describe("parseSince", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  it("reads relative and absolute windows", () => {
    expect(parseSince("7d", now).start).toBe("2026-10-14T00:00:00.000Z");
    expect(parseSince("2026-10-01", now)).toEqual({ start: "2026-10-01T00:00:00.000Z", label: "since 2026-10-01" });
    expect(parseSince("all", now).start).toBeNull();
    expect(() => parseSince("yesterday", now)).toThrow(/--since/);
  });
});

describe("history", () => {
  it("renders weeks, a trend and ranges", () => {
    const out = history(e, params, window, 2);
    expect(out).toMatchSnapshot();
    expect(out).toContain("Trend");
    expect(sparkline([0, 1, 2])).toBe("▁▅█");
  });
});

describe("statusLine", () => {
  it("is one short line with a range and the method version", () => {
    const line = statusLine(e, params);
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toMatch(/range [\d.]+ – [\d.]+/);
    expect(line).toContain(`method v${params.version}`);
    expect(line.length).toBeLessThan(80);
  });

  it("says so before the first response", () => {
    expect(statusLine(estimate([], params), params)).toContain("no usage yet");
  });
});
