import data from "../../../methodology/params.json";

export type ConfidenceLabel = "DISCLOSED" | "MEASURED" | "MODELED" | "GUESS";

/** One sourced number. low/high bound the value; see METHODOLOGY.md for how ranges combine. */
export interface Param {
  value: number;
  low: number;
  high: number;
  unit: string;
  label: ConfidenceLabel;
  source: string;
  as_of: string;
  note: string;
}

export interface Comparison {
  value: number;
  unit: string;
  label: ConfidenceLabel;
  source: string;
  as_of: string;
  note: string;
}

export interface Params {
  version: string;
  as_of: string;
  license: string;
  boundary: string;
  interval: string;
  params: Record<string, Param>;
  /** Tier name to substrings matched against the model id, plus the fallback tier. */
  tiers: Record<string, string[] | string>;
  comparisons: Record<string, Comparison>;
}

/** The parameter set shipped with this build (methodology/params.json). */
export const defaultParams = data as Params;

/**
 * A copy of `params` with some parameters moved, for "What if?" views. Each override sets the
 * parameter's value and scales its low and high by the same ratio, so the spread is unchanged.
 * With `pin`, the parameter is fixed instead: low = high = value, so it adds no spread.
 * The input is never mutated. Throws on an unknown id or a value that isn't a positive number.
 */
export function withOverrides(params: Params, overrides: Record<string, number>, opts: { pin?: boolean } = {}): Params {
  const next: Record<string, Param> = { ...params.params };
  for (const [id, value] of Object.entries(overrides)) {
    const p = params.params[id];
    if (!p) throw new Error(`Unknown parameter "${id}"`);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Parameter "${id}" must be a positive number, got ${value}`);
    const ratio = value / p.value;
    next[id] = opts.pin ? { ...p, value, low: value, high: value } : { ...p, value, low: p.low * ratio, high: p.high * ratio };
  }
  return { ...params, params: next };
}
