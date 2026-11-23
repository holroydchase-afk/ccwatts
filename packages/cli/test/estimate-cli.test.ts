import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_VERSION, defaultParams, formatEnergy } from "@ccwatts/core";

// EST: `ccwatts estimate <count> [--model] [--input --cache-write --cache-read --output] [--json]`.
// End-to-end like cli.test.ts: bundle the CLI, run it in a throwaway home.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sample = join(root, "fixtures/claude-code/sample.jsonl");
const work = mkdtempSync(join(tmpdir(), "ccwatts-est-"));
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

/** Every file under dir, relative, sorted. */
function tree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .map((d) => join((d as unknown as { parentPath: string }).parentPath ?? "", d.name).slice(dir.length))
    .sort();
}

const MISSING = "Give a token count, e.g. ccwatts estimate 88.8M --model opus";
const WIDE = "Wide range: the mix of token types is guessed.";
const KNOW_SPLIT = "Know the split? Add --output, --cache-read, --cache-write or --input to narrow it.";
const unreadable = (x: string) => `Couldn't read "${x}" as a token count. Try 88.8M, 1.2k or 88800000.`;

describe("EST-8 ccwatts estimate: text", () => {
  it("EST-8 88.8M on opus shows the range, method version, model and the assumed mix", () => {
    const h = home();
    const r = cli(["estimate", "88.8M", "--model", "opus"], { HOME: h });
    expect(r.code, r.err).toBe(0);
    const json = JSON.parse(cli(["estimate", "88.8M", "--model", "opus", "--json"], { HOME: h }).out);
    const shown = formatEnergy(json.wh);
    expect(r.out).toContain(`ccwatts v${APP_VERSION} · method v${defaultParams.version} · a token count you entered`);
    expect(r.out).toMatch(new RegExp(`Electricity\\s+${shown.central.replace(".", "\\.")}\\s+\\(range ${shown.range.replace(/\./g, "\\.")}\\)`));
    expect(shown.unit).toBe("kWh");
    expect(r.out).toMatch(/≈ /); // the comparison line, as in the summary
    expect(r.out).toMatch(/Model\s+opus\n/); // UX-R31: no "(tier opus)"
    expect(r.out).toMatch(/Tokens\s+88,800,000 · mix assumed: /);
    expect(r.out).toContain(KNOW_SPLIT); // UX-R28 wording
    expect(r.out).toContain("How this is estimated: ccwatts --method");
  });

  it("EST-8 --model defaults to opus", () => {
    const r = cli(["estimate", "88.8M"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Model\s+opus\n/);
  });

  it("EST-8 small counts scale down to Wh", () => {
    const r = cli(["estimate", "1.2k", "--model", "sonnet"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Electricity\s+[\d.]+ Wh\s+\(range [\d.]+ – [\d.]+\)/);
  });

  it("EST-8 an unknown model still answers, with the fallback tier and a note", () => {
    const r = cli(["estimate", "1M", "--model", "gpt-9"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    expect(r.out + r.err).toContain(`Unknown model "gpt-9": estimated as ${String(defaultParams.tiers.fallback)}.`);
  });
});

describe("EST-18 UX-R28 an assumed mix says why the range is wide", () => {
  it("EST-18 UX-R28 the 'Wide range' line sits directly above the reworded 'Know the split?' line", () => {
    const r = cli(["estimate", "88.8M", "--model", "opus"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    const lines = r.out.split("\n").map((l) => l.trim());
    const wide = lines.indexOf(WIDE);
    expect(wide, r.out).toBeGreaterThanOrEqual(0);
    expect(lines[wide + 1], r.out).toBe(KNOW_SPLIT);
    expect(r.out).not.toContain("for a tighter range");
  });

  it("EST-18 UX-R28 a known split shows neither line", () => {
    const r = cli(["estimate", "1M", "--output", "10k"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain(WIDE);
    expect(r.out).not.toContain("Know the split?");
  });
});

describe("EST-19 UX-R31 the Model line reads plainly", () => {
  it("EST-19 UX-R31 a known model is named alone, with no tier in brackets", () => {
    for (const m of ["opus", "sonnet", "haiku"]) {
      const r = cli(["estimate", "1M", "--model", m], { HOME: home() });
      expect(r.code, r.err).toBe(0);
      expect(r.out, m).toMatch(new RegExp(`^  Model\\s+${m}$`, "m"));
      expect(r.out, m).not.toContain("(tier");
    }
  });

  it("EST-19 UX-R31 an unknown model says which tier it was counted as", () => {
    const r = cli(["estimate", "1M", "--model", "gpt5"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(new RegExp(`^  Model\\s+gpt5 \\(counted as ${String(defaultParams.tiers.fallback)}\\)$`, "m"));
    expect(r.out).not.toContain("(tier");
  });
});

describe("EST-9 ccwatts estimate --json", () => {
  it("EST-9 has the documented shape, source manual, Wh, and a sorted range", () => {
    const r = cli(["estimate", "88.8M", "--model", "opus", "--json"], { HOME: home() });
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out);
    expect(Object.keys(j).sort()).toEqual(
      ["app", "comparisons", "methodVersion", "mixAssumed", "model", "source", "tier", "tokens", "unit", "version", "wh"].sort(),
    );
    expect(j).toMatchObject({ app: "ccwatts", version: APP_VERSION, methodVersion: defaultParams.version, unit: "Wh", source: "manual", tier: "opus", mixAssumed: true });
    expect(j.tokens.input + j.tokens.cacheWrite + j.tokens.cacheRead + j.tokens.output).toBe(88_800_000);
    expect(j.wh.low).toBeLessThan(j.wh.central);
    expect(j.wh.central).toBeLessThan(j.wh.high);
    expect(j.wh.central).toBeGreaterThan(4_000);
    expect(j.wh.central).toBeLessThan(5_500);
    expect(Array.isArray(j.comparisons)).toBe(true);
  });

  it("EST-9 --json is never colored, even with FORCE_COLOR=1", () => {
    const r = cli(["estimate", "88.8M", "--json"], { HOME: home(), FORCE_COLOR: "1" });
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain("\u001b[");
  });
});

describe("EST-10 a split you know", () => {
  const args = ["estimate", "1M", "--model", "opus", "--output", "10k", "--cache-write", "40k"];

  it("EST-10 split flags drop 'mix assumed' and the 'Know the split?' line", () => {
    const r = cli(args, { HOME: home() });
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain("mix assumed");
    expect(r.out).not.toContain("Know the split?");
    expect(r.out).toMatch(/Tokens\s+1,000,000/);
  });

  it("EST-10 --json uses the given counts and puts the rest in cache read", () => {
    const j = JSON.parse(cli([...args, "--json"], { HOME: home() }).out);
    expect(j.mixAssumed).toBe(false);
    expect(j.tokens).toEqual({ input: 0, cacheWrite: 40_000, cacheRead: 950_000, output: 10_000 });
  });

  it("EST-10 all four split flags accept the same suffixes", () => {
    const j = JSON.parse(cli(["estimate", "2M", "--input", "1k", "--cache-write", "0.1M", "--cache-read", "1,800,000", "--output", "99000", "--json"], { HOME: home() }).out);
    expect(j.tokens).toEqual({ input: 1_000, cacheWrite: 100_000, cacheRead: 1_800_000, output: 99_000 });
  });
});

describe("EST-11 errors", () => {
  it("EST-11 no count: one plain line and exit 1", () => {
    const r = cli(["estimate"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err.trim()).toBe(MISSING);
    expect(r.out).toBe("");
  });

  it("EST-11 an unreadable count: one plain line and exit 1", () => {
    for (const bad of ["lots", "-5", "5MM"]) {
      const r = cli(["estimate", bad], { HOME: home() });
      expect(r.code, bad).toBe(1);
      expect(r.err.trim(), bad).toBe(unreadable(bad));
    }
  });

  it("EST-11 an unreadable split value is an error too, not silently dropped", () => {
    const r = cli(["estimate", "1M", "--output", "abc"], { HOME: home() });
    expect(r.code).toBe(1);
    expect(r.err).toContain(unreadable("abc"));
  });
});

describe("EST-12 help", () => {
  it("EST-12 --help lists estimate and the four split options", () => {
    const r = cli(["--help"], { HOME: home() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("  estimate          Estimate from a token count you enter (e.g. 88.8M)");
    for (const flag of ["--input", "--cache-write", "--cache-read", "--output"]) expect(r.out, flag).toMatch(new RegExp(`^\\s+${flag}\\b`, "m"));
  });
});

describe("EST-13 estimate reads no logs and writes no files", () => {
  it("EST-13 works with an empty home and an empty CLAUDE_CONFIG_DIR", () => {
    const h = home();
    mkdirSync(join(h, "claude"));
    const r = cli(["estimate", "88.8M"], { HOME: h, CLAUDE_CONFIG_DIR: join(h, "claude"), CCWATTS_HOME: join(h, ".ccwatts") });
    expect(r.code, r.err).toBe(0);
    expect(r.err).not.toMatch(/No Claude Code logs/);
  });

  it("EST-13 logs on disk don't change the answer (they aren't read)", () => {
    const withLogs = home();
    mkdirSync(join(withLogs, "claude", "projects"), { recursive: true });
    cpSync(sample, join(withLogs, "claude", "projects", "s.jsonl"));
    const a = cli(["estimate", "88.8M", "--json"], { HOME: withLogs, CLAUDE_CONFIG_DIR: join(withLogs, "claude") });
    const b = cli(["estimate", "88.8M", "--json"], { HOME: home() });
    expect(a.code, a.err).toBe(0);
    expect(a.out).toBe(b.out);
  });

  it("EST-13 creates no ~/.ccwatts files (no history, no pace) and touches nothing else in home", () => {
    const h = home();
    mkdirSync(join(h, "claude", "projects"), { recursive: true });
    cpSync(sample, join(h, "claude", "projects", "s.jsonl"));
    const before = tree(h);
    const env = { HOME: h, CLAUDE_CONFIG_DIR: join(h, "claude") };
    expect(cli(["estimate", "88.8M"], env).code).toBe(0);
    expect(cli(["estimate", "88.8M", "--json"], env).code).toBe(0);
    expect(existsSync(join(h, ".ccwatts"))).toBe(false);
    expect(tree(h)).toEqual(before);
  });
});
