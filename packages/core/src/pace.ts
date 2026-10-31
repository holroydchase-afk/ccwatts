import { defaultParams } from "./params.js";
import type { ActivityEvent } from "./types.js";

/**
 * Pace: work-rhythm counts from activity events. Pure: the caller passes the events and the
 * IANA time zone; this module never reads the clock or the system zone, and its output holds
 * only per-day minute counts and whole hours, never an event's time.
 */

export interface PaceRange {
  low: number;
  central: number;
  high: number;
}

export interface PaceOptions {
  /** IANA zone the caller chose, e.g. "Europe/London". Used only through Intl.DateTimeFormat. */
  timeZone: string;
  /** Idle gap (minutes) that ends a block, at three settings. Low gives the low active time. */
  gapMinutes: PaceRange;
  /** A pause of at least this many minutes ends a stretch. */
  breakMinutes: number;
  /** Local hours counted as late night, from startHour up to endHour (may wrap past midnight). */
  lateNight: { startHour: number; endHour: number };
}

/** A run of events with no gap longer than the threshold. Its length is end - start. */
export interface PaceBlock {
  start: string;
  end: string;
  /** True if the block holds at least one human turn; otherwise it is agent time. */
  human: boolean;
}

export interface PaceDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Minutes in blocks with a human turn, at the low/central/high gap. */
  activeMinutes: PaceRange;
  /** Minutes in blocks with no human turn (agents running on their own). */
  agentMinutes: PaceRange;
  /** Human-block minutes in late-night hours, central gap. */
  lateNightMinutes: number;
  /** Longest human run with no pause of breakMinutes or more, central gap. */
  longestStretchMinutes: number;
  /** First and last local hour (0-23) with human-block minutes, central gap; null if none. */
  firstHour: number | null;
  lastHour: number | null;
}

/** Pace options from methodology/params.json for the given zone. */
export const defaultPaceOptions = (timeZone: string): PaceOptions => {
  const pace = defaultParams.pace;
  return {
    timeZone,
    gapMinutes: { low: pace.gap_minutes.low, central: pace.gap_minutes.value, high: pace.gap_minutes.high },
    breakMinutes: pace.break_minutes.value,
    lateNight: { startHour: pace.late_night.start_hour, endHour: pace.late_night.end_hour },
  };
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Valid event times in ms, ascending, with their human flag. */
function sortedTimes(events: ActivityEvent[]): { ms: number; human: boolean }[] {
  return events
    .map((e) => ({ ms: Date.parse(e.timestamp), human: e.human }))
    .filter((e) => !Number.isNaN(e.ms))
    .sort((a, b) => a.ms - b.ms);
}

/** Groups sorted times into runs split on any gap strictly longer than `gapMs`. */
function groupRuns<T extends { ms: number }>(times: T[], gapMs: number): T[][] {
  const runs: T[][] = [];
  for (const t of times) {
    const run = runs[runs.length - 1];
    if (run && t.ms - run[run.length - 1]!.ms <= gapMs) run.push(t);
    else runs.push([t]);
  }
  return runs;
}

/** Work blocks: events sorted, split on any gap longer than `gapMinutes`, whatever line follows. */
export function paceBlocks(events: ActivityEvent[], gapMinutes: number): PaceBlock[] {
  return groupRuns(sortedTimes(events), gapMinutes * MINUTE).map((run) => ({
    start: new Date(run[0]!.ms).toISOString(),
    end: new Date(run[run.length - 1]!.ms).toISOString(),
    human: run.some((e) => e.human),
  }));
}

/** Local wall-clock fields for an instant in one zone. */
interface Local {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

/** Reads local wall-clock time through Intl only, so DST follows the zone's own rules. */
function localClock(timeZone: string): (ms: number) => Local {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (ms) => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(ms)) p[part.type] = part.value;
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second) };
  };
}

/** A piece of a span that sits inside one local hour of one local day. */
interface Slice {
  date: string;
  hour: number;
  ms: number;
}

/**
 * Cuts [start, end) at every local hour boundary (so also at local midnight), in real elapsed
 * time. The next boundary is guessed from the wall clock; if an offset change lands before it,
 * a binary search finds the exact instant. A 23- or 25-hour day comes out right either way.
 */
