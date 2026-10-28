import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CCW-F8 (docs/reviews/2026-10-28-release-plan.md): a failed file read in the playground must not
// leave the status stuck on "Reading…". The read step is pulled out of app.ts into a small, DOM-free
// module so it can be tested here:
//
//   export type LogFile = { name: string; text(): Promise<string> };
//   export type ReadResult = { ok: true; texts: string[]; what: string } | { ok: false; status: string };
//   export async function readLogFiles(files: Iterable<LogFile>): Promise<ReadResult>;
//
// It never throws: any read failure comes back as { ok: false, status } with a message for #drop-status.
type LogFile = { name: string; text(): Promise<string> };
type ReadResult = { ok: true; texts: string[]; what: string } | { ok: false; status: string };
const load = async () => (await import("../src/read.js" as string)) as { readLogFiles: (files: Iterable<LogFile>) => Promise<ReadResult> };

const file = (name: string, text: string): LogFile => ({ name, text: async () => text });
const broken = (name: string): LogFile => ({
  name,
  text: async () => {
    throw new DOMException("A requested file or directory could not be found", "NotFoundError");
  },
});

describe("playground file reading (CCW-F8)", () => {
  it("CCW-F8: a failed read resolves with an error status, not a stuck 'Reading…'", async () => {
    const { readLogFiles } = await load();
    const r = await readLogFiles([file("a.jsonl", "{}"), broken("b.jsonl")]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).not.toMatch(/Reading/);
    expect(r.status).toMatch(/couldn't read|could not read/i);
  });

  it("CCW-F8: good files come back as texts with a count label", async () => {
    const { readLogFiles } = await load();
    const r = await readLogFiles([file("a.jsonl", "one"), file("notes.txt", "skip"), file("b.jsonl", "two")]);
    expect(r).toEqual({ ok: true, texts: ["one", "two"], what: "2 files" });
  });

  it("CCW-F8: no .jsonl files is an error status, not a read", async () => {
    const { readLogFiles } = await load();
    const r = await readLogFiles([file("notes.txt", "x")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toContain("No .jsonl files");
  });

  it("CCW-F8: app.ts uses readLogFiles for dropped and picked files", () => {
    const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    expect(app).toMatch(/import\s*\{[^}]*readLogFiles[^}]*\}\s*from\s*"\.\/read\.js"/);
  });
});

// UX-R2 (docs/reviews/2026-10-28-release-plan.md): error copy that says what to do next.
// Assumed additions to read.ts (DOM-free, so they can be tested here):
//   export function noUsageStatus(what: string): string   // what is ReadResult.what: "1 file", "3 files" or "pasted text"
//   export function readPaste(text: string): ReadResult  // empty or whitespace -> { ok: false, status: "Paste the lines first." }
const loadR2 = async () =>
  (await import("../src/read.js" as string)) as { noUsageStatus?: (what: string) => string; readPaste?: (text: string) => ReadResult };

describe("playground error copy (UX-R2)", () => {
  it("UX-R2: files with no usage say what to pick next (singular and plural)", async () => {
    const { noUsageStatus } = await loadR2();
    expect(typeof noUsageStatus).toBe("function");
    expect(noUsageStatus!("1 file")).toBe("We couldn't find any Claude Code usage in that file. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.");
    expect(noUsageStatus!("3 files")).toBe("We couldn't find any Claude Code usage in those files. Pick the .jsonl files inside ~/.claude/projects, or use the prompt below.");
  });

  it("UX-R2: pasted text with no usage says what to paste", async () => {
    const { noUsageStatus } = await loadR2();
    expect(noUsageStatus?.("pasted text")).toBe("We couldn't find any usage lines in that text. Paste the lines Claude printed, one JSON object per line.");
  });

  it("UX-R2: an empty paste asks for the lines first, and a real paste goes through", async () => {
    const { readPaste } = await loadR2();
    expect(typeof readPaste).toBe("function");
    for (const empty of ["", "   \n\t "]) expect(readPaste!(empty)).toEqual({ ok: false, status: "Paste the lines first." });
    expect(readPaste!('{"type":"assistant"}')).toEqual({ ok: true, texts: ['{"type":"assistant"}'], what: "pasted text" });
  });

  it("UX-R2: app.ts uses the new copy and marks errors with an .error class", () => {
    const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    expect(app).toMatch(/import\s*\{[^}]*noUsageStatus[^}]*\}\s*from\s*"\.\/read\.js"/);
    expect(app).toMatch(/import\s*\{[^}]*readPaste[^}]*\}\s*from\s*"\.\/read\.js"/);
    expect(app).not.toContain("had no Claude Code usage in them");
    expect(app).toMatch(/classList\.(toggle|add)\(\s*"error"/);
  });
});
