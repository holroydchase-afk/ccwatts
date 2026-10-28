/** A time window for filtering usage. `start` is an ISO timestamp, or null for all time. */
export interface Window {
  start: string | null;
  label: string;
}

/**
 * Parses --since values: "7d", "12h", "4w", "2026-10-01", or "all".
 * `now` is passed in so the core stays pure and testable.
 */
export function parseSince(input: string, now: Date): Window {
  const bad = () => new Error(`Can't read --since "${input}". Use 7d, 12h, 4w, a date like 2026-10-01, or all.`);
  const value = input.trim().toLowerCase();
  if (value === "all") return { start: null, label: "all time" };
  const rel = /^(\d+)\s*([hdw])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] as "h" | "d" | "w";
    const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit] * n;
    const word = { h: "hour", d: "day", w: "week" }[unit];
    const start = new Date(now.getTime() - ms);
    // A window wider than any date can hold (99999999999d) has no start to count from.
    if (Number.isNaN(start.getTime())) throw bad();
    return { start: start.toISOString(), label: `last ${n} ${word}${n === 1 ? "" : "s"}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) {
    return { start: `${value}T00:00:00.000Z`, label: `since ${value}` };
  }
  throw bad();
}

/** Responses dated more than this far after now are a wrong clock or a corrupt line, not usage. */
export const FUTURE_SLACK_MS = 86_400_000;

/**
 * Splits off records dated more than a day after `now` (a little clock skew is fine). They are
 * left out so a bad date can't stretch history into the future. `now` is passed in to keep the core pure.
 */
export function dropFuture<T extends { timestamp: string }>(records: readonly T[], now: Date): { kept: T[]; future: number } {
  const limit = now.getTime() + FUTURE_SLACK_MS;
  const kept = records.filter((r) => !(Date.parse(r.timestamp) > limit));
  return { kept, future: records.length - kept.length };
}

/** The note shown when some responses were left out for being dated in the future. */
export const futureNote = (n: number) => `Ignored ${n} response${n === 1 ? "" : "s"} dated in the future.`;
