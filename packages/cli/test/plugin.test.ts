import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// CCW-M2.6.5b: the plugin also registers the `ccwatts mcp` server, so /plugin install brings the
// four MCP tools. Claude Code reads `.mcp.json` at the plugin root and/or `mcpServers` in plugin.json.
const plugin = fileURLToPath(new URL("../../../plugins/ccwatts/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function pluginMcpServers(): Record<string, { command?: string; args?: string[] }> {
  const servers: Record<string, { command?: string; args?: string[] }> = {};
  const dotMcp = join(plugin, ".mcp.json");
  if (existsSync(dotMcp)) Object.assign(servers, JSON.parse(readFileSync(dotMcp, "utf8")).mcpServers ?? {});
  const manifest = JSON.parse(readFileSync(join(plugin, ".claude-plugin/plugin.json"), "utf8"));
  if (manifest.mcpServers && typeof manifest.mcpServers === "object" && !Array.isArray(manifest.mcpServers)) Object.assign(servers, manifest.mcpServers);
  return servers;
}

describe("plugin MCP server (CCW-M2.6.5b)", () => {
  it("PM-1 RED: registers a ccwatts MCP server that runs ${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js mcp", () => {
    const server = pluginMcpServers().ccwatts;
    expect(server, "no ccwatts server in .mcp.json or plugin.json mcpServers").toBeDefined();
    const argv = [server!.command, ...(server!.args ?? [])];
    expect(argv).toContain("${CLAUDE_PLUGIN_ROOT}/bin/ccwatts.js");
    expect(argv.at(-1)).toBe("mcp");
    // Local only: no npx (network fetch) and no other arguments beyond the subcommand.
    expect(argv.join(" ")).not.toMatch(/npx|https?:/);
  });

  it("PM-2 RED: build-plugin puts mcp.js next to ccwatts.js, matching the CLI build", () => {
    const bundled = join(plugin, "bin/mcp.js");
    expect(existsSync(bundled), "plugins/ccwatts/bin/mcp.js is missing").toBe(true);
    const built = join(repoRoot, "packages/cli/dist/mcp.js");
    // CI runs `npm run build` before `npm test`; locally the dist may not exist yet.
    if (existsSync(built)) expect(readFileSync(bundled).equals(readFileSync(built)), "bin/mcp.js differs from packages/cli/dist/mcp.js").toBe(true);
    expect(readFileSync(join(repoRoot, "scripts/build-plugin.mjs"), "utf8")).toMatch(/mcp\.js/);
  });

  it("PM-4 RED: CI's plugin-bundle step also checks bin/mcp.js", () => {
    const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const step = ci.slice(ci.indexOf("Plugin bundle is up to date"));
    const run = /run:\s*(.*)/.exec(step)?.[1] ?? "";
    // Either names mcp.js or checks the whole bin/ folder.
    expect(run).toMatch(/plugins\/ccwatts\/bin\/(mcp\.js|\s|$)|plugins\/ccwatts\/bin(\s|$)/);
  });
});
