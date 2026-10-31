#!/usr/bin/env tsx
// check-qa-report: validates the ```qa block that ends every qa-tdd report, so "green, 3x" is something a
// script can check instead of a claim. Ported from holroydchase-afk/studio-agents tools/check-qa-report.mjs
// (ccwatts is all-TypeScript); behavior and messages are identical. The block (format in
// .claude/agents/qa-tdd.md, ## Output):
//
//   ```qa
//   verdict: flaky                    (green | red | flaky | blocked)
//   red: tests/x.test.mjs fails "SHARE-3 save photo" (expected 1, got 0)     (optional)
//   suite: e2e | npm run e2e | 9/0 9/1 9/0                                   (name | command | 3 runs)
//   QA-R1 | P1 | e2e share sheet | passes on retry only | tests/e2e/share.spec.ts
//   ```
//
// One verdict: line. blocked: is required (non-empty) when the verdict is blocked. Each suite: line has a name,
// a command and 3 runs as passed/failed (red may show 1). One finding per line: ID | priority | where | problem | test,
// all five filled in; IDs look like QA-R1 and appear once (QA-R01 is QA-R1); priority is P0, P1 or P2; test is a failing test's
// path (has a / or a file extension) or the word none. green needs at least one suite, 0 failed on every run
// with at least one test, no blocked: line and no open P0. red needs a red: line or a failed run, and may show
// 1 run per suite (the red test runs once before a fix). Any suite whose runs differ makes the verdict flaky,
// whatever it says; flaky needs a QA-R finding. The verdict is case-insensitive.
// When a report has several blocks (a quoted example, last round's), the last one is checked.
//
// Usage: npx tsx scripts/check-qa-report.ts <report.md> [--json]
//   --json   print {verdict, red, blocked, suites: [{name, command, runs: [{passed, failed}]}],
//            findings: [{id, priority, where, problem, test}]} on stdout
// Exit 0 when valid; 1 with one reason per line on stderr; 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const VERDICTS = ["green", "red", "flaky", "blocked"] as const;
export const FIELDS = ["id", "priority", "where", "problem", "test"] as const;
export const RUNS = 3;
const USAGE = "usage: check-qa-report.ts <report.md> [--json]";

export type Verdict = (typeof VERDICTS)[number];
export interface QaRun {
  passed: number;
  failed: number;
}
export interface QaSuite {
  name: string;
  command: string;
  runs: QaRun[];
}
export interface QaFinding {
  id: string;
  priority: string;
  where: string;
  problem: string;
  test: string;
}
export interface QaBlock {
  verdict: Verdict | null;
  red: string | null;
  blocked: string | null;
  suites: QaSuite[];
  findings: QaFinding[];
}
export interface QaResult {
  block: QaBlock | null;
  errors: string[];
}
interface ParsedSuite extends QaSuite {
  count: number | null;
}

const isVerdict = (v: string): v is Verdict => (VERDICTS as readonly string[]).includes(v);
const sameId = (id: string) => id.replace(/^QA-R0*(?=\d)/, "QA-R"); // QA-R01 is QA-R1
const runsDiffer = (s: QaSuite) => {
  const first = s.runs[0];
  return !!first && s.runs.some((r) => r.passed !== first.passed || r.failed !== first.failed);
};
const notNull = <T>(v: T | null): v is T => v !== null;

