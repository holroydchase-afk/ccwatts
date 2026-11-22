// M2.6.7 reusable blocks: the repo's own guard rails (private-data check, git hook,
// pinned and gated workflows, dependabot, README badge). Leak fixtures are built by
// string concatenation so this file never trips check-private itself.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(root, "scripts/check-private.ts");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Fixtures (concatenated so the literal never appears in this file).
const HOME = "/Us" + "ers/";
const MAC_LEAK = HOME + "realname" + "/code/app";
const WIN_LEAK = "C:" + "\\" + "Users" + "\\" + "realname" + "\\" + "code";
const EMAIL_LEAK = "someone" + "@" + "gmail.com";
const GH_TOKEN = "gh" + "p_" + "a".repeat(36);
const AWS_KEY = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const PEM = "-----BEGIN " + "RSA PRIVATE" + " KEY-----";

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** A throwaway git repo with check-private and a config allowlisting "demo". */
function tempRepo(files: Record<string, string>, { commit = true } = {}) {
  expect(existsSync(script), "scripts/check-private.ts exists").toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "ccw-private-"));
  tmps.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.hooksPath", "/dev/null");
  mkdirSync(join(dir, "scripts"));
  copyFileSync(script, join(dir, "scripts/check-private.ts"));
  writeFileSync(join(dir, "studio-checks.json"), JSON.stringify({ private: { allowUsers: ["demo"], allowEmails: [] } }));
  for (const [p, body] of Object.entries(files)) writeFileSync(join(dir, p), body);
  git(dir, "add", "-A");
  if (commit) git(dir, "commit", "-qm", "fixture", "--no-verify");
  return dir;
}

