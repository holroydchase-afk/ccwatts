import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_NAME, parseHistory, serializeHistory, type RollupRow } from "@ccwatts/core";

/** ~/.ccwatts by default; override with CCWATTS_HOME (named from APP_NAME so a rename carries over). */
export function dataDir(): string {
  return process.env[`${APP_NAME.toUpperCase()}_HOME`] ?? join(homedir(), `.${APP_NAME}`);
}

export const historyPath = (dir = dataDir()) => join(dir, "history.jsonl");

export async function readHistory(dir = dataDir()): Promise<RollupRow[]> {
  try {
    return parseHistory(await readFile(historyPath(dir), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Writes the whole file to a temp name, then renames, so a crash can't leave half a history. */
export async function writeHistory(rows: readonly RollupRow[], dir = dataDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = `${historyPath(dir)}.tmp`;
  await writeFile(tmp, serializeHistory(rows), { mode: 0o600 });
  await rename(tmp, historyPath(dir));
}
