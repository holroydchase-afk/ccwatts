import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultParams, type PaceWeek } from "@ccwatts/core";
import { pace as renderPace, paceShareLine } from "../src/render.js";

// CCW-M4.4 `ccwatts pace`, end to end: bundle the CLI as cli.test.ts does and run it in a
// throwaway home. Synthetic logs only: empty content, made-up paths, times relative to now.

const root = fileURLToPath(new URL("../../../", import.meta.url));
// The temp prefix must not contain the word "pace": receipt prints the card path, and PACE-4 scans for \bpace\b.
const work = mkdtempSync(join(tmpdir(), "ccwatts-pcli-"));
const bin = join(work, "cli.mjs");
const VERSION = defaultParams.version;

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
function home() {
  const dir = join(work, `home-${n++}`);
  mkdirSync(dir);
  return dir;
}

// Local time of the run: UTC, unless now is in the first hour of a Monday (then UTC+2), so the
// fixture's 40 minutes always sit inside this local week.
const now = new Date();
const TZ = now.getUTCDay() === 1 && now.getUTCHours() < 1 ? "Etc/GMT-2" : "UTC";

function cli(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: work, env: { PATH: process.env.PATH ?? "", TZ, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A human turn, then assistant responses every 5 minutes: 40 to 10 minutes before now. */
function sessionLog(): string {
  const start = now.getTime() - 40 * 60_000;
  const at = (i: number) => new Date(start + i * 5 * 60_000).toISOString();
  const lines = [JSON.stringify({ type: "user", timestamp: at(0), cwd: "/home/dev/code/alpha", message: { role: "user", content: "" } })];
  for (let i = 1; i <= 6; i++) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: at(i),
        cwd: "/home/dev/code/alpha",
        requestId: `req_P${i}`,
        message: {
          id: `msg_P${i}`,
          model: "claude-opus-4-6",
          role: "assistant",
          content: [],
          usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 100 },
        },
      }),
    );
  }
  return lines.join("\n") + "\n";
}

/** A home with one synthetic session log; env points HOME, CCWATTS_HOME and CLAUDE_CONFIG_DIR into it. */
function withLogs() {
  const h = home();
  const projects = join(h, "claude", "projects", "alpha");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "s1.jsonl"), sessionLog());
  const data = join(h, ".ccwatts");
  return { h, data, projects, pace: join(data, "pace.jsonl"), env: { HOME: h, CCWATTS_HOME: data, CLAUDE_CONFIG_DIR: join(h, "claude") } };
}

const H = String.raw`\d+(?:\.\d)?`;
/** "About 33 active hours (range 29 – 36)": central first, en dash for the range (UX-R34). */
const LEAD = String.raw`[Aa]bout ${H} active hours \(range ${H} – ${H}\)`;
/** UX-R41: the lead names its week first. */
const LABELLED = String.raw`(?:Week of [A-Z][a-z]{2} \d{1,2}|This week so far): ${LEAD}`;
const BANNED = /burnout|health|score|diagnos/i;

