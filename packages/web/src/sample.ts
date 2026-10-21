// Build-time only: turns the synthetic demo fixture into rollups for "Try sample data".
import { readFileSync } from "node:fs";
import { claudeCodeAdapter, rollup } from "@ccwatts/core";

export function sampleRows(fixturePath: string) {
  return rollup(claudeCodeAdapter.parse(readFileSync(fixturePath, "utf8")));
}
