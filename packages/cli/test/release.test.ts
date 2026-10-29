// Release captain's mechanical checks (scripts/check-release.mjs): the pure parts. The full run
// (pack, install in an empty HOME, smoke commands) is `npm run check:release` after a build.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script, no types
import { badDeps, matchesAny, unexpectedFiles, versionDrift } from "../../../scripts/check-release.mjs";

describe("check-release (REL)", () => {
  it("REL-1 file globs: dist/** matches nested files, exact names match only themselves", () => {
    expect(matchesAny("dist/index.js", ["dist/**"])).toBe(true);
    expect(matchesAny("dist/a/b.js", ["dist/**"])).toBe(true);
    expect(matchesAny("README.md", ["README.md"])).toBe(true);
    expect(matchesAny("src/index.ts", ["dist/**", "README.md"])).toBe(false);
  });

  it("REL-2 flags packed files outside the allowlist", () => {
    const files = ["package.json", "dist/index.js", "README.md", "fixtures/real.jsonl", ".env"];
    expect(unexpectedFiles(files, ["package.json", "README.md", "dist/**"])).toEqual(["fixtures/real.jsonl", ".env"]);
  });

  it("REL-3 flags runtime deps that can't install from npm (workspace, file, link, unpublished workspace names)", () => {
    const pkg = { dependencies: { "@ccwatts/core": "0.0.0", a: "workspace:*", b: "file:../b", c: "link:../c", ok: "^1.0.0" } };
    expect(badDeps(pkg, ["@ccwatts/core"])).toEqual(["@ccwatts/core", "a", "b", "c"]);
    expect(badDeps({}, ["@ccwatts/core"])).toEqual([]);
  });

  it("REL-4 reports manifests whose version differs from the package's", () => {
    expect(versionDrift("0.1.1", { "plugin.json": "0.1.2", "other.json": "0.1.1" })).toEqual(["plugin.json is 0.1.2, package is 0.1.1"]);
  });
});
