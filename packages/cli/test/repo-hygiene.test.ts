// Repo hygiene (docs/product/SPEC-REPO-HYGIENE.md, intakes #128, #131, #134, #135, #137): the dev loop a
// contributor expects (changelog, notices, editorconfig, pre-commit, CODEOWNERS, coverage floor) is
// enforced by a test, not just present. HYG-7 and HYG-11 are manual; HYG-12 is the 3x suite run.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : "");
const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);

const SEMVER = /\d+\.\d+\.\d+/;
const DATED = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm;

describe("CHANGELOG (HYG-1, HYG-2)", () => {
  it("HYG-1 follows Keep a Changelog and semver, with Unreleased and the three npm releases", () => {
    expect(existsSync(join(root, "CHANGELOG.md")), "CHANGELOG.md exists").toBe(true);
    const log = read("CHANGELOG.md");
    expect(log).toMatch(/https?:\/\/keepachangelog\.com/);
    expect(log).toMatch(/https?:\/\/semver\.org/);
    expect(log).toMatch(/^## \[Unreleased\]\s*$/m);
    const versions = [...log.matchAll(DATED)].map((m) => m[1]);
    expect(versions).toEqual(expect.arrayContaining(["0.1.0", "0.1.1", "0.2.0"]));
    for (const m of log.matchAll(DATED)) expect(Number.isNaN(Date.parse(m[2]!)), m[0]).toBe(false);
  });

  it("HYG-2 the newest dated heading is the CLI's package.json version", () => {
    const version: string = JSON.parse(read("packages/cli/package.json")).version;
    expect(version).toMatch(SEMVER);
    const newest = [...readIf("CHANGELOG.md").matchAll(DATED)][0]?.[1];
    expect(newest, "first `## [x.y.z] - YYYY-MM-DD` heading in CHANGELOG.md").toBe(version);
  });
});

// Packages esbuild inlined into the shipped bundles, from its `// ../../node_modules/<pkg>/...` comments.
function bundledPackages(): string[] {
  const names = new Set<string>();
  for (const f of ["plugins/ccwatts/bin/ccwatts.js", "plugins/ccwatts/bin/mcp.js"]) {
    for (const m of read(f).matchAll(/^\/\/ \.\.\/\.\.\/node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm)) names.add(m[1]!);
  }
  return [...names].sort();
}

describe("Third-party notices (HYG-3, HYG-4)", () => {
  it("HYG-3 THIRD_PARTY_NOTICES.md has a section per bundled package with its license id and copyright", () => {
    const pkgs = bundledPackages();
    // Guards the parser itself: the spec's inventory found these 8 on main at 4f71b87.
    expect(pkgs).toEqual(
      expect.arrayContaining([
        "@modelcontextprotocol/sdk", "zod", "zod-to-json-schema", "ajv", "ajv-formats",
        "fast-deep-equal", "fast-uri", "json-schema-traverse",
      ]),
    );
    expect(existsSync(join(root, "THIRD_PARTY_NOTICES.md")), "THIRD_PARTY_NOTICES.md exists").toBe(true);
    const notices = read("THIRD_PARTY_NOTICES.md");
    const sections = notices.split(/^(?=#{2,3} )/m);
    for (const pkg of pkgs) {
      const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const section = sections.find((s) => new RegExp(`^#{2,3} \`?${esc}\`?(?:\\s|@|$)`).test(s));
      expect(section, `section heading for ${pkg}`).toBeDefined();
      const meta = JSON.parse(read(`node_modules/${pkg}/package.json`));
      expect(section, `${pkg} license id`).toContain(meta.license);
      const licFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].find((n) => existsSync(join(root, "node_modules", pkg, n)));
      expect(licFile, `${pkg} ships a license file`).toBeDefined();
      const copyrights = read(`node_modules/${pkg}/${licFile}`)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^Copyright\b/.test(l));
      expect(copyrights.length, `${pkg} copyright lines`).toBeGreaterThan(0);
      for (const c of copyrights) expect(section, `${pkg} copyright`).toContain(c);
    }
  });

  it("HYG-4 the npm package ships THIRD_PARTY_NOTICES.md the way it ships LICENSE", () => {
    const cli = JSON.parse(read("packages/cli/package.json"));
    expect(cli.files).toContain("THIRD_PARTY_NOTICES.md");
    expect(cli.scripts.prepack).toMatch(/cp \.\.\/\.\.\/LICENSE\b/);
    expect(cli.scripts.prepack).toMatch(/\.\.\/\.\.\/THIRD_PARTY_NOTICES\.md/);
    // The copy is a build artifact, ignored like packages/cli/LICENSE.
    expect(read(".gitignore")).toMatch(/^packages\/cli\/THIRD_PARTY_NOTICES\.md$/m);
  });
});

describe("EditorConfig (HYG-5)", () => {
  it("HYG-5a .editorconfig sets root, utf-8, LF, final newline, 2-space indent, and keeps Markdown trailing spaces", () => {
    expect(existsSync(join(root, ".editorconfig")), ".editorconfig exists").toBe(true);
    const ec = read(".editorconfig");
    expect(ec).toMatch(/^root\s*=\s*true\s*$/m);
    const star = ec.split(/^(?=\[)/m).find((s) => /^\[\*\]/.test(s)) ?? "";
    expect(star, "[*] section").toMatch(/^charset\s*=\s*utf-8\s*$/m);
    expect(star).toMatch(/^end_of_line\s*=\s*lf\s*$/m);
    expect(star).toMatch(/^insert_final_newline\s*=\s*true\s*$/m);
    expect(star).toMatch(/^indent_style\s*=\s*space\s*$/m);
    expect(star).toMatch(/^indent_size\s*=\s*2\s*$/m);
    const md = ec.split(/^(?=\[)/m).find((s) => /^\[\*\.md\]/.test(s)) ?? "";
    expect(md, "[*.md] section").toMatch(/^trim_trailing_whitespace\s*=\s*false\s*$/m);
  });

  it("HYG-5b every tracked text file has LF endings, no tab indent and a final newline", () => {
    const BINARY = /\.(png|gif|ico|jpe?g|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;
    const bad: string[] = [];
    for (const f of tracked) {
      if (/^plugins\/ccwatts\/bin\/[^/]+\.js$/.test(f) || BINARY.test(f) || !existsSync(join(root, f))) continue;
      const buf = readFileSync(join(root, f));
      if (buf.length === 0 || buf.includes(0)) continue;
      const text = buf.toString("utf8");
      if (text.includes("\r\n")) bad.push(`${f}: CRLF`);
      if (/^\t/m.test(text)) bad.push(`${f}: tab indent`);
      if (!text.endsWith("\n")) bad.push(`${f}: no final newline`);
    }
    expect(bad).toEqual([]);
  });
});

// HYG-6 runs the real hook in a scratch repo, with npx, npm, eslint and tsx stubbed on PATH. Each stub
// logs its argv and fails when the line contains $FAIL_ON, so the test sees which steps ran, with which
// files, and whether a failing step stops the commit.
describe("pre-commit hook (HYG-6)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ccwatts-hyg6-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const repo = join(dir, "repo");
  const logFile = join(dir, "calls.log");
  spawnSync("mkdir", ["-p", bin, repo]);
  for (const tool of ["npx", "npm", "eslint", "tsx"]) {
    const stub = join(bin, tool);
    writeFileSync(
      stub,
      `#!/bin/sh\nline="${tool} $*"\necho "$line" >> "$CALLS"\nif [ -n "$FAIL_ON" ]; then case "$line" in *"$FAIL_ON"*) exit 1;; esac; fi\nexit 0\n`,
    );
    chmodSync(stub, 0o755);
  }
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");

  function runHook(staged: Record<string, string>, failOn = "") {
    git("rm", "-rq", "--cached", "--ignore-unmatch", ".");
    for (const [f, body] of Object.entries(staged)) {
      writeFileSync(join(repo, f), body);
      git("add", f);
    }
    writeFileSync(logFile, "");
    const r = spawnSync("sh", [join(root, ".githooks/pre-commit")], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: logFile, FAIL_ON: failOn },
    });
    return { status: r.status, calls: readFileSync(logFile, "utf8").split("\n").filter(Boolean) };
  }

  it("HYG-6a runs check-private --staged, eslint on staged .ts/.tsx only, and npm run typecheck", () => {
    const { status, calls } = runHook({ "a.ts": "export const a = 1;\n", "b.tsx": "export {};\n", "c.md": "# c\n" });
    expect(status).toBe(0);
    expect(calls.some((c) => /check-private\.ts --staged/.test(c)), "check-private --staged ran").toBe(true);
    const lint = calls.filter((c) => /\beslint\b/.test(c));
    expect(lint.length, "eslint ran").toBeGreaterThan(0);
    const linted = lint.join(" ");
    expect(linted).toMatch(/\ba\.ts\b/);
    expect(linted).toMatch(/\bb\.tsx\b/);
    expect(linted).not.toMatch(/\bc\.md\b/);
    expect(calls.some((c) => /^npm run typecheck\b/.test(c)), "npm run typecheck ran").toBe(true);
  });

  it("HYG-6b skips eslint when no .ts/.tsx file is staged", () => {
    const { status, calls } = runHook({ "c.md": "# c\n" });
    expect(status).toBe(0);
    expect(calls.filter((c) => /\beslint\b/.test(c))).toEqual([]);
    expect(calls.some((c) => /check-private\.ts --staged/.test(c))).toBe(true);
  });

  it.each([
    ["check-private", "check-private.ts"],
    ["eslint", "eslint"],
    ["typecheck", "run typecheck"],
  ])("HYG-6c exits non-zero when %s fails", (_step, failOn) => {
    const { status, calls } = runHook({ "a.ts": "export const a = 1;\n" }, failOn);
    expect(calls.some((c) => c.includes(failOn)), `${failOn} step ran`).toBe(true);
    expect(status).not.toBe(0);
  });
});

describe("CODEOWNERS (HYG-8)", () => {
  it("HYG-8 a `*` rule is owned by the repo owner", () => {
    const owners = readIf(".github/CODEOWNERS");
    expect(owners).toMatch(/^\*\s+(?:\S+\s+)*@holroydchase-afk\b/m);
  });
});

describe("Coverage floor (HYG-9, HYG-10)", () => {
  it("HYG-9 vitest has a packages/core line threshold and README states the same number with the command", async () => {
    const cfg = (await import(pathToFileURL(join(root, "vitest.config.ts")).href)).default;
    const thresholds = cfg?.test?.coverage?.thresholds ?? {};
    const key = Object.keys(thresholds).find((k) => k.startsWith("packages/core/src"));
    expect(key, "coverage.thresholds key for packages/core/src/**").toBeDefined();
    const floor = thresholds[key!]?.lines;
    expect(typeof floor, "lines threshold").toBe("number");
    const readme = read("README.md");
    const m = readme.match(/packages\/core`? line coverage (?:is )?at least (\d+(?:\.\d+)?)%/);
    expect(m, 'README says "packages/core line coverage at least N%"').not.toBeNull();
    expect(Number(m![1])).toBe(floor);
    expect(readme).toMatch(/npm run coverage/);
  });

  it("HYG-10 CI runs npm run coverage, so the floor fails the build", () => {
    expect(read(".github/workflows/ci.yml")).toMatch(/^\s*(?:-\s+)?run:\s*npm run coverage\b/m);
  });
});
