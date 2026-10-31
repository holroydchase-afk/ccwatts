import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  APP_NAME,
  parseHistory,
  parsePaceHistory,
  serializeHistory,
  serializePaceHistory,
  type PaceDay,
  type PaceMethod,
  type RollupRow,
} from "@ccwatts/core";

/** ~/.ccwatts by default; override with CCWATTS_HOME (named from APP_NAME so a rename carries over). */
export function dataDir(): string {
  return process.env[`${APP_NAME.toUpperCase()}_HOME`] ?? join(homedir(), `.${APP_NAME}`);
}

export const historyPath = (dir = dataDir()) => join(dir, "history.jsonl");
export const pacePath = (dir = dataDir()) => join(dir, "pace.jsonl");

export async function readHistory(dir = dataDir()): Promise<RollupRow[]> {
  try {
    return parseHistory(await readFile(historyPath(dir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Writes the whole file to a temp name, then renames, so a crash can't leave half a file. Owner-only (0600). */
async function writeAtomic(path: string, text: string): Promise<void> {
  // 0700 folder, 0600 file. writeFile's mode only applies to a new file, so a stale .tmp left by
  // a crash (possibly wider) is removed first (PS-R8, PS-R9).
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await rm(tmp, { force: true });
  await writeFile(tmp, text, { mode: 0o600, flag: "wx" });
  await rename(tmp, path);
}

export async function writeHistory(rows: readonly RollupRow[], dir = dataDir()): Promise<void> {
  await writeAtomic(historyPath(dir), serializeHistory(rows));
}

/** Stored pace days and the method they were counted with, or null if there's no pace.jsonl yet. */
export async function readPaceHistory(dir = dataDir()): Promise<{ method: PaceMethod | null; days: PaceDay[] } | null> {
  try {
    return parsePaceHistory(await readFile(pacePath(dir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writePaceHistory(days: readonly PaceDay[], method: PaceMethod, dir = dataDir()): Promise<void> {
  await writeAtomic(pacePath(dir), serializePaceHistory(days, method));
}
