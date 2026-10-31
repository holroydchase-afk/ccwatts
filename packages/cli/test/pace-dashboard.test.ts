import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultPaceOptions, paceMethod, samplePaceDays, serializePaceHistory } from "@ccwatts/core";

// CCW-M4.5 PACE-WEB3: `ccwatts dashboard` embeds pace days only when pace.jsonl exists (opt-in).
// Without it the page shows the "Run `ccwatts pace`" note (checked in web/test/pace-web.test.ts)
// and the payload has no pace days. Synthetic logs and a temp CCWATTS_HOME only.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "ccwatts-pdash-"));
const bin = join(work, "cli.mjs");

beforeAll(async () => {
  await build({
    entryPoints: [join(root, "packages/cli/src/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bin,
    loader: { ".html": "text" },
    alias: { "@ccwatts/core": join(root, "packages/core/src/index.ts") },
    logLevel: "silent",
  });
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
function withLogs() {
  const h = join(work, `home-${n++}`);
  const projects = join(h, "claude", "projects", "alpha");
  mkdirSync(projects, { recursive: true });
  const start = Date.now() - 40 * 60_000;
  const at = (i: number) => new Date(start + i * 5 * 60_000).toISOString();
  const lines = [JSON.stringify({ type: "user", timestamp: at(0), cwd: "/home/dev/code/alpha", message: { role: "user", content: "" } })];
  for (let i = 1; i <= 6; i++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: at(i),
        cwd: "/home/dev/code/alpha",
        requestId: `req_D${i}`,
        message: { id: `msg_D${i}`, model: "claude-opus-4-6", role: "assistant", content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 100 } },
      }),
    );
  }
  writeFileSync(join(projects, "s1.jsonl"), lines.join("\n") + "\n");
  const data = join(h, ".ccwatts");
  return { h, data, env: { PATH: process.env.PATH ?? "", TZ: "UTC", HOME: h, CCWATTS_HOME: data, CLAUDE_CONFIG_DIR: join(h, "claude") } };
}

function dashboard(env: Record<string, string>, extra: string[] = []) {
  const r = spawnSync(process.execPath, [bin, "dashboard", "--no-open", ...extra], { encoding: "utf8", cwd: work, env });
  expect(r.status, r.stderr).toBe(0);
  const html = readFileSync(join(env.CCWATTS_HOME!, "dashboard.html"), "utf8");
  const slot = /<script id="ccwatts-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}";
  return { html, payload: JSON.parse(slot) as { mode: string; pace?: unknown[]; paceOff?: string } };
}

const PACE_KEYS = ["activeMinutes", "agentMinutes", "date", "firstHour", "lastHour", "lateNightMinutes", "longestStretchMinutes"];

describe("CCW-M4.5 dashboard pace is opt-in (PACE-WEB3)", () => {
  it("PACE-WEB3 without pace.jsonl: no pace days embedded, no pace.jsonl created, opt-in note on the page", () => {
    const s = withLogs();
    const { html, payload } = dashboard(s.env);
    expect(payload.mode).toBe("dashboard");
    expect(payload.pace ?? []).toEqual([]);
    expect(existsSync(join(s.data, "pace.jsonl"))).toBe(false);
    expect(html).toMatch(/id="pace-optin"[^>]*>[\s\S]*ccwatts pace/);
  });

  it("PACE-WEB3 with pace.jsonl: embeds its days (and today's from the logs), PaceDay keys only, no zone or times", () => {
    const s = withLogs();
    mkdirSync(s.data, { recursive: true });
    const stored = samplePaceDays("2026-09-30").slice(-5);
    writeFileSync(join(s.data, "pace.jsonl"), serializePaceHistory(stored, paceMethod(defaultPaceOptions("UTC"))), { mode: 0o600 });
    const { payload } = dashboard(s.env);
    const pace = (payload.pace ?? []) as { date: string }[];
    for (const d of stored) expect(pace.find((p) => p.date === d.date), d.date).toEqual(d);
    const recent = [40, 10].map((m) => new Date(Date.now() - m * 60_000).toISOString().slice(0, 10));
    expect(pace.some((p) => recent.includes(p.date))).toBe(true);
    for (const d of pace) expect(Object.keys(d).sort()).toEqual(PACE_KEYS);
    const raw = JSON.stringify(payload.pace);
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(raw).not.toMatch(/UTC|timeZone/);
  });
});

describe("CCW-M4.5 dashboard pace notes (PS-R12, PS-R13)", () => {
  function withPaceFile() {
    const s = withLogs();
    mkdirSync(s.data, { recursive: true });
    writeFileSync(join(s.data, "pace.jsonl"), serializePaceHistory(samplePaceDays("2026-09-30").slice(-5), paceMethod(defaultPaceOptions("UTC"))), { mode: 0o600 });
    return s;
  }

  for (const flag of [["--no-history"], ["--path", "PROJECTS"]]) {
    it(`PS-R12 dashboard ${flag[0]} with pace.jsonl: no pace embedded, and the page says pace is skipped, not off`, () => {
      const s = withPaceFile();
      const args = flag.map((a) => (a === "PROJECTS" ? join(s.h, "claude", "projects") : a));
      const { html, payload } = dashboard(s.env, args);
      expect(payload.pace).toBeUndefined();
      expect(payload.paceOff).toBe("skipped");
      expect(html).toMatch(/id="pace-skipped"[^>]*>[^<]*skipped with --path or --no-history/);
    });
  }

  it("PS-R13 dashboard with an unreadable pace.jsonl embeds no pace (so no 'No active time' message)", () => {
    const s = withLogs();
    mkdirSync(join(s.data, "pace.jsonl"), { recursive: true }); // a folder: reading it fails with EISDIR
    const { payload } = dashboard(s.env);
    expect(payload.pace).toBeUndefined();
    expect(payload.paceOff).toBe("unreadable");
  });

  it("PS-R13 dashboard --demo with pace.jsonl writes no dashboard at all", () => {
    const s = withPaceFile();
    const r = spawnSync(process.execPath, [bin, "dashboard", "--demo", "--no-open"], { encoding: "utf8", cwd: work, env: s.env });
    expect(r.status).toBe(1);
    expect(existsSync(join(s.data, "dashboard.html"))).toBe(false);
  });

  it("PS-R12 without pace.jsonl and with --no-history, it's still the plain opt-in note (paceOff unset)", () => {
    const s = withLogs();
    const { payload } = dashboard(s.env, ["--no-history"]);
    expect(payload.pace).toBeUndefined();
    expect(payload.paceOff).toBeUndefined();
  });
});
