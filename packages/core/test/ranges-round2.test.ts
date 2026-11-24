import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claudeCodeAdapter,
  comparisons,
  defaultParams as params,
  estimate,
  everyday,
  formatEnergy,
  linkedInPost,
  receiptSvg,
  shareLine,
  type Range,
} from "../src/index.js";

// M4.8.3 fix round (SPEC-RANGES; ux-reviewer findings UX-R14, UX-R15, both P2). Core half; the CLI half is
// packages/cli/test/ranges-round2-cli.test.ts and the page half packages/web/test/ranges-round2.test.ts.
//
// Pinned for the engineer:
//  - UX-R14: a comparison's range ENDS are rounded to 2 significant figures, at most 1 decimal
//    (102 -> 100, 106 -> 110, 4.4 stays, 0.9 stays, 20 stays). The central keeps its current rule
//    ("about 28 miles"). Demo: "driving an EV about 28 miles (4.4–100)", "running a fridge about 5.7 days (0.9–20)".
//  - UX-R15: one dash style. kWh/Wh ranges use the tight en dash too: formatEnergy(...).range is
//    "1.3–30.5" (no spaces), so the share line and post read "(range 1.3–30.5 kWh)" and the card's
//    RANGE row "1.3–30.5 kWh".

const demo = readFileSync(new URL("../../../fixtures/claude-code/demo.jsonl", import.meta.url), "utf8");
const e = estimate(claudeCodeAdapter.parse(demo), params);
const input = { estimate: e, params, windowLabel: "last 30 days" };

const EV = "driving an EV about 28 miles (4.4–100)";
const FRIDGE = "running a fridge about 5.7 days (0.9–20)";
const SPACED = /\d[  ]–[  ]\d/; // "1.3 – 30.5"
const EV_KWH = params.comparisons.ev_kwh_per_mile!.value;
/** A Wh total whose EV corners are exactly low / central / high miles. */
const miles = (low: number, central: number, high: number): Range => ({ low: low * EV_KWH * 1000, central: central * EV_KWH * 1000, high: high * EV_KWH * 1000 });
const ev = (t: Range) => comparisons(t, params).find((c) => c.id === "ev")!.text;

/** True when a shown end has at most 2 significant figures and at most 1 decimal ("<0.1" allowed). */
function twoSig(end: string): boolean {
  if (end === "<0.1") return true;
  const s = end.replace(/,/g, "");
  if (/\.\d{2,}/.test(s)) return false;
  return s.replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length <= 2;
}
const ends = (text: string) => [...text.matchAll(/\(([<\d.,]+)–([\d.,]+)(?: charges)?\)/g)].flatMap((m) => [m[1]!, m[2]!]);

describe("UX-R14 comparison range ends: 2 significant figures, at most 1 decimal", () => {
  it(`UX-R14 demo comparisons read "${EV}" and "${FRIDGE}"`, () => {
    const lines = comparisons(e.total, params);
    expect(lines.find((c) => c.id === "ev")?.text).toBe(EV);
    expect(lines.find((c) => c.id === "fridge")?.text).toBe(FRIDGE);
  });

  it("UX-R14 ends round, not truncate: 102 -> 100, 106 -> 110, 12.34 -> 12, 4.44 -> 4.4", () => {
    expect(ev(miles(4.44, 28, 102))).toBe("driving an EV about 28 miles (4.4–100)");
    expect(ev(miles(4.44, 28, 106))).toBe("driving an EV about 28 miles (4.4–110)");
    expect(ev(miles(12.34, 50, 230))).toBe("driving an EV about 50 miles (12–230)");
  });

  it("UX-R14 every demo comparison end has at most 2 significant figures and 1 decimal", () => {
    for (const c of comparisons(e.total, params)) for (const end of ends(c.text)) expect(twoSig(end), `${c.id}: "${c.text}"`).toBe(true);
  });

  it("UX-R14 sweep over totals from 1 Wh to 500 kWh: every end has at most 2 significant figures and 1 decimal", () => {
    for (let wh = 1; wh <= 500_000; wh *= 1.37) {
      for (const c of comparisons({ low: wh * 0.15, central: wh, high: wh * 3.6 }, params)) {
        for (const end of ends(c.text)) expect(twoSig(end), `${Math.round(wh)} Wh ${c.id}: "${c.text}"`).toBe(true);
      }
    }
  });

  it(`UX-R14 everyday, share line, post and card all carry "(4.4–100)", never "(4.4–102)"`, () => {
    const outs = {
      everyday: everyday(e.total, params),
      shareLine: shareLine(input),
      post: linkedInPost(input),
      postSample: linkedInPost({ ...input, sample: true }),
      card: receiptSvg(input),
    };
    expect(outs.everyday).toBe(`${EV} · ${FRIDGE}`);
    for (const [k, v] of Object.entries(outs)) {
      expect(v, k).toContain("(4.4–100)");
      expect(v, k).not.toContain("4.4–102");
    }
  });
});

describe("UX-R15 one dash style: kWh ranges use the tight en dash", () => {
  it('UX-R15 formatEnergy gives "1.3–30.5" (no spaces around the en dash)', () => {
    expect(formatEnergy({ low: 1300, central: 8500, high: 30500 }).range).toBe("1.3–30.5");
    expect(formatEnergy({ low: 90, central: 620, high: 2200 }).range).toBe("0.09–2.2");
    expect(formatEnergy(e.total).range).toBe("1.3–30.5");
  });

  for (const sample of [false, true]) {
    const who = sample ? "sample" : "real data";
    it(`UX-R15 share line (${who}) reads "(range 1.3–30.5 kWh)" and has no spaced dash between numbers`, () => {
      const line = shareLine({ ...input, sample });
      expect(line).toContain("(range 1.3–30.5 kWh)");
      expect(line).not.toMatch(SPACED);
    });

    it(`UX-R15 post (${who}) reads "(range 1.3–30.5 kWh)" and has no spaced dash between numbers`, () => {
      const post = linkedInPost({ ...input, sample });
      expect(post).toContain("(range 1.3–30.5 kWh)");
      expect(post).not.toMatch(SPACED);
    });
  }

  it('UX-R15 card: RANGE row reads "1.3–30.5 kWh"; no spaced dash between numbers anywhere on the card', () => {
    const svg = receiptSvg(input);
    expect(svg).toMatch(/RANGE \.+ 1\.3–30\.5 kWh/);
    expect(svg).not.toMatch(SPACED);
  });
});
