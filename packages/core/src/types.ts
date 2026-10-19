export const TOKEN_TYPES = ["input", "cacheWrite", "cacheRead", "output"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export type TokenCounts = Record<TokenType, number>;

/** A project, identified without storing its full path. */
export interface ProjectRef {
  /** Stable hash of the full working-directory path. */
  id: string;
  /** Basename of the working directory, for display. */
  name: string;
}

/**
 * One billed model response, normalized across providers. Counts only:
 * adapters must never copy prompt or response content into a record.
 */
export interface UsageRecord {
  /** Which adapter produced this record, e.g. "claude-code". */
  source: string;
  /** Dedupe key, unique per billed response within a source. */
  key: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  model: string;
  project: ProjectRef | null;
  tokens: TokenCounts;
}

/** A provider adapter turns raw log text into usage records. Pure: no I/O. */
export interface UsageAdapter {
  id: string;
  parse(text: string): UsageRecord[];
}

export function emptyCounts(): TokenCounts {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}
