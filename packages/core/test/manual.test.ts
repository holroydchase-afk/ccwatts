import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultParams as params,
  energyForCounts,
  estimate,
  estimateFromTotal,
  parseTokenCount,
  TOKEN_TYPES,
  type TokenCounts,
  type UsageRecord,
} from "../src/index.js";

// EST: estimate from a token count you enter (Chase, Nov 19). Spec: packages/core/src/manual.ts,
// exported from index.ts. Synthetic numbers only; no private session data in this file.

const sum = (t: TokenCounts) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);
const raw = JSON.parse(readFileSync(new URL("../../../methodology/params.json", import.meta.url), "utf8"));

describe("EST-1 parseTokenCount", () => {
  const accepts: [string, number][] = [
    ["88.8M", 88_800_000],
    ["88.8m", 88_800_000],
    ["88,800,000", 88_800_000],
    ["88800000", 88_800_000],
    ["1.2k", 1_200],
    ["1.2K", 1_200],
    ["3B", 3_000_000_000],
    [" 88.8 M ", 88_800_000],
    ["88.8M tokens", 88_800_000],
    ["1.5", 2], // rounds to an integer
    ["10000B", 1e13], // the ceiling itself is allowed
  ];
  for (const [text, want] of accepts) {
    it(`EST-1 accepts ${JSON.stringify(text)} as ${want}`, () => {
      expect(parseTokenCount(text)).toBe(want);
    });
  }

  const rejects = ["", "abc", "-5", "0", "1e400", "NaN", "5MM", "10001B", "20000000000000"];
  for (const text of rejects) {
    it(`EST-1 rejects ${JSON.stringify(text)}`, () => {
      expect(parseTokenCount(text)).toBeNull();
    });
  }
});

describe("EST-2 params.json token_mix", () => {
  const mix = params.token_mix?.typical_claude_code;

  it("EST-2 has a sourced, MEASURED typical Claude Code mix dated 2026-11-19", () => {
    expect(mix, "params.token_mix.typical_claude_code").toBeDefined();
    expect(mix.label).toBe("MEASURED");
    expect(mix.as_of).toBe("2026-11-19");
    expect(typeof mix.source).toBe("string");
    expect(mix.source).toMatch(/Claude Code sessions/);
  });

  it("EST-2 central, light and heavy each have the four token types and sum to 1", () => {
    for (const name of ["central", "light", "heavy"] as const) {
      const shares = mix?.[name];
      expect(shares, name).toBeDefined();
      expect(Object.keys(shares).sort(), name).toEqual([...TOKEN_TYPES].sort());
      for (const k of TOKEN_TYPES) expect(shares[k], `${name}.${k}`).toBeGreaterThanOrEqual(0);
      expect(sum(shares), name).toBeCloseTo(1, 9);
    }
  });

  it("EST-2 token_mix is appended after pace (clear of PR #98's edits)", () => {
    const keys = Object.keys(raw);
    expect(keys).toContain("token_mix");
    expect(keys.indexOf("token_mix")).toBeGreaterThan(keys.indexOf("pace"));
  });
});

describe("EST-3 estimateFromTotal with the assumed mix", () => {
  it("EST-3 low < central < high, and the method version is the params version", () => {
    for (const tokens of [1, 1_000, 650_000, 88_800_000, 3_000_000_000]) {
      const r = estimateFromTotal({ tokens, model: "opus" }, params);
      expect(r.methodVersion).toBe(params.version);
      expect(r.mixAssumed).toBe(true);
      expect(r.total.low, `${tokens}`).toBeLessThan(r.total.central);
      expect(r.total.central, `${tokens}`).toBeLessThan(r.total.high);
    }
  });

  it("EST-3 the assumed split is whole tokens and sums exactly to the total", () => {
    for (const tokens of [1, 7, 999, 12_345, 88_800_000, 88_800_001]) {
      const r = estimateFromTotal({ tokens, model: "opus" }, params);
      for (const k of TOKEN_TYPES) expect(Number.isInteger(r.tokens[k]), `${tokens} ${k}`).toBe(true);
      expect(sum(r.tokens), `${tokens}`).toBe(tokens);
    }
  });

  it("EST-3 central uses the central mix, low the light mix, high the heavy mix", () => {
    const tokens = 88_800_000;
    const r = estimateFromTotal({ tokens, model: "opus" }, params);
    const { central, light, heavy } = params.token_mix.typical_claude_code;
    const split = (m: TokenCounts) => Object.fromEntries(TOKEN_TYPES.map((k) => [k, tokens * m[k]])) as TokenCounts;
    // Rounding the split moves the answer by well under a part per million.
    expect(r.total.central).toBeCloseTo(energyForCounts(split(central), "opus", params).central, 0);
    expect(r.total.low).toBeCloseTo(energyForCounts(split(light), "opus", params).low, 0);
    expect(r.total.high).toBeCloseTo(energyForCounts(split(heavy), "opus", params).high, 0);
  });

  it("EST-4 sanity: 88.8M tokens on Opus is between 4 and 5.5 kWh central", () => {
    const r = estimateFromTotal({ tokens: 88_800_000, model: "Opus 5" }, params);
    expect(r.tier).toBe("opus");
    expect(r.total.central).toBeGreaterThan(4_000);
    expect(r.total.central).toBeLessThan(5_500);
  });
});

