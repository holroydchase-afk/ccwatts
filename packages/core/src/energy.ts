import type { Param, Params } from "./params.js";
import { TOKEN_TYPES, type TokenCounts, type TokenType, type UsageRecord } from "./types.js";

/** An energy estimate in watt-hours. Never shown without low and high. */
export interface Range {
  low: number;
  central: number;
  high: number;
}

export const zeroRange = (): Range => ({ low: 0, central: 0, high: 0 });

export function addRange(into: Range, from: Range): Range {
  into.low += from.low;
  into.central += from.central;
  into.high += from.high;
  return into;
}

export interface Tier {
  tier: string;
  /** False when the model id matched no tier and the fallback was used. */
  known: boolean;
}

export function tierFor(model: string, params: Params): Tier {
  const id = model.toLowerCase();
  for (const [tier, patterns] of Object.entries(params.tiers)) {
    if (Array.isArray(patterns) && patterns.some((p) => id.includes(p))) return { tier, known: true };
  }
  return { tier: String(params.tiers.fallback), known: false };
}

/** Energy per token for one tier and token type: central Wh plus log-space spread up and down. */
interface Factor {
  whPerToken: number;
  up: number;
  down: number;
}

function param(params: Params, id: string): Param {
  const p = params.params[id];
  if (!p) throw new Error(`Missing parameter "${id}" in params.json`);
  return p;
}

/** Which parameters multiply together for each token type. */
function chain(tier: string, type: TokenType): string[] {
  const output = `output_wh_per_1k.${tier}`;
  switch (type) {
    case "output":
      return [output];
    case "input":
      return [output, "input_vs_output"];
    case "cacheWrite":
      return [output, "input_vs_output", "cache_write_vs_input"];
    case "cacheRead":
      return [output, "input_vs_output", "cache_read_vs_input"];
  }
}

/**
 * Multiplies the chain's central values. Each parameter's low/high is treated as an
 * independent ~90% interval on a log scale, so spreads combine as root-sum-of-squares.
 */
function factor(params: Params, tier: string, type: TokenType): Factor {
  let wh = 1 / 1000;
  let up2 = 0;
  let down2 = 0;
  for (const id of chain(tier, type)) {
    const p = param(params, id);
    wh *= p.value;
    up2 += Math.log(p.high / p.value) ** 2;
    down2 += Math.log(p.value / p.low) ** 2;
  }
  return { whPerToken: wh, up: Math.sqrt(up2), down: Math.sqrt(down2) };
}

export interface Breakdown {
  key: string;
  energy: Range;
  tokens: TokenCounts;
}

export interface Estimate {
  methodVersion: string;
  total: Range;
  tokens: TokenCounts;
  responses: number;
  byModel: Breakdown[];
  byType: Breakdown[];
  byDay: Breakdown[];
  byProject: Breakdown[];
  /** First and last day covered, YYYY-MM-DD, or null with no records. */
  span: { from: string; to: string } | null;
  warnings: string[];
}

export type Dimension = "model" | "type" | "day" | "project";

const empty = (): TokenCounts => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });

/** Wh for a set of token counts at one tier. Ranges add up across types (treated as fully correlated). */
export function energyForCounts(counts: TokenCounts, tier: string, params: Params): Range {
  const total = zeroRange();
  for (const type of TOKEN_TYPES) addRange(total, energyForTokens(counts[type], tier, type, params));
  return total;
}

const factorCache = new WeakMap<Params, Map<string, Factor>>();

function cachedFactor(params: Params, tier: string, type: TokenType): Factor {
  let byKey = factorCache.get(params);
  if (!byKey) factorCache.set(params, (byKey = new Map()));
  const key = `${tier}:${type}`;
  let f = byKey.get(key);
  if (!f) byKey.set(key, (f = factor(params, tier, type)));
  return f;
}

