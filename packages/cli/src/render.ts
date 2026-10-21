import {
  APP_NAME,
  APP_VERSION,
  comparisons,
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

export const TYPE_LABELS: Record<TokenType, string> = {
  input: "input",
  cacheWrite: "cache write",
  cacheRead: "cache read",
  output: "output",
};

const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Rounds to a sensible number of digits for its size. */
export function num(n: number): string {
  if (n >= 100) return int(n);
  if (n >= 1) return (Math.round(n * 10) / 10).toString();
  if (n >= 0.01) return (Math.round(n * 100) / 100).toString();
  return n === 0 ? "0" : n.toPrecision(1);
}

/** Picks Wh or kWh from the central value and uses it for the whole range. */
export function energy(range: Range): { central: string; range: string; unit: string } {
  const kwh = range.central >= 1000;
  const scale = kwh ? 1000 : 1;
  const unit = kwh ? "kWh" : "Wh";
  return {
    central: `${num(range.central / scale)} ${unit}`,
    range: `${num(range.low / scale)} – ${num(range.high / scale)}`,
    unit,
  };
}

export const shortModel = (model: string) => model.replace(/^claude-/, "");

const totalTokens = (t: TokenCounts) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);

function shares(rows: Breakdown[], total: number, label: (key: string) => string, max = 4): string {
  const pct = (r: Breakdown) => (total > 0 ? Math.round((r.energy.central / total) * 100) : 0);
  const shown = rows.slice(0, max).map((r) => `${label(r.key)} ${pct(r)}%`);
  const rest = rows.slice(max).reduce((s, r) => s + r.energy.central, 0);
  if (rest > 0) shown.push(`other ${Math.round((rest / total) * 100)}%`);
  return shown.join("   ");
}

/** Up to two comparisons big enough to picture (at least 1 of the thing), else the largest one. */
export function everyday(kwh: number, params: Params): string {
  const all = comparisons(kwh, params);
  const big = all.filter((c) => c.amount >= 1).slice(0, 2);
  const fallback = [...all].sort((a, b) => b.amount - a.amount).slice(0, 1);
  return (big.length ? big : fallback).map((c) => c.text).join(" · ");
}

export function header(params: Params, window: Window): string {
  return `${APP_NAME} v${APP_VERSION} · method v${params.version} · ${window.label}`;
}

export function summary(e: Estimate, params: Params, window: Window): string {
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
  const span = e.span ? ` · ${e.span.from} to ${e.span.to}` : "";
  lines.push(`  Based on      ${int(e.responses)} responses, ${int(totalTokens(e.tokens))} tokens${span}`);
  for (const w of e.warnings) lines.push(`  Note          ${w}`);
  lines.push("", `  How this is estimated: ${APP_NAME} --method   ·   Share: ${APP_NAME} receipt`);
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
    e.total.central > 0 ? `${Math.round((r.energy.central / e.total.central) * 100)}%` : "0%",
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
  lines.push("", "Full write-up: METHODOLOGY.md");
  return lines.join("\n");
}

/** Same numbers as the table output, in Wh, for scripts. */
export function json(e: Estimate, params: Params, window: Window): string {
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
