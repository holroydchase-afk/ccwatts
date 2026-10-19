import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, dedupe, projectRef, totalsByModel } from "../src/index.js";

const sample = readFileSync(new URL("../../../fixtures/claude-code/sample.jsonl", import.meta.url), "utf8");

describe("claudeCodeAdapter", () => {
  const records = claudeCodeAdapter.parse(sample);

  it("keeps one record per billed response and skips synthetic, user and malformed lines", () => {
    expect(records.map((r) => r.key).sort()).toEqual(["msg_A1:req_A1", "msg_A2:req_A2", "msg_B1:req_B1"]);
  });

  it("maps usage fields to normalized token types", () => {
    const a2 = records.find((r) => r.key === "msg_A2:req_A2");
    expect(a2?.tokens).toEqual({ input: 4, cacheWrite: 500, cacheRead: 20000, output: 120 });
    expect(a2?.model).toBe("claude-opus-4-6");
  });

  it("never stores a full path", () => {
    const json = JSON.stringify(records);
    expect(json).not.toContain("/home/dev");
    expect(records[0]?.project?.name).toBe("alpha");
  });

  it("totals by model across files without double-counting", () => {
    const totals = totalsByModel(dedupe([...records, ...claudeCodeAdapter.parse(sample)]));
    expect(totals).toEqual([
      { model: "claude-opus-4-6", tokens: { input: 14, cacheWrite: 20500, cacheRead: 20000, output: 420 } },
      { model: "claude-sonnet-4-6", tokens: { input: 6, cacheWrite: 1000, cacheRead: 15000, output: 80 } },
    ]);
  });
});

describe("projectRef", () => {
  it("is stable and ignores a trailing slash", () => {
    expect(projectRef("/home/dev/code/beta/")).toEqual(projectRef("/home/dev/code/beta"));
    expect(projectRef("C:\\code\\gamma").name).toBe("gamma");
  });
});
