import { projectRef } from "../project.js";
import { safeName } from "../sanitize.js";
import type { ActivityEvent, UsageAdapter, UsageRecord } from "../types.js";

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

/** Most tokens one response can plausibly report. Anything above is a corrupt or crafted line. */
export const MAX_TOKENS_PER_RESPONSE = 1e9;

/**
 * A token count: a whole number from 0 to 1e9. Missing, non-numeric and negative values count
 * as 0. A number that is fractional, not finite or over the cap makes the whole line malformed
 * (null), so one corrupt line can't swamp a total.
 *
 * `required` is for input_tokens and output_tokens, which Claude Code always writes as numbers.
 * JSON writes a number it can't hold (Infinity, NaN) as null, so a null there is malformed too.
 * The cache fields can be null or missing in older logs and count as 0.
 */
const count = (value: unknown, required = false): number | null => {
  if (value === null && required) return null;
  if (typeof value !== "number" || value <= 0) return 0;
  return Number.isInteger(value) && value <= MAX_TOKENS_PER_RESPONSE ? value : null;
};

/** An ISO timestamp that starts with a real date; anything else can't be placed on a day. */
const validTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function toRecord(line: AssistantLine): UsageRecord | null {
  if (line.type !== "assistant") return null;
  const message = line.message;
  const usage = message?.usage;
  const model = str(message?.model);
  const timestamp = str(line.timestamp);
  const messageId = str(message?.id);
  if (!usage || !model || !timestamp || !messageId) return null;
  if (!validTimestamp(timestamp)) return null;
  // Claude Code writes "<synthetic>" for locally generated messages that never hit the API.
  if (model === "<synthetic>") return null;

  const input = count(usage.input_tokens, true);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const output = count(usage.output_tokens, true);
  if (input === null || cacheWrite === null || cacheRead === null || output === null) return null;

  const cwd = str(line.cwd);
  return {
    source: "claude-code",
    key: `${messageId}:${str(line.requestId) ?? ""}`,
    timestamp,
    model: safeName(model) || "(unnamed)",
    project: cwd ? projectRef(cwd) : null,
    tokens: { input, cacheWrite, cacheRead, output },
  };
}

/** Fields we read from a line for Pace. Content blocks are read for their `type` only, never their text. */
interface ActivityLine {
  type?: unknown;
  timestamp?: unknown;
  isMeta?: unknown;
  isSidechain?: unknown;
  isCompactSummary?: unknown;
  toolUseResult?: unknown;
  origin?: unknown;
  message?: { content?: unknown };
}

const blockType = (block: unknown): unknown =>
  typeof block === "object" && block !== null ? (block as { type?: unknown }).type : undefined;

/**
 * Whether a user line is a turn a person typed, decided by structure alone (see packages/core/README.md).
 * Never looks at the text: a prompt that reads like a command or a tag is still a prompt.
 */
function isHumanTurn(line: ActivityLine): boolean {
  if (line.type !== "user") return false;
  if (line.isMeta === true || line.isSidechain === true || line.isCompactSummary === true) return false;
  if ("toolUseResult" in line) return false;
  const content = line.message?.content;
  if (Array.isArray(content) && content.some((b) => blockType(b) === "tool_result")) return false;
  // Newer logs say who wrote the line. Older ones don't, so fall back to the content's shape.
  if ("origin" in line) {
    const origin = line.origin;
    return typeof origin === "object" && origin !== null && (origin as { kind?: unknown }).kind === "human";
  }
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.length > 0 && content.every((b) => blockType(b) === "text" || blockType(b) === "image");
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
    // A UTF-8 byte-order mark would make the first line unreadable as JSON.
    for (const raw of text.replace(/^\uFEFF/, "").split("\n")) {
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
  /** One event per timestamped user or assistant line, sorted by time. Keeps only the time and the human flag. */
  activity(text) {
    const events: { event: ActivityEvent; ms: number }[] = [];
    for (const raw of text.replace(/^\uFEFF/, "").split("\n")) {
      if (!raw.includes('"user"') && !raw.includes('"assistant"')) continue;
      let line: ActivityLine;
      try {
        line = JSON.parse(raw) as ActivityLine;
      } catch {
        continue;
      }
      if (typeof line !== "object" || line === null) continue;
      if (line.type !== "user" && line.type !== "assistant") continue;
      const timestamp = str(line.timestamp);
      if (!timestamp || !validTimestamp(timestamp)) continue;
      events.push({ event: { timestamp, human: isHumanTurn(line) }, ms: Date.parse(timestamp) });
    }
    return events.sort((a, b) => a.ms - b.ms).map((e) => e.event);
  },
};
