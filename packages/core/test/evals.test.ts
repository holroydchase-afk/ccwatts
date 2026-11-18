// Task EVAL: an eval scorecard for the energy model, plus the pricing fix for model ids that match
// no tier (claude-fable-5-2 and claude-mythos-5-2 were priced as Sonnet, half of Opus).
// Synthetic counts only. Data files and the scorecard module are loaded lazily, so each criterion
// fails on its own with the missing file named instead of the whole file failing to collect.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultParams, energyForCounts, tierFor, withOverrides, type Params, type Range, type TokenCounts } from "../src/index.js";

const root = new URL("../../../", import.meta.url);
const text = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const jsonFile = <T>(rel: string) => JSON.parse(text(rel)) as T;

interface ModelEntry {
  id: string;
  tier: string;
}
interface Reference {
  name: string;
  low: number;
  high: number;
  central?: number;
  source: string;
  as_of: string;
}
type Gate = "central-in-reference" | "reference-in-range";
interface EvalCase {
  id: string;
  title: string;
  tier: string;
  tokens: TokenCounts;
  days?: number;
  inputs: "published" | "assumed";
  gate: Gate;
  references: Reference[];
}
interface Scorecard {
  methodVersion: string;
  models: { id: string; tier: string; known: boolean; expected: string; pass: boolean }[];
  cases: { id: string; ours: Range; inputs: string; gate: string; results: { name: string; pass: boolean; ratio: number }[]; pass: boolean }[];
  sensitivity: { param: string; spread: number; spreadIfKnown: number; share: number }[];
  pass: boolean;
}
interface ScorecardModule {
  buildScorecard(params: Params, cases: EvalCase[], models: ModelEntry[]): Scorecard;
  renderScorecard(scorecard: Scorecard): string;
}

const models = () => jsonFile<ModelEntry[]>("evals/models.json");
const cases = () => jsonFile<EvalCase[]>("evals/cases.json");
const scorecardModule = () => import("../../../evals/scorecard.js") as Promise<ScorecardModule>;
const shipped = async () => {
  const m = await scorecardModule();
  return { ...m, card: m.buildScorecard(defaultParams, cases(), models()) };
};
const caseById = (id: string) => {
  const c = cases().find((x) => x.id === id);
  if (!c) throw new Error(`evals/cases.json has no case "${id}"`);
  return c;
};

/** What the scorecard should compute for a case, worked out here from core alone. */
const oursFor = (c: Pick<EvalCase, "tokens" | "tier" | "days">, params: Params = defaultParams): Range => {
  const r = energyForCounts(c.tokens, c.tier, params);
  const days = c.days ?? 1;
  return { low: r.low * days, central: r.central * days, high: r.high * days };
};

const HEAVY_DAY: TokenCounts = { input: 100_000, cacheWrite: 1_000_000, cacheRead: 20_000_000, output: 150_000 };
const MODEL_TIERS: Record<string, string> = {
  "claude-opus-4-6": "opus",
  "claude-sonnet-4-6": "sonnet",
  "claude-haiku-4-5": "haiku",
  "claude-opus-5-5": "opus",
  "claude-sonnet-5-5": "sonnet",
  "claude-haiku-5-5": "haiku",
  "claude-fable-5-2": "opus",
  "claude-mythos-5-2": "opus",
};

describe("EVAL-1 Model coverage", () => {
  it("EVAL-1 evals/models.json is a list of { id, tier } and includes the eight required models", () => {
    const list = models();
    expect(Array.isArray(list)).toBe(true);
    for (const m of list) {
      expect(typeof m.id, JSON.stringify(m)).toBe("string");
      expect(typeof m.tier, JSON.stringify(m)).toBe("string");
      expect(Object.keys(m).sort(), m.id).toEqual(["id", "tier"]);
    }
    expect(new Set(list.map((m) => m.id)).size, "model ids are unique").toBe(list.length);
    const byId = Object.fromEntries(list.map((m) => [m.id, m.tier]));
    for (const [id, tier] of Object.entries(MODEL_TIERS)) expect(byId[id], id).toBe(tier);
  });

  // Independent of the data file, so the pricing fix is pinned even if models.json changes.
  it.each(Object.entries(MODEL_TIERS))("EVAL-1 tierFor(%s) is %s and known", (id, tier) => {
    expect(tierFor(id, defaultParams)).toEqual({ tier, known: true });
  });

  it("EVAL-1 every entry in evals/models.json resolves to its expected tier, known: true", () => {
    const list = models();
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const m of list) expect(tierFor(m.id, defaultParams), m.id).toEqual({ tier: m.tier, known: true });
  });

  it("EVAL-1 an invented id (mystery-1) is still unknown and gets the fallback tier", () => {
    expect(tierFor("mystery-1", defaultParams)).toEqual({ tier: String(defaultParams.tiers.fallback), known: false });
    expect(defaultParams.tiers.fallback).toBe("sonnet");
  });
});

