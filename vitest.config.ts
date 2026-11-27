import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against core's source, so tests don't need a build first.
    alias: { "@ccwatts/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      // `npm run coverage` fails below this floor (CI runs it). Only core is measured in-process: the CLI and
      // web run as a subprocess or in a browser, so their numbers read low. README states the same number.
      thresholds: { "packages/core/src/**": { lines: 99 } },
    },
  },
});
