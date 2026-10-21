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
  const value = input.trim().toLowerCase();
  if (value === "all") return { start: null, label: "all time" };
  const rel = /^(\d+)\s*([hdw])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] as "h" | "d" | "w";
    const ms = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit] * n;
    const word = { h: "hour", d: "day", w: "week" }[unit];
    return { start: new Date(now.getTime() - ms).toISOString(), label: `last ${n} ${word}${n === 1 ? "" : "s"}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) {
    return { start: `${value}T00:00:00.000Z`, label: `since ${value}` };
  }
  throw new Error(`Can't read --since "${input}". Use 7d, 12h, 4w, a date like 2026-10-01, or all.`);
}
