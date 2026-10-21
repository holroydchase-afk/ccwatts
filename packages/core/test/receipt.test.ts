import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, defaultParams as params, estimate, linkedInPost, receiptSvg, shareLine } from "../src/index.js";

const demo = readFileSync(new URL("../../../fixtures/claude-code/demo.jsonl", import.meta.url), "utf8");
const input = { estimate: estimate(claudeCodeAdapter.parse(demo), params), params, windowLabel: "last 30 days" };

describe("receipt", () => {
  it("share line has the central value, the range and the method version", () => {
    const line = shareLine(input);
    expect(line).toMatch(/about [\d.]+ kWh/);
    expect(line).toMatch(/range [\d.]+ – [\d.]+ kWh/);
    expect(line).toContain(`method v${params.version}`);
  });

  it("card is a 1200×627 SVG with no external references", () => {
    const svg = receiptSvg(input);
    expect(svg).toMatch(/^<svg [^>]*width="1200" height="627"/);
    expect(svg).not.toMatch(/href=|url\(|@import|<image/);
    expect(svg).not.toContain("/home/demo");
    expect(svg).toContain("ELECTRICITY RECEIPT");
  });

  it("post links the repo and explains the range", () => {
    const post = linkedInPost(input);
    expect(post).toContain("https://github.com/");
    expect(post).toContain("range");
  });

  it("escapes text", () => {
    const svg = receiptSvg({ ...input, windowLabel: "<b>&" });
    expect(svg).not.toContain("<b>&");
  });
});
