import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("studio log check", () => {
  it("CCW-H8 no console.* call logs whole errors, raw messages, or URL constants", () => {
    const r = spawnSync(process.execPath, ["scripts/check-logs.mjs"], { cwd: root, encoding: "utf8" });
    // Show the check's own findings on failure, so the fix is obvious from the test output.
    expect(r.stdout + r.stderr, "node scripts/check-logs.mjs").not.toMatch(/problem\(s\)/);
    expect(r.status).toBe(0);
  });
});
