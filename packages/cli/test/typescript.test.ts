// TS-1: the whole product is TypeScript. Hand-written code is .ts; the only JavaScript in the
// repo is the generated plugin bundles, and .gitattributes marks them so GitHub's language bar
// counts the real source.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const GENERATED = ["plugins/ccwatts/bin/ccwatts.js", "plugins/ccwatts/bin/mcp.js"];

describe("TypeScript only (TS-1)", () => {
  it("TS-1a has no hand-written .js, .mjs or .cjs files", () => {
    const js = tracked.filter((f) => /\.[mc]?jsx?$/.test(f) && !GENERATED.includes(f));
    expect(js).toEqual([]);
  });

  it("TS-1b marks the plugin bundles as generated for GitHub's language bar", () => {
    const attrs = read(".gitattributes");
    expect(attrs).toMatch(/^plugins\/ccwatts\/bin\/\*\.js\s+.*linguist-generated/m);
    for (const f of GENERATED) {
      const r = spawnSync("git", ["check-attr", "linguist-generated", "--", f], { cwd: root, encoding: "utf8" });
      expect(r.stdout, f).toMatch(/linguist-generated: (set|true)/);
    }
  });

  it("TS-1c npm scripts, workflows and the git hook run no .mjs file", () => {
    const pkg = JSON.parse(read("package.json"));
    const web = JSON.parse(read("packages/web/package.json"));
    for (const cmd of [...Object.values(pkg.scripts), ...Object.values(web.scripts)]) expect(cmd).not.toMatch(/\.mjs\b/);
    // Any repo path ending in .mjs; Playwright's own index.mjs (installed outside the repo) is fine.
    for (const wf of tracked.filter((f) => f.startsWith(".github/workflows/")))
      expect(read(wf).replace(/playwright\/index\.mjs/g, ""), wf).not.toMatch(/\.mjs\b/);
    expect(read(".githooks/pre-commit")).not.toMatch(/\.mjs\b/);
  });

  it("TS-1d typecheck covers the scripts and tools", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.typecheck).toMatch(/tsc -p tsconfig\.scripts\.json/);
    const cfg = JSON.parse(read("tsconfig.scripts.json"));
    expect(cfg.include).toEqual(expect.arrayContaining(["scripts", "tools", "packages/web/build.ts"]));
  });

  it("TS-1e keeps Node 20: scripts run through tsx, not Node's type stripping", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.devDependencies.tsx).toBeTruthy();
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/strip-types/);
  });
});
