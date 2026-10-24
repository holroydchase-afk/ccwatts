import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, defaultParams as params, estimate, formatEnergy, linkedInPost, receiptSvg, shareLine } from "../src/index.js";

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

  it("CCW-UX2 share line and post read as sentences: no double hedge, no dot separators in prose", () => {
    for (const text of [shareLine(input), linkedInPost(input), linkedInPost({ ...input, sample: true })]) {
      const first = text.split("\n")[0] + (text.split("\n")[2] ?? "");
      expect(first).not.toMatch(/roughly/);
      expect(first).not.toMatch(/miles · |days · /);
      expect(first).toMatch(/like driving an EV about [\d.]+ miles/);
    }
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

  describe("on sample data (recruiter-ready RR-4)", () => {
    const sample = { ...input, sample: true };

    it("card says sample and never claims a real measurement", () => {
      const svg = receiptSvg(sample);
      expect(svg).toContain("SAMPLE DATA");
      expect(svg).toContain("not a real measurement");
      expect(svg).not.toContain("my laptop");
    });

    it("post and share line start by saying it's sample data and drop the first person", () => {
      const post = linkedInPost(sample);
      expect(post.startsWith("(Sample data)")).toBe(true);
      expect(post).not.toMatch(/\bI measured\b|\bmy\b/i);
      expect(shareLine(sample).startsWith("(Sample data)")).toBe(true);
    });

    it("real data keeps its first-person wording", () => {
      expect(receiptSvg(input)).toContain("Estimated on my laptop.");
      expect(linkedInPost(input).startsWith("I estimated")).toBe(true);
      expect(receiptSvg(input)).not.toContain("SAMPLE DATA");
    });
  });

  describe("round 2 (recruiter-ready RR-15, RR-17)", () => {
    it("says estimated, not measured, and only calls a big cache share a surprise", () => {
      const post = linkedInPost(input);
      expect(post).not.toContain("I measured");
      expect(post).toContain("The surprise:");
      const small = { ...input, estimate: estimate(claudeCodeAdapter.parse(readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8")), params) };
      expect(linkedInPost(small)).not.toContain("The surprise:");
    });

    it("picks the range unit from the high bound so a row never reads 88.5 – 2,155 Wh", () => {
      const t = formatEnergy({ low: 88.5, central: 618, high: 2155 });
      expect(t.unit).toBe("kWh");
      expect(t.range).toBe("0.09 – 2.2");
      expect(formatEnergy({ low: 2.3, central: 9.1, high: 27.5 }).unit).toBe("Wh");
    });

    // CCW-RR-21: the dashboard showed "8 kWh" where the playground showed "8.5 kWh".
    it("keeps one decimal between 1 and 100 so totals line up across surfaces", () => {
      expect(formatEnergy({ low: 1200, central: 8000, high: 30000 }).central).toBe("8.0 kWh");
      expect(formatEnergy({ low: 1300, central: 8500, high: 30500 }).range).toBe("1.3 – 30.5");
      expect(formatEnergy({ low: 1000, central: 2000, high: 3000 }).range).toBe("1.0 – 3.0");
      expect(formatEnergy({ low: 88.5, central: 618, high: 2155 }).central).toBe("0.62 kWh");
      expect(formatEnergy({ low: 120, central: 340, high: 900 }).central).toBe("340 Wh");
    });
  });
});
