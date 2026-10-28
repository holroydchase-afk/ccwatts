# @ccwatts/core

Pure functions shared by the CLI and the web page: log adapters, rollups and (from M1.2) the energy model. No file, network or terminal I/O lives here.

## Claude Code log format (M1.1 findings)

Claude Code writes one JSONL file per session under `<config dir>/projects/<encoded cwd>/<session id>.jsonl`. The config dir is `~/.claude` by default, `~/.config/claude` on some installs, and can be overridden with `CLAUDE_CONFIG_DIR` (comma-separated for several). Subagent logs can sit in nested folders, so the CLI searches recursively.

Lines have a top-level `type`. Only `"assistant"` lines carry usage. The fields the adapter reads:

| Field | Example | Use |
|---|---|---|
| `type` | `"assistant"` | Filter |
| `timestamp` | `"2026-10-18T19:00:57.480Z"` | Day rollups |
| `cwd` | full working directory | Reduced to hash + basename at once, never stored |
| `requestId` | `"req_…"` | Dedupe key, part 2 |
| `message.id` | `"msg_…"` | Dedupe key, part 1 |
| `message.model` | `"claude-opus-5-5"` | Model tier. `"<synthetic>"` means no API call and is skipped |
| `message.usage.input_tokens` | `2` | Fresh input |
| `message.usage.cache_creation_input_tokens` | `40197` | Cache write |
| `message.usage.cache_read_input_tokens` | `42328` | Cache read |
| `message.usage.output_tokens` | `343` | Output |

Also present but not used yet: `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` (cache-write split by TTL), `usage.output_tokens_details.thinking_tokens`, `usage.server_tool_use` (web search/fetch counts), `usage.service_tier`, `usage.speed`, and `sessionId`, `isSidechain`, `gitBranch`, `version` at the top level. Content (`message.content`) is never read into a record.

**Duplicates.** One API response is written as several lines (one per content block), each repeating the same usage. Records are deduped on `message.id` + `requestId`, last line wins. Checked against an independent `jq` count on a real log: identical totals.

## Bad input (CCW-M2.6.4)

The adapter never throws on a bad line; it skips it. What it skips or changes:

- **Byte-order mark.** A UTF-8 BOM at the start of a file is removed before parsing, so the first line still counts.
- **Timestamp.** It must start with a `YYYY-MM-DD` date and parse as a date. Otherwise the line is dropped, so it can't reach a day rollup.
- **Token counts.** Each must be a whole number from 0 to 1e9 (`MAX_TOKENS_PER_RESPONSE`). A fraction, a non-finite number or more than 1e9 makes the whole line malformed and it is dropped. A missing, negative or non-numeric count is 0. `input_tokens` and `output_tokens` are always numbers in real logs, and JSON writes a number it can't hold (Infinity) as `null`, so `null` there drops the line; `null` cache counts are 0.
- **Names.** `message.model` and the cwd basename have C0/C1 control characters, DEL and bidi marks/overrides/isolates removed and are cut to 64 characters (`safeName`). The project id hashes the full original path first, so two folders never merge. A cwd of `/` is named `(root)`.
- **Future dates.** `dropFuture(records, now)` leaves out responses dated more than one day after `now` (a little clock skew is fine). The CLI and MCP server note it as "Ignored N response(s) dated in the future."
- **History file.** `parseHistory` skips rows whose date isn't a real `YYYY-MM-DD`, or whose counts are negative or not finite, and cleans names the same way.

## Retention

Claude Code deletes session logs older than `cleanupPeriodDays` (a `settings.json` key, documented default 30 days). This is why ccwatts keeps its own history from M1.4 onward. **Still to confirm on Chase's machine:** the actual value in `~/.claude/settings.json` and the oldest log date present.

## Where these findings came from

Field names were confirmed on a real Claude Code log from a cloud session (Oct 19, 2026, Claude Code on the web), not yet on Chase's laptop. Run `npm start` locally to confirm the totals look sane there.

## History rows

Each history row is one day × source × model × project with token counts and a response count. Since Oct 22, 2026 (ANCHORS D12) it also carries `outputContext`: the sum over responses of output tokens × context size (input + cache write + cache read). It's a count, never content, and nothing shows or prices it yet. It exists because output energy grows with context and logs are pruned after about 30 days. Rows written before then don't have it. When a day's token totals tie, the merge prefers the row that has it.
