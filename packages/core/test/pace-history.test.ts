import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mergePaceHistory,
  PACE_SCHEMA,
  paceDays,
  paceMethod,
  parsePaceHistory,
  serializePaceHistory,
  type ActivityEvent,
  type PaceDay,
  type PaceMethod,
  type PaceOptions,
} from "../src/index.js";

// CCW-M4.3 Pace history (pace.jsonl). Synthetic ActivityEvent arrays and PaceDay rows built in
// code: no real prompts, times or zones.

const opts = (timeZone: string): PaceOptions => ({
  timeZone,
  gapMinutes: { low: 10, central: 20, high: 30 },
  breakMinutes: 15,
  lateNight: { startHour: 22, endHour: 6 },
});

/** One event every `step` minutes from start to end (inclusive), first one human unless told not. */
function run(startIso: string, endIso: string, step: number, firstHuman = true): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (let t = Date.parse(startIso), i = 0; t <= Date.parse(endIso); t += step * 60_000, i++) {
    out.push({ timestamp: new Date(t).toISOString(), human: firstHuman && i === 0 });
  }
  return out;
}

const r = (low: number, central: number, high: number) => ({ low, central, high });

const pday = (date: string, active: number, agent = 0, over: Partial<PaceDay> = {}): PaceDay => ({
  date,
  activeMinutes: r(active, active, active),
  agentMinutes: r(agent, agent, agent),
  lateNightMinutes: 0,
  longestStretchMinutes: active,
  firstHour: active > 0 ? 9 : null,
  lastHour: active > 0 ? 10 : null,
  ...over,
});

const DAY_KEYS = ["activeMinutes", "agentMinutes", "date", "firstHour", "lastHour", "lateNightMinutes", "longestStretchMinutes"];
const METHOD_KEYS = ["breakMinutes", "gapMinutes", "lateNight"];

/** Events that cross local midnight and both New York DST changes, plus an agent-only day. */
const nyEvents: ActivityEvent[] = [
  // 23:30-00:45 local on Jan 15/16 (EST, UTC-5).
  ...run("2026-01-16T04:30:00.000Z", "2026-01-16T05:45:00.000Z", 5),
  // DST spring 2026-03-08: 01:30 EST -> 03:30 EDT.
  ...run("2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z", 10),
  // DST fall 2026-11-01: 01:00 EDT -> 01:00 EST.
  ...run("2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", 10),
  // Agents alone on 2026-11-03, odd 7 min steps so minutes are not whole.
  ...run("2026-11-03T15:00:00.000Z", "2026-11-03T15:49:00.000Z", 7, false),
];
const nyOpts = opts("America/New_York");
const nyDays = paceDays(nyEvents, nyOpts);

const lines = (text: string) => text.split("\n").filter((l) => l.trim() !== "");

