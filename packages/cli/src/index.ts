#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  APP_NAME,
  TOKEN_TYPES,
  claudeCodeAdapter,
  dedupe,
  emptyCounts,
  addCounts,
  totalTokens,
  totalsByModel,
  type UsageRecord,
} from "@ccwatts/core";

/** Where Claude Code keeps session logs. CLAUDE_CONFIG_DIR may hold a comma-separated list. */
function defaultLogRoots(): string[] {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR?.split(",").map((dir) => join(dir.trim(), "projects"));
  if (fromEnv?.length) return fromEnv;
  return [join(homedir(), ".claude", "projects"), join(homedir(), ".config", "claude", "projects")];
}

async function findJsonl(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => join(e.parentPath, e.name));
}

const fmt = (n: number) => n.toLocaleString("en-US");
const LABELS = { input: "input", cacheWrite: "cache write", cacheRead: "cache read", output: "output" } as const;

function printTable(records: UsageRecord[]): void {
  const rows = totalsByModel(records);
  const all = rows.reduce((sum, row) => addCounts(sum, row.tokens), emptyCounts());
  const header = ["model", ...TOKEN_TYPES.map((t) => LABELS[t]), "total"];
  const body = [...rows, { model: "all models", tokens: all }].map((row) => [
    row.model,
    ...TOKEN_TYPES.map((t) => fmt(row.tokens[t])),
    fmt(totalTokens(row.tokens)),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("   ");
  console.log(line(header));
  body.forEach((cells, i) => {
    if (i === body.length - 1) console.log(widths.map((w) => "-".repeat(w)).join("   "));
    console.log(line(cells));
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { path: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) {
    console.log(`Usage: ${APP_NAME} [--path <dir>]\n\nPrints token totals by model from local Claude Code logs.`);
    return;
  }
  const roots = values.path ? [values.path] : defaultLogRoots();
  const files = (await Promise.all(roots.map(findJsonl))).flat();
  if (files.length === 0) {
    console.log(`No Claude Code logs found. Looked in:\n${roots.map((r) => `  ${r}`).join("\n")}`);
    console.log(`Point ${APP_NAME} at another folder with --path <dir>.`);
    return;
  }
  const parsed = await Promise.all(files.map(async (f) => claudeCodeAdapter.parse(await readFile(f, "utf8"))));
  const records = dedupe(parsed.flat());
  console.log(`${APP_NAME} · token totals · ${fmt(records.length)} responses from ${fmt(files.length)} log files\n`);
  printTable(records);
  console.log("\nTokens only for now. Electricity estimates arrive with the energy model (PLAN.md S2).");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
