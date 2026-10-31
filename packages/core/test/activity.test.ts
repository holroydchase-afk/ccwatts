import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, type ActivityEvent } from "../src/index.js";

// CCW-M4.2: claudeCodeAdapter.activity(text). Synthetic lines only, built in code: no real prompts,
// ids or timestamps. The human-turn rule is decided by line STRUCTURE, never by the text.

const CWD = "/work/demo-proj";
const PROMPT = "synthetic prompt text";

function activity(text: string): ActivityEvent[] {
  const fn = claudeCodeAdapter.activity;
  if (typeof fn !== "function") throw new Error("claudeCodeAdapter.activity is not implemented");
  return fn.call(claudeCodeAdapter, text);
}

const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n");

const user = (timestamp: string, extra: Record<string, unknown> = {}, content: unknown = PROMPT) => ({
  type: "user",
  timestamp,
  cwd: CWD,
  sessionId: "sess-synthetic-1",
  uuid: `uuid-${timestamp}`,
  userType: "external",
  message: { role: "user", content },
  ...extra,
});

const assistant = (timestamp: string, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  timestamp,
  cwd: CWD,
  sessionId: "sess-synthetic-1",
  uuid: `uuid-a-${timestamp}`,
  requestId: `req-${timestamp}`,
  message: {
    id: `msg-${timestamp}`,
    model: "claude-opus-4-6",
    role: "assistant",
    content: [{ type: "text", text: "synthetic reply text" }],
    usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
  },
  ...extra,
});

const T = "2026-01-15T10:00:00.000Z";
const humanOf = (line: object) => {
  const events = activity(jsonl(line));
  expect(events).toHaveLength(1);
  return events[0]!.human;
};

describe("CCW-M4.2 claudeCodeAdapter.activity: human-turn rule (structure only)", () => {
  it("PACE-HT1 a string prompt with no origin is a human turn", () => {
    expect(humanOf(user(T))).toBe(true);
  });

  it("PACE-HT2 a tool_result block is not a human turn", () => {
    const line = user(T, {}, [{ type: "tool_result", tool_use_id: "tu-1", content: "synthetic tool output" }]);
    expect(humanOf(line)).toBe(false);
  });

  it("PACE-HT3 a line with a toolUseResult key is not a human turn, even with text-only content", () => {
    const line = user(T, { toolUseResult: { stdout: "" } }, [{ type: "text", text: PROMPT }]);
    expect(humanOf(line)).toBe(false);
  });

  it("PACE-HT4 isMeta lines are not human turns", () => {
    expect(humanOf(user(T, { isMeta: true }))).toBe(false);
  });

  it("PACE-HT5 isSidechain (subagent) user lines are activity but not human turns", () => {
    expect(humanOf(user(T, { isSidechain: true }))).toBe(false);
  });

  it("PACE-HT6 isCompactSummary lines are not human turns", () => {
    expect(humanOf(user(T, { isCompactSummary: true }))).toBe(false);
  });

  it("PACE-HT7 origin.kind decides when origin is present: human yes, task-notification no", () => {
    expect(humanOf(user(T, { origin: { kind: "human" } }))).toBe(true);
    expect(humanOf(user(T, { origin: { kind: "task-notification" } }))).toBe(false);
    expect(humanOf(user(T, { origin: { kind: "something-new" } }))).toBe(false);
  });

  it("PACE-HT8 with no origin, an array of only text and image blocks is a human turn", () => {
    const content = [
      { type: "text", text: PROMPT },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ];
    expect(humanOf(user(T, {}, content))).toBe(true);
  });

  it("PACE-HT9 text that looks like a command, tag or caveat does not change the result (structure decides)", () => {
    const texts = [
      "<command-name>/clear</command-name>",
      "Caveat: synthetic caveat text",
      "<local-command-stdout>synthetic</local-command-stdout>",
      "",
    ];
    for (const text of texts) {
      expect(humanOf(user(T, {}, text))).toBe(true);
      expect(humanOf(user(T, { origin: { kind: "human" } }, text))).toBe(true);
      expect(humanOf(user(T, { origin: { kind: "task-notification" } }, text))).toBe(false);
      expect(humanOf(user(T, { isMeta: true }, text))).toBe(false);
    }
  });

  it("PACE-HT10 assistant lines (main and sidechain) are activity events with human false", () => {
    const events = activity(jsonl(assistant(T), assistant("2026-01-15T10:01:00.000Z", { isSidechain: true })));
    expect(events.map((e) => e.human)).toEqual([false, false]);
  });

  it("PACE-HT11 only timestamped user/assistant lines count; others, bad timestamps and bad JSON are skipped; output is sorted", () => {
    const text = [
      JSON.stringify(assistant("2026-01-15T10:05:00.000Z")),
      JSON.stringify({ type: "summary", summary: "synthetic", leafUuid: "x" }),
      JSON.stringify({ type: "system", timestamp: "2026-01-15T10:02:00.000Z", content: "synthetic" }),
      JSON.stringify({ type: "file-history-snapshot", timestamp: "2026-01-15T10:03:00.000Z" }),
      JSON.stringify(user("not-a-time")),
      JSON.stringify({ ...user(T), timestamp: undefined }),
      "{not json",
      "",
      JSON.stringify(user("2026-01-15T10:01:00.000Z")),
    ].join("\n");
    const events = activity(text);
    expect(events).toEqual([
      { timestamp: "2026-01-15T10:01:00.000Z", human: true },
      { timestamp: "2026-01-15T10:05:00.000Z", human: false },
    ]);
  });

  it("PACE-HT12 parse() is unchanged: user lines still produce no usage records", () => {
    const text = jsonl(user(T), assistant("2026-01-15T10:01:00.000Z"));
    expect(claudeCodeAdapter.parse(text)).toHaveLength(1);
  });
});

describe("CCW-M4.2 activity privacy", () => {
  it("PACE-PRIV1 activity events carry exactly timestamp and human: no content, ids or paths", () => {
    const text = jsonl(
      user(T, { origin: { kind: "human" } }),
      assistant("2026-01-15T10:01:00.000Z"),
      user("2026-01-15T10:02:00.000Z", {}, [{ type: "tool_result", tool_use_id: "tu-1", content: "synthetic tool output" }]),
    );
    const events = activity(text);
    expect(events).toHaveLength(3);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(["human", "timestamp"]);
    const json = JSON.stringify(events);
    for (const banned of [PROMPT, "synthetic reply", "synthetic tool output", CWD, "demo-proj", "sess-synthetic", "uuid-", "msg-", "req-", "claude-opus"]) {
      expect(json).not.toContain(banned);
    }
  });
});
