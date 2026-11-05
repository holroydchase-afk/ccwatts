// Claude Code Stop hook: saves a counts-only copy of this session's log (plus its subagents' logs)
// to <dir>/<session_id>.jsonl, so usage from cloud sessions survives after the container is gone.
// dir is $CCWATTS_SAVE_DIR, else /mnt/project-files/ccwatts-usage (the project's shared folder).
// Read it later with `ccwatts --path <dir>` or `ccwatts pace --path <dir>`.
// Counts only (countsOnlyLog drops all text, tool data and full paths). Overwrites on every run.
// Never blocks or fails the session: any problem exits 0 and writes nothing.
// The copy keeps exact turn times and the unsalted project hash, so it is private raw data: keep it in
// the owner's project folder and never use it for fixtures, demos or anything public (PS-R19).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { countsOnlyLog } from "../packages/core/src/index.ts";

try {
  const input = JSON.parse(readFileSync(0, "utf8")) as { session_id?: unknown; transcript_path?: unknown };
  const id = input.session_id;
  const transcript = input.transcript_path;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) process.exit(0);
  if (typeof transcript !== "string" || !transcript.endsWith(".jsonl") || !existsSync(transcript)) process.exit(0);

  const dir = process.env.CCWATTS_SAVE_DIR || "/mnt/project-files/ccwatts-usage";
  if (!existsSync(dirname(dir))) process.exit(0);

  const texts = [readFileSync(transcript, "utf8")];
  const subagents = join(dirname(transcript), id, "subagents");
  if (existsSync(subagents)) {
    for (const name of readdirSync(subagents).sort()) {
      if (name.endsWith(".jsonl")) texts.push(readFileSync(join(subagents, name), "utf8"));
    }
  }
  const counts = texts.map(countsOnlyLog).join("");
  if (counts === "") process.exit(0);

  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${id}.jsonl`);
  // A fresh temp name opened with "wx" never follows a file or symlink already there (PS-R20).
  const tmp = `${out}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, counts, { mode: 0o600, flag: "wx" });
  renameSync(tmp, out);
} catch {
  // A hook must never break the session, and must never print log content.
}
process.exit(0);
