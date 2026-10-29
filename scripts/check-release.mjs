#!/usr/bin/env node
// Release check (release-captain agent). Proves a package is safe to publish, without publishing:
//   1. no runtime dependency that can't install from npm (workspace:, file:, link:, or a workspace name)
//   2. `npm pack` ships only the allowlisted files
//   3. the tarball installs into an empty project with an empty HOME, offline
//   4. each smoke command exits 0 there, `--version` prints the package version, and no output
//      contains the temp folder's full path
//   5. other manifests that carry a version (plugin.json, …) are listed if they differ (a warning)
// Config: studio-checks.json at the repo root, section "release":
//   { "release": { "package": "packages/cli", "allowFiles": ["package.json", "dist/**"],
//                  "smoke": [["--version"], ["--demo"]], "versions": ["plugins/x/plugin.json"] } }
// Usage, after the build: node scripts/check-release.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `dir/**` matches anything under dir; anything else must match exactly. */
export const matchesAny = (file, globs) =>
  globs.some((g) => (g.endsWith("/**") ? file.startsWith(g.slice(0, -2)) : file === g));

export const unexpectedFiles = (files, allow) => files.filter((f) => !matchesAny(f, allow));

export function badDeps(pkg, workspaceNames) {
  return Object.entries(pkg.dependencies ?? {})
    .filter(([name, range]) => /^(workspace|file|link):/.test(range) || workspaceNames.includes(name))
    .map(([name]) => name);
}

export const versionDrift = (version, others) =>
  Object.entries(others).filter(([, v]) => v !== version).map(([file, v]) => `${file} is ${v}, package is ${version}`);

function workspaceNames(root) {
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return (rootPkg.workspaces ?? [])
    .map((w) => join(root, w, "package.json"))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, "utf8")).name);
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const configFile = resolve(root, process.env.STUDIO_CHECKS || "studio-checks.json");
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")).release : null;
  if (!config) {
    console.error('No "release" section in studio-checks.json; nothing to check.');
    process.exit(2);
  }
  const dir = resolve(root, config.package);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const problems = [];
  const warnings = [];

  const deps = badDeps(pkg, workspaceNames(root).filter((n) => n !== pkg.name));
  if (deps.length) problems.push(`runtime dependencies that won't install from npm: ${deps.join(", ")}`);

  const tmp = mkdtempSync(join(tmpdir(), "release-check-"));
  try {
    const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
    const extra = unexpectedFiles(packed.files.map((f) => f.path), config.allowFiles);
    if (extra.length) problems.push(`tarball ships files outside allowFiles: ${extra.join(", ")}`);
    console.log(`packed ${packed.filename}: ${packed.files.length} files, ${(packed.size / 1024).toFixed(0)} KB`);

    const project = join(tmp, "project");
    const home = join(tmp, "home");
    mkdirSync(project);
    mkdirSync(home);
    writeFileSync(join(project, "package.json"), '{"name":"release-check","private":true}');
    const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), NO_COLOR: "1" };
    const install = spawnSync("npm", ["install", "--offline", "--no-audit", "--no-fund", join(tmp, packed.filename)], { cwd: project, env, encoding: "utf8" });
    if (install.status !== 0) {
      problems.push(`tarball doesn't install in an empty project offline: ${install.stderr.trim().split("\n").pop()}`);
    } else {
      const bin = Object.keys(typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin ?? {})[0];
      for (const args of config.smoke ?? [["--version"]]) {
        const run = spawnSync(join(project, "node_modules/.bin", bin), args, { cwd: project, env, encoding: "utf8", timeout: 30000 });
        const out = `${run.stdout}${run.stderr}`;
        const label = [bin, ...args].join(" ");
        if (run.status !== 0) problems.push(`\`${label}\` exited ${run.status} in an empty HOME: ${out.trim().split("\n")[0]}`);
        if (out.includes(tmp)) problems.push(`\`${label}\` prints a full path`);
        if (args[0] === "--version" && !out.includes(pkg.version)) problems.push(`\`${label}\` doesn't print ${pkg.version}`);
        if (run.status === 0) console.log(`ok: ${label}`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const others = Object.fromEntries((config.versions ?? []).map((f) => [f, JSON.parse(readFileSync(join(root, f), "utf8")).version]));
  warnings.push(...versionDrift(pkg.version, others));

  for (const w of warnings) console.log(`warning: ${w}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`Release check passed for ${pkg.name}@${pkg.version}. Nothing was published.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
