#!/usr/bin/env tsx
// Run the showcase checks on any built page, and optionally take review screenshots.
//   tsx tools/showcase-check/cli.ts <file or url> [--reach id,id] [--min-text 12] [--shots dir]
// Exits 1 when it finds a problem. See README.md for setup.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { showcaseCheck } from "./check.ts";
import { screenshots } from "./shots.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { reach: { type: "string" }, "min-text": { type: "string" }, shots: { type: "string" } },
});
const target = positionals[0];
if (!target) {
  console.error("Usage: cli.ts <file or url> [--reach id,id] [--min-text 12] [--shots dir]");
  process.exit(2);
}
const url = existsSync(target) ? pathToFileURL(resolve(target)).href : target;

const problems = await showcaseCheck({
  url,
  keyboardReach: values.reach ? values.reach.split(",") : [],
  minTextPx: Number(values["min-text"] ?? 0),
});
if (values.shots) {
  for (const file of await screenshots({ url, outDir: values.shots })) console.log(`screenshot: ${file}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Showcase check passed at 390 and 1280px, light and dark.");
