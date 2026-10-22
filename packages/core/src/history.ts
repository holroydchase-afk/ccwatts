import { TOKEN_TYPES, type TokenCounts, type UsageRecord } from "./types.js";

export const HISTORY_SCHEMA = 1;

/**
 * One day of usage for one model in one project. Counts only: no content, no full paths.
 * Energy is never stored; it is recomputed from these counts with the current params.
 */
export interface RollupRow {
  date: string;
  source: string;
  model: string;
  projectId: string | null;
  projectName: string | null;
  responses: number;
  tokens: TokenCounts;
  /**
   * Sum over responses of output tokens × context size (input + cache write + cache read).
   * Output energy grows with context, and logs are pruned after about 30 days, so we keep this
   * count now and price it once the energy model can (ANCHORS D12). Missing on rows written
   * before it existed.
   */
  outputContext?: number;
}

const rowKey = (r: Pick<RollupRow, "date" | "source" | "model" | "projectId">) =>
  `${r.date}|${r.source}|${r.model}|${r.projectId ?? ""}`;

const sum = (t: TokenCounts) => TOKEN_TYPES.reduce((s, k) => s + t[k], 0);

/** One response's output tokens × the context it read them against. */
export const outputContext = (t: TokenCounts) => t.output * (t.input + t.cacheWrite + t.cacheRead);

/** Rolls deduped usage records up into daily rows. */
export function rollup(records: readonly UsageRecord[]): RollupRow[] {
  const rows = new Map<string, RollupRow>();
  for (const r of records) {
    const base = {
      date: r.timestamp.slice(0, 10),
      source: r.source,
      model: r.model,
      projectId: r.project?.id ?? null,
      projectName: r.project?.name ?? null,
    };
    const key = rowKey(base);
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { ...base, responses: 0, tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, outputContext: 0 }));
    row.responses += 1;
    for (const t of TOKEN_TYPES) row.tokens[t] += r.tokens[t];
    row.outputContext! += outputContext(r.tokens);
  }
  return sortRows([...rows.values()]);
}

function sortRows(rows: RollupRow[]): RollupRow[] {
  return rows.sort((a, b) => rowKey(a).localeCompare(rowKey(b)));
}

/**
 * Merges stored history with rollups from the logs on disk now.
 *
 * Claude Code only ever adds to a day's logs, then deletes whole old session files. So for any
 * day/model/project, the larger count is the more complete one: a rerun can't double-count, and
 * pruned logs can't shrink history.
 */
export function mergeHistory(stored: readonly RollupRow[], fresh: readonly RollupRow[]): RollupRow[] {
  const rows = new Map<string, RollupRow>();
  for (const row of [...stored, ...fresh]) {
    const key = rowKey(row);
    const prev = rows.get(key);
    if (!prev || sum(row.tokens) > sum(prev.tokens) || (sum(row.tokens) === sum(prev.tokens) && moreComplete(row, prev))) {
      rows.set(key, row);
    }
  }
  return sortRows([...rows.values()]);
}

/** Same token total: more responses wins, then a row that carries outputContext over an older one without it. */
const moreComplete = (row: RollupRow, prev: RollupRow) =>
  row.responses > prev.responses || (row.responses === prev.responses && row.outputContext !== undefined && prev.outputContext === undefined);

/** Turns rollup rows back into records so `estimate` can price them. One record per row. */
export function rollupRecords(rows: readonly RollupRow[]): UsageRecord[] {
  return rows.map((r) => ({
    source: r.source,
    key: rowKey(r),
    timestamp: `${r.date}T00:00:00.000Z`,
    model: r.model,
    project: r.projectId ? { id: r.projectId, name: r.projectName ?? "(unknown)" } : null,
    tokens: { ...r.tokens },
  }));
}

/** Serializes history as JSONL: a header line, then one row per line. */
export function serializeHistory(rows: readonly RollupRow[]): string {
  const header = JSON.stringify({ schema: HISTORY_SCHEMA, kind: "daily-rollups", note: "Token counts only. Energy is recomputed on read." });
  return [header, ...rows.map((r) => JSON.stringify(r))].join("\n") + "\n";
}

export function parseHistory(text: string): RollupRow[] {
  const rows: RollupRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRow(value)) rows.push(value);
  }
  return rows;
}

function isRow(v: unknown): v is RollupRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<RollupRow>;
  return (
    typeof r.date === "string" &&
    typeof r.model === "string" &&
    typeof r.source === "string" &&
    typeof r.responses === "number" &&
    !!r.tokens &&
    TOKEN_TYPES.every((t) => typeof r.tokens![t] === "number") &&
    (r.outputContext === undefined || typeof r.outputContext === "number")
  );
}

export interface Week {
  /** Monday of the week, YYYY-MM-DD. */
  start: string;
  low: number;
  central: number;
  high: number;
  tokens: number;
}

/** Monday of the UTC week containing a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** Groups daily energy into weeks, filling empty weeks between the first and last with zeros. */
export function weekly(days: readonly { key: string; energy: { low: number; central: number; high: number }; tokens: TokenCounts }[]): Week[] {
  const weeks = new Map<string, Week>();
  for (const d of days) {
    const start = weekStart(d.key);
    let w = weeks.get(start);
    if (!w) weeks.set(start, (w = { start, low: 0, central: 0, high: 0, tokens: 0 }));
    w.low += d.energy.low;
    w.central += d.energy.central;
    w.high += d.energy.high;
    w.tokens += sum(d.tokens);
  }
  const sorted = [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (sorted.length < 2) return sorted;
  const filled: Week[] = [];
  const cursor = new Date(`${sorted[0]!.start}T00:00:00Z`);
  const last = sorted[sorted.length - 1]!.start;
  while (cursor.toISOString().slice(0, 10) <= last) {
    const start = cursor.toISOString().slice(0, 10);
    filled.push(weeks.get(start) ?? { start, low: 0, central: 0, high: 0, tokens: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return filled;
}