function check(cwd: string, ...args: string[]) {
  const r = spawnSync(join(root, "node_modules/.bin/tsx"), ["scripts/check-private.ts", ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("check-private (RB-1)", () => {
  it("RB-1a flags home paths, emails, tokens, keys and a tracked .env with file:line and kind", () => {
    const dir = tempRepo({
      "mac.txt": "ok line\nsee " + MAC_LEAK + "\n",
      "win.txt": "path " + WIN_LEAK + "\n",
      "mail.md": "contact " + EMAIL_LEAK + "\n",
      "tok.js": 'const t = "' + GH_TOKEN + '";\n',
      "aws.txt": "key=" + AWS_KEY + "\n",
      "key.pem.txt": PEM + "\nabc\n",
      ".env": "FOO=bar\n",
    });
    const r = check(dir);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/mac\.txt:2/);
    expect(r.out).toMatch(/win\.txt:1/);
    expect(r.out).toMatch(/mail\.md:1/);
    expect(r.out).toMatch(/tok\.js:1/);
    expect(r.out).toMatch(/aws\.txt:1/);
    expect(r.out).toMatch(/key\.pem\.txt:1/);
    expect(r.out).toMatch(/\.env/);
    expect(r.out).toMatch(/home path/i);
    expect(r.out).toMatch(/email/i);
    expect(r.out).toMatch(/token|secret|key/i);
    // Never echo the whole secret back.
    expect(r.out).not.toContain(GH_TOKEN);
    expect(r.out).not.toContain(AWS_KEY);
  });

  it("RB-1b clean files, allowlisted users and safe emails pass", () => {
    const dir = tempRepo({
      "clean.md": "# hello\nnothing to see\n",
      "demo.txt": "fixture at " + HOME + "demo/x\n",
      "mail.md": "write to a" + "@" + "example.com or noreply" + "@" + "anthropic.com\n",
    });
    const r = check(dir);
    expect(r.out).not.toMatch(/demo\.txt|mail\.md/);
    expect(r.status, r.out).toBe(0);
  });

  it("RB-1c --staged fails on a staged leak", () => {
    const dir = tempRepo({ "clean.md": "fine\n" });
    writeFileSync(join(dir, "leak.txt"), "x " + MAC_LEAK + "\n");
    git(dir, "add", "leak.txt");
    const r = check(dir, "--staged");
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/leak\.txt:1/);
  });

  it("RB-1d --staged ignores an unstaged leak", () => {
    const dir = tempRepo({ "clean.md": "fine\n" });
    writeFileSync(join(dir, "clean.md"), "fine\n" + MAC_LEAK + "\n"); // modified, not staged
    writeFileSync(join(dir, "untracked.txt"), EMAIL_LEAK + "\n");
    const r = check(dir, "--staged");
    expect(r.status, r.out).toBe(0);
  });
});

describe("repo hygiene (RB-2, RB-3)", () => {
  it("RB-2 the repo itself passes check-private", () => {
    expect(existsSync(script), "scripts/check-private.ts exists").toBe(true);
    const r = check(root);
    expect(r.status, r.out).toBe(0);
  });

  it("RB-3a .githooks/pre-commit is executable in git and runs check-private --staged", () => {
    expect(existsSync(join(root, ".githooks/pre-commit")), ".githooks/pre-commit exists").toBe(true);
    const ls = spawnSync("git", ["ls-files", "-s", ".githooks/pre-commit"], { cwd: root, encoding: "utf8" }).stdout;
    expect(ls, "tracked with mode 100755").toMatch(/^100755 /);
    expect(read(".githooks/pre-commit")).toMatch(/npx --no-install tsx scripts\/check-private\.ts --staged/);
  });

  it("RB-3b package.json wires the hook (prepare) and runs check-private in npm test", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.prepare ?? "").toMatch(/core\.hooksPath \.githooks/);
    expect(pkg.scripts.test).toMatch(/tsx scripts\/check-private\.ts/);
  });

  it("RB-3c the Agent-tool hook is wired and its run log is committable (not caught by *.log)", () => {
    const settings = JSON.parse(read(".claude/settings.json"));
    const pre = (settings.hooks?.PreToolUse ?? []) as { matcher?: string; hooks?: { command?: string }[] }[];
    const entry = pre.find((h) => /\bAgent\b/.test(h.matcher ?? ""));
    expect(entry, "PreToolUse entry matching Agent").toBeTruthy();
    expect(entry!.hooks?.map((h) => h.command).join(" ")).toMatch(/scripts\/log-agent-run\.sh/);
    expect(existsSync(join(root, "scripts/log-agent-run.sh")), "scripts/log-agent-run.sh exists").toBe(true);
    const ig = spawnSync("git", ["check-ignore", "-q", "--no-index", ".claude/agent-runs/some-branch.log"], { cwd: root });
    expect(ig.status, ".claude/agent-runs/*.log must not be gitignored").toBe(1);
  });

  it("RB-3d the hook logs the agent name only, never the prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccw-hook-"));
    tmps.push(dir);
    git(dir, "init", "-q", "-b", "feat/x");
    const input = JSON.stringify({ tool_input: { subagent_type: "qa-tdd", prompt: "SECRET-PROMPT-TEXT" } });
    const r = spawnSync("bash", [join(root, "scripts/log-agent-run.sh")], {
      input,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    expect(r.status, r.stderr).toBe(0);
    const log = readFileSync(join(dir, ".claude/agent-runs/feat-x.log"), "utf8");
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ qa-tdd\n$/);
    expect(log).not.toContain("SECRET");
  });
});

