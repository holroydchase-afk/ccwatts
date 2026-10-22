import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYGROUND_URL } from "@ccwatts/core";

const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");

describe("README tells the same story as the playground (recruiter-ready RR-7, RR-14)", () => {
  it("links the live playground near the top", () => {
    expect(readme.split("\n").slice(0, 10).join("\n")).toContain(PLAYGROUND_URL);
  });

  it("never claims npx works before the package is published", () => {
    for (const line of readme.split("\n").filter((l) => l.includes("npx ccwatts"))) {
      expect(line).toMatch(/once .*npm/);
    }
  });

  it("shows the playground on sample data, not a dashboard that reads as real history", () => {
    expect(readme).not.toContain("docs/images/dashboard.png");
    expect(readme).toContain("docs/images/playground-laptop.png");
  });
});
