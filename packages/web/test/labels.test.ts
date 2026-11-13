import { describe, expect, it } from "vitest";
import { windowLabel } from "../src/labels.js";

// DEMO-DATES (stable-demo plan, Nov 13): the sample data is a fixed month, so "last 30 days" over
// Sep–Oct dates reads as stale. Sample windows say "sample"; real data keeps "last N days".
describe("window labels", () => {
  it("names sample windows without implying they end today", () => {
    expect(windowLabel("30d", "sample")).toBe("a sample month");
    expect(windowLabel("7d", "sample")).toBe("a sample week");
    expect(windowLabel("all", "sample")).toBe("all sample data");
    for (const w of ["7d", "30d", "all"] as const) expect(windowLabel(w, "sample")).not.toMatch(/last/);
  });

  it("keeps last N days for your own history and files", () => {
    for (const s of ["history", "files"] as const) {
      expect(windowLabel("30d", s)).toBe("last 30 days");
      expect(windowLabel("7d", s)).toBe("last 7 days");
      expect(windowLabel("all", s)).toBe("all time");
    }
  });
});
