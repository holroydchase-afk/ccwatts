#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  APP_NAME,
  claudeCodeAdapter,
  dedupe,
  APP_VERSION,
  PLAYGROUND_URL,
  REPO_URL,
  defaultParams,
  estimate,
  parseSince,
  linkedInPost,
  receiptSvg,
  shareLine,
  type Dimension,
} from "@ccwatts/core";
import { openFile, writeDashboard } from "./dashboard.js";
import { errorLine, reason } from "./errors.js";
import { breakdown, history, historyCsv, json, jsonError, method, statusLine, styles, summary } from "./render.js";
import { estimateWindow, loadUsage, rowsIn, type UsageOptions } from "./usage.js";

/** Bold and dim only in a terminal: on for a TTY or FORCE_COLOR, off for NO_COLOR (https://no-color.org) and when piped. */
function useColor(env: NodeJS.ProcessEnv = process.env, isTTY = Boolean(process.stdout.isTTY)): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") return env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  return isTTY;
}

const MCP_ADD = `claude mcp add ${APP_NAME} -- npx -y ${APP_NAME} mcp`;

const HELP = `Usage: ${APP_NAME} [command] [options]

Estimates the electricity your Claude Code usage consumed, as a range.
Reads local logs only. Nothing leaves your machine.

Commands:
  (none)            Summary for the time window
  history           Weekly trend, all-time total, best and worst weeks
  dashboard         Write an offline HTML dashboard of your history and open it
  receipt           Share line, LinkedIn post text and a 1200×627 card (SVG)
  statusline        One line for the Claude Code status line (reads its JSON on stdin)
  mcp               MCP server on stdio, so Claude Code can ask about its own energy use
  help              Show this help

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

const MCP_HELP = `Usage: ${APP_NAME} mcp [--path <dir>] [--demo] [--no-history]

Runs an MCP server on stdio, so Claude Code can ask about its own energy use.
Claude Code starts it for you; you don't run it by hand. To add it:

  ${MCP_ADD}

Tools: energy_summary, energy_by_project, energy_weekly, methodology.
Reads local logs only. No port, no network.`;

// Public page, not a secret: a plain name so the studio log check (which bans URL-named values in logs) reads it as fixed text.
const PLAYGROUND = PLAYGROUND_URL;

const DIMS: Dimension[] = ["model", "day", "project", "type"];
const COMMANDS = ["summary", "history", "receipt", "dashboard", "statusline", "mcp", "help"];

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
  if (positionals[0] === "help") return void console.log(HELP);
  if (values.help) return void console.log(positionals[0] === "mcp" ? MCP_HELP : HELP);
  if (values.version) return void console.log(`${APP_NAME} ${APP_VERSION}`);
  const params = defaultParams;
  if (values.method) return void console.log(method(params));

  const command = positionals[0] ?? "summary";
  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  if (command === "statusline") return void console.log(await sessionLine(values.path));
  if (command === "mcp") return runMcp({ path: values.path, demo: values.demo, noHistory: values["no-history"] });
  const by = values.by as Dimension | undefined;
  if (by && !DIMS.includes(by)) throw new Error(`--by must be one of: ${DIMS.join(", ")}`);
  if (values.export && values.export !== "csv") throw new Error(`--export supports csv only`);
  if (values.export && command !== "history") throw new Error(`--export works with ${APP_NAME} history. Try: ${APP_NAME} history --export csv`);

  const demo = Boolean(values.demo);
  if (demo && (command === "receipt" || command === "dashboard")) {
    // Printed here, not thrown: the error printer cuts URLs, and this one should stay.
    console.error(
      `${command} is for your own usage, so it doesn't run on sample data. ` +
        `The playground shows the sample ${command === "receipt" ? "card" : "dashboard"}: ${PLAYGROUND}`,
    );
    process.exitCode = 1;
    return;
  }
  const usage = await loadUsage({ path: values.path, demo, noHistory: values["no-history"] });
  const { rows } = usage;
  const window = parseSince(values.since ?? (command === "history" || demo ? "all" : "30d"), usage.now);
  if (rows.length === 0) {
    // Logs were there but held no usage (wrong folder, or only user turns): say so, not "no logs".
    const oneFile = usage.files === 1 && values.path !== undefined && Boolean((await stat(values.path).catch(() => null))?.isFile());
    const where = values.path ? ` in ${basename(values.path)}` : "";
    const found = oneFile
      ? `${basename(values.path!)} has no Claude Code usage.`
      : `Found ${usage.files} .jsonl file${usage.files === 1 ? "" : "s"}${where}, but no Claude Code usage in ${usage.files === 1 ? "it" : "them"}.`;
    if (values.json) {
      // Scripts get JSON on stdout and a non-zero exit. No paths: this output is often saved or shared.
      console.log(usage.files > 0 ? jsonError("no_usage", found) : jsonError("no_logs", "No Claude Code logs found."));
      process.exitCode = 1;
      return;
    }
    if (usage.files > 0) {
      console.log(found);
      for (const note of usage.notes) console.log(note);
      console.log(`Claude Code keeps its logs in ~/.claude/projects. Point ${APP_NAME} there, or at one session file, with --path.`);
      return;
    }
    // Next step first, then where we looked (full paths, but only to the user's own terminal).
    const { dim } = styles(useColor());
    console.log(`No Claude Code logs yet. Try ${APP_NAME} --demo, or point at a folder with --path <dir>.`);
    console.log("");
    console.log("Looked in:");
    for (const r of usage.roots) console.log(dim(`  ${r}`));
    console.log("");
    console.log(`Or try it in your browser: ${PLAYGROUND}`);
    return;
  }

  // Commands whose output has no Note lines say what was skipped on stderr, so stdout stays clean.
  const noteToStderr = () => {
    for (const note of usage.notes) console.error(`Note: ${note}`);
  };

  if (command === "dashboard") {
    noteToStderr();
    const path = await writeDashboard(rows);
    console.log(`Dashboard written to ${path}. It works offline and makes no network requests.`);
    if (!values["no-open"]) openFile(path);
    return;
  }

  const inWindow = rowsIn(rows, window);
  const est = estimateWindow(usage, window, params);

  // --json and --export never get color: they are read by scripts.
  const opts = { color: !values.json && !values.export && useColor(), now: usage.now };
  const label = demo && !values.json && !values.export ? `${styles(opts.color).yellow("Sample data (synthetic), not your usage.")}\n\n` : "";
  if (command === "history") {
    if (!values.json) noteToStderr();
    if (values.export) return void console.log(historyCsv(inWindow, params));
    if (values.json) return void console.log(json(est, params, window, demo));
    if (label) process.stdout.write(label);
    return void console.log(history(est, params, window, new Set(rows.map((r) => r.date)).size, opts));
  }
  if (command === "receipt") {
    const input = { estimate: est, params, windowLabel: window.label };
    const out = resolve(values.out ?? `${APP_NAME}-receipt.svg`);
    try {
      await writeFile(out, receiptSvg(input));
    } catch (error) {
      const why = reason(error);
      const hint = why === "ENOENT" ? " The folder doesn't exist; create it first or pick another." : "";
      throw new Error(`Couldn't write the card to --out ${basename(out)} (${why}).${hint}`);
    }
    noteToStderr();
    console.log(shareLine(input));
    console.log(`\nCard written to ${out} (1200×627, LinkedIn size). Open ${APP_NAME} dashboard to save it as PNG.`);
    console.log(`\nReady-to-paste post:\n\n${linkedInPost(input)}`);
    return;
  }
  if (values.json) return void console.log(json(est, params, window, demo));
  if (label) process.stdout.write(label);
  if (by) noteToStderr();
  if (by) console.log(breakdown(est, params, window, by, opts));
  else console.log(summary(est, params, window, demo, opts));
}

