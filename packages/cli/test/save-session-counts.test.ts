import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "@ccwatts/core";

// Ticket SAVE: scripts/save-session-counts.ts runs as a Claude Code Stop hook and writes a
// counts-only copy of the session to <CCWATTS_SAVE_DIR>/<session_id>.jsonl. Synthetic data only.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(root, "scripts/save-session-counts.ts");
const tsx = join(root, "node_modules/.bin/tsx");

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ID = "sess_abc-123";
const CWD = "/Users/someone/private/app";
const usage = (out: number) => ({ input_tokens: 3, cache_creation_input_tokens: 50, cache_read_input_tokens: 900, output_tokens: out });
const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

const MAIN = jsonl(
  { type: "user", timestamp: "2026-10-30T10:00:00.000Z", cwd: CWD, sessionId: ID, message: { role: "user", content: "SECRET-PROMPT main" } },
  { type: "assistant", timestamp: "2026-10-30T10:00:02.000Z", cwd: CWD, sessionId: ID, requestId: "req_m", message: { id: "msg_m", model: "claude-opus-4-6", content: [{ type: "text", text: "SECRET-REPLY main" }], usage: usage(20) } },
);
const SUB = jsonl(
  { type: "user", timestamp: "2026-10-30T10:00:03.000Z", cwd: CWD, isSidechain: true, message: { role: "user", content: "SECRET-PROMPT sub" } },
  { type: "assistant", timestamp: "2026-10-30T10:00:05.000Z", cwd: CWD, isSidechain: true, requestId: "req_s", message: { id: "msg_s", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "tu", name: "Read", input: { file_path: "SECRET-TOOL-INPUT" } }], usage: usage(7) } },
);

/** A fake Claude Code projects dir with one transcript and one subagent transcript, plus an empty share root. */
function setup() {
  const base = mkdtempSync(join(tmpdir(), "ccw-save-"));
  temps.push(base);
  const proj = join(base, "projects", "-Users-someone-private-app");
  mkdirSync(join(proj, ID, "subagents"), { recursive: true });
  const transcript = join(proj, `${ID}.jsonl`);
  writeFileSync(transcript, MAIN);
  writeFileSync(join(proj, ID, "subagents", "agent-1.jsonl"), SUB);
  const share = join(base, "share");
  mkdirSync(share);
  const saveDir = join(share, "ccwatts-usage");
  return { base, proj, transcript, share, saveDir };
}

function run(input: string, saveDir: string) {
  return spawnSync(tsx, [script], {
    cwd: root,
    input,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), CCWATTS_SAVE_DIR: saveDir },
  });
}
const hook = (session_id: string, transcript_path: string) =>
  JSON.stringify({ session_id, transcript_path, hook_event_name: "Stop", cwd: CWD, stop_hook_active: false });

const files = (dir: string) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : []);

