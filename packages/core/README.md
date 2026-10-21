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

## Retention

Claude Code deletes session logs older than `cleanupPeriodDays` (a `settings.json` key, documented default 30 days). This is why ccwatts keeps its own history from M1.4 onward. **Still to confirm on Chase's machine:** the actual value in `~/.claude/settings.json` and the oldest log date present.

## Where these findings came from

Field names were confirmed on a real Claude Code log from a cloud session (Oct 19, 2026, Claude Code on the web), not yet on Chase's laptop. Run `npm start` locally to confirm the totals look sane there.
