import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUsage } from "../src/usage.js";

// usage.ts pulls in the dashboard, which imports the built web page as text (esbuild's loader in
// the real build). Vite can't import .html, so hand it the same built file as a string; --demo
// reads its sample rows from it. `npm test` builds the page before vitest runs.
vi.mock("../../web/dist/ccwatts.html", async () => {
  const { readFileSync: read } = await import("node:fs");
  return { default: read(new URL("../../web/dist/ccwatts.html", import.meta.url), "utf8") };
});

// CCW-M4.3 pace.jsonl in the CLI: opt-in, 0600, never written for --path, --demo or
// --no-history, and history.jsonl unchanged by it. Synthetic logs only: empty content, made-up
// paths, past dates.

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ccwatts-pace-"));
  dirs.push(d);
  return d;
};

const saved = { home: process.env.CCWATTS_HOME, claude: process.env.CLAUDE_CONFIG_DIR };
const restore = (key: "CCWATTS_HOME" | "CLAUDE_CONFIG_DIR", value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
beforeEach(() => {
  delete process.env.CCWATTS_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
});
afterEach(() => {
  restore("CCWATTS_HOME", saved.home);
  restore("CLAUDE_CONFIG_DIR", saved.claude);
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** A human turn then a few assistant responses, `step` minutes apart, on one UTC day. */
function session(date: string, id: string, start: string, count: number, step = 5): string {
  const [h, m] = start.split(":").map(Number) as [number, number];
  const at = (i: number) => {
    const t = new Date(Date.UTC(2026, 0, 1, h, m + i * step));
    return `${date}T${t.toISOString().slice(11, 19)}.000Z`;
  };
  const out = [JSON.stringify({ type: "user", timestamp: at(0), cwd: "/home/dev/code/alpha", message: { role: "user", content: "" } })];
  for (let i = 1; i <= count; i++) {
    out.push(
      JSON.stringify({
        type: "assistant",
        timestamp: at(i),
        cwd: "/home/dev/code/alpha",
        requestId: `req_${id}${i}`,
        message: {
          id: `msg_${id}${i}`,
          model: "claude-opus-4-6",
          role: "assistant",
          content: [],
          usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 100 },
        },
      }),
    );
  }
  return out.join("\n") + "\n";
}

/** A home with ~/.ccwatts and a Claude config dir holding one log; env points at both. */
function setup() {
  const h = tmp();
  const data = join(h, ".ccwatts");
  const projects = join(h, "claude", "projects", "alpha");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "s1.jsonl"), session("2026-10-05", "A", "09:00", 6));
  process.env.CCWATTS_HOME = data;
  process.env.CLAUDE_CONFIG_DIR = join(h, "claude");
  return { h, data, projects, pace: join(data, "pace.jsonl"), history: join(data, "history.jsonl") };
}

/** The PACE-3b checks, on the file as written. */
function expectCountsOnly(text: string) {
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d/);
  expect(text).not.toMatch(/[+-]\d{2}:?\d{2}\b/);
  expect(text).not.toMatch(/\dZ\b/);
  expect(text).not.toMatch(/[A-Z][a-z]+\/[A-Z]/);
  expect(text).not.toContain("/home/dev");
  expect(text).not.toContain("alpha");
  const rows = text.split("\n").filter(Boolean).slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
  for (const row of rows) {
    for (const k of ["firstHour", "lastHour"]) {
      const v = row[k];
      if (v !== null) expect(Number.isInteger(v), `${k}=${String(v)}`).toBe(true);
    }
  }
}

describe("CCW-M4.3 pace.jsonl (PACE-3f)", () => {
  it("PACE-3f a plain run writes history but no pace.jsonl", async () => {
    const s = setup();
    await loadUsage({});
    expect(existsSync(s.history)).toBe(true);
    expect(existsSync(s.pace)).toBe(false);
  });

  it("PACE-3f pace: true creates pace.jsonl with mode 0600, counts only", async () => {
    const s = setup();
    const usage = await loadUsage({ pace: true });
    expect(existsSync(s.pace)).toBe(true);
    if (process.platform !== "win32") expect(statSync(s.pace).mode & 0o777).toBe(0o600);
    const text = readFileSync(s.pace, "utf8");
    const [header, ...rows] = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(header).toMatchObject({ schema: 1, kind: "daily-pace" });
    expect(rows.map((r) => r.date)).toEqual(["2026-10-05"]);
    expectCountsOnly(text);
    expect(usage.pace.map((d) => d.date)).toEqual(["2026-10-05"]);
  });

  it("PACE-3f once pace.jsonl exists, later plain runs keep it up to date", async () => {
    const s = setup();
    await loadUsage({ pace: true });
    writeFileSync(join(s.projects, "s2.jsonl"), session("2026-10-20", "B", "14:00", 4));
    await loadUsage({});
    const text = readFileSync(s.pace, "utf8");
    expect(text).toContain('"2026-10-05"');
    expect(text).toContain('"2026-10-20"');
    expectCountsOnly(text);
    // Deleting the logs loses no stored days.
    rmSync(join(s.projects, "s1.jsonl"));
    await loadUsage({});
    expect(readFileSync(s.pace, "utf8")).toContain('"2026-10-05"');
  });

  it("PACE-3f --path, --demo and --no-history never create pace.jsonl", async () => {
    for (const flag of ["path", "demo", "noHistory"] as const) {
      const s = setup();
      await loadUsage(flag === "path" ? { path: s.projects, pace: true } : { [flag]: true, pace: true });
      expect(existsSync(s.pace), flag).toBe(false);
    }
  });

  it("PACE-3f --path, --demo and --no-history leave an existing pace.jsonl byte for byte", async () => {
    const s = setup();
    await loadUsage({ pace: true });
    const before = readFileSync(s.pace);
    writeFileSync(join(s.projects, "s2.jsonl"), session("2026-10-20", "B", "14:00", 4));
    for (const opts of [{ path: s.projects, pace: true }, { demo: true, pace: true }, { noHistory: true, pace: true }, { path: s.projects }, { demo: true }, { noHistory: true }]) {
      await loadUsage(opts);
      expect(readFileSync(s.pace).equals(before), JSON.stringify(Object.keys(opts))).toBe(true);
    }
  });

  it("PACE-3f no logs: pace: true writes nothing", async () => {
    const s = setup();
    rmSync(join(s.projects, "s1.jsonl"));
    await loadUsage({ pace: true });
    expect(existsSync(s.pace)).toBe(false);
  });

  it("PACE-3f history.jsonl is byte-identical with or without pace", async () => {
    const a = setup();
    await loadUsage({});
    const plain = readFileSync(a.history);
    const b = setup();
    await loadUsage({ pace: true });
    expect(existsSync(b.pace)).toBe(true);
    expect(readFileSync(b.history).equals(plain)).toBe(true);
  });
});
