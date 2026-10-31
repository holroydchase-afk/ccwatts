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
  weekStart,
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
  REST_DAY_MINUTES,
  type PaceDay,
  type PaceRange,
  type PaceWeek,
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
  const shown = rows.slice(0, max).map((r) => `${clip(label(r.key))} ${percent(r.energy.central, total)}`);
  const rest = rows.slice(max).reduce((s, r) => s + r.energy.central, 0);
  if (rest > 0) shown.push(`other ${percent(rest, total)}`);
  return shown.join("   ");
}

/** Longest name a table or summary line shows; longer ones end in "…" so lines fit a terminal. */
const LABEL_MAX = 40;

/** A label cut to `max` characters with an ellipsis. Cuts by code point, so an emoji stays whole. */
export function clip(label: string, max = LABEL_MAX): string {
  const chars = [...label];
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join("")}…`;
}

/** Options for the text renderers. color adds ANSI bold and dim (index.ts turns it on for a TTY); now decides the in-progress week. */
export type RenderOptions = { color?: boolean | undefined; now?: Date | undefined };

/** ANSI styles written by hand (no dependency). Every one is a no-op when color is off. */
export function styles(on = false) {
  const wrap = (open: string, close: string) => (s: string) => (on && s ? `\u001b[${open}m${s}\u001b[${close}m` : s);
  return { bold: wrap("1", "22"), dim: wrap("2", "22"), yellow: wrap("33", "39") };
}

export function header(params: Params, window: Window): string {
  return `${APP_NAME} v${APP_VERSION} · method v${params.version} · ${window.label}`;
}

export function summary(e: Estimate, params: Params, window: Window, sample = false, opts: RenderOptions = {}): string {
  if (e.responses === 0) return `${header(params, window)}\n\n  No Claude Code usage found in this window. Try --since all.`;
  const { bold, dim } = styles(opts.color);
  const total = energy(e.total);
  const kwh = e.total.central / 1000;
  const compare = everyday(kwh, params);
  const top = e.byProject[0];
  const lines = [
    header(params, window),
    "",
    `  Electricity   ${bold(total.central)}   ${dim(`(range ${total.range})`)}`,
    `  ≈ ${compare}`,
    "",
    `  By model      ${shares(e.byModel, e.total.central, shortModel, 3)}`,
    `  By type       ${shares(e.byType, e.total.central, (k) => TYPE_LABELS[k as TokenType])}`,
  ];
  if (top) {
    const t = energy(top.energy);
    lines.push(`  Top project   ${clip(projectName(top.key))}   ${t.central} ${dim(`(range ${t.range})`)}`);
  }
  const span = !e.span ? "" : e.span.from === e.span.to ? ` · ${e.span.from}` : ` · ${e.span.from} to ${e.span.to}`;
  lines.push(`  Based on      ${int(e.responses)} response${e.responses === 1 ? "" : "s"}, ${int(totalTokens(e.tokens))} tokens${span}`);
  for (const w of e.warnings) lines.push(`  Note          ${w}`);
  const next = sample ? `Your own usage: ${APP_NAME}` : `Share: ${APP_NAME} receipt`;
  lines.push("", dim(`  How this is estimated: ${APP_NAME} --method   ·   ${next}`));
  return lines.join("\n");
}

type Align = "left" | "right";

/**
 * A plain-text table, indented 2 spaces like the summary (the --method listing passes no indent). Column i is left-aligned when i < alignLeft
 * or align[i] says so. dimCols are dimmed after padding, so ANSI codes never upset the widths.
 */
function table(
  head: string[],
  rows: string[][],
  alignLeft = 1,
  o: { align?: Align[]; dimCols?: number[]; color?: boolean | undefined; indent?: string; gutter?: string } = {},
): string {
  const { dim } = styles(o.color);
  const indent = o.indent ?? "  ";
  const gutter = o.gutter ?? "   ";
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const left = (i: number) => (o.align?.[i] ?? (i < alignLeft ? "left" : "right")) === "left";
  const line = (cells: string[], styled: boolean) =>
    indent +
    cells
      .map((c, i) => {
        const padded = left(i) ? c.padEnd(widths[i]!) : c.padStart(widths[i]!);
        return styled && o.dimCols?.includes(i) ? dim(padded) : padded;
      })
      .join(gutter)
      .trimEnd();
  return [line(head, false), dim(indent + widths.map((w) => "-".repeat(w)).join(gutter)), ...rows.map((r) => line(r, true))].join("\n");
}

const DIM_ROWS: Record<Dimension, keyof Estimate> = { model: "byModel", type: "byType", day: "byDay", project: "byProject" };

export function breakdown(e: Estimate, params: Params, window: Window, dim: Dimension, opts: RenderOptions = {}): string {
  const rows = e[DIM_ROWS[dim]] as Breakdown[];
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1000 : 1;
  const label = (key: string) =>
    dim === "type" ? TYPE_LABELS[key as TokenType] : dim === "project" ? clip(projectName(key)) : dim === "model" ? clip(shortModel(key)) : key;
  const body = rows.map((r) => [
    label(r.key),
    int(totalTokens(r.tokens)),
    num(r.energy.central / scale),
    `${num(r.energy.low / scale)} – ${num(r.energy.high / scale)}`,
    percent(r.energy.central, e.total.central),
  ]);
  const t = energy(e.total);
  body.push(["total", int(totalTokens(e.tokens)), num(e.total.central / scale), t.range, "100%"]);
  return [header(params, window), "", table([dim, "tokens", unit, "range", "share"], body, 1, { dimCols: [3], color: opts.color })].join("\n");
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
  lines.push(table(["parameter", "value", "range", "unit", "label"], rows, 1, { indent: "" }));
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

export function history(e: Estimate, params: Params, window: Window, storedDays: number, opts: RenderOptions = {}): string {
  if (e.responses === 0) return `${header(params, window)}\n\n  No history yet. Run ${APP_NAME} once to start recording.`;
  const { bold, dim } = styles(opts.color);
  const weeks = weekly(e.byDay);
  const unit = energy(e.total).unit;
  const scale = unit === "kWh" ? 1000 : 1;
  // The week that holds "now" is still running, so it is marked and never called the lightest.
  const current = weekStart((opts.now ?? new Date()).toISOString().slice(0, 10));
  const partial = (start: string) => start === current;
  const tag = (start: string) => (partial(start) ? `${start} (partial)` : start);
  const peak = Math.max(...weeks.map((x) => x.central), 1e-9);
  const rows = weeks.map((w) => [
    `week of ${tag(w.start)}`,
    num(w.central / scale),
    `${num(w.low / scale)} – ${num(w.high / scale)}`,
    "█".repeat(Math.round((w.central / peak) * 20)),
  ]);
  const active = weeks.filter((w) => w.central > 0);
  const complete = active.filter((w) => !partial(w.start));
  const pool = complete.length ? complete : active;
  const best = pool.reduce((a, b) => (b.central < a.central ? b : a), pool[0]!);
  const worst = active.reduce((a, b) => (b.central > a.central ? b : a), active[0]!);
  const total = energy(e.total);
  const lines = [
    header(params, window),
    "",
    table(["week", unit, "range", "trend"], rows, 1, { align: ["left", "right", "right", "left"], dimCols: [2], color: opts.color }),
    "",
    `  Trend         ${sparkline(weeks.map((w) => w.central))}`,
    `  Total         ${bold(total.central)}   ${dim(`(range ${total.range})`)}`,
    // With one week of use, "lightest" and "heaviest" would name the same week.
    ...(active.length > 1 && best !== worst
      ? [
          `  Lightest week ${tag(best.start)}   ${energy(best).central} ${dim(`(range ${energy(best).range})`)}`,
          `  Heaviest week ${tag(worst.start)}   ${energy(worst).central} ${dim(`(range ${energy(worst).range})`)}`,
        ]
      : []),
    `  Recorded      ${storedDays} day${storedDays === 1 ? "" : "s"}, kept in your local history even after Claude Code deletes old logs`,
    "",
    dim(`  Energy is recalculated from stored token counts with method v${params.version}.`),
  ];
  return lines.join("\n");
}

/**
 * One CSV cell. A text cell that starts with = + - @, a tab or a carriage return gets a leading
 * apostrophe, so a spreadsheet shows it as text and never runs it as a formula (a folder can be
 * named "=HYPERLINK(…)"). Numbers are written as numbers.
 */
const csvCell = (v: string | number) => {
  if (typeof v === "number") return String(v);
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

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

/** Hours for pace: whole hours from 10 up, one decimal below ("0.5", "6.4", "28"). */
export function paceHours(h: number): string {
  if (h === 0) return "0";
  return h >= 10 ? int(h) : (Math.round(h * 10) / 10).toFixed(1);
}

/** Minutes as "4h 10m", "45m" or "6h". */
export function hm(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Oct 26" from a YYYY-MM-DD date, with no time zone involved. */
const monthDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** "10pm" from a 0-23 hour. */
const clockHour = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

/** What pace() and paceJson() need beyond the weeks. */
export interface PaceView {
  /** Newest first; the first is the current week. */
  weeks: PaceWeek[];
  versus: { later: boolean; longer: boolean } | null;
  /** Local YYYY-MM-DD. */
  today: string;
  /** Where pace.jsonl was written, as shown to the user (never a full home path), or null if not saved. */
  savedTo: string | null;
}

/** "About 33 active hours (range 29 – 36)": central first, then the range, like the main summary. */
const activeLead = (r: PaceRange) => `about ${paceHours(r.central)} active hours (range ${hoursRange(r)})`;

/** One coarse line for receipt --share-pace: this week's active hours as a range, nothing finer. */
export function paceShareLine(week: PaceWeek): string {
  return week.activeHours.high > 0 ? `Pace this week: ${activeLead(week.activeHours)}.` : "Pace this week: no active hours yet.";
}

const hoursRange = (r: PaceRange) => `${paceHours(r.low)} – ${paceHours(r.high)}`;

/** Words wrapped to `width` columns (plain text, before any styling), each line indented. Never splits "2h 18m" or "29 – 36". */
function wrap(text: string, indent = "  ", width = 80): string[] {
  const glue = "\u0000";
  const kept = text.replace(/(\d+h) (\d+m)/g, `$1${glue}$2`).replace(/ – /g, `${glue}–${glue}`);
  const lines: string[] = [];
  let line = "";
  for (const word of kept.split(" ")) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.map((l) => l.replaceAll(glue, " "));
}

/** "20 to 24" or "30m to 1h": the lowest and highest of the earlier weeks. */
const spanOf = (values: number[], show: (n: number) => string) => {
  const lo = show(Math.min(...values));
  const hi = show(Math.max(...values));
  return lo === hi ? lo : `${lo} to ${hi}`;
};

/** The terminal view of `ccwatts pace`: this week in words, four weeks in a table, the method in the footer. No scores, no verdicts. */
export function pace(view: PaceView, params: Params, opts: RenderOptions = {}): string {
  const { bold, dim } = styles(opts.color);
  const [now, ...earlier] = view.weeks;
  if (!now) return "";
  const late = clockHour(params.pace.late_night.start_hour);
  const g = params.pace.gap_minutes;
  const activeDays = now.daysCounted - now.restDays;
  const lead = activeLead(now.activeHours);
  const Lead = `${lead[0]!.toUpperCase()}${lead.slice(1)}`;
  const prose = wrap(
    `${Lead}, ${hm(now.lateNightHours * 60)} past ${late}, longest stretch ${hm(now.longestStretchMinutes)}, active ${activeDays} of ${now.daysCounted} days so far.`,
  );
  prose[0] = prose[0]!.replace(Lead, bold(Lead));
  const lines = [`${APP_NAME} v${APP_VERSION} · method v${params.version} · pace, week of ${monthDay(now.start)} (partial)`, "", ...prose];
  if (now.agentHours.high > 0) lines.push(...wrap(`Agents worked another ${hoursRange(now.agentHours)} hours on their own.`));
  // Numbers, not a verdict: this week next to the spread of the user's own earlier weeks (never a norm).
  const usual = earlier.filter((w) => w.activeHours.central > 0);
  if (view.versus && usual.length >= 2) {
    const among = usual.length === earlier.length ? `your last ${usual.length} weeks` : `${usual.length} of your last ${earlier.length} weeks`;
    if (view.versus.longer) {
      const span = spanOf(usual.map((w) => w.activeHours.central), paceHours);
      lines.push(...wrap(`Active hours: about ${paceHours(now.activeHours.central)}, vs ${span} in ${among}.`));
    }
    if (view.versus.later) {
      const span = spanOf(usual.map((w) => w.lateNightHours * 60), hm);
      lines.push(...wrap(`Past ${late}: ${hm(now.lateNightHours * 60)}, vs ${span} in ${among}.`));
    }
  }
  const rows = view.weeks.map((w, i) => [
    i === 0 ? `${monthDay(w.start)} (partial)` : monthDay(w.start),
    hoursRange(w.activeHours),
    hm(w.lateNightHours * 60),
    hm(w.longestStretchMinutes),
    String(w.restDays),
    hoursRange(w.agentHours),
  ]);
  lines.push(
    "",
    table(["Week of", "Active (h)", `Past ${late}`, "Longest", "Days off", "Agent-only (h)"], rows, 1, { dimCols: [5], color: opts.color, gutter: "  " }),
    "",
    dim(`  Active time counts idle gaps under ${g.low}/${g.value}/${g.high} min (low/central/high) as work.`),
    dim(`  Past ${late} and Longest use the ${g.value}-min gap.`),
    dim(`  A day off has under ${REST_DAY_MINUTES} active minutes. Agent-only: no turn from you.`),
    dim(`  Heuristic, not a measurement · method v${params.version}`),
  );
  if (view.savedTo) lines.push(...[...wrap(`Saved to ${view.savedTo} (daily minutes and whole hours only).`), "  Delete it any time."].map((l) => dim(l)));
  return lines.join("\n");
}

/** `ccwatts pace --json`: the weeks, the method and its gaps. No zone, no times of day beyond whole hours. */
export function paceJson(view: PaceView, params: Params, sample: boolean): string {
  const g = params.pace.gap_minutes;
  const gapMinutes = { low: g.low, central: g.value, high: g.high };
  return JSON.stringify(
    {
      app: APP_NAME,
      version: APP_VERSION,
      method: {
        version: params.version,
        gapMinutes,
        breakMinutes: params.pace.break_minutes.value,
        lateNight: { startHour: params.pace.late_night.start_hour, endHour: params.pace.late_night.end_hour },
      },
      unit: "hours",
      sample,
      versusUsual: view.versus,
      weeks: view.weeks,
    },
    null,
    2,
  );
}

/** Daily pace rows as CSV: counts in minutes and whole local hours only. */
export function paceCsv(days: readonly PaceDay[]): string {
  const head = [
    "date",
    "active_low_min",
    "active_central_min",
    "active_high_min",
    "agent_low_min",
    "agent_central_min",
    "agent_high_min",
    "late_night_min",
    "longest_stretch_min",
    "first_hour",
    "last_hour",
  ];
  const body = days.map((d) => [
    d.date,
    d.activeMinutes.low,
    d.activeMinutes.central,
    d.activeMinutes.high,
    d.agentMinutes.low,
    d.agentMinutes.central,
    d.agentMinutes.high,
    d.lateNightMinutes,
    d.longestStretchMinutes,
    d.firstHour ?? "",
    d.lastHour ?? "",
  ]);
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\n");
}
