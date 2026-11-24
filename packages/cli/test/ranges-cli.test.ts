import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeCodeAdapter, defaultParams as params, estimate, shortModel, TYPE_LABELS, type Range, type TokenType } from "@ccwatts/core";

// M4.8.3 "ranges on every number" (docs/product/SPEC-RANGES.md RANGE-10 and the CLI half of RANGE-11;
// UX-R6 P1). Bundles the CLI like cli.test.ts and runs it as a user would, in a throwaway home.
//
// Pinned for the engineer:
//  - Shares read "64% (30–72%)" (or "7%" / "<1%" when every corner rounds the same, as core
//    formatShare does); comparisons read "about 28 miles (4.4–102)".
//  - No line over 80 columns. A "By model" / "By type" item that doesn't fit is left off that line, and
//    the output then names `--by model` / `--by type` so the person can see the rest.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "ccwatts-ranges-cli-"));
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
function cli(args: string[]) {
  const h = join(work, `home-${n++}`);
  mkdirSync(h);
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: work,
    env: { PATH: process.env.PATH ?? "", HOME: h, CCWATTS_HOME: join(h, ".ccwatts"), NO_COLOR: "1" },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// `--demo` shows the bundled sample; the same records, estimated here, give the expected shares.
const e = estimate(claudeCodeAdapter.parse(readFileSync(join(root, "fixtures/claude-code/demo.jsonl"), "utf8")), params);

/** Reference corner ratios and formatting (RANGE-1/RANGE-2), written independently of the product code. */
function refShare(part: Range, total: Range): string {
  const r = (a: number, b: number) => (b > 0 ? a / b : 0);
  const c = [r(part.low, total.low), r(part.central, total.central), r(part.high, total.high)];
  const p = (v: number) => (v > 0 && Math.round(v * 100) === 0 ? "<1" : String(Math.round(v * 100)));
  const [lo, mid, hi] = [p(Math.min(...c)), p(c[1]!), p(Math.max(...c))];
  return lo === mid && mid === hi ? `${mid}%` : `${mid}% (${lo}–${hi}%)`;
}

const stripRanged = (s: string) => s.replace(/(?:<1|\d+(?:\.\d+)?)% ?\((?:<1|\d+(?:\.\d+)?) ?[–-] ?\d+(?:\.\d+)?%\)/g, "");
const bareComparisons = (s: string) =>
  [...s.matchAll(/\babout ([\d.,]+) (miles?|days?|times)\b/g)]
    .filter((m) => !/^\s*\((?:range )?[<\d.,]+ ?[–-] ?[\d.,]+/.test(s.slice(m.index! + m[0].length)))
    .map((m) => m[0]);
const cols = (line: string) => [...line].length;

/**
 * RANGE-11 CLI allowlist: exact text whose bare % is not a missing range. Each needs a reason.
 * Shares where formatShare collapses (all three corners round the same) are listed by value.
 */
const CLI_EXEMPT: Record<string, string> = {
  "haiku-4-5 7%": "corners 6.7 / 7.3 / 7.1 % all round to 7% (formatShare gives a single value)",
  "input <1%": "corners all round to 0 and are above 0 (formatShare gives <1%)",
};

describe("RANGE-10 ccwatts --demo: comparisons and shares carry ranges, 80 columns", () => {
  it("RANGE-10 --demo estimates the same sample the test computes (sanity)", () => {
    const r = cli(["--demo"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("(range 1.3 – 30.5)");
    expect(e.total.central).toBeCloseTo(8506.55, 1);
  });

  it('RANGE-10 --demo comparisons carry ranges ("about 28 miles (4.4–102)", "about 5.7 days (0.9–20)")', () => {
    const out = cli(["--demo"]).out;
    expect(out).toContain("about 28 miles (4.4–102)");
    expect(out).toContain("about 5.7 days (0.9–20)");
    expect(bareComparisons(out)).toEqual([]);
  });

  it("RANGE-10 --demo has no line over 80 columns", () => {
    const long = cli(["--demo"]).out.split("\n").filter((l) => cols(l) > 80).map((l) => `${cols(l)}: ${l}`);
    expect(long).toEqual([]);
  });

  for (const [dim, rows, label] of [
    ["model", e.byModel, (k: string) => shortModel(k)],
    ["type", e.byType, (k: string) => TYPE_LABELS[k as TokenType]],
  ] as const) {
    it(`RANGE-10 --demo "By ${dim}" shows each item it lists with its share range; any item left off is behind a --by ${dim} hint`, () => {
      const out = cli(["--demo"]).out;
      const line = out.split("\n").find((l) => l.includes(`By ${dim}`)) ?? "";
      expect(line, `no "By ${dim}" line`).not.toBe("");
      const shown = rows.filter((r) => line.includes(`${label(r.key)} `));
      expect(shown.length, `"By ${dim}" lists nothing`).toBeGreaterThan(0);
      expect(shown[0]!.key, "the largest item comes first").toBe(rows[0]!.key);
      for (const r of shown) expect(line, `"${line}"`).toContain(`${label(r.key)} ${refShare(r.energy, e.total)}`);
      if (shown.length < rows.length) expect(out, `${rows.length - shown.length} ${dim}(s) left off with no hint`).toContain(`--by ${dim}`);
    });
  }
});

describe("RANGE-10 ccwatts estimate: comparisons carry ranges, 80 columns", () => {
  it("RANGE-10 estimate 88.8M comparisons carry ranges and no line is over 80 columns", () => {
    const r = cli(["estimate", "88.8M", "--model", "opus"]);
    expect(r.code, r.err).toBe(0);
    const compare = r.out.split("\n").filter((l) => l.trimStart().startsWith("≈"));
    expect(compare.length).toBeGreaterThan(0);
    for (const l of compare) expect(l).toMatch(/about [\d.,]+ (miles?|days?|times) \([<\d.,]+–[\d.,]+\)/);
    expect(bareComparisons(r.out)).toEqual([]);
    expect(r.out.split("\n").filter((l) => cols(l) > 80)).toEqual([]);
  });
});

describe("RANGE-11 audit guard: ccwatts --demo", () => {
  it(`RANGE-11 every % and comparison number in --demo has a range (allowlist: ${Object.keys(CLI_EXEMPT).join(", ")})`, () => {
    const out = cli(["--demo"]).out;
    const bad: string[] = [];
    for (const raw of out.split("\n")) {
      let line = stripRanged(raw).replace(/\d+% of tokens/g, "");
      for (const ok of Object.keys(CLI_EXEMPT)) line = line.split(ok).join("");
      for (const m of line.match(/(?:<1|\d+(?:\.\d+)?)%/g) ?? []) bad.push(`${m} in "${raw.trim()}"`);
      for (const c of bareComparisons(raw)) bad.push(`${c} in "${raw.trim()}"`);
    }
    expect(bad).toEqual([]);
  });
});
