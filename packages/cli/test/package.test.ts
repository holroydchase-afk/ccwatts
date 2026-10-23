import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("published package", () => {
  // The core and web page are bundled in by tsup, and @ccwatts/core is never published,
  // so any runtime dependency would make `npm install ccwatts` fail with a 404.
  it("has no runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("ships only the built CLI, its README and the license", () => {
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(pkg.bin.ccwatts).toBe("dist/index.js");
  });
});
