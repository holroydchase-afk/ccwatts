import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  APP_NAME,
  APP_VERSION,
  REPO_URL,
  TOKEN_TYPES,
  comparisons,
  defaultParams,
  everyday,
  formatEnergy,
  parseSince,
  projectName,
  weekly,
  type Breakdown,
  type Estimate,
  type Params,
  type Range,
  type TokenCounts,
  type Window,
} from "@ccwatts/core";
import { errorLine, reason } from "./errors.js";
import { estimateWindow, loadUsage, type Usage, type UsageOptions } from "./usage.js";

/**
 * `ccwatts mcp`: a Model Context Protocol server on stdio, so Claude Code can ask about its own
 * energy use. Claude Code starts it on demand and talks over stdin/stdout: no port, no listener,
 * no network (ANCHORS D14). Tools wrap the same pure core as the CLI, and every answer carries
 * low/central/high in Wh plus the method version. Counts only, project names as basenames.
 */

const SINCE = z
  .string()
  .optional()
  .describe('Time window: "7d", "12h", "4w", a date like "2026-10-01", or "all".');

const round = (n: number) => Math.round(n * 1000) / 1000;
const wh = (r: Range) => ({ low: round(r.low), central: round(r.central), high: round(r.high) });
const tokenTotal = (t: TokenCounts) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);
const share = (r: Breakdown, total: Range) => (total.central > 0 ? Math.round((r.energy.central / total.central) * 100) : 0);

/** "1.2 kWh (range 0.4 – 3.1 kWh)" */
function text(r: Range): string {
  const f = formatEnergy(r);
  return `${f.central} (range ${f.range} ${f.unit})`;
}

/** Fields every energy answer starts with, so no number goes out without its method version. */
function base(params: Params, window: Window | null, usage: Pick<Usage, "sample">) {
  return {
    app: APP_NAME,
    version: APP_VERSION,
    methodVersion: params.version,
    unit: "Wh",
    ...(usage.sample ? { sample: true, note: "Sample data (synthetic), not the user's usage." } : {}),
    ...(window ? { window: window.label } : {}),
  };
}

export function energySummary(usage: Usage, window: Window, params: Params) {
  const e = estimateWindow(usage, window, params);
  return {
    ...base(params, window, usage),
    summary: e.responses
      ? `About ${text(e.total)} of electricity, ${window.label}: ${everyday(e.total.central / 1000, params)}. Estimate, method v${params.version}.`
      : `No Claude Code usage found, ${window.label}.`,
    wh: wh(e.total),
    span: e.span,
    responses: e.responses,
    tokens: e.tokens,
    comparisons: comparisons(e.total.central / 1000, params).map((c) => ({ id: c.id, amount: round(c.amount), text: c.text })),
    byModel: e.byModel.map((r) => ({ model: r.key, wh: wh(r.energy), share: share(r, e.total), tokens: tokenTotal(r.tokens) })),
    byType: e.byType.map((r) => ({ type: r.key, wh: wh(r.energy), share: share(r, e.total), tokens: tokenTotal(r.tokens) })),
    warnings: e.warnings,
  };
}

export function energyByProject(usage: Usage, window: Window, params: Params) {
  const e = estimateWindow(usage, window, params);
  const top = e.byProject[0];
  return {
    ...base(params, window, usage),
    summary: top
      ? `${e.byProject.length} project${e.byProject.length === 1 ? "" : "s"}, ${window.label}. Top: ${projectName(top.key)} at ${text(top.energy)}.`
      : `No Claude Code usage found, ${window.label}.`,
    wh: wh(e.total),
    // Folder basename plus a hash of the full path: two folders with the same name stay apart.
    projects: e.byProject.map((r) => ({
      name: projectName(r.key),
      projectId: r.key.split("#")[1] ?? null,
      wh: wh(r.energy),
      share: share(r, e.total),
      tokens: tokenTotal(r.tokens),
    })),
    warnings: e.warnings,
  };
}

