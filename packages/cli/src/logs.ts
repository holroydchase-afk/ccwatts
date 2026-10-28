import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter, dedupe, type UsageRecord } from "@ccwatts/core";
import { reason } from "./errors.js";

/** Where Claude Code keeps session logs. CLAUDE_CONFIG_DIR may hold a comma-separated list. */
export function defaultLogRoots(): string[] {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.split(",").map((dir) => join(dir.trim(), "projects"));
  if (fromEnv?.length) return fromEnv;
  return [join(homedir(), ".claude", "projects"), join(homedir(), ".config", "claude", "projects")];
}

async function findJsonl(dir: string): Promise<string[]> {
  // --path may point straight at one log file.
  if (dir.endsWith(".jsonl") && (await stat(dir).catch(() => null))?.isFile()) return [dir];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => join(e.parentPath, e.name));
}

export interface LoadedLogs {
  roots: string[];
  files: number;
  records: UsageRecord[];
  /** One reason code (EACCES, EISDIR, …) per file that couldn't be read. Never a path. */
  unreadable: string[];
}

/**
 * Reads every Claude Code log under the roots. Only token counts leave this function.
 * A file that can't be read is skipped and counted, so one bad file never stops the estimate.
 */
export async function loadLogs(roots: string[]): Promise<LoadedLogs> {
  const files = (await Promise.all(roots.map(findJsonl))).flat();
  const unreadable: string[] = [];
  const parsed = await Promise.all(
    files.map(async (f) => {
      try {
        return claudeCodeAdapter.parse(await readFile(f, "utf8"));
      } catch (error) {
        unreadable.push(reason(error));
        return [];
      }
    }),
  );
  return { roots, files: files.length, records: dedupe(parsed.flat()), unreadable };
}

/** "1 log file couldn't be read (EISDIR)": reason codes only, so no path or folder name. */
export function unreadableNote(reasons: readonly string[]): string | null {
  if (!reasons.length) return null;
  const n = reasons.length;
  return `${n} log file${n === 1 ? "" : "s"} couldn't be read (${[...new Set(reasons)].sort().join(", ")}).`;
}
