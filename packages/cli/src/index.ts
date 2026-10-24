#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  APP_NAME,
  APP_VERSION,
  PLAYGROUND_URL,
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
import { openFile, sampleRows, writeDashboard } from "./dashboard.js";
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
  --demo            Try it on synthetic sample data (no logs needed)
  --path <dir>      Estimate just this folder or .jsonl file (history is left alone)
  --no-open         With dashboard: write the file but don't open it
  --no-history      Don't read or update ~/.${APP_NAME}/history.jsonl
  -v, --version     Show the version
  -h, --help        Show this help

Logs somewhere else? Set CLAUDE_CONFIG_DIR, as Claude Code does, to keep your history.`;

const DIMS: Dimension[] = ["model", "day", "project", "type"];
const COMMANDS = ["summary", "history", "receipt", "dashboard"];

/** parseArgs errors are written for developers; say the same thing in plain words. */
function plainArgError(error: unknown): Error | undefined {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  const option = message.match(/'(-{1,2}[\w-]+)/)?.[1];
  const help = `Run ${APP_NAME} --help to see the options.`;
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return new Error(`Unknown option "${option}". ${help}`);
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") return new Error(`${option} needs a value. ${help}`);
  return undefined;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgsPlain({
    allowPositionals: true,
    options: {
      since: { type: "string" },
      by: { type: "string" },
      json: { type: "boolean" },
      method: { type: "boolean" },
      export: { type: "string" },
      out: { type: "string" },
      path: { type: "string" },
      demo: { type: "boolean" },
      "no-history": { type: "boolean" },
      "no-open": { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(`${APP_NAME} ${APP_VERSION}`);
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

  const demo = Boolean(values.demo);
  if (demo && (command === "receipt" || command === "dashboard")) {
    throw new Error(
      `${command} is for your own usage, so it doesn't run on sample data. ` +
        `The playground shows the sample ${command === "receipt" ? "card" : "dashboard"}: ${PLAYGROUND_URL}`,
    );
  }
  const logs = demo ? { roots: [], files: 0, records: [] } : await loadLogs(values.path ? [values.path] : defaultLogRoots());
  const sample = demo ? sampleRows() : [];
  // The sample is a fixed month in the past: show all of it, and count --since back from its last day.
  const now = demo ? new Date(`${sample.map((r) => r.date).sort().at(-1)}T23:59:59Z`) : new Date();
  const window = parseSince(values.since ?? (command === "history" || demo ? "all" : "30d"), now);

  // History keeps daily token counts so usage survives Claude Code's log cleanup.
  let rows = demo ? sample : rollup(logs.records);
  // --path estimates exactly what you point it at (often the sample data), so it never mixes
  // into or writes your personal history. Relocated logs use CLAUDE_CONFIG_DIR instead.
  if (!values["no-history"] && !values.path && !demo) {
    const stored = await readHistory().catch((error: unknown) => {
      console.error(`Couldn't read history (${error instanceof Error ? error.message : String(error)}). Using current logs only.`);
      return [];
    });
    rows = mergeHistory(stored, rows);
    // History is a convenience: a read-only home folder shouldn't stop the estimate.
    if (logs.records.length > 0) {
      await writeHistory(rows).catch((error: unknown) =>
        console.error(`Couldn't save history (${error instanceof Error ? error.message : String(error)}). Continuing without it.`),
      );
    }
  }
  if (rows.length === 0) {
    console.log(`No Claude Code logs found. Looked in:\n${logs.roots.map((r) => `  ${r}`).join("\n")}`);
    console.log(`Point ${APP_NAME} at another folder with --path <dir>.`);
    console.log(`No Claude Code yet? See it on sample data with ${APP_NAME} --demo, or in your browser: ${PLAYGROUND_URL}`);
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

  const label = demo && !values.json && !values.export ? "Sample data (synthetic), not your usage.\n\n" : "";
  if (command === "history") {
    if (values.export) return void console.log(historyCsv(inWindow, params));
    if (values.json) return void console.log(json(e, params, window, demo));
    if (label) process.stdout.write(label);
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
  if (values.json) return void console.log(json(e, params, window, demo));
  if (label) process.stdout.write(label);
  if (by) console.log(breakdown(e, params, window, by));
  else console.log(summary(e, params, window, demo));
}

function parseArgsPlain<T extends ParseArgsConfig>(config: T): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs(config);
  } catch (error) {
    throw plainArgError(error) ?? error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
