import { energyForCounts, tierFor, type Range } from "./energy.js";
import type { Params, TokenShares } from "./params.js";
import { TOKEN_TYPES, type TokenCounts } from "./types.js";

/**
 * Estimating from a token total someone types in (a cloud thread or chat that shows only a total).
 * Pure: no logs, no I/O. The token-type mix is assumed unless the caller gives the split.
 */

/** The largest count we accept: 10 trillion tokens. Anything above is a typo. */
export const MAX_TOKEN_COUNT = 1e13;

/** Shown with an estimate whose token-type mix was assumed (UX-R28), in the CLI and on the page. */
export const MIX_GUESSED = "Wide range: the mix of token types is guessed.";

const SUFFIX: Record<string, number> = { "": 1, k: 1e3, m: 1e6, b: 1e9 };

/**
 * A token count from text: "88.8M", "1.2k", "3B", "88,800,000", "88.8M tokens". Rounds to a whole
 * number. Null for anything else, for zero or less, and for more than MAX_TOKEN_COUNT.
 */
export function parseTokenCount(text: string): number | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*([kmb]?)(?:\s*tokens?)?$/i.exec(text.trim());
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const n = Number(`${(m[1] ?? "0").replace(/,/g, "")}${m[2] ?? ""}`) * SUFFIX[m[3]!.toLowerCase()]!;
  const count = Math.round(n);
  if (!Number.isFinite(count) || count <= 0 || count > MAX_TOKEN_COUNT) return null;
  return count;
}

export interface ManualInput {
  /** The token total. */
  tokens: number;
  /** Free text: "opus", "Opus 5", "claude-opus-5-5". Callers default to "opus". */
  model: string;
  /** Counts you know, by type. When given, the mix isn't assumed; the rest of the total goes to cache read. */
  mix?: Partial<TokenCounts>;
}

export interface ManualEstimate {
  methodVersion: string;
  model: string;
  tier: string;
  knownModel: boolean;
  /** The split used: assumed from the typical mix, or the one given. Whole tokens, summing to the total. */
  tokens: TokenCounts;
  /** Wh. */
  total: Range;
  mixAssumed: boolean;
  warnings: string[];
}

/** Splits a total by shares into whole tokens that sum exactly to it (largest remainder). */
function split(total: number, shares: TokenShares): TokenCounts {
  const exact = TOKEN_TYPES.map((k) => total * shares[k]);
  const out = Object.fromEntries(TOKEN_TYPES.map((k, i) => [k, Math.floor(exact[i]!)])) as TokenCounts;
  let left = total - TOKEN_TYPES.reduce((s, k) => s + out[k], 0);
  const order = TOKEN_TYPES.map((k, i) => ({ k, r: exact[i]! - out[k] })).sort((a, b) => b.r - a.r);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i]!.k]++;
  return out;
}

const whole = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/**
 * Energy for a token total. With no split, the total is divided by the measured typical Claude
 * Code mix: central from the central mix, low from the light mix's low, high from the heavy mix's
 * high, so the range also covers not knowing the mix. With a split, the normal range for those counts.
 */
export function estimateFromTotal(input: ManualInput, params: Params): ManualEstimate {
  const { tier, known } = tierFor(input.model, params);
  const warnings = known ? [] : [`Unknown model "${input.model}": estimated as ${String(params.tiers.fallback)}.`];
  const base = { methodVersion: params.version, model: input.model, tier, knownModel: known, warnings };
  const total = whole(input.tokens);

  if (input.mix && TOKEN_TYPES.some((k) => input.mix![k] !== undefined)) {
    const tokens = Object.fromEntries(TOKEN_TYPES.map((k) => [k, whole(input.mix![k])])) as TokenCounts;
    const given = TOKEN_TYPES.reduce((s, k) => s + tokens[k], 0);
    if (total > given) tokens.cacheRead += total - given;
    return { ...base, tokens, total: energyForCounts(tokens, tier, params), mixAssumed: false };
  }

  const mix = params.token_mix.typical_claude_code;
  const tokens = split(total, mix.central);
  const range: Range = {
    low: energyForCounts(split(total, mix.light), tier, params).low,
    central: energyForCounts(tokens, tier, params).central,
    high: energyForCounts(split(total, mix.heavy), tier, params).high,
  };
  return { ...base, tokens, total: range, mixAssumed: true };
}
