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
