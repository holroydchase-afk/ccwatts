#!/usr/bin/env node
import { parseArgs } from "node:util";
import { APP_NAME, defaultParams, estimate, parseSince, since, type Dimension } from "@ccwatts/core";
import { defaultLogRoots, loadLogs } from "./logs.js";
import { breakdown, json, method, summary } from "./render.js";

const HELP = `Usage: ${APP_NAME} [command] [options]

Estimates the electricity your Claude Code usage consumed, as a range.
Reads local logs only. Nothing leaves your machine.

Commands:
  (none)            Summary for the time window
  receipt           Share line and image (coming soon)
  history           Usage over time (coming soon)

Options:
  --since <when>    7d, 12h, 4w, 2026-10-01 or all (default 30d)
  --by <dim>        Breakdown table: model, day, project or type
  --json            Machine-readable output, same numbers, in Wh
  --method          Parameters, sources and method version
  --path <dir>      Read logs from this folder instead
  -h, --help        Show this help`;

const DIMS: Dimension[] = ["model", "day", "project", "type"];

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      since: { type: "string", default: "30d" },
      by: { type: "string" },
      json: { type: "boolean" },
      method: { type: "boolean" },
      path: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return void console.log(HELP);
  const params = defaultParams;
  if (values.method) return void console.log(method(params));

  const command = positionals[0];
  if (command && command !== "summary") {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const by = values.by as Dimension | undefined;
  if (by && !DIMS.includes(by)) throw new Error(`--by must be one of: ${DIMS.join(", ")}`);

  const window = parseSince(values.since, new Date());
  const logs = await loadLogs(values.path ? [values.path] : defaultLogRoots());
  if (logs.files === 0) {
    console.log(`No Claude Code logs found. Looked in:\n${logs.roots.map((r) => `  ${r}`).join("\n")}`);
    console.log(`Point ${APP_NAME} at another folder with --path <dir>.`);
    return;
  }
  const records = window.start ? since(logs.records, window.start) : logs.records;
  const e = estimate(records, params);
  if (values.json) console.log(json(e, params, window));
  else if (by) console.log(breakdown(e, params, window, by));
  else console.log(summary(e, params, window));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
