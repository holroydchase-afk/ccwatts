import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// M4.8.3 fix round, CLI half of UX-R14 and UX-R15 (P2, ux-reviewer; SPEC-RANGES). Bundles the CLI like
// ranges-cli.test.ts and runs it as a user would, in a throwaway home.
//
// Pinned for the engineer:
//  - UX-R14: comparison range ends at 2 significant figures, at most 1 decimal:
//    "about 28 miles (4.4–100)", "about 5.7 days (0.9–20)".
//  - UX-R15: kWh/Wh ranges use the tight en dash: "(range 1.3–30.5)", "(range 0.48–11.4)", and the
//    --by tables' range column "0.81–19.7". Pace hours ("29 – 36") are NOT covered here (out of this
//    finding's scope; see the hand-back note).

const root = fileURLToPath(new URL("../../../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "ccwatts-ranges2-cli-"));
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

const SPACED = /\d[  ]–[  ]\d/;
function twoSig(end: string): boolean {
  if (end === "<0.1") return true;
  const s = end.replace(/,/g, "");
  if (/\.\d{2,}/.test(s)) return false;
  return s.replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length <= 2;
}
const compareEnds = (out: string) =>
  [...out.matchAll(/about [\d.,]+ (?:miles?|days?|times|\w+ a phone charge)\s*\(([<\d.,]+)–([\d.,]+)(?: charges)?\)/g)].flatMap((m) => [m[1]!, m[2]!]);

describe("UX-R14 CLI comparison range ends: 2 significant figures, at most 1 decimal", () => {
  it('UX-R14 --demo reads "about 28 miles (4.4–100)" and "about 5.7 days (0.9–20)"', () => {
    const r = cli(["--demo"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("about 28 miles (4.4–100)");
    expect(r.out).toContain("about 5.7 days (0.9–20)");
    expect(r.out).not.toContain("4.4–102");
  });

  for (const args of [["--demo"], ["estimate", "88.8M", "--model", "opus"], ["estimate", "1.2M", "--model", "sonnet"]]) {
    it(`UX-R14 ccwatts ${args.join(" ")}: every comparison end has at most 2 significant figures and 1 decimal`, () => {
      const r = cli(args);
      expect(r.code, r.err).toBe(0);
      const ends = compareEnds(r.out);
      expect(ends.length, "no comparison ranges found").toBeGreaterThan(0);
      for (const end of ends) expect(twoSig(end), `"${end}" in:\n${r.out}`).toBe(true);
    });
  }
});

describe("UX-R15 CLI one dash style: kWh ranges use the tight en dash", () => {
  it('UX-R15 --demo reads "(range 1.3–30.5)" and the top project "(range 0.48–11.4)"', () => {
    const out = cli(["--demo"]).out;
    expect(out).toContain("(range 1.3–30.5)");
    expect(out).toContain("(range 0.48–11.4)");
  });

  for (const args of [
    ["--demo"],
    ["--demo", "--by", "model"],
    ["--demo", "--by", "type"],
    ["--demo", "--by", "project"],
    ["--demo", "--by", "day"],
    ["estimate", "88.8M", "--model", "opus"],
  ]) {
    it(`UX-R15 ccwatts ${args.join(" ")} has no spaced en dash between numbers`, () => {
      const r = cli(args);
      expect(r.code, r.err).toBe(0);
      const bad = r.out.split("\n").filter((l) => SPACED.test(l));
      expect(bad).toEqual([]);
    });
  }
});