describe("EVAL-2 Version strings", () => {
  it("EVAL-2 the method version is 0.1.2", () => {
    expect(defaultParams.version).toBe("0.1.2");
  });

  it("EVAL-2 METHODOLOGY.md's header line carries the params version", () => {
    const header = text("METHODOLOGY.md").match(/\*\*Method version ([^*]+)\*\*/);
    expect(header?.[1], "the '**Method version X**' line").toBe(defaultParams.version);
  });

  it("EVAL-2 METHODOLOGY.md's Parameters heading carries the params version", () => {
    const heading = text("METHODOLOGY.md").match(/^## Parameters \(v([^)]+)\)\s*$/m);
    expect(heading?.[1], "the '## Parameters (vX)' heading").toBe(defaultParams.version);
  });

  it("EVAL-2 README.md no longer says method v0.1.0", () => {
    expect(text("README.md")).not.toContain("method v0.1.0");
  });
});

describe("EVAL-4 Cases file", () => {
  it("EVAL-4 evals/cases.json is a list of well-formed cases", () => {
    const list = cases();
    expect(Array.isArray(list)).toBe(true);
    expect(new Set(list.map((c) => c.id)).size, "case ids are unique").toBe(list.length);
    const tiers = Object.keys(defaultParams.tiers).filter((t) => t !== "fallback");
    for (const c of list) {
      expect(c.id, JSON.stringify(c).slice(0, 80)).toMatch(/^[a-z0-9-]+$/);
      expect(c.title.trim().length, c.id).toBeGreaterThan(0);
      expect(tiers, `${c.id} tier`).toContain(c.tier);
      expect(Object.keys(c.tokens).sort(), `${c.id} tokens`).toEqual(["cacheRead", "cacheWrite", "input", "output"]);
      for (const [type, count] of Object.entries(c.tokens)) {
        expect(Number.isInteger(count) && count >= 0, `${c.id} tokens.${type}`).toBe(true);
      }
      expect(Object.values(c.tokens).reduce((a, b) => a + b, 0), `${c.id} has some tokens`).toBeGreaterThan(0);
      if (c.days !== undefined) expect(Number.isInteger(c.days) && c.days >= 1, `${c.id} days`).toBe(true);
      expect(["published", "assumed"], `${c.id} inputs`).toContain(c.inputs);
      expect(["central-in-reference", "reference-in-range"], `${c.id} gate`).toContain(c.gate);
      expect(Array.isArray(c.references) && c.references.length > 0, `${c.id} references`).toBe(true);
    }
  });

  it("EVAL-4 every reference is in Wh with low <= high, an https source and a dated as_of", () => {
    for (const c of cases()) {
      for (const r of c.references) {
        const where = `${c.id} / ${r.name}`;
        expect(r.name.trim().length, where).toBeGreaterThan(0);
        expect(Number.isFinite(r.low) && r.low > 0, `${where} low`).toBe(true);
        expect(Number.isFinite(r.high), `${where} high`).toBe(true);
        expect(r.low, where).toBeLessThanOrEqual(r.high);
        if (r.central !== undefined) {
          expect(r.central, `${where} central`).toBeGreaterThanOrEqual(r.low);
          expect(r.central, `${where} central`).toBeLessThanOrEqual(r.high);
        }
        expect(r.source, where).toMatch(/^https:\/\/\S+$/);
        expect(r.as_of, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(r.as_of)), `${where} as_of is a real date`).toBe(false);
      }
    }
  });

  it("EVAL-4 contains chat-query, heavy-agentic-day, hausfather-8-weeks and cross-tool-heavy-day", () => {
    const ids = cases().map((c) => c.id);
    for (const id of ["chat-query", "heavy-agentic-day", "hausfather-8-weeks", "cross-tool-heavy-day"]) expect(ids).toContain(id);
  });

  it("EVAL-4 chat-query is the 1k input, 400 output Sonnet query from the sanity checks", () => {
    const c = caseById("chat-query");
    expect(c.tier).toBe("sonnet");
    expect(c.tokens).toEqual({ input: 1000, cacheWrite: 0, cacheRead: 0, output: 400 });
    expect(c.days ?? 1).toBe(1);
    // A per-query reference (Microsoft Research median 0.31 Wh, IQR 0.16-0.60, on Nov 18, 2026): well under 1 Wh.
    for (const r of c.references) expect(r.high, r.name).toBeLessThan(1);
  });

  it("EVAL-4 heavy-agentic-day is the Opus day from the sanity checks (20M cache reads)", () => {
    const c = caseById("heavy-agentic-day");
    expect(c.tier).toBe("opus");
    expect(c.tokens).toEqual(HEAVY_DAY);
    expect(c.days ?? 1).toBe(1);
  });

  it("EVAL-4 hausfather-8-weeks is 56 days against 70-330 kWh, with the token mix labeled assumed", () => {
    const c = caseById("hausfather-8-weeks");
    expect(c.tier).toBe("opus");
    expect(c.days).toBe(56);
    // His exact token counts are not published (METHODOLOGY.md), so ccwatts assumed the mix.
    expect(c.inputs).toBe("assumed");
    expect(c.gate).toBe("central-in-reference");
    const ref = c.references.find((r) => r.low === 70_000 && r.high === 330_000);
    expect(ref, "a reference of 70,000-330,000 Wh").toBeDefined();
    expect(ref?.central).toBe(170_000);
  });

  it("EVAL-4 cross-tool-heavy-day has 4 references, one per other estimator, each 0.85-1.6 kWh", () => {
    const c = caseById("cross-tool-heavy-day");
    expect(c.tier).toBe("opus");
    expect(c.tokens).toEqual(HEAVY_DAY);
    expect(c.gate).toBe("reference-in-range");
    expect(c.references).toHaveLength(4);
    const sources = c.references.map((r) => r.source).join("\n");
    for (const repo of [
      "github.com/gwittebolle/claude-carbon",
      "github.com/benjaminpope/claude-code-carbon-dashboard",
      "github.com/codeandqa/tokentoll",
      "github.com/tighe-ecc/claude-cost",
    ]) {
      expect(sources, repo).toContain(repo);
    }
    // METHODOLOGY.md "How ccwatts compares": the four tools land at 0.85-1.6 kWh for this day.
    for (const r of c.references) {
      expect(r.low, r.name).toBeGreaterThanOrEqual(840);
      expect(r.high, r.name).toBeLessThanOrEqual(1610);
    }
  });
});

