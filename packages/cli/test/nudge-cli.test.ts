import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as core from "@ccwatts/core";

// CCW-M4.6 bedtime nudge, end to end: bundle the CLI as pace-cli.test.ts does and run it in a
// throwaway home. CCWATTS_NOW is a test-only clock override, honored only when NODE_ENV=test
// (PS-R16; cli() sets it, a test can override it); TZ=UTC makes it the local time.

const root = fileURLToPath(new URL("../../../", import.meta.url));
// The temp prefix must not contain persona words or "moon"/"sleep": the assertions scan output for them.
const work = mkdtempSync(join(tmpdir(), "ccwatts-ncli-"));
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
  const h = join(work, `home-${n++}`);
  mkdirSync(h);
  const data = join(h, ".ccwatts");
  return { h, data, file: join(data, "nudge.json"), env: { HOME: h, CCWATTS_HOME: data, CLAUDE_CONFIG_DIR: join(h, "claude") } };
}

function cli(args: string[], env: Record<string, string>, input?: string) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", cwd: work, input, env: { PATH: process.env.PATH ?? "", TZ: "UTC", NO_COLOR: "1", NODE_ENV: "test", ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const IN_WINDOW = "2026-10-31T01:14:00Z";
const OUT_OF_WINDOW = "2026-10-31T15:00:00Z";
const EMPTY_LINE = "⚡ ccwatts: waiting for the first response";
const statusline = (env: Record<string, string>, now: string) => cli(["statusline"], { ...env, CCWATTS_NOW: now }, "{}");

type Persona = { id: string; label: string; tone: string; lines: string[] };
function personas(): readonly Persona[] {
  const ps = (core as unknown as { PERSONAS?: readonly Persona[] }).PERSONAS;
  expect(ps, "PERSONAS is not exported from core").toBeDefined();
  return ps!;
}
/** The fixed text before any {time} token: enough to recognize a persona's line in output. */
const stem = (raw: string) => raw.split("{time}")[0]!.trim();
const hasLineOf = (p: Persona, out: string) => p.lines.some((l) => stem(l).length >= 8 && out.includes(stem(l)));

describe("CCW-M4.6 off by default (NUDGE-C1)", () => {
  it("NUDGE-C1 statusline is unchanged with no nudge settings, even late at night", () => {
    const { env, data } = home();
    const r = statusline(env, IN_WINDOW);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe(`${EMPTY_LINE}\n`);
    expect(r.out).not.toContain("🌙");
    expect(existsSync(join(data, "nudge.json"))).toBe(false);
  });
});

describe("CCW-M4.6 nudge on / off (NUDGE-C2)", () => {
  it("NUDGE-C2 nudge on writes nudge.json 0600, confirms, and shows a sample line", () => {
    const { env, file } = home();
    const r = cli(["nudge", "on", "--persona", "grandma", "--after", "23"], env);
    expect(r.code, r.err).toBe(0);
    expect(existsSync(file)).toBe(true);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ on: true, after: 23, until: 5, persona: "grandma" });
    expect(r.out).toMatch(/\bon\b/i);
    expect(r.out).toMatch(/grandma/i);
    expect(r.out).toContain("🌙");
    expect(hasLineOf(personas().find((p) => p.id === "grandma")!, r.out), r.out).toBe(true);
  });

  it("NUDGE-C2 nudge off turns it off and the status line goes back to normal", () => {
    const { env, file } = home();
    expect(cli(["nudge", "on", "--persona", "grandma", "--after", "23"], env).code).toBe(0);
    const r = cli(["nudge", "off"], env);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/\boff\b/i);
    expect(JSON.parse(readFileSync(file, "utf8")).on).toBe(false);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statusline(env, IN_WINDOW).out).toBe(`${EMPTY_LINE}\n`);
  });
});

describe("CCW-M4.6 status line with the nudge on (NUDGE-C3)", () => {
  it("NUDGE-C3 inside the window: the energy line first, then the persona line", () => {
    const { env, data } = home();
    expect(cli(["nudge", "on", "--persona", "grandma", "--after", "23"], env).code).toBe(0);
    const before = readdirSync(data).sort();
    const r = statusline(env, IN_WINDOW);
    expect(r.code, r.err).toBe(0);
    expect(r.out.startsWith(EMPTY_LINE)).toBe(true);
    expect(r.out).toContain("🌙");
    expect(r.out.indexOf("🌙")).toBeGreaterThan(r.out.indexOf("⚡"));
    expect(hasLineOf(personas().find((p) => p.id === "grandma")!, r.out), r.out).toBe(true);
    expect(r.out).not.toMatch(/[{}]/);
    if (/\d{1,2}:\d{2}[ap]m/.test(r.out)) expect(r.out).toContain("1:14am");
    expect(readdirSync(data).sort(), "statusline must not write files").toEqual(before);
  });

  it("NUDGE-C3 the same hour gives the same line (stable between responses)", () => {
    const { env } = home();
    expect(cli(["nudge", "on", "--persona", "pirate"], env).code).toBe(0);
    const a = statusline(env, "2026-10-31T01:14:00Z").out;
    const b = statusline(env, "2026-10-31T01:52:00Z").out.replace("1:52am", "1:14am");
    expect(a).toBe(b);
  });

  it("NUDGE-C3 outside the window: no persona line", () => {
    const { env } = home();
    expect(cli(["nudge", "on", "--persona", "grandma", "--after", "23"], env).code).toBe(0);
    for (const now of [OUT_OF_WINDOW, "2026-10-31T22:59:00Z", "2026-10-31T05:00:00Z"]) {
      const r = statusline(env, now);
      expect(r.out, now).toBe(`${EMPTY_LINE}\n`);
    }
  });
});

