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
