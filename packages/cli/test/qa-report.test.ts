// QAR: scripts/check-qa-report.ts validates the ```qa block that ends every qa-tdd report, so "green, 3x"
// is something a script checks instead of a claim. A strict-TypeScript port of studio-agents'
// tools/check-qa-report.mjs (QATDD-PROD in its tests/check.sh); the fixtures are copied unchanged.
// valid-*.md exit 0 with a quiet stderr; invalid-*.md exit exactly 1 and stderr names the broken rule
// (the "<!-- expect: word -->" line), one reason per line; usage errors and unreadable files exit 2.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(root, "scripts/check-qa-report.ts");
const fixtures = join(root, "packages/cli/test/fixtures/qa-report");
const read = (p: string) => readFileSync(join(root, p), "utf8");
// Like check.sh's need_cq: a missing script must never "pass" an invalid fixture, since tsx's own
// module-not-found error also exits 1 and can contain the expect word.
const run = (...args: string[]) => {
  if (!existsSync(script)) throw new Error("missing scripts/check-qa-report.ts");
  return spawnSync(join(root, "node_modules/.bin/tsx"), [script, ...args], { cwd: root, encoding: "utf8" });
};
const fx = (name: string) => join(fixtures, name);
const all = readdirSync(fixtures).filter((f) => f.endsWith(".md")).sort();
const valid = all.filter((f) => f.startsWith("valid-"));
const invalid = all.filter((f) => f.startsWith("invalid-"));
const expectWord = (name: string) => /^<!-- expect: (.*) -->$/m.exec(readFileSync(fx(name), "utf8"))?.[1] ?? "";

interface Run { passed: number; failed: number }
interface Suite { name: string; command: string; runs: Run[] }
interface Finding { id: string; priority: string; where: string; problem: string; test: string }
interface Block { verdict: string | null; red: string | null; blocked: string | null; suites: Suite[]; findings: Finding[] }
interface QaModule {
  checkQaReport: (text: string) => { block: Block | null; errors: string[] };
  VERDICTS: string[];
  FIELDS: string[];
  RUNS: number;
}

describe("check-qa-report (QAR)", () => {
  it("QAR-1 scripts/check-qa-report.ts exists (and fixtures are present)", () => {
    expect(existsSync(script), "scripts/check-qa-report.ts").toBe(true);
    expect(valid.length).toBeGreaterThanOrEqual(10);
    expect(invalid.length).toBeGreaterThanOrEqual(37);
    for (const f of invalid) expect(expectWord(f), `${f} has an <!-- expect: word --> line`).not.toBe("");
  });

  it.each(valid)("QAR-2 passes %s (exit 0, quiet stderr)", (f) => {
    const r = run(fx(f));
    expect(r.stderr, f).toBe("");
    expect(r.status, f).toBe(0);
  });

  it.each(invalid)("QAR-3 rejects %s (exit 1, stderr names its expect word)", (f) => {
    const r = run(fx(f));
    expect(r.status, `${f}: ${r.stderr}`).toBe(1);
    expect(r.stderr.toLowerCase(), f).toContain(expectWord(f).toLowerCase());
  });

  it("QAR-4 gives one reason per line (two broken rules, two lines)", () => {
    const r = run(fx("invalid-two-reasons.md"));
    expect(r.status, r.stderr).toBe(1);
    const lines = r.stderr.split("\n").filter((l) => l.trim());
    expect(lines.length, r.stderr).toBeGreaterThanOrEqual(2);
    expect(r.stderr).toMatch(/duplicate/i);
    expect(r.stderr).toMatch(/failed/i);
  });

  it("QAR-5 exits 2 on a usage error (no file, two files, unreadable file)", () => {
    expect(run().status, "no file").toBe(2);
    expect(run(fx("valid-green.md"), fx("valid-red.md")).status, "two files").toBe(2);
    expect(run(fx("no-such-report.md")).status, "unreadable file").toBe(2);
  });

  it("QAR-6 --json prints the parsed block", () => {
    const r = run("--json", fx("valid-flaky.md"));
    expect(r.status, r.stderr).toBe(0);
    const d = JSON.parse(r.stdout) as Block;
    expect(d.verdict).toBe("flaky");
    expect(d.red).toBe('tests/x.test.mjs fails "SHARE-3 save photo" (expected 1, got 0)');
    expect(d.suites).toHaveLength(2);
    expect(d.suites[1]).toEqual({
      name: "e2e",
      command: "npm run e2e",
      runs: [{ passed: 9, failed: 0 }, { passed: 9, failed: 1 }, { passed: 9, failed: 0 }],
    });
    expect(d.findings).toEqual([
      { id: "QA-R1", priority: "P1", where: "e2e share sheet", problem: "passes on retry only", test: "tests/e2e/share.spec.ts" },
    ]);
  });

  it("QAR-7 checkQaReport is importable and exports VERDICTS, FIELDS, RUNS", async () => {
    const mod = (await import(script)) as QaModule;
    expect(mod.VERDICTS).toEqual(["green", "red", "flaky", "blocked"]);
    expect(mod.FIELDS).toEqual(["id", "priority", "where", "problem", "test"]);
    expect(mod.RUNS).toBe(3);
    const ok = mod.checkQaReport("done\n\n```qa\nverdict: green\nsuite: unit | npm test | 5/0 5/0 5/0\n```\n");
    expect(ok.errors).toEqual([]);
    expect(ok.block?.verdict).toBe("green");
    expect(ok.block?.suites).toEqual([{ name: "unit", command: "npm test", runs: [{ passed: 5, failed: 0 }, { passed: 5, failed: 0 }, { passed: 5, failed: 0 }] }]);
    const bad = mod.checkQaReport("no block here");
    expect(bad.block).toBeNull();
    expect(bad.errors.join("\n")).toMatch(/no ```qa block/);
  });

  it("QAR-8 qa-tdd.md shows the ```qa block in its ## Output section", () => {
    const md = read(".claude/agents/qa-tdd.md");
    const output = /^## Output\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(md)?.[1] ?? "";
    expect(output, "## Output section").toContain("```qa");
  });

  it("QAR-9 CLAUDE.md tells the main session to relay qa-tdd's verdict as-is, via scripts/check-qa-report.ts", () => {
    const md = read("CLAUDE.md");
    const para = md.split(/\n\s*\n/).find((p) => p.trimStart().startsWith("**Relay qa-tdd's verdict as-is.**"));
    expect(para, "a paragraph starting **Relay qa-tdd's verdict as-is.**").toBeTruthy();
    expect(md).toContain("scripts/check-qa-report.ts");
  });
});
