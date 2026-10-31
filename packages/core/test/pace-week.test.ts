import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { defaultPaceOptions, paceMethod, parsePaceHistory, serializePaceHistory, type PaceDay } from "../src/index.js";

// CCW-M4.4 Pace weeks (core). Synthetic PaceDay rows built in code: counts only, no real logs.
// Reached through the index so the tests also prove the new functions are exported from it.

interface Range {
  low: number;
  central: number;
  high: number;
}
interface PaceWeek {
  start: string;
  activeHours: Range;
  agentHours: Range;
  lateNightHours: number;
  longestStretchMinutes: number;
  restDays: number;
  daysCounted: number;
  weekendShare: number;
  latestHour: number | null;
}
type Versus = { later: boolean; longer: boolean } | null | undefined;
const api = core as unknown as {
  paceWeeks: (days: readonly PaceDay[], today: string, weeks?: number) => PaceWeek[];
  paceVersusUsual: (thisWeek: PaceWeek, priorWeeks: readonly PaceWeek[]) => Versus;
  samplePaceDays: (endDate: string) => PaceDay[];
};

const r = (low: number, central: number, high: number): Range => ({ low, central, high });

/** One synthetic day; active minutes as [low, central, high]. */
function day(date: string, active: [number, number, number], extra: Partial<PaceDay> = {}): PaceDay {
  return {
    date,
    activeMinutes: r(...active),
    agentMinutes: r(0, 0, 0),
    lateNightMinutes: 0,
    longestStretchMinutes: Math.min(active[1], 60),
    firstHour: 9,
    lastHour: 17,
    ...extra,
  };
}

// Today is Thursday 2026-10-29; its week starts Monday 2026-10-26.
const TODAY = "2026-10-29";
const DAYS: PaceDay[] = [
  day("2026-09-28", [600, 600, 600]), // older than 4 weeks: left out
  day("2026-10-06", [120, 120, 120]),
  day("2026-10-19", [180, 180, 180], { lastHour: 20 }),
  day("2026-10-24", [60, 60, 60], { lastHour: 21 }), // Saturday
  day("2026-10-26", [120, 180, 240], { agentMinutes: r(30, 40, 60), lateNightMinutes: 30, longestStretchMinutes: 90, lastHour: 23 }),
  day("2026-10-27", [10, 12, 14]), // under 15 central minutes: a rest day
  // 2026-10-28 has no row: a rest day
  day("2026-10-29", [60, 60, 60], { lastHour: 11 }),
];

function week(start: string, active: number, late: number, extra: Partial<PaceWeek> = {}): PaceWeek {
  return {
    start,
    activeHours: r(active * 0.8, active, active * 1.2),
    agentHours: r(0, 0, 0),
    lateNightHours: late,
    longestStretchMinutes: 60,
    restDays: 2,
    daysCounted: 7,
    weekendShare: 0,
    latestHour: 20,
    ...extra,
  };
}

describe("CCW-M4.4 paceWeeks (PACE-W1)", () => {
  it("PACE-W1 groups days into Monday weeks, newest first, four by default", () => {
    const weeks = api.paceWeeks(DAYS, TODAY);
    expect(weeks.map((w) => w.start)).toEqual(["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"]);
    expect(api.paceWeeks(DAYS, TODAY, 2).map((w) => w.start)).toEqual(["2026-10-26", "2026-10-19"]);
  });

  it("PACE-W1 sums active and agent time as separate ranges in hours", () => {
    const [w] = api.paceWeeks(DAYS, TODAY);
    expect(w!.activeHours.low).toBeCloseTo(190 / 60, 1);
    expect(w!.activeHours.central).toBeCloseTo(252 / 60, 1);
    expect(w!.activeHours.high).toBeCloseTo(314 / 60, 1);
    expect(w!.agentHours.low).toBeCloseTo(0.5, 1);
    expect(w!.agentHours.central).toBeCloseTo(40 / 60, 1);
    expect(w!.agentHours.high).toBeCloseTo(1, 1);
    expect(w!.lateNightHours).toBeCloseTo(0.5, 1);
    expect(w!.longestStretchMinutes).toBe(90);
    expect(w!.latestHour).toBe(23);
  });

  it("PACE-W1 rest days count days up to today with under 15 active minutes, missing days included", () => {
    const [thisWeek, last, empty] = api.paceWeeks(DAYS, TODAY);
    expect(thisWeek!.daysCounted).toBe(4); // Mon to Thu: Fri-Sun haven't happened
    expect(thisWeek!.restDays).toBe(2); // Tue (12 min) and Wed (no row)
    expect(last!.daysCounted).toBe(7);
    expect(last!.restDays).toBe(5);
    expect(empty!.restDays).toBe(7);
  });

  it("PACE-W1 weekendShare is the weekend part of central active time; empty weeks are zero with no latest hour", () => {
    const [thisWeek, last, empty] = api.paceWeeks(DAYS, TODAY);
    expect(thisWeek!.weekendShare).toBe(0);
    expect(last!.weekendShare).toBeCloseTo(0.25, 2);
    expect(last!.latestHour).toBe(21);
    expect(empty!.activeHours).toEqual(r(0, 0, 0));
    expect(empty!.agentHours).toEqual(r(0, 0, 0));
    expect(empty!.weekendShare).toBe(0);
    expect(empty!.latestHour).toBeNull();
  });

  it("PACE-W1 days after today are ignored", () => {
    const withFuture = [...DAYS, day("2026-10-31", [600, 600, 600], { lastHour: 22 })];
    expect(api.paceWeeks(withFuture, TODAY)[0]).toEqual(api.paceWeeks(DAYS, TODAY)[0]);
  });
});

