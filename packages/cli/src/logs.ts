import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter, dedupe, type UsageRecord } from "@ccwatts/core";

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
}

/** Reads every Claude Code log under the roots. Only token counts leave this function. */
export async function loadLogs(roots: string[]): Promise<LoadedLogs> {
  const files = (await Promise.all(roots.map(findJsonl))).flat();
  const parsed = await Promise.all(files.map(async (f) => claudeCodeAdapter.parse(await readFile(f, "utf8"))));
  return { roots, files: files.length, records: dedupe(parsed.flat()) };
}
