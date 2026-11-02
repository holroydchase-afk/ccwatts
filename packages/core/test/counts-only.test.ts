import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { claudeCodeAdapter, type UsageRecord } from "../src/index.js";

// Ticket SAVE: countsOnlyLog(text) keeps only what claudeCodeAdapter needs, so a copy of a cloud
// session's log can be saved without any content. Synthetic lines only, built in code.

const countsOnlyLog = (text: string): string => {
  const fn = (core as Record<string, unknown>).countsOnlyLog;
  if (typeof fn !== "function") throw new Error("countsOnlyLog is not exported from @ccwatts/core");
  return (fn as (t: string) => string)(text);
};

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/claude-code/${name}`, import.meta.url)), "utf8");

const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n");
const CWD = "/Users/someone/private/app";
const usage = (output: number) => ({ input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 2000, output_tokens: output });

const user = (timestamp: string, extra: Record<string, unknown> = {}, content: unknown = "SECRET-PROMPT please fix") => ({
  type: "user",
  timestamp,
  cwd: CWD,
  gitBranch: "feature/secret-branch",
  sessionId: "sess-SECRET-ID",
  uuid: `uuid-${timestamp}`,
  version: "2.0.1",
  userType: "external",
  message: { role: "user", content },
  ...extra,
});

const assistant = (timestamp: string, id: string, req: string, content: unknown[], out = 10, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  timestamp,
  cwd: CWD,
  gitBranch: "feature/secret-branch",
  sessionId: "sess-SECRET-ID",
  uuid: `uuid-a-${timestamp}`,
  version: "2.0.1",
  requestId: req,
  message: { id, model: "claude-opus-4-6", role: "assistant", content, usage: usage(out) },
  ...extra,
});

/** A realistic session: multi-line responses, tool use, tool results, meta, sidechain, summary. */
const SESSION = jsonl(
  { type: "summary", summary: "SECRET-SUMMARY", leafUuid: "leaf-1" },
  user("2026-10-20T10:00:00.000Z"),
  assistant("2026-10-20T10:00:02.000Z", "msg_1", "req_1", [{ type: "thinking", thinking: "SECRET-THOUGHT" }], 5),
  assistant("2026-10-20T10:00:03.000Z", "msg_1", "req_1", [{ type: "text", text: "SECRET-REPLY" }], 40),
  assistant("2026-10-20T10:00:04.000Z", "msg_1", "req_1", [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "cat SECRET-TOOL-INPUT" } }], 90),
  user("2026-10-20T10:00:05.000Z", { toolUseResult: { stdout: "SECRET-TOOL-OUTPUT" } }, [{ type: "tool_result", tool_use_id: "tu_1", content: "SECRET-TOOL-OUTPUT" }]),
  assistant("2026-10-20T10:00:07.000Z", "msg_2", "req_2", [{ type: "text", text: "SECRET-REPLY two" }], 25),
  user("2026-10-20T10:01:00.000Z", { isMeta: true }, "SECRET-META caveat"),
  user("2026-10-20T10:02:00.000Z", { origin: { kind: "human" } }, [{ type: "text", text: "SECRET-PROMPT again" }]),
  user("2026-10-20T10:02:01.000Z", { isSidechain: true }, "SECRET-SIDECHAIN prompt"),
  assistant("2026-10-20T10:02:03.000Z", "msg_3", "req_3", [{ type: "text", text: "SECRET-REPLY side" }], 7, { isSidechain: true }),
  user("2026-10-20T10:03:00.000Z", { isCompactSummary: true }, "SECRET-COMPACT"),
  user("2026-10-20T10:04:00.000Z", { origin: { kind: "task-notification" } }, "SECRET-NOTE"),
  assistant("2026-10-20T10:05:00.000Z", "msg_s", "req_s", [{ type: "text", text: "SECRET-SYNTH" }], 0, { message: { id: "msg_s", model: "<synthetic>", content: [], usage: usage(0) } }),
  { type: "system", subtype: "info", timestamp: "2026-10-20T10:06:00.000Z", content: "SECRET-SYSTEM", cwd: CWD },
  { type: "file-history-snapshot", snapshot: { trackedFileBackups: { [`${CWD}/a.ts`]: {} } } },
);

const NO_CWD = jsonl(
  { type: "assistant", timestamp: "2026-10-21T09:00:00.000Z", requestId: "req_n", message: { id: "msg_n", model: "claude-sonnet-4-6", usage: usage(3) } },
);

const strip = (r: UsageRecord) => ({ key: r.key, timestamp: r.timestamp, model: r.model, tokens: r.tokens, project: r.project?.name ?? null });
const byKey = (rs: UsageRecord[]) => rs.map(strip).sort((a, b) => a.key.localeCompare(b.key));

const ASSISTANT_KEYS = ["cwd", "message", "requestId", "timestamp", "type"];
const MESSAGE_KEYS = ["id", "model", "usage"];
const USAGE_KEYS = ["cache_creation_input_tokens", "cache_read_input_tokens", "input_tokens", "output_tokens"];

describe("SAVE countsOnlyLog (pure, counts only)", () => {
  it("SAVE-0 countsOnlyLog is exported from @ccwatts/core", () => {
    expect(typeof (core as Record<string, unknown>).countsOnlyLog).toBe("function");
  });

  it.each(["sample.jsonl", "demo.jsonl"])("SAVE-1 round trip: parse(countsOnlyLog(x)) matches parse(x) for fixture %s", (name) => {
    const raw = fixture(name);
    const before = claudeCodeAdapter.parse(raw);
    expect(before.length).toBeGreaterThan(0);
    expect(byKey(claudeCodeAdapter.parse(countsOnlyLog(raw)))).toEqual(byKey(before));
  });

  it("SAVE-1b round trip on an inline session with multi-line responses: last line's output wins, project name is the basename", () => {
    const before = claudeCodeAdapter.parse(SESSION);
    const after = claudeCodeAdapter.parse(countsOnlyLog(SESSION));
    expect(byKey(after)).toEqual(byKey(before));
    expect(after.find((r) => r.key === "msg_1:req_1")?.tokens.output).toBe(90);
    for (const r of after) expect(r.project?.name).toBe("app");
  });

  it("SAVE-1c a line with no cwd stays with no project", () => {
    const out = countsOnlyLog(NO_CWD);
    const [rec] = claudeCodeAdapter.parse(out);
    expect(rec?.project).toBeNull();
    expect(JSON.parse(out.trim())).not.toHaveProperty("cwd");
  });

  it("SAVE-1d each response counts once after parse, even when every content-block line is kept", () => {
    // activity() places every timestamped assistant line, so the copy may keep one line per block;
    // parse must still dedupe them to one record per message id + request id.
    const after = claudeCodeAdapter.parse(countsOnlyLog(SESSION));
    expect(after.filter((r) => r.key === "msg_1:req_1")).toHaveLength(1);
  });

  it("SAVE-2 activity(countsOnlyLog(x)) equals activity(x): same timestamps and human flags", () => {
    const activity = claudeCodeAdapter.activity!.bind(claudeCodeAdapter);
    const before = activity(SESSION);
    expect(before.filter((e) => e.human)).toHaveLength(2);
    expect(activity(countsOnlyLog(SESSION))).toEqual(before);
  });

  it("SAVE-2b activity round trip on the fixtures", () => {
    const activity = claudeCodeAdapter.activity!.bind(claudeCodeAdapter);
    for (const name of ["sample.jsonl", "demo.jsonl"]) {
      const raw = fixture(name);
      expect(activity(countsOnlyLog(raw)), name).toEqual(activity(raw));
    }
  });

  it("SAVE-3 privacy: no prompt, reply, tool input/output, full cwd, branch or session id survives", () => {
    const out = countsOnlyLog(SESSION);
    expect(out.length).toBeGreaterThan(0);
    for (const secret of ["SECRET", "/Users", CWD, "private", "someone", "secret-branch", "sess-", "uuid-", "2.0.1", "Bash", "tu_1"]) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it("SAVE-4 every output line is JSON with only the allowed keys", () => {
    const lines = countsOnlyLog(SESSION + "\n" + NO_CWD).split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const raw of lines) {
      const line = JSON.parse(raw) as Record<string, unknown>;
      if (line.type === "assistant") {
        expect(ASSISTANT_KEYS).toEqual(expect.arrayContaining(Object.keys(line)));
        // A line parse rejects (e.g. "<synthetic>") may stay as {type, timestamp} so activity() still sees it.
        if (!("message" in line)) {
          expect(Object.keys(line).sort()).toEqual(["timestamp", "type"]);
          continue;
        }
        const message = line.message as Record<string, unknown>;
        expect(Object.keys(message).sort()).toEqual(MESSAGE_KEYS);
        expect(Object.keys(message.usage as object).sort()).toEqual(USAGE_KEYS);
        for (const v of Object.values(message.usage as object)) expect(typeof v).toBe("number");
        if ("cwd" in line) expect(line.cwd).toMatch(/^[0-9a-f]{16}\/[^/]+$/);
      } else {
        expect(line.type).toBe("user");
        const keys = Object.keys(line).sort();
        expect([["origin", "timestamp", "type"], ["isMeta", "timestamp", "type"]]).toContainEqual(keys);
        if ("origin" in line) expect(line.origin).toEqual({ kind: "human" });
        if ("isMeta" in line) expect(line.isMeta).toBe(true);
      }
    }
  });

  it("SAVE-5 garbage, empty lines and a BOM don't throw and still round trip", () => {
    expect(() => countsOnlyLog("")).not.toThrow();
    expect(countsOnlyLog("").trim()).toBe("");
    const messy = "﻿" + SESSION + "\n\n{not json\nnull\n42\n\"assistant\"\n[1,2]\n{\"type\":\"assistant\",\"message\":null}\n";
    expect(() => countsOnlyLog(messy)).not.toThrow();
    expect(byKey(claudeCodeAdapter.parse(countsOnlyLog(messy)))).toEqual(byKey(claudeCodeAdapter.parse(SESSION)));
  });
});

describe("PS-R18 countsOnlyLog drops ids that aren't plain tokens", () => {
  const LONG = "r".repeat(500);
  const BAD: [string, { id: string; req: string }][] = [
    ["requestId with text and spaces", { id: "msg_ok", req: "req SECRET text with spaces" }],
    ["message.id with text and spaces", { id: "msg SECRET text with spaces", req: "req_ok" }],
    ["requestId of 500 chars", { id: "msg_ok2", req: LONG }],
    ["message.id of 500 chars", { id: LONG, req: "req_ok2" }],
  ];

  it.each(BAD)("PS-R18 %s never reaches the output, and the line still counts for activity", (_label, { id, req }) => {
    const raw = jsonl(assistant("2026-10-22T09:00:00.000Z", id, req, [{ type: "text", text: "hi" }], 12));
    const out = countsOnlyLog(raw);
    const bad = id === "msg_ok" || id === "msg_ok2" ? req : id;
    expect(out).not.toContain(bad);
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("r".repeat(129));
    // Still counts for Pace.
    const activity = claudeCodeAdapter.activity!.bind(claudeCodeAdapter);
    expect(activity(out)).toEqual(activity(raw));
    // No usage record carries the bad id.
    for (const r of claudeCodeAdapter.parse(out)) expect(r.key).not.toContain(bad);
    for (const l of out.split("\n").filter((x) => x.trim() !== "")) {
      const line = JSON.parse(l) as { requestId?: unknown; message?: { id?: unknown } };
      for (const v of [line.requestId, line.message?.id]) if (v !== undefined) expect(String(v)).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    }
  });
});
