import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  // Bundle the core in so the published CLI has no runtime dependencies.
  noExternal: ["@ccwatts/core"],
});
