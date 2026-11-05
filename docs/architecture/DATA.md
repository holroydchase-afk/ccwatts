# Data: what ccwatts reads, stores and never moves

A PR that changes how data is read, stored, logged or shared updates this page in the same PR.

| Data | Where | What's kept | Leaves the machine? |
|---|---|---|---|
| Claude Code logs | `~/.claude/projects/**/*.jsonl` (or `CLAUDE_CONFIG_DIR`, or `--path`) | Read only. Token counts, model, day, project; never prompt or response text | No |
| History | `~/.ccwatts/history.jsonl` | Daily counts per model and project (project = hash + folder basename) | No |
| Pace | `~/.ccwatts/pace.jsonl`, created only when `ccwatts pace` first runs | Daily active minutes, whole first/last local hours | No; shared only with `--share-pace` |
| Dashboard / receipt files | where the user saves them | Counts and folder basenames, no project ids (PS-R5) | Only if the user shares them |
| Playground | the browser tab | Files the user drops, processed in-page | No: CSP `default-src 'none'` blocks every request |
| MCP server (`ccwatts mcp`) | stdio pipe to Claude Code | Same counts as `--json` | No port, no network |

Guards: `scripts/check-no-network.ts`, `scripts/check-logs.ts`, `scripts/check-private.ts`, `npm run check:browser`.