describe("SAVE-SCRIPT save-session-counts Stop hook", () => {
  it("SAVE-SCRIPT-0 scripts/save-session-counts.ts exists", () => {
    expect(existsSync(script)).toBe(true);
  });

  it("SAVE-SCRIPT-1 writes <dir>/<session_id>.jsonl, counts only, including subagent lines", () => {
    const s = setup();
    const r = run(hook(ID, s.transcript), s.saveDir);
    expect(r.status, r.stderr).toBe(0);
    const out = join(s.saveDir, `${ID}.jsonl`);
    expect(existsSync(out)).toBe(true);
    const text = readFileSync(out, "utf8");
    const recs = claudeCodeAdapter.parse(text);
    expect(recs.map((x) => x.key).sort()).toEqual(["msg_m:req_m", "msg_s:req_s"]);
    expect(recs.every((x) => x.project?.name === "app")).toBe(true);
    for (const secret of ["SECRET", CWD, "/Users", "someone", "private"]) expect(text, secret).not.toContain(secret);
    // Pace sees the same events as from the raw logs.
    expect(claudeCodeAdapter.activity!(text)).toEqual(claudeCodeAdapter.activity!(MAIN + SUB));
  });

  it("SAVE-SCRIPT-2 a second run overwrites the file rather than appending", () => {
    const s = setup();
    expect(run(hook(ID, s.transcript), s.saveDir).status).toBe(0);
    const first = readFileSync(join(s.saveDir, `${ID}.jsonl`), "utf8");
    expect(run(hook(ID, s.transcript), s.saveDir).status).toBe(0);
    const second = readFileSync(join(s.saveDir, `${ID}.jsonl`), "utf8");
    expect(second).toBe(first);
    expect(files(s.saveDir)).toEqual([`${ID}.jsonl`]);
  });

  it.each(["../x", "a/b", "", "..", "x y", "id.jsonl"])("SAVE-SCRIPT-3 bad session_id %j exits 0 and writes nothing", (bad) => {
    const s = setup();
    const r = run(hook(bad, s.transcript), s.saveDir);
    expect(r.status).toBe(0);
    expect(files(s.share)).toEqual([]);
    expect(files(s.base).filter((f) => f === "x" || f.endsWith("/x") || f.endsWith("x.jsonl"))).toEqual([]);
  });

  it("SAVE-SCRIPT-4 a save dir whose parent is missing exits 0 and writes nothing", () => {
    const s = setup();
    const missing = join(s.base, "no-such-mount", "ccwatts-usage");
    const r = run(hook(ID, s.transcript), missing);
    expect(r.status).toBe(0);
    expect(existsSync(join(s.base, "no-such-mount"))).toBe(false);
  });

  it.each(["", "not json", "null", "[]", JSON.stringify({ session_id: ID })])("SAVE-SCRIPT-5 bad stdin %j exits 0 and writes nothing", (input) => {
    const s = setup();
    const r = run(input, s.saveDir);
    expect(r.status).toBe(0);
    expect(files(s.share)).toEqual([]);
  });

  it("SAVE-SCRIPT-6 stdout and stderr never carry prompt text, reply text or the full path", () => {
    const s = setup();
    for (const input of [hook(ID, s.transcript), hook("../x", s.transcript), "garbage"]) {
      const r = run(input, s.saveDir);
      expect(r.status).toBe(0);
      const said = r.stdout + r.stderr;
      for (const secret of ["SECRET", CWD, "/Users"]) expect(said, secret).not.toContain(secret);
    }
  });

  it("PS-R20 a symlink planted at <dir>/<session_id>.jsonl.tmp is not written through", () => {
    const s = setup();
    mkdirSync(s.saveDir);
    const outside = join(s.base, "outside.txt");
    writeFileSync(outside, "ORIGINAL-CONTENTS\n");
    symlinkSync(outside, join(s.saveDir, `${ID}.jsonl.tmp`));
    const r = run(hook(ID, s.transcript), s.saveDir);
    expect(r.status).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("ORIGINAL-CONTENTS\n");
    const out = join(s.saveDir, `${ID}.jsonl`);
    expect(existsSync(out)).toBe(true);
    expect(lstatSync(out).isSymbolicLink()).toBe(false);
    expect(claudeCodeAdapter.parse(readFileSync(out, "utf8")).map((x) => x.key).sort()).toEqual(["msg_m:req_m", "msg_s:req_s"]);
  });
});

describe("SAVE-HOOK settings", () => {
  it("SAVE-HOOK .claude/settings.json has a Stop hook running scripts/save-session-counts.ts", () => {
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")) as {
      hooks?: { Stop?: { hooks?: { type?: string; command?: string }[] }[] };
    };
    const commands = (settings.hooks?.Stop ?? []).flatMap((m) => m.hooks ?? []).filter((h) => h.type === "command").map((h) => h.command ?? "");
    expect(commands.some((c) => c.includes("scripts/save-session-counts.ts"))).toBe(true);
  });
});