function slices(start: number, end: number, clock: (ms: number) => Local): Slice[] {
  const out: Slice[] = [];
  const same = (a: Local, b: Local) => a.date === b.date && a.hour === b.hour;
  let t = start;
  while (t < end) {
    const here = clock(t);
    let next = t + HOUR - (here.minute * MINUTE + here.second * 1000 + (((t % 1000) + 1000) % 1000));
    if (next > end) next = end;
    else if (!same(clock(next - 1), here)) {
      let lo = t; // same hour as t
      let hi = next - 1; // a different hour
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (same(clock(mid), here)) lo = mid;
        else hi = mid;
      }
      next = hi;
    }
    out.push({ date: here.date, hour: here.hour, ms: next - t });
    t = next;
  }
  return out;
}

const isLateNight = (hour: number, { startHour, endHour }: PaceOptions["lateNight"]) =>
  startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;

/** Per-day totals in ms, while they are being summed. */
interface DayTotals {
  active: [number, number, number];
  agent: [number, number, number];
  lateNight: number;
  longestStretch: number;
  firstHour: number | null;
  lastHour: number | null;
}

const LEVELS = ["low", "central", "high"] as const;
const CENTRAL = 1;

/** Ms to minutes, rounded to 0.1. */
const toMinutes = (ms: number) => Math.round(ms / MINUTE / 0.1) / 10;

/** Three values as an ordered range. Agent time is not monotone in the gap (a low gap can cut agent-only pieces off a human block), so it is sorted. */
const asRange = (values: [number, number, number]): PaceRange => {
  const [low, central, high] = values.map(toMinutes).sort((a, b) => a - b) as [number, number, number];
  return { low, central, high };
};

/**
 * Daily pace counts in the caller's zone, sorted by date. Only days with some minutes appear.
 * Human blocks are active time; blocks with no human turn are agent time, reported apart.
 */
export function paceDays(events: ActivityEvent[], options: PaceOptions): PaceDay[] {
  // Intl would quietly use the system zone for a missing one; the caller must choose (PS-R6).
  if (typeof options.timeZone !== "string" || options.timeZone === "") throw new Error("paceDays needs a time zone");
  const clock = localClock(options.timeZone);
  const times = sortedTimes(events);
  const days = new Map<string, DayTotals>();
  const dayOf = (date: string): DayTotals => {
    let d = days.get(date);
    if (!d) {
      d = { active: [0, 0, 0], agent: [0, 0, 0], lateNight: 0, longestStretch: 0, firstHour: null, lastHour: null };
      days.set(date, d);
    }
    return d;
  };

  for (const i of [0, 1, 2] as const) {
    for (const block of groupRuns(times, options.gapMinutes[LEVELS[i]] * MINUTE)) {
      const human = block.some((e) => e.human);
      const start = block[0]!.ms;
      const end = block[block.length - 1]!.ms;
      for (const s of slices(start, end, clock)) {
        const d = dayOf(s.date);
        (human ? d.active : d.agent)[i] += s.ms;
        if (i !== CENTRAL || !human) continue;
        if (isLateNight(s.hour, options.lateNight)) d.lateNight += s.ms;
        // Slices come in time order, so the first one seen sets firstHour and the last sets lastHour.
        d.firstHour ??= s.hour;
        d.lastHour = s.hour;
      }
      if (i !== CENTRAL || !human) continue;
      // Stretches: runs inside the block with no pause of breakMinutes or more.
      for (const stretch of groupRuns(block, options.breakMinutes * MINUTE - 1)) {
        const perDay = new Map<string, number>();
        for (const s of slices(stretch[0]!.ms, stretch[stretch.length - 1]!.ms, clock)) {
          perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.ms);
        }
        for (const [date, ms] of perDay) {
          const d = dayOf(date);
          d.longestStretch = Math.max(d.longestStretch, ms);
        }
      }
    }
  }

  return [...days.entries()]
    .filter(([, d]) => [...d.active, ...d.agent].some((ms) => ms > 0))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => ({
      date,
      activeMinutes: asRange(d.active),
      agentMinutes: asRange(d.agent),
      lateNightMinutes: toMinutes(d.lateNight),
      longestStretchMinutes: toMinutes(d.longestStretch),
      firstHour: d.firstHour,
      lastHour: d.lastHour,
    }));
}
