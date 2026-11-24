import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Intake #117: the portfolio page quotes "Sample data: 8.5 kWh over 30 days, range 1.3 to 30.5",
// and it may only quote numbers a repo command reproduces (`npx ccwatts --demo`). These tests pin them.
//
// IF THIS FAILS after a params.json, method-version or demo-fixture change, the numbers on the
// portfolio page (chaseholroyd.com/ccwatts.html) are now wrong: update the page via a Product Studio
// intake, then update the expected values here. Do not just change the expectations.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "ccwatts-portfolio-"));
const bin = join(work, "cli.mjs");

// Bundle the CLI the way tsup does (same as cli.test.ts), then run it as a user would, in a throwaway home.
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

// What the portfolio page quotes.
const PAGE = { kwh: "8.5", low: "1.3", high: "30.5", method: "0.1.2", from: "2026-09-21", to: "2026-10-20", days: 30 };

const inclusiveDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

describe("portfolio page numbers (intake #117)", () => {
  it("PORT-1 --demo prints the quoted 8.5 kWh with range 1.3–30.5", () => {
    const r = cli(["--demo"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/sample data/i);
    expect(r.out).toContain(`Electricity   ${PAGE.kwh} kWh   (range ${PAGE.low}–${PAGE.high})`);
  });

  it("PORT-2 --demo shows method v0.1.2 and the 30-day span the page quotes", () => {
    const r = cli(["--demo"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`method v${PAGE.method}`);
    expect(r.out).toContain(`${PAGE.from} to ${PAGE.to}`);
    expect(inclusiveDays(PAGE.from, PAGE.to)).toBe(PAGE.days);
  });

  it("PORT-3 --demo --json reproduces the same numbers, rounding to what the page shows", () => {
    const r = cli(["--demo", "--json"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.sample).toBe(true);
    expect(j.methodVersion).toBe(PAGE.method);
    expect(j.unit).toBe("Wh");
    expect(j.wh.low).toBeCloseTo(1315.26, 2);
    expect(j.wh.central).toBeCloseTo(8506.55, 2);
    expect(j.wh.high).toBeCloseTo(30489.1, 2);
    expect((j.wh.central / 1000).toFixed(1)).toBe(PAGE.kwh);
    expect((j.wh.low / 1000).toFixed(1)).toBe(PAGE.low);
    expect((j.wh.high / 1000).toFixed(1)).toBe(PAGE.high);
    expect(j.span).toEqual({ from: PAGE.from, to: PAGE.to });
    expect(inclusiveDays(j.span.from, j.span.to)).toBe(PAGE.days);
  });
});
