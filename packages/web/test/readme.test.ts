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

describe("WI-R3 README describes the what-if slider in the same words (CCW-M2.6.5)", () => {
  it("WI-R3: README says the slider 'moves the least certain assumption'", () => {
    expect(readme).toContain("moves the least certain assumption");
  });
});

describe("DEMO-SYNC README demo shows the bedtime nudge (PR #80)", () => {
  const section = (heading: string) => {
    const start = readme.indexOf(heading);
    if (start === -1) return "";
    const end = readme.indexOf("\n## ", start + 1);
    return readme.slice(start, end === -1 ? undefined : end);
  };

  it("DEMO-SYNC-1: the Bedtime nudge section embeds the cli-nudge.gif recording with alt text, and the file is there", () => {
    const nudge = section("## Bedtime nudge (opt-in)");
    expect(nudge).not.toBe("");
    expect(nudge).toMatch(/!\[[^\]]+\]\(docs\/images\/cli-nudge\.gif\)|<img[^>]*src="docs\/images\/cli-nudge\.gif"[^>]*alt="[^"]+"|<img[^>]*alt="[^"]+"[^>]*src="docs\/images\/cli-nudge\.gif"/);
    expect(existsSync(new URL("../../../docs/images/cli-nudge.gif", import.meta.url))).toBe(true);
  });

  it("DEMO-SYNC-2: the nudge recording is reproducible from the real CLI by scripts/make-readme-gif.ts", () => {
    const script = readFileSync(new URL("../../../scripts/make-readme-gif.ts", import.meta.url), "utf8");
    expect(script).toContain("cli-nudge.gif");
    expect(script).toContain("nudge --preview");
  });
});

describe("DEMO-UX README demo polish (ux-reviewer findings)", () => {
  const section = (heading: string) => {
    const start = readme.indexOf(heading);
    if (start === -1) return "";
    const end = readme.indexOf("\n## ", start + 1);
    return readme.slice(start, end === -1 ? undefined : end);
  };
  const altFor = (file: string) => {
    const m = readme.match(new RegExp(`!\\[([^\\]]*)\\]\\(docs/images/${file.replace(".", "\\.")}\\)`));
    return m ? m[1] : "";
  };

  // Source-level proxy only: the visual check (equal left and right gutter in the GIF) is manual.
  it("DEMO-UX-R3: make-readme-gif.ts sizes the window to include the pre's 26px right padding after the longest line", () => {
    const script = readFileSync(new URL("../../../scripts/make-readme-gif.ts", import.meta.url), "utf8");
    const widthLine = script.split("\n").find((l) => l.includes("scrollWidth")) ?? "";
    expect(widthLine).not.toBe("");
    expect(widthLine).toMatch(/\+\s*(26\b|[A-Za-z_]*PAD[A-Za-z_]*)/i);
  });

  it("DEMO-UX-R4: the Bedtime nudge section says the persona lines rotate, so examples may differ from the GIF", () => {
    expect(section("## Bedtime nudge (opt-in)")).toMatch(/\brotate/i);
  });

  it("DEMO-UX-R5: the playground phone image alt text says it's dark mode", () => {
    expect(altFor("playground-phone.png")).toMatch(/dark mode/i);
  });

  it("DEMO-UX-R7: the laptop image alt mentions the demo bar, and the receipt alt says it's a sample", () => {
    expect(altFor("playground-laptop.png")).toMatch(/demo bar/i);
    const receipt = altFor("receipt-sample.png");
    expect(receipt).not.toBe("Receipt card");
    expect(receipt).toMatch(/sample/i);
  });
});
