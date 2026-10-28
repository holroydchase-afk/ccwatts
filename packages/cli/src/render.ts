import {
  APP_NAME,
  TYPE_LABELS,
  everyday,
  formatEnergy,
  int,
  num,
  shortModel,
  APP_VERSION,
  REPO_URL,
  comparisons,
  energyForCounts,
  tierFor,
  weekly,
  type RollupRow,
  projectName,
  TOKEN_TYPES,
  type Breakdown,
  type Dimension,
  type Estimate,
  type Params,
  type Range,
  type TokenCounts,
  type TokenType,
  type Window,
} from "@ccwatts/core";

/** Kept as the CLI's name for the shared formatter. */
export const energy = formatEnergy;
export { num };

const totalTokens = (t: TokenCounts) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);

/** A share as a whole percent, but "<1%" when it is above zero and would round to 0. */
export function percent(part: number, total: number): string {
  if (!(total > 0)) return "0%";
  const p = Math.round((part / total) * 100);
  return p === 0 && part > 0 ? "<1%" : `${p}%`;
}

function shares(rows: Breakdown[], total: number, label: (key: string) => string, max = 4): string {
  const shown = rows.slice(0, max).map((r) => `${label(r.key)} ${percent(r.energy.central, total)}`);
  const rest = rows.slice(max).reduce((s, r) => s + r.energy.central, 0);
  if (rest > 0) shown.push(`other ${percent(rest, total)}`);
  return shown.join("   ");
}

export function header(params: Params, window: Window): string {
  return `${APP_NAME} v${APP_VERSION} · method v${params.version} · ${window.label}`;
}

export function summary(e: Estimate, params: Params, window: Window, sample = false): string {
  if (e.responses === 0) return `${header(params, window)}\n\n  No Claude Code usage found in this window. Try --since all.`;
  const total = energy(e.total);
  const kwh = e.total.central / 1000;
  const compare = everyday(kwh, params);
  const top = e.byProject[0];
  const lines = [
    header(params, window),
    "",
    `  Electricity   ${total.central}   (range ${total.range})`,
    `  ≈ ${compare}`,
    "",
    `  By model      ${shares(e.byModel, e.total.central, shortModel, 3)}`,
    `  By type       ${shares(e.byType, e.total.central, (k) => TYPE_LABELS[k as TokenType])}`,
  ];
  if (top) {
    const t = energy(top.energy);
    lines.push(`  Top project   ${projectName(top.key)}   ${t.central} (range ${t.range})`);
  }
  const span = !e.span ? "" : e.span.from === e.span.to ? ` · ${e.span.from}` : ` · ${e.span.from} to ${e.span.to}`;
  lines.push(`  Based on      ${int(e.responses)} responses, ${int(totalTokens(e.tokens))} tokens${span}`);
  for (const w of e.warnings) lines.push(`  Note          ${w}`);
  const next = sample ? `Your own usage: ${APP_NAME}` : `Share: ${APP_NAME} receipt`;
  lines.push("", `  How this is estimated: ${APP_NAME} --method   ·   ${next}`);
  return lines.join("\n");
}

function table(head: string[], rows: string[][], alignLeft = 1): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i < alignLeft ? c.padEnd(widths[i]!) : c.padStart(widths[i]!)))
      .join("   ")
      .trimEnd();
  return [line(head), widths.map((w) => "-".repeat(w)).join("   "), ...rows.map(line)].join("\n");
}

const DIM_ROWS: Record<Dimension, keyof Estimate> = { model: "byModel", type: "byType", day: "byDay", project: "byProject" };

export function breakdown(e: Estimate, params: Params, window: Window, dim: Dimension): string {
  const rows = e[DIM_ROWS[dim]] as Breakdown[];
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1000 : 1;
  const label = (key: string) =>
    dim === "type" ? TYPE_LABELS[key as TokenType] : dim === "project" ? projectName(key) : dim === "model" ? shortModel(key) : key;
  const body = rows.map((r) => [
    label(r.key),
    int(totalTokens(r.tokens)),
    num(r.energy.central / scale),
    `${num(r.energy.low / scale)} – ${num(r.energy.high / scale)}`,
    percent(r.energy.central, e.total.central),
  ]);
  const t = energy(e.total);
  body.push(["total", int(totalTokens(e.tokens)), num(e.total.central / scale), t.range, "100%"]);
  return [header(params, window), "", table([dim, "tokens", unit, "range", "share"], body)].join("\n");
}

export function method(params: Params): string {
  const lines = [
    `${APP_NAME} method v${params.version} · parameters as of ${params.as_of} · ${params.license}`,
    "",
    `Boundary: ${params.boundary}.`,
    `Ranges: ${params.interval}; spreads combine root-sum-of-squares on a log scale.`,
    "",
  ];
  const rows = Object.entries(params.params).map(([id, p]) => [id, `${p.value}`, `${p.low} – ${p.high}`, p.unit, p.label]);
  lines.push(table(["parameter", "value", "range", "unit", "label"], rows, 1));
  lines.push("", "Sources:");
  for (const [id, p] of Object.entries(params.params)) lines.push(`  ${id}: ${p.source}`);
  lines.push("", "Comparisons (central value only):");
  for (const [id, c] of Object.entries(params.comparisons)) lines.push(`  ${id}: ${c.value} ${c.unit} · ${c.source}`);
  lines.push("", `Full write-up: ${REPO_URL}/blob/main/METHODOLOGY.md`);
  return lines.join("\n");
}

