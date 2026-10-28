import { defineConfig } from "tsup";

export default defineConfig({
  // The MCP server is its own file: the SDK is most of its size, and only `ccwatts mcp` loads it.
  entry: ["src/index.ts", "src/mcp.ts"],
  format: ["esm"],
  splitting: false,
  clean: true,
  // Bundle the core in so the published CLI has no runtime dependencies.
  // The MCP SDK and zod are bundled too, so `npx ccwatts` still installs nothing else.
  noExternal: ["@ccwatts/core", "@ccwatts/web", "@modelcontextprotocol/sdk", "zod"],
  // The dashboard page (packages/web/dist/ccwatts.html) ships inside the CLI as a string.
  loader: { ".html": "text" },
});
