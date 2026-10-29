import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_VERSION, PLAYGROUND_URL, projectRef } from "@ccwatts/core";

// End-to-end: bundle the CLI the way tsup does, then run it as a user would, in a throwaway home.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const demo = join(root, "fixtures/claude-code/demo.jsonl");
const sample = join(root, "fixtures/claude-code/sample.jsonl");
const work = mkdtempSync(join(tmpdir(), "ccwatts-cli-"));
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
function home() {
  const dir = join(work, `home-${n++}`);
  mkdirSync(dir);
  return dir;
}

function cli(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: work, env: { PATH: process.env.PATH ?? "", ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// The no-logs line, before and after UX-R16 rewords it ("found" → "yet"), so the H4/H7/F1/F2 checks survive the rewording.
const NO_LOGS = /No Claude Code logs (found|yet)/;

describe("ccwatts CLI", () => {
  it("CCW-H1 --path doesn't write the sample into your history", () => {
    const h = home();
    const r = cli(["--path", demo, "--since", "all"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(0);
    expect(existsSync(join(h, ".ccwatts", "history.jsonl"))).toBe(false);
  });

  it("CCW-H1 --path shows only that file, not your stored history mixed in", () => {
    const h = home();
    const env = { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude") };
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    expect(cli(["--since", "all"], env).code).toBe(0); // seeds history from "your" logs
    expect(existsSync(join(h, ".ccwatts", "history.jsonl"))).toBe(true);

    const only = cli(["--path", demo, "--since", "all", "--json"], { HOME: home() });
    const mixed = cli(["--path", demo, "--since", "all", "--json"], env);
    expect(JSON.parse(mixed.out).tokens).toEqual(JSON.parse(only.out).tokens);
    expect(JSON.parse(mixed.out).responses).toBe(JSON.parse(only.out).responses);
  });

  it("CCW-H2 --version and -v print the version", () => {
    for (const flag of ["--version", "-v"]) {
      const r = cli([flag], { HOME: home() });
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe(`ccwatts ${APP_VERSION}`);
    }
  });

  it("CCW-H2 the version in code matches the published package", () => {
    const pkg = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("CCW-H3 an unknown option gets a plain message and a pointer to --help", () => {
    const r = cli(["--bogus"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toContain(`Unknown option "--bogus"`);
    expect(r.err).toContain("ccwatts --help");
    expect(r.err).not.toContain("positional argument");
  });

  it("CCW-H3 an option missing its value says which one", () => {
    const r = cli(["--since"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toContain("--since needs a value");
    expect(r.err).toContain("ccwatts --help");
  });

  it("CCW-H4 no logs: says where it looked, exits cleanly, writes nothing", () => {
    const h = home();
    const r = cli([], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(NO_LOGS);
    expect(existsSync(join(h, ".ccwatts"))).toBe(false);
  });

  it("CCW-H4 dashboard with no logs and no history doesn't write an empty dashboard", () => {
    const h = home();
    const r = cli(["dashboard", "--no-open"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.out).toMatch(NO_LOGS);
    expect(existsSync(join(h, ".ccwatts", "dashboard.html"))).toBe(false);
  });

  it("CCW-H5 output never prints the full log path for --path", () => {
    const r = cli(["--path", demo, "--since", "all"], { HOME: home() });
    expect(r.out).not.toContain(root);
  });

  it("CCW-H7 --demo works with no logs at all, labeled as sample data, and leaves history alone", () => {
    const h = home();
    const r = cli(["--demo"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toMatch(/sample data/i);
    expect(r.out).toMatch(/Electricity\s+[\d.]+ kWh/);
    expect(r.out).not.toMatch(NO_LOGS);
    expect(r.out).not.toContain("Share: ccwatts receipt"); // receipt refuses sample data
    expect(existsSync(join(h, ".ccwatts"))).toBe(false);
  });

  it("CCW-H7 --demo --json is marked as sample and matches the demo fixture", () => {
    const demoJson = JSON.parse(cli(["--demo", "--json"], { HOME: home() }).out);
    const fromFile = JSON.parse(cli(["--path", demo, "--since", "all", "--json"], { HOME: home() }).out);
    expect(demoJson.sample).toBe(true);
    expect(demoJson.tokens).toEqual(fromFile.tokens);
  });

  it("CCW-H7 receipt --demo refuses, so nobody shares sample numbers as their own", () => {
    const r = cli(["receipt", "--demo"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/your own usage/);
    expect(r.err).toContain(PLAYGROUND_URL); // CCW-H8: the URL must survive the error printer's URL cutting
    expect(existsSync(join(work, "ccwatts-receipt.svg"))).toBe(false);
  });

  it("CCW-H7 the no-logs message offers --demo and the playground", () => {
    const r = cli([], { HOME: home() });
    expect(r.out).toContain("ccwatts --demo");
    expect(r.out).toContain("chaseholroyd.com/ccwatts");
  });

  // CCW-H8: error lines print a short reason (the error's code or name), never the raw message,
  // which for fs errors holds the full path of your home folder. Directories stand in for the
  // history file because chmod doesn't stop root (this container and many CI runners).
  function withLogs() {
    const h = home();
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    return { h, env: { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude") } };
  }

  it("CCW-H8 unreadable history: says why in one word, no full path, still estimates", () => {
    const { h, env } = withLogs();
    mkdirSync(join(h, ".ccwatts", "history.jsonl"), { recursive: true }); // reading it throws EISDIR
    const r = cli(["--since", "all"], env);
    expect(r.code).toBe(0);
    expect(r.err).toContain("Couldn't read history (EISDIR). Using current logs only.");
    expect(r.err).not.toContain(h);
    expect(r.out).toMatch(/Electricity\s+[\d.]+ k?Wh/);
  });

  it("CCW-H8 history that can't be saved: says why in one word, no full path, still estimates", () => {
    const { h, env } = withLogs();
    mkdirSync(join(h, ".ccwatts", "history.jsonl.tmp"), { recursive: true }); // read is fine (ENOENT), the temp write throws EISDIR
    const r = cli(["--since", "all"], env);
    expect(r.code).toBe(0);
    expect(r.err).not.toContain("Couldn't read history");
    expect(r.err).toContain("Couldn't save history (EISDIR). Continuing without it.");
    expect(r.err).not.toContain(h);
    expect(r.out).toMatch(/Electricity\s+[\d.]+ k?Wh/);
  });

  it("CCW-H8 history folder that is really a file: reason codes only, no full path", () => {
    const { h, env } = withLogs();
    writeFileSync(join(h, ".ccwatts"), ""); // CCWATTS_HOME is a regular file: read and mkdir both fail
    const r = cli(["--since", "all"], env);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/Couldn't read history \(ENOTDIR\)\. Using current logs only\./);
    expect(r.err).toMatch(/Couldn't save history \((EEXIST|ENOTDIR)\)\. Continuing without it\./);
    expect(r.err).not.toContain(h);
  });

  it("CCW-H8 dashboard --demo refuses and still shows the playground URL", () => {
    const r = cli(["dashboard", "--demo", "--no-open"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/your own usage/);
    expect(r.err).toContain(PLAYGROUND_URL);
  });

  it("CCW-H8 the no-logs message still shows the full playground URL", () => {
    const r = cli([], { HOME: home() });
    expect(r.out).toContain(PLAYGROUND_URL);
  });
});

// CCW-M2.6.2 day-one gaps (docs/reviews/2026-10-28-release-plan.md F1–F8). Synthetic counts only.
const usageLine = (id: string, ts: string, usage: { input: number; cacheWrite: number; cacheRead: number; output: number }) =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    cwd: "/synthetic/proj",
    requestId: `req_${id}`,
    message: {
      id: `msg_${id}`,
      model: "claude-opus-4-6",
      role: "assistant",
      content: [],
      usage: {
        input_tokens: usage.input,
        cache_creation_input_tokens: usage.cacheWrite,
        cache_read_input_tokens: usage.cacheRead,
        output_tokens: usage.output,
      },
    },
  });

function logDir(lines: string[]) {
  const dir = join(home(), "logs");
  mkdirSync(dir);
  writeFileSync(join(dir, "session.jsonl"), lines.join("\n") + "\n");
  return dir;
}

describe("ccwatts CLI day-one gaps (CCW-M2.6.2)", () => {
  it("CCW-F1: --path to a folder that doesn't exist says so (basename only) and exits 1", () => {
    const missing = join(work, "nope-not-here-f1");
    const r = cli(["--path", missing], { HOME: home() });
    const all = r.out + r.err;
    expect(r.code).toBe(1);
    expect(all).toMatch(/doesn't exist|does not exist/i);
    expect(all).toContain("nope-not-here-f1");
    expect(all).not.toContain(missing);
    expect(all).not.toContain(work);
    expect(all).not.toMatch(NO_LOGS);
  });

  it("CCW-F2: .jsonl files with no usage say files were found but had no Claude Code usage", () => {
    const dir = logDir([
      JSON.stringify({ type: "user", timestamp: "2026-10-01T10:00:00.000Z", cwd: "/synthetic/proj", message: { role: "user", content: "" } }),
      JSON.stringify({ type: "summary", leafUuid: "x" }),
    ]);
    const r = cli(["--path", dir, "--since", "all"], { HOME: home() });
    const all = r.out + r.err;
    expect(all).toMatch(/no Claude Code usage/i);
    expect(all).not.toMatch(NO_LOGS);
    expect(all).not.toContain(dir);
  });

  it("CCW-F3: --json with no logs prints a JSON error, no full paths, exit 1", () => {
    const h = home();
    const r = cli(["--json"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(1);
    let parsed: { error?: string } | undefined;
    expect(() => (parsed = JSON.parse(r.out))).not.toThrow();
    expect(parsed?.error).toBe("no_logs");
    expect(r.out).not.toContain(h);
    expect(r.out).not.toContain(work);
  });

  // One day of usage where input is a tiny but nonzero share of energy.
  const oneDay = () =>
    logDir([
      usageLine("F5a", "2026-10-01T10:00:00.000Z", { input: 3, cacheWrite: 20000, cacheRead: 400000, output: 3000 }),
      usageLine("F5b", "2026-10-01T11:00:00.000Z", { input: 2, cacheWrite: 10000, cacheRead: 300000, output: 2000 }),
    ]);

  it("CCW-F5: a single-day span prints the date once, not 'D to D'", () => {
    const r = cli(["--path", oneDay(), "--since", "all"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("2026-10-01");
    expect(r.out).not.toContain("2026-10-01 to 2026-10-01");
  });

  it("CCW-F5: a share above zero that rounds to 0 prints '<1%', not '0%'", () => {
    const r = cli(["--path", oneDay(), "--since", "all"], { HOME: home() });
    expect(r.code).toBe(0);
    const byType = r.out.split("\n").find((l) => l.includes("By type")) ?? "";
    expect(byType).toContain("input <1%");
    expect(byType).not.toMatch(/input 0%/);
  });

  it("CCW-F5: history with one recorded day says '1 day', not '1 days'", () => {
    const r = cli(["history", "--path", oneDay()], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\b1 day\b/);
    expect(r.out).not.toContain("1 days");
  });

  it("CCW-F5: history with a single week doesn't call it both lightest and heaviest", () => {
    const r = cli(["history", "--path", oneDay()], { HOME: home() });
    expect(r.code).toBe(0);
    const both = r.out.includes("Lightest week") && r.out.includes("Heaviest week");
    expect(both).toBe(false);
  });

  it("CCW-F6: --method links the write-up on GitHub, not a bare METHODOLOGY.md", () => {
    const r = cli(["--method"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/https:\/\/github\.com\/holroydchase-afk\/ccwatts\/\S*METHODOLOGY\.md/);
    expect(r.out).not.toMatch(/Full write-up: METHODOLOGY\.md\s*$/m);
  });

  it("CCW-F7: `ccwatts help` behaves like --help", () => {
    const help = cli(["--help"], { HOME: home() });
    const r = cli(["help"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: ccwatts");
    expect(r.out).toBe(help.out);
    expect(r.err).not.toContain("Unknown command");
  });
});


// UX-R6 (docs/reviews/2026-10-28-release-plan.md): bold in a terminal, nothing when piped.
// Tests can't open a real TTY, so FORCE_COLOR=1 stands in for one (the same switch chalk and Node use).
describe("ccwatts CLI color (UX-R6)", () => {
  const ESC = "\u001b[";

  it("UX-R6: FORCE_COLOR=1 bolds the headline number", () => {
    const r = cli(["--demo"], { HOME: home(), FORCE_COLOR: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\u001b\[1m[^\u001b]*\d[^\u001b]*k?Wh/);
  });

  it("UX-R6: piped output (the default here) has no ANSI codes", () => {
    for (const args of [["--demo"], ["--demo", "--by", "project"], ["history", "--demo"], ["--method"]]) {
      const r = cli(args, { HOME: home() });
      expect(r.out, args.join(" ")).not.toContain(ESC);
    }
  });

  it("UX-R6: NO_COLOR=1 means no ANSI codes", () => {
    const r = cli(["--demo"], { HOME: home(), NO_COLOR: "1" });
    expect(r.out).not.toContain(ESC);
  });

  it("UX-R6: --json is never colored, even with FORCE_COLOR=1", () => {
    const r = cli(["--demo", "--json"], { HOME: home(), FORCE_COLOR: "1" });
    expect(r.out).not.toContain(ESC);
    expect(() => JSON.parse(r.out)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// CCW-M2.6.4 harden: every core flow has a test and bad input is handled. Synthetic counts only.
// "RED" tests failed when written because the behavior was wrong; "coverage" tests pin flows that
// already worked but had no end-to-end test.
// ---------------------------------------------------------------------------------------------
const hLine = (id: string, ts: unknown, o: { cwd?: string; model?: string } = {}) =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    cwd: o.cwd ?? "/synthetic/proj",
    requestId: `req_${id}`,
    message: { id: `msg_${id}`, model: o.model ?? "claude-opus-4-6", usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } },
  });

/** A folder of .jsonl files: { "a.jsonl": "text", "sub/b.jsonl": "text" }. */
function logFiles(files: Record<string, string>) {
  const dir = join(home(), "logs");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function cliIn(args: string[], env: Record<string, string>, input: string) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: work, input, env: { PATH: process.env.PATH ?? "", ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("CCW-M2.6.4 CLI flows (coverage)", () => {
  it("coverage: --by with an unknown dimension says which ones exist and exits 1", () => {
    const r = cli(["--demo", "--by", "garbage"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toContain("--by must be one of: model, day, project, type");
  });

  it("coverage: --export to an unsupported format says csv only and exits 1", () => {
    const r = cli(["history", "--demo", "--export", "xlsx"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toContain("--export supports csv only");
  });

  it("coverage: --since garbage gets the plain message and exits 1", () => {
    const r = cli(["--demo", "--since", "garbage"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toContain(`Can't read --since "garbage"`);
  });

  it("coverage: the same response logged in two files counts once", () => {
    const one = hLine("dup", "2026-10-01T10:00:00.000Z");
    const dir = logFiles({ "a/s1.jsonl": one + "\n", "b/s2.jsonl": [one, hLine("other", "2026-10-01T11:00:00.000Z")].join("\n") + "\n" });
    const r = cli(["--path", dir, "--since", "all", "--json"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).responses).toBe(2);
  });

  it("coverage: an empty .jsonl file and malformed lines don't crash; good lines still count", () => {
    const dir = logFiles({ "empty.jsonl": "", "mixed.jsonl": ["{oops", hLine("a", "2026-10-01T10:00:00.000Z"), '{"type":"assistant"'].join("\n") });
    const r = cli(["--path", dir, "--since", "all", "--json"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).responses).toBe(1);
  });

  it("coverage: a log written with CRLF line endings reads the same as LF", () => {
    const lines = [hLine("a", "2026-10-01T10:00:00.000Z"), hLine("b", "2026-10-01T11:00:00.000Z")];
    const lf = cli(["--path", logFiles({ "s.jsonl": lines.join("\n") }), "--since", "all", "--json"], { HOME: home() });
    const crlf = cli(["--path", logFiles({ "s.jsonl": lines.join("\r\n") + "\r\n" }), "--since", "all", "--json"], { HOME: home() });
    expect(JSON.parse(crlf.out).tokens).toEqual(JSON.parse(lf.out).tokens);
    expect(JSON.parse(crlf.out).responses).toBe(2);
  });

  it("coverage: an unknown model is estimated with a Note, not dropped", () => {
    const r = cli(["--path", logFiles({ "s.jsonl": hLine("a", "2026-10-01T10:00:00.000Z", { model: "mystery-model-9" }) }), "--since", "all"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Note          Unknown model "mystery-model-9"');
  });

  it("coverage: a unicode project basename comes through intact in --by project and CSV", () => {
    const dir = logFiles({ "s.jsonl": hLine("a", "2026-10-01T10:00:00.000Z", { cwd: "/synthetic/项目-é🎉" }) });
    expect(cli(["--path", dir, "--since", "all", "--by", "project"], { HOME: home() }).out).toContain("项目-é🎉");
    expect(cli(["history", "--path", dir, "--export", "csv"], { HOME: home() }).out).toContain(",项目-é🎉,");
  });

  it("coverage: history --export csv prints a header, daily rows and the method version, no ANSI", () => {
    const r = cli(["history", "--path", demo, "--export", "csv"], { HOME: home(), FORCE_COLOR: "1" });
    expect(r.code).toBe(0);
    const lines = r.out.trim().split("\n");
    expect(lines[0]).toBe("date,model,project,responses,input,cache_write,cache_read,output,wh_low,wh_central,wh_high,method_version");
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines.slice(1)) expect(l).toMatch(/^\d{4}-\d{2}-\d{2},.*,\d+\.\d+\.\d+$/);
    expect(r.out).not.toContain("\u001b[");
  });

  it("coverage: a partly written last line in history.jsonl is skipped; history still prints", () => {
    const h = home();
    const env = { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude") };
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    expect(cli(["--since", "all"], env).code).toBe(0);
    const file = join(h, ".ccwatts", "history.jsonl");
    writeFileSync(file, readFileSync(file, "utf8") + '{"date":"2026-09-01","source":"claude-code","model":"claude-opus-4-6","tokens":{"inp');
    const r = cli(["history"], env);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Total\s+[\d.]+ k?Wh/);
  });

  it("coverage: receipt --out writes a 1200×627 SVG card and prints the share line", () => {
    const h = home();
    const out = join(h, "card.svg");
    const r = cli(["receipt", "--path", demo, "--since", "all", "--out", out], { HOME: h });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/method v\d/);
    const svg = readFileSync(out, "utf8");
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="627"');
    expect(svg).not.toContain(root);
  });

  it("coverage: dashboard writes an owner-only offline file with your rows and no full paths", () => {
    const h = home();
    const env = { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude") };
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    const r = cli(["dashboard", "--no-open"], env);
    expect(r.code).toBe(0);
    const file = join(h, ".ccwatts", "dashboard.html");
    const html = readFileSync(file, "utf8");
    expect(html).toContain('"mode":"dashboard"');
    expect(html).not.toContain("/home/dev"); // the fixture's cwd
    expect(html).not.toContain(h);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("coverage: statusline reads the transcript from stdin and prints one line with range and method", () => {
    const r = cliIn(["statusline"], { HOME: home() }, JSON.stringify({ transcript_path: sample }));
    expect(r.code).toBe(0);
    const lines = r.out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/this session \(range .+\) · method v\d/);
  });

  it("coverage: statusline with garbage stdin, no transcript, or a missing file prints a quiet line, exit 0", () => {
    for (const [input, want] of [
      ["not json", "no estimate yet"],
      ["{}", "waiting for the first response"],
      [JSON.stringify({ transcript_path: join(work, "missing.jsonl") }), "no estimate yet"],
    ] as const) {
      const r = cliIn(["statusline"], { HOME: home() }, input);
      expect(r.code, input).toBe(0);
      expect(r.out.trim(), input).toBe(`⚡ ccwatts: ${want}`);
      expect(r.err, input).toBe("");
    }
  });

  // Real EACCES needs a non-root user: root ignores chmod (this container and many CI runners), so
  // CCW-H8 covers read/write failures with directories instead. This runs only where chmod bites.
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")("coverage (non-root only): history.jsonl without read permission still estimates (EACCES)", () => {
    const h = home();
    const env = { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude") };
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    expect(cli(["--since", "all"], env).code).toBe(0);
    chmodSync(join(h, ".ccwatts", "history.jsonl"), 0o000);
    const r = cli(["--since", "all"], env);
    expect(r.code).toBe(0);
    expect(r.err).toContain("Couldn't read history (EACCES)");
    expect(r.err).not.toContain(h);
  });
});

describe("CCW-M2.6.4 CLI bad input (RED)", () => {
  it("HARDEN-1 RED: a log file that starts with a byte-order mark still counts its first line", () => {
    const dir = logFiles({ "s.jsonl": "﻿" + hLine("a", "2026-10-01T10:00:00.000Z") + "\n" });
    const r = cli(["--path", dir, "--since", "all", "--json"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).responses).toBe(1);
  });

  it("HARDEN-2 RED: a log line with an invalid timestamp is skipped: history doesn't crash, span stays a date", () => {
    const dir = logFiles({ "s.jsonl": [hLine("bad", "not-a-date"), hLine("ok", "2026-10-01T10:00:00.000Z")].join("\n") });
    const h = cli(["history", "--path", dir], { HOME: home() });
    expect(h.err).not.toContain("Invalid time value");
    expect(h.code).toBe(0);
    const s = cli(["--path", dir, "--since", "all"], { HOME: home() });
    expect(s.out).not.toContain("not-a-date");
  });

  it("HARDEN-3 RED: a corrupt row in history.jsonl (bad date) doesn't break `ccwatts history` for good", () => {
    const h = home();
    const env = { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude") };
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    expect(cli(["--since", "all"], env).code).toBe(0);
    const file = join(h, ".ccwatts", "history.jsonl");
    const bad = { date: "garbage", source: "claude-code", model: "claude-opus-4-6", projectId: null, projectName: null, responses: 1, tokens: { input: 1, cacheWrite: 1, cacheRead: 1, output: 1 } };
    writeFileSync(file, readFileSync(file, "utf8") + JSON.stringify(bad) + "\n");
    const r = cli(["history"], env);
    expect(r.err).not.toContain("Invalid time value");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Total\s+[\d.]+ k?Wh/);
  });

  it("HARDEN-4 RED: --since with a huge number gets the plain --since message, not 'Invalid time value'", () => {
    const r = cli(["--demo", "--since", "99999999999d"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).not.toContain("Invalid time value");
    expect(r.err).toContain("Can't read --since");
  });

  // Decided (coordinator, CCW-M2.6.4): responses dated more than 1 day after now are ignored, with a one-line note.
  it("HARDEN-5 RED: responses dated more than a day in the future are ignored with a note, and don't stretch history", () => {
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString(); // within a day: clock skew, still counted
    const dir = logFiles({ "s.jsonl": [hLine("ok", "2026-10-01T10:00:00.000Z"), hLine("soon", soon), hLine("future", "2099-01-01T00:00:00.000Z")].join("\n") });
    const s = cli(["--path", dir, "--since", "all"], { HOME: home() });
    expect(s.code).toBe(0);
    expect(s.out).not.toContain("2099");
    expect(s.out + s.err).toMatch(/Ignored 1 responses? dated in the future\./);
    expect(JSON.parse(cli(["--path", dir, "--since", "all", "--json"], { HOME: home() }).out).responses).toBe(2);
    const h = cli(["history", "--path", dir], { HOME: home() });
    expect(h.code).toBe(0);
    expect(h.out.split("\n").length).toBeLessThan(60);
    expect(h.out).not.toContain("2099");
  });

  it("HARDEN-6 RED: --export csv without `history` doesn't silently print the summary", () => {
    const r = cli(["--demo", "--export", "csv"], { HOME: home() });
    const exported = r.code === 0 && r.out.startsWith("date,model,project,");
    const refused = r.code === 1 && /history/.test(r.err);
    expect(exported || refused, `exit ${r.code}\n${r.out}${r.err}`).toBe(true);
  });

  it("HARDEN-7 RED: one response reads '1 response', not '1 responses'", () => {
    const r = cli(["--path", logFiles({ "s.jsonl": hLine("a", "2026-10-01T10:00:00.000Z") }), "--since", "all"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Based on\s+1 response,/);
  });

  it("HARDEN-8 RED: a project named like a spreadsheet formula can't run as one in the CSV", () => {
    const dir = logFiles({ "s.jsonl": ["=HYPERLINK(1)", "+SUM(1)", "-2+3", "@cmd"].map((p, i) => hLine(`f${i}`, "2026-10-01T10:00:00.000Z", { cwd: `/synthetic/${p}` })).join("\n") });
    const r = cli(["history", "--path", dir, "--export", "csv"], { HOME: home() });
    expect(r.code).toBe(0);
    const projects = r.out.trim().split("\n").slice(1).map((l) => l.split(",")[2]!.replace(/^"/, ""));
    expect(projects).toHaveLength(4);
    for (const p of projects) expect(p, p).not.toMatch(/^[=+\-@]/);
  });

  it("HARDEN-9 RED: a very long project basename doesn't blow the tables past a terminal's width", () => {
    const long = "p".repeat(200);
    const dir = logFiles({ "s.jsonl": hLine("a", "2026-10-01T10:00:00.000Z", { cwd: `/synthetic/${long}` }) });
    for (const args of [["--by", "project"], []]) {
      const r = cli(["--path", dir, "--since", "all", ...args], { HOME: home() });
      expect(r.code).toBe(0);
      for (const l of r.out.split("\n")) expect(l.length, `${args.join(" ")}: ${l.slice(0, 60)}…`).toBeLessThanOrEqual(120);
    }
  });

  it("HARDEN-10 RED: a session run at the filesystem root still gets a project label, not a blank", () => {
    const r = cli(["--path", logFiles({ "s.jsonl": hLine("a", "2026-10-01T10:00:00.000Z", { cwd: "/" }) }), "--since", "all", "--json"], { HOME: home() });
    expect(r.code).toBe(0);
    for (const p of JSON.parse(r.out).byProject) expect(p.key.trim()).not.toBe("");
  });

  it("HARDEN-11 RED: receipt --out into a folder that doesn't exist gets a plain message, not the raw fs error", () => {
    const h = home();
    const out = join(h, "no-such-folder", "card.svg");
    const r = cli(["receipt", "--path", demo, "--since", "all", "--out", out], { HOME: h });
    expect(r.code).toBe(1);
    expect(r.err).not.toContain("no such file or directory, open");
    expect(r.err).toContain("--out");
  });
});

describe("CCW-M2.6.4 ux-reviewer P2s (RED)", () => {
  it("UX-R14 RED: --path to one file with no usage says '<name> has no Claude Code usage.'", () => {
    const dir = logFiles({ "bad.jsonl": JSON.stringify({ type: "user", timestamp: "2026-10-01T10:00:00.000Z" }) + "\n" });
    const r = cli(["--path", join(dir, "bad.jsonl"), "--since", "all"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("bad.jsonl has no Claude Code usage.");
  });

  it("UX-R14 RED: grammar follows the count: one file in a folder is 'it', two are 'them'", () => {
    const junk = JSON.stringify({ type: "summary", leafUuid: "x" }) + "\n";
    const one = cli(["--path", logFiles({ "a.jsonl": junk }), "--since", "all"], { HOME: home() });
    expect(one.out).not.toMatch(/1 \.jsonl file\b.*\bin them\b/);
    const two = cli(["--path", logFiles({ "a.jsonl": junk, "b.jsonl": junk }), "--since", "all"], { HOME: home() });
    expect(two.out).toContain("Found 2 .jsonl files in logs, but no Claude Code usage in them.");
  });

  // UX-R15 (plain no-logs run exits 0, --json exits 1) is left as is on purpose: CCW-F3 pins --json
  // to exit 1 for scripts, and a first run shouldn't fail. Logged as a decision for Chase, not tested.

  it("UX-R16 RED: the no-logs message leads with the next step, then 'Looked in:' and the folders", () => {
    const h = home();
    const r = cli([], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toBe("No Claude Code logs yet. Try ccwatts --demo, or point at a folder with --path <dir>.");
    const at = lines.findIndex((l) => l.trim() === "Looked in:");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^\s+\S*\.claude[\\/]projects$/);
  });
});

// PS-R1 (privacy-security, CCW-M2.6.4): one unreadable log must not stop the run or leak its path.
// We run as root here, so chmod can't make a file unreadable. Instead a preload module makes
// readFile throw EISDIR (with the full path in its message, as Node does) for files named
// unreadable.jsonl, under a folder named the way Claude Code encodes a project path.
describe("PS-R1 an unreadable log file (RED)", () => {
  const preload = join(work, "unreadable-preload.mjs");
  writeFileSync(
    preload,
    `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const readFile = fs.readFile;
fs.readFile = async (p, ...rest) => {
  if (String(p).endsWith("unreadable.jsonl")) throw Object.assign(new Error("EISDIR: illegal operation on a directory, read '" + p + "'"), { code: "EISDIR", path: String(p) });
  return readFile(p, ...rest);
};
syncBuiltinESMExports();
`,
  );
  const ENCODED = "-home-alice-clientX";

  function setup() {
    const h = home();
    const dir = join(h, "claude", "projects", ENCODED);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "good.jsonl"), hLine("good", "2026-10-01T10:00:00.000Z") + "\n");
    writeFileSync(join(dir, "unreadable.jsonl"), hLine("bad", "2026-10-01T11:00:00.000Z") + "\n");
    return { h, env: { HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), CLAUDE_CONFIG_DIR: join(h, "claude"), NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } };
  }

  it("PS-R1 RED: the summary still answers from the other files and notes the one it couldn't read", () => {
    const { h, env } = setup();
    const r = cli(["--since", "all"], env);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Electricity\s+[\d.]+ k?Wh/);
    expect(r.out).toMatch(/Based on\s+1 response/);
    expect(r.out + r.err).toMatch(/1 log file couldn't be read \(EISDIR\)/);
    for (const text of [r.out, r.err]) {
      expect(text).not.toContain(h);
      expect(text).not.toContain(ENCODED);
    }
  });

  it("PS-R1 RED: --json still answers, with no path or encoded folder in it", () => {
    const { h, env } = setup();
    const r = cli(["--since", "all", "--json"], env);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).responses).toBe(1);
    expect(r.out + r.err).not.toContain(h);
    expect(r.out + r.err).not.toContain(ENCODED);
  });
});

// ---------------------------------------------------------------------------------------------
// PS-R5: project ids are an unsalted hash of the full path, so a shared file could confirm a
// guessed path. Nothing a user might share (--json, the dashboard file) may carry that hash.
// Two folders share the basename "app" so the tests also prove they still stay apart.
// ---------------------------------------------------------------------------------------------
/** PS-R5: every string value in parsed JSON (numbers can look like hex digits, so only strings count). */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]);
  return [];
}

describe("PS-R5 no path hash in shareable output", () => {
  const A = "/synthetic/work/app";
  const B = "/synthetic/play/app";
  const realIds = [projectRef(A).id, projectRef(B).id];
  const HEX16 = /[0-9a-f]{16}/;
  const twoApps = () =>
    logFiles({
      "s.jsonl": [
        hLine("a1", "2026-10-01T10:00:00.000Z", { cwd: A }),
        hLine("a2", "2026-10-02T10:00:00.000Z", { cwd: A }),
        hLine("b1", "2026-10-01T11:00:00.000Z", { cwd: B }),
      ].join("\n"),
    });

  it.each([[[]], [["history"]]] as string[][][])("PS-R5 %j --json has project rows with key and no projectId or hash", (cmd) => {
    const r = cli([...cmd, "--path", twoApps(), "--since", "all", "--json"], { HOME: home() });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.byProject).toHaveLength(2); // same basename, still two rows
    for (const p of out.byProject) {
      expect(p.key).toBe("app");
      expect(p).not.toHaveProperty("projectId");
    }
    for (const id of realIds) expect(r.out).not.toContain(id);
    for (const str of strings(out)) expect(str).not.toMatch(/^[0-9a-f]{16}$/);
  });

  it("PS-R5 dashboard embeds opaque project ids: no real hash, distinct per project, stable per project", () => {
    const h = home();
    const env = { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") };
    const r = cli(["dashboard", "--no-open", "--path", twoApps()], env);
    expect(r.code).toBe(0);
    const html = readFileSync(join(h, ".ccwatts", "dashboard.html"), "utf8");
    const raw = /<script id="ccwatts-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(raw).toBeTruthy();
    for (const id of realIds) expect(html).not.toContain(id);
    const rows = JSON.parse(raw!).rows as { date: string; projectId: string | null; projectName: string | null }[];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.projectName).toBe("app");
      expect(row.projectId).toBeTruthy();
      expect(row.projectId).not.toMatch(HEX16);
    }
    // A has rows on Oct 1 and Oct 2, B only on Oct 1.
    const ids = rows.map((x) => x.projectId);
    expect(new Set(ids).size).toBe(2); // two projects, two labels
    const byDay = (d: string) => rows.filter((x) => x.date === d).map((x) => x.projectId);
    const [aId] = byDay("2026-10-02");
    expect(rows.filter((x) => x.projectId === aId)).toHaveLength(2); // the same project keeps one label
  });
});
