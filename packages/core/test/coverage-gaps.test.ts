import { describe, expect, it } from "vitest";
import {
  claudeCodeAdapter,
  defaultParams as params,
  dropFuture,
  estimate,
  FUTURE_SLACK_MS,
  futureNote,
  linkedInPost,
  paceDays,
  projectRef,
  receiptSvg,
  shareLine,
  since,
  type ActivityEvent,
  type PaceOptions,
  type UsageRecord,
} from "../src/index.js";

// Characterization tests for branches the v8 coverage run showed as unexercised in packages/core.
// Synthetic data only: counts and timestamps, never prompt or response text.

const rec = (timestamp: string, over: Partial<UsageRecord> = {}): UsageRecord => ({
  source: "claude-code",
  key: `m-${timestamp}:r`,
  timestamp,
  model: "claude-sonnet-4-5",
  project: null,
  tokens: { input: 10, cacheWrite: 0, cacheRead: 0, output: 5 },
  ...over,
});

describe("COV-1 window: dropFuture and futureNote", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  const at = (ms: number) => ({ timestamp: new Date(now.getTime() + ms).toISOString() });

  it("COV-1a keeps a record dated exactly now + 1 day and drops one 1 ms later", () => {
    const edge = at(FUTURE_SLACK_MS);
    const over = at(FUTURE_SLACK_MS + 1);
    const { kept, future } = dropFuture([edge, over], now);
    expect(kept).toEqual([edge]);
    expect(future).toBe(1);
  });

  it("COV-1b keeps past and present records and counts none as future", () => {
    const rows = [at(-86_400_000), at(0), at(60_000)];
    expect(dropFuture(rows, now)).toEqual({ kept: rows, future: 0 });
  });

  it("COV-1c keeps a record whose timestamp can't be parsed (the adapter filters those earlier)", () => {
    const bad = { timestamp: "not a date" };
    expect(dropFuture([bad], now)).toEqual({ kept: [bad], future: 0 });
  });

  it("COV-1d empty input gives nothing kept and nothing dropped", () => {
    expect(dropFuture([], now)).toEqual({ kept: [], future: 0 });
  });

  it("COV-1e futureNote says response for 1 and responses otherwise", () => {
    expect(futureNote(1)).toBe("Ignored 1 response dated in the future.");
    expect(futureNote(2)).toBe("Ignored 2 responses dated in the future.");
  });
});

describe("COV-2 energy: since()", () => {
  it("COV-2a keeps records at the start instant (inclusive) and after, drops earlier ones", () => {
    const before = rec("2026-10-31T23:59:59.999Z");
    const edge = rec("2026-11-01T00:00:00.000Z");
    const after = rec("2026-11-02T08:00:00.000Z");
    expect(since([before, edge, after], "2026-11-01T00:00:00.000Z")).toEqual([edge, after]);
  });

  it("COV-2b a bare date start keeps every record on that date", () => {
    const edge = rec("2026-11-01T00:00:00.000Z");
    expect(since([rec("2026-10-31T23:00:00.000Z"), edge], "2026-11-01")).toEqual([edge]);
  });

  it("COV-2c empty input returns an empty array", () => {
    expect(since([], "2026-11-01")).toEqual([]);
  });
});

