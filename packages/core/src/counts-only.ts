import { claudeCodeAdapter } from "./adapters/claude-code.js";

/** Ids are kept only when they look like ids, so no text can ride along in one (PS-R18). */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const id = (value: unknown): value is string => typeof value === "string" && ID.test(value);

/**
 * A counts-only copy of a Claude Code log, so a cloud session's usage can be kept after its
 * container is gone. Each line is rebuilt from what claudeCodeAdapter reads, never copied:
 * - an assistant line with usage (and ids that look like ids) keeps its timestamp, request and message ids, model, the four
 *   token counts, and the project as "<hash>/<basename>" (never the full path);
 * - any other timestamped assistant line keeps only its type and timestamp (Pace still counts it);
 * - a timestamped user line keeps its timestamp and whether a person typed it.
 * Everything else, including all text, tool input and output, and other metadata, is dropped.
 * Lines are not deduped here; the adapter dedupes on read. Pure: text in, text out.
 */
export function countsOnlyLog(text: string): string {
  const out: string[] = [];
  for (const raw of text.replace(/^﻿/, "").split("\n")) {
    if (!raw.includes('"user"') && !raw.includes('"assistant"')) continue;
    const [event] = claudeCodeAdapter.activity!(raw);
    if (!event) continue;
    let line: { type?: unknown; requestId?: unknown; message?: { id?: unknown } };
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line.type === "user") {
      out.push(JSON.stringify(event.human ? { type: "user", timestamp: event.timestamp, origin: { kind: "human" } } : { type: "user", timestamp: event.timestamp, isMeta: true }));
      continue;
    }
    const [record] = claudeCodeAdapter.parse(raw);
    const requestId = line.requestId === undefined || line.requestId === null || line.requestId === "" ? undefined : line.requestId;
    if (!record || !id(line.message?.id) || (requestId !== undefined && !id(requestId))) {
      out.push(JSON.stringify({ type: "assistant", timestamp: event.timestamp }));
      continue;
    }
    const t = record.tokens;
    out.push(
      JSON.stringify({
        type: "assistant",
        timestamp: record.timestamp,
        ...(record.project ? { cwd: `${record.project.id}/${record.project.name}` } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
        message: {
          id: line.message?.id,
          model: record.model,
          usage: { input_tokens: t.input, cache_creation_input_tokens: t.cacheWrite, cache_read_input_tokens: t.cacheRead, output_tokens: t.output },
        },
      }),
    );
  }
  return out.length ? out.join("\n") + "\n" : "";
}
