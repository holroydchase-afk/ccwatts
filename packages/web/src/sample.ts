// Build-time only: turns the synthetic demo fixture into rollups for "Try sample data".
import { readFileSync } from "node:fs";
import { claudeCodeAdapter, clockHour, defaultParams, paceNotes, rollup, samplePaceDays } from "@ccwatts/core";

export function sampleRows(fixturePath: string) {
  return rollup(claudeCodeAdapter.parse(readFileSync(fixturePath, "utf8")));
}

/** Synthetic pace days ending on the energy sample's last day, so both read as the same month. */
export function samplePace(lastDate: string) {
  return samplePaceDays(lastDate);
}

/** The pace method notes, from params.json, written into the page at build (same words as the CLI). */
export const paceNoteLines = () => paceNotes(defaultParams);

/** "10pm": where late night starts, from params.json. */
export const paceLateLabel = () => clockHour(defaultParams.pace.late_night.start_hour);
