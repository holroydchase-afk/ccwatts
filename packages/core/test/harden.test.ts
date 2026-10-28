import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, defaultParams, estimate, parseHistory, parseSince, rollup, rollupRecords, serializeHistory, weekly } from "../src/index.js";

// CCW-M2.6.4 harden: bad input to the pure core. Synthetic counts only, never prompt text.
// Tests titled "RED" failed when written (behavior was wrong); "coverage" tests pin behavior that
// already worked but had no test.

const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 };
const line = (id: string, timestamp: unknown, u: unknown = usage, model = "claude-opus-4-6") =>
  JSON.stringify({ type: "assistant", timestamp, cwd: "/synthetic/proj", requestId: `req_${id}`, message: { id: `msg_${id}`, model, usage: u } });
const parse = (text: string) => claudeCodeAdapter.parse(text);

describe("CCW-M2.6.4 parser bad input (coverage)", () => {
  it("coverage: an empty file gives no records", () => {
    expect(parse("")).toEqual([]);
    expect(parse("\n\n")).toEqual([]);
  });

  it("coverage: malformed and truncated lines are skipped, good lines around them kept", () => {
    const text = ["{not json", line("a", "2026-10-01T10:00:00.000Z"), '{"type":"assistant","message":{"usage":', line("b", "2026-10-01T11:00:00.000Z")].join("\n");
    expect(parse(text).map((r) => r.key).sort()).toEqual(["msg_a:req_a", "msg_b:req_b"]);
  });

  it("coverage: CRLF line endings parse the same as LF", () => {
    const lf = [line("a", "2026-10-01T10:00:00.000Z"), line("b", "2026-10-01T11:00:00.000Z")].join("\n");
    expect(parse(lf.replace(/\n/g, "\r\n") + "\r\n")).toEqual(parse(lf));
  });

  // Non-finite and huge counts are PS-R6 below (dropped as malformed), not zeroed.
  it("coverage: negative, string, null and array token counts become 0, never NaN", () => {
    const [r] = parse(line("a", "2026-10-01T10:00:00.000Z", { input_tokens: -5, cache_creation_input_tokens: "100", cache_read_input_tokens: null, output_tokens: 0 }));
    expect(r?.tokens).toEqual({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
    const [arr] = parse(line("b", "2026-10-01T10:00:00.000Z", [1, 2]));
    expect(Object.values(arr!.tokens).every((n) => n === 0)).toBe(true);
    const e = estimate(parse(line("c", "2026-10-01T10:00:00.000Z", { input_tokens: "NaN", output_tokens: -1 })), defaultParams);
    expect(Number.isNaN(e.total.central)).toBe(false);
  });

  it("coverage: lines that are JSON but not objects (null, strings, arrays) are ignored", () => {
    expect(parse('null\n"assistant"\n[1,"assistant"]\n{"type":"assistant","message":null}')).toEqual([]);
  });

  it("coverage: a missing or non-string timestamp drops the line", () => {
    expect(parse(line("a", undefined))).toEqual([]);
    expect(parse(line("b", 12345))).toEqual([]);
  });

  it("coverage: an unknown model is estimated with the fallback tier and a warning", () => {
    const e = estimate(parse(line("a", "2026-10-01T10:00:00.000Z", usage, "mystery-model-9")), defaultParams);
    expect(e.total.central).toBeGreaterThan(0);
    expect(e.warnings.join(" ")).toContain('Unknown model "mystery-model-9"');
  });

  it("coverage: duplicate message ids across two files count once", () => {
    const a = parse(line("dup", "2026-10-01T10:00:00.000Z"));
    const b = parse([line("dup", "2026-10-01T10:00:00.000Z"), line("other", "2026-10-01T11:00:00.000Z")].join("\n"));
    const merged = new Map([...a, ...b].map((r) => [`${r.source}:${r.key}`, r]));
    expect(estimate([...merged.values()], defaultParams).responses).toBe(2);
  });
});

describe("CCW-M2.6.4 parser bad input (RED)", () => {
  it("HARDEN-1 RED: a UTF-8 byte-order mark before the first line doesn't lose that line", () => {
    const text = "﻿" + [line("a", "2026-10-01T10:00:00.000Z"), line("b", "2026-10-01T11:00:00.000Z")].join("\n");
    expect(parse(text).map((r) => r.key).sort()).toEqual(["msg_a:req_a", "msg_b:req_b"]);
  });

  it("HARDEN-2 RED: a line whose timestamp isn't a date is dropped, so it can't reach a rollup", () => {
    const records = parse([line("bad", "not-a-date"), line("ok", "2026-10-01T10:00:00.000Z")].join("\n"));
    expect(records.map((r) => r.key)).toEqual(["msg_ok:req_ok"]);
    // What used to happen downstream: weekly() threw "Invalid time value" on the rollup's date.
    expect(() => weekly(estimate(rollupRecords(rollup(records)), defaultParams).byDay)).not.toThrow();
  });
});

describe("CCW-M2.6.4 history file bad input", () => {
  const row = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ date: "2026-10-01", source: "claude-code", model: "claude-opus-4-6", projectId: null, projectName: null, responses: 1, tokens: { input: 1, cacheWrite: 1, cacheRead: 1, output: 1 }, ...over });

  it("coverage: a partly written last line (crash mid-write) is skipped, earlier rows kept", () => {
    const text = [row(), row({ date: "2026-10-02" }).slice(0, 40)].join("\n");
    expect(parseHistory(text).map((r) => r.date)).toEqual(["2026-10-01"]);
  });

  it("HARDEN-3 RED: rows with a date that isn't YYYY-MM-DD, or negative counts, are skipped", () => {
    const text = [
      row(),
      row({ date: "garbage" }),
      row({ date: "2026-10-02", responses: -3 }),
      row({ date: "2026-10-03", tokens: { input: -1e9, cacheWrite: 1, cacheRead: 1, output: 1 } }),
    ].join("\n");
    expect(parseHistory(text).map((r) => r.date)).toEqual(["2026-10-01"]);
  });
});

