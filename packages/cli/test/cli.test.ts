import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_VERSION, PLAYGROUND_URL } from "@ccwatts/core";

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
    expect(r.out).toContain("No Claude Code logs found");
    expect(existsSync(join(h, ".ccwatts"))).toBe(false);
  });

  it("CCW-H4 dashboard with no logs and no history doesn't write an empty dashboard", () => {
    const h = home();
    const r = cli(["dashboard", "--no-open"], { HOME: h, CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.out).toContain("No Claude Code logs found");
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
    expect(r.out).not.toContain("No Claude Code logs found");
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
