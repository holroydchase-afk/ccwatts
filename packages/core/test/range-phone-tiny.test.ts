import { describe, expect, it } from "vitest";
import { comparisons, defaultParams as params, type Range } from "../src/index.js";

// M4.8.3 fix round, QA-R1 (qa-tdd finding on SPEC-RANGES RANGE-2/RANGE-3, CCW-RR-20).
// Phone comparisons for small totals. Totals here are Wh Ranges (Estimate.total), as comparisons takes.
//
// Pinned for the engineer:
//  - CCW-RR-20's original tiny case (0.00005 kWh central) reads "under 1% of a phone charge". Its high
//    corner is 0.0001 kWh = 0.53% of a charge, which rounds to 1%, so the "under 1%" check must use the
//    rounded high ("<1" never appears after "about").
//  - When the phone range crosses 100% (central below one charge, high above one), no percent above 100
//    is printed. The line switches to charges: central 0.5 reads
//      "about half a phone charge (0.1–1.5 charges)"
//    (ends rounded like other comparison ends, en dash, no spaces).

const PHONE_KWH = params.comparisons.phone_charge_kwh!.value; // 0.019
const spread = (kwh: number): Range => ({ low: kwh * 500, central: kwh * 1000, high: kwh * 2000 });
/** A Wh total whose phone-charge corners are exactly low / central / high charges. */
const charges = (low: number, central: number, high: number): Range => ({
  low: low * PHONE_KWH * 1000,
  central: central * PHONE_KWH * 1000,
  high: high * PHONE_KWH * 1000,
});
const phone = (total: Range) => comparisons(total, params).find((c) => c.id === "phone")?.text ?? "";

describe("QA-R1 tiny phone comparisons (CCW-RR-20 + RANGE-2/3)", () => {
  it("QA-R1 the original CCW-RR-20 tiny case (0.00005 kWh) still reads 'under 1% of a phone charge'", () => {
    expect(phone(spread(0.00005))).toBe("under 1% of a phone charge");
  });

  it("QA-R1 no phone comparison reads 'about <1%'", () => {
    for (const kwh of [0.000002, 0.00002, 0.00005, 0.0001, 0.00015]) expect(phone(spread(kwh)), `${kwh} kWh`).not.toMatch(/about <1%/);
  });
});

describe("QA-R1 a phone range that crosses one charge never prints a percent above 100", () => {
  it('QA-R1 0.1 / 0.5 / 1.5 charges reads "about half a phone charge (0.1–1.5 charges)"', () => {
    expect(phone(charges(0.1, 0.5, 1.5))).toBe("about half a phone charge (0.1–1.5 charges)");
  });

  it("QA-R1 central below one charge, high above one: no % at all, range given in charges", () => {
    for (const [lo, c, hi] of [
      [0.12, 0.5, 1.45],
      [0.1, 0.3, 1.2],
      [0.05, 0.8, 3],
    ] as const) {
      const t = phone(charges(lo, c, hi));
      expect(t, `${lo}/${c}/${hi}`).not.toMatch(/%/);
      expect(t, `${lo}/${c}/${hi}`).toMatch(/\([<\d.]+–[\d.]+ charges\)$/);
    }
  });

  it("QA-R1 sweep: no phone line anywhere prints a percent above 100", () => {
    for (let c = 0.01; c < 1; c += 0.01) {
      for (const k of [1.5, 2, 3, 4]) {
        const t = phone(charges(c / k, c, c * k));
        for (const m of t.matchAll(/(\d+)%/g)) expect(Number(m[1]), t).toBeLessThanOrEqual(100);
      }
    }
  });
});
