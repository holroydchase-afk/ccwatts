import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYGROUND_URL } from "@ccwatts/core";

const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");

describe("README tells the same story as the playground (recruiter-ready RR-7, RR-14)", () => {
  it("links the live playground near the top", () => {
    expect(readme.split("\n").slice(0, 10).join("\n")).toContain(PLAYGROUND_URL);
  });

  it("CCW-H6 leads with npx now that ccwatts is on npm, with no stale pre-publish wording", () => {
    const tryIt = readme.slice(readme.indexOf("## Try it"), readme.indexOf("\n## ", readme.indexOf("## Try it") + 1));
    expect(tryIt).toContain("npx ccwatts");
    expect(readme).not.toMatch(/once ccwatts is on npm|until then|publish to npm|npm publish is the next step/i);
  });

  it("shows the playground on sample data, not a dashboard that reads as real history", () => {
    expect(readme).not.toContain("docs/images/dashboard.png");
    expect(readme).toContain("docs/images/playground-laptop.png");
  });

  it("opens with the terminal recording, and the file is there (M2.2)", () => {
    expect(readme.split("\n").slice(0, 10).join("\n")).toContain("docs/images/cli-demo.gif");
    expect(existsSync(new URL("../../../docs/images/cli-demo.gif", import.meta.url))).toBe(true);
  });
});
