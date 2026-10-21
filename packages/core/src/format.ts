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

/** Picks Wh or kWh from the central value and uses it for the whole range. */
export function formatEnergy(range: Range): { central: string; range: string; unit: string } {
  const kwh = range.central >= 1000;
  const scale = kwh ? 1000 : 1;
  const unit = kwh ? "kWh" : "Wh";
  return {
    central: `${num(range.central / scale)} ${unit}`,
    range: `${num(range.low / scale)} – ${num(range.high / scale)}`,
    unit,
  };
}

export const shortModel = (model: string) => model.replace(/^claude-/, "");
