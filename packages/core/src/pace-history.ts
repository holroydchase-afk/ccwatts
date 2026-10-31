import { okCount, okDate } from "./history.js";
import type { PaceDay, PaceOptions, PaceRange } from "./pace.js";

export const PACE_SCHEMA = 1;

/**
 * The thresholds a pace history was counted with. Stored in the header so a later run can tell
 * whether its counts compare. Never the time zone: it says where someone lives (PS-R7).
 */
export type PaceMethod = Omit<PaceOptions, "timeZone">;

/** The method part of pace options, copied key by key so nothing else rides along. */
export const paceMethod = (o: PaceMethod): PaceMethod => ({
  gapMinutes: { low: o.gapMinutes.low, central: o.gapMinutes.central, high: o.gapMinutes.high },
  breakMinutes: o.breakMinutes,
  lateNight: { startHour: o.lateNight.startHour, endHour: o.lateNight.endHour },
});

/** Minutes rounded to 0.1. */
const tenth = (n: number) => Math.round(n * 10) / 10;
const range = (r: PaceRange): PaceRange => ({ low: tenth(r.low), central: tenth(r.central), high: tenth(r.high) });

/** One stored day, built from an explicit key list (never a spread), so extra fields can't leak (PS-R7). */
const toRow = (d: PaceDay): PaceDay => ({
  date: d.date,
  activeMinutes: range(d.activeMinutes),
  agentMinutes: range(d.agentMinutes),
  lateNightMinutes: tenth(d.lateNightMinutes),
  longestStretchMinutes: tenth(d.longestStretchMinutes),
  firstHour: d.firstHour,
  lastHour: d.lastHour,
});

const DAY_KEYS = ["activeMinutes", "agentMinutes", "date", "firstHour", "lastHour", "lateNightMinutes", "longestStretchMinutes"].join();

/** Serializes pace history as JSONL: a header with the method, then one day per line. */
export function serializePaceHistory(days: readonly PaceDay[], method: PaceMethod): string {
  const header = JSON.stringify({ schema: PACE_SCHEMA, kind: "daily-pace", method: paceMethod(method) });
  return [header, ...days.map((d) => JSON.stringify(toRow(d)))].join("\n") + "\n";
}

/** Reads pace history. Lines that aren't a well-formed header or day are skipped. */
export function parsePaceHistory(text: string): { method: PaceMethod | null; days: PaceDay[] } {
  let method: PaceMethod | null = null;
  const days: PaceDay[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (isHeader(value)) method ??= paceMethod(value.method);
    else if (isDay(value)) days.push(toRow(value));
  }
  return { method, days };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Three counts in order: low <= central <= high. */
const okRange = (v: unknown): v is PaceRange =>
  isObject(v) && okCount(v.low) && okCount(v.central) && okCount(v.high) && (v.low as number) <= (v.central as number) && (v.central as number) <= (v.high as number);

/** A whole local hour, 0-23. */
const okHour = (h: unknown): h is number => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23;

function isHeader(v: unknown): v is { method: PaceMethod } {
  if (!isObject(v) || v.schema !== PACE_SCHEMA || v.kind !== "daily-pace" || !isObject(v.method)) return false;
  const m = v.method;
  return okRange(m.gapMinutes) && okCount(m.breakMinutes) && isObject(m.lateNight) && okHour(m.lateNight.startHour) && okHour(m.lateNight.endHour);
}

/** A day we can trust: exactly the PaceDay keys, a real date, ordered finite counts, whole hours or null. */
function isDay(v: unknown): v is PaceDay {
  if (!isObject(v) || Object.keys(v).sort().join() !== DAY_KEYS) return false;
  return (
    okDate(v.date) &&
    okRange(v.activeMinutes) &&
    okRange(v.agentMinutes) &&
    okCount(v.lateNightMinutes) &&
    okCount(v.longestStretchMinutes) &&
    (v.firstHour === null || okHour(v.firstHour)) &&
    (v.lastHour === null || okHour(v.lastHour))
  );
}

const total = (d: PaceDay) => d.activeMinutes.central + d.agentMinutes.central;

/**
 * Merges stored pace days with days counted from the logs on disk now. Logs only grow until
 * Claude Code deletes old sessions, so with the same method the larger active + agent total is
 * the more complete day (fresh wins ties). If the method changed, fresh days replace stored
 * ones for every date the logs still cover; older stored days are kept.
 */
export function mergePaceHistory(stored: readonly PaceDay[], fresh: readonly PaceDay[], sameMethod: boolean): PaceDay[] {
  const days = new Map<string, PaceDay>();
  for (const d of stored) {
    const prev = days.get(d.date);
    if (!prev || total(d) > total(prev)) days.set(d.date, d);
  }
  for (const d of fresh) {
    const prev = days.get(d.date);
    if (!sameMethod || !prev || total(d) >= total(prev)) days.set(d.date, d);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
