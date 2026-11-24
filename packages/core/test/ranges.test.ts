import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claudeCodeAdapter,
  comparisons,
  defaultParams as params,
  estimate,
  everyday,
  formatShare,
  linkedInPost,
  receiptSvg,
  shareLine,
  shortModel,
  shareRange,
  TYPE_LABELS,
  TOKEN_TYPES,
  type Range,
  type UsageRecord,
} from "../src/index.js";

// M4.8.3 "ranges on every number" (docs/product/SPEC-RANGES.md, RANGE-1..3, RANGE-8, RANGE-9; UX-R6 P1).
// Hard rule (CLAUDE.md): every number shown to a user has a range and the method version.
//
// API choices pinned here (for the engineer):
//  - `shareRange(part: Range, total: Range): Range` is exported from core. It computes part/total at the
//    low, central and high corners and returns { low: min, central: central ratio, high: max } as
//    FRACTIONS (0..1), not percents. Pure: no I/O, inputs untouched. An empty total gives 0s, never NaN.
//  - `formatShare(share: Range): string` takes that fraction Range and gives "64% (30–72%)" (en dash,
//    no spaces), "7%" when all three round equal, "<1%" when above 0 but all round to 0.
//  - `comparisons(total: Range, params)` and `everyday(total: Range, params)` take the estimate's total
//    Range IN WATT-HOURS (Estimate.total, the same thing formatEnergy takes), no longer central kWh.
//    Each line reads "driving an EV about 28 miles (4.4–102)": both ends rounded with the rule the
//    central already uses (>= 10 whole, else one decimal). `amount` stays the central value (MCP JSON).

const demo = readFileSync(new URL("../../../fixtures/claude-code/demo.jsonl", import.meta.url), "utf8");
const e = estimate(claudeCodeAdapter.parse(demo), params);
const input = { estimate: e, params, windowLabel: "last 30 days" };
const byType = (k: string) => e.byType.find((r) => r.key === k)!.energy;

/** Reference corner ratios, written independently of the product code. */
function refShare(part: Range, total: Range): Range {
  const r = (a: number, b: number) => (b > 0 ? a / b : 0);
  const corners = [r(part.low, total.low), r(part.central, total.central), r(part.high, total.high)];
  return { low: Math.min(...corners), central: corners[1]!, high: Math.max(...corners) };
}
/** Reference formatting of a share Range, per RANGE-2. */
function refFormat(s: Range): string {
  const p = (v: number) => (v > 0 && Math.round(v * 100) === 0 ? "<1" : String(Math.round(v * 100)));
  const [lo, c, hi] = [p(s.low), p(s.central), p(s.high)];
  return lo === c && c === hi ? `${c}%` : `${c}% (${lo}–${hi}%)`;
}