export function checkQaReport(text: string): QaResult {
  const m = [...text.matchAll(/^```qa[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)].pop();
  const opens = [...text.matchAll(/^```qa[ \t]*$/gm)].pop();
  if (opens && (!m || (opens.index ?? 0) > (m.index ?? 0))) return { block: null, errors: ["the last ```qa block is not closed: end it with a line of ```"] };
  if (!m) return { block: null, errors: ["no ```qa block: end the report with one (see qa-tdd.md, ## Output)"] };
  const errors: string[] = [];
  let verdict: Verdict | null = null, red: string | null = null, blocked: string | null = null;
  let sawVerdict = false, sawRed = false, sawBlocked = false;
  const suites: ParsedSuite[] = [], findings: QaFinding[] = [];
  for (const raw of (m[1] ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const kv = /^(verdict|red|blocked|suite)\s*:\s*(.*)$/i.exec(line);
    const key = kv ? (kv[1] ?? "").toLowerCase() : null;
    const val = kv ? (kv[2] ?? "").trim() : "";
    if (key === "verdict") {
      if (sawVerdict) { errors.push("more than one verdict: line; keep one"); continue; }
      sawVerdict = true;
      const v = val.toLowerCase();
      if (isVerdict(v)) verdict = v;
      else errors.push(`verdict "${val}" must be one of: ${VERDICTS.join(", ")}`);
      continue;
    }
    if (key === "red" || key === "blocked") {
      if (key === "red" ? sawRed : sawBlocked) { errors.push(`more than one ${key}: line; keep one`); continue; }
      if (key === "red") sawRed = true; else sawBlocked = true;
      if (!val) errors.push(`${key}: line is empty: say ${key === "red" ? "what failed first and why" : "what's missing"}`);
      else if (key === "red") red = val; else blocked = val;
      continue;
    }
    if (key === "suite") {
      const parts = val.split("|").map((p) => p.trim());
      if (parts.length !== 3) {
        errors.push(`suite "${val}" has ${parts.length} fields, want 3: name | command | runs (missing command?)`);
        continue;
      }
      const [name = "", command = "", runText = ""] = parts;
      const empty = [name ? null : "name", command ? null : "command", runText ? null : "runs"].filter(notNull);
      if (empty.length) errors.push(`suite "${val}" has an empty field: ${empty.join(", ")}`);
      const tokens = runText.split(/\s+/).filter(Boolean);
      const runs: QaRun[] = [];
      for (const t of tokens) {
        const r = /^(\d+)\/(\d+)$/.exec(t);
        if (r) runs.push({ passed: Number(r[1]), failed: Number(r[2]) });
        else errors.push(`suite ${name || "?"} run "${t}" must be passed/failed, like 42/0`);
      }
      suites.push({ name, command, runs, count: runText ? tokens.length : null });
      continue;
    }
    const parts = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((p) => p.trim());
    if (parts.length !== FIELDS.length) {
      errors.push(`finding "${line}" has ${parts.length} fields, want 5: ID | priority | where | problem | test`);
      continue;
    }
    const empty = parts.map((p, i) => (p ? null : FIELDS[i] ?? null)).filter(notNull);
    if (empty.length) errors.push(`finding "${line}" has an empty field: ${empty.join(", ")}`);
    const [id = "", priority = "", where = "", problem = "", test = ""] = parts;
    if (id && !/^QA-R[0-9]+$/.test(id)) errors.push(`finding ID "${id}" must look like QA-R1 (qa-tdd findings are QA-R<n>)`);
    if (priority && !/^P[0-2]$/.test(priority)) errors.push(`finding ${id || "?"} priority "${priority}" must be P0, P1 or P2`);
    if (test && test !== "none" && !/\/|\.[A-Za-z0-9]+$/.test(test)) errors.push(`finding ${id || "?"} test "${test}" must be a failing test's path (with a / or a file extension) or none`);
    if (id && findings.some((f) => sameId(f.id) === sameId(id))) errors.push(`duplicate finding ID ${id}: each ID appears once`);
    findings.push({ id, priority, where, problem, test });
  }
  if (!sawVerdict) errors.push(`missing verdict: line (${VERDICTS.join(", ")})`);
  // Before a fix the red test runs once, so red may show 1 run; every other verdict needs 3.
  for (const s of suites) {
    if (s.count === null || s.count === RUNS || (verdict === "red" && s.count === 1)) continue;
    errors.push(`suite ${s.name || "?"} has ${s.count} runs, want ${RUNS} (run every suite 3x${verdict === "red" ? ", or once for red before a fix" : ""})`);
  }
  const failing = suites.filter((s) => s.runs.some((r) => r.failed > 0)).map((s) => s.name);
  const differing = suites.filter((s) => s.runs.length > 1 && runsDiffer(s)).map((s) => s.name);
  const empty = suites.filter((s) => s.runs.length && s.runs.every((r) => r.passed + r.failed === 0)).map((s) => s.name);
  const p0 = findings.filter((f) => f.priority === "P0").map((f) => f.id);
  if (verdict === "green") {
    if (!suites.length) errors.push("verdict green needs at least one suite: line");
    if (empty.length) errors.push(`verdict green but no tests ran in ${empty.join(", ")} (0/0 every run): green needs at least one test`);
    if (sawBlocked) errors.push("verdict green can't have a blocked: line: use blocked");
    if (p0.length) errors.push(`verdict green can't have an open P0 finding (${p0.join(", ")}): use red`);
    if (failing.length) errors.push(`verdict green can't have failed runs (${failing.join(", ")}): use red or flaky`);
  }
  // Any suite whose runs differ makes the verdict flaky, whatever it says.
  if (verdict && verdict !== "flaky" && differing.length) errors.push(`verdict ${verdict} but runs differ in ${differing.join(", ")}: that's flaky${verdict === "green" ? ", and flaky is never green" : ""}; say verdict: flaky`);
  if (verdict === "red" && !red && !failing.length) errors.push("verdict red needs evidence: a red: line or a run with failed > 0");
  if (verdict === "flaky") {
    if (!differing.length) errors.push("verdict flaky needs at least one suite whose runs differ");
    if (!findings.some((f) => /^QA-R[0-9]+$/.test(f.id))) errors.push("verdict flaky needs a QA-R finding: a flaky test is a bug, file it");
  }
  if (verdict === "blocked" && !sawBlocked) errors.push("verdict blocked needs a blocked: line saying what's missing");
  return { block: { verdict, red, blocked, suites: suites.map(({ name, command, runs }) => ({ name, command, runs })), findings }, errors };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); process.exit(0); }
  const json = args.includes("--json");
  const files = args.filter((a) => a !== "--json");
  const file = files[0];
  if (files.length !== 1 || file === undefined || file.startsWith("-")) { console.error(USAGE); process.exit(2); }
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { console.error(`can't read ${file}`); process.exit(2); }
  const { block, errors } = checkQaReport(text);
  if (json && block) console.log(JSON.stringify(block, null, 2));
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
