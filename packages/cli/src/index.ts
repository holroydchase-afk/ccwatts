#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  APP_NAME,
  defaultParams,
  estimate,
  mergeHistory,
  parseSince,
  rollup,
  linkedInPost,
  receiptSvg,
  rollupRecords,
  shareLine,
  since,
  type Dimension,
} from "@ccwatts/core";
import { openFile, writeDashboard } from "./dashboard.js";
import { defaultLogRoots, loadLogs } from "./logs.js";
import { breakdown, history, historyCsv, json, method, summary } from "./render.js";
import { readHistory, writeHistory } from "./store.js";

const HELP = `Usage: ${APP_NAME} [command] [options]

Estimates the electricity your Claude Code usage consumed, as a range.
Reads local logs only. Nothing leaves your machine.

Commands:
  (none)            Summary for the time window
  history           Weekly trend, all-time total, best and worst weeks
  dashboard         Write an offline HTML dashboard of your history and open it
  receipt           Share line, LinkedIn post text and a 1200×627 card (SVG)

Options:
  --since <when>    7d, 12h, 4w, 2026-10-01 or all (default 30d; history defaults to all)
  --by <dim>        Breakdown table: model, day, project or type
  --json            Machine-readable output, same numbers, in Wh
  --method          Parameters, sources and method version
  --export csv      With history: daily rows as CSV on stdout
  --out <file>      With receipt: where to write the card (default ./${APP_NAME}-receipt.svg)
  --path <dir>      Read logs from this folder instead
  --no-open         With dashboard: write the file but don't open it
  --no-history      Don't read or update ~/.${APP_NAME}/history.jsonl
  -h, --help        Show this help`;

const DIMS: Dimension[] = ["model", "day", "project", "type"];
const COMMANDS = ["summary", "history", "receipt", "dashboard"];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      since: { type: "string" },
      by: { type: "string" },
      json: { type: "boolean" },
      method: { type: "boolean" },
      export: { type: "string" },
      out: { type: "string" },
      path: { type: "string" },
      "no-history": { type: "boolean" },
      "no-open": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return void console.log(HELP);
  const params = defaultParams;
  if (values.method) return void console.log(method(params));

  const command = positionals[0] ?? "summary";
  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const by = values.by as Dimension | undefined;
  if (by && !DIMS.includes(by)) throw new Error(`--by must be one of: ${DIMS.join(", ")}`);
  if (values.export && values.export !== "csv") throw new Error(`--export supports csv only`);

  const window = parseSince(values.since ?? (command === "history" ? "all" : "30d"), new Date());
  const logs = await loadLogs(values.path ? [values.path] : defaultLogRoots());

  // History keeps daily token counts so usage survives Claude Code's log cleanup.
  let rows = rollup(logs.records);
  if (!values["no-history"]) {
    rows = mergeHistory(await readHistory(), rows);
    if (logs.records.length > 0) await writeHistory(rows);
  }
  if (rows.length === 0) {
    console.log(`No Claude Code logs found. Looked in:\n${logs.roots.map((r) => `  ${r}`).join("\n")}`);
    console.log(`Point ${APP_NAME} at another folder with --path <dir>.`);
    return;
  }

  if (command === "dashboard") {
    const path = await writeDashboard(rows);
    console.log(`Dashboard written to ${path}. It works offline and makes no network requests.`);
    if (!values["no-open"]) openFile(path);
    return;
  }

  const inWindow = window.start ? rows.filter((r) => r.date >= window.start!.slice(0, 10)) : rows;
  // Day rollups are coarse; within the window, raw records give exact hour-level cuts.
  const records = window.start && window.label.includes("hour") ? since(logs.records, window.start) : rollupRecords(inWindow);
  const e = estimate(records, params);
  // Rollups hold one record per day/model/project, so count responses from the rows instead.
  if (!(window.start && window.label.includes("hour"))) {
    e.responses = inWindow.reduce((n, r) => n + r.responses, 0);
  }

  if (command === "history") {
    if (values.export) return void console.log(historyCsv(inWindow, params));
    if (values.json) return void console.log(json(e, params, window));
    return void console.log(history(e, params, window, new Set(rows.map((r) => r.date)).size));
  }
  if (command === "receipt") {
    const input = { estimate: e, params, windowLabel: window.label };
    const out = resolve(values.out ?? `${APP_NAME}-receipt.svg`);
    await writeFile(out, receiptSvg(input));
    console.log(shareLine(input));
    console.log(`\nCard written to ${out} (1200×627, LinkedIn size). Open ${APP_NAME} dashboard to save it as PNG.`);
    console.log(`\nReady-to-paste post:\n\n${linkedInPost(input)}`);
    return;
  }
  if (values.json) console.log(json(e, params, window));
  else if (by) console.log(breakdown(e, params, window, by));
  else console.log(summary(e, params, window));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