/** Same numbers as the table output, in Wh, for scripts. */
export function json(e: Estimate, params: Params, window: Window, sample = false): string {
  const rows = (list: Breakdown[], dim: Dimension) =>
    list.map((r) => ({
      key: dim === "project" ? projectName(r.key) : r.key,
      ...(dim === "project" ? { projectId: r.key.split("#")[1] ?? null } : {}),
      wh: r.energy,
      tokens: r.tokens,
    }));
  return JSON.stringify(
    {
      app: APP_NAME,
      version: APP_VERSION,
      methodVersion: params.version,
      unit: "Wh",
      ...(sample ? { sample: true } : {}),
      window,
      span: e.span,
      responses: e.responses,
      tokens: e.tokens,
      wh: e.total,
      comparisons: comparisons(e.total.central / 1000, params).map(({ id, amount }) => ({ id, amount })),
      byModel: rows(e.byModel, "model"),
      byType: rows(e.byType, "type"),
      byDay: rows(e.byDay, "day"),
      byProject: rows(e.byProject, "project"),
      warnings: e.warnings,
    },
    null,
    2,
  );
}

/** What --json prints when there is nothing to estimate: a code for scripts and a plain message, no paths. */
export function jsonError(error: "no_logs" | "no_usage", message: string): string {
  return JSON.stringify({ app: APP_NAME, version: APP_VERSION, error, message }, null, 2);
}

const BARS = "▁▂▃▄▅▆▇█";

/** Terminal sparkline, one character per value, scaled to the largest. */
export function sparkline(values: number[]): string {
  const max = Math.max(...values, 0);
  return values.map((v) => (max === 0 ? BARS[0] : BARS[Math.min(7, Math.round((v / max) * 7))])).join("");
}

export function history(e: Estimate, params: Params, window: Window, storedDays: number): string {
  if (e.responses === 0) return `${header(params, window)}\n\n  No history yet. Run ${APP_NAME} once to start recording.`;
  const weeks = weekly(e.byDay);
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1000 : 1;
  const rows = weeks.map((w) => [
    `week of ${w.start}`,
    num(w.central / scale),
    `${num(w.low / scale)} – ${num(w.high / scale)}`,
    "█".repeat(Math.round((w.central / Math.max(...weeks.map((x) => x.central), 1e-9)) * 20)),
  ]);
  const active = weeks.filter((w) => w.central > 0);
  const best = active.reduce((a, b) => (b.central < a.central ? b : a), active[0]!);
  const worst = active.reduce((a, b) => (b.central > a.central ? b : a), active[0]!);
  const total = energy(e.total);
  const lines = [
    header(params, window),
    "",
    table(["week", unit, "range", ""], rows),
    "",
    `  Trend         ${sparkline(weeks.map((w) => w.central))}`,
    `  Total         ${total.central}   (range ${total.range})`,
    // With one week of use, "lightest" and "heaviest" would name the same week.
    ...(active.length > 1
      ? [
          `  Lightest week ${best.start}   ${energy(best).central} (range ${energy(best).range})`,
          `  Heaviest week ${worst.start}   ${energy(worst).central} (range ${energy(worst).range})`,
        ]
      : []),
    `  Recorded      ${storedDays} day${storedDays === 1 ? "" : "s"}, kept in your local history even after Claude Code deletes old logs`,
    "",
    `  Energy is recalculated from stored token counts with method v${params.version}.`,
  ];
  return lines.join("\n");
}

const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Daily rows as CSV, with energy recomputed under the current method. */
export function historyCsv(rows: readonly RollupRow[], params: Params): string {
  const head = ["date", "model", "project", "responses", "input", "cache_write", "cache_read", "output", "wh_low", "wh_central", "wh_high", "method_version"];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const body = rows.map((r) => {
    const wh = energyForCounts(r.tokens, tierFor(r.model, params).tier, params);
    return [r.date, r.model, r.projectName ?? "", r.responses, r.tokens.input, r.tokens.cacheWrite, r.tokens.cacheRead, r.tokens.output, round(wh.low), round(wh.central), round(wh.high), params.version];
  });
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\n");
}

/** One short line for the Claude Code status line: this session's energy, its range and the method version. */
export function statusLine(e: Estimate, params: Params): string {
  if (e.responses === 0) return `⚡ ${APP_NAME}: no usage yet this session`;
  const t = formatEnergy(e.total);
  return `⚡ ~${t.central} this session (range ${t.range}) · method v${params.version}`;
}