describe("CCW-M2.6.4 --since bad input", () => {
  const now = new Date("2026-10-28T00:00:00Z");

  it("coverage: garbage, negative, fractional and empty values throw the plain --since message", () => {
    for (const bad of ["garbage", "-7d", "1.5d", "", "2026-13-01", "7y"]) {
      expect(() => parseSince(bad, now), JSON.stringify(bad)).toThrow(/Can't read --since/);
    }
  });

  it("HARDEN-4 RED: a window too large for a date throws the plain --since message, not 'Invalid time value'", () => {
    expect(() => parseSince("99999999999d", now)).toThrow(/Can't read --since/);
  });
});

// ---------------------------------------------------------------------------------------------
// privacy-security findings (CCW-M2.6.4). RED when written.
// ---------------------------------------------------------------------------------------------
// C0 and C1 controls (ESC included), DEL, and the bidi marks, embeddings, overrides and isolates.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

describe("PS-R3 model and project names are sanitised in core", () => {
  it("PS-R3 RED: a model id with ANSI escapes comes out with no control characters", () => {
    const [r] = parse(line("a", "2026-10-01T10:00:00.000Z", usage, "\u001b[31mRED\u001b[0m-opus"));
    expect(r).toBeDefined();
    expect(r!.model).not.toMatch(UNSAFE);
  });

  it("PS-R3 RED: a cwd basename with C0, C1 and bidi characters comes out with none of them", () => {
    const text = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-01T10:00:00.000Z",
      cwd: "/synthetic/evil\u202Egnp.exe\u0007\u0085\u2066name\u001b[2J",
      requestId: "req_b",
      message: { id: "msg_b", model: "claude-opus-4-6", usage },
    });
    const [r] = parse(text);
    expect(r?.project?.name).toBeTruthy();
    expect(r!.project!.name).not.toMatch(UNSAFE);
  });

  it("PS-R3 RED: model and project names are capped at 64 characters", () => {
    const text = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-01T10:00:00.000Z",
      cwd: `/synthetic/${"p".repeat(300)}`,
      requestId: "req_c",
      message: { id: "msg_c", model: `claude-opus-${"m".repeat(300)}`, usage },
    });
    const [r] = parse(text);
    expect(r).toBeDefined();
    expect(r!.model.length).toBeLessThanOrEqual(64);
    expect(r!.project!.name.length).toBeLessThanOrEqual(64);
  });

  it("PS-R3 coverage: sanitising never merges two different folders: the id still hashes the full path", () => {
    const a = parse(JSON.stringify({ type: "assistant", timestamp: "2026-10-01T10:00:00.000Z", cwd: `/a/${"p".repeat(300)}1`, requestId: "r1", message: { id: "m1", model: "claude-opus-4-6", usage } }));
    const b = parse(JSON.stringify({ type: "assistant", timestamp: "2026-10-01T10:00:00.000Z", cwd: `/a/${"p".repeat(300)}2`, requestId: "r2", message: { id: "m2", model: "claude-opus-4-6", usage } }));
    expect(a[0]!.project!.id).not.toBe(b[0]!.project!.id);
  });
});

describe("PS-R6 implausible token counts are malformed", () => {
  it("PS-R6 RED: a usage block with 1e300, Infinity, a fraction or over 1e9 tokens is dropped; good lines stay", () => {
    const bad = [1e300, 1e400, 1.5, 2e9, Number.MAX_SAFE_INTEGER + 2];
    const text = [
      ...bad.map((n, i) => line(`bad${i}`, "2026-10-01T10:00:00.000Z", { ...usage, input_tokens: n })),
      line("ok", "2026-10-01T10:00:00.000Z"),
    ].join("\n");
    expect(parse(text).map((r) => r.key)).toEqual(["msg_ok:req_ok"]);
  });

  it("PS-R6 RED: a history round trip keeps every row, with no null from an Infinity", () => {
    const text = [
      line("big", "2026-10-01T10:00:00.000Z", { input_tokens: 1e300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1e300 }),
      line("ok", "2026-10-01T11:00:00.000Z"),
      line("ok2", "2026-10-02T11:00:00.000Z"),
    ].join("\n");
    const rows = rollup(parse(text));
    const back = parseHistory(serializeHistory(rows));
    expect(back).toHaveLength(rows.length);
    expect(serializeHistory(rows)).not.toContain("null,");
    for (const r of back) for (const v of [...Object.values(r.tokens), r.outputContext ?? 0]) expect(Number.isFinite(v)).toBe(true);
  });
});