describe("CCW-M4.3 pace history: what is stored", () => {
  it("PACE-3a (PS-R7) rows hold exactly the PaceDay keys; extra fields on a day or the method are dropped", () => {
    const leaky = {
      ...pday("2026-10-01", 30, 5),
      timeZone: "Europe/London",
      start: "2026-10-01T09:00:00.000Z",
      blocks: [{ start: "2026-10-01T09:00:00.000Z", end: "2026-10-01T09:30:00.000Z", human: true }],
      prompt: "SECRET-PROMPT-TEXT",
    } as PaceDay;
    const method = { ...paceMethod(opts("Europe/London")), timeZone: "Europe/London" } as PaceMethod;
    const text = serializePaceHistory([leaky], method);

    const [header, ...rows] = lines(text).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(Object.keys(header!).sort()).toEqual(["kind", "method", "schema"]);
    expect(Object.keys(header!.method as object).sort()).toEqual(METHOD_KEYS);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(DAY_KEYS);
    for (const leak of ["Europe", "London", "SECRET", "blocks", "\"start\"", "T09:"]) expect(text).not.toContain(leak);
  });

  it("PACE-3a paceMethod keeps the thresholds and never the zone", () => {
    const m = paceMethod(opts("Asia/Kolkata"));
    expect(Object.keys(m).sort()).toEqual(METHOD_KEYS);
    expect(m).toEqual({ gapMinutes: { low: 10, central: 20, high: 30 }, breakMinutes: 15, lateNight: { startHour: 22, endHour: 6 } });
    expect(JSON.stringify(m)).not.toContain("Kolkata");
  });

  it("PACE-3a header is schema 1, kind daily-pace", () => {
    expect(PACE_SCHEMA).toBe(1);
    const [header] = lines(serializePaceHistory([], paceMethod(nyOpts)));
    expect(JSON.parse(header!)).toEqual({ schema: 1, kind: "daily-pace", method: paceMethod(nyOpts) });
  });

  it("PACE-3a (source check) the pace history code and the CLI store never touch events or blocks", () => {
    for (const rel of ["../src/pace-history.ts", "../../cli/src/store.ts"]) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src, rel).not.toMatch(/\bActivityEvent\b/);
      expect(src, rel).not.toMatch(/\bpaceBlocks\b/);
      expect(src, rel).not.toMatch(/\bPaceBlock\b/);
    }
  });

  it("PACE-3b DST and overnight days serialize with no times, offsets or zone; whole hours; minutes to 0.1", () => {
    expect(nyDays.map((d) => d.date)).toEqual(["2026-01-15", "2026-01-16", "2026-03-08", "2026-11-01", "2026-11-03"]);
    const text = serializePaceHistory(nyDays, paceMethod(nyOpts));
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d/);
    expect(text).not.toMatch(/[+-]\d{2}:?\d{2}\b/);
    expect(text).not.toMatch(/\dZ\b/);
    expect(text).not.toMatch(/[A-Z][a-z]+\/[A-Z]/);
    expect(text).not.toContain("New_York");

    const rows = lines(text).slice(1).map((l) => JSON.parse(l) as PaceDay);
    expect(rows).toHaveLength(nyDays.length);
    for (const row of rows) {
      for (const h of [row.firstHour, row.lastHour]) {
        if (h !== null) {
          expect(Number.isInteger(h), `${row.date} hour ${h}`).toBe(true);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(23);
        }
      }
      const minutes = [
        ...Object.values(row.activeMinutes),
        ...Object.values(row.agentMinutes),
        row.lateNightMinutes,
        row.longestStretchMinutes,
      ];
      for (const m of minutes) expect(String(m), `${row.date}`).toMatch(/^\d+(\.\d)?$/);
    }
    // The agent-only day has no hours.
    const agentOnly = rows.find((d) => d.date === "2026-11-03")!;
    expect(agentOnly.firstHour).toBeNull();
    expect(agentOnly.lastHour).toBeNull();
  });

  it("PACE-3b minutes are rounded to 0.1 on write, even if a caller passes more digits", () => {
    const raw = pday("2026-10-02", 12.3456, 0.06, { lateNightMinutes: 1.04, longestStretchMinutes: 7.777 });
    const row = JSON.parse(lines(serializePaceHistory([raw], paceMethod(nyOpts)))[1]!) as PaceDay;
    expect(row.activeMinutes).toEqual({ low: 12.3, central: 12.3, high: 12.3 });
    expect(row.agentMinutes).toEqual({ low: 0.1, central: 0.1, high: 0.1 });
    expect(row.lateNightMinutes).toBe(1);
    expect(row.longestStretchMinutes).toBe(7.8);
  });
});

