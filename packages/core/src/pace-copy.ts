import { int } from "./format.js";
import type { Params } from "./params.js";
import type { PaceRange } from "./pace.js";
import { REST_DAY_MINUTES, type PaceWeek } from "./pace-week.js";

/**
 * The words for Pace, shared by `ccwatts pace` and the web page so the two can't drift.
 * Plain strings: no color, no wrapping, no markup. Numbers, never a verdict.
 */

/** Hours for pace: whole hours from 10 up, one decimal below ("0.5", "6.4", "28"). */
export function paceHours(h: number): string {
  if (h === 0) return "0";
  return h >= 10 ? int(h) : (Math.round(h * 10) / 10).toFixed(1);
}

/** Minutes as "4h 10m", "45m" or "6h". */
export function hm(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 26" from a YYYY-MM-DD date, with no time zone involved. */
export const monthDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

/** "10pm" from a 0-23 hour. */
export const clockHour = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

/** "29 – 36" */
export const paceHoursRange = (r: PaceRange) => `${paceHours(r.low)} – ${paceHours(r.high)}`;

/** "about 33 active hours (range 29 – 36)": central first, then the range, like the main summary. */
export const paceActiveLead = (r: PaceRange) => `about ${paceHours(r.central)} active hours (range ${paceHoursRange(r)})`;

/** The week a pace lead describes, its words, and this week's quieter line when the lead is about last week. */
export interface PaceLead {
  /** Index into the weeks (newest first) of the week the lead describes: 0, or 1 early in a week. */
  focus: number;
  /** "Week of Oct 19: about 30 active hours (range 27 – 33)" or "This week so far: about 22 active hours (range 19 – 25)". */
  lead: string;
  /** "56m past 10pm, longest stretch 2h 33m, active 5 of 7 days." */
  rest: string;
  /** "This week so far: about 13 hours in 2 days." when the lead is about last week, else null. */
  soFar: string | null;
  /** The agents line for the week the lead describes, or null. */
  agents: string | null;
}

/** With this many days or fewer counted this week, the lead describes the last full week instead (UX-R40). */
export const PACE_EARLY_WEEK_DAYS = 3;

/**
 * Which week the lead describes (index into newest-first weeks): this week once it has 4 days,
 * and before that the last full week, unless that week has no time at all (nothing to describe).
 */
export function paceFocus(weeks: readonly PaceWeek[]): number {
  const [now, last] = weeks;
  if (!now || !last || now.daysCounted > PACE_EARLY_WEEK_DAYS) return 0;
  return last.activeHours.high > 0 || last.agentHours.high > 0 ? 1 : 0;
}

/**
 * The pace lead in words, shared by the CLI and the page. Every lead starts with its week label
 * (UX-R41); early in a week it describes the last full week and this week gets a quieter line.
 */
export function paceLead(weeks: readonly PaceWeek[], params: Params): PaceLead {
  const focus = paceFocus(weeks);
  const week = weeks[focus]!;
  const label = focus === 0 ? "This week so far" : `Week of ${monthDay(week.start)}`;
  const late = clockHour(params.pace.late_night.start_hour);
  const activeDays = week.daysCounted - week.restDays;
  const now = weeks[0]!;
  const days = `${now.daysCounted} day${now.daysCounted === 1 ? "" : "s"}`;
  return {
    focus,
    lead: `${label}: ${paceActiveLead(week.activeHours)}`,
    rest: `${hm(week.lateNightHours * 60)} past ${late}, longest stretch ${hm(week.longestStretchMinutes)}, active ${activeDays} of ${week.daysCounted} days.`,
    soFar:
      focus === 0
        ? null
        : now.activeHours.central > 0
          ? `This week so far: about ${paceHours(now.activeHours.central)} hours in ${days}.`
          : "This week so far: no active hours yet.",
    agents: paceAgentsLine(week),
  };
}

/** "Agents worked another 3.0 – 5.1 hours on their own.", or null when agents ran on their own for no time. */
export function paceAgentsLine(week: PaceWeek): string | null {
  return week.agentHours.high > 0 ? `Agents worked another ${paceHoursRange(week.agentHours)} hours on their own.` : null;
}

/** The method notes under every pace view: gaps from params, what a day off is, and that it is a heuristic. */
export function paceNotes(params: Params): string[] {
  const g = params.pace.gap_minutes;
  const late = clockHour(params.pace.late_night.start_hour);
  return [
    `Active time counts idle gaps under ${g.low}/${g.value}/${g.high} min (low/central/high) as work.`,
    `Past ${late} and the longest stretch use the ${g.value}-min gap.`,
    `A day off has under ${REST_DAY_MINUTES} active minutes. Agent-only: no turn from you.`,
    `Heuristic, not a measurement · method v${params.version}`,
  ];
}
