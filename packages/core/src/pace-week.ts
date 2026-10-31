import { weekStart } from "./history.js";
import type { PaceDay, PaceRange } from "./pace.js";

/**
 * Pace by week, from stored daily pace counts. Pure: the caller passes today's local date.
 * Comparisons are only ever against the same person's own earlier weeks, never a norm.
 */

export interface PaceWeek {
  /** Monday of the week, YYYY-MM-DD. */
  start: string;
  /** Hours in blocks with a human turn, low/central/high gap. */
  activeHours: PaceRange;
  /** Hours agents ran with no human turn in the block. */
  agentHours: PaceRange;
  /** Active hours in late-night hours, central gap. */
  lateNightHours: number;
  /** Longest stretch on any one day of the week, in minutes. */
  longestStretchMinutes: number;
  /** Days of the week up to today with under REST_DAY_MINUTES of central active time (days with no row count). */
  restDays: number;
  /** Days of the week up to today: 7 for past weeks, fewer for the current one. */
  daysCounted: number;
  /** Share (0..1) of the week's central active time that fell on Saturday or Sunday. */
  weekendShare: number;
  /** Latest local hour with active time in the week, or null if none. */
  latestHour: number | null;
}

/** A day with less central active time than this counts as a day off (shown as "days off"; the JSON key stays restDays). */
export const REST_DAY_MINUTES = 15;

const DAY_MS = 86_400_000;
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(ms(date) + n * DAY_MS);
const hundredth = (n: number) => Math.round(n * 100) / 100;
const hours = (r: PaceRange): PaceRange => ({ low: hundredth(r.low / 60), central: hundredth(r.central / 60), high: hundredth(r.high / 60) });
const isWeekend = (date: string) => [0, 6].includes(new Date(ms(date)).getUTCDay());

/** The last `weeks` Monday weeks up to `today` (a local YYYY-MM-DD), newest first. Days after today are ignored. */
export function paceWeeks(days: readonly PaceDay[], today: string, weeks = 4): PaceWeek[] {
  const current = weekStart(today);
  const out: PaceWeek[] = [];
  for (let k = 0; k < weeks; k++) {
    const start = addDays(current, -7 * k);
    const end = addDays(start, 6) < today ? addDays(start, 6) : today;
    const inWeek = days.filter((d) => d.date >= start && d.date <= end);
    const active = { low: 0, central: 0, high: 0 };
    const agent = { low: 0, central: 0, high: 0 };
    let late = 0;
    let longest = 0;
    let weekend = 0;
    let latest: number | null = null;
    let worked = 0;
    for (const d of inWeek) {
      for (const level of ["low", "central", "high"] as const) {
        active[level] += d.activeMinutes[level];
        agent[level] += d.agentMinutes[level];
      }
      late += d.lateNightMinutes;
      longest = Math.max(longest, d.longestStretchMinutes);
      if (isWeekend(d.date)) weekend += d.activeMinutes.central;
      if (d.lastHour !== null) latest = Math.max(latest ?? 0, d.lastHour);
      if (d.activeMinutes.central >= REST_DAY_MINUTES) worked++;
    }
    const daysCounted = Math.round((ms(end) - ms(start)) / DAY_MS) + 1;
    out.push({
      start,
      activeHours: hours(active),
      agentHours: hours(agent),
      lateNightHours: hundredth(late / 60),
      longestStretchMinutes: longest,
      restDays: daysCounted - worked,
      daysCounted,
      weekendShare: active.central > 0 ? hundredth(weekend / active.central) : 0,
      latestHour: latest,
    });
  }
  return out;
}

/**
 * Whether this week ran later or longer than the person's own usual: more than 1.25x the average
 * of their prior weeks with any active time (and, for later, more than an hour past the late-night
 * start). Null with fewer than two such weeks: there is no usual yet.
 */
export function paceVersusUsual(thisWeek: PaceWeek, priorWeeks: readonly PaceWeek[]): { later: boolean; longer: boolean } | null {
  const usual = priorWeeks.filter((w) => w.activeHours.central > 0);
  if (usual.length < 2) return null;
  const mean = (f: (w: PaceWeek) => number) => usual.reduce((s, w) => s + f(w), 0) / usual.length;
  return {
    later: thisWeek.lateNightHours > 1 && thisWeek.lateNightHours > 1.25 * mean((w) => w.lateNightHours),
    longer: thisWeek.activeHours.central > 1.25 * mean((w) => w.activeHours.central),
  };
}

/** Deterministic 0..1 values from a date, so a date's sample day never changes. */
function random(date: string): () => number {
  // mulberry32, seeded with the day number.
  let s = ms(date) / DAY_MS;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic pace for a plausible developer: five weeks ending on `endDate`, weekday blocks of
 * about six hours, a late night most weeks (two early in the last week), a short Saturday every
 * other week, Sundays off, and agents running on their own. Whole minutes only. For demos.
 */
export function samplePaceDays(endDate: string): PaceDay[] {
  const first = addDays(weekStart(endDate), -28);
  const lastWeek = weekStart(endDate);
  const days: PaceDay[] = [];
  for (let date = first; date <= endDate; date = addDays(date, 1)) {
    const rand = random(date);
    const dow = new Date(ms(date)).getUTCDay();
    const week = Math.round((ms(weekStart(date)) - ms(first)) / (7 * DAY_MS));
    if (dow === 0) continue; // Sundays off
    if (dow === 6 && week % 2 === 1) continue; // every other Saturday off
    const saturday = dow === 6;
    // One late night a week on Wednesday; the last week has two, on Monday and Tuesday.
    const late = date >= lastWeek ? dow === 1 || dow === 2 : dow === 3;
    const central = saturday ? 60 + Math.round(rand() * 40) : 300 + Math.round(rand() * 120) + (late ? 60 : 0);
    const spread = saturday ? 10 : 25 + Math.round(rand() * 20);
    const agent = saturday ? 0 : 20 + Math.round(rand() * 60);
    const firstHour = saturday ? 10 : 9 + Math.round(rand());
    days.push({
      date,
      activeMinutes: { low: central - spread, central, high: central + spread },
      agentMinutes: { low: Math.round(agent * 0.8), central: agent, high: Math.round(agent * 1.25) },
      lateNightMinutes: !late ? 0 : date >= lastWeek ? 105 + Math.round(rand() * 30) : 45 + Math.round(rand() * 30),
      longestStretchMinutes: saturday ? central - 15 : 70 + Math.round(rand() * 110),
      firstHour,
      lastHour: late ? 23 : saturday ? 12 : 17 + Math.round(rand() * 2),
    });
  }
  return days;
}