describe("EVAL-5 Scorecard", () => {
  it("EVAL-5 evals/scorecard.ts exports buildScorecard and renderScorecard", async () => {
    const m = await scorecardModule();
    expect(typeof m.buildScorecard).toBe("function");
    expect(typeof m.renderScorecard).toBe("function");
  });

  it("EVAL-5 the module is pure: no file, process, network or clock access", () => {
    const src = text("evals/scorecard.ts");
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bprocess\./);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bconsole\./);
    expect(src).not.toMatch(/\bnew Date\b|\bDate\.now\b/);
    expect(src).not.toMatch(/\.json["']/); // data comes in as arguments, never imported here
  });

  it("EVAL-5 with the shipped files every model and case passes", async () => {
    const { card } = await shipped();
    expect(card.methodVersion).toBe(defaultParams.version);
    expect(card.models.filter((m) => !m.pass).map((m) => m.id), "failing models").toEqual([]);
    expect(card.cases.filter((c) => !c.pass).map((c) => c.id), "failing cases").toEqual([]);
    expect(card.pass).toBe(true);
  });

  it("EVAL-5 one model row per models.json entry: { id, tier, known, expected, pass }", async () => {
    const { card } = await shipped();
    expect(card.models).toEqual(models().map((m) => ({ id: m.id, tier: m.tier, known: true, expected: m.tier, pass: true })));
  });

  it("EVAL-5 one case row per cases.json entry, with ours as a low/central/high range times days", async () => {
    const { card } = await shipped();
    const list = cases();
    expect(card.cases.map((c) => c.id)).toEqual(list.map((c) => c.id));
    for (const [i, row] of card.cases.entries()) {
      const c = list[i]!;
      const want = oursFor(c);
      expect(row.ours.low, `${c.id} low`).toBeCloseTo(want.low, 6);
      expect(row.ours.central, `${c.id} central`).toBeCloseTo(want.central, 6);
      expect(row.ours.high, `${c.id} high`).toBeCloseTo(want.high, 6);
      expect(row.ours.low, c.id).toBeLessThan(row.ours.central);
      expect(row.ours.central, c.id).toBeLessThan(row.ours.high);
      expect(row.inputs, c.id).toBe(c.inputs);
      expect(row.gate, c.id).toBe(c.gate);
      expect(row.results.map((r) => r.name), c.id).toEqual(c.references.map((r) => r.name));
      for (const r of row.results) {
        expect(typeof r.pass, `${c.id} / ${r.name}`).toBe("boolean");
        expect(Number.isFinite(r.ratio) && r.ratio > 0, `${c.id} / ${r.name} ratio`).toBe(true);
      }
      expect(row.pass, c.id).toBe(row.results.every((r) => r.pass));
    }
  });

  const synthetic = (gate: Gate, ref: Omit<Reference, "name" | "source" | "as_of">): EvalCase => ({
    id: "synthetic",
    title: "Synthetic gate check",
    tier: "opus",
    tokens: HEAVY_DAY,
    inputs: "assumed",
    gate,
    references: [{ name: "synthetic reference", source: "https://example.com/", as_of: "2026-11-18", ...ref }],
  });
  const gateResult = async (gate: Gate, ref: Omit<Reference, "name" | "source" | "as_of">) => {
    const { buildScorecard } = await scorecardModule();
    const card = buildScorecard(defaultParams, [synthetic(gate, ref)], []);
    return { result: card.cases[0]?.results[0]?.pass, casePass: card.cases[0]?.pass, pass: card.pass };
  };
  const yes = { result: true, casePass: true, pass: true };
  const no = { result: false, casePass: false, pass: false };

  it("EVAL-5 gate central-in-reference: passes when our central is inside [ref.low, ref.high]", async () => {
    const ours = oursFor({ tokens: HEAVY_DAY, tier: "opus" });
    expect(await gateResult("central-in-reference", { low: ours.central * 0.9, high: ours.central * 1.1 })).toEqual(yes);
  });

  it("EVAL-5 gate central-in-reference: fails when our central is above or below the reference", async () => {
    const ours = oursFor({ tokens: HEAVY_DAY, tier: "opus" });
    expect(await gateResult("central-in-reference", { low: ours.central * 1.1, high: ours.central * 2 })).toEqual(no);
    expect(await gateResult("central-in-reference", { low: ours.central * 0.5, high: ours.central * 0.9 })).toEqual(no);
    // Our range overlapping the reference is not enough: the gate is about the central value.
    expect(await gateResult("central-in-reference", { low: ours.high * 0.9, high: ours.high * 2 })).toEqual(no);
  });

  it("EVAL-5 gate reference-in-range: with a central, only the central has to sit inside our range", async () => {
    const ours = oursFor({ tokens: HEAVY_DAY, tier: "opus" });
    expect(await gateResult("reference-in-range", { low: ours.low / 10, central: ours.central, high: ours.high * 10 })).toEqual(yes);
    expect(await gateResult("reference-in-range", { low: ours.high * 1.1, central: ours.high * 1.2, high: ours.high * 2 })).toEqual(no);
    expect(await gateResult("reference-in-range", { low: ours.low / 10, central: ours.low / 2, high: ours.low / 1.5 })).toEqual(no);
  });

  it("EVAL-5 gate reference-in-range: with no central, both low and high have to sit inside our range", async () => {
    const ours = oursFor({ tokens: HEAVY_DAY, tier: "opus" });
    expect(await gateResult("reference-in-range", { low: ours.low * 1.1, high: ours.high * 0.9 })).toEqual(yes);
    expect(await gateResult("reference-in-range", { low: ours.low * 0.9, high: ours.high * 0.9 })).toEqual(no);
    expect(await gateResult("reference-in-range", { low: ours.low * 1.1, high: ours.high * 1.1 })).toEqual(no);
  });

  it("EVAL-5 a case passes only when every one of its references passes", async () => {
    const { buildScorecard } = await scorecardModule();
    const ours = oursFor({ tokens: HEAVY_DAY, tier: "opus" });
    const c = synthetic("central-in-reference", { low: ours.central * 0.9, high: ours.central * 1.1 });
    c.references.push({ name: "too high", low: ours.central * 2, high: ours.central * 3, source: "https://example.com/", as_of: "2026-11-18" });
    const card = buildScorecard(defaultParams, [c], []);
    expect(card.cases[0]?.results.map((r) => r.pass)).toEqual([true, false]);
    expect(card.cases[0]?.pass).toBe(false);
    expect(card.pass).toBe(false);
  });

  it("EVAL-5 broken input: a models entry expecting opus for mystery-1 fails the scorecard", async () => {
    const { buildScorecard } = await scorecardModule();
    const card = buildScorecard(defaultParams, cases(), [...models(), { id: "mystery-1", tier: "opus" }]);
    const row = card.models.find((m) => m.id === "mystery-1");
    expect(row).toEqual({ id: "mystery-1", tier: String(defaultParams.tiers.fallback), known: false, expected: "opus", pass: false });
    expect(card.pass).toBe(false);
  });

  it("EVAL-5 broken input: an unknown model fails even when the fallback tier happens to match", async () => {
    // Stricter reading: a model passes only as { tier: expected, known: true }, as in EVAL-1.
    const { buildScorecard } = await scorecardModule();
    const card = buildScorecard(defaultParams, cases(), [{ id: "mystery-1", tier: String(defaultParams.tiers.fallback) }]);
    expect(card.models[0]?.known).toBe(false);
    expect(card.models[0]?.pass).toBe(false);
    expect(card.pass).toBe(false);
  });

  it("EVAL-5 broken input: cache_read_vs_input overridden far out fails the scorecard", async () => {
    const { buildScorecard } = await scorecardModule();
    const card = buildScorecard(withOverrides(defaultParams, { cache_read_vs_input: 5 }), cases(), models());
    expect(card.cases.find((c) => c.id === "hausfather-8-weeks")?.pass).toBe(false);
    expect(card.pass).toBe(false);
  });

  it("EVAL-5 buildScorecard is deterministic and leaves its inputs alone", async () => {
    const { buildScorecard } = await scorecardModule();
    const c = cases();
    const m = models();
    const before = JSON.stringify([defaultParams, c, m]);
    expect(buildScorecard(defaultParams, c, m)).toEqual(buildScorecard(defaultParams, c, m));
    expect(JSON.stringify([defaultParams, c, m])).toBe(before);
  });
});