describe("CCW-M4.6 nudge --preview (NUDGE-C4)", () => {
  it("NUDGE-C4 prints a line from every persona and writes nothing", () => {
    const { env, data } = home();
    const r = cli(["nudge", "--preview"], { ...env, CCWATTS_NOW: IN_WINDOW });
    expect(r.code, r.err).toBe(0);
    for (const p of personas()) expect(hasLineOf(p, r.out), `${p.id} missing from preview`).toBe(true);
    expect(r.out.split("\n").filter((l) => l.includes("🌙")).length).toBe(personas().length);
    expect(existsSync(data), "preview must not create ~/.ccwatts").toBe(false);
  });
});

describe("CCW-M4.6 help and errors (NUDGE-C5, NUDGE-C6)", () => {
  it("NUDGE-C5 --help lists nudge", () => {
    const r = cli(["--help"], home().env);
    expect(r.out).toMatch(/^ {2}nudge\b/m);
  });

  it("NUDGE-C6 an unknown persona is a clear error listing the personas, exit 1, nothing written", () => {
    const { env, data } = home();
    const r = cli(["nudge", "on", "--persona", "dragon"], env);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/dragon/);
    for (const p of personas()) expect(r.err).toContain(p.id);
    expect(r.err).toContain("random");
    expect(r.err).not.toMatch(/\n\s+at /); // no stack trace
    expect(existsSync(join(data, "nudge.json"))).toBe(false);
  });
});

describe("CCW-M4.6 plugin skill (NUDGE-C7)", () => {
  it("NUDGE-C7 plugins/ccwatts/skills/nudge/SKILL.md points at /ccwatts:statusline and nudge on", () => {
    const file = join(root, "plugins/ccwatts/skills/nudge/SKILL.md");
    expect(existsSync(file), "plugins/ccwatts/skills/nudge/SKILL.md").toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/^---\ndescription: .+/);
    expect(text).toContain("/ccwatts:statusline");
    expect(text).toContain("nudge on");
  });
});

// Review fixes, Oct 31: UX-R46, UX-R49, UX-R51, UX-R52, UX-R53, PS-R15, PS-R16, PS-R17.
const MORNING = "2026-10-31T07:46:00Z";