export function energyForTokens(tokens: number, tier: string, type: TokenType, params: Params): Range {
  if (tokens <= 0) return zeroRange();
  const f = cachedFactor(params, tier, type);
  const central = tokens * f.whPerToken;
  return { low: central / Math.exp(f.down), central, high: central * Math.exp(f.up) };
}

const day = (timestamp: string) => timestamp.slice(0, 10);

/** Estimates energy for usage records. Pure: same records and params, same answer. */
export function estimate(records: readonly UsageRecord[], params: Params): Estimate {
  const total = zeroRange();
  const tokens = empty();
  const groups: Record<Dimension, Map<string, Breakdown>> = {
    model: new Map(),
    type: new Map(),
    day: new Map(),
    project: new Map(),
  };
  const unknownModels = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;

  const bump = (dim: Dimension, key: string, energy: Range, type: TokenType, count: number) => {
    let row = groups[dim].get(key);
    if (!row) groups[dim].set(key, (row = { key, energy: zeroRange(), tokens: empty() }));
    addRange(row.energy, energy);
    row.tokens[type] += count;
  };

  for (const record of records) {
    const { tier, known } = tierFor(record.model, params);
    if (!known) unknownModels.add(record.model);
    const d = day(record.timestamp);
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
    const project = record.project?.name ?? "(unknown)";
    for (const type of TOKEN_TYPES) {
      const count = record.tokens[type];
      if (count <= 0) continue;
      const energy = energyForTokens(count, tier, type, params);
      addRange(total, energy);
      tokens[type] += count;
      bump("model", record.model, energy, type, count);
      bump("type", type, energy, type, count);
      bump("day", d, energy, type, count);
      // Two folders can share a basename; the hash keeps them apart, the name is for display.
      bump("project", record.project ? `${project}#${record.project.id}` : project, energy, type, count);
    }
  }

  const byEnergy = (rows: Map<string, Breakdown>) => [...rows.values()].sort((a, b) => b.energy.central - a.energy.central);
  const warnings = [...unknownModels].map(
    (m) => `Unknown model "${m}": estimated as ${String(params.tiers.fallback)}.`,
  );
  return {
    methodVersion: params.version,
    total,
    tokens,
    responses: records.length,
    byModel: byEnergy(groups.model),
    byType: byEnergy(groups.type),
    byDay: [...groups.day.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byProject: byEnergy(groups.project),
    span: from && to ? { from, to } : null,
    warnings,
  };
}

/** Display name for a byProject key ("name#hash" -> "name"). */
export const projectName = (key: string) => key.split("#")[0] ?? key;

/** Keep records at or after `since` (an ISO date or timestamp). */
export function since(records: readonly UsageRecord[], isoStart: string): UsageRecord[] {
  return records.filter((r) => r.timestamp >= isoStart);
}

export interface ComparisonLine {
  id: string;
  amount: number;
  text: string;
}

/** Everyday equivalents for a kWh amount, always from the central value, in display order. */
export function comparisons(kwh: number, params: Params): ComparisonLine[] {
  const c = params.comparisons;
  const out: ComparisonLine[] = [];
  const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  if (c.ev_kwh_per_mile) {
    const miles = kwh / c.ev_kwh_per_mile.value;
    out.push({ id: "ev", amount: miles, text: `driving an EV about ${round(miles)} miles` });
  }
  if (c.fridge_kwh_per_day) {
    const days = kwh / c.fridge_kwh_per_day.value;
    out.push({ id: "fridge", amount: days, text: `running a fridge about ${round(days)} days` });
  }
  if (c.phone_charge_kwh) {
    const charges = kwh / c.phone_charge_kwh.value;
    out.push({ id: "phone", amount: charges, text: `charging a phone about ${round(charges)} times` });
  }
  if (c.us_home_kwh_per_day) {
    const days = kwh / c.us_home_kwh_per_day.value;
    out.push({ id: "home", amount: days, text: `powering a US home about ${round(days)} days` });
  }
  return out;
}