describe("COV-3 project: projectRef never stores a full path", () => {
  it("COV-3a a session at the POSIX root is named (root)", () => {
    expect(projectRef("/").name).toBe("(root)");
    expect(projectRef("///").name).toBe("(root)");
  });

  it("COV-3b a Windows drive root keeps the drive letter as its name (current behavior, see QA-R1)", () => {
    expect(projectRef("C:\\").name).toBe("C:");
  });

  it("COV-3c a basename of only control characters is named (unnamed)", () => {
    expect(projectRef("/home/dev/\u001b\u0007").name).toBe("(unnamed)");
  });

  it("COV-3d trailing slashes don't change the name or the id", () => {
    const plain = projectRef("/home/dev/alpha");
    expect(projectRef("/home/dev/alpha/").name).toBe("alpha");
    expect(projectRef("/home/dev/alpha//")).toEqual(plain);
    expect(projectRef("C:\\code\\alpha\\").name).toBe("alpha");
  });

  it("COV-3e the stored ref holds no separator and no parent folder, for POSIX, Windows and mixed paths", () => {
    for (const cwd of ["/home/dev/secret-client/alpha", "C:\\Users\\dev\\secret-client\\alpha", "/home/dev\\secret-client/alpha/"]) {
      const ref = projectRef(cwd);
      expect(ref.name).toBe("alpha");
      expect(ref.name).not.toMatch(/[\\/]/);
      expect(JSON.stringify(ref)).not.toMatch(/secret-client|dev|Users|home/);
      expect(ref.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("COV-3f the same basename under different parents gets different ids", () => {
    expect(projectRef("/a/alpha").id).not.toBe(projectRef("/b/alpha").id);
  });
});

describe("COV-4 claude-code adapter edges", () => {
  // An assistant line with empty content: counts only.
  const line = (over: Record<string, unknown> = {}, message: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-01T10:00:00.000Z",
      cwd: "/home/dev/alpha",
      requestId: "req_1",
      message: { id: "msg_1", model: "claude-sonnet-4-5", content: [], usage: { input_tokens: 3, output_tokens: 4 }, ...message },
      ...over,
    });

  it("COV-4a a model name that cleans to empty is shown as (unnamed)", () => {
    const [r] = claudeCodeAdapter.parse(line({}, { model: "\u001b\u009b" }));
    expect(r?.model).toBe("(unnamed)");
  });

  it("COV-4b a line with no cwd has project null", () => {
    const [r] = claudeCodeAdapter.parse(line({ cwd: undefined }));
    expect(r).toBeDefined();
    expect(r?.project).toBeNull();
  });

  it("COV-4c a line with no requestId keys on the message id with an empty request part", () => {
    const [r] = claudeCodeAdapter.parse(line({ requestId: undefined }));
    expect(r?.key).toBe("msg_1:");
    const [withReq] = claudeCodeAdapter.parse(line());
    expect(withReq?.key).toBe("msg_1:req_1");
  });

  it("COV-4d activity skips JSON lines that aren't objects and lines of other types", () => {
    const text = [
      '"user"',
      '["assistant"]',
      "null",
      JSON.stringify({ type: "system", subtype: "user", timestamp: "2026-11-01T09:00:00.000Z" }),
      JSON.stringify({ type: "user", timestamp: "2026-11-01T10:00:00.000Z", message: { content: "" } }),
    ].join("\n");
    expect(claudeCodeAdapter.activity!(text)).toEqual([{ timestamp: "2026-11-01T10:00:00.000Z", human: true }]);
  });

  it("COV-4e a user turn with a non-object content block is not a human turn", () => {
    const text = JSON.stringify({ type: "user", timestamp: "2026-11-01T10:00:00.000Z", message: { content: [""] } });
    expect(claudeCodeAdapter.activity!(text)).toEqual([{ timestamp: "2026-11-01T10:00:00.000Z", human: false }]);
  });
});

describe("COV-5 pace: an offset change in the middle of a local hour", () => {
  // St. John's sprang forward at 00:01 local on 2010-03-14 (00:01 NST -03:30 -> 01:01 NDT -02:30),
  // so the hour that starts at local 00:00 lasts 1 minute of real time, not 60.
  const opts: PaceOptions = {
    timeZone: "America/St_Johns",
    gapMinutes: { low: 10, central: 20, high: 30 },
    breakMinutes: 15,
    lateNight: { startHour: 0, endHour: 1 },
  };
  const events: ActivityEvent[] = [];
  // 03:30Z is local 00:00 NST; one event every 5 minutes to 05:00Z (local 02:30 NDT).
  for (let t = Date.parse("2010-03-14T03:30:00.000Z"), i = 0; t <= Date.parse("2010-03-14T05:00:00.000Z"); t += 300_000, i++) {
    events.push({ timestamp: new Date(t).toISOString(), human: i === 0 });
  }

  it("COV-5a counts only the real minute before the jump as local hour 0", () => {
    const days = paceDays(events, opts);
    expect(days.map((d) => d.date)).toEqual(["2010-03-14"]);
    const d = days[0]!;
    expect(d.activeMinutes.central).toBe(90);
    expect(d.lateNightMinutes).toBe(1);
    expect(d.firstHour).toBe(0);
    expect(d.lastHour).toBe(2);
  });
});

describe("COV-6 receipt with no usage", () => {
  const input = { estimate: estimate([], params), params, windowLabel: "all time" };

  it("COV-6a an empty estimate has no span, so the card falls back to the window label", () => {
    expect(input.estimate.span).toBeNull();
    const svg = receiptSvg(input);
    expect(svg).toContain("all time");
    expect(svg).not.toContain("→");
  });

  it("COV-6b a zero total gives a 0% cache share, not NaN", () => {
    const post = linkedInPost(input);
    expect(post).toContain("0% of it came from");
    expect(post).not.toContain("NaN");
  });

  it("COV-6c share line wording for all time and since-date windows", () => {
    expect(shareLine(input)).toMatch(/^All my Claude Code use so far came to about /);
    expect(shareLine({ ...input, windowLabel: "since 2026-10-01" })).toMatch(/^My Claude Code use since 2026-10-01 came to /);
    expect(shareLine({ ...input, sample: true })).toMatch(/^\(Sample data\) All of a sample's Claude Code use came to /);
  });
});
