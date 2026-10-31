import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  APP_NAME,
  DEFAULT_NUDGE_SETTINGS,
  parseHistory,
  parseNudgeSettings,
  parsePaceHistory,
  serializeHistory,
  serializeNudgeSettings,
  serializePaceHistory,
  type NudgeSettings,
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
export const nudgePath = (dir = dataDir()) => join(dir, "nudge.json");
const NUDGE_MAX_BYTES = 4096;

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
  await unlink(tmp).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
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

/** Bedtime nudge settings (CCW-M4.6); the defaults (off) when there's no nudge.json yet. */
export async function readNudgeSettings(dir = dataDir()): Promise<NudgeSettings> {
  try {
    // PS-R17: the real file is under 100 bytes; anything over 4 KB isn't ours, so don't read it.
    if ((await stat(nudgePath(dir))).size > NUDGE_MAX_BYTES) return { ...DEFAULT_NUDGE_SETTINGS };
    return parseNudgeSettings(await readFile(nudgePath(dir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_NUDGE_SETTINGS };
    throw error;
  }
}

export async function writeNudgeSettings(settings: NudgeSettings, dir = dataDir()): Promise<void> {
  await writeAtomic(nudgePath(dir), serializeNudgeSettings(settings));
}
