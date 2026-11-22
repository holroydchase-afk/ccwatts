// The eval scorecard for the energy model. Pure: params, cases and model ids come in as arguments,
// a scorecard and its markdown come out. scripts/run-evals.ts does the file reading and writing.
import { energyForCounts, int, num, tierFor, withOverrides, type Params, type Range, type TokenCounts } from "../packages/core/src/index.ts";

/** A model id and the tier it must resolve to (evals/models.json). */
export interface ModelEntry {
  id: string;
  tier: string;
}

/** An outside figure in Wh. `central` is left out when the source gives only a range. */
export interface Reference {
  name: string;
  low: number;
  high: number;
  central?: number;
  source: string;
  as_of: string;
}

/**
 * central-in-reference: our central value sits inside the reference's low to high.
 * reference-in-range: the reference's central sits inside our low to high, or with no central, both its low and high do.
 */
export type Gate = "central-in-reference" | "reference-in-range";

/** One reference check (evals/cases.json). `tokens` are per day; `days` multiplies the result. */
export interface EvalCase {
  id: string;
  title: string;
  tier: string;
  tokens: TokenCounts;
  days?: number;
  /** "published" only when the reference published the token counts; otherwise ccwatts assumed the mix. */
  inputs: "published" | "assumed";
  gate: Gate;
  references: Reference[];
}

export interface ModelRow {
  id: string;
  tier: string;
  known: boolean;
  expected: string;
  pass: boolean;
}

export interface ReferenceResult {
  name: string;
  pass: boolean;
  /** Our central over the reference's central, or over the midpoint of its range when it has no central. */
  ratio: number;
  low: number;
  high: number;
  central: number | null;
  source: string;
}

export interface CaseRow {
  id: string;
  title: string;
  tier: string;
  tokens: TokenCounts;
  days: number;
  ours: Range;
  inputs: string;
  gate: string;
  results: ReferenceResult[];
  pass: boolean;
}

export interface SensitivityRow {
  param: string;
  /** High over low of the total, with every parameter's bounds in play. */
  spread: number;
  /** The same, with this one parameter pinned at its value. */
  spreadIfKnown: number;
  /** Share of the range, on a log scale, that goes away if this parameter were known exactly. */
  share: number;
}

export interface Scorecard {
  methodVersion: string;
  models: ModelRow[];
  cases: CaseRow[];
  /** Computed on the case named SENSITIVITY_CASE; empty when the cases don't include it. */
  sensitivity: SensitivityRow[];
  pass: boolean;
}

export const SENSITIVITY_CASE = "heavy-agentic-day";

/** The parameters that multiply into a tier's total (the chain in packages/core/src/energy.ts). */
const chainFor = (tier: string) => [`output_wh_per_1k.${tier}`, "input_vs_output", "cache_write_vs_input", "cache_read_vs_input"];

function oursFor(c: EvalCase, params: Params): Range {
  const r = energyForCounts(c.tokens, c.tier, params);
  const days = c.days ?? 1;
  return { low: r.low * days, central: r.central * days, high: r.high * days };
}

const inside = (x: number, low: number, high: number) => x >= low && x <= high;

function passes(gate: Gate, ours: Range, ref: Reference): boolean {
  if (gate === "central-in-reference") return inside(ours.central, ref.low, ref.high);
  if (ref.central !== undefined) return inside(ref.central, ours.low, ours.high);
  return inside(ref.low, ours.low, ours.high) && inside(ref.high, ours.low, ours.high);
}

function sensitivity(c: EvalCase, params: Params): SensitivityRow[] {
  const spreadOf = (p: Params) => {
    const r = energyForCounts(c.tokens, c.tier, p);
    return r.high / r.low;
  };
  const spread = spreadOf(params);
  return chainFor(c.tier)
    .map((param) => {
      const value = params.params[param]?.value;
      if (value === undefined) throw new Error(`Missing parameter "${param}"`);
      const spreadIfKnown = spreadOf(withOverrides(params, { [param]: value }, { pin: true }));
      return { param, spread, spreadIfKnown, share: 1 - Math.log(spreadIfKnown) / Math.log(spread) };
    })
    .sort((a, b) => b.share - a.share);
}

/** Runs every check. A model passes only when its id is known and lands on the expected tier. */
export function buildScorecard(params: Params, cases: readonly EvalCase[], models: readonly ModelEntry[]): Scorecard {
  const modelRows = models.map((m) => {
    const { tier, known } = tierFor(m.id, params);
    return { id: m.id, tier, known, expected: m.tier, pass: known && tier === m.tier };
  });
  const caseRows = cases.map((c) => {
    const ours = oursFor(c, params);
    const results = c.references.map((ref) => ({
      name: ref.name,
      pass: passes(c.gate, ours, ref),
      ratio: ours.central / (ref.central ?? (ref.low + ref.high) / 2),
      low: ref.low,
      high: ref.high,
      central: ref.central ?? null,
      source: ref.source,
    }));
    return {
      id: c.id,
      title: c.title,
      tier: c.tier,
      tokens: { ...c.tokens },
      days: c.days ?? 1,
      ours,
      inputs: c.inputs,
      gate: c.gate,
      results,
      pass: results.every((r) => r.pass),
    };
  });
  const day = cases.find((c) => c.id === SENSITIVITY_CASE);
  return {
    methodVersion: params.version,
    models: modelRows,
    cases: caseRows,
    sensitivity: day ? sensitivity(day, params) : [],
    pass: modelRows.every((m) => m.pass) && caseRows.every((c) => c.pass),
  };
}