describe("EST-5 estimateFromTotal with a split you know", () => {
  it("EST-5 uses the given counts as-is, puts the rest in cache read, and drops 'mix assumed'", () => {
    const r = estimateFromTotal({ tokens: 1_000_000, model: "opus", mix: { output: 10_000, cacheWrite: 40_000 } }, params);
    expect(r.mixAssumed).toBe(false);
    expect(r.tokens).toEqual({ input: 0, cacheWrite: 40_000, cacheRead: 950_000, output: 10_000 });
    const want = energyForCounts(r.tokens, "opus", params);
    expect(r.total.low).toBeCloseTo(want.low, 9);
    expect(r.total.central).toBeCloseTo(want.central, 9);
    expect(r.total.high).toBeCloseTo(want.high, 9);
  });

  it("EST-5 when the given counts add up past the total, the total becomes their sum", () => {
    const r = estimateFromTotal({ tokens: 100, model: "opus", mix: { output: 500, cacheRead: 1_000 } }, params);
    expect(r.tokens).toEqual({ input: 0, cacheWrite: 0, cacheRead: 1_000, output: 500 });
    expect(sum(r.tokens)).toBe(1_500);
  });

  it("EST-5 a known split gives a narrower range than the assumed mix", () => {
    const assumed = estimateFromTotal({ tokens: 88_800_000, model: "opus" }, params);
    const { central } = params.token_mix.typical_claude_code;
    const mix = Object.fromEntries(TOKEN_TYPES.map((k) => [k, Math.round(88_800_000 * central[k])]));
    const known = estimateFromTotal({ tokens: 88_800_000, model: "opus", mix }, params);
    expect(known.total.high / known.total.low).toBeLessThan(assumed.total.high / assumed.total.low);
  });
});

describe("EST-6 model names", () => {
  const cases: [string, string][] = [
    ["opus", "opus"],
    ["Opus 5", "opus"],
    ["claude-opus-5-5", "opus"],
    ["sonnet", "sonnet"],
    ["haiku", "haiku"],
  ];
  for (const [model, tier] of cases) {
    it(`EST-6 ${JSON.stringify(model)} is the ${tier} tier, no warning`, () => {
      const r = estimateFromTotal({ tokens: 1_000_000, model }, params);
      expect(r.model).toBe(model);
      expect(r.tier).toBe(tier);
      expect(r.knownModel).toBe(true);
      expect(r.warnings).toEqual([]);
    });
  }

  it("EST-6 an unknown model falls back with the same warning estimate() gives", () => {
    const r = estimateFromTotal({ tokens: 1_000_000, model: "gpt-9" }, params);
    expect(r.knownModel).toBe(false);
    expect(r.tier).toBe(String(params.tiers.fallback));
    expect(r.warnings).toEqual([`Unknown model "gpt-9": estimated as ${String(params.tiers.fallback)}.`]);
  });

  it("EST-6 Opus costs more than Sonnet, which costs more than Haiku, for the same count", () => {
    const at = (model: string) => estimateFromTotal({ tokens: 10_000_000, model }, params).total.central;
    expect(at("opus")).toBeGreaterThan(at("sonnet"));
    expect(at("sonnet")).toBeGreaterThan(at("haiku"));
  });
});

describe("EST-7 manual estimate agrees with the log path (synthetic records)", () => {
  // A synthetic 87.6M-token Opus session inside the measured mix (cache read 93%, cache write 6.5%,
  // output 0.45%, input 0.05%), split over 1,000 responses. Not anyone's real data.
  const records: UsageRecord[] = Array.from({ length: 1_000 }, (_, i) => ({
    source: "test",
    key: `r${i}`,
    timestamp: "2026-11-01T00:00:00Z",
    model: "claude-opus-5-5",
    project: null,
    tokens: { input: 44, cacheWrite: 5_694, cacheRead: 81_468, output: 394 },
  }));
  const fromLogs = estimate(records, params);
  const total = sum(fromLogs.tokens);
  // Called inside each test, so one missing export fails these tests, not the whole file.
  const manual = () => estimateFromTotal({ tokens: total, model: "opus" }, params);

  it("EST-7 the synthetic set is about 87.6M tokens", () => {
    expect(total).toBeGreaterThan(87_000_000);
    expect(total).toBeLessThan(88_000_000);
  });

  it("EST-7 central estimates are within 2x of each other", () => {
    const ratio = manual().total.central / fromLogs.total.central;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it("EST-7 the log estimate sits inside the manual range", () => {
    expect(fromLogs.total.central).toBeGreaterThanOrEqual(manual().total.low);
    expect(fromLogs.total.central).toBeLessThanOrEqual(manual().total.high);
  });
});