describe("CCW-M4.6 review fixes (CLI)", () => {
  it("UX-R46 nudge on outside the window shows the sample at 1:14am, never the daytime time", () => {
    const { env } = home();
    const r = cli(["nudge", "on", "--persona", "grandma"], { ...env, CCWATTS_NOW: MORNING });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("For example, at 1:14am:");
    expect(r.out).not.toContain("7:46am");
    expect(hasLineOf(personas().find((p) => p.id === "grandma")!, r.out), r.out).toBe(true);
  });

  it("UX-R49 --after and --until the same hour is an error, exit non-zero, nothing written", () => {
    const { env, data } = home();
    const r = cli(["nudge", "on", "--after", "22", "--until", "22"], env);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("--after and --until can't be the same hour");
    expect(r.err).not.toMatch(/\n\s+at /);
    expect(existsSync(join(data, "nudge.json"))).toBe(false);
  });

  it("UX-R51 status when on shows only the chosen persona's line, plus a pointer to --preview", () => {
    const { env } = home();
    expect(cli(["nudge", "on", "--persona", "grandma"], env).code).toBe(0);
    const r = cli(["nudge"], { ...env, CCWATTS_NOW: IN_WINDOW });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("See them all: ccwatts nudge --preview");
    expect(r.out.split("\n").filter((l) => l.includes("🌙")).length, r.out).toBe(1);
    for (const p of personas()) expect(hasLineOf(p, r.out), `${p.id} in status output`).toBe(p.id === "grandma");
  });

  it("UX-R52 help says --after and --until use the 24-hour clock", () => {
    for (const args of [["nudge", "--help"], ["--help"]]) {
      const r = cli(args, home().env);
      expect(r.code, r.err).toBe(0);
      const after = r.out.slice(r.out.indexOf("--after <hour>"), r.out.indexOf("--until <hour>"));
      const until = r.out.slice(r.out.indexOf("--until <hour>"), r.out.indexOf("--preview"));
      expect(after, args.join(" ")).toContain("24-hour clock");
      expect(until, args.join(" ")).toContain("24-hour clock");
    }
  });

  it("UX-R53 wherever nudge output or the README points to /ccwatts:statusline, it also points npx users to the README Status line section", () => {
    const { env } = home();
    const on = cli(["nudge", "on", "--persona", "pirate"], { ...env, CCWATTS_NOW: IN_WINDOW });
    expect(on.code, on.err).toBe(0);
    expect(on.out).toContain("/ccwatts:statusline");
    expect(on.out).toMatch(/README/);
    expect(on.out).toMatch(/"Status line"|Status line section/);

    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme, "README needs a Status line section").toMatch(/^#{2,3} Status line\b/m);
    const nudgeSection = readme.slice(readme.indexOf("## Bedtime nudge"), readme.indexOf("\n## ", readme.indexOf("## Bedtime nudge") + 3));
    for (const para of nudgeSection.split(/\n\s*\n/).filter((p) => p.includes("/ccwatts:statusline")))
      expect(para, "nudge paragraph naming /ccwatts:statusline").toMatch(/\[Status line\]\(#status-line\)|Status line section|"Status line"/);
  });

  it("PS-R15 the nudge skill allows only nudge --preview, nudge on and nudge off, not nudge:*", () => {
    const text = readFileSync(join(root, "plugins/ccwatts/skills/nudge/SKILL.md"), "utf8");
    const line = text.match(/^allowed-tools: (.*)$/m)?.[1];
    expect(line, "allowed-tools line").toBeDefined();
    const tools = line!.split(/,\s*(?=Bash\()/).map((t) => t.trim()).sort();
    expect(tools).toEqual(
      [
        "Bash(node ~/.ccwatts/bin/ccwatts.js nudge --preview)",
        "Bash(node ~/.ccwatts/bin/ccwatts.js nudge on:*)",
        "Bash(node ~/.ccwatts/bin/ccwatts.js nudge off)",
        "Bash(mkdir -p ~/.ccwatts/bin)",
        'Bash(cp "${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js" ~/.ccwatts/bin/ccwatts.js)',
      ].sort(),
    );
    expect(line).not.toContain("nudge:*");
  });

  it("PS-R15 nudge rejects unrelated flags (--path, --demo, --since, --share-pace) and writes nothing", () => {
    const cases = [
      ["nudge", "--path", "/tmp"],
      ["nudge", "--demo"],
      ["nudge", "--since", "7d"],
      ["nudge", "--share-pace"],
      ["nudge", "on", "--path", "/tmp"],
      ["nudge", "on", "--demo"],
      ["nudge", "--preview", "--since", "7d"],
    ];
    for (const args of cases) {
      const { env, data } = home();
      const r = cli(args, env);
      expect(r.code, `${args.join(" ")} should fail\n${r.out}`).not.toBe(0);
      expect(r.err, args.join(" ")).not.toMatch(/\n\s+at /);
      expect(existsSync(join(data, "nudge.json")), args.join(" ")).toBe(false);
    }
  });

  it("PS-R16 CCWATTS_NOW is ignored unless NODE_ENV=test", () => {
    const { env } = home();
    expect(cli(["nudge", "on", "--persona", "grandma", "--after", "0", "--until", "1"], env).code).toBe(0);
    // Allowed direction: with NODE_ENV=test the override puts us at 00:30, inside the window.
    expect(statusline(env, "2026-10-31T00:30:00Z").out).toContain("🌙");
    // Excluded direction: same override, NODE_ENV not test. The real clock is used; pick a fake
    // window time the real clock is not in, so a nudge shown can only come from the override.
    const realHour = new Date().getUTCHours();
    if (realHour !== 0) {
      for (const nodeEnv of ["production", ""]) {
        const r = cli(["statusline"], { ...env, NODE_ENV: nodeEnv, CCWATTS_NOW: "2026-10-31T00:30:00Z" }, "{}");
        expect(r.code, r.err).toBe(0);
        expect(r.out, `NODE_ENV=${JSON.stringify(nodeEnv)}`).not.toContain("🌙");
      }
    }
  });

  it("PS-R17 a nudge.json over 4 KB is treated as off; one under 4 KB still works", () => {
    const valid = JSON.stringify({ on: true, after: 23, until: 5, persona: "grandma" });
    const small = home();
    mkdirSync(small.data, { recursive: true });
    writeFileSync(small.file, valid + " ".repeat(4000 - valid.length));
    expect(statusline(small.env, IN_WINDOW).out).toContain("🌙");

    const big = home();
    mkdirSync(big.data, { recursive: true });
    writeFileSync(big.file, valid + " ".repeat(5000));
    const r = statusline(big.env, IN_WINDOW);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe(`${EMPTY_LINE}\n`);
  });
});
