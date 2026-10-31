import {
  defaultPaceOptions,
  dropFuture,
  estimate,
  futureNote,
  mergeHistory,
  mergePaceHistory,
  paceDays,
  paceMethod,
  rollup,
  rollupRecords,
  since,
  type ActivityEvent,
  type Estimate,
  type PaceDay,
  type Params,
  type RollupRow,
  type UsageRecord,
  type Window,
} from "@ccwatts/core";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { sampleRows } from "./dashboard.js";
import { reason } from "./errors.js";
import { defaultLogRoots, loadLogs, unreadableNote, type LoadedLogs } from "./logs.js";
import { pacePath, readHistory, readPaceHistory, writeHistory, writePaceHistory } from "./store.js";

/** What happened to pace.jsonl this run (see Usage.paceStore). */
export type PaceStore = "none" | "read" | "unreadable" | "skipped";

export interface UsageOptions {
  /** Estimate just this folder or .jsonl file; history is left alone. */
  path?: string | undefined;
  /** Synthetic sample data, no logs needed; history is left alone. */
  demo?: boolean | undefined;
  /** Don't read or update ~/.ccwatts/history.jsonl. */
  noHistory?: boolean | undefined;
  /**
   * Count daily pace. true (`ccwatts pace`) also starts keeping ~/.ccwatts/pace.jsonl; "count"
   * (`receipt --share-pace`) counts without creating it. Once the file exists, every run updates it.
   */
  pace?: boolean | "count" | undefined;
}

export interface Usage {
  /** Daily rollups: logs on disk merged with stored history. */
  rows: RollupRow[];
  /** Daily pace counts: logs on disk merged with pace.jsonl. Empty unless pace was asked for or pace.jsonl exists. */
  pace: PaceDay[];
  /** True if this run wrote pace.jsonl. */
  paceSaved: boolean;
  /**
   * pace.jsonl this run: "none" (no file, or --demo), "read", "unreadable", or "skipped"
   * (it exists but --path or --no-history leaves it alone).
   */
  paceStore: PaceStore;
  /** Raw records from the logs on disk now, for hour-level windows. */
  records: UsageRecord[];
  /** Folders searched for logs (full paths: print them to the user's own terminal only). */
  roots: string[];
  /** .jsonl files found under the roots, so "no usage" can differ from "no logs". */
  files: number;
  /** Where --since counts back from: today, or the last day of the sample. */
  now: Date;
  sample: boolean;
  /** One-line notes about what was left out (unreadable files, future dates). No paths. */
  notes: string[];
}

/** Loads usage the way every command does: logs, merged with history unless --path, --demo or --no-history. */
export async function loadUsage(options: UsageOptions): Promise<Usage> {
  const demo = Boolean(options.demo);
  if (options.path && !demo && !(await stat(options.path).catch(() => null))) {
    // Basename only: errors can end up in a model's context (mcp) as well as the terminal.
    throw new Error(`"${basename(options.path)}" doesn't exist. Check the folder or file given to --path.`);
  }
  const logs: LoadedLogs = demo ? { roots: [], files: 0, records: [], activity: [], unreadable: [] } : await loadLogs(options.path ? [options.path] : defaultLogRoots());
  const sample = demo ? sampleRows() : [];
  // The sample is a fixed month in the past: count --since back from its last day.
  const now = demo ? new Date(`${sample.map((r) => r.date).sort().at(-1)}T23:59:59Z`) : new Date();
  // A response dated well after now is a wrong clock or a corrupt line: leave it out of the
  // estimate and of history, so it can't stretch the weekly table into the future.
  const { kept, future } = dropFuture(logs.records, now);
  logs.records = kept;
  const activity = dropFuture(logs.activity, now).kept;
  const notes = [unreadableNote(logs.unreadable), future ? futureNote(future) : null].filter((n): n is string => n !== null);

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
  const { days: pace, saved: paceSaved, store: paceStore } = await loadPace(activity, options, demo);
  return { rows, pace, paceSaved, paceStore, records: logs.records, roots: logs.roots, files: logs.files, now, sample: demo, notes };
}

/**
 * Daily pace counts in this machine's zone. Activity times never leave here: only per-day
 * minutes and whole hours are returned or stored. pace.jsonl is opt-in (created only when pace
 * is asked for) and, like history, left alone for --path, --demo and --no-history.
 */
async function loadPace(activity: ActivityEvent[], options: UsageOptions, demo: boolean): Promise<{ days: PaceDay[]; saved: boolean; store: PaceStore }> {
  if (demo) return { days: [], saved: false, store: "none" };
  const keep = !options.noHistory && !options.path;
  const result = await loadPaceDays(activity, options, keep);
  if (keep) return result;
  return { ...result, store: (await stat(pacePath()).catch(() => null)) ? "skipped" : "none" };
}

async function loadPaceDays(activity: ActivityEvent[], options: UsageOptions, keep: boolean): Promise<{ days: PaceDay[]; saved: boolean; store: PaceStore }> {
  let stored: Awaited<ReturnType<typeof readPaceHistory>> = null;
  let readFailed = false;
  if (keep) {
    stored = await readPaceHistory().catch((error: unknown) => {
      const why = reason(error);
      console.error(`Couldn't read pace history (${why}). Using current logs only.`);
      readFailed = true;
      return null;
    });
  }
  const store: PaceStore = readFailed ? "unreadable" : stored ? "read" : "none";
  if (!options.pace && !stored) return { days: [], saved: false, store };
  // The zone is read here in the CLI and never stored: core takes it as an argument.
  const paceOptions = defaultPaceOptions(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const fresh = paceDays(activity, paceOptions);
  // An unreadable pace.jsonl may hold days the logs no longer have, so it is never overwritten.
  if (!keep || readFailed || (options.pace === "count" && !stored)) return { days: fresh, saved: false, store };
  const method = paceMethod(paceOptions);
  const days = mergePaceHistory(stored?.days ?? [], fresh, JSON.stringify(stored?.method) === JSON.stringify(method));
  let saved = false;
  if (activity.length > 0) {
    saved = await writePaceHistory(days, method).then(
      () => true,
      (error: unknown) => {
        const why = reason(error);
        console.error(`Couldn't save pace history (${why}). Continuing without it.`);
        return false;
      },
    );
  }
  return { days, saved, store };
}

/** Rows inside a window. Day rollups are cut by date. */
export const rowsIn = (rows: readonly RollupRow[], window: Window) =>
  window.start ? rows.filter((r) => r.date >= window.start!.slice(0, 10)) : [...rows];

/** Estimates one window: day rollups normally, raw records for hour-level windows. */
export function estimateWindow(usage: Pick<Usage, "rows" | "records"> & Partial<Pick<Usage, "notes">>, window: Window, params: Params): Estimate {
  const hourly = Boolean(window.start && window.label.includes("hour"));
  const inWindow = rowsIn(usage.rows, window);
  // Day rollups are coarse; within the window, raw records give exact hour-level cuts.
  const e = estimate(hourly ? since(usage.records, window.start!) : rollupRecords(inWindow), params);
  // Rollups hold one record per day/model/project, so count responses from the rows instead.
  if (!hourly) e.responses = inWindow.reduce((n, r) => n + r.responses, 0);
  // Notes about skipped input travel with every estimate, so the summary, --json and MCP all say it.
  e.warnings.push(...(usage.notes ?? []));
  return e;
}
