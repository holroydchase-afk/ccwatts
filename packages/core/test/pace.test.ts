import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { defaultPaceOptions, paceDays, type ActivityEvent, type PaceDay, type PaceOptions } from "../src/index.js";
import { paceBlocks } from "../src/pace.js";

// CCW-M4.2 Pace core. Synthetic ActivityEvent arrays built in code: no real prompts or timestamps.

const H = true; // human turn
const M = false; // machine line (assistant, tool result, notification)

/** Events on one UTC day: [HH:MM, human] pairs. */
const at = (date: string, ...pts: [string, boolean][]): ActivityEvent[] =>
  pts.map(([hm, human]) => ({ timestamp: `${date}T${hm}:00.000Z`, human }));

/** One event every `step` minutes from `start` (inclusive) to `end` (inclusive), first one human. */
function run(startIso: string, endIso: string, step: number, firstHuman = true): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (let t = Date.parse(startIso), i = 0; t <= Date.parse(endIso); t += step * 60_000, i++) {
    out.push({ timestamp: new Date(t).toISOString(), human: firstHuman && i === 0 });
  }
  return out;
}

const opts = (timeZone: string, over: Partial<PaceOptions> = {}): PaceOptions => ({
  timeZone,
  gapMinutes: { low: 10, central: 20, high: 30 },
  breakMinutes: 15,
  lateNight: { startHour: 22, endHour: 6 },
  ...over,
});

const minutes = (b: { start: string; end: string }) => (Date.parse(b.end) - Date.parse(b.start)) / 60_000;
const day = (days: PaceDay[], date: string) => {
  const d = days.find((x) => x.date === date);
  expect(d, `no PaceDay for ${date}`).toBeDefined();
  return d!;
};

describe("CCW-M4.2 paceBlocks", () => {
  it("PACE-1 two human blocks split by a 45 min gap are 2 blocks; active minutes is an ordered range", () => {
    const events = at("2026-01-15", ["09:00", H], ["09:05", M], ["09:10", M], ["09:55", H], ["10:05", M]);
    const blocks = paceBlocks(events, 20);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.human)).toEqual([true, true]);
    expect(blocks.map(minutes)).toEqual([10, 10]);
    expect(blocks[0]!.start).toBe("2026-01-15T09:00:00.000Z");
    expect(blocks[1]!.end).toBe("2026-01-15T10:05:00.000Z");

    const [d] = paceDays(events, opts("UTC"));
    expect(d!.activeMinutes.central).toBeCloseTo(20, 1);
    expect(d!.activeMinutes.low).toBeLessThanOrEqual(d!.activeMinutes.central);
    expect(d!.activeMinutes.central).toBeLessThanOrEqual(d!.activeMinutes.high);
  });

  it("PACE-1b splits only on a gap strictly over the threshold, and sorts unsorted input", () => {
    const events = at("2026-01-15", ["10:20", M], ["10:00", H]); // exactly 20 min apart, out of order
    expect(paceBlocks(events, 20)).toEqual([{ start: "2026-01-15T10:00:00.000Z", end: "2026-01-15T10:20:00.000Z", human: true }]);
    expect(paceBlocks(events, 19)).toHaveLength(2);
    expect(paceBlocks([], 20)).toEqual([]);
  });

  it("PACE-1c splits on any gap whatever line follows; a block is human only if it holds a human event", () => {
    // The 10:40 machine line after a 30 min gap starts a new, machine-only block.
    const events = at("2026-01-15", ["10:00", H], ["10:10", M], ["10:40", M], ["10:50", M]);
    const blocks = paceBlocks(events, 20);
    expect(blocks.map((b) => [minutes(b), b.human])).toEqual([
      [10, true],
      [10, false],
    ]);
  });

  it("PACE-R a 15 min pause splits at gap 10 but not at 20 or 30, so low < central = high", () => {
    const events = at("2026-01-15", ["10:00", H], ["10:10", M], ["10:25", H], ["10:35", M]);
    const [d] = paceDays(events, opts("UTC"));
    expect(d!.activeMinutes.low).toBeCloseTo(20, 1);
    expect(d!.activeMinutes.central).toBeCloseTo(35, 1);
    expect(d!.activeMinutes.high).toBeCloseTo(35, 1);
  });
});

