// Copies the built CLI (packages/cli/dist/index.js, core and dashboard bundled in) and its MCP
// server (dist/mcp.js, which index.js loads from next to itself for `ccwatts mcp`) into the
// Claude Code plugin. An installed plugin is copied out of the repo, so it can't reach
// packages/, and the bundle is committed. CI fails if it is out of date.
import { chmodSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const files = [
  ["index.js", "ccwatts.js"],
  ["mcp.js", "mcp.js"],
];
for (const [src, dest] of files) {
  const from = fileURLToPath(new URL(`../packages/cli/dist/${src}`, import.meta.url));
  const to = fileURLToPath(new URL(`../plugins/ccwatts/bin/${dest}`, import.meta.url));
  copyFileSync(from, to);
  if (dest === "ccwatts.js") chmodSync(to, 0o755);
  console.log(`Wrote plugins/ccwatts/bin/${dest}`);
}
