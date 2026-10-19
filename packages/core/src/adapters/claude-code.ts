import { projectRef } from "../project.js";
import type { UsageAdapter, UsageRecord } from "../types.js";

/** Fields we read from a Claude Code JSONL line. Everything else, including content, is ignored. */
interface AssistantLine {
  type?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  requestId?: unknown;
  message?: {
    id?: unknown;
    model?: unknown;
    usage?: {
      input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      output_tokens?: unknown;
    };
  };
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function toRecord(line: AssistantLine): UsageRecord | null {
  if (line.type !== "assistant") return null;
  const message = line.message;
  const usage = message?.usage;
  const model = str(message?.model);
  const timestamp = str(line.timestamp);
  const messageId = str(message?.id);
  if (!usage || !model || !timestamp || !messageId) return null;
  // Claude Code writes "<synthetic>" for locally generated messages that never hit the API.
  if (model === "<synthetic>") return null;

  const cwd = str(line.cwd);
  return {
    source: "claude-code",
    key: `${messageId}:${str(line.requestId) ?? ""}`,
    timestamp,
    model,
    project: cwd ? projectRef(cwd) : null,
    tokens: {
      input: num(usage.input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      output: num(usage.output_tokens),
    },
  };
}

/**
 * Parses the JSONL that Claude Code writes under `<config dir>/projects/`.
 * One API response can span several lines (one per content block), each repeating
 * the same usage, so records are deduped by message id + request id. The last line wins,
 * since it carries the final output count.
 */
export const claudeCodeAdapter: UsageAdapter = {
  id: "claude-code",
  parse(text) {
    const byKey = new Map<string, UsageRecord>();
    for (const raw of text.split("\n")) {
      if (!raw.includes('"assistant"')) continue;
      let line: AssistantLine;
      try {
        line = JSON.parse(raw) as AssistantLine;
      } catch {
        continue;
      }
      const record = toRecord(line);
      if (record) byKey.set(record.key, record);
    }
    return [...byKey.values()];
  },
};