describe("CCW-M4.4 paceVersusUsual (PACE-W2)", () => {
  const prior = [week("2026-10-19", 20, 2), week("2026-10-12", 20, 2)];

  it("PACE-W2 flags later and longer against the user's own prior weeks", () => {
    expect(api.paceVersusUsual(week("2026-10-26", 30, 4), prior)).toEqual({ later: true, longer: true });
  });

  it("PACE-W2 a usual week is neither later nor longer", () => {
    expect(api.paceVersusUsual(week("2026-10-26", 21, 2.2), prior)).toEqual({ later: false, longer: false });
  });

  it("PACE-W2 later needs more than an hour past 10pm, not just a big ratio", () => {
    const quiet = [week("2026-10-19", 20, 0.2), week("2026-10-12", 20, 0.2)];
    expect(api.paceVersusUsual(week("2026-10-26", 20, 0.9), quiet)?.later).toBe(false);
    expect(api.paceVersusUsual(week("2026-10-26", 20, 1.1), quiet)?.later).toBe(true);
  });

  it("PACE-W2 no comparison with fewer than two prior weeks that have data", () => {
    const none = (v: Versus) => !v?.later && !v?.longer;
    expect(none(api.paceVersusUsual(week("2026-10-26", 60, 9), [week("2026-10-19", 10, 0)]))).toBe(true);
    expect(none(api.paceVersusUsual(week("2026-10-26", 60, 9), [week("2026-10-19", 10, 0), week("2026-10-12", 0, 0)]))).toBe(true);
    expect(none(api.paceVersusUsual(week("2026-10-26", 60, 9), []))).toBe(true);
  });
});

describe("CCW-M4.4 samplePaceDays (PACE-W3)", () => {
  const END = "2026-10-29";
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

  it("PACE-W3 is deterministic", () => {
    expect(api.samplePaceDays(END)).toEqual(api.samplePaceDays(END));
  });

  it("PACE-W3 covers about five weeks ending on the end date, sorted", () => {
    const days = api.samplePaceDays(END);
    const dates = days.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[dates.length - 1]! <= END).toBe(true);
    const span = (ms(END) - ms(dates[0]!)) / 86_400_000;
    expect(span).toBeGreaterThanOrEqual(28);
    expect(span).toBeLessThan(42);
    expect(api.paceWeeks(days, END, 5).every((w) => w.activeHours.central > 0)).toBe(true);
  });

  it("PACE-W3 looks like a plausible dev: late nights, a rest day, a weekend day, agent time", () => {
    const days = api.samplePaceDays(END);
    expect(days.filter((d) => d.lateNightMinutes > 0).length).toBeGreaterThanOrEqual(2);
    expect(days.some((d) => d.agentMinutes.central > 0)).toBe(true);
    expect(days.some((d) => [0, 6].includes(new Date(ms(d.date)).getUTCDay()) && d.activeMinutes.central >= 15)).toBe(true);
    expect(api.paceWeeks(days, END, 5).some((w) => w.restDays > 0)).toBe(true);
  });

  it("PACE-W3 every row survives the pace.jsonl round trip unchanged", () => {
    const days = api.samplePaceDays(END);
    const text = serializePaceHistory(days, paceMethod(defaultPaceOptions("UTC")));
    expect(parsePaceHistory(text).days).toEqual(days);
  });
});