describe("workflows (RB-4)", () => {
  const wfDir = ".github/workflows";
  const workflows = readdirSync(join(root, wfDir)).filter((f) => f.endsWith(".yml"));

  it("RB-4a every uses: is pinned to a 40-char SHA with a # v comment", () => {
    const bad: string[] = [];
    for (const f of workflows) {
      read(`${wfDir}/${f}`)
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*-?\s*uses:/.test(line) && !/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/.test(line))
            bad.push(`${f}:${i + 1} ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it("RB-4b ci.yml runs on push to main and PRs, with a browser job and check-private", () => {
    const ci = read(`${wfDir}/ci.yml`);
    expect(ci).toMatch(/\bpull_request:/);
    // Block or flow style: push: { branches: [main] } or push:\n  branches: [main]
    expect(ci).toMatch(/\bpush:[\s{]*branches:\s*\[\s*["']?main["']?\s*\]/);
    expect(ci).toMatch(/^ {2}browser:/m);
    const browser = ci.slice(ci.search(/^ {2}browser:/m));
    expect(browser).toMatch(/npm run check:browser/);
    expect(ci).toMatch(/tsx scripts\/check-private\.ts/);
  });

  it("RB-4c pages.yml deploys only after a successful CI run on a push", () => {
    const pages = read(`${wfDir}/pages.yml`);
    expect(pages).toMatch(/\bworkflow_run:[\s{]*workflows:\s*\[\s*["']?CI["']?\s*\]/);
    expect(pages).not.toMatch(/^ {2}push:/m);
    const build = pages.slice(pages.search(/^ {2}build:/m), pages.search(/^ {2}deploy:/m));
    expect(build).toMatch(/if:.*github\.event\.workflow_run\.event == 'push'/s);
    expect(build).toMatch(/if:.*github\.event\.workflow_run\.conclusion == 'success'/s);
  });

  it("RB-4e LIVE-CHECK: pages.yml checks the live page after every deploy, read-only, with retries", () => {
    const pages = read(`${wfDir}/pages.yml`);
    const start = pages.search(/^ {2}live-check:/m);
    expect(start).toBeGreaterThan(pages.search(/^ {2}deploy:/m));
    const job = pages.slice(start);
    expect(job).toMatch(/needs:\s*deploy/);
    expect(job).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(job).toMatch(/persist-credentials:\s*false/);
    expect(job).toMatch(/npm run check:live/);
    expect(job).not.toMatch(/pages:\s*write|id-token:\s*write/); // ARCH-R4
    // ARCH-R1: Pages caches for up to 10 minutes (max-age=600), so retries span at least 11 minutes.
    expect(job).toMatch(/for attempt in \$\(seq 1 12\)/);
  });

  it("RB-4d publish.yml refuses non-main refs, drops credentials and the npm cache", () => {
    const pub = read(`${wfDir}/publish.yml`);
    expect(pub).toMatch(/refs\/heads\/main/);
    expect(pub).toMatch(/exit 1/);
    expect(pub).toMatch(/persist-credentials:\s*false/);
    expect(pub).not.toMatch(/cache:\s*npm/);
    // The main-only guard comes before anything else runs.
    const firstStep = pub.slice(pub.indexOf("steps:")).split(/\n\s+- /)[1] ?? "";
    expect(firstStep).toMatch(/refs\/heads\/main/);
  });

  it("RB-4e handoff-check.yml skips bot PRs", () => {
    expect(read(`${wfDir}/handoff-check.yml`)).toMatch(/github\.event\.pull_request\.user\.type != 'Bot'/);
  });

  it("RB-4f dependabot covers npm and github-actions weekly with groups", () => {
    expect(existsSync(join(root, ".github/dependabot.yml")), ".github/dependabot.yml exists").toBe(true);
    const dep = read(".github/dependabot.yml");
    for (const eco of ["npm", "github-actions"]) {
      const at = dep.search(new RegExp(`package-ecosystem:\\s*"?${eco}"?`));
      expect(at, `${eco} entry`).toBeGreaterThanOrEqual(0);
      const block = dep.slice(at).split(/\n\s+- package-ecosystem:/)[0];
      expect(block, `${eco} weekly`).toMatch(/interval:\s*"?weekly"?/);
      expect(block, `${eco} groups`).toMatch(/groups:/);
    }
  });
});

describe("README (RB-5)", () => {
  it("RB-5 the CI badge links to the CI workflow in the first 10 lines", () => {
    const top = read("README.md").split("\n").slice(0, 10).join("\n");
    expect(top).toMatch(/\[!\[CI\]\([^)]*actions\/workflows\/ci\.yml\/badge\.svg[^)]*\)\]\([^)]*actions\/workflows\/ci\.yml\)/);
  });
});

// Issue #104 (docs/product/SPEC-STUDIO-WIRING.md): cloud threads run studio agents as general-purpose
// subagents that log themselves with `log-agent-run.sh --as`, and agents-check refuses "qa-tdd skipped"
// on a code PR unless the reason is "docs only" or "config only".
describe("studio-agents wiring (#104)", () => {
  const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/;

  /** A temp git repo on `branch` with the given studio agents (empty files) and extra files. */
  function agentRepo(branch: string, agents: string[], files: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "ccw-agents-"));
    tmps.push(dir);
    git(dir, "init", "-q", "-b", branch);
    git(dir, "config", "core.hooksPath", "/dev/null");
    mkdirSync(join(dir, ".claude/agents"), { recursive: true });
    for (const a of agents) writeFileSync(join(dir, `.claude/agents/${a}.md`), `---\nname: ${a}\n---\n${a}\n`);
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
    return dir;
  }

  /** Env with CLAUDE_PROJECT_DIR pointed at an empty non-repo dir, so nothing can leak into this repo. */
  function isolatedEnv(extra: Record<string, string> = {}) {
    const elsewhere = mkdtempSync(join(tmpdir(), "ccw-elsewhere-"));
    tmps.push(elsewhere);
    return { ...process.env, CLAUDE_PROJECT_DIR: elsewhere, ...extra };
  }

  function logAs(cwd: string, ...args: string[]) {
    const r = spawnSync("bash", [join(root, "scripts/log-agent-run.sh"), ...args], {
      cwd,
      input: "",
      encoding: "utf8",
      env: isolatedEnv(),
    });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  function checkRuns(cwd: string, body: string, headRef: string) {
    const r = spawnSync("bash", [join(root, "scripts/check-agent-runs.sh")], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, BODY: body, HEAD_REF: headRef },
    });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("AC1 log-agent-run.sh --as qa-tdd appends one '<time> qa-tdd via-general-purpose' line to the branch log", () => {
    const dir = agentRepo("a/b", ["qa-tdd"]);
    const r = logAs(dir, "--as", "qa-tdd");
    expect(r.status, r.out).toBe(0);
    const logPath = join(dir, ".claude/agent-runs/a-b.log");
    expect(existsSync(logPath), "--as must write .claude/agent-runs/a-b.log").toBe(true);
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ qa-tdd via-general-purpose$/);
  });

  it.each([["../x"], [""], ["QA-TDD"]])("AC2 --as rejects bad agent name %j: non-zero exit, no log written", (name) => {
    const dir = agentRepo("a/b", ["qa-tdd"]);
    const r = logAs(dir, "--as", name);
    expect(r.status, `--as ${JSON.stringify(name)} must fail; output: ${r.out}`).not.toBe(0);
    expect(existsSync(join(dir, ".claude/agent-runs")), "no run log may be written").toBe(false);
  });

  it("AC3 hook mode (no args) still logs '<time> engineer' from stdin JSON, and exits 0 on bad JSON", () => {
    const dir = agentRepo("a/b", ["engineer"]);
    const ok = spawnSync("bash", [join(root, "scripts/log-agent-run.sh")], {
      input: JSON.stringify({ tool_input: { subagent_type: "engineer", prompt: "PROMPT-TEXT" } }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    expect(ok.status, ok.stderr).toBe(0);
    const log = readFileSync(join(dir, ".claude/agent-runs/a-b.log"), "utf8");
    expect(log).toMatch(new RegExp(TIME.source + " engineer\\n$"));
    expect(log.split("\n").filter(Boolean)).toHaveLength(1);

    const bad = spawnSync("bash", [join(root, "scripts/log-agent-run.sh")], {
      input: "{not json",
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    expect(bad.status, "the hook never blocks").toBe(0);
    expect(readFileSync(join(dir, ".claude/agent-runs/a-b.log"), "utf8")).toBe(log);
  });

  it("AC4 check-agent-runs.sh counts '<time> qa-tdd via-general-purpose' as a qa-tdd run (verify stubbed, run 3x)", () => {
    const dir = agentRepo("feat/x", ["qa-tdd"], {
      ".claude/agent-runs/feat-x.log": "2026-11-22T00:00:00Z qa-tdd via-general-purpose\n",
      "studio-checks.json": JSON.stringify({ agents: { verify: "echo run >> verify-runs.txt", runs: 3 } }),
    });
    const r = checkRuns(dir, "Summary\n\nAgents: qa-tdd green 3x\n", "feat/x");
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(join(dir, "verify-runs.txt"), "utf8")).toBe("run\nrun\nrun\n");
  });

  it.each([
    ["a non-general-purpose suffix", "2026-11-22T00:00:00Z engineer via-something-else\n"],
    ["no entry", "2026-11-22T00:00:00Z qa-tdd\n"],
  ])("AC5 check-agent-runs.sh fails a named engineer with %s, and the error points to agent-prompt.sh", (_case, log) => {
    const dir = agentRepo("feat/x", ["qa-tdd", "engineer"], { ".claude/agent-runs/feat-x.log": log });
    const r = checkRuns(dir, "Agents: engineer built it\n", "feat/x");
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/::error::.*'engineer'/);
    expect(r.out).toMatch(/::error::.*agent-prompt\.sh/);
  });

  it("AC6 agent-prompt.sh prints the qa-tdd prompt with the --as log step and the task; an unknown agent exits 1", () => {
    const r = spawnSync("bash", ["scripts/agent-prompt.sh", "qa-tdd", "test"], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("studio agent qa-tdd");
    expect(r.stdout).toContain("log-agent-run.sh --as qa-tdd");
    const at = r.stdout.lastIndexOf("## Your task");
    expect(at, "has a '## Your task' heading").toBeGreaterThan(-1);
    expect(r.stdout.slice(at + "## Your task".length).trim()).toBe("test");

    const bad = spawnSync("bash", ["scripts/agent-prompt.sh", "no-such-agent", "test"], { cwd: root, encoding: "utf8" });
    expect(bad.status).toBe(1);
  });

  /** The `run: |` block of the named step in agents-check.yml, dedented (no YAML parser dependency). */
  function stepRun(stepName: string) {
    const lines = read(".github/workflows/agents-check.yml").split("\n");
    const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
    expect(at, `step '${stepName}' in agents-check.yml`).toBeGreaterThan(-1);
    const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
    expect(runAt).toBeGreaterThan(at);
    const indent = lines[runAt].search(/\S/);
    const body: string[] = [];
    for (const l of lines.slice(runAt + 1)) {
      if (l.trim() !== "" && l.search(/\S/) <= indent) break;
      body.push(l);
    }
    const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
    return body.map((l) => l.slice(pad)).join("\n");
  }

  /** A repo with a base commit and a head commit that changes `changed`; runs the step with BODY. */
  function runAgentsLineStep(changed: string, body: string) {
    const dir = agentRepo("main", [], { "README.md": "base\n" });
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "base", "--no-verify");
    const base = git(dir, "rev-parse", "HEAD").trim();
    mkdirSync(join(dir, changed, ".."), { recursive: true });
    writeFileSync(join(dir, changed), "changed\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "head", "--no-verify");
    const head = git(dir, "rev-parse", "HEAD").trim();
    const r = spawnSync("bash", ["-e", "-c", stepRun("Agents line in the PR body")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, BASE: base, HEAD: head, BODY: body },
    });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("AC7a a code PR (scripts/) with 'qa-tdd skipped: no time' fails the Agents-line step", () => {
    const r = runAgentsLineStep("scripts/x.sh", "Agents: staff-pm scoped it; qa-tdd skipped: no time\n");
    expect(r.status, `must fail; output: ${r.out}`).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  it.each([["docs only"], ["config only"]])("AC7b a code PR with 'qa-tdd skipped: %s' passes", (reason) => {
    const r = runAgentsLineStep("scripts/x.sh", `Agents: staff-pm scoped it; qa-tdd skipped: ${reason}\n`);
    expect(r.status, r.out).toBe(0);
  });

  it("AC7c a docs-only PR passes with any skip reason", () => {
    const r = runAgentsLineStep("docs/notes.md", "Agents: staff-pm scoped it; qa-tdd skipped: no time\n");
    expect(r.status, r.out).toBe(0);
  });

  it("AC8 agents-check.yml keeps pinned SHAs, cache: npm, and npm ci && npm run build before the run-log step", () => {
    const wf = read(".github/workflows/agents-check.yml");
    expect(wf).not.toMatch(/uses:\s*\S+@v\d/);
    for (const m of wf.matchAll(/uses:\s*(\S+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(wf).toMatch(/^\s+cache: npm\s*$/m);
    const build = wf.indexOf("npm ci && npm run build");
    const runLog = wf.indexOf("- name: Agents line matches the run log");
    expect(build, "npm ci && npm run build present").toBeGreaterThan(-1);
    expect(runLog, "run-log step present").toBeGreaterThan(-1);
    expect(build).toBeLessThan(runLog);
  });

  it("AC9 CLAUDE.md's Studio agents section matches the studio template except the allowed ccwatts differences", () => {
    const claude = read("CLAUDE.md");
    expect(claude, "CLAUDE.md never says Charlie").not.toMatch(/Charlie/);
    const section = (md: string) => {
      const at = md.indexOf("## Studio agents");
      expect(at).toBeGreaterThan(-1);
      const end = md.indexOf("\n## ", at + 1);
      return md.slice(at, end === -1 ? undefined : end);
    };
    const norm = (s: string) =>
      s
        .split("\n")
        .map((l) => l.trimEnd())
        .join("\n")
        .replace(/\n{2,}/g, "\n\n")
        .trim();

    let ours = section(claude);
    expect(ours).toContain("Hi Chase, I'm your CCWatts chief of staff");
    expect(ours).toMatch(/\| `release-captain` \|/);
    const checker =
      " In this repo the checker is `npx tsx scripts/check-qa-report.ts <report>` (the TypeScript port of studio-agents' `check-qa-report.mjs`).";
    expect(ours, "check-qa-report.ts checker line stays").toContain(checker);
    ours = ours.replace(checker, "");
    const notes = ours.split("\n").find((l) => l.startsWith("**Repo notes for agents.**"));
    expect(notes, "Repo notes for agents paragraph stays").toBeTruthy();
    expect(notes).toContain("docs/eng/AGENT-NOTES.md");
    ours = ours.replace(notes!, "");

    const template = section(read("packages/cli/test/fixtures/studio-agents/CLAUDE-agents.md")).replace(
      "Hi Chase, I'm Charlie's chief of staff",
      "Hi Chase, I'm your CCWatts chief of staff",
    );
    expect(norm(ours)).toBe(norm(template));

    const roster = spawnSync("bash", ["scripts/check-agents.sh"], { cwd: root, encoding: "utf8" });
    expect(roster.status, roster.stdout + roster.stderr).toBe(0);
  });

  it("AC10 check-logs.mjs is gone and the TypeScript check-logs.ts is the one in use", () => {
    expect(existsSync(join(root, "scripts/check-logs.mjs"))).toBe(false);
    expect(existsSync(join(root, "scripts/check-logs.ts"))).toBe(true);
  });

  // Diff-scoped half of AC10 and AC11: only meaningful against the PR's base, so it runs when
  // QA_DIFF_BASE is set (e.g. QA_DIFF_BASE=origin/main npx vitest run packages/cli/test/repo.test.ts).
  it.runIf(!!process.env.QA_DIFF_BASE)("AC10/AC11 the #104 diff leaves check-logs.ts and the out-of-scope files untouched", () => {
    const base = process.env.QA_DIFF_BASE!;
    const changed = [
      ...git(root, "diff", "--name-only", base).split("\n"),
      ...git(root, "ls-files", "--others", "--exclude-standard").split("\n"),
    ].filter(Boolean);
    const forbidden = changed.filter((f) =>
      [
        /^scripts\/check-logs\.ts$/,
        /^\.claude\/settings\.json$/,
        /^studio-checks\.json$/,
        /^\.github\/workflows\/(handoff-check|pages|publish)\.yml$/,
        /^packages\/web\//,
        /^plugins\//,
      ].some((re) => re.test(f)),
    );
    expect(forbidden).toEqual([]);
  });
});