export function energyWeekly(usage: Usage, window: Window, params: Params) {
  const e: Estimate = estimateWindow(usage, window, params);
  const weeks = weekly(e.byDay).map((w) => ({ weekOf: w.start, wh: wh(w), tokens: w.tokens }));
  const active = weeks.filter((w) => w.wh.central > 0);
  const pick = (better: (a: number, b: number) => boolean) =>
    active.reduce<(typeof weeks)[number] | null>((a, b) => (a === null || better(b.wh.central, a.wh.central) ? b : a), null);
  return {
    ...base(params, window, usage),
    summary: weeks.length
      ? `${weeks.length} week${weeks.length === 1 ? "" : "s"}, ${text(e.total)} in all. Weeks start on Monday (UTC).`
      : `No Claude Code usage found, ${window.label}.`,
    wh: wh(e.total),
    weeks,
    lightestWeek: pick((a, b) => a < b)?.weekOf ?? null,
    heaviestWeek: pick((a, b) => a > b)?.weekOf ?? null,
  };
}

export function methodology(params: Params) {
  return {
    ...base(params, null, { sample: false }),
    summary: `ccwatts estimates electricity from token counts with sourced per-token parameters. Every result is a range (${params.interval}). It is an estimate, not a measurement.`,
    asOf: params.as_of,
    license: params.license,
    boundary: params.boundary,
    interval: params.interval,
    howRangesCombine: "Each parameter's low/high is an independent interval on a log scale; spreads combine root-sum-of-squares, and ranges add across token types.",
    parameters: Object.entries(params.params).map(([id, p]) => ({
      id,
      value: p.value,
      low: p.low,
      high: p.high,
      unit: p.unit,
      label: p.label,
      source: p.source,
      asOf: p.as_of,
    })),
    comparisons: Object.entries(params.comparisons).map(([id, c]) => ({ id, value: c.value, unit: c.unit, source: c.source })),
    writeUp: `${REPO_URL}/blob/main/METHODOLOGY.md`,
  };
}

const reply = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const problem = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Builds the server. Logs are read on each call, so answers stay current in a long session. */
export function createServer(options: UsageOptions = {}, params: Params = defaultParams): McpServer {
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  const windowed = (build: (usage: Usage, window: Window, params: Params) => unknown, fallback: string) =>
    async ({ since }: { since?: string | undefined }) => {
      let usage: Usage;
      try {
        usage = await loadUsage(options);
      } catch (error) {
        // An fs error's message names the file; send only its code. Our own messages are already plain.
        const code = (error as { code?: unknown } | null)?.code;
        return problem(typeof code === "string" ? `${APP_NAME} couldn't read the logs (${reason(error)}).` : errorLine(error));
      }
      if (usage.rows.length === 0) {
        // No paths here: the answer goes into a model's context, not the user's own terminal.
        return problem(`No Claude Code logs found. ${APP_NAME} reads ~/.claude/projects, or the folders in CLAUDE_CONFIG_DIR.`);
      }
      let window: Window;
      try {
        window = parseSince(since ?? fallback, usage.now);
      } catch (error) {
        return problem(error instanceof Error ? error.message : String(error));
      }
      return reply(build(usage, window, params));
    };

  server.registerTool(
    "energy_summary",
    {
      title: "Energy summary",
      description:
        "Estimated electricity used by the user's Claude Code sessions in a time window (default the last 7 days), as a low/central/high range in Wh, with everyday comparisons and a split by model and token type. Read from local logs; counts only.",
      inputSchema: { since: SINCE },
      annotations: readOnly,
    },
    windowed(energySummary, "7d"),
  );
  server.registerTool(
    "energy_by_project",
    {
      title: "Energy by project",
      description:
        "Estimated electricity per project (folder name) in a time window (default the last 7 days), largest first, each as a low/central/high range in Wh with its share of the total.",
      inputSchema: { since: SINCE },
      annotations: readOnly,
    },
    windowed(energyByProject, "7d"),
  );
  server.registerTool(
    "energy_weekly",
    {
      title: "Weekly energy",
      description:
        "Estimated electricity per week (Monday start, UTC), as low/central/high ranges in Wh, plus the lightest and heaviest weeks. Defaults to all recorded history.",
      inputSchema: { since: SINCE },
      annotations: readOnly,
    },
    windowed(energyWeekly, "all"),
  );
  server.registerTool(
    "methodology",
    {
      title: "Methodology",
      description:
        "How ccwatts estimates energy: method version, boundary, every parameter with its range and source, and the everyday comparisons. Use it to explain or caveat a number.",
      annotations: readOnly,
    },
    async () => reply(methodology(params)),
  );
  return server;
}

/** Serves on stdin/stdout until Claude Code closes the pipe. stdout is the protocol, so notes go to stderr. */
export async function serveStdio(options: UsageOptions): Promise<void> {
  await createServer(options).connect(new StdioServerTransport());
}