describe("CCW-M4.4 ccwatts pace --demo (PACE-C1)", () => {
  it("PACE-C1 is labeled as sample data and leads with this week's active hours as a range", () => {
    const h = home();
    const r = cli(["pace", "--demo"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code, r.err).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toMatch(/Sample data \(synthetic\), not your usage\./);
    // UX-R35/R36: the header reads like other commands, and the current week is "(partial)".
    expect(lines[2]).toMatch(new RegExp(`^ccwatts v\\S+ · method v${VERSION.replace(/\./g, "\\.")} · pace, week of [A-Z][a-z]{2} \\d{1,2}(?: \\(partial\\))?$`));
    expect(r.out).toMatch(new RegExp(`^  ${LABELLED}, `, "m"));
  });

  it("UX-R31 says days off, never rest days, and counts active days so far", () => {
    const r = cli(["pace", "--demo"], { HOME: home(), NO_COLOR: "1" });
    expect(r.out).not.toMatch(/rest day/i);
    expect(r.out).toMatch(/active \d of \d days\./); // UX-R40: the lead's label already says "so far"
    expect(r.out).not.toMatch(/days so far/);
    expect(r.out).not.toMatch(/so far\)/);
  });

  it("UX-R33 agent time reads as agent-only work", () => {
    const r = cli(["pace", "--demo"], { HOME: home(), NO_COLOR: "1" });
    expect(r.out).toMatch(new RegExp(`^  Agents worked another ${H} – ${H} hours on their own\\.$`, "m"));
    expect(r.out).not.toMatch(/agents alone|also ran/i);
  });

  it("UX-R32 compares with numbers from your own earlier weeks, not a judgment", () => {
    const r = cli(["pace", "--demo"], { HOME: home(), NO_COLOR: "1" });
    expect(r.out).toMatch(/^  Past 10pm: \d+h(?: \d+m)?, vs \S+(?: \S+)? to \S+(?: \S+)? in (?:your last 3 weeks|the 2 weeks before)\.$/m);
    expect(r.out).not.toMatch(/usual|more time|more active/i);
  });

  it("UX-R30 every line of pace output fits 80 columns", () => {
    const s = withLogs();
    for (const r of [cli(["pace", "--demo"], { HOME: home(), NO_COLOR: "1" }), cli(["pace"], { ...s.env, NO_COLOR: "1" }), cli(["--help"], { HOME: home() })]) {
      expect(r.code, r.err).toBe(0);
      for (const line of r.out.split("\n")) expect(line.length, line).toBeLessThanOrEqual(80);
    }
  });

  it("PACE-C1 shows a four-week table", () => {
    const r = cli(["pace", "--demo"], { HOME: home() });
    const lines = r.out.split("\n");
    const head = lines.findIndex((l) => /Week of/.test(l));
    expect(head, r.out).toBeGreaterThan(-1);
    expect(lines[head]).toMatch(/Active/);
    expect(lines[head]).toMatch(/Days off/);
    expect(lines[head]).toMatch(/Agent-only \(h\)/);
    expect(lines[head]).not.toMatch(/Rest days|Agents alone/);
    const rows = lines.slice(head + 1).filter((l) => /^\s*[A-Z][a-z]{2} \d{1,2}\b/.test(l));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^\s*[A-Z][a-z]{2} \d{1,2} \(partial\)/);
  });

  it("PACE-C1 / PACE-5 the footer names the gaps (10/20/30 min) and the method version", () => {
    const r = cli(["pace", "--demo"], { HOME: home() });
    expect(r.out).toMatch(/10\/20\/30 min/);
    expect(r.out).toMatch(new RegExp(`Method v?${VERSION.replace(/\./g, "\\.")}`, "i"));
    expect(r.out).toMatch(/not a measurement/i);
    expect(r.out).toMatch(/Past 10pm and the longest stretch use the 20-min gap\./); // UX-R38, UX-R42
    expect(r.out).toMatch(/A day off has under 15 active minutes\./);
  });

  it("PACE-C1 writes nothing to CCWATTS_HOME and doesn't offer the saved-file line", () => {
    const h = home();
    const r = cli(["pace", "--demo"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(0);
    expect(existsSync(join(h, ".ccwatts"))).toBe(false);
    expect(r.out).not.toMatch(/Saved to/);
  });
});

describe("CCW-M4.4 ccwatts pace on your logs (PACE-C2)", () => {
  it("PACE-C2 creates pace.jsonl (0600) and says where, without the full home path", () => {
    const s = withLogs();
    const r = cli(["pace"], s.env);
    expect(r.code, r.err).toBe(0);
    expect(existsSync(s.pace)).toBe(true);
    if (process.platform !== "win32") expect(statSync(s.pace).mode & 0o777).toBe(0o600);
    expect(r.out).toMatch(/Saved to .*pace\.jsonl.*Delete it any time/s);
    expect(r.out).not.toContain(s.h);
    expect(r.out).not.toMatch(/sample data/i);
    expect(r.out).toMatch(new RegExp(LEAD));
    // UX-R32: one week of history is no usual, so there is no comparison line.
    expect(r.out).not.toMatch(/ vs .* in your last/);
  });

  it("PACE-C2 --no-history and --path don't write pace.jsonl", () => {
    const s = withLogs();
    expect(cli(["pace", "--no-history"], s.env).code).toBe(0);
    expect(existsSync(s.pace)).toBe(false);
    expect(cli(["pace", "--path", s.projects], s.env).code).toBe(0);
    expect(existsSync(s.pace)).toBe(false);
  });
});

describe("CCW-M4.4 ccwatts pace --json (PACE-C3)", () => {
  for (const which of ["demo", "logs"] as const) {
    it(`PACE-C3 (${which}) has method (with gapMinutes) and weeks; no zone, no time of day`, () => {
      const s = withLogs();
      const env = { ...s.env, TZ: "Europe/London" };
      const r = cli(which === "demo" ? ["pace", "--demo", "--json"] : ["pace", "--json"], env);
      expect(r.code, r.err).toBe(0);
      const j = JSON.parse(r.out) as Record<string, unknown>;
      expect(JSON.stringify(j.method)).toContain(VERSION);
      // UX-R39: gapMinutes lives only inside method.
      expect((j.method as Record<string, unknown>).gapMinutes).toEqual({ low: 10, central: 20, high: 30 });
      expect(j.gapMinutes).toBeUndefined();
      expect(Array.isArray(j.weeks)).toBe(true);
      expect((j.weeks as unknown[]).length).toBe(4);
      expect(Boolean(j.sample)).toBe(which === "demo");
      expect(r.out).not.toMatch(/Europe|London/);
      expect(r.out).not.toMatch(/[A-Z][a-z]+\/[A-Z]/); // no IANA zone of any kind
      expect(r.out).not.toMatch(/\d{4}-\d{2}-\d{2}T\d/);
      expect(r.out).not.toContain("\u001b[");
      expect(r.out).not.toContain(s.h);
    });
  }
});

describe("CCW-M4.4 ccwatts pace --export csv (PACE-C4)", () => {
  it("PACE-C4 prints a header and one row per day, counts and whole hours only", () => {
    const r = cli(["pace", "--demo", "--export", "csv"], { HOME: home(), FORCE_COLOR: "1" });
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain("\u001b[");
    expect(r.out).not.toMatch(/sample data/i); // CSV stays parseable
    const [header, ...rows] = r.out.trim().split("\n");
    const cols = header!.split(",");
    expect(cols[0]).toBe("date");
    expect(cols).toHaveLength(11);
    for (const word of ["active", "agent", "late", "stretch", "first", "last"]) expect(header!.toLowerCase()).toContain(word);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const row of rows) {
      const cells = row.split(",");
      expect(cells, row).toHaveLength(11);
      expect(cells[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row).not.toMatch(/T\d{2}:/);
    }
  });

  it("PACE-C4 works on your logs too", () => {
    const s = withLogs();
    const r = cli(["pace", "--export", "csv"], s.env);
    expect(r.code, r.err).toBe(0);
    const [header, ...rows] = r.out.trim().split("\n");
    expect(header!.split(",")[0]).toBe("date");
    expect(rows).toHaveLength(1);
  });
});

describe("CCW-M4.4 ccwatts pace with no logs (PACE-C5)", () => {
  it("PACE-C5 prints the same friendly no-logs message as other commands and writes nothing", () => {
    const h = home();
    const r = cli(["pace"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toMatch(/No Claude Code logs yet/);
    expect(r.out).toContain("--demo");
    expect(existsSync(join(h, ".ccwatts", "pace.jsonl"))).toBe(false);
  });

  it("PACE-C5 --json gets the no_logs error and a non-zero exit, like other commands", () => {
    const r = cli(["pace", "--json"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).error).toBe("no_logs");
  });
});

describe("CCW-M4.4 receipt keeps pace out unless asked (PACE-4)", () => {
  const PACE_WORDS = /\bpace\b|active hours|\blate\b|late night|10pm|past 10|stretch|rest day|days? off|agents alone|agent-only|on their own/i; // \b: SVG fonts say "monospace"

  it("PACE-4a receipt has no pace in the share line, post or card, even with pace.jsonl kept", () => {
    const s = withLogs();
    expect(cli(["pace"], s.env).code).toBe(0); // pace.jsonl now exists
    const out = join(s.h, "card.svg");
    const r = cli(["receipt", "--since", "all", "--out", out], s.env);
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toMatch(PACE_WORDS);
    const svg = readFileSync(out, "utf8");
    expect(svg).not.toMatch(PACE_WORDS);
  });

  it("PACE-4b receipt --share-pace adds one coarse line to the share line and post only", () => {
    const s = withLogs();
    expect(cli(["pace"], s.env).code).toBe(0);
    const out = join(s.h, "card.svg");
    const r = cli(["receipt", "--since", "all", "--share-pace", "--out", out], s.env);
    expect(r.code, r.err).toBe(0);
    const line = new RegExp(`^.*Pace this week: ${LEAD}\\.`, "gm");
    const hits = r.out.match(line) ?? [];
    expect(hits, r.out).toHaveLength(2);
    const [shareBlock, postBlock] = r.out.split(/Ready-to-paste post:/);
    expect(shareBlock!.split(/Card written/)[0]).toMatch(/Pace this week:/);
    expect(postBlock).toMatch(/Pace this week:/);
    // Nothing finer than the weekly range: no late nights, hours of day, stretches or days off.
    const rest = r.out.replace(line, "");
    expect(rest).not.toMatch(PACE_WORDS);
    expect(r.out).not.toMatch(/\b\d{1,2}\s?(am|pm)\b/i);
    expect(readFileSync(out, "utf8")).not.toMatch(PACE_WORDS);
  });
});

describe("CCW-M4.4 receipt --share-pace on a fresh home (PS-R10, PS-R11)", () => {
  it("PS-R10 receipt --share-pace with logs but no pace.jsonl leaves no pace.jsonl", () => {
    const s = withLogs();
    const r = cli(["receipt", "--since", "all", "--share-pace", "--out", join(s.h, "card.svg")], s.env);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Pace this week:/);
    expect(existsSync(s.pace)).toBe(false);
  });

  const week = (low: number, central: number, high: number): PaceWeek => ({
    start: "2026-10-26",
    activeHours: { low, central, high },
    agentHours: { low: 0, central: 0, high: 0 },
    lateNightHours: 0,
    longestStretchMinutes: 0,
    restDays: 0,
    daysCounted: 1,
    weekendShare: 0,
    latestHour: null,
  });

  it("PS-R11 the share line still reads well when low equals high, and says so when there's nothing yet", () => {
    expect(paceShareLine(week(33.2, 33.2, 33.2))).toBe("Pace this week: about 33 active hours (range 33 – 33).");
    expect(paceShareLine(week(29, 33, 36))).toBe("Pace this week: about 33 active hours (range 29 – 36).");
    expect(paceShareLine(week(0, 0, 0))).toBe("Pace this week: no active hours yet.");
  });
});

describe("CCW-M4.4 pace comparison copy (UX-R32)", () => {
  const w = (start: string, central: number, late: number, extra: Partial<PaceWeek> = {}): PaceWeek => ({
    start,
    activeHours: { low: central - 2, central, high: central + 2 },
    agentHours: { low: 0, central: 0, high: 0 },
    lateNightHours: late,
    longestStretchMinutes: 90,
    restDays: 1,
    daysCounted: 7,
    weekendShare: 0,
    latestHour: 18,
    ...extra,
  });
  const view = (weeks: PaceWeek[], versus: { later: boolean; longer: boolean } | null) => ({ weeks, versus, today: "2026-10-31", savedTo: null });
  const prior = [w("2026-10-19", 20, 0.5), w("2026-10-12", 22, 1), w("2026-10-05", 24, 0.75)];

  it("UX-R32 the longer line gives this week's hours and the range of your own earlier weeks", () => {
    const out = renderPace(view([w("2026-10-26", 33, 0, { daysCounted: 6 }), ...prior], { later: false, longer: true }), defaultParams);
    expect(out).toMatch(/^  Active hours: about 33, vs 20 to 24 in your last 3 weeks\.$/m);
    expect(out).not.toMatch(/Past 10pm: /);
    expect(out).not.toMatch(/usual/i);
  });

  it("UX-R32 the later line gives time past 10pm and the range of your own earlier weeks", () => {
    const out = renderPace(view([w("2026-10-26", 21, 3.95, { daysCounted: 6 }), ...prior], { later: true, longer: false }), defaultParams);
    expect(out).toMatch(/^  Past 10pm: 3h 57m, vs 30m to 1h in your last 3 weeks\.$/m);
    expect(out).not.toMatch(/Active hours: /);
  });

  it("UX-R40 with 2 days this week: leads with last full week, then this week so far, compared with the weeks before it", () => {
    const now = w("2026-10-26", 13, 0, { daysCounted: 2, restDays: 0 });
    const focus = w("2026-10-19", 33, 0, { agentHours: { low: 3, central: 4, high: 5 } });
    const older = [w("2026-10-12", 20, 0.5), w("2026-10-05", 22, 1)];
    const out = renderPace(view([now, focus, ...older], { later: false, longer: true }), defaultParams);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/· pace, week of Oct 19$/);
    const lead = lines.findIndex((l) => l.startsWith("  Week of Oct 19: about 33 active hours (range 31 – 35), "));
    expect(lead, out).toBe(2);
    const prose = lines.slice(2, lines.findIndex((l, i) => i > 2 && l === "")).join(" ");
    expect(prose).toMatch(/active 6 of 7 days\./);
    expect(lines).toContain("  This week so far: about 13 hours in 2 days.");
    expect(lines.indexOf("  This week so far: about 13 hours in 2 days.")).toBeGreaterThan(lead);
    expect(lines.indexOf("  Agents worked another 3.0 – 5.0 hours on their own.")).toBeGreaterThan(lines.indexOf("  This week so far: about 13 hours in 2 days."));
    expect(out).toMatch(/^  Active hours: about 33, vs 20 to 22 in the 2 weeks before\.$/m);
    for (const line of out.split("\n")) expect(line.length, line).toBeLessThanOrEqual(80);
  });

  it("UX-R40 with 4 days this week: the lead is this week so far, no second line", () => {
    const out = renderPace(view([w("2026-10-26", 21, 0, { daysCounted: 4, restDays: 0 }), ...prior], null), defaultParams);
    expect(out).toMatch(/^  This week so far: about 21 active hours \(range 19 – 23\), /m);
    expect(out).toMatch(/active 4 of 4 days\./);
    expect(out).not.toMatch(/hours in \d days/);
    expect(out.split("\n")[0]).toMatch(/· pace, week of Oct 26 \(partial\)$/);
  });

  it("UX-R32 nothing to compare with fewer than two earlier weeks", () => {
    const out = renderPace(view([w("2026-10-26", 33, 4, { daysCounted: 6 }), prior[0]!], null), defaultParams);
    expect(out).not.toMatch(/ vs /);
  });
});

describe("CCW-M4.4 help and copy (PACE-C6, PACE-C7)", () => {
  it("PACE-C6 --help lists pace and mentions pace.jsonl", () => {
    const r = cli(["--help"], { HOME: home() });
    expect(r.out).toMatch(/^\s+pace\s+Work rhythm: active hours, time past 10pm, days off \(opt-in(?:, local)?\)$/m); // UX-R37
    expect(r.out).toContain("pace.jsonl");
  });

  it("PACE-C7 pace output never diagnoses, scores or talks about health", () => {
    const s = withLogs();
    const outputs = [
      cli(["pace", "--demo"], { HOME: home() }),
      cli(["pace", "--demo", "--json"], { HOME: home() }),
      cli(["pace"], s.env),
      cli(["pace"], { HOME: home() }),
      cli(["--help"], { HOME: home() }),
    ];
    for (const r of outputs) {
      expect(r.out).not.toMatch(BANNED);
      expect(r.err).not.toMatch(BANNED);
    }
  });
});
