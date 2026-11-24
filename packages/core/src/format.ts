import type { Range } from "./energy.js";
import type { TokenType } from "./types.js";

/** Display formatting shared by the CLI, receipt and web page. */

export const TYPE_LABELS: Record<TokenType, string> = {
  input: "input",
  cacheWrite: "cache write",
  cacheRead: "cache read",
  output: "output",
};

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Rounds to a sensible number of digits for its size. */
export function num(n: number): string {
  if (n >= 100) return int(n);
  if (n >= 1) return (Math.round(n * 10) / 10).toString();
  if (n >= 0.01) return (Math.round(n * 100) / 100).toString();
  return n === 0 ? "0" : n.toPrecision(1);
}

/** Like num(), but keeps one decimal between 1 and 100 ("8.0", not "8"), so totals line up across surfaces. */
const fixed = (n: number) => (n >= 1 && n < 100 ? n.toFixed(1) : num(n));

/** Picks Wh or kWh from the high bound and uses it for the whole range, so no row reads "88.5–2,155 Wh". Tight en dash, like every other range (UX-R15). */
export function formatEnergy(range: Range): { central: string; range: string; unit: string } {
  const kwh = range.high >= 1000;
  const scale = kwh ? 1000 : 1;
  const unit = kwh ? "kWh" : "Wh";
  return {
    central: `${fixed(range.central / scale)} ${unit}`,
    range: `${fixed(range.low / scale)}–${fixed(range.high / scale)}`,
    unit,
  };
}

export const shortModel = (model: string) => model.replace(/^claude-/, "");

/**
 * A part's share of a total, as fractions 0..1, at the low, central and high corners (part.low/total.low,
 * and so on). The bounds of a share don't line up with the bounds of energy (cache write's share is
 * largest when the total is smallest), so low and high are the min and max of the three ratios.
 * An empty total gives 0s. Pure: inputs are never touched.
 */
export function shareRange(part: Range, total: Range): Range {
  const r = (a: number, b: number) => (b > 0 ? a / b : 0);
  const corners = [r(part.low, total.low), r(part.central, total.central), r(part.high, total.high)] as const;
  return { low: Math.min(...corners), central: corners[1], high: Math.max(...corners) };
}

/** "64% (30–72%)"; "7%" when every corner rounds the same; "<1%" for a share above 0 that rounds to 0. */
export function formatShare(share: Range): string {
  const p = (v: number) => (v > 0 && Math.round(v * 100) === 0 ? "<1" : String(Math.round(v * 100)));
  const [lo, c, hi] = [p(share.low), p(share.central), p(share.high)];
  return lo === c && c === hi ? `${c}%` : `${c}% (${lo}–${hi}%)`;
}
