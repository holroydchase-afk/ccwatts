import { emptyCounts, TOKEN_TYPES, type TokenCounts, type UsageRecord } from "./types.js";

export function addCounts(into: TokenCounts, from: TokenCounts): TokenCounts {
  for (const type of TOKEN_TYPES) into[type] += from[type];
  return into;
}

export function totalTokens(counts: TokenCounts): number {
  return TOKEN_TYPES.reduce((sum, type) => sum + counts[type], 0);
}

/** Merge records from several files, keeping one per dedupe key (later wins). */
export function dedupe(records: Iterable<UsageRecord>): UsageRecord[] {
  const byKey = new Map<string, UsageRecord>();
  for (const record of records) byKey.set(`${record.source}:${record.key}`, record);
  return [...byKey.values()];
}

export interface ModelTotals {
  model: string;
  tokens: TokenCounts;
}

/** Token counts per model, largest total first. */
export function totalsByModel(records: Iterable<UsageRecord>): ModelTotals[] {
  const byModel = new Map<string, TokenCounts>();
  for (const record of records) {
    const counts = byModel.get(record.model) ?? emptyCounts();
    byModel.set(record.model, addCounts(counts, record.tokens));
  }
  return [...byModel.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens));
}