describe("CCW-M4.2 paceDays: local days", () => {
  it("PACE-2a a block 23:30-00:45 local lands 30 min on day 1 and 45 min on day 2", () => {
    const events = run("2026-01-15T23:30:00.000Z", "2026-01-16T00:45:00.000Z", 5);
    const days = paceDays(events, opts("UTC"));
    expect(days.map((d) => d.date)).toEqual(["2026-01-15", "2026-01-16"]);
    expect(day(days, "2026-01-15").activeMinutes.central).toBeCloseTo(30, 1);
    expect(day(days, "2026-01-16").activeMinutes.central).toBeCloseTo(45, 1);
  });

  it("PACE-2a2 the same instants split by the caller's zone, not UTC", () => {
    // 2026-01-16 04:30Z-05:45Z is 23:30-00:45 in New York (EST, UTC-5).
    const events = run("2026-01-16T04:30:00.000Z", "2026-01-16T05:45:00.000Z", 5);
    const days = paceDays(events, opts("America/New_York"));
    expect(day(days, "2026-01-15").activeMinutes.central).toBeCloseTo(30, 1);
    expect(day(days, "2026-01-16").activeMinutes.central).toBeCloseTo(45, 1);
    expect(paceDays(events, opts("UTC")).map((d) => d.date)).toEqual(["2026-01-16"]);
  });

  it("PACE-2b DST spring: 01:30 -> 03:30 local on 2026-03-08 in New York is 60 real minutes", () => {
    // 01:30 EST = 06:30Z; 03:30 EDT = 07:30Z.
    const events = run("2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z", 10);
    const days = paceDays(events, opts("America/New_York"));
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-03-08");
    expect(days[0]!.activeMinutes.central).toBeCloseTo(60, 1);
    expect(days[0]!.firstHour).toBe(1);
    expect(days[0]!.lastHour).toBe(3);
  });

  it("PACE-2c DST fall: 01:00 EDT -> 01:00 EST on 2026-11-01 in New York is 60 real minutes", () => {
    // 01:00 EDT = 05:00Z; 01:00 EST = 06:00Z.
    const events = run("2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", 10);
    const days = paceDays(events, opts("America/New_York"));
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-11-01");
    expect(days[0]!.activeMinutes.central).toBeCloseTo(60, 1);
    expect(days[0]!.lateNightMinutes).toBeCloseTo(60, 1);
  });

  it("PACE-2d a block across the fall-back night's midnight still splits at local midnight", () => {
    // 2026-10-31 23:30 EDT = 2026-11-01 03:30Z; 2026-11-01 00:30 EDT = 04:30Z.
    const events = run("2026-11-01T03:30:00.000Z", "2026-11-01T04:30:00.000Z", 10);
    const days = paceDays(events, opts("America/New_York"));
    expect(day(days, "2026-10-31").activeMinutes.central).toBeCloseTo(30, 1);
    expect(day(days, "2026-11-01").activeMinutes.central).toBeCloseTo(30, 1);
  });

  it("PACE-EMPTY no events, or a lone event (a 0-minute block), give no days", () => {
    expect(paceDays([], opts("UTC"))).toEqual([]);
    expect(paceDays(at("2026-01-15", ["10:00", H]), opts("UTC"))).toEqual([]);
  });

  it("PACE-SORT days come back sorted by date", () => {
    const events = [...run("2026-01-17T10:00:00.000Z", "2026-01-17T10:30:00.000Z", 10), ...run("2026-01-15T10:00:00.000Z", "2026-01-15T10:30:00.000Z", 10)];
    expect(paceDays(events, opts("UTC")).map((d) => d.date)).toEqual(["2026-01-15", "2026-01-17"]);
  });
});

describe("CCW-M4.2 paceDays: agent time, late night, stretches", () => {
  it("PACE-AG a machine-only block is agent time: zero active, no hours, no late night", () => {
    const events = run("2026-01-15T02:00:00.000Z", "2026-01-15T02:40:00.000Z", 10, false);
    const days = paceDays(events, opts("UTC"));
    expect(days).toHaveLength(1);
    const d = days[0]!;
    expect(d.agentMinutes.central).toBeCloseTo(40, 1);
    expect(d.agentMinutes.low).toBeLessThanOrEqual(d.agentMinutes.central);
    expect(d.agentMinutes.central).toBeLessThanOrEqual(d.agentMinutes.high);
    expect(d.activeMinutes).toEqual({ low: 0, central: 0, high: 0 });
    expect(d.lateNightMinutes).toBe(0);
    expect(d.longestStretchMinutes).toBe(0);
    expect(d.firstHour).toBeNull();
    expect(d.lastHour).toBeNull();
  });

  it("PACE-AG2 human and agent blocks on one day are reported separately", () => {
    const events = [
      ...run("2026-01-15T09:00:00.000Z", "2026-01-15T09:30:00.000Z", 10, true),
      ...run("2026-01-15T03:00:00.000Z", "2026-01-15T03:20:00.000Z", 10, false),
    ];
    const [d] = paceDays(events, opts("UTC"));
    expect(d!.activeMinutes.central).toBeCloseTo(30, 1);
    expect(d!.agentMinutes.central).toBeCloseTo(20, 1);
    expect(d!.firstHour).toBe(9);
    expect(d!.lateNightMinutes).toBe(0);
  });

  it("PACE-LN late-night minutes count human time 22:00-06:00 local; first/last hour are whole local hours", () => {
    const events = [
      ...run("2026-01-15T05:30:00.000Z", "2026-01-15T06:30:00.000Z", 10),
      ...run("2026-01-15T21:30:00.000Z", "2026-01-15T22:30:00.000Z", 10),
    ];
    const [d] = paceDays(events, opts("UTC"));
    expect(d!.activeMinutes.central).toBeCloseTo(120, 1);
    expect(d!.lateNightMinutes).toBeCloseTo(60, 1);
    expect(d!.firstHour).toBe(5);
    expect(d!.lastHour).toBe(22);
  });

  it("PACE-ST the longest stretch ends at any pause of at least breakMinutes, inside one block", () => {
    // One block at gap 20 (08:15-09:40); the 15 min pause 08:35-08:50 ends a stretch.
    const events = at(
      "2026-01-15",
      ["08:15", H], ["08:25", M], ["08:35", M],
      ["08:50", M], ["09:00", M], ["09:10", M], ["09:20", M], ["09:30", M], ["09:40", M],
    );
    expect(paceBlocks(events, 20)).toHaveLength(1);
    const [d] = paceDays(events, opts("UTC"));
    expect(d!.activeMinutes.central).toBeCloseTo(85, 1);
    expect(d!.longestStretchMinutes).toBeCloseTo(50, 1);
    expect(d!.firstHour).toBe(8);
    expect(d!.lastHour).toBe(9);
  });
});

