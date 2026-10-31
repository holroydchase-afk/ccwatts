#!/usr/bin/env tsx
// Pace spike (M4.1, throwaway, not shipped). Reads Claude Code JSONL logs and prints COUNTS ONLY:
// structural signatures of `type: "user"` lines, and block counts / active minutes per idle-gap threshold.
// It never prints, stores or sends message text, paths or ids. No network.
// Usage: npx tsx scripts/pace-spike.ts ~/.claude/projects
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Line = Record<string, unknown>;
const GAPS = [5, 10, 15, 20, 30, 45];

let unreadable = 0;
function jsonlFiles(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [dir];
    return readdirSync(dir).flatMap((name) => jsonlFiles(join(dir, name))).filter((f) => f.endsWith(".jsonl"));
  } catch {
    unreadable++; // count only: an fs error message would print the path
    return [];
  }
}

// Print only known structural values, so an unexpected field value can never leak.
const KNOWN_BLOCKS = new Set(["text", "image", "tool_result", "tool_use", "document"]);
const KNOWN_ORIGINS = new Set(["human", "task-notification"]);
const known = (v: unknown, ok: Set<string>): string => (typeof v === "string" && ok.has(v) ? v : "other");

const blocksOf = (content: unknown): Line[] =>
  Array.isArray(content) ? content.filter((b): b is Line => typeof b === "object" && b !== null) : [];

function shape(line: Line): string {
  const content = (line.message as Line | undefined)?.content;
  if (typeof content === "string") return "str";
  if (!Array.isArray(content)) return "none";
  return `arr[${[...new Set(blocksOf(content).map((b) => known(b.type, KNOWN_BLOCKS)))].sort().join(",")}]`;
}

/** Structure only: flags, origin.kind when present, else content shape. */
function isHumanTurn(line: Line): boolean {
  if (line.type !== "user" || line.isMeta || line.isSidechain || line.isCompactSummary || "toolUseResult" in line) return false;
  const origin = line.origin as Line | undefined;
  if (origin && typeof origin === "object") return origin.kind === "human";
  const s = shape(line);
  return s === "str" || (s.startsWith("arr[") && !s.includes("tool_result") && /text|image/.test(s));
}

const signatures = new Map<string, number>();
const events: { t: number; human: boolean }[] = [];
for (const file of jsonlFiles(process.argv[2] ?? ".")) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    unreadable++;
    continue;
  }
  for (const raw of text.split("\n")) {
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (line.type !== "user" && line.type !== "assistant") continue;
    if (line.type === "user") {
      const flags = ["isMeta", "isSidechain", "isCompactSummary"].filter((f) => line[f] === true).join("+") || "-";
      const origin = (line.origin as Line | undefined)?.kind;
      const sig = `${shape(line)} flags=${flags} toolUseResult=${"toolUseResult" in line} origin=${origin === undefined ? "-" : known(origin, KNOWN_ORIGINS)}`;
      signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
    }
    const t = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
    if (!Number.isNaN(t)) events.push({ t, human: isHumanTurn(line) });
  }
}

console.log("user-line signatures (count  signature):");
for (const [sig, n] of [...signatures].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${sig}`);
events.sort((a, b) => a.t - b.t);
console.log(`unreadable files ${unreadable}, timed lines ${events.length}, human turns ${events.filter((e) => e.human).length}`);
if (events.length === 0) process.exit(0);

console.log("gap | blocks  active_min  longest_min  human_turn_started_blocks");
for (const gap of GAPS) {
  const spans: { start: number; end: number; human: boolean }[] = [];
  let prev: number | undefined;
  for (const e of events) {
    const last = spans.at(-1);
    if (prev === undefined || !last || e.t - prev > gap * 60_000) spans.push({ start: e.t, end: e.t, human: e.human });
    else last.end = e.t;
    prev = e.t;
  }
  const mins = spans.map((s) => (s.end - s.start) / 60_000);
  const total = mins.reduce((a, b) => a + b, 0).toFixed(1);
  console.log(`${gap} | ${spans.length}  ${total}  ${Math.max(...mins).toFixed(1)}  ${spans.filter((s) => s.human).length}`);
}