const cell = (s: string) => s.replace(/\|/g, "/");
const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)];
const verdict = (pass: boolean) => (pass ? "pass" : "FAIL");
const pct = (share: number) => (share > 0 && share < 0.005 ? "under 1%" : `${Math.round(share * 100)}%`);
const times = (n: number) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}x`;

const GATES: Record<string, string> = {
  "central-in-reference": "ccwatts central inside the reference range",
  "reference-in-range": "reference inside the ccwatts range",
};

/** "1.6 kWh" for a point, "170 kWh (70 to 330)" with a central, "1 to 2 kWh" for a bare range. */
function refValue(r: ReferenceResult, show: (wh: number) => string, unit: string): string {
  if (r.low === r.high) return `${show(r.low)} ${unit}`;
  if (r.central === null) return `${show(r.low)} to ${show(r.high)} ${unit}`;
  return `${show(r.central)} ${unit} (${show(r.low)} to ${show(r.high)})`;
}

/** The scorecard as markdown (docs/EVALS.md). Same scorecard, same text: no dates, no paths. */
export function renderScorecard(card: Scorecard): string {
  const comparisons = card.cases.flatMap((c) => c.results);
  const count = (list: { pass: boolean }[]) => `${list.filter((x) => x.pass).length} of ${list.length}`;
  const assumed = card.cases.filter((c) => c.inputs === "assumed").length;
  const lines = [
    "# Eval scorecard",
    "",
    `**Method version ${card.methodVersion}. Overall: ${verdict(card.pass)}.** ${count(card.models)} model ids resolve to the expected tier. ${count(comparisons)} reference comparisons pass, across ${card.cases.length} cases.`,
    "",
    "This file is built by `npm run evals` from `evals/models.json`, `evals/cases.json` and `methodology/params.json`. Do not edit it by hand. A test fails if it is out of date.",
    "",
    "## Model coverage",
    "",
    "Each model id ccwatts expects to see must match a tier by name. An id that matches nothing is priced at the fallback tier and fails here.",
    "",
    ...table(
      ["Model id", "Tier", "Result"],
      card.models.map((m) => [
        `\`${m.id}\``,
        m.pass ? m.tier : `${m.tier}${m.known ? "" : " (fallback)"}, expected ${m.expected}`,
        verdict(m.pass),
      ]),
    ),
    "",
    "## Reference checks",
    "",
    "Each row compares a ccwatts estimate with one outside figure. \"Token inputs\" says whether the reference published its token counts or ccwatts assumed the mix. The ratio is the ccwatts central divided by the reference central.",
    "",
    ...table(
      ["Case", "Token inputs", "Reference", "Reference value", "ccwatts central (low to high)", "Ratio", "Gate", "Result"],
      card.cases.flatMap((c) => {
        const kwh = c.ours.high >= 1000;
        const unit = kwh ? "kWh" : "Wh";
        const show = (wh: number) => num(wh / (kwh ? 1000 : 1));
        return c.results.map((r) => [
          `${c.title} (\`${c.id}\`)`,
          c.inputs,
          `[${r.name}](${r.source})`,
          refValue(r, show, unit),
          `${show(c.ours.central)} ${unit} (${show(c.ours.low)} to ${show(c.ours.high)})`,
          r.central === null ? "no central published" : times(r.ratio),
          GATES[c.gate] ?? c.gate,
          verdict(r.pass),
        ]);
      }),
    ),
    "",
    "Token counts behind each case, per day:",
    "",
    ...card.cases.map(
      (c) =>
        `- \`${c.id}\` (${c.tier} tier, token mix ${c.inputs}): ${int(c.tokens.input)} input, ${int(c.tokens.cacheWrite)} cache write, ${int(c.tokens.cacheRead)} cache read, ${int(c.tokens.output)} output${c.days > 1 ? `, times ${c.days} days` : ""}.`,
    ),
    "",
    "## What drives the range",
    "",
  ];
  const top = card.sensitivity[0];
  if (top) {
    lines.push(
      `Computed on \`${SENSITIVITY_CASE}\`. Range width is the high estimate divided by the low one. Each row pins one parameter at its central value and leaves the other bounds alone. Share is how much of the range goes away, on a log scale.`,
      "",
      ...table(
        ["Parameter", "Range width now", "Width if this were known exactly", "Share of the range"],
        card.sensitivity.map((s) => [`\`${s.param}\``, times(s.spread), times(s.spreadIfKnown), pct(s.share)]),
      ),
      "",
      `The top driver is \`${top.param}\`: knowing it exactly would remove ${pct(top.share)} of the range. Shares do not add up to 100%, because the bounds combine as root-sum-of-squares.`,
    );
  } else {
    lines.push(`Not computed: the cases do not include \`${SENSITIVITY_CASE}\`.`);
  }
  lines.push(
    "",
    "## What this does not show",
    "",
    "- There is no ground truth. No provider publishes energy per token, so nothing here measures accuracy.",
    assumed === card.cases.length
      ? "- Every check uses a token mix ccwatts assumed. No reference published its token counts. These are consistency checks, not validation."
      : `- ${assumed} of ${card.cases.length} checks use a token mix ccwatts assumed. Those are consistency checks, not validation.`,
    "- The cross-tool check prices the same token mix with other tools' factors. It compares models like for like. It does not show that any of them is right.",
    "- The model-coverage list holds the ids we know about. A new model id is not covered until someone adds it to `evals/models.json`.",
    "- An outside review of the cache-read factor has not happened yet.",
    "",
    "## How to rerun",
    "",
    "```",
    "npm run evals",
    "```",
    "",
    "That rewrites this file. `npx tsx scripts/run-evals.ts --check` writes nothing and exits 1 if this file is stale or any check fails. `npm test` runs the same comparison (`packages/core/test/evals.test.ts`).",
    "",
  );
  return lines.join("\n");
}