describe("CCW-M4.2 pace privacy", () => {
  it("PACE-PRIV2 paceDays output holds no input timestamps and no zone name", () => {
    const events = [
      ...run("2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z", 10),
      ...run("2026-03-09T13:05:00.000Z", "2026-03-09T13:45:00.000Z", 5, false),
    ];
    const json = JSON.stringify(paceDays(events, opts("America/New_York")));
    for (const e of events) expect(json).not.toContain(e.timestamp);
    expect(json).not.toMatch(/T\d{2}:\d{2}/);
    expect(json).not.toContain("America");
    expect(json).not.toContain("New_York");
  });

  it("PACE-PRIV3 pace.ts never reads the clock, the system zone or does I/O", () => {
    const src = readFileSync(new URL("../src/pace.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\.now/);
    expect(src).not.toMatch(/new Date\(\s*\)/);
    expect(src).not.toMatch(/resolvedOptions/);
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/\bprocess\./);
    expect(src).not.toMatch(/ccwatts/i);
  });
});

describe("CCW-M4.2 params.json pace section", () => {
  const data = JSON.parse(readFileSync(new URL("../../../methodology/params.json", import.meta.url), "utf8"));

  it("PACE-PARAM gap and break thresholds are sourced GUESSes with low <= value <= high, outside energy params", () => {
    const pace = data.pace;
    expect(pace, "params.json has a top-level pace section").toBeDefined();
    expect(data.params.pace).toBeUndefined();
    expect(data.params.gap_minutes).toBeUndefined();
    for (const key of ["gap_minutes", "break_minutes"]) {
      const p = pace[key];
      expect(p, key).toBeDefined();
      expect(p.label).toBe("GUESS");
      expect(p.low).toBeLessThanOrEqual(p.value);
      expect(p.value).toBeLessThanOrEqual(p.high);
      expect(p.unit).toBe("minutes");
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof p.note).toBe("string");
    }
    expect([pace.gap_minutes.low, pace.gap_minutes.value, pace.gap_minutes.high]).toEqual([10, 20, 30]);
    expect(pace.break_minutes.value).toBe(15);
    expect(pace.late_night).toEqual({ start_hour: 22, end_hour: 6 });
  });

  it("PACE-PARAM2 defaultPaceOptions reads its thresholds from params.json", () => {
    const o = defaultPaceOptions("Europe/London");
    expect(o.timeZone).toBe("Europe/London");
    expect(o.gapMinutes).toEqual({ low: data.pace.gap_minutes.low, central: data.pace.gap_minutes.value, high: data.pace.gap_minutes.high });
    expect(o.breakMinutes).toBe(data.pace.break_minutes.value);
    expect(o.lateNight).toEqual({ startHour: data.pace.late_night.start_hour, endHour: data.pace.late_night.end_hour });
  });
});

describe("CCW-M4.2 privacy guards (PS-R5, PS-R6)", () => {
  it("PACE-PRIV4: the public index does not export paceBlocks, which returns exact block times", () => {
    expect("paceBlocks" in core).toBe(false);
  });

  it("PACE-PRIV5: paceDays refuses a missing or empty time zone instead of falling back to the system zone", () => {
    const events: ActivityEvent[] = [{ timestamp: "2026-01-15T10:00:00.000Z", human: true }, { timestamp: "2026-01-15T10:30:00.000Z", human: true }];
    for (const timeZone of ["", undefined as unknown as string]) {
      expect(() => paceDays(events, { ...defaultPaceOptions("UTC"), timeZone })).toThrow(/time zone/i);
    }
  });
});
