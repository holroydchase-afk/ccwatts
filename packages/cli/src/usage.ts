import {
  estimate,
  mergeHistory,
  rollup,
  rollupRecords,
  since,
  type Estimate,
  type Params,
  type RollupRow,
  type UsageRecord,
  type Window,
} from "@ccwatts/core";
import { sampleRows } from "./dashboard.js";
import { reason } from "./errors.js";
import { defaultLogRoots, loadLogs } from "./logs.js";
import { readHistory, writeHistory } from "./store.js";

export interface UsageOptions {
  /** Estimate just this folder or .jsonl file; history is left alone. */
  path?: string | undefined;
  /** Synthetic sample data, no logs needed; history is left alone. */
  demo?: boolean | undefined;
  /** Don't read or update ~/.ccwatts/history.jsonl. */
  noHistory?: boolean | undefined;
}

export interface Usage {
  /** Daily rollups: logs on disk merged with stored history. */
  rows: RollupRow[];
  /** Raw records from the logs on disk now, for hour-level windows. */
  records: UsageRecord[];
  /** Folders searched for logs (full paths: print them to the user's own terminal only). */
  roots: string[];
  /** Where --since counts back from: today, or the last day of the sample. */
  now: Date;
  sample: boolean;
}

/** Loads usage the way every command does: logs, merged with history unless --path, --demo or --no-history. */
export async function loadUsage(options: UsageOptions): Promise<Usage> {
  const demo = Boolean(options.demo);
  const logs = demo ? { roots: [], files: 0, records: [] } : await loadLogs(options.path ? [options.path] : defaultLogRoots());
  const sample = demo ? sampleRows() : [];
  // The sample is a fixed month in the past: count --since back from its last day.
  const now = demo ? new Date(`${sample.map((r) => r.date).sort().at(-1)}T23:59:59Z`) : new Date();

  // History keeps daily token counts so usage survives Claude Code's log cleanup.
  let rows = demo ? sample : rollup(logs.records);
  // --path estimates exactly what you point it at (often the sample data), so it never mixes
  // into or writes your personal history. Relocated logs use CLAUDE_CONFIG_DIR instead.
  if (!options.noHistory && !options.path && !demo) {
    const stored = await readHistory().catch((error: unknown) => {
      const why = reason(error);
      console.error(`Couldn't read history (${why}). Using current logs only.`);
      return [];
    });
    rows = mergeHistory(stored, rows);
    // History is a convenience: a read-only home folder shouldn't stop the estimate.
    if (logs.records.length > 0) {
      await writeHistory(rows).catch((error: unknown) => {
        const why = reason(error);
        console.error(`Couldn't save history (${why}). Continuing without it.`);
      });
    }
  }
  return { rows, records: logs.records, roots: logs.roots, now, sample: demo };
}

/** Rows inside a window. Day rollups are cut by date. */
export const rowsIn = (rows: readonly RollupRow[], window: Window) =>
  window.start ? rows.filter((r) => r.date >= window.start!.slice(0, 10)) : [...rows];

/** Estimates one window: day rollups normally, raw records for hour-level windows. */
export function estimateWindow(usage: Pick<Usage, "rows" | "records">, window: Window, params: Params): Estimate {
  const hourly = Boolean(window.start && window.label.includes("hour"));
  const inWindow = rowsIn(usage.rows, window);
  // Day rollups are coarse; within the window, raw records give exact hour-level cuts.
  const e = estimate(hourly ? since(usage.records, window.start!) : rollupRecords(inWindow), params);
  // Rollups hold one record per day/model/project, so count responses from the rows instead.
  if (!hourly) e.responses = inWindow.reduce((n, r) => n + r.responses, 0);
  return e;
}
