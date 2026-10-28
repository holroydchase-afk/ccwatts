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
    expect(energy({ low: 400, central: 1200, high: 3000 })).toEqual({ central: "1.2 kWh", range: "0.4 – 3.0", unit: "kWh" });
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

// ---------------------------------------------------------------------------------------------
// UI polish (CCW-M2.6.3, docs/reviews/2026-10-28-release-plan.md, UX-R6, R7, R9).
//
// Interface assumed: the text renderers take an optional last argument
//   type RenderOptions = { color?: boolean; now?: Date };
//   summary(e, params, window, sample?, opts?)   breakdown(e, params, window, dim, opts?)
//   history(e, params, window, storedDays, opts?)
// color defaults to false (no ANSI at all); index.ts turns it on for a TTY or FORCE_COLOR, off for NO_COLOR.
// now defaults to the current time and decides which week is still in progress (UX-R9).
// ---------------------------------------------------------------------------------------------
type Opts = { color?: boolean; now?: Date };
type Est = typeof e;
type Win = typeof window;
const summaryO = summary as unknown as (e: Est, p: typeof params, w: Win, sample?: boolean, o?: Opts) => string;
const breakdownO = breakdown as unknown as (e: Est, p: typeof params, w: Win, dim: "model" | "type" | "day" | "project", o?: Opts) => string;
const historyO = history as unknown as (e: Est, p: typeof params, w: Win, days: number, o?: Opts) => string;

const demoText = readFileSync(new URL("../../../fixtures/claude-code/demo.jsonl", import.meta.url), "utf8");
const big = estimate(claudeCodeAdapter.parse(demoText), params); // kWh scale, several weeks
const ESC = "\u001b[";

describe("UX-R6 bold and color only in a terminal", () => {
  it("UX-R6: with color on, the headline number is bold", () => {
    const out = summaryO(big, params, window, false, { color: true });
    const headline = energy(big.total).central;
    expect(out).toMatch(new RegExp(`\\u001b\\[1m[^\\u001b]*${headline.replace(".", "\\.")}[^\\u001b]*\\u001b\\[(22|0)?m`));
  });

  it("UX-R6: with color off (the default, and when piped or NO_COLOR), there are no ANSI codes at all", () => {
    const outs = [
      summary(big, params, window),
      summaryO(big, params, window, false, { color: false }),
      breakdownO(big, params, window, "project", { color: false }),
      breakdown(big, params, window, "model"),
      history(big, params, window, 28),
      historyO(big, params, window, 28, { color: false }),
      method(params),
    ];
    for (const out of outs) expect(out).not.toContain(ESC);
  });
});

/** Column spans from the dashed rule under a table header, and the header and body lines around it. */
function tableOf(out: string) {
  const lines = out.split("\n");
  const ruleAt = lines.findIndex((l) => /^\s*-+(\s+-+)+\s*$/.test(l));
  expect(ruleAt, "table rule").toBeGreaterThan(0);
  const rule = lines[ruleAt]!;
  const spans = [...rule.matchAll(/-+/g)].map((m) => ({ s: m.index!, e: m.index! + m[0].length }));
  const body: string[] = [];
  for (let i = ruleAt + 1; i < lines.length && lines[i]!.trim(); i++) body.push(lines[i]!);
  return { head: lines[ruleAt - 1]!, rule, spans, body };
}

describe("UX-R7 tables line up and sit under the summary indent", () => {
  it.each(["model", "type", "day", "project"] as const)("UX-R7: --by %s is indented 2 spaces like the summary", (dim) => {
    const t = tableOf(breakdown(big, params, window, dim));
    for (const l of [t.head, t.rule, ...t.body]) expect(l, JSON.stringify(l)).toMatch(/^ {2}\S/);
  });

  it("UX-R7: history's table is indented 2 spaces like the summary", () => {
    const t = tableOf(history(big, params, window, 28));
    for (const l of [t.head, t.rule, ...t.body]) expect(l, JSON.stringify(l)).toMatch(/^ {2}\S/);
  });

  it("UX-R7: --by project headers (kWh, tokens, range, share) right-align with their values", () => {
    const t = tableOf(breakdown(big, params, window, "project"));
    expect(t.head).toContain("kWh");
    t.spans.forEach(({ s, e: end }, i) => {
      if (i === 0) return;
      expect(t.head[end - 1], `header col ${i}: ${JSON.stringify(t.head)}`).not.toBe(" ");
      expect(t.head.slice(s, end).trim().length).toBeGreaterThan(0);
      for (const row of t.body) expect(row[end - 1], `col ${i}: ${JSON.stringify(row)}`).not.toMatch(/\s|undefined/);
    });
  });

  it("UX-R7: history bars grow from the left: each bar starts right after the column separator", () => {
    const t = tableOf(history(big, params, window, 28));
    const bar = t.spans[t.spans.length - 1]!;
    const withBars = t.body.filter((r) => r.includes("█"));
    expect(withBars.length).toBeGreaterThan(1);
    for (const row of withBars) {
      expect(row.indexOf("█"), JSON.stringify(row)).toBe(bar.s);
      expect(row.slice(bar.s)).toMatch(/^█+$/);
    }
  });
});

describe("UX-R9 the week still in progress isn't called the lightest", () => {
  const rec = (day: string, cacheRead: number, i: number) => ({
    source: "claude-code",
    key: `r9-${i}`,
    timestamp: `${day}T12:00:00.000Z`,
    model: "claude-opus-4-6",
    project: { id: "p", name: "proj" },
    tokens: { input: 10, cacheWrite: 1000, cacheRead, output: 500 },
  });
  // Wednesday 2026-10-28: the week of 2026-10-26 has only run three days, and is the lightest by far.
  const now = new Date("2026-10-28T09:00:00Z");
  const three = estimate([rec("2026-10-13", 4_000_000, 1), rec("2026-10-20", 2_000_000, 2), rec("2026-10-27", 10_000, 3)], params);

  it("UX-R9: lightest week skips the partial current week, or marks it (partial)", () => {
    const out = historyO(three, params, window, 3, { now });
    const lightest = out.split("\n").find((l) => l.includes("Lightest week")) ?? "";
    expect(lightest).not.toBe("");
    if (lightest.includes("2026-10-26")) expect(lightest).toContain("(partial)");
    else expect(lightest).toContain("2026-10-19");
  });

  it("UX-R9: once that week is over, it can be the lightest without a (partial) mark", () => {
    const out = historyO(three, params, window, 3, { now: new Date("2026-11-03T09:00:00Z") });
    const lightest = out.split("\n").find((l) => l.includes("Lightest week")) ?? "";
    expect(lightest).toContain("2026-10-26");
    expect(lightest).not.toContain("(partial)");
  });
});

describe("UX-R19 history draws no divider over a column without a header (CCW-M2.6.4)", () => {
  // Decided (coordinator, CCW-M2.6.4): the bar column is named "trend".
  it("UX-R19 RED: every dashed span under history's header sits under a header label, and the bars are 'trend'", () => {
    const t = tableOf(history(big, params, window, 28));
    expect(t.head.trimEnd().split(/\s{2,}/).at(-1)).toBe("trend");
    t.spans.forEach(({ s, e: end }, i) => {
      expect(t.head.slice(s, end).trim(), `divider ${i} has no header above it: ${JSON.stringify(t.head)}`).not.toBe("");
    });
  });
});