/** The receipt slip's lines (the 16.5px monospace text on the right of the card), unescaped. */
function slipLines(svg: string): string[] {
  return [...svg.matchAll(/<text [^>]*font-size="16\.5"[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  );
}

const RANGE_IN = /\d[\d.,]*\s?[–-]\s?\d/; // "0.4–22" or "0.4 – 22"
const EV = "driving an EV about 28 miles (4.4–102)";
const FRIDGE = "running a fridge about 5.7 days (0.9–20)";

describe("RANGE-1 core shareRange: part/total at the low, central and high corners", () => {
  it("RANGE-1 demo cache read share is 30 / 64 / 72 % (±1)", () => {
    const s = shareRange(byType("cacheRead"), e.total);
    expect(s.low * 100).toBeGreaterThanOrEqual(29);
    expect(s.low * 100).toBeLessThanOrEqual(31);
    expect(s.central * 100).toBeGreaterThanOrEqual(63);
    expect(s.central * 100).toBeLessThanOrEqual(65);
    expect(s.high * 100).toBeGreaterThanOrEqual(71);
    expect(s.high * 100).toBeLessThanOrEqual(73);
  });

  it("RANGE-1 returns min and max of the corner ratios, not low/low and high/high (cache write falls as the total rises)", () => {
    const s = shareRange(byType("cacheWrite"), e.total);
    const ref = refShare(byType("cacheWrite"), e.total);
    expect(s.low).toBeCloseTo(ref.low, 6); // 21% (the high corner)
    expect(s.central).toBeCloseTo(ref.central, 6);
    expect(s.high).toBeCloseTo(ref.high, 6); // 48% (the low corner)
    expect(s.low).toBeLessThanOrEqual(s.central);
    expect(s.central).toBeLessThanOrEqual(s.high);
  });

  it("RANGE-1 hand-made corners: 1/10, 2/4, 9/10 give 0.1 / 0.5 / 0.9", () => {
    const s = shareRange({ low: 1, central: 2, high: 9 }, { low: 10, central: 4, high: 10 });
    expect(s.low).toBeCloseTo(0.1, 9);
    expect(s.central).toBeCloseTo(0.5, 9);
    expect(s.high).toBeCloseTo(0.9, 9);
  });

  it("RANGE-1 is pure: frozen inputs, same answer twice; an empty total gives 0s, not NaN", () => {
    const part = Object.freeze({ ...byType("cacheRead") });
    const total = Object.freeze({ ...e.total });
    expect(shareRange(part, total)).toEqual(shareRange(part, total));
    const zero = shareRange({ low: 0, central: 0, high: 0 }, { low: 0, central: 0, high: 0 });
    for (const v of [zero.low, zero.central, zero.high]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("RANGE-2 core formatShare", () => {
  it('RANGE-2 gives "64% (30–72%)" for the demo cache read share', () => {
    expect(formatShare({ low: 0.3025, central: 0.6427, high: 0.7206 })).toBe("64% (30–72%)");
    expect(formatShare(shareRange(byType("cacheRead"), e.total))).toBe("64% (30–72%)");
  });

  it('RANGE-2 gives "7%" when low, central and high all round to the same whole percent', () => {
    expect(formatShare({ low: 0.0673, central: 0.0726, high: 0.0707 })).toBe("7%");
  });

  it('RANGE-2 gives "<1%" when above 0 but every corner rounds to 0 (demo input tokens)', () => {
    expect(formatShare({ low: 0.0005, central: 0.0006, high: 0.0011 })).toBe("<1%");
    expect(formatShare(shareRange(byType("input"), e.total))).toBe("<1%");
  });
});

describe("RANGE-3 core comparisons/everyday take the total Range", () => {
  it(`RANGE-3 demo EV and fridge lines carry ranges: "${EV}", "${FRIDGE}"`, () => {
    const lines = comparisons(e.total, params);
    expect(lines.find((c) => c.id === "ev")?.text).toBe(EV);
    expect(lines.find((c) => c.id === "fridge")?.text).toBe(FRIDGE);
  });

  it("RANGE-3 amount stays the central value (MCP JSON reads it)", () => {
    const ev = comparisons(e.total, params).find((c) => c.id === "ev")!;
    expect(ev.amount).toBeCloseTo(e.total.central / 1000 / params.comparisons.ev_kwh_per_mile!.value, 6);
  });

  it("RANGE-3 every demo comparison line has a (low–high) range", () => {
    for (const c of comparisons(e.total, params)) expect(c.text, c.id).toMatch(/\([<\d.,]+–[\d.,]+\)/);
  });

  it(`RANGE-3 everyday gives "${EV} · ${FRIDGE}"`, () => {
    expect(everyday(e.total, params)).toBe(`${EV} · ${FRIDGE}`);
  });
});

describe("RANGE-8 share card: every row carries a range, slip lines fit 36 chars", () => {
  const svg = receiptSvg(input);
  const lines = slipLines(svg);

  it("RANGE-8 the slip parsed (sanity: header and method line found)", () => {
    expect(lines[0]).toBe("ELECTRICITY RECEIPT");
    expect(lines.some((l) => l.startsWith(`method v${params.version}`))).toBe(true);
  });

  for (const type of TOKEN_TYPES) {
    it(`RANGE-8 the "${TYPE_LABELS[type]}" row shows a range`, () => {
      const row = lines.find((l) => l.startsWith(`${TYPE_LABELS[type]} `));
      expect(row, `no slip row for ${type}: ${JSON.stringify(lines)}`).toBeDefined();
      const right = row!.replace(/^[^.]*\.{2,}\s*/, "");
      expect(right, `row "${row}"`).toMatch(RANGE_IN);
    });
  }

  for (const m of e.byModel.slice(0, 3)) {
    const want = refFormat(refShare(m.energy, e.total));
    it(`RANGE-8 the ${shortModel(m.key)} row shows its share as "${want}"`, () => {
      const row = lines.find((l) => l.startsWith(`${shortModel(m.key)} `));
      expect(row, `no slip row for ${m.key}`).toBeDefined();
      expect(row!.endsWith(` ${want}`), `row "${row}"`).toBe(true);
    });
  }

  it("RANGE-8 every slip line is at most 36 characters", () => {
    const long = lines.filter((l) => [...l].length > 36).map((l) => `${[...l].length}: ${l}`);
    expect(long).toEqual([]);
  });

  it('RANGE-8 "method v" stays on the card', () => {
    expect(svg).toContain(`method v${params.version}`);
  });

  it("RANGE-8 the card's comparison lines carry ranges", () => {
    const compare = [...svg.matchAll(/>≈ ([^<]*)</g)].map((m) => m[1]!);
    expect(compare.length).toBeGreaterThan(0);
    for (const c of compare) expect(c).toMatch(/\([<\d.,]+–[\d.,]+\)/);
  });
});

describe("RANGE-9 share line and post: comparisons and cache share carry ranges", () => {
  for (const sample of [false, true]) {
    const who = sample ? "sample" : "real data";
    it(`RANGE-9 share line (${who}) has the EV comparison with its range and the method version`, () => {
      const line = shareLine({ ...input, sample });
      expect(line).toContain(EV);
      expect(line).toContain(`method v${params.version}`);
      expect(line.replace(/\d+% \(\d+–\d+%\)/g, "")).not.toMatch(/\d%/);
    });

    it(`RANGE-9 post (${who}) has the cache share "64% (30–72%)", ranged comparisons and "method v"`, () => {
      const post = linkedInPost({ ...input, sample });
      expect(post).toContain("64% (30–72%)");
      expect(post).toContain(EV);
      expect(post).toContain(FRIDGE);
      expect(post).toContain(`method v${params.version}`);
      expect(post.replace(/\d+% \(\d+–\d+%\)/g, ""), "a bare % left in the post").not.toMatch(/\d%/);
    });
  }

  it('RANGE-9 the demo post (low end 30%) does not say "The surprise:" even though the central is 64%', () => {
    expect(refShare(byType("cacheRead"), e.total).low).toBeLessThan(0.5);
    expect(linkedInPost(input)).not.toContain("The surprise:");
  });

  it('RANGE-9 a post whose cache share low end is >= 50% says "The surprise:"', () => {
    const record: UsageRecord = {
      source: "claude-code",
      key: "r1",
      timestamp: "2026-10-01T10:00:00Z",
      model: "claude-opus-4-6",
      project: null,
      tokens: { input: 0, cacheWrite: 0, cacheRead: 100_000_000, output: 1_000 },
    };
    const heavy = estimate([record], params);
    const read = heavy.byType.find((r) => r.key === "cacheRead")!.energy;
    expect(refShare(read, heavy.total).low, "fixture precondition: low end >= 50%").toBeGreaterThanOrEqual(0.5);
    expect(linkedInPost({ ...input, estimate: heavy })).toContain("The surprise:");
  });
});
