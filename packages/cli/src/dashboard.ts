import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RollupRow } from "@ccwatts/core";
import { injectData, readSample } from "../../web/src/inject.js";
import template from "../../web/dist/ccwatts.html";
import { dataDir } from "./store.js";

/**
 * PS-R5: a project id is an unsalted hash of the full path, so it never goes into a file a user
 * might share. Each id becomes a short label ("1", "2", in first-seen order) that only keeps
 * same-name folders apart inside this one file. history.json keeps the real ids.
 */
export function opaqueProjectIds(rows: readonly RollupRow[]): RollupRow[] {
  const labels = new Map<string, string>();
  return rows.map((r) => {
    if (r.projectId === null) return r;
    let label = labels.get(r.projectId);
    if (!label) labels.set(r.projectId, (label = String(labels.size + 1)));
    return { ...r, projectId: label };
  });
}

/** Writes the offline dashboard with the user's rollups embedded, and returns its path. */
export async function writeDashboard(rows: RollupRow[], dir = dataDir()): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "dashboard.html");
  const html = injectData(template, { mode: "dashboard", generatedAt: new Date().toISOString(), rows: opaqueProjectIds(rows) });
  await writeFile(path, html, { mode: 0o600 });
  return path;
}

/** Opens a local file in the default browser. No network involved. */
export function openFile(path: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // Opening is a convenience; the path is printed either way.
  }
}

/** Synthetic sample rollups, the same ones the playground opens on. Counts only. */
export const sampleRows = (): RollupRow[] => readSample(template);
