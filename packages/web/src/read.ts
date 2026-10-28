/**
 * Reads dropped or picked log files in the playground. No DOM here, so it can be tested on its
 * own (CCW-F8). It never throws: a failed read comes back as a status line, so the page never
 * stays on "Reading…". Messages name no file or folder: a browser file has no full path anyway.
 */
export type LogFile = { name: string; text(): Promise<string> };
export type ReadResult = { ok: true; texts: string[]; what: string } | { ok: false; status: string };

export const NO_JSONL = "No .jsonl files found there. Claude Code keeps them in ~/.claude/projects.";

export async function readLogFiles(files: Iterable<LogFile>): Promise<ReadResult> {
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
  return { ok: true, texts, what: `${logs.length} file${logs.length === 1 ? "" : "s"}` };
}