describe("CCW-M4.3 pace history: reading", () => {
  // Built inside each test, so a missing export fails the test rather than the whole file.
  const method = () => paceMethod(opts("UTC"));
  const header = () => JSON.stringify({ schema: 1, kind: "daily-pace", method: method() });
  const good = (date: string, over: Record<string, unknown> = {}) =>
    JSON.stringify({ ...pday(date, 20, 4), ...over });

  it("PACE-3c drops malformed rows and keeps the good ones", () => {
    const text = [
      header(),
      good("2026-10-01"),
      good("2026-10-02", { extra: 1 }), // unknown key
      good("2026-1-3"), // not YYYY-MM-DD
      good("not-a-date"),
      good("2026-10-04T00:00:00Z"),
      good("2026-10-05", { activeMinutes: r(-1, 5, 6) }), // negative
      good("2026-10-06", { lateNightMinutes: -0.5 }),
      '{"date":"2026-10-07","activeMinutes":{"low":1,"central":2,"high":1e999},"agentMinutes":{"low":0,"central":0,"high":0},"lateNightMinutes":0,"longestStretchMinutes":0,"firstHour":null,"lastHour":null}', // Infinity
      good("2026-10-08", { longestStretchMinutes: "12" }), // not a number
      good("2026-10-09", { agentMinutes: r(5, 3, 6) }), // low > central
      good("2026-10-10", { activeMinutes: r(1, 7, 6) }), // central > high
      good("2026-10-11", { firstHour: 24 }),
      good("2026-10-12", { lastHour: -1 }),
      good("2026-10-13", { firstHour: 3.5 }),
      good("2026-10-14", { lastHour: "10" }),
      '{"date":"2026-10-15",', // bad JSON
      "[]",
      "null",
      JSON.stringify({ date: "2026-10-16", activeMinutes: r(1, 1, 1) }), // missing keys
      good("2026-10-17", { firstHour: null, lastHour: null }), // null hours are fine
      "",
    ].join("\n");
    const parsed = parsePaceHistory(text);
    expect(parsed.method).toEqual(method());
    expect(parsed.days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-17"]);
  });

  it("PACE-3c empty text, or no header, gives no method", () => {
    expect(parsePaceHistory("")).toEqual({ method: null, days: [] });
    expect(parsePaceHistory(good("2026-10-01")).method).toBeNull();
    expect(parsePaceHistory("not json\n").days).toEqual([]);
  });

  it("PACE-3d round trip keeps days and method", () => {
    const m = paceMethod(nyOpts);
    expect(parsePaceHistory(serializePaceHistory(nyDays, m))).toEqual({ method: m, days: nyDays });
    const other = paceMethod({ ...nyOpts, gapMinutes: { low: 5, central: 15, high: 45 }, breakMinutes: 10, lateNight: { startHour: 23, endHour: 5 } });
    expect(parsePaceHistory(serializePaceHistory([], other))).toEqual({ method: other, days: [] });
  });
});

describe("CCW-M4.3 pace history: merging", () => {
  const dates = (days: PaceDay[]) => days.map((d) => d.date);

  it("PACE-3e keeps stored-only days, adds fresh-only days, sorted by date", () => {
    const stored = [pday("2026-10-01", 10), pday("2026-10-03", 30)];
    const fresh = [pday("2026-10-02", 20), pday("2026-10-04", 40)];
    const merged = mergePaceHistory(stored, fresh, true);
    expect(dates(merged)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });

  it("PACE-3e same method: the larger active + agent central wins a date; fresh wins ties", () => {
    const storedBig = pday("2026-10-01", 60, 0, { lateNightMinutes: 1 });
    const freshSmall = pday("2026-10-01", 30, 10, { lateNightMinutes: 2 }); // logs partly pruned
    expect(mergePaceHistory([storedBig], [freshSmall], true)).toEqual([storedBig]);

    // Active alone is smaller, but active + agent is larger: fresh wins.
    const storedActive = pday("2026-10-02", 50, 0);
    const freshSum = pday("2026-10-02", 40, 20);
    expect(mergePaceHistory([storedActive], [freshSum], true)).toEqual([freshSum]);

    const storedTie = pday("2026-10-03", 30, 10, { lateNightMinutes: 1 });
    const freshTie = pday("2026-10-03", 25, 15, { lateNightMinutes: 2 });
    expect(mergePaceHistory([storedTie], [freshTie], true)).toEqual([freshTie]);
  });

  it("PACE-3e different method: fresh wins every date it has, even when smaller", () => {
    const stored = [pday("2026-10-01", 60, 20), pday("2026-10-02", 45)];
    const fresh = [pday("2026-10-01", 10)];
    expect(mergePaceHistory(stored, fresh, false)).toEqual([fresh[0], stored[1]]);
  });

  it("PACE-3e reruns are stable and deleted logs lose nothing", () => {
    const fresh = paceDays(nyEvents, nyOpts);
    const once = mergePaceHistory([], fresh, true);
    expect(mergePaceHistory(once, fresh, true)).toEqual(once);
    expect(mergePaceHistory(once, [], true)).toEqual(once);
    expect(mergePaceHistory(once, [], false)).toEqual(once);
  });
});
