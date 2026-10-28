import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// PS-R3 (privacy-security, CCW-M2.6.4): the plugin's skills must not pre-approve running any
// node script. Each allowed Bash(node …) entry has to name the bundled CLI, not `node *`.
const skills = fileURLToPath(new URL("../../../plugins/ccwatts/skills/", import.meta.url));
const files = readdirSync(skills).map((d) => join(skills, d, "SKILL.md"));

describe("plugin skills (PS-R3)", () => {
  it("coverage: finds the plugin's SKILL.md files", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files.map((f) => [f.split(/[\\/]/).at(-2)!, f]))("PS-R3 RED: %s allowed-tools has no bare Bash(node *)", (_name, file) => {
    const allowed = /^allowed-tools:(.*)$/m.exec(readFileSync(file, "utf8"))?.[1] ?? "";
    expect(allowed).not.toMatch(/Bash\(node \*\)/);
  });
});