describe("EVAL-6 Sensitivity", () => {
  const CHAIN = ["output_wh_per_1k.opus", "input_vs_output", "cache_write_vs_input", "cache_read_vs_input"];
  const spreadOf = (params: Params) => {
    const r = energyForCounts(HEAVY_DAY, "opus", params);
    return r.high / r.low;
  };

  it("EVAL-6 one row per parameter in the heavy-agentic-day tier's chain", async () => {
    const { card } = await shipped();
    expect(card.sensitivity.map((r) => r.param).sort()).toEqual([...CHAIN].sort());
  });

  it("EVAL-6 spread is high/low of the heavy-agentic-day total with every bound in play", async () => {
    const { card } = await shipped();
    const day = caseById("heavy-agentic-day");
    const ours = oursFor(day);
    expect(card.sensitivity).toHaveLength(CHAIN.length);
    for (const row of card.sensitivity) expect(row.spread, row.param).toBeCloseTo(ours.high / ours.low, 6);
    expect(spreadOf(defaultParams)).toBeGreaterThan(1);
  });

  it("EVAL-6 spreadIfKnown is high/low with that one parameter pinned at its value", async () => {
    const { card } = await shipped();
    expect(card.sensitivity).toHaveLength(CHAIN.length);
    for (const row of card.sensitivity) {
      const pinned = withOverrides(defaultParams, { [row.param]: defaultParams.params[row.param]!.value }, { pin: true });
      expect(row.spreadIfKnown, row.param).toBeCloseTo(spreadOf(pinned), 6);
    }
  });

  it("EVAL-6 share is 1 - ln(spreadIfKnown) / ln(spread)", async () => {
    const { card } = await shipped();
    expect(card.sensitivity).toHaveLength(CHAIN.length);
    for (const row of card.sensitivity) {
      expect(row.share, row.param).toBeCloseTo(1 - Math.log(row.spreadIfKnown) / Math.log(row.spread), 9);
    }
  });

  it("EVAL-6 every share is between 0 and 1, and pinning never widens the range", async () => {
    const { card } = await shipped();
    expect(card.sensitivity).toHaveLength(CHAIN.length);
    for (const row of card.sensitivity) {
      expect(row.share, row.param).toBeGreaterThanOrEqual(0);
      expect(row.share, row.param).toBeLessThanOrEqual(1);
      expect(row.spreadIfKnown, row.param).toBeLessThanOrEqual(row.spread);
      expect(row.spreadIfKnown, row.param).toBeGreaterThanOrEqual(1);
    }
  });

  it("EVAL-6 rows are sorted by share, largest first, and output_wh_per_1k.opus is on top", async () => {
    const { card } = await shipped();
    const shares = card.sensitivity.map((r) => r.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    expect(card.sensitivity[0]?.param).toBe("output_wh_per_1k.opus");
    expect(card.sensitivity[0]?.share).toBeGreaterThan(card.sensitivity.at(-1)?.share ?? Infinity);
  });
});

describe("EVAL-7 Committed report is current and honest", () => {
  it("EVAL-7 docs/EVALS.md exists", () => {
    expect(existsSync(new URL("docs/EVALS.md", root)), "docs/EVALS.md").toBe(true);
  });

  it("EVAL-7 docs/EVALS.md equals renderScorecard(buildScorecard(...)) exactly", async () => {
    const { card, renderScorecard } = await shipped();
    expect(text("docs/EVALS.md")).toBe(renderScorecard(card));
  });

  it("EVAL-7 rendering is deterministic: same scorecard, same markdown", async () => {
    const { buildScorecard, renderScorecard } = await scorecardModule();
    const once = renderScorecard(buildScorecard(defaultParams, cases(), models()));
    const twice = renderScorecard(buildScorecard(defaultParams, cases(), models()));
    expect(typeof once).toBe("string");
    expect(once.length).toBeGreaterThan(0);
    expect(twice).toBe(once);
  });

  it("EVAL-7 the report carries the method version", () => {
    expect(text("docs/EVALS.md")).toContain(defaultParams.version);
  });

  it("EVAL-7 the report has a section headed 'What this does not show'", () => {
    expect(text("docs/EVALS.md")).toMatch(/^#{1,6} What this does not show\s*$/m);
  });

  it("EVAL-7 the report says 'assumed' for cases whose inputs are assumed", async () => {
    const { card, renderScorecard } = await shipped();
    const assumed = cases().filter((c) => c.inputs === "assumed");
    expect(assumed.length, "at least hausfather-8-weeks is assumed").toBeGreaterThan(0);
    expect(text("docs/EVALS.md")).toContain("assumed");
    // Stricter reading: the word comes from the case's own label, not from fixed boilerplate.
    const allPublished = { ...card, cases: card.cases.map((c) => ({ ...c, inputs: "published" })) };
    const count = (s: string) => s.split("assumed").length - 1;
    expect(count(renderScorecard(card))).toBeGreaterThan(count(renderScorecard(allPublished)));
  });

  it("EVAL-7 the report names every model and every case", () => {
    const report = text("docs/EVALS.md");
    for (const m of models()) expect(report, m.id).toContain(m.id);
    for (const c of cases()) expect(report.includes(c.id) || report.includes(c.title), c.id).toBe(true);
  });

  it("EVAL-7 the report has no absolute home path and no run date", () => {
    const report = text("docs/EVALS.md");
    expect(report).not.toMatch(/\/home\/|\/Users\/|\/root\/|[A-Za-z]:\\|file:\/\//);
    expect(report).not.toMatch(/\b(generated|run) (on|at)\b/i);
  });

  it("EVAL-7 package.json has an evals script", () => {
    const pkg = jsonFile<{ scripts: Record<string, string> }>("package.json");
    expect(pkg.scripts.evals, "scripts.evals").toBeTruthy();
  });
});
