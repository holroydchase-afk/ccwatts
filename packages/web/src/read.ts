/**
 * Reads dropped or picked log files in the playground. No DOM here, so it can be tested on its
 * own (CCW-F8). It never throws: a failed read comes back as a status line, so the page never
 * stays on "Reading…". Messages name no file or folder: a browser file has no full path anyway.
 */
import { claudeCodeAdapter, defaultPaceOptions, paceDays, type PaceDay } from "@ccwatts/core";

export type LogFile = { name: string; text(): Promise<string> };
/** pace is there only when the caller passed a time zone (the page passes the browser's). */
export type ReadResult = { ok: true; texts: string[]; what: string; pace?: PaceDay[] } | { ok: false; status: string };

/** Adds daily pace counts in `timeZone` to a read, when one is given. Only per-day minutes and whole hours come back. */
function withPace(read: { ok: true; texts: string[]; what: string }, timeZone?: string): ReadResult {
  if (!timeZone) return read;
  const events = read.texts.flatMap((t) => claudeCodeAdapter.activity?.(t) ?? []);
  return { ...read, pace: paceDays(events, defaultPaceOptions(timeZone)) };
}

export const NO_JSONL = "No .jsonl files found there. Claude Code keeps them in ~/.claude/projects.";

export async function readLogFiles(files: Iterable<LogFile>, timeZone?: string): Promise<ReadResult> {
  const logs = [...files].filter((f) => f.name.endsWith(".jsonl"));
  if (!logs.length) return { ok: false, status: NO_JSONL };
  const texts: string[] = [];
  // One at a time: a big log folder shouldn't hold every file in memory twice at once.
  for (const file of logs) {
    try {
      texts.push(await file.text());
    } catch {
      return { ok: false, status: "Couldn't read one of those files. Try again, or pick the files instead of the folder." };
    }
  }
  return withPace({ ok: true, texts, what: `${logs.length} file${logs.length === 1 ? "" : "s"}` }, timeZone);
}

export const EMPTY_PASTE = "Paste the lines first.";

/** What to say when files or pasted text held no usage: what to try next, not just what failed (UX-R2). */
export function noUsageStatus(what: string): string {
  if (what === "pasted text") return "We couldn't find any usage lines in that text. Paste the lines Claude printed, one JSON object per line.";
  const those = what === "1 file" ? "that file" : "those files";
  return `We couldn't find any Claude Code usage in ${those}. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.`;
}

/** The paste box, as a ReadResult: an empty or blank paste asks for the lines first. */
export function readPaste(text: string, timeZone?: string): ReadResult {
  if (!text.trim()) return { ok: false, status: EMPTY_PASTE };
  return withPace({ ok: true, texts: [text], what: "pasted text" }, timeZone);
}