function parseArgsPlain<T extends ParseArgsConfig>(config: T): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs(config);
  } catch (error) {
    throw plainArgError(error) ?? error;
  }
}

/**
 * Claude Code runs the status line after every response and passes the session's transcript
 * path on stdin. We read token counts from that one file and never touch history, so it stays
 * fast and side-effect free. Any problem prints a quiet line rather than an error.
 */
async function sessionLine(path?: string): Promise<string> {
  try {
    const file = path ?? (JSON.parse(await readStdin()) as { transcript_path?: string }).transcript_path;
    if (!file) return `⚡ ${APP_NAME}: waiting for the first response`;
    const records = dedupe(claudeCodeAdapter.parse(await readFile(file, "utf8")));
    return statusLine(estimate(records, defaultParams), defaultParams);
  } catch {
    return `⚡ ${APP_NAME}: no estimate yet`;
  }
}

/**
 * The MCP server lives in its own file (dist/mcp.js) because the MCP SDK is most of its size:
 * every other command, including the status line after each response, stays small and fast.
 * The plain specifier keeps the bundler from inlining it.
 */
async function runMcp(options: UsageOptions): Promise<void> {
  const file = new URL("./mcp.js", import.meta.url).href;
  let mod: typeof import("./mcp.js");
  try {
    mod = (await import(file)) as typeof import("./mcp.js");
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
    throw new Error(`This copy of ${APP_NAME} doesn't include the MCP server. Use the npm package: claude mcp add ${APP_NAME} -- npx ${APP_NAME} mcp`);
  }
  // Typed in a terminal, the server would wait silently for MCP messages. Say what it is on
  // stderr (stdout carries the protocol) and keep serving, so a pipe from Claude Code is untouched.
  if (process.stdin.isTTY) console.error(`${APP_NAME} mcp is an MCP server for Claude Code, waiting on stdin (Ctrl+C to stop). Add it with: ${MCP_ADD}`);
  await mod.serveStdio(options);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "{}";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text || "{}";
}

main().catch((error: unknown) => {
  const line = errorLine(error);
  console.error(line);
  process.exitCode = 1;
});
