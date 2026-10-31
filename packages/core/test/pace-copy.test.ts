import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { defaultParams, paceNotes, paceWeeks, samplePaceDays, type PaceWeek } from "../src/index.js";

// CCW-M4.5 review fixes to the shared pace words (pace-copy.ts), used by `ccwatts pace` and the page.
// UX-R40/R41/R45: the lead names its week; with 3 days or fewer this week, it describes the last
// full week and this week moves to a quieter "so far" line. UX-R42: the footnote wording.

type Lead = { focus: number; lead: string; rest: string; soFar: string | null; agents: string | null };
const api = core as unknown as { paceLead?: (weeks: readonly PaceWeek[], params: typeof defaultParams) => Lead };
const paceLead = (weeks: readonly PaceWeek[]) => {
  expect(api.paceLead, "paceLead is not exported from core").toBeTypeOf("function");
  return api.paceLead!(weeks, defaultParams);
};

const w = (start: string, central: number, daysCounted: number, extra: Partial<PaceWeek> = {}): PaceWeek => ({
  start,
  activeHours: { low: central - 3, central, high: central + 3 },
  agentHours: { low: 3, central: 4, high: 5 },
  lateNightHours: 0.5,
  longestStretchMinutes: 150,
  restDays: daysCounted === 7 ? 2 : 0,
  daysCounted,
  weekendShare: 0,
  latestHour: 22,
  ...extra,
});

describe("CCW-M4.5 lead names its week (UX-R40, UX-R41, UX-R45)", () => {
  const prior = [w("2026-10-19", 30, 7), w("2026-10-12", 28, 7), w("2026-10-05", 26, 7)];

  it("UX-R40 with 2 days counted, the lead describes the last full week; this week is a quieter line", () => {
    const l = paceLead([w("2026-10-26", 13.04, 2, { agentHours: { low: 0, central: 0, high: 0 } }), ...prior]);
    expect(l.focus).toBe(1);
    expect(l.lead).toBe("Week of Oct 19: about 30 active hours (range 27 – 33)");
    expect(l.rest).toBe("30m past 10pm, longest stretch 2h 30m, active 5 of 7 days.");
    expect(l.soFar).toBe("This week so far: about 13 hours in 2 days.");
    // Agents line is for the week the lead describes (Oct 19 has agent time; this week has none).
    expect(l.agents).toBe("Agents worked another 3.0 – 5.0 hours on their own.");
  });

  it("UX-R40 with 3 days counted it still leads with the last full week", () => {
    const l = paceLead([w("2026-10-26", 6.4, 3), ...prior]);
    expect(l.focus).toBe(1);
    expect(l.lead.startsWith("Week of Oct 19: ")).toBe(true);
    expect(l.soFar).toBe("This week so far: about 6.4 hours in 3 days.");
  });

  it("UX-R40 one day in and nothing yet: says so plainly", () => {
    const l = paceLead([w("2026-10-26", 0, 1, { activeHours: { low: 0, central: 0, high: 0 } }), ...prior]);
    expect(l.soFar).toBe("This week so far: no active hours yet.");
  });

  it("UX-R40 with 4 or more days counted, the lead is this week so far, and there is no second line", () => {
    const l = paceLead([w("2026-10-26", 22, 4), ...prior]);
    expect(l.focus).toBe(0);
    expect(l.lead).toBe("This week so far: about 22 active hours (range 19 – 25)");
    expect(l.rest).toBe("30m past 10pm, longest stretch 2h 30m, active 4 of 4 days.");
    expect(l.soFar).toBeNull();
  });

  it("UX-R40 with 3 days but no earlier week with any time, the lead stays on this week", () => {
    const empty = w("2026-10-19", 0, 7, { activeHours: { low: 0, central: 0, high: 0 }, agentHours: { low: 0, central: 0, high: 0 } });
    const l = paceLead([w("2026-10-26", 6.4, 3), empty]);
    expect(l.focus).toBe(0);
    expect(l.lead.startsWith("This week so far: ")).toBe(true);
    expect(l.soFar).toBeNull();
  });

  it("UX-R41 every lead starts with its week label, on the sample for every day of the week", () => {
    for (const today of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]) {
      const l = paceLead(paceWeeks(samplePaceDays(today), today, 4));
      expect(l.lead, today).toMatch(/^(Week of [A-Z][a-z]{2} \d{1,2}|This week so far): about /);
    }
  });
});

describe("CCW-M4.5 footnote (UX-R42)", () => {
  it("UX-R42 says the longest stretch in words", () => {
    const notes = paceNotes(defaultParams);
    expect(notes).toContain("Past 10pm and the longest stretch use the 20-min gap.");
    expect(notes.join("\n")).not.toMatch(/and Longest use/);
  });
});
